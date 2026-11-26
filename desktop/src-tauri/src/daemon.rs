//! Daemon supervisor for the A.stand desktop shell.
//!
//! Responsibilities:
//!   1. Locate `daemon.mjs` (portable layout, resources dir, repo `dist/`, env override).
//!   2. Locate `node` (`ASTAND_NODE_BIN`, `node` on PATH, then the standard Windows install).
//!   3. Spawn `node daemon.mjs --print-ready [--desktop-html <path>]` with piped stdio and
//!      `CREATE_NO_WINDOW`, so nothing flashes on screen.
//!   4. Wait (max 15s) for the `ASTAND_DAEMON_READY {json}` handshake while background
//!      threads keep draining both pipes.
//!   5. Hand the ready payload to the tray + window, and keep the `Child` owned so an
//!      explicit quit can stop only the daemon *we* spawned.

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::tray;
use crate::window;

/// Maximum time the daemon may take to print its readiness handshake.
pub const READY_TIMEOUT: Duration = Duration::from_secs(15);
const READY_PREFIX: &str = "ASTAND_DAEMON_READY ";
const STDERR_TAIL_LINES: usize = 24;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Payload printed by `daemon.mjs --print-ready` on stdout.
#[derive(Clone, Debug, Deserialize)]
pub struct DaemonInfo {
    pub host: String,
    pub port: u16,
    #[serde(rename = "uiToken")]
    pub ui_token: String,
    #[serde(rename = "mcpUrl")]
    pub mcp_url: String,
}

impl DaemonInfo {
    pub fn console_url(&self) -> String {
        format!("http://{}:{}/?uiToken={}", self.host, self.port, self.ui_token)
    }

    pub fn gateway_label(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Managed state shared by the supervisor thread, the tray menu and the exit hook.
#[derive(Default)]
pub struct DaemonState {
    pub info: Mutex<Option<DaemonInfo>>,
    pub child: Mutex<Option<Child>>,
}

/// Terminate the daemon child we spawned, but never a pre-existing daemon:
/// if the child already exited (single-instance reuse) `try_wait` returns `Some`.
pub fn kill_owned(state: &DaemonState) {
    let mut guard = match state.child.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(mut child) = guard.take() else {
        return;
    };
    if let Ok(Some(_)) = child.try_wait() {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub fn current_info(app: &AppHandle) -> Option<DaemonInfo> {
    let state = app.try_state::<DaemonState>()?;
    let snapshot = state.info.lock().ok()?.clone();
    snapshot
}

/// Spawn the supervisor on a background thread so the window paints immediately.
pub fn start_supervisor(app: AppHandle) {
    thread::spawn(move || match boot() {
        Ok((info, child)) => {
            if let Some(state) = app.try_state::<DaemonState>() {
                if let Ok(mut slot) = state.info.lock() {
                    *slot = Some(info.clone());
                }
                if let Ok(mut slot) = state.child.lock() {
                    *slot = Some(child);
                }
            }
            tray::apply_ready(&app, &info);
            eprintln!(
                "[a-stand] daemon ready: gateway={} mcp={}",
                info.gateway_label(),
                info.mcp_url
            );
            window::navigate(&app, &info.console_url());
        }
        Err(reason) => {
            let message = window::boot_failure_message(&reason);
            eprintln!("[a-stand] {message}");
            tray::apply_failed(&app);
            window::show_error(&app, &message);
        }
    });
}

/// Full boot sequence. `Err` carries a short technical reason for the error page.
fn boot() -> Result<(DaemonInfo, Child), String> {
    let script = find_daemon_script()
        .ok_or_else(|| "找不到 daemon.mjs（可设置 ASTAND_DAEMON_SCRIPT 指向它）".to_string())?;
    let desktop_html = script
        .parent()
        .map(|dir| dir.join("desktop.html"))
        .filter(|path| path.is_file());
    let child = spawn_node(&script, desktop_html.as_deref())?;
    wait_for_ready(child)
}

fn wait_for_ready(mut child: Child) -> Result<(DaemonInfo, Child), String> {
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("无法接管 daemon 的 stdout 管道".to_string());
    };
    let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = Arc::clone(&stderr_tail);
        thread::spawn(move || drain_stderr(stderr, tail));
    }

    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            // Once the supervisor stops listening we keep draining, never block the daemon.
            let _ = tx.send(line);
        }
    });

    let deadline = Instant::now() + READY_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                let Some(payload) = line.strip_prefix(READY_PREFIX) else {
                    continue;
                };
                return match serde_json::from_str::<DaemonInfo>(payload.trim()) {
                    Ok(info) => Ok((info, child)),
                    Err(err) => {
                        let _ = child.kill();
                        Err(format!("ASTAND_DAEMON_READY 负载解析失败：{err}"))
                    }
                };
            }
            Err(RecvTimeoutError::Timeout) => break,
            Err(RecvTimeoutError::Disconnected) => {
                // The stdout pipe closed: the child is exiting, but Windows may not have
                // published the exit status yet, so give `try_wait` a short grace window.
                let detail = stderr_snapshot(&stderr_tail);
                return Err(format!(
                    "daemon 在就绪前退出（{}）{detail}",
                    exit_status_text(&mut child)
                ));
            }
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    let detail = stderr_snapshot(&stderr_tail);
    Err(format!(
        "daemon 在 {} 秒内未输出 ASTAND_DAEMON_READY{detail}",
        READY_TIMEOUT.as_secs()
    ))
}

/// Poll for the child's exit status for up to ~1.2s, then reap it.
/// Windows often reports "still running" for a moment after the stdout pipe closes.
fn exit_status_text(child: &mut Child) -> String {
    let deadline = Instant::now() + Duration::from_millis(1200);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return format!("退出码 {status}").replace("exit code: ", ""),
            Ok(None) if Instant::now() >= deadline => break,
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(err) => return format!("无法读取退出码：{err}"),
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    "已终止".to_string()
}

fn drain_stderr(stderr: impl std::io::Read + Send + 'static, tail: Arc<Mutex<VecDeque<String>>>) {
    for line in BufReader::new(stderr).lines() {
        let Ok(line) = line else { break };
        let trimmed = line.trim_end().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(mut buffer) = tail.lock() {
            if buffer.len() >= STDERR_TAIL_LINES {
                buffer.pop_front();
            }
            buffer.push_back(trimmed);
        }
    }
}

fn stderr_snapshot(tail: &Arc<Mutex<VecDeque<String>>>) -> String {
    let Ok(buffer) = tail.lock() else {
        return String::new();
    };
    if buffer.is_empty() {
        return String::new();
    }
    let joined = buffer.iter().cloned().collect::<Vec<_>>().join("\n");
    format!("\n--- daemon stderr ---\n{joined}")
}

fn spawn_node(script: &Path, desktop_html: Option<&Path>) -> Result<Child, String> {
    let mut errors: Vec<String> = Vec::new();
    for node in node_candidates() {
        let mut command = Command::new(&node);
        command
            .arg(script)
            .arg("--print-ready")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(html) = desktop_html {
            command.arg("--desktop-html").arg(html);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(err) => errors.push(format!("{}：{err}", node.to_string_lossy())),
        }
    }
    Err(format!("无法启动 node（{}）", errors.join("；")))
}

fn node_candidates() -> Vec<OsString> {
    let mut candidates: Vec<OsString> = Vec::new();
    if let Some(explicit) = env_non_empty("ASTAND_NODE_BIN") {
        candidates.push(OsString::from(explicit));
    }
    candidates.push(OsString::from("node"));
    let fallback = Path::new(r"C:\Program Files\nodejs\node.exe");
    if fallback.is_file() {
        candidates.push(fallback.as_os_str().to_os_string());
    }
    candidates
}

fn find_daemon_script() -> Option<PathBuf> {
    candidate_scripts().into_iter().find(|path| path.is_file())
}

fn candidate_scripts() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(explicit) = env_non_empty("ASTAND_DAEMON_SCRIPT") {
        candidates.push(PathBuf::from(explicit));
    }
    if let Some(exe_dir) = exe_dir() {
        candidates.push(exe_dir.join("daemon.mjs"));
        candidates.push(exe_dir.join("resources").join("daemon.mjs"));
        // Running straight out of `desktop/src-tauri/target/release/a-stand.exe`.
        for up in ["../../..", "../../../.."] {
            candidates.push(exe_dir.join(up).join("dist").join("daemon.mjs"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("dist").join("daemon.mjs"));
    }
    candidates
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
}

fn env_non_empty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
