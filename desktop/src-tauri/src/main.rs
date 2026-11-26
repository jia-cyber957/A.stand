//! A.stand v2 native Windows desktop shell.
//!
//! A thin Tauri 2 wrapper: the window loads the bundled loading page, a background
//! supervisor boots `daemon.mjs --print-ready`, and once `ASTAND_DAEMON_READY` arrives
//! the webview navigates to the local console. Closing the window hides it to the tray;
//! only the tray's quit item stops the daemon we spawned.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod daemon;
mod tray;

use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    tauri::Builder::default()
        .manage(daemon::DaemonState::default())
        .setup(|app| {
            tray::build(app.handle())?;
            let handle = app.handle().clone();
            daemon::start_supervisor(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Hide to the tray instead of exiting: the daemon keeps serving.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build the A.stand desktop shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<daemon::DaemonState>() {
                    daemon::kill_owned(&state);
                }
            }
        });
}

/// Window presentation helpers: navigate the webview, and render the failure page.
/// Kept here (not in `daemon.rs`) so the supervisor stays purely about process control.
pub mod window {
    use tauri::{AppHandle, Manager, Url};

    const MAIN: &str = "main";

    /// Navigate the main webview to the daemon console and bring it forward.
    pub fn navigate(app: &AppHandle, url: &str) {
        let Some(window) = app.get_webview_window(MAIN) else {
            return;
        };
        match Url::parse(url) {
            Ok(target) => {
                if let Err(err) = window.navigate(target) {
                    eprintln!("[a-stand] navigation failed: {err}");
                }
            }
            Err(err) => eprintln!("[a-stand] invalid console url {url}: {err}"),
        }
        let _ = window.show();
        let _ = window.set_focus();
    }

    /// Re-render the bundled loading page in error mode via a URL-encoded `?reason=`.
    /// The page itself stays inside `frontendDist`, so no extra asset is needed.
    pub fn show_error(app: &AppHandle, message: &str) {
        let Some(window) = app.get_webview_window(MAIN) else {
            return;
        };
        let mut target = window
            .url()
            .ok()
            .filter(|url| url.scheme() == "http" || url.scheme() == "tauri")
            .unwrap_or_else(|| Url::parse("http://tauri.localhost/").expect("static url"));
        target.set_path("/");
        target.set_query(Some(&format!("reason={}", percent_encode(&truncate(message, 1600)))));
        if let Err(err) = window.navigate(target) {
            eprintln!("[a-stand] failed to open error page: {err}");
        }
        let _ = window.show();
        let _ = window.set_focus();
    }

    /// Human-readable remediation text embedded in the failure page.
    pub fn boot_failure_message(reason: &str) -> String {
        format!(
            "无法启动 A.stand 本地守护进程。\n\n原因：{reason}\n\n\
             修复步骤：\n\
             1. 确认已安装 Node.js 20 或更高版本（命令行执行 node --version）。\n\
             2. 确认 daemon.mjs 与 a-stand.exe 位于同一目录（便携版目录结构）。\n\
             3. 如使用自定义安装位置，可设置 ASTAND_DAEMON_SCRIPT 与 ASTAND_NODE_BIN 环境变量。\n\
             4. 修复后重新启动 A.stand。"
        )
    }

    fn truncate(value: &str, max_chars: usize) -> String {
        if value.chars().count() <= max_chars {
            return value.to_string();
        }
        value.chars().take(max_chars).collect::<String>() + "…"
    }

    fn percent_encode(value: &str) -> String {
        let mut out = String::with_capacity(value.len() * 3);
        for byte in value.as_bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    out.push(*byte as char)
                }
                _ => out.push_str(&format!("%{byte:02X}")),
            }
        }
        out
    }
}
