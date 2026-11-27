import { execFile, execFileSync, spawn } from "node:child_process";
import { findExtensibleCliDef } from "./cli-registry.mjs";
import { resolveGenericBinary } from "./paths.mjs";

const isWin = process.platform === "win32";
const UPDATE_CACHE_TTL_MS = 10 * 60_000;
const UPDATE_FETCH_TIMEOUT_MS = 5_000;
const GITHUB_RELEASES_URL = "https://api.github.com/repos/jia-cyber957/A.stand/releases/latest";

const NPM_PRESETS = Object.freeze({
  codex: { pkg: "@openai/codex", scripts: ["@openai/codex"] },
  doubao: { pkg: "@bytedance/doubao-cli", scripts: ["@bytedance/doubao-cli", "sharp"] },
  minimax: { pkg: "@minimax-ai/code", scripts: ["@minimax-ai/code", "better-sqlite3"] },
  qoder: { pkg: "@qoder-ai/qodercli", scripts: ["@qoder-ai/qodercli", "sharp"] },
  "qoder-cn": { pkg: "@qodercn-ai/qoderclicn", scripts: ["@qodercn-ai/qoderclicn", "sharp"] },
  opencode: { pkg: "opencode-ai", scripts: ["opencode-ai"] },
  codebuddy: { pkg: "@tencent-ai/codebuddy-code", scripts: ["@tencent-ai/codebuddy-code"] },
  qwen: { pkg: "@qwen-code/qwen-code", scripts: ["@qwen-code/qwen-code"] },
  gemini: { pkg: "@google/gemini-cli", scripts: ["@google/gemini-cli"] },
  "claude-code": { pkg: "@anthropic-ai/claude-code", scripts: ["@anthropic-ai/claude-code"] },
  "deepseek-harness": { pkg: "@deepseek-ai/dsh", scripts: ["@deepseek-ai/dsh"] },
});

const UPDATE_NPM_PRESETS = Object.freeze([
  { id: "doubao", label: "Doubao CLI", pkg: "@bytedance/doubao-cli" },
  { id: "minimax", label: "MiniMax Code", pkg: "@minimax-ai/code" },
  { id: "qoder-cn", label: "Qoder CN", pkg: "@qodercn-ai/qoderclicn" },
  { id: "qoder", label: "Qoder Global", pkg: "@qoder-ai/qodercli" },
]);

/** @type {Map<string, any>} */
const installs = new Map();
let updateCache = { ts: 0, value: null };

function emit(session) {
  if (typeof session.onUpdate !== "function") return;
  try {
    session.onUpdate(publicInstall(session));
  } catch {}
}

function publicInstall(session) {
  if (!session) return null;
  return {
    engineId: session.engineId,
    mode: session.mode,
    status: session.status,
    percent: session.percent,
    stage: session.stage,
    message: session.message,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt || 0,
    exitCode: session.exitCode ?? null,
    error: session.error || "",
  };
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

function probeNpmMajor() {
  try {
    const out = execFileSync("npm", ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
      shell: isWin,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = String(out || "").trim().match(/^(\d+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

/**
 * Build a fixed npm command from a known preset. No user-provided text is interpolated into a
 * shell command; only validated preset package names and flags reach argv.
 */
export function buildCliInstallSpec({ engineId, mode = "install", npmMajor = 0 } = {}) {
  if (mode !== "install" && mode !== "update") {
    return { ok: false, error: 'mode must be "install" or "update"' };
  }
  const preset = NPM_PRESETS[engineId];
  if (!preset) {
    return { ok: false, error: `In-app installation is not supported for "${engineId}"` };
  }
  const args = [
    "install",
    "-g",
    mode === "update" ? `${preset.pkg}@latest` : preset.pkg,
    "--no-audit",
    "--no-fund",
    "--loglevel=http",
  ];
  if (npmMajor >= 11 && preset.scripts.length) {
    args.push(`--allow-scripts=${preset.scripts.join(",")}`);
  }
  return { ok: true, command: "npm", args, packageName: preset.pkg };
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function spawnNpm(args) {
  if (!isWin) {
    return spawn("npm", args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  }
  const npmBin = resolveGenericBinary("npm")?.command || "npm.cmd";
  const commandLine = [quoteCmdArg(npmBin), ...args.map(quoteCmdArg)].join(" ");
  return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${commandLine}"`], {
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Map real npm output to a user-visible install stage/percentage. */
export function parseInstallProgress(text, percent = 0) {
  const raw = String(text || "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .toLowerCase();
  let next = percent;
  let stage = "";
  if (/node-gyp|preinstall|postinstall|install script|gyp info|building native|rebuild/.test(raw)) {
    next = Math.max(next, 75);
    stage = "执行原生初始化脚本";
  } else if (/reify|extract|unpack/.test(raw)) {
    next = Math.max(next, 58);
    stage = "解压并写入全局目录";
  } else if (/http fetch|tarball|download|fetch manifest|idealtree/.test(raw)) {
    // Advance smoothly across multiple npm http fetch lines (25% -> 52%) so users see live progress.
    const bump = next < 25 ? 25 : Math.min(52, next + 4);
    next = Math.max(next, bump);
    stage = "正在从 npm 下载安装包";
  }
  if (/(?:added|changed|updated)\s+\d+\s+packages|up to date/.test(raw)) {
    next = Math.max(next, 95);
    stage = "完成安装配置";
  }
  return { percent: Math.min(95, next), stage };
}

export function getCliInstallStatus(engineId) {
  return publicInstall(installs.get(String(engineId || "")) || null);
}

export function getAllCliInstalls() {
  const out = {};
  for (const [engineId, session] of installs.entries()) out[engineId] = publicInstall(session);
  return out;
}

export function cancelCliInstall(engineId) {
  const session = installs.get(String(engineId || ""));
  if (!session) return { ok: true, cancelled: false };
  if (session.status !== "running") return { ok: true, cancelled: false };
  session.cancelled = true;
  session.status = "cancelled";
  session.stage = "已取消";
  session.message = "安装已取消";
  session.finishedAt = Date.now();
  killProcessTree(session.proc);
  emit(session);
  installs.delete(session.engineId);
  return { ok: true, cancelled: true };
}

export function cancelAllCliInstalls() {
  for (const engineId of [...installs.keys()]) cancelCliInstall(engineId);
}

export async function startCliInstall({
  engineId,
  customEngines = [],
  mode = "install",
  onUpdate = null,
} = {}) {
  const id = String(engineId || "");
  if (!id) return { ok: false, error: "engineId is required" };
  if (!findExtensibleCliDef(id, customEngines) && !NPM_PRESETS[id]) {
    return { ok: false, error: `Unknown CLI engine "${id}"` };
  }
  if (installs.has(id) && installs.get(id).status === "running") {
    return { ok: false, error: `An install is already running for "${id}"` };
  }
  const npmMajor = probeNpmMajor();
  const spec = buildCliInstallSpec({ engineId: id, mode, npmMajor });
  if (!spec.ok) return spec;

  const session = {
    engineId: id,
    mode,
    status: "running",
    percent: 10,
    stage: "校验环境",
    message: mode === "update" ? "正在检查并升级 CLI…" : "正在准备安装 CLI…",
    startedAt: Date.now(),
    finishedAt: 0,
    exitCode: null,
    error: "",
    cancelled: false,
    onUpdate,
    proc: null,
    rawTail: "",
  };
  installs.set(id, session);
  emit(session);

  let proc;
  try {
    proc = spawnNpm(spec.args);
  } catch (err) {
    session.status = "failed";
    session.error = err?.message || String(err);
    session.finishedAt = Date.now();
    emit(session);
    return { ok: false, error: session.error, install: publicInstall(session) };
  }
  session.proc = proc;

  const handleChunk = (chunk) => {
    if (session.cancelled) return;
    const text = chunk.toString("utf8");
    session.rawTail = (session.rawTail + text).slice(-4_000);
    const progress = parseInstallProgress(text, session.percent);
    let changed = false;
    if (progress.percent > session.percent) {
      session.percent = progress.percent;
      changed = true;
    }
    if (progress.stage && progress.stage !== session.stage) {
      session.stage = progress.stage;
      session.message = `${progress.stage}…`;
      changed = true;
    }
    if (changed) emit(session);
  };
  proc.stdout?.on("data", handleChunk);
  proc.stderr?.on("data", handleChunk);

  proc.on("error", (err) => {
    if (session.cancelled) return;
    session.status = "failed";
    session.error = err?.message || String(err);
    session.stage = "安装失败";
    session.message = session.error;
    session.finishedAt = Date.now();
    emit(session);
  });

  proc.on("exit", (code) => {
    if (session.cancelled) return;
    session.exitCode = code;
    session.finishedAt = Date.now();
    if (code === 0) {
      session.status = "succeeded";
      session.percent = 100;
      session.stage = "安装完成";
      session.message = mode === "update" ? "CLI 升级完成" : "CLI 安装完成";
    } else {
      session.status = "failed";
      session.stage = "安装失败";
      const tail = session.rawTail
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-2)
        .join(" ");
      session.error = tail || `安装进程退出（code=${code ?? "unknown"}）`;
      session.message = session.error;
    }
    emit(session);
  });

  return { ok: true, install: publicInstall(session) };
}

async function fetchJson(url) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "A.stand-update-check" },
    });
    if (!response?.ok) return null;
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function compareVersions(a, b) {
  const parse = (value) => {
    const match = String(value || "").match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    return match ? [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

async function runUpdateCheck({ currentVersion, detectedEngines }) {
  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    app: { currentVersion: String(currentVersion || ""), latestVersion: "", updateAvailable: false },
    engines: [],
  };
  const pending = [];
  pending.push(
    fetchJson(GITHUB_RELEASES_URL)
      .then((release) => {
        const latest = String(release?.tag_name || release?.name || "").trim();
        if (!latest) return;
        result.app.latestVersion = latest;
        result.app.updateAvailable = compareVersions(latest, currentVersion) > 0;
      })
      .catch(() => {})
  );

  for (const preset of UPDATE_NPM_PRESETS) {
    const detected = detectedEngines?.[preset.id];
    if (!detected || !detected.installed || !detected.version) continue;
    pending.push(
      fetchJson(`https://registry.npmjs.org/${preset.pkg.replace("/", "%2F")}/latest`)
        .then((pkg) => {
          const latest = String(pkg?.version || "").trim();
          if (!latest) return;
          result.engines.push({
            id: preset.id,
            label: preset.label,
            packageName: preset.pkg,
            currentVersion: String(detected.version || ""),
            latestVersion: latest,
            updateAvailable: compareVersions(latest, detected.version) > 0,
          });
        })
        .catch(() => {})
    );
  }
  await Promise.allSettled(pending);
  return result;
}

/**
 * Lightweight update check: 5 s per request, 10 min in-memory cache, never throws or blocks UI
 * startup. Failed sources are silently omitted.
 */
export async function checkUpdates({ currentVersion = "", detectedEngines = {}, force = false } = {}) {
  const now = Date.now();
  if (!force && updateCache.value && now - updateCache.ts < UPDATE_CACHE_TTL_MS) {
    return { ...updateCache.value, cached: true };
  }
  try {
    const value = await runUpdateCheck({ currentVersion, detectedEngines });
    updateCache = { ts: Date.now(), value };
    return { ...value, cached: false };
  } catch {
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      app: { currentVersion: String(currentVersion || ""), latestVersion: "", updateAvailable: false },
      engines: [],
      cached: false,
    };
  }
}

export function clearUpdateCache() {
  updateCache = { ts: 0, value: null };
}
