import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { ROLE_SPECS } from "../core/constants.mjs";
import { resolveDshBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { proseTitle, safeKill, UpstreamProtocolError, utf8Env } from "./base.mjs";

const SHELL_TOOL_RE = /\b(pwsh|powershell|bash|sh|zsh|shell|exec|execute|run_command|run_terminal|terminal|command)\b/i;
const FILE_TOOL_RE = /\b(read|read_file|view|open_file|edit|edit_file|write|write_file|create_file|apply_patch|patch|replace|multiedit|str_replace|insert)\b/i;
const SEARCH_TOOL_RE = /\b(grep|glob|find|search|search_files|list_dir|ls|tree|codebase_search)\b/i;
const THOUGHT_EMIT_MS = 1500;
const THOUGHT_GROWTH_CHARS = 80;
const SLOW_TOOL_MS = 2000;
const MAX_THOUGHT_TAIL = 140;
const MAX_RESULT_TAIL = 120;

function oneLine(text, max) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return max && clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// Keep the basename plus the last 2 path segments (capped) so diffs stay readable.
function shortPath(rawPath) {
  const clean = String(rawPath ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!clean) return "";
  const segs = clean.split("/").filter(Boolean);
  if (segs.length <= 2) return segs.join("/");
  return `…/${segs.slice(-2).join("/")}`;
}

function pickToolString(rawInput, keys) {
  if (!rawInput || typeof rawInput !== "object") return "";
  for (const k of keys) {
    const v = rawInput[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * Condense an ACP `tool_call` (title + parsed rawInput) into one short, human-readable line.
 * Shell -> `title: command`; file tools -> `title path L{start}-{end}`; search -> `title "pattern" in path`.
 */
export function summarizeToolInput(title, rawInput) {
  const label = oneLine(title, 48) || "tool";
  let input = rawInput;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = { command: input };
    }
  }
  if (!input || typeof input !== "object") return label;

  const command = pickToolString(input, ["command", "cmd", "script", "commandLine", "shellCommand"]);
  if (command) return oneLine(`${label}: ${command}`, 110);

  const filePath = pickToolString(input, [
    "path",
    "file_path",
    "filePath",
    "target_file",
    "targetFile",
    "file",
    "notebook_path",
  ]);
  if (FILE_TOOL_RE.test(label) || (filePath && !SEARCH_TOOL_RE.test(label))) {
    if (filePath) {
      const start = Number(input?.start_line ?? input?.startLine ?? input?.offset ?? NaN);
      const end = Number(input?.end_line ?? input?.endLine ?? input?.end ?? NaN);
      let range = "";
      if (Number.isFinite(start) && start > 0) {
        range = Number.isFinite(end) && end > 0 && end !== start ? ` L${start}-${end}` : ` L${start}`;
      }
      return oneLine(`${label} ${shortPath(filePath)}${range}`, 110);
    }
  }

  if (SEARCH_TOOL_RE.test(label)) {
    const pattern = pickToolString(input, ["pattern", "query", "regex", "search", "term", "needle"]);
    const where = shortPath(pickToolString(input, ["path", "dir", "directory", "file_path", "filePath", "glob"]));
    if (pattern) return oneLine(`${label} "${pattern}"${where ? ` in ${where}` : ""}`, 110);
    if (where) return oneLine(`${label} in ${where}`, 110);
  }

  // Generic fallback: first meaningful string value, else a compact JSON preview.
  for (const v of Object.values(input)) {
    if (typeof v === "string" && v.trim()) return oneLine(`${label} ${v.trim()}`, 110);
  }
  try {
    return oneLine(`${label} ${JSON.stringify(input)}`, 108);
  } catch {
    return label;
  }
}

// ---- Structured activity parsing (Antigravity-native collapsible timeline) ----

const TOOL_KINDS = {
  read: ["read", "read_file", "view", "view_file", "open_file", "cat", "read_many", "read_multiple_files"],
  edit: [
    "edit",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
    "apply_patch",
    "patch",
    "replace",
    "multiedit",
    "str_replace",
    "insert",
  ],
  write: ["write", "write_file", "write_to_file", "create_file", "create", "save_file"],
  search: ["grep", "grep_search", "glob", "find", "find_by_name", "search", "search_files", "codebase_search", "list_dir", "ls"],
  cmd: ["pwsh", "powershell", "bash", "sh", "zsh", "shell", "exec", "execute", "run_command", "run_terminal", "terminal", "command"],
};

const PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "file",
  "notebook_path",
  "absolute_path",
  "filename",
  "file_name",
];
const CMD_KEYS = ["command", "cmd", "commandLine", "shellCommand", "script", "command_line", "CommandLine"];
const SEARCH_KEYS = ["pattern", "query", "regex", "search", "term", "needle", "glob"];
const SEARCH_PATH_KEYS = ["path", "dir", "directory", "file_path", "filePath", "glob", "include", "target_directory"];
const NEW_STR_KEYS = ["new_string", "newString", "new_text", "replacement", "Replacement", "new_str", "content"];
const OLD_STR_KEYS = ["old_string", "oldString", "old_text", "target", "Target", "old_str"];

const MAX_EDIT_DETAIL = 2500;
const MAX_WRITE_DETAIL = 1500;
const MAX_CMD_TITLE = 76;
const MAX_CMD_DETAIL = 2000;

function normalizeRawInput(rawInput) {
  let input = rawInput;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = { command: input };
    }
  }
  return input && typeof input === "object" && !Array.isArray(input) ? input : null;
}

function pickFirstString(input, keys) {
  if (!input) return "";
  for (const k of keys) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

function classifyTool(title) {
  const label = String(title || "").toLowerCase();
  for (const kind of ["read", "edit", "write", "search", "cmd"]) {
    if (TOOL_KINDS[kind].some((name) => new RegExp(`(?:^|[^a-z0-9_])${name}(?:$|[^a-z0-9_])`).test(label))) {
      return kind;
    }
  }
  // Claude-style compound titles ("Read, Edit, Bash") and generic descriptions -> regex probes.
  if (SHELL_TOOL_RE.test(label)) return "cmd";
  if (/\b(read|view)\b/.test(label)) return "read";
  if (/\b(edit|write|patch|replace)\b/.test(label)) return "edit";
  if (SEARCH_TOOL_RE.test(label)) return "search";
  return "";
}

function baseName(rawPath) {
  const clean = String(rawPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const segs = clean.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : "";
}

function fullPath(rawPath) {
  const clean = String(rawPath ?? "").trim();
  return clean.length > 400 ? `…${clean.slice(-400)}` : clean;
}

// Split while keeping all but the last line's terminator, so a trailing "\n" never inflates counts.
function splitLines(text) {
  const norm = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!norm) return [];
  const parts = norm.split("\n");
  if (norm.endsWith("\n")) parts.pop();
  return parts;
}

/**
 * Accurate `+added / -removed` for an old->new edit: trim the shared line prefix/suffix
 * first so replacing one line inside a 5-line block reports `+1 -1`, not `+5 -5`.
 */
export function diffLineCounts(oldStr, newStr) {
  const a = splitLines(oldStr);
  const b = splitLines(newStr);
  let pre = 0;
  const maxPre = Math.min(a.length, b.length);
  while (pre < maxPre && a[pre] === b[pre]) pre++;
  let suf = 0;
  const maxSuf = Math.min(a.length, b.length) - pre;
  while (suf < maxSuf && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  return {
    added: b.length - pre - suf,
    removed: a.length - pre - suf,
  };
}

// Strip the noisy `PowerShell 7.5.1` banner / `PS C:\...>` preamble dsh prepends to shell commands.
const SHELL_NOISE_RE = [
  /^\s*PowerShell\b.*$/i, // "PowerShell 7.5.1" banner line
  /^\s*Copyright\b.*$/i,
  /^\s*\(c\)\s.*$/i,
  /^\s*Type\s+['"]?help['"]?\s+to\s+get\s+help.*$/i,
  /^\s*https?:\/\/\S+powershell.*$/i,
  /^\s*PS\s+[^>\n]*>\s*$/, // bare prompt "PS C:\ws>"
  /^\s*<\d{2}:[a-z]{2}>\s*$/i, // banner art row
  /^\s*\*{3,}\s*$/,
];

// Strip the noisy PowerShell banner / `PS C:\...>` prompt dsh prepends to shell commands.
const PS_PROMPT_RE = /^\s*PS\s+[A-Za-z]:[\\/][^>\n]*>\s*(?=\S)/;

function stripShellPreamble(command) {
  const raw = String(command ?? "").replace(/\r\n?/g, "\n");
  const lines = raw.split("\n").map((line) => line.replace(PS_PROMPT_RE, ""));
  while (lines.length > 1) {
    const first = lines[0];
    if (SHELL_NOISE_RE.some((re) => re.test(first)) || /^\s*$/.test(first)) {
      lines.shift();
      continue;
    }
    break;
  }
  return lines.join("\n").trim() || raw.trim();
}

function shortCommandTitle(command) {
  const clean = oneLine(stripShellPreamble(command), 0);
  if (clean.length <= MAX_CMD_TITLE) return clean;
  return `${clean.slice(0, MAX_CMD_TITLE - 1).trimEnd()}…`;
}

function capText(text, max) {
  const s = String(text ?? "").replace(/\r\n?/g, "\n");
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

function emptyActivity(kind, title, detail = "") {
  return { kind, title: oneLine(title, 200), meta: "", added: 0, removed: 0, summary: "", detail };
}

/**
 * Turn an ACP `tool_call` into the structured shape consumed by the Antigravity-native timeline:
 * `{ kind, title, meta, added, removed, summary, detail }` where kind is one of
 * `read | edit | write | search | cmd`.
 */
export function parseToolActivity(title, rawInput) {
  const label = String(title ?? "").trim();
  const input = normalizeRawInput(rawInput);
  const kind = classifyTool(label);
  const summary = summarizeToolInput(title, rawInput);
  let out;

  if (kind === "read") {
    const filePath = pickFirstString(input, PATH_KEYS);
    const start = Number(input?.start_line ?? input?.startLine ?? input?.offset ?? input?.start ?? NaN);
    const end = Number(input?.end_line ?? input?.endLine ?? input?.end_line_number ?? input?.end ?? NaN);
    let meta = "";
    if (Number.isFinite(start) && start > 0) {
      meta = Number.isFinite(end) && end > 0 && end !== start ? `#L${start}-${end}` : `#L${start}`;
    }
    const name = baseName(filePath) || oneLine(label, 48) || "file";
    out = emptyActivity("read", name, `${fullPath(filePath)}${meta ? ` ${meta}` : ""}`.trim());
    out.meta = meta;
    if (!out.detail) out.detail = summary;
  } else if (kind === "edit") {
    const filePath = pickFirstString(input, PATH_KEYS);
    const oldStr = pickFirstString(input, OLD_STR_KEYS);
    const newStr = pickFirstString(input, NEW_STR_KEYS);
    const patchText = pickFirstString(input, ["patch", "diff", "input"]);
    let added = 0;
    let removed = 0;
    let body = "";
    if (oldStr || newStr) {
      ({ added, removed } = diffLineCounts(oldStr, newStr));
      body = [
        oldStr ? `--- before (${splitLines(oldStr).length} lines) ---\n${oldStr}` : "",
        newStr ? `+++ after (${splitLines(newStr).length} lines) +++\n${newStr}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else if (patchText) {
      for (const line of patchText.split("\n")) {
        if (/^\+\+\+|^---/.test(line)) continue;
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) removed++;
      }
      body = patchText;
    }
    const patchFiles = Array.from(patchText.matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm), (m) => m[1].trim());
    const name = baseName(filePath) || baseName(patchFiles[0] || "") || oneLine(label, 48) || "file";
    out = emptyActivity("edit", name, [fullPath(filePath), capText(body, MAX_EDIT_DETAIL)].filter(Boolean).join("\n\n"));
    out.added = added;
    out.removed = removed;
    if (!out.detail) out.detail = summary;
  } else if (kind === "write") {
    const filePath = pickFirstString(input, PATH_KEYS);
    const content = pickFirstString(input, ["content", "text", "contents", "new_string", "code_edit"]);
    const added = typeof content === "string" && content ? splitLines(content).length : 0;
    const name = baseName(filePath) || oneLine(label, 48) || "file";
    out = emptyActivity("write", name, [fullPath(filePath), capText(content, MAX_WRITE_DETAIL)].filter(Boolean).join("\n\n"));
    out.added = added;
    out.removed = 0;
    if (!out.detail) out.detail = summary;
  } else if (kind === "search") {
    const isGlob = /\b(glob|find|ls|list_dir)\b/i.test(label);
    const pattern = pickFirstString(input, SEARCH_KEYS);
    const where = pickFirstString(input, SEARCH_PATH_KEYS);
    const display = pattern ? (isGlob ? pattern : `"${pattern}"`) : oneLine(label, 48) || "search";
    out = emptyActivity("search", display, [pattern ? `pattern: ${pattern}` : "", where ? `path: ${where}` : ""].filter(Boolean).join("\n"));
    out.meta = shortPath(where);
    if (!out.detail) out.detail = summary;
  } else if (kind === "cmd") {
    const command = pickFirstString(input, CMD_KEYS) || (input && typeof input.input === "string" ? input.input : "");
    if (command) {
      out = emptyActivity("cmd", shortCommandTitle(command), `$ ${String(stripShellPreamble(command)).slice(0, MAX_CMD_DETAIL)}`);
    } else {
      out = emptyActivity("cmd", oneLine(label, MAX_CMD_TITLE) || "tool", compactJson(input));
    }
  } else {
    out = emptyActivity("cmd", String(label || "tool"), compactJson(input) || summary);
  }

  out.summary = summary;
  return out;
}

function compactJson(input) {
  if (!input) return "";
  try {
    const text = JSON.stringify(input);
    return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
  } catch {
    return "";
  }
}

/**
 * Standard Agent Client Protocol (ACP) adapter over stdio JSON-RPC 2.0.
 * Drives DeepSeek Harness (`dsh --profile acp`) for API-key & general models
 * without ever mutating global user configs — per-profile env vars and isolated
 * plugin directories are passed strictly to the ephemeral child process.
 */
export class AcpEngine {
  constructor(dataDir = "") {
    this.id = "deepseek-harness";
    this.dataDir = dataDir ? path.resolve(dataDir) : "";
    this.clients = new Map(); // profileKey -> client state
    this.connecting = new Map(); // profileKey -> Promise<client state>
  }

  #profileKey(model, permissionMode = "workspace-write") {
    const keyHash = createHash("sha256").update(model?.apiKey || "").digest("hex").slice(0, 16);
    return `${model?.id || "default"}::${model?.source || "custom"}::${model?.baseUrl || ""}::${model?.modelName || ""}::${keyHash}::${permissionMode}`;
  }

  async #readDshSessionCacheUsage(dshHome, sessionId, prevTurnCount = 0) {
    if (!dshHome || !sessionId || typeof zlib.zstdDecompressSync !== "function") return null;
    const readOnce = () => {
      try {
        const sessionsRoot = path.join(dshHome, "sessions");
        if (!fs.existsSync(sessionsRoot)) return null;
        let targetFile = "";
        for (const wsEntry of fs.readdirSync(sessionsRoot)) {
          const candZstd = path.join(sessionsRoot, wsEntry, sessionId, "session.v4.jsonl.zstd");
          if (fs.existsSync(candZstd)) {
            targetFile = candZstd;
            break;
          }
          const candPlain = path.join(sessionsRoot, wsEntry, sessionId, "session.v4.jsonl");
          if (fs.existsSync(candPlain)) {
            targetFile = candPlain;
            break;
          }
        }
        if (!targetFile) return null;
        const rawBuf = fs.readFileSync(targetFile);
        const text = targetFile.endsWith(".zstd")
          ? zlib.zstdDecompressSync(rawBuf).toString("utf8")
          : rawBuf.toString("utf8");
        const lines = text.split(/\r?\n/);
        let turnEnds = 0;
        let lastUsage = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (line.includes('"turn/end"')) {
            turnEnds++;
          } else if (line.includes('"assistant/message"')) {
            try {
              const obj = JSON.parse(line);
              const u = obj?.data?.usage || obj?.data?.message?.usage;
              if (u && typeof u === "object" && (typeof u.inputTokens === "number" || typeof u.cacheReadTokens === "number")) {
                lastUsage = u;
              }
            } catch {}
          }
        }
        if (!lastUsage) return { turnEnds, usage: null };
        const uncached = typeof lastUsage.inputTokens === "number" ? lastUsage.inputTokens : 0;
        const hasCache = typeof lastUsage.cacheReadTokens === "number";
        const cached = hasCache ? lastUsage.cacheReadTokens : null;
        const cacheWrite = typeof lastUsage.cacheWriteTokens === "number" ? lastUsage.cacheWriteTokens : 0;
        const totalInput = uncached + (cached || 0) + cacheWrite;
        return {
          turnEnds,
          usage: {
            inputTokens: totalInput > 0 ? totalInput : null,
            ...(hasCache ? { cachedInputTokens: cached } : {}),
            ...(cacheWrite > 0 ? { cacheWriteInputTokens: cacheWrite } : {}),
            ...(typeof lastUsage.outputTokens === "number" ? { outputTokens: lastUsage.outputTokens } : {}),
          },
        };
      } catch {
        return null;
      }
    };

    // Wait briefly (up to 600ms) for dsh's async session persistence to flush the new turn/end
    let best = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const snap = readOnce();
      if (snap?.usage) best = snap.usage;
      if (snap && snap.turnEnds > prevTurnCount && snap.usage) return snap.usage;
      await new Promise((r) => setTimeout(r, 60));
    }
    return best;
  }

  #countDshTurnEnds(dshHome, sessionId) {
    if (!dshHome || !sessionId || typeof zlib.zstdDecompressSync !== "function") return 0;
    try {
      const sessionsRoot = path.join(dshHome, "sessions");
      if (!fs.existsSync(sessionsRoot)) return 0;
      for (const wsEntry of fs.readdirSync(sessionsRoot)) {
        for (const fname of ["session.v4.jsonl.zstd", "session.v4.jsonl"]) {
          const fp = path.join(sessionsRoot, wsEntry, sessionId, fname);
          if (!fs.existsSync(fp)) continue;
          const rawBuf = fs.readFileSync(fp);
          const text = fname.endsWith(".zstd") ? zlib.zstdDecompressSync(rawBuf).toString("utf8") : rawBuf.toString("utf8");
          return (text.match(/"turn\/end"/g) || []).length;
        }
      }
    } catch {}
    return 0;
  }

  async #getClient(model, permissionMode = "workspace-write") {
    const key = this.#profileKey(model, permissionMode);
    const existing = this.clients.get(key);
    if (existing && existing.proc && !existing.proc.killed && existing.initialized) {
      return existing;
    }
    if (this.connecting.has(key)) {
      return this.connecting.get(key);
    }

    const promise = (async () => {
      const cur = this.clients.get(key);
      if (cur && cur.proc && !cur.proc.killed && cur.initialized) {
        return cur;
      }
      if (cur) {
        safeKill(cur.proc);
        this.clients.delete(key);
      }

      const bin = resolveDshBinary(this.dataDir);
      if (!bin) {
        throw new Error(
          "DeepSeek Harness (`dsh`) is not installed. Install via: npm install -g @deepseek-ai/dsh@latest"
        );
      }
      if (bin.nodeTooOld) {
        throw new Error(
          "DeepSeek Harness (`dsh`) requires Node.js >= 24.9.0. Upgrade Node.js or install the portable Node 24 runtime into plugin_data/agent-relay/runtime/node24."
        );
      }

      const extraEnv = {
        DSH_PERMISSION_MODE: permissionMode,
      };
      let patchPath = "";
      let effectiveDshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
      if (model?.source === "dsh") {
        // Reuse user's read-only ~/.dsh/ config untouched
        if (model?.modelName) extraEnv.DSH_MODEL = model.modelName;
      } else {
        if (model?.apiKey) {
          extraEnv.AGENT_RELAY_API_KEY = model.apiKey;
          extraEnv.OPENAI_API_KEY = model.apiKey;
          if (model.providerId === "deepseek") extraEnv.DEEPSEEK_API_KEY = model.apiKey;
        }
        if (model?.baseUrl) {
          extraEnv.OPENAI_BASE_URL = model.baseUrl;
          if (model.providerId === "deepseek") extraEnv.DEEPSEEK_BASE_URL = model.baseUrl;
        }
        if (model?.modelName) {
          extraEnv.OPENAI_MODEL = model.modelName;
          extraEnv.DSH_MODEL = model.modelName;
        }
        if (this.dataDir && model?.baseUrl && model?.modelName) {
          try {
            const safeId = String(model?.id || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
            const profileDir = path.join(this.dataDir, "dsh-profiles", safeId);
            fs.mkdirSync(profileDir, { recursive: true });
            patchPath = path.join(profileDir, "agent-relay-overlay.yml");
            const overlayYaml = [
              "- id: llm-pi-ai",
              "  config:",
              "    providers:",
              "      agent-relay:",
              `        displayName: ${JSON.stringify(model?.name || model?.providerId || "A.stand")}`,
              "        apiKeyEnv: AGENT_RELAY_API_KEY",
              "        api: openai-completions",
              `        baseURL: ${JSON.stringify(model.baseUrl)}`,
              "        models:",
              `          - id: ${JSON.stringify(model.modelName)}`,
              "- id: acp",
              "  config:",
              "    provider: agent-relay",
              `    model: ${JSON.stringify(model.modelName)}`,
              "",
            ].join("\n");
            fs.writeFileSync(patchPath, overlayYaml, "utf8");
            extraEnv.DSH_HOME = profileDir;
            effectiveDshHome = profileDir;
          } catch {}
        }
      }

      const launchArgs = [
        ...(bin.prefixArgs || []),
        "--profile",
        "acp",
        ...(patchPath ? ["--patch", patchPath] : []),
      ];

      const proc = spawn(bin.command, launchArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: bin.useShell,
        env: utf8Env(extraEnv),
      });

      const state = {
        key,
        proc,
        dshHome: effectiveDshHome,
        initialized: false,
        agentVersion: "",
        nextId: 1,
        pending: new Map(),
        loadedSessions: new Set(),
        sessionRoles: new Map(),
        listeners: new Map(), // sessionId -> fn(msg)
        stderrRing: [],
      };

      const sendRaw = (obj) => {
        if (!proc.stdin.writable) throw new Error("ACP stdin closed");
        proc.stdin.write(JSON.stringify(obj) + "\n");
      };

      const request = (method, params = {}, timeoutMs = 45_000) => {
        const id = state.nextId++;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            state.pending.delete(id);
            reject(new UpstreamProtocolError("deepseek-harness", state.agentVersion, method, `timeout ${timeoutMs}ms`));
          }, timeoutMs);
          state.pending.set(id, {
            method,
            resolve: (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          sendRaw({ jsonrpc: "2.0", id, method, params });
        });
      };

      state.sendRaw = sendRaw;
      state.request = request;

      proc.on("exit", (code, signal) => {
        const err = new Error(`dsh --profile acp exited (code=${code}, signal=${signal})`);
        for (const p of state.pending.values()) p.reject(err);
        state.pending.clear();
        for (const fn of state.listeners.values()) fn({ method: "__exit__", params: { code } });
        state.listeners.clear();
        this.clients.delete(key);
      });

      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const p = state.pending.get(msg.id);
          if (p) {
            state.pending.delete(msg.id);
            if (msg.error) {
              p.reject(
                new UpstreamProtocolError("deepseek-harness", state.agentVersion, p.method, JSON.stringify(msg.error))
              );
            } else {
              p.resolve(msg.result);
            }
          }
        } else if (msg.id !== undefined && msg.method === "session/request_permission") {
          const sid = msg.params?.sessionId;
          const role = sid ? state.sessionRoles.get(sid) : "oracle";
          const options = msg.params?.options || [];
          const allowOpt = options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
          const rejectOpt = options.find((o) => o.kind === "reject_once" || o.kind === "reject_always");
          const chosen = role === "hephaestus" ? allowOpt || options[0] : rejectOpt || null;
          sendRaw({
            jsonrpc: "2.0",
            id: msg.id,
            result: chosen
              ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
              : { outcome: { outcome: "cancelled" } },
          });
        } else if (msg.method) {
          const sid = msg.params?.sessionId;
          if (sid && state.listeners.has(sid)) {
            state.listeners.get(sid)(msg);
          }
        }
      });

      readline.createInterface({ input: proc.stderr }).on("line", (line) => {
        if (!line.trim()) return;
        state.stderrRing.push(line.trim());
        if (state.stderrRing.length > 30) state.stderrRing.shift();
      });

      const initRes = await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "agent-relay", version: "1.0.0" },
      });
      state.agentVersion = initRes?.agentInfo?.version || "";
      state.initialized = true;
      this.clients.set(key, state);
      return state;
    })();

    this.connecting.set(key, promise);
    try {
      return await promise;
    } finally {
      this.connecting.delete(key);
    }
  }

  async runTurn({ cwd, role, model, prompt, sandbox, existingSessionId, onActivity, onSessionReady }) {
    const t0 = Date.now();
    const permissionMode =
      role === "oracle"
        ? "read-only"
        : sandbox === "danger-full-access"
          ? "danger-full-access"
          : "workspace-write";
    const state = await this.#getClient(model, permissionMode);
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;

    let sessionId = existingSessionId || "";
    let reused = false;
    let resumedFromDisk = false;

    if (sessionId && state.loadedSessions.has(sessionId)) {
      reused = true;
    } else if (sessionId) {
      try {
        await state.request("session/resume", { sessionId, cwd, mcpServers: [] });
        state.loadedSessions.add(sessionId);
        reused = true;
        resumedFromDisk = true;
      } catch {
        sessionId = "";
      }
    }

    if (!sessionId) {
      const created = await state.request("session/new", { cwd, mcpServers: [] });
      sessionId = created?.sessionId;
      if (!sessionId) {
        throw new UpstreamProtocolError("deepseek-harness", state.agentVersion, "session/new", "missing sessionId");
      }
      state.loadedSessions.add(sessionId);
      if (model?.source === "dsh" && model?.providerId && model?.modelName) {
        try {
          await state.request("session/set_config_option", {
            sessionId,
            configId: "model",
            value: JSON.stringify([model.providerId, model.modelName]),
          });
        } catch {}
      }
    }
    state.sessionRoles.set(sessionId, role);
    onSessionReady?.(sessionId);

    const messages = new Map();
    const actions = [];
    let rawUsage = null;
    let anonymousMessage = 0;
    let currentMessageId = "";

    // X-ray state: streamed reasoning + per-tool-call lifecycle for the live timeline.
    // Every activity carries a stable `id` so the orchestrator can merge in place instead of
    // pushing 30 duplicate rows for one thought / tool call / streamed answer.
    const toolCalls = new Map(); // toolCallId -> { kind, title, meta, added, removed, summary, detail, startedAt }
    const thought = { open: false, id: "", full: "", startedAt: 0, emitAt: 0, emittedLen: 0, seq: 0 };
    const msgKey = String(t0);

    // 400ms+ -> at least 1s; otherwise a 1-decimal value (0.3s) or an exact integer (12.0 -> 12).
    const formatDuration = (ms) => {
      const sec = Math.max(0, ms) / 1000;
      if (ms >= 400) return Math.max(1, Math.round(sec));
      return Number(sec.toFixed(1));
    };

    const tailOf = (text) => oneLine(text.slice(-MAX_THOUGHT_TAIL * 2), MAX_THOUGHT_TAIL);

    const emitThought = () => {
      if (!thought.open || !thought.full.trim()) return;
      const durationSec = formatDuration(Date.now() - thought.startedAt);
      thought.emittedLen = thought.full.length;
      thought.emitAt = Date.now();
      onActivity?.({
        id: thought.id,
        type: "thought",
        kind: "thought",
        title: "",
        status: "running",
        durationSec,
        summary: `思考: ${tailOf(thought.full) || "…"}`,
        detail: thought.full.slice(0, 4000),
      });
    };

    // Close the open reasoning block with its exact final duration (idempotent).
    const finalizeThought = () => {
      if (!thought.open) return;
      const durationSec = formatDuration(Date.now() - thought.startedAt);
      const text = thought.full.slice(0, 4000);
      const id = thought.id;
      thought.open = false;
      thought.id = "";
      thought.full = "";
      onActivity?.({
        id,
        type: "thought",
        kind: "thought",
        title: "",
        status: "done",
        durationSec,
        summary: `思考 (${durationSec}s): ${tailOf(text) || "…"}`,
        detail: text,
      });
    };

    const ensureThought = (messageId) => {
      if (thought.open) return;
      thought.seq += 1;
      thought.open = true;
      thought.id = `thought_${messageId || thought.seq}`;
      thought.full = "";
      thought.startedAt = Date.now();
      thought.emitAt = 0;
      thought.emittedLen = 0;
    };

    // ACP may omit messageId. Consecutive chunks then belong to the same prose block.
    const emitOutput = (id, status) => {
      const message = messages.get(id);
      if (!message) return;
      const now = Date.now();
      if (status === "running" && now - message.lastPush < 1200) {
        onActivity?.({ type: "touch" });
        return;
      }
      const title = proseTitle(message.text);
      if (!title) return;
      message.lastPush = now;
      onActivity?.({
        id: `msg_${msgKey}_${id}`,
        type: "output",
        kind: "output",
        title,
        status,
        detail: message.text.slice(0, 4000),
        summary: title,
      });
    };

    const finishMessage = () => {
      if (currentMessageId) emitOutput(currentMessageId, "done");
      currentMessageId = "";
    };

    state.listeners.set(sessionId, (msg) => {
      if (msg.method !== "session/update") return;
      const update = msg.params?.update || {};
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.text) {
        finalizeThought();
        const id = update.messageId ? `id_${update.messageId}` : currentMessageId || `part_${++anonymousMessage}`;
        if (currentMessageId !== id) finishMessage();
        currentMessageId = id;
        if (!messages.has(id)) messages.set(id, { text: "", lastPush: 0 });
        messages.get(id).text += update.content.text;
        emitOutput(id, "running");
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        finishMessage();
        const text = update.content?.text || "";
        ensureThought(update.messageId);
        if (!text) {
          onActivity?.({ type: "touch" });
          return;
        }
        thought.full = `${thought.full}${text}`.slice(-4000);
        if (Date.now() - thought.emitAt >= THOUGHT_EMIT_MS) emitThought();
        else onActivity?.({ type: "touch" });
      } else if (update.sessionUpdate === "tool_call" && update.title) {
        finalizeThought();
        finishMessage();
        const parsed = parseToolActivity(update.title, update.rawInput);
        if (update.toolCallId) {
          toolCalls.set(update.toolCallId, { ...parsed, startedAt: Date.now() });
        }
        actions.push(parsed.summary);
        onActivity?.({
          id: update.toolCallId || "",
          type: "cmd_start",
          kind: parsed.kind,
          title: parsed.title,
          meta: parsed.meta,
          added: parsed.added,
          removed: parsed.removed,
          status: "running",
          summary: parsed.summary,
          detail: parsed.detail,
        });
      } else if (update.sessionUpdate === "tool_call_update") {
        finalizeThought();
        const tc = update.toolCallId ? toolCalls.get(update.toolCallId) : null;
        const status = String(update.status || "");
        const rawOutput = update.rawOutput;
        const content = Array.isArray(update.content)
          ? update.content.map((c) => c?.content?.text || c?.text || "").filter(Boolean).join("\n")
          : typeof update.content === "string" ? update.content : "";
        const output = content || (typeof rawOutput === "string" ? rawOutput
          : [rawOutput?.stdout, rawOutput?.stderr].filter((value) => typeof value === "string" && value).join("\n"));
        const reportedCode = update.exitCode ?? rawOutput?.exitCode ?? rawOutput?.exit_code ?? update.exit_code;
        const marker = /\[exit\s+code:\s*(-?\d+)\]/gi;
        const codeText = String(reportedCode ?? [...output.matchAll(marker)].at(-1)?.[1] ?? "");
        const exitCode = /^-?\d+$/.test(codeText) ? Number(codeText) : tc?.exitCode ?? null;
        const cleanOutput = stripShellPreamble(output.replace(marker, "")).slice(0, 3500);
        if (tc) {
          if (cleanOutput) tc.output = cleanOutput;
          tc.exitCode = exitCode;
        }
        const terminal = status === "completed" || status === "failed";
        if (terminal || cleanOutput || exitCode !== null) {
          const failed = terminal && (status === "failed" || (exitCode !== null && exitCode !== 0));
          const durationSec = tc ? Number(((Date.now() - tc.startedAt) / 1000).toFixed(1)) : 0;
          const label = tc?.summary || "tool call";
          const captured = tc?.output || cleanOutput;
          const excerpt = oneLine(captured, MAX_RESULT_TAIL);
          onActivity?.({
            id: update.toolCallId || "",
            type: terminal ? (failed ? "cmd_err" : "cmd_done") : "cmd_start",
            kind: tc?.kind || "cmd",
            title: tc?.title || oneLine(label, 76),
            meta: tc?.meta || "",
            added: tc?.added || 0,
            removed: tc?.removed || 0,
            durationSec,
            exitCode,
            status: terminal ? (failed ? "error" : "done") : "running",
            summary: terminal
              ? `${failed ? "✗" : "✓"} ${label} (${Math.round(durationSec)}s)${excerpt ? ` → ${excerpt}` : ""}`
              : label,
            detail: [tc?.detail, captured].filter(Boolean).join("\n\n"),
          });
          if (terminal) toolCalls.delete(update.toolCallId);
        } else {
          onActivity?.({ type: "touch" });
        }
      } else if (update.sessionUpdate === "usage_update") {
        rawUsage = {
          ...(rawUsage || {}),
          ...(typeof update.used === "number" ? { inputTokens: update.used } : {}),
          ...(typeof update.size === "number" ? { contextWindow: update.size } : {}),
        };
      }
      if (update.usage || msg.params?.usage) {
        rawUsage = { ...(rawUsage || {}), ...(update.usage || msg.params.usage) };
      }
    });

    try {
      const prevTurnEnds = this.#countDshTurnEnds(state.dshHome, sessionId);
      const fullPrompt = reused ? prompt : `[Role Instructions]\n${spec.developerInstructions}\n\n[Task]\n${prompt}`;
      const res = await state.request(
        "session/prompt",
        {
          sessionId,
          prompt: [{ type: "text", text: fullPrompt }],
        },
        1_800_000
      );
      if (res?.usage || res?._meta?.usage) {
        rawUsage = { ...(rawUsage || {}), ...(res.usage || res._meta.usage) };
      }
      if (rawUsage?.cachedInputTokens === undefined && rawUsage?.cached_input_tokens === undefined) {
        const diskUsage = await this.#readDshSessionCacheUsage(state.dshHome, sessionId, prevTurnEnds);
        if (diskUsage) {
          rawUsage = { ...(rawUsage || {}), ...diskUsage };
        }
      }
      const usage = normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", rawUsage);
      finalizeThought();
      finishMessage();
      return {
        sessionId,
        turnId: "",
        reused,
        resumedFromDisk,
        resolvedModel: model?.modelName || "deepseek-harness",
        text: Array.from(messages.values()).at(-1)?.text.trim() || "(no response text)",
        usage,
        actions,
        elapsedMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes("402") || msg.includes("insufficient") || msg.includes("balance")) {
        err.isRateLimit = true;
        err.isQuotaDepleted = true;
      } else if (msg.includes("429") || msg.includes("rate_limit") || msg.includes("rate limit")) {
        err.isRateLimit = true;
        err.resetsAtMs = Date.now() + 60 * 60 * 1000;
      }
      throw err;
    } finally {
      state.listeners.delete(sessionId);
      finishMessage();
      // Close the trailing reasoning block with its exact duration (also on interrupt/error).
      finalizeThought();
    }
  }

  async interruptTurn(sessionId, model) {
    if (!sessionId) return;
    const matchingProfile = this.clients.get(this.#profileKey(model));
    const state = matchingProfile?.listeners.has(sessionId)
      ? matchingProfile
      : [...this.clients.values()].find((client) => client.listeners.has(sessionId)) || matchingProfile;
    if (!state) return;
    state.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }

  async fetchProviderModels({ baseUrl, apiKey }) {
    const t0 = Date.now();
    const cleanBase = (baseUrl || "").replace(/\/+$/, "");
    if (!cleanBase) return { ok: false, latencyMs: 0, models: [], error: "Base URL is required" };
    if (!apiKey) return { ok: false, latencyMs: 0, models: [], error: "API Key is required" };
    try {
      const res = await fetch(`${cleanBase}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(12_000),
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        const msg =
          res.status === 401
            ? "HTTP 401 (API Key invalid or unauthorized)"
            : `HTTP ${res.status}`;
        return { ok: false, latencyMs, models: [], error: msg };
      }
      const json = await res.json();
      const rawList = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json?.models)
        ? json.models
        : [];
      const seen = new Set();
      const models = [];
      for (const item of rawList) {
        const id = typeof item === "string" ? item.trim() : String(item?.id || item?.name || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        models.push({
          id,
          ownedBy: typeof item === "object" ? String(item?.owned_by || "") : "",
        });
      }
      models.sort((a, b) => a.id.localeCompare(b.id));
      return { ok: true, latencyMs, models: models.slice(0, 300) };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        models: [],
        error: err?.message || String(err),
      };
    }
  }

  async testApiConnection({ baseUrl, apiKey, modelName }) {
    const t0 = Date.now();
    const cleanBase = (baseUrl || "").replace(/\/+$/, "");
    if (!cleanBase) return { ok: false, error: "Base URL is required", latencyMs: 0 };
    if (!apiKey) return { ok: false, error: "API Key is required", latencyMs: 0 };

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    try {
      const res = await fetch(`${cleanBase}/models`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      const latencyMs = Date.now() - t0;
      if (res.ok) {
        let modelFound = null;
        try {
          const json = await res.json();
          if (modelName && Array.isArray(json?.data)) {
            modelFound = json.data.some((m) => m.id === modelName);
          }
        } catch {}
        return {
          ok: true,
          latencyMs,
          httpStatus: res.status,
          modelFound,
        };
      }
      // Fallback: some OpenAI-compatible endpoints restrict /models; try minimal chat completion
      if (res.status === 404 && modelName) {
        const res2 = await fetch(`${cleanBase}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(12_000),
        });
        return {
          ok: res2.ok,
          latencyMs: Date.now() - t0,
          httpStatus: res2.status,
          error: res2.ok ? undefined : `HTTP ${res2.status}`,
        };
      }
      return {
        ok: false,
        latencyMs,
        httpStatus: res.status,
        error:
          res.status === 401
            ? "HTTP 401 (API Key invalid or unauthorized)"
            : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - t0,
        error: err?.message || String(err),
      };
    }
  }

  async shutdown() {
    const list = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.allSettled(list.map((st) => safeKill(st.proc)));
  }
}
