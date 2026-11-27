import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCodexConfigSummary, resolveCliPresetBinary } from "./paths.mjs";

const ACCOUNT_CACHE_TTL_MS = 60_000;
const ACCOUNT_PROBE_TIMEOUT_MS = 8_000;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENGINE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const ISOLATED_ENGINES = Object.freeze([
  "codex",
  "deepseek-harness",
  "qoder",
  "qoder-cn",
  "opencode",
  "codebuddy",
  "minimax",
  "doubao",
  "junie",
  "kiro",
  "codearts",
]);

/** @type {Map<string, { ts: number, value: object }>} */
const accountCache = new Map();

export function supportsMultiAccountIsolation(engineId) {
  return ISOLATED_ENGINES.includes(String(engineId || ""));
}

/**
 * Resolve a profile directory beneath <dataDir>/cli-profiles/<engine>/<profile>.
 * Both ids are strict allow-lists so a crafted id can never escape the data dir.
 */
export function resolveProfileDir(dataDir, engineId, profileId) {
  const rawRoot = String(dataDir || "").trim();
  if (!rawRoot) throw new Error("dataDir is required");
  const root = path.resolve(rawRoot);
  const engine = String(engineId || "");
  const profile = String(profileId || "");
  if (!ENGINE_ID_RE.test(engine)) throw new Error("Invalid CLI engine id");
  if (!PROFILE_ID_RE.test(profile)) throw new Error("Invalid CLI profile id");
  const base = path.join(root, "cli-profiles", engine);
  const target = path.resolve(base, profile);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("Invalid CLI profile path");
  return target;
}

/** HOME/USERPROFILE (+ HOMEDRIVE/HOMEPATH on Windows) redirection shared by home-rooted CLIs. */
function applyHomeEnv(env, dir) {
  env.HOME = dir;
  env.USERPROFILE = dir;
  if (process.platform === "win32") {
    const parsed = path.parse(path.resolve(dir));
    if (parsed.root) {
      env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
      env.HOMEPATH = path.resolve(dir).slice(parsed.root.length - 1);
    }
  }
  return env;
}

/** Environment / argv overlay used when launching a CLI inside an isolated profile. */
export function buildProfileLaunchOverlay(engineId, profileDir = "") {
  const dir = String(profileDir || "").trim();
  if (!dir) return { env: {}, extraArgs: [] };
  if (engineId === "codex") return { env: { CODEX_HOME: dir }, extraArgs: [] };
  if (engineId === "deepseek-harness") return { env: { DSH_HOME: dir }, extraArgs: [] };
  if (engineId === "qoder" || engineId === "qoder-cn") return { env: {}, extraArgs: ["--config-dir", dir] };
  if (engineId === "opencode") return { env: { XDG_CONFIG_HOME: dir }, extraArgs: [] };
  if (engineId === "junie") {
    // Junie is a JVM app: HOME/USERPROFILE are ignored for user.home on Windows, and junie.bat
    // locates its installed versions through JUNIE_DATA, so both are redirected independently.
    const env = {
      JUNIE_DATA: path.join(os.homedir(), ".local", "share", "junie"),
      JAVA_TOOL_OPTIONS: "",
    };
    const existing = String(process.env.JAVA_TOOL_OPTIONS || "").trim();
    env.JAVA_TOOL_OPTIONS = existing ? `${existing} -Duser.home=${dir}` : `-Duser.home=${dir}`;
    return { env: applyHomeEnv(env, dir), extraArgs: [] };
  }
  if (engineId === "kiro") {
    // kiro-cli keeps its sqlite state under LOCALAPPDATA/APPDATA; both must resolve inside the
    // profile (and must already exist) or it aborts with "home directory not found".
    const env = {
      LOCALAPPDATA: path.join(dir, "AppData", "Local"),
      APPDATA: path.join(dir, "AppData", "Roaming"),
    };
    return { env: applyHomeEnv(env, dir), extraArgs: [] };
  }
  if (engineId === "codearts") {
    // CodeArts CLI is built on the opencode runtime, which honours the XDG base dirs.
    const env = {
      XDG_DATA_HOME: path.join(dir, "data"),
      XDG_CONFIG_HOME: path.join(dir, "config"),
      XDG_STATE_HOME: path.join(dir, "state"),
      XDG_CACHE_HOME: path.join(dir, "cache"),
    };
    return { env: applyHomeEnv(env, dir), extraArgs: [] };
  }
  if (engineId === "codebuddy" || engineId === "minimax") {
    return { env: applyHomeEnv({}, dir), extraArgs: [] };
  }
  return { env: {}, extraArgs: [] };
}

const CODEARTS_OPENCODE_SETTINGS = Object.freeze({
  security: { folderTrust: { enabled: false }, trustedFolders: [] },
});

/**
 * Headless CodeArts refuses to run in an untrusted folder. Seed an isolated profile's opencode
 * settings with folder trust disabled so non-interactive runs never fail with 文件夹未被信任.
 */
export function ensureCodeArtsProfileReady(profileDir = "") {
  const dir = String(profileDir || "").trim();
  if (!dir) return "";
  const settingsDir = path.join(dir, "data", "opencode");
  const settingsFile = path.join(settingsDir, "settings.json");
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    if (!fs.existsSync(settingsFile)) {
      fs.writeFileSync(settingsFile, JSON.stringify(CODEARTS_OPENCODE_SETTINGS, null, 2), "utf8");
    }
  } catch {}
  return settingsFile;
}

/** Create every writable directory a profile-isolated CLI needs before its first spawn. */
export function ensureProfileDirReady(engineId, profileDir = "") {
  const dir = String(profileDir || "").trim();
  const engine = String(engineId || "");
  if (!dir || !ISOLATED_ENGINES.includes(engine)) return { ok: false, skipped: true };
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (engine === "kiro") {
      fs.mkdirSync(path.join(dir, "AppData", "Local"), { recursive: true });
      fs.mkdirSync(path.join(dir, "AppData", "Roaming"), { recursive: true });
    } else if (engine === "codearts") {
      for (const sub of ["data", "config", "state", "cache"]) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
      }
      ensureCodeArtsProfileReady(dir);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function doubaoLoginRootDir() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "doubao_cli", "doubao-cli-pc-login");
  }
  return path.join(os.homedir(), ".doubao", "doubao-cli-pc-login");
}

function copyDirClean(src, dst) {
  if (!fs.existsSync(src)) return false;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  return true;
}

/**
 * Gracefully switch Doubao's single-service login directory using safe per-profile vault snapshots.
 * Never destroys the original "default" snapshot; stops the shared service cleanly before swapping.
 */
export async function swapDoubaoAccountVault({ dataDir, targetProfileId = "default", doubaoBin = null } = {}) {
  const cleanTarget = String(targetProfileId || "default").trim();
  if (!dataDir) return { ok: false, error: "dataDir is required" };
  if (cleanTarget !== "default" && !PROFILE_ID_RE.test(cleanTarget)) {
    return { ok: false, error: "Invalid CLI profile id" };
  }
  const vaultRoot = path.join(path.resolve(dataDir), "cli-profiles", "doubao");
  const activeMetaPath = path.join(vaultRoot, "active.json");
  const liveDir = doubaoLoginRootDir();
  fs.mkdirSync(vaultRoot, { recursive: true });

  let currentId = "default";
  try {
    if (fs.existsSync(activeMetaPath)) {
      const parsed = JSON.parse(fs.readFileSync(activeMetaPath, "utf8"));
      if (parsed?.activeProfileId) currentId = String(parsed.activeProfileId);
    }
  } catch {}

  const vaultFor = (pid) => path.join(vaultRoot, pid, "doubao-cli-pc-login");
  const defaultVault = vaultFor("default");
  // Always ensure the user's original login state is safely backed up under "default" first.
  if (currentId === "default" && fs.existsSync(liveDir) && !fs.existsSync(defaultVault)) {
    try {
      copyDirClean(liveDir, defaultVault);
    } catch {}
  }

  if (currentId === cleanTarget) {
    return { ok: true, swapped: false, activeProfileId: currentId };
  }

  // Graceful stop of Doubao's shared daemon so files are unlocked cleanly.
  const bin = doubaoBin || resolveCliPresetBinary({ command: "doubao", windowsPaths: ["%LOCALAPPDATA%\\doubao_cli\\app\\current\\doubao.exe"] });
  if (bin) {
    await runCli(bin, ["--service-stop"], 4000).catch(() => {});
  }

  // Save current live state back to current profile's vault (preserves refreshed tokens).
  if (fs.existsSync(liveDir)) {
    try {
      copyDirClean(liveDir, vaultFor(currentId));
    } catch (err) {
      return { ok: false, error: `Failed to snapshot current Doubao profile: ${err?.message || err}` };
    }
  }

  // Restore target profile's vault (or clear live dir so a brand-new profile can scan a fresh QR).
  const targetVault = vaultFor(cleanTarget);
  const rollbackDir = path.join(vaultRoot, ".rollback-tmp");
  try {
    if (fs.existsSync(liveDir)) copyDirClean(liveDir, rollbackDir);
    fs.rmSync(liveDir, { recursive: true, force: true });
    if (fs.existsSync(targetVault)) {
      copyDirClean(targetVault, liveDir);
    }
    fs.writeFileSync(activeMetaPath, JSON.stringify({ activeProfileId: cleanTarget, updatedAt: new Date().toISOString() }, null, 2), "utf8");
    fs.rmSync(rollbackDir, { recursive: true, force: true });
    clearCliAccountCache("doubao");
    return { ok: true, swapped: true, activeProfileId: cleanTarget, hasExistingSession: fs.existsSync(targetVault) };
  } catch (err) {
    try {
      if (fs.existsSync(rollbackDir)) {
        copyDirClean(rollbackDir, liveDir);
        fs.rmSync(rollbackDir, { recursive: true, force: true });
      }
    } catch {}
    return { ok: false, error: `Failed to switch Doubao profile: ${err?.message || err}` };
  }
}

function runCli(bin, args, timeoutMs = ACCOUNT_PROBE_TIMEOUT_MS, extraEnv = null) {
  return new Promise((resolve) => {
    if (!bin?.command) {
      resolve({ ok: false, stdout: "", stderr: "" });
      return;
    }
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const useShell = Boolean(bin.useShell) && process.platform === "win32";
    const command = useShell ? process.env.ComSpec || "cmd.exe" : bin.command;
    const execArgs = useShell
      ? ["/d", "/s", "/c", `"${[quote(bin.command), ...args.map(quote)].join(" ")}"`]
      : args;
    execFile(
      command,
      execArgs,
      {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
        ...(useShell ? { windowsVerbatimArguments: true } : {}),
        maxBuffer: 256 * 1024,
        shell: false,
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          stdout: String(stdout || ""),
          stderr: String(stderr || (err && err.message) || ""),
        });
      }
    );
  });
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return String(match[1]).trim().slice(0, 160);
  }
  return "";
}

function looksLoggedIn(text) {
  if (/(?:not\s+logged\s+in|logged\s+out|unauthenticated|no\s+active\s+session|未登录|未授权)/i.test(text)) {
    return false;
  }
  return /(?:logged\s+in|authenticated|active|已登录|登录成功)/i.test(text);
}

export function parseDoubaoAuthStatus(text) {
  const raw = String(text || "");
  const userId = firstMatch(raw, [
    /(?:user[_\s-]?id|uid|账号\s*ID|用户\s*ID)\s*[:=：]\s*["']?([A-Za-z0-9@._-]{2,120})/i,
    /"user[_\s-]?id"\s*:\s*"([^"]{2,120})"/i,
  ]);
  const email = firstMatch(raw, [/(?:email|e-mail|邮箱)\s*[:=：]\s*["']?([^"'\s]+@[^"'\s]+)/i]);
  const username = firstMatch(raw, [/(?:username|user\s*name|nickname|用户名|昵称)\s*[:=：]\s*["']?([^"'\r\n]{1,120})/i]);
  return {
    userId: userId || "",
    username: username || email.split("@")[0] || "",
    email,
    loginMethod: "doubao",
    loggedIn: Boolean(userId || username || email) || looksLoggedIn(raw),
  };
}

export function parseQoderStatus(text) {
  const raw = String(text || "");
  const username = firstMatch(raw, [
    /(?:username|user\s*name|用户名|账号)\s*[:=：]\s*([^\r\n]{1,120})/i,
    /"username"\s*:\s*"([^"]{1,120})"/i,
  ]);
  const email = firstMatch(raw, [
    /(?:email|e-mail|邮箱)\s*[:=：]\s*([^\s\r\n]{3,160})/i,
    /"email"\s*:\s*"([^"]{3,160})"/i,
  ]);
  const loginMethod = firstMatch(raw, [
    /(?:login\s*method|auth(?:entication)?\s*method|登录方式|认证方式)\s*[:=：]\s*([^\r\n]{1,80})/i,
    /"login[_\s-]?method"\s*:\s*"([^"]{1,80})"/i,
  ]);
  return {
    username,
    email,
    loginMethod,
    loggedIn: Boolean(username || email) || looksLoggedIn(raw),
  };
}

export function parseMiniMaxProviderList(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);
  const oauthLine = lines.find((line) => /minimax[_-]?oauth/i.test(line)) || "";
  const active =
    /(?:^|[\s|,[{])active(?:$|[\s|,\]}:])/i.test(oauthLine) ||
    /"active"\s*:\s*true/i.test(oauthLine) ||
    /minimax[_-]?oauth[^\r\n]{0,120}\b(?:active|enabled|已启用|生效)/i.test(raw);
  return {
    username: "",
    email: "",
    loginMethod: "minimax_oauth",
    loggedIn: active,
  };
}

/** Parse `junie list-models` JSON, tolerating the JVM log line printed before the payload. */
export function parseJunieListModels(text, engineId = "junie") {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  if (start < 0) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    const end = raw.lastIndexOf("}");
    try {
      parsed = end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
    } catch {
      return [];
    }
  }
  const list = Array.isArray(parsed?.models) ? parsed.models : Array.isArray(parsed) ? parsed : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rawId = typeof item.id === "string" ? item.id.trim() : "";
    if (!rawId || rawId.length > 160 || seen.has(rawId)) continue;
    seen.add(rawId);
    const displayName =
      typeof item.displayName === "string" && item.displayName.trim() ? item.displayName.trim().slice(0, 160) : rawId;
    out.push({
      id: `cli:${engineId}:${rawId}`,
      modelName: rawId,
      displayName,
      displayNameZh: displayName,
      isDefault: false,
      engine: engineId,
    });
  }
  return out;
}

/** Parse `kiro-cli whoami --format json`; only identity fields are whitelisted out. */
export function parseKiroWhoami(text) {
  const base = { username: "", email: "", loginMethod: "kiro", loggedIn: false, detail: "" };
  const raw = String(text || "");
  const start = raw.indexOf("{");
  if (start < 0) return base;
  let parsed = null;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch {
    const end = raw.lastIndexOf("}");
    try {
      parsed = end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
    } catch {
      return base;
    }
  }
  const account = parsed?.account ?? parsed?.identity ?? parsed?.user ?? null;
  if (!account || typeof account !== "object" || Array.isArray(account)) return base;
  const pick = (...keys) => {
    for (const key of keys) {
      const value = account[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
    }
    return "";
  };
  const email = pick("emailAddress", "email", "mail");
  const username = pick("userName", "username", "displayName", "name", "nickname");
  const label = pick("accountName", "organizationName", "organization", "accountLabel");
  const hasIdentity = Object.values(account).some((value) => typeof value === "string" && value.trim());
  if (!hasIdentity) return base;
  return {
    username: username || email.split("@")[0] || label,
    email,
    loginMethod: "kiro",
    loggedIn: true,
    detail: label ? `account: ${label}` : "",
  };
}

function probeCodexConfig(profileDir) {
  if (!profileDir) {
    const summary = readCodexConfigSummary();
    return {
      username: "",
      email: "",
      loginMethod: "codex",
      loggedIn: Boolean(summary.hasAuth),
      detail: summary.defaultModel ? `model: ${summary.defaultModel}` : "",
    };
  }
  let hasAuth = false;
  let defaultModel = "";
  try {
    const authPath = path.join(profileDir, "auth.json");
    hasAuth = fs.existsSync(authPath) && fs.statSync(authPath).size > 20;
  } catch {}
  try {
    const configPath = path.join(profileDir, "config.toml");
    if (fs.existsSync(configPath)) {
      const text = fs.readFileSync(configPath, "utf8");
      const match = text.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      if (match) defaultModel = match[1];
    }
  } catch {}
  return {
    username: "",
    email: "",
    loginMethod: "codex",
    loggedIn: hasAuth,
    detail: defaultModel ? `model: ${defaultModel}` : "",
  };
}

function opencodeConfigRoots(profileDir) {
  if (profileDir) return [profileDir, path.join(profileDir, "opencode")];
  const roots = [];
  if (process.env.XDG_CONFIG_HOME) roots.push(path.join(process.env.XDG_CONFIG_HOME, "opencode"));
  roots.push(path.join(os.homedir(), ".config", "opencode"));
  roots.push(path.join(os.homedir(), ".local", "share", "opencode"));
  if (process.platform === "win32" && process.env.APPDATA) {
    roots.push(path.join(process.env.APPDATA, "opencode"));
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, "ai.opencode.desktop"));
  }
  return [...new Set(roots)];
}

function probeOpencodeConfig(profileDir) {
  for (const root of opencodeConfigRoots(profileDir)) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root);
      const hasAuth = entries.some((name) => /^(?:auth\.json|credentials\.json)$/i.test(name));
      const hasConfig = entries.some((name) => /^(?:opencode\.json|config\.json|storage|db|opencode\.db)$/i.test(name));
      if (hasAuth || hasConfig || entries.length > 0) {
        return {
          username: hasAuth ? "OpenCode 账号" : "本机桌面配置",
          email: "",
          loginMethod: hasAuth ? "opencode" : "local config",
          loggedIn: true,
          detail: hasConfig ? "local config found" : "",
        };
      }
    } catch {}
  }
  return { username: "", email: "", loginMethod: "opencode", loggedIn: false, detail: "" };
}

function probeDshAccount(profileDir = "") {
  const dshRoot = profileDir ? path.resolve(profileDir) : path.join(os.homedir(), ".dsh");
  const credCandidates = [
    path.join(dshRoot, ".credentials.yaml"),
    path.join(dshRoot, "credentials.yaml"),
  ];
  let hasCred = false;
  for (const file of credCandidates) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 10) {
        hasCred = true;
        break;
      }
    } catch {}
  }
  return {
    username: hasCred ? "DeepSeek 官方账号" : "",
    email: "",
    loginMethod: "DeepSeek Account",
    loggedIn: hasCred,
    detail: hasCred ? (profileDir ? "isolated DSH_HOME" : "~/.dsh/.credentials.yaml") : "",
  };
}

function probeCodebuddyAccount(profileDir = "") {
  const root = profileDir ? path.join(path.resolve(profileDir), ".codebuddy") : path.join(os.homedir(), ".codebuddy");
  try {
    if (fs.existsSync(root)) {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const hasAuthFile = entries.some((ent) => {
        if (!ent.isFile()) return false;
        if (!/^(?:auth|credentials?|tokens?|account)\.(?:json|ya?ml|toml)$/i.test(ent.name)) return false;
        try {
          return fs.statSync(path.join(root, ent.name)).size > 20;
        } catch {
          return false;
        }
      });
      const localStorageDir = path.join(root, "local_storage");
      let hasLocalStorageAuth = false;
      try {
        if (fs.existsSync(localStorageDir)) {
          const lsFiles = fs.readdirSync(localStorageDir, { withFileTypes: true });
          hasLocalStorageAuth = lsFiles.some((ent) => {
            if (!ent.isFile()) return false;
            try {
              return fs.statSync(path.join(localStorageDir, ent.name)).size > 20;
            } catch {
              return false;
            }
          });
        }
      } catch {}
      if (hasAuthFile || hasLocalStorageAuth) {
        return {
          username: "CodeBuddy 本地登录态",
          email: "",
          loginMethod: "codebuddy",
          loggedIn: true,
          detail: "~/.codebuddy",
        };
      }
    }
  } catch {}
  return { username: "", email: "", loginMethod: "codebuddy", loggedIn: false, detail: "" };
}

function probeMiniMaxAccount(profileDir = "") {
  const home = profileDir ? path.resolve(profileDir) : os.homedir();
  const candidates = [
    { region: "cn", file: path.join(home, ".minimax", "auth", "prod", "cn", "mcode-public", "auth.json") },
    { region: "global", file: path.join(home, ".minimax", "auth", "prod", "en", "mcode-public", "auth.json") },
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c.file) && fs.statSync(c.file).size > 20) {
        return {
          username: c.region === "cn" ? "MiniMax CN OAuth" : "MiniMax Global OAuth",
          email: "",
          loginMethod: "minimax_oauth",
          loggedIn: true,
          detail: c.region,
        };
      }
    } catch {}
  }
  return { username: "", email: "", loginMethod: "minimax_oauth", loggedIn: false, detail: "" };
}

function readJsonQuiet(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Extract identity fields from an arbitrary credential blob without ever surfacing the secret. */
function identityFromBlob(blob) {
  const out = { email: "", username: "" };
  const visit = (node, keyPath, depth) => {
    if (depth > 3 || !node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const pathKey = `${keyPath}.${key}`.toLowerCase();
      if (typeof value === "string") {
        if (/email/.test(key) && /@/.test(value) && !out.email) out.email = value.trim().slice(0, 160);
        else if (/(username|user_?name|account_?name|display_?name|nickname|login)/.test(pathKey) && value.trim() && !out.username) {
          out.username = value.trim().slice(0, 160);
        }
      } else if (value && typeof value === "object") {
        visit(value, pathKey, depth + 1);
      }
    }
  };
  visit(blob, "", 0);
  return out;
}

const JUNIE_SKIP_DIRS = new Set(["logs", "versions", "instances", "sessions", "acp-prompt-attachments"]);
const JUNIE_CRED_RE = /(?:auth|credentials?|tokens?|account|oauth|license|login|session)/i;

function probeJunieAccount(profileDir = "") {
  const base = { username: "", email: "", loginMethod: "jetbrains-account", loggedIn: false, detail: "" };
  if (String(process.env.JUNIE_API_KEY || "").trim() || String(process.env.JUNIE_AUTH_TOKEN || "").trim()) {
    return { ...base, username: "JetBrains API Key", loggedIn: true, detail: "JUNIE_API_KEY" };
  }
  const home = profileDir ? path.resolve(profileDir) : os.homedir();
  const root = path.join(home, ".junie");
  if (!fs.existsSync(root)) return base;

  let hasCred = false;
  let email = "";
  let username = "";
  const noteBlob = (blob) => {
    const identity = identityFromBlob(blob);
    if (!email && identity.email) email = identity.email;
    if (!username && identity.username) username = identity.username;
  };
  const visit = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < 2 && !JUNIE_SKIP_DIRS.has(ent.name)) visit(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      if (size <= 10) continue;
      if (/^settings.*\.json$/i.test(ent.name)) {
        // Settings are only credentials when they actually carry auth/token/account fields.
        const blob = readJsonQuiet(full);
        if (blob && typeof blob === "object") {
          const json = JSON.stringify(blob).toLowerCase();
          if (/"(?:[a-z0-9_-]*(?:auth|token|credential|account|email|license)[a-z0-9_-]*)"\s*:/.test(json)) {
            hasCred = true;
            noteBlob(blob);
          }
        }
        continue;
      }
      if (!JUNIE_CRED_RE.test(ent.name)) continue;
      hasCred = true;
      if (/\.json$/i.test(ent.name)) noteBlob(readJsonQuiet(full));
    }
  };
  visit(root, 0);

  if (!hasCred) return base;
  return {
    ...base,
    username: username || email.split("@")[0] || "JetBrains 账号",
    email,
    loggedIn: true,
    detail: profileDir ? "isolated HOME" : "~/.junie",
  };
}

async function probeKiroAccount(def, profileDir, overlay) {
  const base = { username: "", email: "", loginMethod: "kiro", loggedIn: false, detail: "" };
  const bin = resolveCliPresetBinary(def || { command: "kiro-cli" });
  if (!bin) return { ...base, detail: "CLI not installed" };
  if (profileDir) ensureProfileDirReady("kiro", profileDir);
  const result = await runCli(bin, ["whoami", "--format", "json"], ACCOUNT_PROBE_TIMEOUT_MS, overlay?.env || null);
  return parseKiroWhoami(`${result.stdout}\n${result.stderr}`);
}

function probeCodeArtsAccount(profileDir = "") {
  const base = { username: "", email: "", loginMethod: "codearts", loggedIn: false, detail: "" };
  const hasAk = String(process.env.CODEARTS_CLI_AK || "").trim();
  const hasSk = String(process.env.CODEARTS_CLI_SK || "").trim();
  if (hasAk && hasSk) {
    return { ...base, username: "华为云 AK/SK", loginMethod: "huawei_aksk", loggedIn: true, detail: "CODEARTS_CLI_AK" };
  }
  const xdgData = profileDir
    ? path.join(path.resolve(profileDir), "data")
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const authFile = path.join(xdgData, "opencode", "auth.json");
  let hasAuth = false;
  try {
    if (fs.existsSync(authFile) && fs.statSync(authFile).size > 10) {
      const parsed = readJsonQuiet(authFile);
      hasAuth = Boolean(parsed && typeof parsed === "object" && Object.keys(parsed).length > 0);
    }
  } catch {}
  if (!hasAuth) return base;
  return {
    ...base,
    username: "华为云 CodeArts",
    loggedIn: true,
    detail: profileDir ? "isolated XDG_DATA_HOME" : "~/.local/share/opencode/auth.json",
  };
}

async function probeAccount(engineId, def, profileDir) {
  const base = {
    engineId,
    profileDir: profileDir || "",
    username: "",
    email: "",
    loginMethod: "",
    loggedIn: false,
    detail: "",
  };
  const overlay = buildProfileLaunchOverlay(engineId, profileDir);
  // Probes that run a CLI inside an isolated profile need its writable dirs to exist first.
  if (profileDir) ensureProfileDirReady(engineId, profileDir);
  if (engineId === "codex") return { ...base, ...probeCodexConfig(profileDir) };
  if (engineId === "deepseek-harness") return { ...base, ...probeDshAccount(profileDir) };
  if (engineId === "codebuddy") return { ...base, ...probeCodebuddyAccount(profileDir) };
  if (engineId === "minimax") return { ...base, ...probeMiniMaxAccount(profileDir) };
  if (engineId === "opencode") return { ...base, ...probeOpencodeConfig(profileDir) };
  if (engineId === "junie") return { ...base, ...probeJunieAccount(profileDir) };
  if (engineId === "kiro") return { ...base, ...(await probeKiroAccount(def, profileDir, overlay)) };
  if (engineId === "codearts") return { ...base, ...probeCodeArtsAccount(profileDir) };

  if (engineId === "doubao" || engineId === "qoder" || engineId === "qoder-cn" || engineId === "minimax") {
    const fallbackCmd =
      engineId === "doubao" ? "doubao" : engineId === "qoder-cn" ? "qoderclicn" : engineId === "qoder" ? "qodercli" : "mcode";
    const bin = resolveCliPresetBinary(def || { command: fallbackCmd });
    if (!bin) return { ...base, loginMethod: engineId, detail: "CLI not installed" };
    let args;
    if (engineId === "doubao") args = ["auth", "status"];
    else if (engineId === "qoder" || engineId === "qoder-cn") args = [...overlay.extraArgs, "status"];
    else args = ["provider", "list"];
    const result = await runCli(bin, args);
    const text = `${result.stdout}\n${result.stderr}`;
    if (engineId === "doubao") return { ...base, ...parseDoubaoAuthStatus(text) };
    if (engineId === "qoder" || engineId === "qoder-cn") return { ...base, ...parseQoderStatus(text) };
    return { ...base, ...parseMiniMaxProviderList(text) };
  }

  return { ...base, detail: "Account probe not supported for this CLI" };
}

function cacheKey(engineId, profileDir) {
  return `${engineId || ""}::${profileDir || ""}`;
}

export function getCachedCliAccountInfo(engineId, profileDir = "") {
  const hit = accountCache.get(cacheKey(engineId, profileDir));
  if (!hit || Date.now() - hit.ts >= ACCOUNT_CACHE_TTL_MS) return null;
  return { ...hit.value, cached: true };
}

export function clearCliAccountCache(engineId = "") {
  if (!engineId) {
    accountCache.clear();
    return;
  }
  const prefix = `${engineId}::`;
  for (const key of accountCache.keys()) {
    if (key.startsWith(prefix)) accountCache.delete(key);
  }
}

/**
 * Read only non-sensitive account metadata. Raw CLI output, tokens and credentials never leave
 * this module; only parsed username/email/login-state fields are returned.
 */
export async function probeCliAccountInfo(engineId, def, profileDir = "") {
  const key = cacheKey(engineId, profileDir);
  const hit = accountCache.get(key);
  if (hit && Date.now() - hit.ts < ACCOUNT_CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  let parsed;
  try {
    parsed = await probeAccount(engineId, def, profileDir);
  } catch {
    parsed = {
      engineId,
      profileDir: profileDir || "",
      username: "",
      email: "",
      loginMethod: engineId,
      loggedIn: false,
      detail: "Probe failed",
    };
  }
  const value = {
    ...parsed,
    status: parsed.loggedIn ? "ready" : "logged_out",
    accountLabel: parsed.username || parsed.email || (parsed.loggedIn ? "已登录" : "未登录"),
    checkedAt: new Date().toISOString(),
    cached: false,
  };
  accountCache.set(key, { ts: Date.now(), value });
  return value;
}
