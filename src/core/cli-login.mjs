import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findExtensibleCliDef } from "./cli-registry.mjs";
import { CLI_ENGINES_META } from "./constants.mjs";
import { resolveCliPresetBinary } from "./paths.mjs";

const isWin = process.platform === "win32";
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const INITIAL_CAPTURE_WAIT_MS = 3500;
const URL_RE = /https:\/\/[^\s"'<>]+/i;
const QR_IMAGE_RE = /QR_IMAGE=(.+)/i;
const USER_CODE_RE = /(?:Code|code|验证码|授权码)\s*[:：]\s*([A-Z0-9-]{4,24})/;

/** @type {Map<string, any>} */
const activeSessions = new Map();

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function killProcessTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (isWin) {
      execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => {});
    } else {
      proc.kill("SIGTERM");
    }
  } catch {}
}

/**
 * Safely open an https:// URL in the user's default system browser without shell interpolation.
 */
export function openExternalUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(url)) {
    return { ok: false, error: "Only valid https:// URLs can be opened" };
  }
  try {
    if (isWin) {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", "Start-Process -FilePath $env:ASTAND_OPEN_URL"],
        { windowsHide: true, env: { ...process.env, ASTAND_OPEN_URL: url } },
        () => {}
      );
    } else if (process.platform === "darwin") {
      execFile("open", [url], () => {});
    } else {
      execFile("xdg-open", [url], () => {});
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function resolveLoginDef(engineId, customEngines) {
  const extensible = findExtensibleCliDef(engineId, customEngines);
  if (extensible) return extensible;
  const meta = CLI_ENGINES_META[engineId];
  if (!meta) return null;
  const command = String(meta.loginCmd || engineId).trim().split(/\s+/)[0] || engineId;
  return { ...meta, protocol: "headless", command };
}

/**
 * Qoder's native `login` opens the browser itself (even with NO_BROWSER=1), so the wrapper must
 * never open the same auth URL a second time. Other CLIs still auto-open once.
 */
export function resolveLoginAutoOpen(engineId, requested = true) {
  if (engineId === "qoder" || engineId === "qoder-cn") return false;
  return requested !== false;
}

export function buildLoginLaunchSpec(engineId, def, region = "cn", profileDir = "", resolveBinary = resolveCliPresetBinary) {
  const bin = resolveBinary(def);
  if (!bin) {
    return { ok: false, error: `CLI binary not found for "${engineId}". Please install it first.` };
  }

  const baseEnv = { ...process.env };
  const overlay = buildProfileOverlay(engineId, profileDir);

  if (engineId === "doubao") {
    // Clearing proxy variables prevents local proxy interference with Doubao's native QR auth endpoint.
    const cleanEnv = {
      ...baseEnv,
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      ALL_PROXY: "",
      all_proxy: "",
    };
    return {
      ok: true,
      mode: "qr",
      command: bin.command,
      args: ["login", "--qr=png"],
      useShell: bin.useShell,
      env: cleanEnv,
      autoOpen: resolveLoginAutoOpen(engineId, true),
    };
  }

  if (engineId === "minimax") {
    const safeRegion = region === "global" ? "global" : "cn";
    return {
      ok: true,
      mode: "browser",
      command: bin.command,
      args: ["login", "--no-browser", "--region", safeRegion],
      useShell: bin.useShell,
      env: { ...baseEnv, NO_BROWSER: "1" },
      autoOpen: resolveLoginAutoOpen(engineId, true),
    };
  }

  if (engineId === "qoder" || engineId === "qoder-cn") {
    return {
      ok: true,
      mode: "browser",
      command: bin.command,
      args: [...overlay.extraArgs, "login"],
      useShell: bin.useShell,
      env: { ...baseEnv, ...overlay.env, NO_BROWSER: "1" },
      autoOpen: resolveLoginAutoOpen(engineId, false),
    };
  }

  if (engineId === "codebuddy") {
    return {
      ok: false,
      error: "CodeBuddy CLI 需在交互终端中登录：请打开终端运行 codebuddy，输入 /login 完成登录（支持微信 / Google / GitHub），然后回来点「刷新检测」。",
    };
  }

  // Generic fallback for other extensible CLIs (opencode, kimi, cursor-cli, custom...)
  const rawLogin = String(def.loginCmd || "").trim();
  const parts = rawLogin ? rawLogin.split(/\s+/).filter(Boolean) : [def.command, "login"];
  const baseArgs = parts.length > 1 ? parts.slice(1) : ["login"];
  return {
    ok: true,
    mode: "browser",
    command: bin.command,
    args: [...overlay.extraArgs, ...baseArgs],
    useShell: bin.useShell,
    env: { ...baseEnv, ...overlay.env, NO_BROWSER: "1" },
    autoOpen: resolveLoginAutoOpen(engineId, true),
  };
}

function buildProfileOverlay(engineId, profileDir) {
  const dir = String(profileDir || "").trim();
  if (!dir) return { env: {}, extraArgs: [] };
  if (engineId === "codex") return { env: { CODEX_HOME: dir }, extraArgs: [] };
  if (engineId === "qoder" || engineId === "qoder-cn") return { env: {}, extraArgs: ["--config-dir", dir] };
  if (engineId === "opencode") return { env: { XDG_CONFIG_HOME: dir }, extraArgs: [] };
  return { env: {}, extraArgs: [] };
}

function toPublicSnapshot(session) {
  if (!session) return null;
  return {
    engineId: session.engineId,
    profileId: session.profileId || "",
    mode: session.mode,
    region: session.region,
    status: session.status,
    authUrl: session.authUrl,
    userCode: session.userCode,
    qrDataUrl: session.qrDataUrl,
    message: session.message,
    error: session.error,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
  };
}

export function getCliLoginStatus(engineId) {
  return toPublicSnapshot(activeSessions.get(engineId) || null);
}

export function getAllCliLoginStatuses() {
  const out = {};
  for (const [id, session] of activeSessions.entries()) {
    out[id] = toPublicSnapshot(session);
  }
  return out;
}

export function cancelCliLogin(engineId) {
  const session = activeSessions.get(engineId);
  if (!session) return { ok: true, cancelled: false };
  session.cancelled = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.proc && session.status !== "succeeded" && session.status !== "failed") {
    session.status = "cancelled";
    session.finishedAt = Date.now();
    session.message = "已取消登录";
    killProcessTree(session.proc);
  }
  if (typeof session.onUpdate === "function") {
    try {
      session.onUpdate(toPublicSnapshot(session));
    } catch {}
  }
  activeSessions.delete(engineId);
  return { ok: true, cancelled: true };
}

export function cancelAllCliLogins() {
  for (const id of [...activeSessions.keys()]) {
    cancelCliLogin(id);
  }
}

export function reopenCliLoginBrowser(engineId) {
  const session = activeSessions.get(engineId);
  if (!session?.authUrl) {
    return { ok: false, error: "No active browser login URL for this CLI" };
  }
  return openExternalUrl(session.authUrl);
}

/**
 * Spawn official CLI login in the background, capture OAuth URL or QR image PNG,
 * auto-open browser for URL logins, and emit live updates until completion.
 */
export async function startCliLogin({
  engineId,
  customEngines = [],
  region = "cn",
  autoOpen = true,
  profileId = "",
  profileDir = "",
  onUpdate = null,
} = {}) {
  const def = resolveLoginDef(engineId, customEngines);
  if (!def) {
    return { ok: false, error: `Unknown CLI engine "${engineId}"` };
  }

  // Cancel any prior login session for this engine (important for Doubao's single-login lock).
  if (activeSessions.has(engineId)) {
    cancelCliLogin(engineId);
    await new Promise((r) => setTimeout(r, 200));
  }

  const spec = buildLoginLaunchSpec(engineId, def, region, profileDir);
  if (!spec.ok) return spec;
  if (profileDir) {
    try {
      fs.mkdirSync(profileDir, { recursive: true });
    } catch {}
  }

  const session = {
    engineId,
    profileId: profileId || "",
    mode: spec.mode,
    region: region === "global" ? "global" : "cn",
    status: "starting",
    authUrl: "",
    userCode: "",
    qrDataUrl: "",
    message: spec.mode === "qr" ? "正在生成扫码登录二维码…" : "正在获取官方登录链接…",
    error: "",
    startedAt: Date.now(),
    finishedAt: 0,
    cancelled: false,
    browserOpened: false,
    proc: null,
    timer: null,
    onUpdate,
    rawTail: "",
  };
  activeSessions.set(engineId, session);

  let resolveInitial;
  const initialReady = new Promise((resolve) => {
    resolveInitial = resolve;
  });
  const initialTimer = setTimeout(() => resolveInitial(), INITIAL_CAPTURE_WAIT_MS);

  const emit = () => {
    if (typeof onUpdate === "function") {
      try {
        onUpdate(toPublicSnapshot(session));
      } catch {}
    }
  };

  let proc;
  try {
    proc = spawn(spec.command, spec.args, {
      shell: Boolean(spec.useShell),
      windowsHide: true,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    clearTimeout(initialTimer);
    session.status = "failed";
    session.error = err?.message || String(err);
    session.finishedAt = Date.now();
    emit();
    return { ok: false, error: session.error, login: toPublicSnapshot(session) };
  }

  session.proc = proc;
  session.timer = setTimeout(() => {
    if (session.status === "starting" || session.status === "waiting_browser" || session.status === "waiting_qr") {
      session.status = "failed";
      session.error = "登录超时（10 分钟），请重试";
      session.finishedAt = Date.now();
      killProcessTree(proc);
      emit();
    }
  }, LOGIN_TIMEOUT_MS);

  const handleChunk = (chunk) => {
    if (session.cancelled) return;
    const text = stripAnsi(chunk.toString("utf8"));
    session.rawTail = (session.rawTail + text).slice(-2000);
    let changed = false;

    const qrMatch = text.match(QR_IMAGE_RE) || session.rawTail.match(QR_IMAGE_RE);
    if (qrMatch && !session.qrDataUrl) {
      const qrPath = qrMatch[1].trim().replace(/^["']|["']$/g, "");
      try {
        if (qrPath && fs.existsSync(qrPath)) {
          const buf = fs.readFileSync(qrPath);
          if (buf.length > 0 && buf.length < 2 * 1024 * 1024) {
            session.qrDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
            session.status = "waiting_qr";
            session.message = "请使用手机「豆包 App」扫码并在手机上确认登录";
            changed = true;
            clearTimeout(initialTimer);
            resolveInitial();
          }
        }
      } catch {}
    }

    const urlMatch = text.match(URL_RE);
    if (urlMatch && !session.authUrl) {
      const cleaned = urlMatch[0].replace(/[),.;]+$/, "");
      session.authUrl = cleaned;
      session.status = "waiting_browser";
      session.message = "请在浏览器中完成官方登录授权";
      changed = true;
      if (spec.autoOpen && autoOpen && !session.browserOpened) {
        session.browserOpened = true;
        openExternalUrl(cleaned);
      }
      clearTimeout(initialTimer);
      resolveInitial();
    }

    const codeMatch = text.match(USER_CODE_RE);
    if (codeMatch && !session.userCode) {
      session.userCode = codeMatch[1].trim();
      changed = true;
    }

    if (changed) emit();
  };

  proc.stdout?.on("data", handleChunk);
  proc.stderr?.on("data", handleChunk);

  proc.on("error", (err) => {
    clearTimeout(initialTimer);
    if (session.timer) clearTimeout(session.timer);
    if (session.cancelled) return;
    session.status = "failed";
    session.error = err?.message || String(err);
    session.finishedAt = Date.now();
    emit();
    resolveInitial();
  });

  proc.on("exit", (code) => {
    clearTimeout(initialTimer);
    if (session.timer) clearTimeout(session.timer);
    if (session.cancelled) {
      resolveInitial();
      return;
    }
    session.finishedAt = Date.now();
    const sawAuthProof =
      Boolean(session.authUrl) ||
      Boolean(session.qrDataUrl) ||
      /(?:login\s+success|logged\s+in|authenticated|successfully\s+(?:logged|signed)|登录成功|认证成功|授权成功)/i.test(
        session.rawTail
      );
    if (code === 0 && sawAuthProof) {
      session.status = "succeeded";
      session.message = "登录成功！";
      session.error = "";
    } else if (code === 0) {
      session.status = "failed";
      session.error = `该 CLI 未返回登录链接或授权回执（可能仅支持交互式终端登录），请在终端运行 "${def.command}" 完成登录后点「刷新检测」。`;
    } else {
      session.status = "failed";
      const lastLine = session.rawTail
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(-2)
        .join(" ");
      session.error = lastLine || `登录进程退出（code=${code}）`;
    }
    emit();
    resolveInitial();
  });

  await initialReady;
  return { ok: session.status !== "failed", error: session.error || undefined, login: toPublicSnapshot(session) };
}
