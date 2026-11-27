/**
 * Declarative registry for externally-installed coding CLIs. Nothing here launches a process.
 */
export const BUILTIN_CLI_ENGINE_IDS = Object.freeze(["codex", "deepseek-harness", "claude-code", "antigravity"]);
const BUILTIN_ID_SET = new Set(BUILTIN_CLI_ENGINE_IDS);
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;
export const MAX_CUSTOM_ENGINES = 20;

const ACP_CAPS = { streaming: true, models: true, sessions: true, tools: true, permissions: true };
const HEADLESS_CAPS = { streaming: true, models: false, sessions: false, tools: false, permissions: false };

export const EXTENSIBLE_CLI_PRESETS = Object.freeze([
  {
    id: "opencode", labelZh: "OpenCode", labelEn: "OpenCode", shortTag: "OC",
    protocol: "acp", command: "opencode", args: ["acp"],
    windowsPaths: ["%LOCALAPPDATA%\\Programs\\ai.opencode.desktop\\resources\\opencode-cli.exe"],
    installCmd: "npm install -g opencode-ai", loginCmd: "opencode auth login", downloadUrl: "https://opencode.ai",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "qoder", labelZh: "Qoder CLI", labelEn: "Qoder CLI", shortTag: "QD",
    protocol: "headless", command: "qodercli", args: ["-p", "{prompt}"], windowsPaths: [],
    installCmd: "npm install -g @qoder-ai/qodercli --allow-scripts=@qoder-ai/qodercli,sharp", loginCmd: "qodercli login", downloadUrl: "https://qoder.com",
    readOnlyMode: "", writeMode: "", capabilities: HEADLESS_CAPS,
  },
  {
    id: "minimax", labelZh: "MiniMax Code", labelEn: "MiniMax Code", shortTag: "MM",
    protocol: "acp", command: "mcode", args: ["acp"], windowsPaths: [],
    installCmd: "npm install -g @minimax-ai/code@latest --allow-scripts=@minimax-ai/code,better-sqlite3", loginCmd: "mcode login", downloadUrl: "https://www.minimax.io",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "kimi", labelZh: "Kimi Code CLI", labelEn: "Kimi Code CLI", shortTag: "KM",
    protocol: "acp", command: "kimi", args: ["acp"], windowsPaths: [],
    installCmd: "uv tool install kimi-cli", loginCmd: "kimi login", downloadUrl: "https://github.com/MoonshotAI/kimi-cli",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "codebuddy", labelZh: "CodeBuddy CLI", labelEn: "CodeBuddy CLI", shortTag: "CB",
    protocol: "acp", command: "codebuddy", args: ["--acp"], windowsPaths: [],
    installCmd: "npm install -g @tencent-ai/codebuddy-code", loginCmd: "codebuddy login", downloadUrl: "https://www.codebuddy.ai",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "qwen", labelZh: "Qwen Code", labelEn: "Qwen Code", shortTag: "QW",
    protocol: "acp", command: "qwen", args: ["--acp"], windowsPaths: [],
    installCmd: "npm install -g @qwen-code/qwen-code", loginCmd: "qwen", downloadUrl: "https://github.com/QwenLM/qwen-code",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "gemini", labelZh: "Gemini CLI", labelEn: "Gemini CLI", shortTag: "GM",
    protocol: "acp", command: "gemini", args: ["--acp"], windowsPaths: [],
    installCmd: "npm install -g @google/gemini-cli", loginCmd: "gemini", downloadUrl: "https://github.com/google-gemini/gemini-cli",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "cursor-cli", labelZh: "Cursor CLI", labelEn: "Cursor CLI", shortTag: "CU",
    protocol: "acp", command: "cursor-agent", args: ["acp"], windowsPaths: [],
    installCmd: "irm 'https://cursor.com/install?win32=true' | iex", loginCmd: "cursor-agent login", downloadUrl: "https://cursor.com/cli",
    readOnlyMode: "plan", writeMode: "build", capabilities: ACP_CAPS,
  },
  {
    id: "doubao", labelZh: "豆包 CLI", labelEn: "Doubao CLI", shortTag: "DB",
    protocol: "acp", command: "doubao", args: ["acp", "serve"],
    windowsPaths: ["%LOCALAPPDATA%\\doubao_cli\\app\\current\\doubao.exe"],
    installCmd: "npm install -g @bytedance/doubao-cli --foreground-scripts", loginCmd: "doubao login --qr=png", downloadUrl: "https://www.doubao.com",
    readOnlyMode: "plan", writeMode: "auto", capabilities: ACP_CAPS,
  },
]);

const PRESET_ID_SET = new Set(EXTENSIBLE_CLI_PRESETS.map((p) => p.id));

function cleanText(value, max = 200) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

function cleanStringArray(value, maxItems = 32, maxLen = 500) {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const out = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > maxLen || item.includes("\u0000")) return null;
    out.push(item);
  }
  return out;
}

/** Validate a user-supplied descriptor. Returns { ok: true, engine } or { ok: false, error }. */
export function sanitizeCustomCliEngine(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Engine descriptor must be an object" };
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!CUSTOM_ID_RE.test(id)) return { ok: false, error: "id must match ^[a-z0-9][a-z0-9_-]{1,31}$" };
  if (BUILTIN_ID_SET.has(id) || PRESET_ID_SET.has(id)) return { ok: false, error: `id "${id}" is reserved by a built-in engine or preset` };
  const name = cleanText(input.name, 60);
  if (!name) return { ok: false, error: "name is required" };
  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!command || command.length > 400) return { ok: false, error: "command is required" };
  if (/[\r\n;]/.test(command)) return { ok: false, error: "command must not contain newlines or semicolons" };
  if (command.includes("\u0000")) return { ok: false, error: "command contains an invalid character" };
  const args = cleanStringArray(input.args === undefined ? [] : input.args, 32, 500);
  if (!args) return { ok: false, error: "args must be an array of strings (max 32)" };
  const protocol = input.protocol === "acp" || input.protocol === "headless" ? input.protocol : "";
  if (!protocol) return { ok: false, error: "protocol must be 'acp' or 'headless'" };
  const windowsPaths = cleanStringArray(input.windowsPaths === undefined ? [] : input.windowsPaths, 8, 400);
  if (!windowsPaths) return { ok: false, error: "windowsPaths must be an array of strings" };
  let capabilities = {};
  if (input.capabilities && typeof input.capabilities === "object" && !Array.isArray(input.capabilities)) {
    try {
      const json = JSON.stringify(input.capabilities);
      if (json.length <= 2000) capabilities = JSON.parse(json);
    } catch {}
  }
  return {
    ok: true,
    engine: {
      id, name,
      labelZh: cleanText(input.labelZh, 60) || name,
      labelEn: cleanText(input.labelEn, 60) || name,
      shortTag: cleanText(input.shortTag, 8) || name.slice(0, 2).toUpperCase(),
      protocol, command, args, windowsPaths,
      installCmd: cleanText(input.installCmd, 400),
      loginCmd: cleanText(input.loginCmd, 400),
      downloadUrl: cleanText(input.downloadUrl, 400),
      readOnlyMode: cleanText(input.readOnlyMode, 40),
      writeMode: cleanText(input.writeMode, 40),
      capabilities, custom: true, extensible: true,
    },
  };
}

/** Presets first, then valid custom engines (deduplicated; invalid entries dropped). */
export function listAllExtensibleCliDefs(customList = []) {
  const defs = EXTENSIBLE_CLI_PRESETS.map((preset) => ({ ...preset, custom: false, extensible: true }));
  const seen = new Set(defs.map((d) => d.id));
  for (const raw of Array.isArray(customList) ? customList.slice(0, MAX_CUSTOM_ENGINES) : []) {
    const result = sanitizeCustomCliEngine(raw);
    if (!result.ok || seen.has(result.engine.id)) continue;
    seen.add(result.engine.id);
    defs.push(result.engine);
  }
  return defs;
}

export function findExtensibleCliDef(engineId, customList = []) {
  return engineId ? listAllExtensibleCliDefs(customList).find((d) => d.id === engineId) || null : null;
}
