import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCodexConfigSummary, resolveCliPresetBinary } from "./paths.mjs";

const ACCOUNT_CACHE_TTL_MS = 60_000;
const ACCOUNT_PROBE_TIMEOUT_MS = 8_000;
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const ENGINE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const ISOLATED_ENGINES = Object.freeze(["codex", "qoder", "qoder-cn", "opencode"]);

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

/** Environment / argv overlay used when launching a CLI inside an isolated profile. */
export function buildProfileLaunchOverlay(engineId, profileDir = "") {
  const dir = String(profileDir || "").trim();
  if (!dir) return { env: {}, extraArgs: [] };
  if (engineId === "codex") return { env: { CODEX_HOME: dir }, extraArgs: [] };
  if (engineId === "qoder" || engineId === "qoder-cn") return { env: {}, extraArgs: ["--config-dir", dir] };
  if (engineId === "opencode") return { env: { XDG_CONFIG_HOME: dir }, extraArgs: [] };
  return { env: {}, extraArgs: [] };
}

function runCli(bin, args, timeoutMs = ACCOUNT_PROBE_TIMEOUT_MS) {
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

function probeDshAccount() {
  const home = os.homedir();
  const credCandidates = [
    path.join(home, ".dsh", ".credentials.yaml"),
    path.join(home, ".dsh", "credentials.yaml"),
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
    detail: hasCred ? "~/.dsh/.credentials.yaml" : "",
  };
}

function probeCodebuddyAccount() {
  const root = path.join(os.homedir(), ".codebuddy");
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
  if (engineId === "codex") return { ...base, ...probeCodexConfig(profileDir) };
  if (engineId === "deepseek-harness") return { ...base, ...probeDshAccount() };
  if (engineId === "codebuddy") return { ...base, ...probeCodebuddyAccount() };
  if (engineId === "opencode") return { ...base, ...probeOpencodeConfig(profileDir) };

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
