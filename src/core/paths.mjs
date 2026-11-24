import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_ENGINES_META } from "./constants.mjs";

const isWin = process.platform === "win32";

let detectionCache = { ts: 0, data: null };
const DETECTION_TTL_MS = 60_000;

function runQuick(cmd, args, timeoutMs = 4000) {
  try {
    const out = execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout: (out || "").trim() };
  } catch (err) {
    return {
      ok: false,
      stdout: (err?.stdout || "").toString().trim(),
      stderr: (err?.stderr || "").toString().trim(),
    };
  }
}

export function resolveCodexBinary() {
  if (isWin) {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const candidates = [
      path.join(
        appData,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      ),
      path.join(
        appData,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      ),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { command: c, useShell: false };
    }
  }
  return resolveGenericBinary("codex");
}

export function resolveGenericBinary(name) {
  const finder = isWin ? "where.exe" : "which";
  const res = runQuick(finder, [name], 3000);
  if (!res.ok || !res.stdout) return null;
  const lines = res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  if (isWin) {
    const exe = lines.find((l) => /\.exe$/i.test(l));
    if (exe) return { command: exe, useShell: false };
    const cmd = lines.find((l) => /\.(cmd|bat)$/i.test(l));
    if (cmd) return { command: cmd, useShell: true };
  }
  return { command: lines[0], useShell: false };
}

export function readCodexConfigSummary() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const configPath = path.join(codexHome, "config.toml");
  const authPath = path.join(codexHome, "auth.json");
  const summary = {
    codexHome,
    hasAuth: false,
    defaultModel: "",
  };
  try {
    if (fs.existsSync(authPath) && fs.statSync(authPath).size > 20) {
      summary.hasAuth = true;
    }
  } catch {}
  try {
    if (fs.existsSync(configPath)) {
      const text = fs.readFileSync(configPath, "utf8");
      const m = text.match(/^\s*model\s*=\s*["']([^"']+)["']/m);
      if (m) summary.defaultModel = m[1];
    }
  } catch {}
  return summary;
}

function hasClaudeAuth() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const home = os.homedir();
  const candidates = [
    path.join(home, ".claude", ".credentials.json"),
    path.join(home, ".claude", "credentials.json"),
    path.join(home, ".claude.json"),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 20;
    } catch {
      return false;
    }
  });
}

function hasAgyAuth() {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".gemini", "antigravity-cli", "settings.json"),
    path.join(home, ".gemini", "config", "config.json"),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).size > 10;
    } catch {
      return false;
    }
  });
}

function isNodeVersionAtLeast(verStr, minMajor = 24, minMinor = 9) {
  const m = String(verStr || "").trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const maj = Number(m[1]);
  const min = Number(m[2]);
  return maj > minMajor || (maj === minMajor && min >= minMinor);
}

export function resolveDshBinary(dataDir = "") {
  const dshBin = resolveGenericBinary("dsh");
  const binJsCandidates = [];
  if (dshBin?.command) {
    const dir = path.dirname(dshBin.command);
    binJsCandidates.push(
      path.join(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
      path.resolve(dir, "..", "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
    );
  }
  if (isWin) {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    binJsCandidates.push(path.join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"));
  }
  const binJs = binJsCandidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || "";

  if (!dshBin && !binJs) return null;

  if (isNodeVersionAtLeast(process.versions?.node, 24, 9)) {
    if (binJs) {
      return { command: process.execPath, prefixArgs: [binJs], useShell: false, binJs, nodeTooOld: false };
    }
    return { command: dshBin.command, prefixArgs: [], useShell: dshBin.useShell, binJs, nodeTooOld: false };
  }

  // System Node < 24.9: check user-specified AGENT_RELAY_DSH_NODE or opt-in portable Node 24 runtime
  const nodeRel = isWin ? path.join("runtime", "node24", "node.exe") : path.join("runtime", "node24", "bin", "node");
  const nodeCandidates = [
    process.env.AGENT_RELAY_DSH_NODE || "",
    dataDir ? path.join(dataDir, nodeRel) : "",
    path.join(os.homedir(), ".gemini", "antigravity", "plugin_data", "agent-relay", nodeRel),
  ].filter(Boolean);

  if (binJs) {
    for (const nodeExe of nodeCandidates) {
      try {
        if (fs.existsSync(nodeExe)) {
          return {
            command: nodeExe,
            prefixArgs: [binJs],
            useShell: false,
            binJs,
            nodeTooOld: false,
            runtimeNote: nodeExe === process.env.AGENT_RELAY_DSH_NODE ? "env-node24" : "bundled-node24",
          };
        }
      } catch {}
    }
  }

  return {
    command: dshBin ? dshBin.command : process.execPath,
    prefixArgs: dshBin ? [] : [binJs],
    useShell: dshBin ? dshBin.useShell : false,
    binJs,
    nodeTooOld: true,
    currentNode: process.version,
    requiredNode: ">=24.9.0",
  };
}

function probeVersion(binInfo) {
  if (!binInfo) return "";
  try {
    const out = execFileSync(binInfo.command, [...(binInfo.prefixArgs || []), "--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      shell: binInfo.useShell,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const firstLine = (out || "").trim().split(/\r?\n/)[0] || "";
    return firstLine.slice(0, 80);
  } catch {
    return "";
  }
}

export function detectEngines(force = false, dataDir = "") {
  const now = Date.now();
  if (!force && detectionCache.data && now - detectionCache.ts < DETECTION_TTL_MS) {
    return detectionCache.data;
  }

  const codexBin = resolveCodexBinary();
  const codexMeta = readCodexConfigSummary();
  const claudeBin = resolveGenericBinary("claude");
  const agyBin = resolveGenericBinary("agy");
  const dshBin = resolveDshBinary(dataDir);
  const dshVersion = dshBin && !dshBin.nodeTooOld ? probeVersion(dshBin) : "";
  const dshReady = Boolean(dshBin && !dshBin.nodeTooOld && dshVersion);

  const result = {
    codex: {
      ...CLI_ENGINES_META.codex,
      installed: Boolean(codexBin),
      loggedIn: Boolean(codexBin && (codexMeta.hasAuth || process.env.OPENAI_API_KEY)),
      status: !codexBin ? "missing" : codexMeta.hasAuth || process.env.OPENAI_API_KEY ? "ready" : "unauthenticated",
      version: probeVersion(codexBin),
      detectedModel: codexMeta.defaultModel || "gpt-6.2-sol",
      binaryPath: codexBin?.command || "",
    },
    "claude-code": {
      ...CLI_ENGINES_META["claude-code"],
      installed: Boolean(claudeBin),
      loggedIn: Boolean(claudeBin && hasClaudeAuth()),
      status: !claudeBin ? "missing" : hasClaudeAuth() ? "ready" : "unauthenticated",
      version: probeVersion(claudeBin),
      detectedModel: "",
      binaryPath: claudeBin?.command || "",
    },
    antigravity: {
      ...CLI_ENGINES_META.antigravity,
      installed: Boolean(agyBin),
      loggedIn: Boolean(agyBin && hasAgyAuth()),
      status: !agyBin ? "missing" : hasAgyAuth() ? "ready" : "unauthenticated",
      version: probeVersion(agyBin),
      detectedModel: "",
      binaryPath: agyBin?.command || "",
    },
    "deepseek-harness": {
      ...CLI_ENGINES_META["deepseek-harness"],
      installed: Boolean(dshBin),
      loggedIn: dshReady,
      status: !dshBin ? "missing" : dshBin.nodeTooOld ? "node_too_old" : dshReady ? "ready" : "unauthenticated",
      version: dshVersion,
      currentNode: dshBin?.nodeTooOld ? process.version : "",
      requiredNode: dshBin?.nodeTooOld ? ">=24.9.0" : "",
      detectedModel: "",
      binaryPath: dshBin?.binJs || dshBin?.command || "",
    },
  };

  detectionCache = { ts: now, data: result };
  return result;
}

export function readDshConfigModels() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  try {
    if (!fs.existsSync(dshHome)) return [];
  } catch {
    return [];
  }

  const unquote = (s) => {
    const t = String(s || "").trim();
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return t.slice(1, -1);
    }
    return t.replace(/\s+#.*$/, "").trim();
  };

  // Best-effort read-only credentials lookup
  const credMap = {};
  for (const fname of [".credentials.yaml", ".credentials.yml", "credentials.yaml", "credentials.json"]) {
    const fp = path.join(dshHome, fname);
    try {
      if (!fs.existsSync(fp)) continue;
      const raw = fs.readFileSync(fp, "utf8");
      if (fname.endsWith(".json")) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") credMap[k] = v;
            else if (v && typeof v === "object") {
              const keyVal = v.api_key || v.apiKey || v.key || v.token || "";
              if (typeof keyVal === "string" && keyVal) credMap[k] = keyVal;
              if (k === "providers" || k === "keys") {
                for (const [pk, pv] of Object.entries(v)) {
                  if (typeof pv === "string") credMap[pk] = pv;
                  else if (pv && typeof pv === "object") {
                    const pkv = pv.api_key || pv.apiKey || pv.key || pv.token || "";
                    if (typeof pkv === "string" && pkv) credMap[pk] = pkv;
                  }
                }
              }
            }
          }
        }
      } else {
        let curSection = "";
        for (const line of raw.split(/\r?\n/)) {
          if (!line.trim() || line.trim().startsWith("#")) continue;
          const indent = line.match(/^(\s*)/)[1].length;
          const kv = line.trim().match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
          if (!kv) continue;
          const [, key, valRaw] = kv;
          const val = unquote(valRaw);
          if (!val) {
            curSection = key;
          } else if (["api_key", "apiKey", "key", "token"].includes(key) && curSection) {
            credMap[curSection] = val;
          } else if (indent === 0 || key.includes("_")) {
            credMap[key] = val;
          } else if (curSection && !["providers", "credentials", "keys"].includes(curSection)) {
            credMap[curSection] = credMap[curSection] || val;
          } else {
            credMap[key] = val;
          }
        }
      }
    } catch {}
  }

  const providersMap = {};
  const configCandidates = [
    path.join(dshHome, "profiles", "acp", "cordis.patch.yml"),
    path.join(dshHome, "profiles", "web", "cordis.patch.yml"),
    path.join(dshHome, "settings.json"),
    path.join(dshHome, "settings.yaml"),
    path.join(dshHome, "settings.yml"),
  ];
  for (const fp of configCandidates) {
    try {
      if (!fs.existsSync(fp)) continue;
      const raw = fs.readFileSync(fp, "utf8");
      if (fp.endsWith(".json")) {
        const parsed = JSON.parse(raw);
        const provs = parsed?.providers;
        if (Array.isArray(provs)) {
          for (const p of provs) {
            const pk = p?.id || p?.name;
            if (pk) providersMap[pk] = p;
          }
        } else if (provs && typeof provs === "object") {
          Object.assign(providersMap, provs);
        }
      } else {
        const lines = raw.split(/\r?\n/);
        let inProviders = false;
        let providersIndent = -1;
        let curProvKey = "";
        let curProvIndent = -1;
        let inModels = false;
        let modelsIndent = -1;
        let curModel = null;

        for (const line of lines) {
          if (!line.trim() || line.trim().startsWith("#")) continue;
          const indent = line.match(/^(\s*)/)[1].length;
          const trimmed = line.trim();

          if (/^providers\s*:\s*$/.test(trimmed)) {
            inProviders = true;
            providersIndent = indent;
            curProvKey = "";
            inModels = false;
            continue;
          }
          if (!inProviders) continue;
          if (indent <= providersIndent) {
            inProviders = false;
            inModels = false;
            curProvKey = "";
            continue;
          }

          if (curProvKey && indent <= curProvIndent && !trimmed.startsWith("-")) {
            curProvKey = "";
            inModels = false;
          }

          if (!curProvKey || (indent > providersIndent && indent <= (curProvIndent === -1 ? indent : curProvIndent))) {
            const pm = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
            if (pm && !pm[2]) {
              curProvKey = pm[1];
              curProvIndent = indent;
              inModels = false;
              curModel = null;
              providersMap[curProvKey] = providersMap[curProvKey] || { models: [] };
              continue;
            }
          }

          if (!curProvKey) continue;
          const pObj = providersMap[curProvKey];

          if (/^models\s*:\s*$/.test(trimmed)) {
            inModels = true;
            modelsIndent = indent;
            curModel = null;
            pObj.models = pObj.models || [];
            continue;
          }

          if (inModels && indent >= modelsIndent) {
            if (trimmed.startsWith("-")) {
              const afterDash = trimmed.slice(1).trim();
              const subKv = afterDash.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
              if (subKv) {
                curModel = { [subKv[1]]: unquote(subKv[2]) };
                pObj.models.push(curModel);
              } else if (afterDash) {
                curModel = { id: unquote(afterDash) };
                pObj.models.push(curModel);
              }
              continue;
            }
            const mkv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
            if (mkv && curModel) {
              curModel[mkv[1]] = unquote(mkv[2]);
              continue;
            }
          } else {
            inModels = false;
          }

          const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
          if (kv) {
            pObj[kv[1]] = unquote(kv[2]);
          }
        }
      }
      if (Object.keys(providersMap).length > 0) break;
    } catch {}
  }

  const out = [];
  const seenIds = new Set();
  for (const [providerKey, pObj] of Object.entries(providersMap)) {
    if (!pObj || typeof pObj !== "object") continue;
    const provDisplay = String(pObj.displayName || pObj.name || providerKey).trim();
    let baseUrl = String(pObj.baseURL || pObj.base_url || pObj.baseUrl || "").trim();
    if (!baseUrl && providerKey.toLowerCase().includes("deepseek")) {
      baseUrl = "https://api.deepseek.com/v1";
    }
    const apiKey = String(
      pObj.api_key ||
        pObj.apiKey ||
        pObj.key ||
        credMap[providerKey] ||
        credMap[`${providerKey}_api_key`] ||
        (providerKey.toLowerCase().includes("deepseek") ? process.env.DEEPSEEK_API_KEY : "") ||
        process.env.OPENAI_API_KEY ||
        ""
    ).trim();

    const list = Array.isArray(pObj.models) ? pObj.models : [];
    for (const item of list) {
      const modelId =
        typeof item === "string" ? item.trim() : String(item?.id || item?.model || item?.name || "").trim();
      if (!modelId) continue;
      const fullId = `dsh:${providerKey}:${modelId}`;
      if (seenIds.has(fullId)) continue;
      seenIds.add(fullId);
      const itemLabel = typeof item === "object" && item?.name && item.name !== modelId ? String(item.name).trim() : "";
      out.push({
        id: fullId,
        name: itemLabel || `${provDisplay}: ${modelId}`,
        mode: "api",
        engine: "deepseek-harness",
        providerId: providerKey,
        baseUrl,
        modelName: modelId,
        source: "dsh",
        readonly: true,
        apiKey,
      });
    }
  }
  return out;
}

export function normalizeWorkspaceKey(cwd) {
  const resolved = path.resolve(cwd || process.cwd());
  return isWin ? resolved.toLowerCase() : resolved;
}
