import crypto from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PROVIDERS, CLI_DEFAULT_MODELS_MAP, PLUGIN_VERSION } from "./constants.mjs";
import { EXTENSIBLE_CLI_PRESETS, findExtensibleCliDef } from "./cli-registry.mjs";
import { getAllCliInstalls } from "./cli-install.mjs";
import {
  clearCliAccountCache,
  getCachedCliAccountInfo,
  parseJunieListModels,
  probeCliAccountInfo,
  supportsMultiAccountIsolation,
} from "./cli-profiles.mjs";
import { detectEngines, normalizeWorkspaceKey, readDshConfigModels, resolveCliPresetBinary } from "./paths.mjs";
import { assertCanReuseApiKey, maskSecret } from "./store.mjs";
import { createJobWorktree, detectGitRepo, finalizeJobWorktree } from "./worktree.mjs";
import { AcpEngine } from "../engines/acp.mjs";
import { AntigravityCliEngine } from "../engines/antigravity.mjs";
import { ClaudeCodeEngine } from "../engines/claude-code.mjs";
import { CodexEngine } from "../engines/codex.mjs";
import { UniversalAcpEngine } from "../engines/universal-acp.mjs";
import { UniversalHeadlessEngine } from "../engines/universal-headless.mjs";

const MAX_INLINE_TEXT = 24_000;
const MAX_BLOCKING_WAIT_MS = 120_000;
const INSPECTOR_TIMEOUT_MS = 15_000;
const STATUS_WRITE_THROTTLE_MS = 2_500;
const CRASH_RECOVERY_ERROR = "Host/MCP exited while job was running";
const GATEKEEPER_MAX_DEFERRALS = 3;
const GATEKEEPER_VERDICT_GRACE_MS = 30_000;
const RECOVER_WINDOW_MS = 24 * 60 * 60 * 1000;
const RECOVER_SCAN_LIMIT = 500;
const RECOVER_ACTION_TEXT_MAX = 240;
const GATEKEEPER_REASON_MAX = 180;
const TRIAGE_DETAIL_MAX = 600;

const __orchestratorDir = path.dirname(fileURLToPath(import.meta.url));

const JUNIE_MODEL_CACHE_TTL_MS = 10 * 60_000;
let junieModelDiscoveryCache = { ts: 0, models: [] };

/** Run `junie list-models` (fixed argv, no shell interpolation) and return its raw output. */
function runJunieModelList(bin, timeoutMs = 6_000) {
  return new Promise((resolve) => {
    if (!bin?.command) return resolve("");
    const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const useShell = Boolean(bin.useShell) && process.platform === "win32";
    const command = useShell ? process.env.ComSpec || "cmd.exe" : bin.command;
    const args = ["list-models"];
    const execArgs = useShell ? ["/d", "/s", "/c", `"${[quote(bin.command), ...args.map(quote)].join(" ")}"`] : args;
    execFile(
      command,
      execArgs,
      {
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        shell: false,
        ...(useShell ? { windowsVerbatimArguments: true } : {}),
      },
      (err, stdout, stderr) => resolve(`${stdout || ""}\n${stderr || ""}`)
    );
  });
}

/**
 * Junie enumerates its real catalog before login, but ACP model discovery may fail or only expose
 * the pseudo-default. Fall back to the CLI's JSON catalog, cached briefly to keep the panel light.
 */
async function discoverJunieModels(descriptor) {
  const now = Date.now();
  if (junieModelDiscoveryCache.ts && now - junieModelDiscoveryCache.ts < JUNIE_MODEL_CACHE_TTL_MS) {
    return junieModelDiscoveryCache.models;
  }
  const bin = resolveCliPresetBinary(descriptor || { command: "junie" });
  if (!bin) return [];
  const models = parseJunieListModels(await runJunieModelList(bin));
  if (models.length) junieModelDiscoveryCache = { ts: Date.now(), models };
  return models;
}

export function applyTurn1CustomRules(prompt, customRules, isFirstTurn) {
  if (!isFirstTurn) return prompt;
  const rules = customRules?.trim();
  return rules ? `[Role Custom Rules]\n${rules}\n[/Role Custom Rules]\n\n${prompt}` : prompt;
}

// Merges the role's hand-written custom rules with compiled skill/template rules.
// Kept pure so Turn 2+ (session reuse) stays byte-identical and Prompt Cache safe.
export function mergeTurn1Rules(customRules, extensionText) {
  const base = String(customRules || "").trim();
  const extra = String(extensionText || "").trim();
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

const HANDOFF_ACTIVITY_LIMIT = 15;
const HANDOFF_OUTPUT_LIMIT = 1_200;
const HANDOFF_PROGRESS_KINDS = new Set([
  "cmd", "cmd_done", "cmd_err", "read", "search", "edit", "write", "file", "tool", "tool_call",
]);
const HANDOFF_SKIP_KINDS = new Set([
  "start", "touch", "log", "triage", "triage_alert", "steer", "interrupt", "fallback", "error",
  "thought", "output",
]);

function gitStatusShort(cwd) {
  const dir = String(cwd || "").trim();
  if (!dir) return "（未提供工作目录，已跳过 git status）";
  try {
    const out = execFileSync("git", ["-c", "safe.directory=*", "status", "--short"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? out.slice(0, 4_000) : "工作区干净（无未提交改动）";
  } catch {
    return "（当前目录不是 Git 仓库或 git 不可用，已安全跳过 git status）";
  }
}

/**
 * Zero-AI, zero-network handoff brief. It is intentionally synchronous and reads only local state:
 * task goal, completed tool steps, `git status --short`, and the tail of the interrupted output.
 */
export function buildLocalHandoffBrief({
  originalPrompt = "",
  fromLabel = "",
  reason = "",
  activities = [],
  cwd = "",
  lastOutput = "",
} = {}) {
  const goal = String(originalPrompt || "").replace(/\r\n/g, "\n").trim().slice(0, 4_000);
  const steps = [];
  const seen = new Set();
  for (const activity of Array.isArray(activities) ? activities : []) {
    const kind = String(activity?.kind || activity?.type || "");
    if (!kind || HANDOFF_SKIP_KINDS.has(kind)) continue;
    if (kind === "cmd" && activity?.status === "running") continue;
    if (!HANDOFF_PROGRESS_KINDS.has(kind) && !String(activity?.summary || "").trim()) continue;
    const line = sanitizeHandoffText(activity?.summary || activity?.title || "", 240);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(`- ${line}`);
    if (steps.length >= HANDOFF_ACTIVITY_LIMIT) break;
  }

  const tail = String(lastOutput || "").replace(/\r\n/g, "\n").slice(-HANDOFF_OUTPUT_LIMIT).trim();
  const from = sanitizeHandoffText(fromLabel, 80) || "上一个执行通道";
  const why = sanitizeHandoffText(reason, 120) || "渠道故障";
  return [
    "## 1. 原始任务目标",
    goal || "(未提供原始任务)",
    "## 2. 已完成操作",
    steps.length ? steps.join("\n") : "- 暂无已完成的实质性操作",
    "## 3. 当前现场（git status --short）",
    gitStatusShort(cwd),
    "## 4. 中断前最后输出",
    tail || "(无输出)",
    "## 5. 接力要求",
    `上一棒 ${from} 因 ${why} 中断。请直接基于硬盘当前现场继续完成原任务，先核对已有改动与未完成步骤；` +
      "不要推倒重做已完成的工作，也不要重复执行已经成功的命令。",
  ].join("\n\n");
}

const CHANNEL_CANCEL_RE = /\b(?:cancelled|canceled|aborted|interrupted|interrupt requested)\b|用户取消|已取消/i;
const CHANNEL_BAD_REQUEST_RE =
  /\b400\b|bad request|invalid request|request (?:too large|invalid)|prompt (?:is )?too long|context (?:length|window)|too many tokens|max(?:imum)? tokens|内容违规|请求(?:参数|格式|过长|超长)/i;
const CHANNEL_TIMEOUT_RE =
  /\btime(?:d)?\s*out\b|timeout|exceeded .*deadline|silent for|stalled|no activity|超时|静默|卡死/i;
const CHANNEL_SERVER_RE =
  /(?:http|status|code|server|upstream|response)\D{0,16}5\d\d|5\d\d\s+(?:internal server error|bad gateway|service unavailable|gateway timeout)|internal server error|bad gateway|service unavailable|gateway timeout|econnreset|econnrefused|etimedout|epipe|socket hang up|connection (?:error|reset|closed|refused|aborted|terminated|timed out)|network error|fetch failed|disconnected|process (?:exited|terminated)|app-server (?:exited|terminated)|stdin closed|connection lost|连接(?:中断|重置|断开|失败)/i;
const CHANNEL_AUTH_RE =
  /\b401\b|unauthori[sz]ed|invalid[ _-]?(?:api[ _-]?key|token|credential)|authentication (?:failed|required)|login (?:expired|required)|not logged in|session expired|未登录|登录(?:已)?(?:失效|过期)/i;

/**
 * Only three channel faults may rotate to the next healthy model/account. User cancellation,
 * invalid/oversized 400 requests and silent/stalled child agents must stay on the check-in path.
 */
export function classifyChannelFailure(err) {
  if (!err) return null;
  if (err.isPromptTimeout) return null;
  if (err.isQuotaDepleted) return "quota";
  if (err.isRateLimit) return "rate_limit";
  const text = `${err.name || ""} ${err.message || err}`.trim();
  if (!text) return null;
  if (CHANNEL_CANCEL_RE.test(text)) return null;
  if (CHANNEL_BAD_REQUEST_RE.test(text)) return null;
  if (/\b429\b|rate[\s_-]?limit|too many requests/i.test(text)) return "rate_limit";
  if (/\bquota\b|insufficient (?:quota|credits?|balance)|balance depleted|credits? exhausted/i.test(text)) {
    return "quota";
  }
  if (CHANNEL_SERVER_RE.test(text)) return "server";
  if (CHANNEL_AUTH_RE.test(text)) return "auth";
  if (CHANNEL_TIMEOUT_RE.test(text)) return null;
  return null;
}

function channelFailureLabel(kind) {
  if (kind === "rate_limit") return "429 限流";
  if (kind === "quota") return "额度耗尽";
  if (kind === "server") return "5xx/连接中断";
  if (kind === "auth") return "401 登录失效";
  return "渠道故障";
}

export function formatMappedDriveSandboxHint({ platform, role, engine, cwd, activities, errorText, resultText }) {
  if (platform !== "win32" || role !== "oracle" || engine !== "codex" || !/^[a-bd-z]:\\/i.test(cwd)) {
    return "";
  }
  const directoryError = /\b(?:CreateProcessWithLogonW failed:\s*267|ERROR_DIRECTORY)\b/i;
  if (!directoryError.test(errorText || "") && !directoryError.test(resultText || "") &&
      !activities?.some((step) => (step.kind || step.type) === "cmd" && step.exitCode === -1)) {
    return "";
  }
  return "[Hint] Codex Windows read-only sandbox cannot access mapped network drives (e.g. Z:, error 267). Use a local drive checkout or switch Oracle to DeepSeek Harness (dsh).";
}

function isWaitJobScript(candidate) {
  try {
    return path.basename(candidate) === "wait-job.mjs" && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

// `wait-job.mjs` is shipped next to server.mjs by scripts/build.mjs (dist/wait-job.mjs).
// Bundled (<dist>/server.mjs): import.meta.url points at dist/server.mjs -> same dir.
// Dev (src/core/orchestrator.mjs): -> <repo>/dist/wait-job.mjs, with safe fallbacks.
// Every candidate is verified to be an existing `wait-job.mjs` file so the plugin dir and the
// dev repo both resolve cleanly and never pick an unrelated sibling directory.
export function resolveWaitJobScript() {
  const candidates = [
    path.resolve(__orchestratorDir, "wait-job.mjs"),
    path.resolve(__orchestratorDir, "..", "wait-job.mjs"),
    path.resolve(__orchestratorDir, "..", "dist", "wait-job.mjs"),
    path.resolve(__orchestratorDir, "..", "..", "dist", "wait-job.mjs"),
    path.resolve(__orchestratorDir, "..", "..", "scripts", "wait-job.mjs"),
    path.resolve(__orchestratorDir, "..", "scripts", "wait-job.mjs"),
  ];
  return candidates.find(isWaitJobScript) || path.resolve(__orchestratorDir, "wait-job.mjs");
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function formatResetTime(ms) {
  if (!ms) return "manual reset";
  const diff = ms - Date.now();
  const hhmm = new Date(ms).toTimeString().slice(0, 5);
  if (diff <= 0) return "now";
  const mins = Math.ceil(diff / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${hhmm} (${h}h ${m}m)` : `${hhmm} (${m}m)`;
}

// Engines emit stable activity ids (tool call id, `thought_N`, `msg_...`) that may repeat across
// fallback attempts / retried turns. Namespacing by turn keeps rows unique so in-place merges are exact.
function attachTurnSigToJob(job, onActivity) {
  const prefix = `t${(job.turnSeq = (job.turnSeq || 0) + 1)}_`;
  return (ev) => {
    if (!ev || typeof ev !== "object" || !ev.id) return onActivity(ev);
    return onActivity({ ...ev, id: `${prefix}${ev.id}` });
  };
}

const ACTIVITY_LIMIT = 160;
const SHELL_LABEL = /^(?:pwsh|powershell|bash|sh|zsh|shell|exec|run_command|command):\s*/i;

function writeAtomicJson(target, value) {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

function parseLegacyActivity(type, summary) {
  const text = summary.trim();
  if (!text || ["start", "touch"].includes(type)) return null;
  const base = { kind: type, title: text, meta: "", status: "done", detail: "" };
  const thought = /^(?:思考|Reasoning)(?:\s*\(([\d.]+)s\))?[:：]\s*(.*)$/i.exec(text);
  if (thought || type === "thought") {
    return { ...base, kind: "thought", title: "", durationSec: thought?.[1] ? Number(thought[1]) : null, detail: thought?.[2] || text };
  }
  if (["output", "text", "message"].includes(type) || /^writing:/i.test(text)) {
    if (/^(?:message|review) \(\d+ chars\)$/.test(text)) return null;
    return { ...base, kind: "output", title: text.replace(/^writing:\s*/i, "") };
  }

  const completion = /^[✓✗]\s*/.exec(text);
  const commandExit = /^cmd \(exit=(-?\d+|null|undefined)\):\s*/i.exec(text);
  let body = text.slice((completion || commandExit)?.[0].length || 0);
  const exit = commandExit?.[1] || /\[exit\s+code:\s*(-?\d+)\]/i.exec(body)?.[1];
  const exitCode = /^-?\d+$/.test(exit || "") ? Number(exit) : null;
  const failed = completion?.[0].startsWith("✗") || type === "cmd_err" || (exitCode !== null && exitCode !== 0);
  let detail = "";
  let durationSec = null;
  if (completion || commandExit || type === "cmd_done" || type === "cmd_err") {
    const output = /\s+(?:→|—)\s+([\s\S]+)$/.exec(body);
    if (output) {
      detail = output[1].replace(/\[exit\s+code:\s*-?\d+\]/gi, "").trim();
      body = body.slice(0, output.index);
    }
    body = body.replace(/\[exit\s+code:\s*-?\d+\]/gi, "").trimEnd();
    const duration = /\s+\(([\d.]+)s\)$/.exec(body);
    if (duration) {
      durationSec = Number(duration[1]);
      body = body.slice(0, duration.index);
    }
  }
  const fields = { ...base, exitCode, durationSec, status: failed ? "error" : !completion && type === "cmd_start" ? "running" : "done" };
  const file = /^(read|view|open_file|read_file|edit|edit_file|write|write_file|create_file|files:)\s+(.+)$/i.exec(body);
  if (file) {
    const verb = file[1].toLowerCase();
    const kind = /^(read|view|open)/.test(verb) ? "read" : /^(write|create)/.test(verb) ? "write" : "edit";
    const range = /\s+#?L(\d+(?:-\d+)?)$/i.exec(file[2]);
    const target = range ? file[2].slice(0, range.index) : file[2];
    return { ...fields, kind, title: target.split(/[/\\]/).at(-1), meta: range ? `#L${range[1]}` : "" };
  }
  const search = /^(grep(?:_search)?|glob|find|search)\s+("[^"]*"|.+?)(?:\s+in\s+(.+))?$/i.exec(body);
  if (search) {
    const title = /^(grep|search)/i.test(search[1]) && !search[2].startsWith('"') ? `"${search[2]}"` : search[2];
    return { ...fields, kind: "search", title, meta: search[3] || "" };
  }
  if (completion || commandExit || SHELL_LABEL.test(body) || /^(?:running|tool):\s*/i.test(body)
      || ["cmd_start", "cmd_err", "cmd_done", "command"].includes(type)) {
    const title = body.replace(/^(?:running|tool):\s*/i, "").replace(SHELL_LABEL, "");
    return { ...fields, kind: "cmd", title, detail: detail ? `$ ${title}\n\n${detail}` : "" };
  }
  return { ...base, status: ["error", "stderr", "interrupt"].includes(type) ? "error" : "done" };
}

function parseLegacyLog(lines) {
  const rows = [];
  for (const [idx, line] of lines.entries()) {
    const m = /^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)$/.exec(line);
    const summary = (m?.[3] || line).trim();
    const ts = m?.[1] || "";
    let type = m?.[2] || "log";
    if (!m) {
      if (summary.startsWith("✓")) type = "cmd_done";
      else if (summary.startsWith("✗")) type = "cmd_err";
      else if (SHELL_LABEL.test(summary)) type = "cmd_start";
    }
    const parsed = parseLegacyActivity(type, summary);
    if (!parsed || (!m && parsed.kind === "log")) continue;
    const row = { id: `log_${idx}`, ts, type, summary, ...parsed };
    if (/^[✓✗]|^cmd \(exit=/.test(summary) || ["cmd_done", "cmd_err"].includes(type)) {
      const pending = (item) => item.status === "running" && item.kind === row.kind;
      const previous = rows.findLast((item) => pending(item) && item.title === row.title)
        || rows.findLast((item) => pending(item) && item.kind === "cmd" && (
          (item.title.endsWith("…") && row.title.startsWith(item.title.slice(0, -1)))
          || (row.title.endsWith("…") && item.title.startsWith(row.title.slice(0, -1)))
          || (summary.startsWith("cmd (exit=") && item.summary.startsWith("running:") && item.title.startsWith(row.title))
        ));
      if (previous) {
        Object.assign(previous, row, { id: previous.id, ts: previous.ts, title: previous.title });
        continue;
      }
    }
    if (row.kind === "output" && rows.at(-1)?.kind === "output") {
      Object.assign(rows.at(-1), row);
    } else {
      rows.push(row);
      if (rows.length > ACTIVITY_LIMIT) rows.shift();
    }
  }
  return rows;
}

function deriveSessionTitle(title, prompt) {
  const explicit = String(title || "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit.slice(0, 60);
  const raw = String(prompt || "")
    .replace(/[#*`>_\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > 42 ? `${raw.slice(0, 41).trimEnd()}…` : raw;
}

// Handoff / doorbell text is untrusted (engine output, commands, paths). Strip ANSI/control chars,
// redact obvious bearer tokens & key-shaped secrets, collapse whitespace and hard-bound the length.
export function sanitizeHandoffText(value, max = 160) {
  let text = String(value ?? "");
  text = text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  text = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  text = text.replace(/\b(?:sk|pk|api|token|secret|key)[-_][A-Za-z0-9_-]{10,}\b/gi, "[redacted]");
  text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  text = text.replace(/\s+/g, " ").trim();
  const limit = Math.max(8, Number(max) || 160);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

const NON_MEANINGFUL_ACTIVITY = new Set(["start", "touch", "log", "triage", "triage_alert", "steer", "interrupt", "fallback"]);

const TOOL_ACTIVITY_KINDS = new Set(["cmd", "read", "search", "edit", "write"]);
const EDIT_ACTIVITY_KINDS = new Set(["edit", "write"]);

/** Compact per-job performance & timing record written locally to `job-perf.jsonl`. */
export function summarizeJobPerf(job, pluginVersion = PLUGIN_VERSION) {
  const startedAt = Number(job.startedAt) || 0;
  const finishedAt = Number(job.finishedAt) || Date.now();
  const elapsedMs = startedAt > 0 ? Math.max(0, finishedAt - startedAt) : 0;
  const deltaOrNull = (ts) => (startedAt > 0 && Number.isFinite(ts) && ts >= startedAt ? ts - startedAt : null);

  let cmdCount = 0;
  let failedCmdCount = 0;
  let cmdDurationMs = 0;
  let thoughtCount = 0;
  let thoughtDurationMs = 0;
  let readSearchCount = 0;
  let editWriteCount = 0;
  for (const a of job.activities || []) {
    const kind = a?.kind || a?.type || "";
    const durSec = Number(a?.durationSec);
    if (kind === "cmd") {
      cmdCount++;
      if (a.status === "error" || (Number.isInteger(a.exitCode) && a.exitCode !== 0)) failedCmdCount++;
      if (Number.isFinite(durSec) && durSec > 0) cmdDurationMs += Math.round(durSec * 1000);
    } else if (kind === "thought") {
      thoughtCount++;
      if (Number.isFinite(durSec) && durSec > 0) thoughtDurationMs += Math.round(durSec * 1000);
    } else if (kind === "read" || kind === "search") {
      readSearchCount++;
    } else if (kind === "edit" || kind === "write") {
      editWriteCount++;
    }
  }

  return {
    pluginVersion: String(pluginVersion || PLUGIN_VERSION),
    jobId: job.jobId || "",
    role: job.role || "",
    slot: job.slot || "default",
    title: sanitizeHandoffText(job.title || "", 80),
    engine: job.engine || "",
    modelId: job.modelId || "",
    modelName: job.resolvedModel || job.modelDisplayName || job.engine || "",
    selectionMode: job.selectionMode || "ordered",
    requestedEffort: job.requestedEffort || "",
    appliedEffort: job.appliedEffort || job.requestedEffort || "",
    status: job.status || "unknown",
    elapsedMs,
    firstActivityMs: deltaOrNull(job.firstActivityAt),
    firstToolMs: deltaOrNull(job.firstToolAt),
    firstEditMs: deltaOrNull(job.firstEditAt),
    cmdCount,
    failedCmdCount,
    cmdDurationMs,
    thoughtCount,
    thoughtDurationMs,
    readSearchCount,
    editWriteCount,
    reused: Boolean(job.reused),
    resumedFromDisk: Boolean(job.resumedFromDisk),
    cacheReported: Boolean(job.cacheReported),
    hitRate: job.hitRate ?? null,
    contextPct: job.contextPct ?? null,
    ...(job.error ? { error: sanitizeHandoffText(job.error, 160) } : {}),
  };
}

// Last real action a job performed (read/edit/write/search/cmd/thought/output), sanitized + bounded.
export function lastMeaningfulAction(activities, max = 160) {
  const rows = Array.isArray(activities) ? activities : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const a = rows[i];
    const kind = a?.kind || a?.type || "";
    if (!kind || NON_MEANINGFUL_ACTIVITY.has(kind) || NON_MEANINGFUL_ACTIVITY.has(a?.type)) continue;
    const text = sanitizeHandoffText(a?.title || a?.summary || "", max);
    if (!text) continue;
    return {
      kind: String(kind).slice(0, 24),
      text,
      status: sanitizeHandoffText(a?.status || "", 24),
      at: typeof a?.ts === "string" ? a.ts.slice(0, 32) : "",
    };
  }
  return null;
}

function sanitizeConversationId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const clean = raw.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 128);
  return clean.length >= 2 ? clean : "";
}

function sanitizeModelChoice(value) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

// Upstream MCP client attribution carried on a job (v2 daemon). Purely informational.
export function sanitizeClientContext(clientContext) {
  if (!clientContext || typeof clientContext !== "object") return null;
  const clientId = typeof clientContext.clientId === "string" ? clientContext.clientId.trim().slice(0, 64) : "";
  if (!clientId) return null;
  return {
    clientId,
    clientLabel: typeof clientContext.clientLabel === "string" ? clientContext.clientLabel.trim().slice(0, 80) : "",
    iconKey: typeof clientContext.iconKey === "string" ? clientContext.iconKey.trim().slice(0, 40) : "generic",
  };
}

// Ordered (default) keeps the configured priority queue untouched. Smart promotes one explicit
// configured model to the front and keeps the remaining order as fallbacks. No judging call here.
// Resumes are pinned to the original engine/model so the session (and its Prompt Cache) stays reusable.
export function selectRoleModels({ role, queue = [], selectionMode = "ordered", requestedModelId = "", resumeRecord = null } = {}) {
  const mode = selectionMode === "smart" ? "smart" : "ordered";
  const models = Array.isArray(queue) ? queue.filter(Boolean) : [];
  const requested = sanitizeModelChoice(requestedModelId);
  const validIds = models.map((m) => m.id);
  const notes = [];

  if (resumeRecord?.modelId && resumeRecord?.engine) {
    const same = models.find((m) => m.id === resumeRecord.modelId);
    if (same) {
      if (same.engine === resumeRecord.engine) return { mode, models: [same], selected: same, notes, resumeForced: true };
    }
    return { mode, models: [], notes, error: `Restore the original model ${resumeRecord.modelId} (${resumeRecord.engine}) to the ${role} queue before continuing session ${resumeRecord.sessionId}.` };
  }

  if (!requested) return { mode, models, selected: models[0] || null, notes };

  const picked = models.find((m) => m.id === requested);
  if (!picked) {
    return {
      mode,
      models,
      selected: models[0] || null,
      notes,
      error:
        `[INVALID_MODEL_CHOICE] "${requested}" is not in the ${role} configured queue ` +
        `(selectionMode=${mode}). Valid ids: ${validIds.join(", ") || "(none)"}. ` +
        `Call agent_relay_session(action="status") for the live queue, or add the model in the A.stand panel first.`,
    };
  }
  if (mode !== "smart") {
    notes.push(
      `modelId="${requested}" ignored: ${role}.selectionMode is "ordered" (fixed priority queue). ` +
      `Set it to "smart" in the A.stand panel to pick a model per call.`
    );
    return { mode, models, selected: models[0], notes };
  }
  const rest = models.filter((m) => m.id !== picked.id);
  return { mode, models: [picked, ...rest], selected: picked, notes };
}

function describeCooldown(cd) {
  if (!cd) return "no cooldown";
  return `${cd.reason || "rate limited"}${cd.untilMs ? `, resets ${formatResetTime(cd.untilMs)}` : ", manual reset required"}`;
}

/**
 * Decide the terminal failure message once a job's model loop stops.
 *
 * `queue` must be the ROLE's full configured queue (not a resume-pinned subset): a pinned resumed
 * session intentionally skips cross-model fallback to protect its context, so it must never claim
 * every engine is exhausted while healthy alternatives remain. Returns null when the caller should
 * fall back to the raw last error.
 */
export function describeQueueExhaustion({
  role = "oracle",
  queue = [],
  getCooldown,
  pinnedModelId = "",
  lastErr = null,
} = {}) {
  const models = Array.isArray(queue) ? queue.filter(Boolean) : [];
  const cooldownOf = (id) => {
    try {
      return typeof getCooldown === "function" ? getCooldown(id) : null;
    } catch {
      return null;
    }
  };
  const healthy = models.filter((m) => !cooldownOf(m.id));
  const allCooled = models.length > 0 && healthy.length === 0;
  if (allCooled) {
    const details = models
      .map((m) => `${m.name || m.id} (${m.id}): ${describeCooldown(cooldownOf(m.id))}`)
      .join("; ");
    return (
      `[ALL_ENGINES_EXHAUSTED] Every AI in the ${role} priority queue hit its quota/balance limit. ` +
      `Pause external delegation and ask the user to disable A.stand, top up, or wait for quota reset. ` +
      `Queue: ${details}. Last error: ${lastErr?.message || ""}`
    );
  }

  const rateLimited = Boolean(lastErr?.isRateLimit || lastErr?.isQuotaDepleted);
  if (!pinnedModelId || !rateLimited) return null;
  const pinned = models.find((m) => m.id === pinnedModelId) || { id: pinnedModelId, name: pinnedModelId };
  const alternatives = healthy.filter((m) => m.id !== pinned.id);
  if (alternatives.length === 0) return null;
  const pinnedCd = cooldownOf(pinned.id);
  const altList = alternatives.map((m) => `${m.name || m.id} (${m.id})`).join(", ");
  return (
    `[SESSION_MODEL_RATE_LIMITED] Pinned session model "${pinned.name || pinned.id}" (${pinned.id}) hit its ` +
    `rate/quota limit (${describeCooldown(pinnedCd)}). This turn is pinned to that model to preserve session ` +
    `context, so A.stand did not silently switch models. Healthy alternatives in the ${role} queue: ${altList}. ` +
    `The Lead Agent can start a fresh session (omit sessionId) to automatically use a healthy model. ` +
    `Last error: ${lastErr?.message || ""}`
  );
}

// Pure silence decision shared by the class and tests. Never mutates the job.
// OFF  => the Lead is alerted directly at the silence threshold (no judging call).
// ON   => the gatekeeper judges first; a pending verdict or an existing alert short-circuits.
export function decideSilence({
  status = "running",
  hasAlert = false,
  silentMs = 0,
  triggerMs = 0,
  gatekeeperArmed = false,
  verdictPending = false,
} = {}) {
  if (status !== "running" || hasAlert) return { action: "none" };
  if (silentMs < triggerMs) return { action: "none" };
  if (!gatekeeperArmed) return { action: "alert", silentMs };
  if (verdictPending) return { action: "pending" };
  return { action: "judge", silentMs };
}

// Real progress resets the deferral budget and invalidates any in-flight verdict.
export function noteRealProgress(job) {
  if (!job || typeof job !== "object") return job;
  job.gatekeeperDeferrals = 0;
  job.gatekeeperLastVerdictAt = 0;
  return job;
}

// Existing `triage*` step type: `kind` is set explicitly so `#appendJobLog` never re-parses and
// drops `detail`. `detail` = what the job is doing (judge content), `summary` = one-line verdict.
export function buildTriageActivity({ summary, detail, type = "triage" } = {}) {
  return {
    type: type === "triage_alert" ? "triage_alert" : "triage",
    kind: type === "triage_alert" ? "triage_alert" : "triage",
    summary: sanitizeHandoffText(summary, 240),
    detail: sanitizeHandoffText(detail, TRIAGE_DETAIL_MAX),
    status: "done",
  };
}

function safeReadCheckpoint(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

export class RelayOrchestrator {
  constructor(store, telemetry, { extensionRegistry = null } = {}) {
    this.store = store;
    this.telemetry = telemetry;
    this.extensionRegistry = extensionRegistry;
    this.engines = {
      codex: new CodexEngine(() => this.store.settings.codexKeepOfficePlugins),
      "deepseek-harness": new AcpEngine(store.dataDir),
      "claude-code": new ClaudeCodeEngine(),
      antigravity: new AntigravityCliEngine(),
    };
    this.extensibleEngines = new Map(); // engineId -> { sig, engine }
    this.cliModelProbes = new Map(); // engineId -> Promise (non-blocking dashboard discovery)
    this.cliAccountSnapshots = new Map(); // engineId -> last non-sensitive account summary
    this.cliAccountProbes = new Map(); // engineId -> Promise (never blocks dashboard state)
    this.shuttingDown = false;
    this.jobs = new Map(); // jobId -> job state
    this.activeWriters = new Map(); // workspaceKey -> jobId
    this.stateListeners = new Set();
    this.#recoverOrphanedJobs();
  }

  // Resolve any preset/custom CLI engine on demand; built-in engines keep their dedicated adapters.
  #getEngine(engineId) {
    if (!engineId) return null;
    if (this.engines[engineId]) return this.engines[engineId];
    const def = findExtensibleCliDef(engineId, this.store.settings.customCliEngines || []);
    if (!def) return null;
    const sig = JSON.stringify([def.command, def.args, def.protocol, def.readOnlyMode, def.writeMode]);
    const cached = this.extensibleEngines.get(engineId);
    if (cached?.sig === sig) return cached.engine;
    const Engine = def.protocol === "headless" ? UniversalHeadlessEngine : UniversalAcpEngine;
    const engine = new Engine(def, resolveCliPresetBinary);
    this.extensibleEngines.set(engineId, { sig, engine });
    return engine;
  }

  // Dashboard model discovery must never block the panel. Cache hits are synchronous;
  // misses probe in the background and emit a state refresh ONLY when the catalog actually changes.
  #startCliModelProbe(engineId, engine, force = false) {
    if (this.shuttingDown) return;
    if (this.cliModelProbes.has(engineId)) return;
    const prevSig = JSON.stringify((engine.latestModels || []).map((m) => m?.id || ""));
    const probe = Promise.resolve()
      .then(() => (this.shuttingDown ? null : engine.listModels(force)))
      .then(async (models) => {
        let effective = Array.isArray(models) ? models : [];
        // Junie can list its full catalog with `junie list-models` even when logged out, while ACP
        // discovery may yield only the default entry. Backfill from the CLI JSON in that case.
        if (engineId === "junie" && !effective.some((model) => model && !model.isDefault)) {
          const discovered = await discoverJunieModels(engine.descriptor);
          if (discovered.length && !this.shuttingDown) {
            const placeholder = effective.find((model) => model?.isDefault) || {
              id: "cli:junie:default",
              modelName: "",
              displayName: "JetBrains Junie (Default)",
              displayNameZh: "JetBrains Junie（默认）",
              isDefault: true,
              engine: "junie",
            };
            engine.latestModels = [placeholder, ...discovered];
            engine.modelsFetchedAt = Date.now();
            effective = engine.latestModels;
          }
        }
        if (!Array.isArray(effective) || effective.length === 0) return;
        const nextSig = JSON.stringify(effective.map((m) => m?.id || ""));
        if (nextSig !== prevSig) {
          this.#emitStateChange("cli_models_ready", { engineId, count: effective.length });
        }
      })
      .catch(() => {})
      .finally(() => this.cliModelProbes.delete(engineId));
    this.cliModelProbes.set(engineId, probe);
  }

  invalidateCliCaches(engineId = "") {
    clearCliAccountCache(engineId);
    if (engineId) {
      this.cliAccountSnapshots.delete(engineId);
      const entry = this.extensibleEngines.get(engineId);
      entry?.engine?.invalidateModelsCache?.();
      if (entry?.engine?.listModels) this.#startCliModelProbe(engineId, entry.engine);
      return;
    }
    this.cliAccountSnapshots.clear();
    for (const entry of this.extensibleEngines.values()) {
      entry?.engine?.invalidateModelsCache?.();
    }
  }

  #cliAccountDef(engineId, info = {}) {
    if (info.command) return info;
    if (engineId === "codex") return { command: "codex" };
    if (engineId === "deepseek-harness") return { command: "dsh" };
    if (engineId === "doubao") return { command: "doubao" };
    if (engineId === "qoder-cn") return { command: "qoderclicn" };
    if (engineId === "qoder") return { command: "qodercli" };
    if (engineId === "minimax") return { command: "mcode" };
    if (engineId === "junie") return { command: "junie" };
    if (engineId === "kiro") return { command: "kiro-cli" };
    if (engineId === "codearts") return { command: "codearts" };
    return info;
  }

  #startCliAccountProbe(engineId, def) {
    if (this.shuttingDown || this.cliAccountProbes.has(engineId)) return;
    const prev = this.cliAccountSnapshots.get(engineId);
    const sigOf = (a) =>
      a ? JSON.stringify([a.status, a.loggedIn, a.username, a.email, a.userId, a.accountLabel, a.loginMethod]) : "";
    const prevSig = sigOf(prev);
    const probe = Promise.resolve()
      .then(() => probeCliAccountInfo(engineId, def, ""))
      .then((account) => {
        this.cliAccountSnapshots.set(engineId, account);
        if (sigOf(account) !== prevSig) {
          this.#emitStateChange("cli_account_ready", { engineId });
        }
      })
      .catch(() => {})
      .finally(() => this.cliAccountProbes.delete(engineId));
    this.cliAccountProbes.set(engineId, probe);
  }

  // Cold dashboard reads never spawn a CLI: cache hits are sync, misses probe in the background.
  #getCliAccountsSnapshot(engines) {
    const out = {};
    for (const engineId of ["codex", "deepseek-harness", "doubao", "minimax", "qoder-cn", "qoder", "opencode", "codebuddy", "junie", "kiro", "codearts"]) {
      const info = engines?.[engineId];
      if (!info) continue;
      if (!info.installed && !info.loggedIn) {
        out[engineId] = {
          engineId,
          status: "not_installed",
          loggedIn: false,
          accountLabel: "未安装",
          checkedAt: "",
        };
        continue;
      }
      const cached = getCachedCliAccountInfo(engineId, "");
      if (cached) {
        out[engineId] = cached;
        continue;
      }
      out[engineId] = this.cliAccountSnapshots.get(engineId) || {
        engineId,
        status: "probing",
        loggedIn: Boolean(info.loggedIn),
        accountLabel: "正在读取账号…",
        checkedAt: "",
      };
      this.#startCliAccountProbe(engineId, this.#cliAccountDef(engineId, info));
    }
    return out;
  }

  // ---- Lightweight state-change emitter (SSE consumers subscribe here) ----
  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  #emitStateChange(reason = "orchestrator_state", extra = {}) {
    for (const fn of this.stateListeners) {
      try {
        fn({ reason, ts: Date.now(), ...extra });
      } catch {}
    }
  }

  // Compact perf rollup for the console API (reads job-perf.jsonl written at job end).
  getPerfSummary(limit = 50) {
    const rows = typeof this.telemetry?.readJobPerf === "function"
      ? this.telemetry.readJobPerf(limit)
      : [];
    const byStatus = {};
    let elapsedMs = 0;
    let firstOutMs = 0;
    let firstOutCount = 0;
    let cmdCount = 0;
    let failedCmdCount = 0;
    for (const row of rows) {
      const status = String(row?.status || "unknown");
      byStatus[status] = (byStatus[status] || 0) + 1;
      if (Number.isFinite(Number(row?.elapsedMs))) elapsedMs += Number(row.elapsedMs);
      const firstVal = row?.firstOutputMs ?? row?.firstActivityMs;
      if (Number.isFinite(Number(firstVal))) {
        firstOutMs += Number(firstVal);
        firstOutCount += 1;
      }
      if (Number.isFinite(Number(row?.cmdCount))) cmdCount += Number(row.cmdCount);
      if (Number.isFinite(Number(row?.failedCmdCount))) failedCmdCount += Number(row.failedCmdCount);
    }
    const avgElapsed = rows.length ? Math.round(elapsedMs / rows.length) : 0;
    return {
      total: rows.length,
      totalJobs: rows.length,
      byStatus,
      avgElapsedMs: avgElapsed,
      avgDurationMs: rows.length ? avgElapsed : null,
      avgFirstOutputMs: firstOutCount ? Math.round(firstOutMs / firstOutCount) : null,
      cmdCount,
      failedCmdCount,
      recent: rows.slice(-10).reverse(),
    };
  }

  // ---- Status snapshots (zero-token doorbell for scripts/wait-job.mjs) ----

  #statusPath(jobId) {
    return path.join(this.store.dataDir, "jobs", `${jobId}.status.json`);
  }

  #eventsPath(jobId) {
    return path.join(this.store.dataDir, "jobs", `${jobId}.events.json`);
  }

  #readJobEvents(jobId) {
    try {
      const record = JSON.parse(fs.readFileSync(this.#eventsPath(jobId), "utf8"));
      return Array.isArray(record?.activities) ? record : null;
    } catch {
      return null;
    }
  }

  #saveJobEvents(job) {
    try {
      writeAtomicJson(this.#eventsPath(job.jobId), { prompt: job.promptPreview || "", activities: job.activities || [] });
    } catch {}
  }

  #readFinalText(jobId) {
    try {
      return fs.readFileSync(this.#outputPath(jobId), "utf8");
    } catch {
      return "";
    }
  }

  #outputPath(jobId) {
    return path.join(this.store.dataDir, "outputs", `${jobId}.txt`);
  }

  #buildStatusSnapshot(job, status = job.status) {
    const terminal = status !== "running";
    const endTs = terminal ? job.finishedAt || Date.now() : Date.now();
    const lastActivity = job.activities?.[job.activities.length - 1];
    const meaningful = lastMeaningfulAction(job.activities, RECOVER_ACTION_TEXT_MAX);
    return {
      jobId: job.jobId,
      role: job.role,
      slot: job.slot,
      title: job.title || "",
      cwd: job.cwd || "",
      originalCwd: job.originalCwd || job.cwd || "",
      sessionId: job.sessionId || "",
      engine: job.engine,
      sandbox: job.sandbox || "",
      taskSummary: sanitizeHandoffText(job.taskSummary || job.promptPreview || "", 1200),
      modelId: job.modelId || "",
      modelDisplayName: job.modelDisplayName || job.engine,
      status,
      pid: process.pid,
      lang: this.store.settings.lang === "en" ? "en" : "zh",
      startedAt: job.startedAt,
      updatedAt: Date.now(),
      lastActivityAt: job.lastActivityAt || job.startedAt,
      hitRate: job.hitRate ?? null,
      contextPct: job.contextPct ?? null,
      lastSummary: sanitizeHandoffText(job.lastSummary || lastActivity?.summary || "", 240),
      lastAction: meaningful,
      finishedAt: terminal ? endTs : null,
      elapsedSec: Number(((endTs - job.startedAt) / 1000).toFixed(1)),
      error: job.error || null,
      stallAlert: job.stallAlert || null,
      managedSilence: true,
      logPath: job.logPath || "",
      outputPath: this.#outputPath(job.jobId),
      // Durable handoff fields: lets the Lead recover/ACK exact jobs without guessing.
      ...(job.conversationId && { conversationId: job.conversationId }),
      ...(job.client && { client: job.client }),
      ...(job.worktree && { worktree: job.worktree }),
    };
  }

  // Atomic tmp+rename so wait-job.mjs never observes a half-written snapshot.
  #writeStatusSnapshot(job, { force = false, status = job.status } = {}) {
    const now = Date.now();
    if (!force && job.statusFileAt && now - job.statusFileAt < STATUS_WRITE_THROTTLE_MS) return;
    try {
      const target = this.#statusPath(job.jobId);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      writeAtomicJson(target, this.#buildStatusSnapshot(job, status));
      job.statusFileAt = now;
      this.#emitStateChange("job_status", { jobId: job.jobId });
    } catch {}
  }

  #saveJobOutput(job) {
    const text = job.finalText || job.result?.text;
    if (typeof text !== "string" || !text) return;
    try {
      const outFile = this.#outputPath(job.jobId);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, text, "utf8");
      job.outputPath = outFile;
    } catch {}
  }

  #markJobTerminal(job, status, error = "") {
    job.status = status;
    if (status === "failed") {
      const { role, engine, cwd, activities } = job;
      const hint = formatMappedDriveSandboxHint({ platform: process.platform, role, engine, cwd, activities, errorText: error });
      if (hint) error = error ? `${error}\n\n${hint}` : hint;
    }
    job.error = error || null;
    job.finishedAt = Date.now();
    for (const activity of job.activities || []) {
      if (activity.status === "running") activity.status = "interrupted";
    }
    this.#saveJobOutput(job);
    this.#saveJobEvents(job);
    this.#writeStatusSnapshot(job, { force: true, status });
    if (!job.perfRecorded && typeof this.telemetry?.recordJobPerf === "function") {
      job.perfRecorded = true;
      try {
        this.telemetry.recordJobPerf(summarizeJobPerf(job));
      } catch {}
    }
  }

  #finalizeWorktree(job, wt) {
    let notice;
    try {
      job.worktree = { ...wt, ...finalizeJobWorktree(wt) };
      if (job.worktree.pruned) return;
      notice =
        `[Git Worktree] Branch: ${wt.branch} · Path: ${wt.worktreeRoot} · changedFiles: ${job.worktree.changedFilesCount} · commits: ${job.worktree.commitsCount}\n` +
        `Review and commit any pending changes, then run from the source checkout: \`git merge ${wt.branch}\` and \`git worktree remove "${wt.worktreeRoot}"\`.`;
    } catch (err) {
      job.worktree = { ...wt, pruned: false, error: err?.message || String(err) };
      notice = `[Git Worktree] Automatic cleanup failed for ${wt.branch} at ${wt.worktreeRoot}. Inspect the worktree and branch before cleanup.`;
    }
    job.worktreeNotice = `\n\n${notice}`;
    if (job.result) job.result.text += job.worktreeNotice;
    if (job.finalText || !job.result) job.finalText = (job.finalText || "") + job.worktreeNotice;
  }

  // Startup crash detection: any snapshot still "running" under another PID belongs to a host that died.
  #recoverOrphanedJobs() {
    const jobsDir = path.join(this.store.dataDir, "jobs");
    let names = [];
    try {
      names = fs.readdirSync(jobsDir).filter((n) => n.endsWith(".status.json"));
    } catch {
      return;
    }
    const days = this.store.settings.retentionDays;
    const cutoff = days && days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
    for (const name of names) {
      const filePath = path.join(jobsDir, name);
      let snap;
      try {
        if (cutoff) {
          const st = fs.statSync(filePath);
          if (st.mtimeMs < cutoff) continue;
        }
        snap = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        continue;
      }
      if (!/^[a-zA-Z0-9_-]{3,48}$/.test(snap?.jobId || "")) continue;
      if (snap.status !== "running" || !snap.pid || isProcessAlive(snap.pid)) continue;
      if (this.jobs.has(snap.jobId)) continue;

      const finishedAt = Number(snap.updatedAt) || Date.now();
      const recovered = {
        ...snap,
        status: "interrupted",
        finishedAt,
        updatedAt: Date.now(),
        error: CRASH_RECOVERY_ERROR,
        hostInterrupted: true,
        elapsedSec: Number(((finishedAt - (Number(snap.startedAt) || finishedAt)) / 1000).toFixed(1)),
      };
      const diskTimeline = this.#readJobEvents(recovered.jobId);
      const job = {
        jobId: recovered.jobId,
        role: recovered.role || "oracle",
        slot: recovered.slot || "default",
        title: recovered.title || "",
        cwd: recovered.cwd || "",
        engine: recovered.engine || "",
        modelId: recovered.modelId || "",
        modelDisplayName: recovered.modelDisplayName || recovered.engine || "",
        sessionId: recovered.sessionId || "",
        conversationId: recovered.conversationId || "",
        status: "interrupted",
        startedAt: Number(recovered.startedAt) || finishedAt,
        lastActivityAt: Number(recovered.lastActivityAt) || finishedAt,
        lastCheckinAt: finishedAt,
        lastSummary: recovered.lastSummary || "",
        lastAction: recovered.lastAction || null,
        logPath: recovered.logPath || "",
        outputPath: recovered.outputPath || this.#outputPath(recovered.jobId),
        worktree: recovered.worktree,
        promptPreview: diskTimeline?.prompt || "",
        activities: diskTimeline?.activities || this.#readLegacyLog(recovered.jobId)?.activities || [],
        result: null,
        error: CRASH_RECOVERY_ERROR,
        finishedAt,
        recovered: true,
        dismissed: false,
        waiters: [],
      };
      if (!job.taskSummary) job.taskSummary = job.promptPreview.slice(0, 1200);
      for (const activity of job.activities) {
        if (activity.status === "running") activity.status = "interrupted";
      }
      this.#saveJobEvents(job);
      try { writeAtomicJson(filePath, recovered); } catch {}
      this.jobs.set(job.jobId, job);
    }
  }

  // User acknowledged the crash warning banner; the job stays in history as interrupted.
  dismissInterrupted(jobId) {
    const job = jobId ? this.jobs.get(jobId) : null;
    if (job && job.status === "interrupted") {
      job.dismissed = true;
      return { ok: true, text: `Dismissed interrupted job ${job.jobId}.` };
    }
    let count = 0;
    for (const j of this.jobs.values()) {
      if (j.status === "interrupted" && !j.dismissed) {
        j.dismissed = true;
        count++;
      }
    }
    return { ok: count > 0, text: count > 0 ? `Dismissed ${count} interrupted job(s).` : "No interrupted jobs." };
  }

  #interruptedJobs({ includeDismissed = false } = {}) {
    const now = Date.now();
    return Array.from(this.jobs.values())
      .filter((j) => j.recovered && j.status === "interrupted" && (includeDismissed || !j.dismissed))
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))
      .map((j) => ({
        ...this.#summarizeJob(j, now),
        modelId: j.modelId || "",
        conversationId: j.conversationId || "",
        sessionId: j.sessionId || "",
        cwd: j.cwd || "",
        error: j.error || CRASH_RECOVERY_ERROR,
        lastSummary: j.lastSummary || "",
        lastAction: j.lastAction || lastMeaningfulAction(j.activities, RECOVER_ACTION_TEXT_MAX),
        outputPath: j.outputPath || this.#outputPath(j.jobId),
        ack: this.store.getReceipt(j.jobId, "result_ack"),
        userAccepted: Boolean(this.store.getReceipt(j.jobId, "user_accept")),
      }));
  }

  #checkEnabled() {
    if (!this.store.settings.enabled) {
      return {
        blocked: true,
        message:
          "A.stand master switch is OFF. External subagents are disabled — handle this task directly or wait for the user to enable A.stand in the side panel.",
      };
    }
    return { blocked: false };
  }

  // Skills / templates compiled for this role, appended to the Turn-1 rules only.
  // Turn 2+ returns "" so a reused session keeps an identical prefix (Prompt Cache).
  #roleTurn1Rules(roleCfg, role, isFirstTurn) {
    if (!isFirstTurn || !this.extensionRegistry) return roleCfg?.customRules;
    let compiled = "";
    try {
      compiled = this.extensionRegistry.compileForRole(role)?.promptText || "";
    } catch {
      compiled = "";
    }
    return mergeTurn1Rules(roleCfg?.customRules, compiled);
  }

  #runningJobs() {
    return Array.from(this.jobs.values()).filter((j) => j.status === "running");
  }

  #trimOutputIfHuge(text, jobId) {
    if (!text || text.length <= MAX_INLINE_TEXT) return text;
    // Full transcript is always persisted to outputs/<jobId>.txt when the job finishes.
    const outFile = this.#outputPath(jobId);
    const head = text.slice(0, 12_000);
    const tail = text.slice(-4_000);
    return `${head}\n\n...[truncated ${text.length - 16_000} chars — full output saved to ${outFile}]...\n\n${tail}`;
  }

  // Keep only the structured fields the timeline understands (mirrors the .log line format).
  #activityFields(entry) {
    return {
      type: entry.type || "log",
      summary: String(entry.summary ?? ""),
      kind: entry.kind || "",
      title: entry.title || "",
      meta: entry.meta || "",
      added: Number.isFinite(Number(entry.added)) ? Number(entry.added) : 0,
      removed: Number.isFinite(Number(entry.removed)) ? Number(entry.removed) : 0,
      exitCode: Number.isInteger(entry.exitCode) ? entry.exitCode : null,
      durationSec: entry.durationSec == null || entry.durationSec === "" ? null : Number(entry.durationSec),
      status: entry.status || "",
      detail: String(entry.detail || ""),
    };
  }

  #appendJobLog(job, entry) {
    if (entry.type === "touch") return;
    if (!Array.isArray(job.activities)) job.activities = [];
    const id = entry.id ? String(entry.id) : `activity_${(job.activitySeq = (job.activitySeq || 0) + 1)}`;
    const fields = this.#activityFields(entry);
    if (!fields.kind) {
      Object.assign(fields, parseLegacyActivity(fields.type, fields.summary));
    }

    const existing = job.activities.find((a) => a.id === id);
    if (existing) {
      const logUpdate = existing.status !== fields.status && existing.summary !== fields.summary;
      Object.assign(existing, fields);
      if (logUpdate) this.#writeLogLine(job, fields);
      job.lastSummary = fields.summary.slice(0, 240);
      return;
    }

    const row = { id, ts: new Date().toISOString(), ...fields };
    job.activities.push(row);
    if (job.activities.length > ACTIVITY_LIMIT) job.activities.splice(0, job.activities.length - ACTIVITY_LIMIT);
    this.#writeLogLine(job, row, row.ts);
    job.lastSummary = fields.summary.slice(0, 240);
  }

  #writeLogLine(job, entry, ts) {
    const stamp = String(ts || "").includes("T") ? String(ts).slice(11, 19) : new Date().toISOString().slice(11, 19);
    const line = `[${stamp}] [${entry.type}] ${entry.summary}\n`;
    try {
      fs.appendFileSync(job.logPath, line, "utf8");
    } catch {}
  }

  // Streamed activity from engines: refresh liveness, log it, then publish a (throttled) status snapshot.
  #recordActivity(job, ev) {
    if (job.status !== "running") return;
    const now = Date.now();
    job.lastActivityAt = now;
    if (ev?.type && ev.type !== "touch") {
      this.#noteRealProgress(job);
      const kind = ev.kind || ev.type;
      if (!job.firstActivityAt && !NON_MEANINGFUL_ACTIVITY.has(kind)) job.firstActivityAt = now;
      if (!job.firstToolAt && TOOL_ACTIVITY_KINDS.has(kind)) job.firstToolAt = now;
      if (!job.firstEditAt && EDIT_ACTIVITY_KINDS.has(kind)) job.firstEditAt = now;
    }
    this.#appendJobLog(job, ev);
    this.#writeStatusSnapshot(job);
  }

  #onSessionReady(job, sid) {
    if (job.status !== "running") return;
    job.sessionId = sid || "";
    this.#writeStatusSnapshot(job, { force: true });
    if (sid && job.interruptRequested) {
      const model = this.store.getModelById(job.modelId);
      void this.#getEngine(job.engine)?.interruptTurn?.(sid, model)?.catch(() => {});
    }
  }

  // Structured timeline row for the UI (every field is optional; legacy rows fall back gracefully).
  #timelineRow(a) {
    return {
      id: a.id || "",
      ts: a.ts || "",
      type: a.type || "log",
      summary: a.summary || "",
      kind: a.kind || "",
      title: a.title || "",
      meta: a.meta || "",
      added: a.added || 0,
      removed: a.removed || 0,
      durationSec: a.durationSec ?? null,
      exitCode: a.exitCode ?? null,
      status: a.status || "",
    };
  }

  #readCodexConfiguredModel() {
    const def = (this.engines.codex?.latestModels || []).find((m) => m?.isDefault && m?.modelName);
    if (def?.modelName) return def.modelName;
    try {
      const tomlPath = path.join(os.homedir(), ".codex", "config.toml");
      if (!fs.existsSync(tomlPath)) return "";
      const raw = fs.readFileSync(tomlPath, "utf8");
      const m = /^\s*model\s*=\s*["']([^"']+)["']/m.exec(raw);
      return m?.[1]?.trim() || "";
    } catch {
      return "";
    }
  }

  #displayModelName(model) {
    if (!model) return "";
    if (model.engine === "codex" && (!model.modelName || model.id === "cli-codex-default")) {
      const configured = this.#readCodexConfiguredModel();
      if (configured) return `${configured} (Codex CLI)`;
    }
    return model.name || model.modelName || model.engine || "";
  }

  #hasMeaningfulProgress(job) {
    return (job.activities || []).some((activity) => {
      const kind = String(activity?.kind || activity?.type || "");
      if (!HANDOFF_PROGRESS_KINDS.has(kind) || activity?.type === "error") return false;
      if (kind === "cmd" && activity?.status === "running") return false;
      return Boolean(String(activity?.summary || activity?.title || "").trim());
    });
  }

  #handoffOutput(job) {
    const rows = (job.activities || []).slice(-20);
    return rows
      .map((activity) => String(activity?.detail || activity?.summary || "").trim())
      .filter(Boolean)
      .join("\n")
      .slice(-HANDOFF_OUTPUT_LIMIT);
  }

  #formatJobModelDisplay(j) {
    if (!j) return "";
    if (j.resolvedModel) {
      if (j.engine === "codex" && !String(j.resolvedModel).includes("Codex")) {
        return `${j.resolvedModel} (Codex CLI)`;
      }
      return String(j.resolvedModel);
    }
    if (j.engine === "codex" && (!j.modelDisplayName || j.modelDisplayName === "GPT (Codex)")) {
      const configured = this.#readCodexConfiguredModel();
      if (configured) return `${configured} (Codex CLI)`;
    }
    return j.modelDisplayName || j.engine || "";
  }

  // Compact, UI-safe projection of a job (shared by activeJobs / recentJobs / job detail).
  #summarizeJob(j, now = Date.now()) {
    const running = j.status === "running";
    const endTs = running ? now : j.finishedAt || now;
    return {
      jobId: j.jobId,
      role: j.role,
      slot: j.slot,
      title: j.title || "",
      cwd: j.cwd || "",
      sessionId: j.sessionId || "",
      engine: j.engine,
      modelId: j.modelId || "",
      modelDisplayName: this.#formatJobModelDisplay(j),
      status: j.status,
      elapsedSec: Number(((endTs - j.startedAt) / 1000).toFixed(1)),
      // Silent time only keeps ticking for live jobs; finished jobs freeze at their last activity.
      silentSec: Number((((running ? now : endTs) - j.lastActivityAt) / 1000).toFixed(1)),
      startedAt: j.startedAt,
      finishedAt: j.finishedAt || null,
      hitRate: j.hitRate ?? null,
      contextPct: j.contextPct ?? null,
      activityCount: j.activities?.length || 0,
      // `detail` is omitted here on purpose so agent_relay_ui_get_state stays lightweight.
      recentActivities: (j.activities || []).filter((a) => !["start", "log"].includes(a.kind || a.type))
        .slice(-4).map((a) => this.#timelineRow(a)),
      lastSummary: j.lastSummary || "",
      lastAction: j.lastAction || lastMeaningfulAction(j.activities, RECOVER_ACTION_TEXT_MAX),
      logPath: j.logPath,
      outputPath: j.outputPath || (running ? "" : this.#outputPath(j.jobId)),
      ...(j.conversationId && { conversationId: j.conversationId }),
      ...(j.client && { client: j.client }),
      ...(j.worktree && { worktree: j.worktree }),
      error: j.error || "",
    };
  }

  #readDiskRecentJobs(limit, seenIds, now) {
    const jobsDir = path.join(this.store.dataDir, "jobs");
    if (!fs.existsSync(jobsDir)) return [];
    const days = Number(this.store.settings.retentionDays) || 0;
    const cutoff = days > 0 ? now - days * 86_400_000 : 0;
    let files;
    try {
      files = fs.readdirSync(jobsDir).filter((f) => f.endsWith(".status.json"));
    } catch {
      return [];
    }
    const candidates = [];
    for (const file of files) {
      const jobId = file.slice(0, -".status.json".length);
      if (!jobId || seenIds.has(jobId)) continue;
      const fullPath = path.join(jobsDir, file);
      try {
        const st = fs.statSync(fullPath);
        if (cutoff && st.mtimeMs < cutoff) continue;
        candidates.push({ jobId, fullPath, mtimeMs: st.mtimeMs });
      } catch {}
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const out = [];
    for (const item of candidates.slice(0, Math.max(limit * 2, 40))) {
      try {
        const snap = JSON.parse(fs.readFileSync(item.fullPath, "utf8"));
        if (!snap || typeof snap !== "object") continue;
        const startedAt = Number(snap.startedAt) || item.mtimeMs;
        if (cutoff && startedAt < cutoff) continue;
        out.push({
          jobId: snap.jobId || item.jobId,
          role: snap.role || "oracle",
          slot: snap.slot || "default",
          title: snap.title || "",
          cwd: snap.cwd || "",
          sessionId: snap.sessionId || "",
          engine: snap.engine || "",
          modelId: snap.modelId || "",
          modelDisplayName: this.#formatJobModelDisplay(snap),
          status: snap.status === "running" ? "interrupted" : snap.status || (snap.error ? "failed" : "completed"),
          elapsedSec: snap.elapsedSec ?? null,
          silentSec: null,
          startedAt,
          finishedAt: snap.finishedAt || null,
          hitRate: snap.hitRate ?? null,
          contextPct: snap.contextPct ?? null,
          activityCount: Number(snap.activityCount) || 0,
          recentActivities: [],
          lastSummary: snap.lastSummary || "",
          lastAction: snap.lastAction || "",
          logPath: path.join(jobsDir, `${item.jobId}.log`),
          outputPath: this.#outputPath(item.jobId),
          ...(snap.conversationId && { conversationId: snap.conversationId }),
          ...(snap.client && { client: snap.client }),
          ...(snap.worktree && { worktree: snap.worktree }),
          error: snap.error || "",
        });
      } catch {}
    }
    return out;
  }

  // Newest-first jobs covering running, completed and failed states (memory + persisted disk snapshots).
  #recentJobs(limit) {
    const now = Date.now();
    const mem = Array.from(this.jobs.values()).map((j) => this.#summarizeJob(j, now));
    const seen = new Set(mem.map((j) => j.jobId));
    const disk = this.#readDiskRecentJobs(limit, seen, now);
    return [...mem, ...disk]
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit);
  }

  formatTelemetryFooter(meta) {
    const u = meta.usage;
    const cacheLabel = ["last-provider-step", "last-assistant-step"].includes(meta.usageScope) ? "cache (last step)" : "cache";
    const hitStr = u?.cacheReported
      ? `${u.hitRate}% (${u.cachedInputTokens.toLocaleString()} / ${u.totalInputTokens.toLocaleString()})`
      : "N/A (unreported)";
    const ctxStr = u?.contextPct != null ? ` | ctx ${u.contextPct}%` : "";
    const modeStr = meta.resumedFromDisk ? "resumed" : meta.reused ? "warm" : "new";
    const fbStr = meta.fallbackNote ? ` · ${meta.fallbackNote}` : "";
    const sidStr = meta.sessionId ? ` · sessionId=${meta.sessionId}` : "";
    return `[A.stand · ${meta.role}${meta.slot && meta.slot !== "default" ? `:${meta.slot}` : ""} · ${meta.resolvedModel} (${meta.engine}) · ${modeStr}${fbStr}${sidStr} · ${cacheLabel} ${hitStr}${ctxStr} · ${(meta.elapsedMs / 1000).toFixed(1)}s]`;
  }

  async #syncCodexQuotaAndCooldowns(models) {
    const hasCodex = models.some((m) => m.engine === "codex");
    if (!hasCodex) return null;
    const rl = await this.engines.codex.readRateLimits(false);
    if (!rl) return null;
    const exhausted =
      Boolean(rl.rateLimitReachedType) ||
      (rl.primary?.usedPercent != null && rl.primary.usedPercent >= 100);
    for (const m of models) {
      if (m.engine !== "codex") continue;
      if (exhausted) {
        const untilMs =
          rl.primary?.resetsAtMs ||
          rl.secondary?.resetsAtMs ||
          Date.now() + 5 * 60 * 60 * 1000;
        this.store.setCooldown(m.id, {
          untilMs,
          reason: rl.rateLimitReachedType || "5h_quota_exhausted",
        });
      } else {
        const cd = this.store.getActiveCooldown(m.id);
        if (
          cd &&
          (cd.reason?.includes("quota") || cd.reason === "rate_limit_reached") &&
          rl.primary?.usedPercent != null &&
          rl.primary.usedPercent < 100
        ) {
          this.store.clearCooldown(m.id);
        }
      }
    }
    return rl;
  }

  #isZh() {
    return this.store.settings.lang !== "en";
  }

  // Compact bilingual-safe phrasing for check-in headlines. `lang` follows the user's existing setting.
  #checkinLabels() {
    const zh = this.#isZh();
    return {
      stillRunning: zh ? "仍在运行（未打断）" : "still running (untouched)",
      elapsed: zh ? "已运行" : "elapsed",
      silent: zh ? "静默" : "silent",
      lastAction: zh ? "最近动作" : "last action",
      errors: zh ? "近期错误" : "recent errors",
      recent: zh ? "近期活动" : "recent activity",
      noActivity: zh ? "暂无命令或文本输出" : "(no commands or text streamed yet)",
      options: zh ? "主 Agent 可选动作" : "Lead Agent options",
      inspect: zh ? "不打断地查看完整日志" : "inspect the full log without interrupting",
      keepWaiting: zh ? "继续等待" : "keep waiting",
      steer: zh ? "改方向（Codex）" : "steer (Codex)",
      stop: zh ? "停止子 Agent" : "stop the subagent",
      session: zh ? "会话" : "session",
      log: zh ? "日志" : "log",
      rearm: zh ? "重新挂钟（下一段巡检）" : "re-arm the doorbell (next interval)",
      checkpoint: zh ? "检查点" : "checkpoint",
      gatekeeper: zh ? "守门员" : "gatekeeper",
    };
  }

  // Distinct, machine-readable event for long-run check-ins. `wait-job.mjs` exits 5 on this.
  #longRunEvent(job, reason) {
    const elapsedSec = Number(((Date.now() - job.startedAt) / 1000).toFixed(1));
    const silentSec = Number(((Date.now() - job.lastActivityAt) / 1000).toFixed(1));
    const action = lastMeaningfulAction(job.activities, RECOVER_ACTION_TEXT_MAX);
    return {
      exitCode: 5,
      event: "long_run_checkin",
      kind: reason,
      jobId: job.jobId,
      role: job.role,
      slot: job.slot || "default",
      title: sanitizeHandoffText(job.title || "", 60),
      engine: job.engine || "",
      modelId: job.modelId || "",
      sessionId: job.sessionId || "",
      conversationId: job.conversationId || "",
      cwd: job.cwd || "",
      elapsedSec,
      silentSec,
      lastAction: action,
      lastSummary: sanitizeHandoffText(job.lastSummary || "", 160),
      logPath: job.logPath || "",
      outputPath: job.outputPath || this.#outputPath(job.jobId),
      checkpointPath: this.#checkpointPath(job.jobId),
      longRunCheckinMin: Number(this.store.settings.longRunCheckinMin) || 0,
      silentCheckinMin: Number(this.store.settings.silentCheckinMin) || 0,
      worktree: job.worktree || null,
      at: Date.now(),
    };
  }

  #checkpointPath(jobId) {
    return path.join(this.store.dataDir, "jobs", `${jobId}.checkpoint.json`);
  }

  // Durable, idempotent checkpoint so a restarted waiter / restarted host can re-arm the interval.
  #writeCheckpoint(job, reason, extra = {}) {
    const event = this.#longRunEvent(job, reason);
    const prior = safeReadCheckpoint(this.#checkpointPath(job.jobId));
    const checkpoint = {
      version: 1,
      jobId: job.jobId,
      role: job.role,
      title: event.title,
      sessionId: event.sessionId,
      conversationId: event.conversationId,
      cwd: event.cwd,
      engine: event.engine,
      modelId: event.modelId,
      worktree: event.worktree,
      lastAction: event.lastAction,
      lastSummary: event.lastSummary,
      logPath: event.logPath,
      outputPath: event.outputPath,
      taskSummary: sanitizeHandoffText(job.taskSummary || job.promptPreview || "", 1200),
      longRunCheckinMin: event.longRunCheckinMin,
      silentCheckinMin: event.silentCheckinMin,
      rearmToken: `rearm_${crypto.randomBytes(8).toString("hex")}`,
      rearmCount: (Number(prior?.rearmCount) || 0) + 1,
      rearmAfterMs: Math.max(60_000, (Number(this.store.settings.longRunCheckinMin) || 10) * 60_000),
      reason,
      ...extra,
      updatedAt: Date.now(),
      firstAt: prior?.firstAt || Date.now(),
    };
    try {
      fs.mkdirSync(path.dirname(this.#checkpointPath(job.jobId)), { recursive: true });
      writeAtomicJson(this.#checkpointPath(job.jobId), checkpoint);
    } catch {}
    return checkpoint;
  }

  #doorbellRearmCommand(jobId, extraArgs = "") {
    const longRunMin = Number(this.store.settings.longRunCheckinMin) || 0;
    const args = [
      `--data-dir "${this.store.dataDir}"`,
      `--stall-sec ${Math.max(60, (Number(this.store.settings.silentCheckinMin) || 3) * 60)}`,
      longRunMin > 0 ? `--long-run-min ${longRunMin}` : "",
      `--rearm`,
      extraArgs.trim(),
      jobId,
    ].filter(Boolean);
    return `node "${resolveWaitJobScript()}" ${args.join(" ")}`;
  }

  async #buildCheckinReport(job, reason, detail = "summary") {
    const elapsedSec = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    const silentSec = ((Date.now() - job.lastActivityAt) / 1000).toFixed(1);
    const labels = this.#checkinLabels();
    const isLongRun = reason === "long_run_checkin";
    const action = lastMeaningfulAction(job.activities, RECOVER_ACTION_TEXT_MAX);
    const checkpoint = isLongRun ? this.#writeCheckpoint(job, reason) : null;
    const rearm = isLongRun ? this.#doorbellRearmCommand(job.jobId) : this.#doorbellCommand(job.jobId);
    const sid = job.sessionId || "(none)";
    const title = sanitizeHandoffText(job.title || job.jobId, 60);
    const actionLine = action
      ? `${labels.lastAction}: [${action.kind}] ${sanitizeHandoffText(action.text, 140)}`
      : `${labels.lastAction}: (none)`;

    let fullLog = "";
    try {
      if (fs.existsSync(job.logPath)) {
        fullLog = fs.readFileSync(job.logPath, "utf8");
      }
    } catch {}

    if (detail === "full") {
      const tail =
        fullLog.length > 16_000
          ? fullLog.slice(-16_000)
          : fullLog || "(no activity logged yet)";
      return {
        status: reason,
        event: isLongRun ? "long_run_checkin" : reason,
        exitCode: isLongRun ? 5 : null,
        jobId: job.jobId,
        sessionId: job.sessionId || "",
        conversationId: job.conversationId || "",
        elapsedSec: Number(elapsedSec),
        silentSec: Number(silentSec),
        lastAction: action,
        logPath: job.logPath,
        checkpointPath: checkpoint ? this.#checkpointPath(job.jobId) : "",
        rearm,
        text: [
          `[Non-Interrupting Inspection · ${reason}] Job ${job.jobId} (${job.role}:${job.slot || "default"} · ${title}) is STILL RUNNING — ${labels.stillRunning}.`,
          `${labels.elapsed}: ${elapsedSec}s | ${labels.silent}: ${silentSec}s | ${labels.session}: ${sid}`,
          actionLine,
          `${labels.log}: ${job.logPath}`,
          `--- Full Recent Activity ---`,
          tail,
          `--- ${labels.options} ---`,
          `1) ${labels.keepWaiting}: agent_relay_poll(jobId="${job.jobId}")`,
          `2) ${labels.steer}: agent_relay_session(action="steer", sessionId="${sid}", message="...")`,
          `3) ${labels.stop}: agent_relay_session(action="interrupt", jobId="${job.jobId}")`,
          `4) ${labels.rearm}: ${rearm}`,
        ].join("\n"),
      };
    }

    // Error-prioritized structured extraction (always computed for gating & fallback)
    const errors = job.activities
      .filter((a) => a.type === "error" || /exit=[1-9]\b/.test(a.summary))
      .slice(-6);
    const recent = job.activities.slice(-8);
    const structuredBlock = [
      errors.length > 0
        ? `${labels.errors}:\n${errors.map((e) => `  ! ${sanitizeHandoffText(e.summary, 140)}`).join("\n")}`
        : null,
      recent.length > 0
        ? `${labels.recent} (${recent.length}):\n${recent.map((a) => `  - [${String(a.ts || "").slice(11, 19)}] ${sanitizeHandoffText(a.summary, 120)}`).join("\n")}`
        : `${labels.recent}: ${labels.noActivity}`,
    ]
      .filter(Boolean)
      .join("\n");

    const aiSummary = job.stallAlert?.verdict
      ? `${this.#isZh() ? "判定" : "verdict"}: ${job.stallAlert.verdict} · ${job.stallAlert.reason}`
      : "";
    const stallLine = job.stallAlert
      ? `${labels.stall}: ${sanitizeHandoffText(job.stallAlert.reason, GATEKEEPER_REASON_MAX)} (${sanitizeHandoffText(job.stallAlert.source || "silence_timeout", 24)})`
      : "";

    return {
      status: reason,
      event: isLongRun ? "long_run_checkin" : reason,
      exitCode: isLongRun ? 5 : null,
      jobId: job.jobId,
      sessionId: job.sessionId || "",
      conversationId: job.conversationId || "",
      elapsedSec: Number(elapsedSec),
      silentSec: Number(silentSec),
      lastAction: action,
      logPath: job.logPath,
      checkpointPath: checkpoint ? this.#checkpointPath(job.jobId) : "",
      rearm,
      text: [
        // "STILL RUNNING" is a stable machine-readable token shared with the e2e auto-poll loop.
        isLongRun
          ? `[Non-Interrupting Check-in · long_run_checkin · exit 5] Job ${job.jobId} (${job.role}:${job.slot || "default"} · ${title}) is STILL RUNNING — ${labels.stillRunning}.`
          : `[Non-Interrupting Check-in · ${reason}] Job ${job.jobId} (${job.role}:${job.slot || "default"} · ${title}) is STILL RUNNING — ${labels.stillRunning}.`,
        `${labels.elapsed}: ${elapsedSec}s | ${labels.silent}: ${silentSec}s | ${labels.session}: ${sid}`,
        actionLine,
        stallLine || null,
        aiSummary
          ? `--- Inspector AI Summary ---\n${aiSummary}${errors.length > 0 ? `\n\n${labels.errors}:\n${errors.slice(-3).map((e) => `  ! ${sanitizeHandoffText(e.summary, 140)}`).join("\n")}` : ""}`
          : structuredBlock,
        `--- ${labels.options} ---`,
        `• ${labels.inspect}: agent_relay_poll(jobId="${job.jobId}", waitSec=0, detail="full")`,
        `• ${labels.keepWaiting}: agent_relay_poll(jobId="${job.jobId}")`,
        `• ${labels.steer}: agent_relay_session(action="steer", sessionId="${sid}", message="...")`,
        `• ${labels.stop}: agent_relay_session(action="interrupt", jobId="${job.jobId}")`,
        isLongRun
          ? `• ${labels.rearm}: ${rearm}${checkpoint ? ` · ${labels.checkpoint}: ${this.#checkpointPath(job.jobId)}` : ""}`
          : `• ${labels.log}: ${job.logPath}`,
      ].filter(Boolean).join("\n"),
    };
  }

  async #triageStallWithGatekeeper(model, job, elapsedSec, silentSec) {
    const zh = this.#isZh();
    try {
      const cleanBase = model.baseUrl.replace(/\/+$/, "");
      const recentLines = (job.activities || [])
        .slice(-30)
        .map((a) => `[${String(a.ts || "").slice(11, 19)}] [${a.type}] ${sanitizeHandoffText(a.summary, 200)}`)
        .join("\n");
      const taskGoal = sanitizeHandoffText(job.taskSummary || job.title || "(unspecified)", 1200);
      const action = lastMeaningfulAction(job.activities, 200);
      const langLine = zh
        ? "Write REASON and SUMMARY in concise Simplified Chinese (简体中文); keep VERDICT tokens in English."
        : "Write REASON and SUMMARY in concise English.";
      const res = await fetch(`${cleanBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.modelName,
          temperature: 0.1,
          max_tokens: 220,
          messages: [
            {
              role: "system",
              content:
                "You are a strict 2-choice Stall Gatekeeper watching a background coding subagent. You NEVER steer or edit code. Read ONLY the Task Goal and the last 30 X-ray activity lines, then output EXACTLY three lines:\nVERDICT: CONTINUE   (normal slow progress such as compiling, running tests, downloading, or long reasoning — do NOT wake the Lead Agent)\nOR\nVERDICT: ALERT      (deadlocked test, hung interactive prompt, repeated error loop, or genuinely stuck — wake the Lead Agent)\nREASON: <one concise sentence explaining why>\nSUMMARY: <one short sentence describing what the subagent is currently doing, based only on observed activity — never invent progress>",
            },
            {
              role: "user",
              content: `Role: ${job.role} | Engine: ${job.engine} | Elapsed: ${elapsedSec}s | Silent: ${silentSec}s\nLast meaningful action: ${action ? `[${action.kind}] ${sanitizeHandoffText(action.text, 160)}` : "(none)"}\n\nTask Goal:\n${taskGoal}\n\nRecent X-Ray Activity (last 30 items):\n${recentLines || "(no activity yet)"}\n\n${langLine}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(INSPECTOR_TIMEOUT_MS),
      });
      if (!res.ok) return { verdict: "ALERT", reason: `Gatekeeper HTTP ${res.status}`, summary: "", raw: "" };
      const json = await res.json();
      const raw = json?.choices?.[0]?.message?.content?.trim() || "";
      const verdictMatch = raw.match(/VERDICT\s*:\s*(CONTINUE|ALERT)/i);
      const reasonMatch = raw.match(/REASON\s*:\s*(.+)/i);
      const summaryMatch = raw.match(/SUMMARY\s*:\s*(.+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : "ALERT";
      const reason = sanitizeHandoffText(
        reasonMatch ? reasonMatch[1] : raw.split(/\r?\n/).pop() || "Stall check triggered",
        GATEKEEPER_REASON_MAX
      );
      const summary = sanitizeHandoffText(summaryMatch ? summaryMatch[1] : "", 200);
      return { verdict, reason, summary, raw };
    } catch (err) {
      return { verdict: "ALERT", reason: `Gatekeeper check failed (${err?.message || "timeout"})`, summary: "", raw: "" };
    }
  }

  // ---- Silent gatekeeper (opt-in). OFF: silence is surfaced as a plain stall alert. ON: judge first. ----
  #isGatekeeperArmed() {
    return this.store.settings.inspectorEnabled === true && Boolean(this.store.settings.inspectorModelId);
  }

  #gatekeeperModel() {
    const inspModel = this.store.getModelById(this.store.settings.inspectorModelId);
    if (!(inspModel?.mode === "api" && inspModel.apiKey && inspModel.baseUrl && inspModel.modelName)) return null;
    return inspModel;
  }

  // Called from the activity stream: real progress resets the deferral budget and clears a stale verdict.
  #noteRealProgress(job) {
    noteRealProgress(job);
  }

  #stallAlert(job, reason, { verdict = "", deferrals = 0 } = {}) {
    const clean = sanitizeHandoffText(reason, GATEKEEPER_REASON_MAX) || "stall detected";
    job.stallAlert = {
      at: Date.now(),
      reason: clean,
      source: verdict ? "gatekeeper" : "silence_timeout",
      verdict: verdict || "",
      deferrals,
      event: "stall_alert",
      exitCode: 2,
    };
    return job.stallAlert;
  }

  // Silences are evaluated on a timer; OFF => alert lead directly, ON => judge first (bounded deferrals).
  #evaluateSilence(job) {
    const silentMin = Math.max(1, Number(this.store.settings.silentCheckinMin) || 3);
    const decision = decideSilence({
      status: job.status,
      hasAlert: Boolean(job.stallAlert),
      silentMs: Date.now() - (job.lastActivityAt || job.startedAt),
      triggerMs: silentMin * 60_000,
      gatekeeperArmed: this.#isGatekeeperArmed(),
      verdictPending: Boolean(job.gatekeeperVerdictPending),
    });
    if (decision.action === "alert") {
      // Gatekeeper OFF: do not judge, just alert the lead at the silence threshold.
      this.#stallAlert(job, `silent for ${Math.round(decision.silentMs / 1000)}s (silentCheckinMin=${silentMin})`);
      return { alerted: true, judged: false };
    }
    if (decision.action === "judge") return { needsJudge: true, silentMs: decision.silentMs };
    if (decision.action === "pending") return { pending: true };
    return null;
  }

  async #judgeSilence(job, silentMs) {
    if (job.status !== "running" || job.stallAlert) return;
    if (job.gatekeeperVerdictPending) return; // never issue a second concurrent judging call
    const inspModel = this.#gatekeeperModel();
    if (!inspModel) {
      this.#stallAlert(job, "gatekeeper configured but unavailable (missing API key/baseUrl/model)");
      this.#writeStatusSnapshot(job, { force: true });
      return;
    }
    const judgedAt = Date.now();
    const activityAtStart = job.lastActivityAt;
    job.gatekeeperVerdictPending = true;
    let res;
    try {
      const elapsedSec = ((judgedAt - job.startedAt) / 1000).toFixed(1);
      const silentSec = (silentMs / 1000).toFixed(1);
      res = await this.#triageStallWithGatekeeper(inspModel, job, elapsedSec, silentSec);
    } finally {
      job.gatekeeperVerdictPending = false;
    }
    job.gatekeeperLastVerdictAt = Date.now();
    if (job.status !== "running" || job.stallAlert) return;
    // Race guard: if real activity landed while the judge was thinking, its verdict is stale — ignore it.
    if (job.lastActivityAt !== activityAtStart) {
      job.gatekeeperDeferrals = 0;
      return;
    }

    const deferrals = Number(job.gatekeeperDeferrals) || 0;
    if (res.verdict === "CONTINUE" && deferrals < GATEKEEPER_MAX_DEFERRALS) {
      job.gatekeeperDeferrals = deferrals + 1;
      // Extend the judge window only; NEVER fake progress (lastActivityAt stays untouched).
      job.gatekeeperNextJudgeAt = Date.now() + Math.max(
        GATEKEEPER_VERDICT_GRACE_MS,
        (Number(this.store.settings.silentCheckinMin) || 3) * 60_000
      );
      const zh = this.#isZh();
      const line = zh
        ? `守门员判定继续等 (${job.gatekeeperDeferrals}/${GATEKEEPER_MAX_DEFERRALS}): ${res.reason}`
        : `Gatekeeper deferred (${job.gatekeeperDeferrals}/${GATEKEEPER_MAX_DEFERRALS}): ${res.reason}`;
      this.#appendJobLog(job, buildTriageActivity({ summary: line, detail: res.summary || res.reason }));
      this.#writeStatusSnapshot(job, { force: true });
      return;
    }

    const reason =
      res.verdict === "CONTINUE"
        ? this.#isZh()
          ? `连续延长 ${GATEKEEPER_MAX_DEFERRALS} 次仍无新活动，转交主 Agent (${res.reason})`
          : `Deferred ${GATEKEEPER_MAX_DEFERRALS} times with no new activity; handing off to the Lead (${res.reason})`
        : res.reason;
    const alert = this.#stallAlert(job, reason, { verdict: res.verdict, deferrals });
    this.#appendJobLog(job, {
      type: "triage_alert", kind: "triage_alert", status: "done",
      summary: this.#isZh() ? `守门员拉响警报: ${alert.reason}` : `Gatekeeper alert: ${alert.reason}`,
      detail: res.summary || alert.reason,
    });
    this.#writeStatusSnapshot(job, { force: true });
  }

  #startStallGatekeeper(job) {
    let inFlight = false;
    const timer = setInterval(async () => {
      if (job.status !== "running" || inFlight || job.stallAlert) return;
      if (job.gatekeeperVerdictPending) return;
      const now = Date.now();
      if (job.gatekeeperNextJudgeAt && now < job.gatekeeperNextJudgeAt) return;
      const decision = this.#evaluateSilence(job);
      if (!decision?.needsJudge) {
        if (decision?.alerted) this.#writeStatusSnapshot(job, { force: true });
        return;
      }
      inFlight = true;
      try {
        await this.#judgeSilence(job, decision.silentMs);
      } finally {
        inFlight = false;
      }
    }, 15_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  #pruneFinishedJobs() {
    if (this.jobs.size <= 50) return;
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [id, j] of this.jobs.entries()) {
      if (j.status !== "running" && (j.finishedAt || j.startedAt) < cutoff) {
        this.jobs.delete(id);
      }
    }
  }

  // Async background mode ("边干边聊"): an omitted waitSec becomes 0 so the chat unlocks instantly.
  // An explicit waitSec (including 0) always wins.
  #effectiveWaitSec(waitSec) {
    if (waitSec === undefined || waitSec === null) {
      return this.store.settings.asyncBackgroundMode === true ? 0 : waitSec;
    }
    return waitSec;
  }

  #doorbellCommand(jobId) {
    const stallSec = Math.max(60, (Number(this.store.settings.silentCheckinMin) || 3) * 60);
    const longRunMin = Number(this.store.settings.longRunCheckinMin) || 0;
    return [
      `node "${resolveWaitJobScript()}"`,
      `--data-dir "${this.store.dataDir}"`,
      `--stall-sec ${stallSec}`,
      longRunMin > 0 ? `--long-run-min ${longRunMin}` : "",
      jobId,
    ].filter(Boolean).join(" ");
  }

  // Ordered (default) keeps the configured priority queue untouched. Smart promotes one explicit
  // configured model to the front and keeps the remaining order as fallbacks. No judging call here.
  #selectModels(roleCfg, requestedModelId, resumeRecord) {
    return selectRoleModels({
      role: roleCfg.role,
      queue: roleCfg.queue || [],
      selectionMode: roleCfg.selectionMode,
      requestedModelId,
      resumeRecord,
    });
  }

  #asyncLaunchText(headline, job, notes = []) {
    const noteLines = notes.length ? `\n${notes.map((n) => `Note: ${n}`).join("\n")}` : "";
    return `${headline} Use agent_relay_poll(jobIds=["${job.jobId}", ...]) to collect results.
Doorbell (zero-token background wakeup): ${this.#doorbellCommand(job.jobId)}${noteLines}`;
  }

  async ask({
    role = "oracle",
    cwd,
    prompt,
    sessionId: requestedSessionId,
    title,
    slot = "default",
    waitSec: requestedWaitSec,
    effort,
    sandbox,
    worktree,
    forceNew = false,
    modelId: requestedModelId,
    conversationId: requestedConversationId,
    resumeJobId,
    clientContext,
    onHeartbeat,
  }) {
    const waitSec = this.#effectiveWaitSec(requestedWaitSec);
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const gate = this.#checkEnabled();
    if (gate.blocked) return { blocked: true, text: gate.message };
    this.#pruneFinishedJobs();
    const clientAttribution = sanitizeClientContext(clientContext);
    const checkpoint = resumeJobId ? this.#readHandoffJob(resumeJobId) : null;
    if (resumeJobId && (!this.#canResumeHandoff(checkpoint) || forceNew || checkpoint.role !== role ||
      (requestedConversationId && checkpoint.conversationId && checkpoint.conversationId !== sanitizeConversationId(requestedConversationId)) ||
      (requestedSessionId && checkpoint.sessionId !== requestedSessionId) ||
      (cwd && !this.#matchesHandoffCwd(checkpoint, cwd)))) {
      return { blocked: true, status: "unsafe_resume", text: `Job ${resumeJobId} has no matching restart checkpoint. Preserve the original job, workspace, role, and session.` };
    }
    const effectiveSandbox =
      role === "oracle"
        ? "read-only"
        : (checkpoint?.sandbox || sandbox) === "danger-full-access" && this.store.settings.allowHephaestusFullAccess
        ? "danger-full-access"
        : "workspace-write";

    const workDir = path.resolve(checkpoint?.cwd || cwd || process.cwd());
    if (checkpoint && !fs.existsSync(workDir)) {
      return { blocked: true, status: "unsafe_resume", text: `Original workspace has been removed: ${workDir}` };
    }
    const isWriter = role === "hephaestus";
    const cleanSlot = isWriter ? "default" : (checkpoint?.slot || slot || "default").trim() || "default";
    const cleanRequestedSid =
      checkpoint?.sessionId || (!forceNew && typeof requestedSessionId === "string" ? requestedSessionId.trim() : "");
    const explicitTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const sessionTitle = deriveSessionTitle(title, prompt);
    const requestedExisting = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) || checkpoint : null;
    if (requestedExisting?.cwd && normalizeWorkspaceKey(requestedExisting.cwd) !== normalizeWorkspaceKey(workDir)) {
      return { blocked: true, status: "unsafe_resume", text: `Session ${cleanRequestedSid} belongs to ${requestedExisting.cwd}. Use its original workspace.` };
    }

    const gitRepo = isWriter && this.store.settings.allowWorktreeParallelWrite === true
      ? detectGitRepo(workDir)
      : null;
    const wsKey = normalizeWorkspaceKey(workDir);
    const repoKey = gitRepo?.isGit ? normalizeWorkspaceKey(gitRepo.repoRoot) : wsKey;
    const busyWriter = () => this.activeWriters.get(wsKey) || this.activeWriters.get(repoKey);

    const checkAdmission = () => {
      const running = this.#runningJobs();
      if (running.length >= this.store.settings.maxConcurrency) {
        return {
          blocked: true,
          status: "concurrency_limit",
          text: `Concurrency cap reached (${running.length}/${this.store.settings.maxConcurrency} running: ${running.map((j) => `${j.jobId}:${j.role}`).join(", ")}). Poll or finish an existing job, or raise maxConcurrency in A.stand settings.`,
        };
      }
      if (cleanRequestedSid && running.some((j) => j.sessionId === cleanRequestedSid || j.requestedSessionId === cleanRequestedSid)) {
        return { blocked: true, status: "session_busy", text: `Session ${cleanRequestedSid} already has an active job.` };
      }
      const busyJob = isWriter && busyWriter();
      if (busyJob && (cleanRequestedSid || !gitRepo?.isGit)) {
        return {
          blocked: true,
          text: `Hephaestus is already writing in ${workDir} (job ${busyJob}). Poll/wait for that job first to avoid concurrent write conflicts.`,
        };
      }
    };
    const initialBlock = checkAdmission();
    if (initialBlock) return initialBlock;

    const roleCfg = this.store.getRoleConfig(role);
    if ((roleCfg.queue || []).length === 0) {
      return { blocked: true, text: `No AI models configured for role=${role}.` };
    }

    // Smart selection happens BEFORE quota filtering so the fallback order is preserved.
    const selection = this.#selectModels(roleCfg, requestedModelId, cleanRequestedSid ? requestedExisting : null);
    if (selection.error) {
      return { blocked: true, status: "invalid_model_choice", text: selection.error };
    }
    const queue = selection.models;
    const conversationId = checkpoint?.conversationId || sanitizeConversationId(requestedConversationId);

    await this.#syncCodexQuotaAndCooldowns(queue);

    // Quota discovery yields to other requests. Recheck before reserving the workspace.
    const launchBlock = checkAdmission();
    if (launchBlock) return launchBlock;

    // Filter candidates respecting active cooldowns
    const available = [];
    const skippedCooldowns = [];
    for (const m of queue) {
      const cd = this.store.getActiveCooldown(m.id);
      if (cd) skippedCooldowns.push({ model: m, cd });
      else available.push(m);
    }

    if (available.length === 0) {
      const details = skippedCooldowns
        .map(
          ({ model, cd }) =>
            `• ${model.name} (${model.engine}): ${cd.reason}, resets ${formatResetTime(cd.untilMs)}`
        )
        .join("\n");
      const pinnedModelId = selection.resumeForced && queue.length === 1 ? queue[0]?.id || "" : "";
      const exhaustionText = describeQueueExhaustion({
        role,
        queue: roleCfg.queue,
        getCooldown: (id) => this.store.getActiveCooldown(id),
        pinnedModelId,
        lastErr: {
          message: skippedCooldowns.map(({ model, cd }) => `${model.name}: ${cd.reason}`).join("; "),
          isRateLimit: true,
        },
      });
      if (exhaustionText) {
        return {
          status: exhaustionText.startsWith("[SESSION_MODEL_RATE_LIMITED]")
            ? "session_model_rate_limited"
            : "all_exhausted",
          blocked: true,
          text: exhaustionText,
        };
      }
      return {
        status: "all_exhausted",
        blocked: true,
        text: [
          `[ALL_ENGINES_EXHAUSTED] All configured AI models in the ${role} priority queue are currently rate-limited or depleted:`,
          details,
          ``,
          `ACTION REQUIRED (PAUSE external delegation and ask the user):`,
          `1) Turn OFF the A.stand switch to let the lead agent continue solo;`,
          `2) Top up / switch API key or account in the A.stand side panel;`,
          `3) Wait until the earliest quota reset window above.`,
        ].join("\n"),
      };
    }

    // If primary is cooling down and autoFallbackOnLimit is OFF, pause and ask user before switching
    if (skippedCooldowns.some(({ model }) => model.id === queue[0].id) && !this.store.settings.autoFallbackOnLimit) {
      const primary = skippedCooldowns[0];
      const next = available[0];
      return {
        status: "fallback_confirmation_needed",
        blocked: true,
        text: `Primary AI "${primary.model.name}" hit its quota limit (resets ${formatResetTime(primary.cd.untilMs)}), and auto-fallback is disabled in settings. Ask the user whether to fall back to "${next.name}", enable auto-fallback in the panel, or continue solo.`,
      };
    }

    const jobId = `job_${crypto.randomBytes(4).toString("hex")}`;
    const jobsDir = path.join(this.store.dataDir, "jobs");
    fs.mkdirSync(jobsDir, { recursive: true });
    const logPath = path.join(jobsDir, `${jobId}.log`);
    fs.writeFileSync(
      logPath,
      `[${new Date().toISOString()}] Job ${jobId} started (${role}:${cleanSlot}, cwd=${workDir})\n`,
      "utf8"
    );
    const wt = !cleanRequestedSid && gitRepo?.isGit && (worktree === true || busyWriter())
      ? createJobWorktree({ ...gitRepo, dataDir: this.store.dataDir, jobId })
      : null;
    const effectiveCwd = wt?.effectiveCwd || workDir;
    const worktreeHint = wt
      ? `[Git Worktree] You are running in an isolated Git worktree on branch ${wt.branch}. Keep edits here and use ephemeral ports (port: 0) for tests.\n`
      : "";

    const now = Date.now();
    const job = {
      jobId,
      role,
      slot: cleanSlot,
      title: requestedExisting?.title || sessionTitle,
      promptPreview: String(prompt || "").trim().slice(0, 4000),
      taskSummary: String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 1200),
      cwd: effectiveCwd,
      originalCwd: checkpoint?.originalCwd || workDir,
      sandbox: effectiveSandbox,
      requestedSessionId: cleanRequestedSid,
      ...(wt || checkpoint?.worktree ? { worktree: wt || checkpoint.worktree } : {}),
      ...(conversationId && { conversationId }),
      ...(clientAttribution && { client: clientAttribution }),
      selectionMode: selection.mode,
      requestedEffort: effort || roleCfg.effort || "medium",
      appliedEffort: "",
      engine: available[0].engine,
      modelId: available[0].id,
      modelDisplayName: this.#displayModelName(available[0]),
      sessionId: "",
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      lastCheckinAt: now,
      lastLongRunAt: now,
      lastSummary: "",
      logPath,
      outputPath: this.#outputPath(jobId),
      activities: [],
      result: null,
      error: null,
      waiters: [],
    };
    if (checkpoint) {
      writeAtomicJson(this.#statusPath(checkpoint.jobId), { ...checkpoint, resumedBy: jobId });
    }
    this.jobs.set(jobId, job);
    this.#writeStatusSnapshot(job, { force: true });
    if (isWriter && !wt) {
      this.activeWriters.set(wsKey, jobId);
      this.activeWriters.set(repoKey, jobId);
    }

    const stopGatekeeper = this.#startStallGatekeeper(job);
    const runPromise = (async () => {
      let terminalStatus = "failed";
      let terminalError = "Unknown subagent execution error";
      try {
        let lastErr = null;
        let handoffPrompt = "";
        let fallbackPrefixNote =
          skippedCooldowns.length > 0
            ? `fallback from ${skippedCooldowns[0].model.name} (resets ${formatResetTime(skippedCooldowns[0].cd.untilMs)})`
            : "";

        for (let idx = 0; idx < available.length; idx++) {
          const model = available[idx];
          const engineId = model.engine;
          const engine = this.#getEngine(engineId);
          if (!engine) continue;

          job.engine = engineId;
          job.modelId = model.id;
          job.modelDisplayName = this.#displayModelName(model);

          const existing = requestedExisting;
          // A resumed engine session can keep its original working directory.
          const canReuse = Boolean(
            !wt && cleanRequestedSid &&
              (!gitRepo?.isGit || !existing || normalizeWorkspaceKey(existing.cwd) === wsKey) &&
              (!existing || (existing.engine === engineId && existing.modelId === model.id))
          );
          const existingSessionId = canReuse ? cleanRequestedSid : null;
          job.sessionId = existingSessionId || "";

          try {
            const turnPrompt = idx > 0 && !canReuse
              ? handoffPrompt || `[Fallback Handoff: primary model hit a channel fault; take over cleanly]\n${prompt}`
              : prompt;
            handoffPrompt = "";

            const res = await engine.runTurn({
              cwd: effectiveCwd,
              role,
              model,
              effort: effort || roleCfg.effort || "medium",
              sandbox: effectiveSandbox,
              prompt: worktreeHint + applyTurn1CustomRules(turnPrompt, this.#roleTurn1Rules(roleCfg, role, !canReuse), !canReuse),
              existingSessionId,
              requireResume: Boolean(checkpoint),
              onSessionReady: (sid) => this.#onSessionReady(job, sid),
              onActivity: attachTurnSigToJob(job, (ev) => this.#recordActivity(job, ev)),
            });

            if (job.status !== "running") return;
            job.resolvedModel = res.resolvedModel || model.name;
            job.appliedEffort = res.appliedEffort || job.requestedEffort;
            job.reused = Boolean(res.reused);
            job.resumedFromDisk = Boolean(res.resumedFromDisk);
            job.cacheReported = Boolean(res.usage?.cacheReported);
            if (job.interruptRequested || res.interrupted) {
              terminalStatus = "interrupted";
              terminalError = "";
              return;
            }
            const prevTurns = canReuse ? existing?.turns || 0 : 0;
            if (res.sessionId) {
              this.store.setSessionById(res.sessionId, {
                cwd: effectiveCwd,
                role,
                slot: cleanSlot,
                engine: engineId,
                modelId: model.id,
                modelDisplayName: model.name,
                resolvedModel: res.resolvedModel,
                effort: effort || roleCfg.effort || "medium",
                title: explicitTitle || existing?.title || sessionTitle,
                turns: prevTurns + 1,
                lastHitRate: res.usage?.cacheReported ? res.usage.hitRate : null,
                contextPct: res.usage?.contextPct ?? null,
              });
            }

            this.telemetry.record({
              jobId,
              cwd: effectiveCwd,
              role,
              slot: cleanSlot,
              engine: engineId,
              modelId: model.id,
              modelName: res.resolvedModel,
              requestedEffort: job.requestedEffort,
              appliedEffort: job.appliedEffort,
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: res.resumedFromDisk,
              elapsedMs: res.elapsedMs,
              cacheReported: res.usage.cacheReported,
              ...(res.usage?.cacheReported
                ? {}
                : {
                    usageSkipReason: String(
                      res.usageProvenance?.skipReason ||
                        res.usageProvenance?.projectionSkipReason ||
                        res.usageProvenance?.reason ||
                        "cache-not-reported"
                    ).slice(0, 200),
                  }),
              ...(res.usageProvenance?.scope && { usageScope: res.usageProvenance.scope }),
              totalInputTokens: res.usage.totalInputTokens,
              cachedInputTokens: res.usage.cachedInputTokens,
              cacheWriteTokens: res.usage.cacheWriteTokens,
              outputTokens: res.usage.outputTokens,
              hitRate: res.usage.hitRate,
              contextPct: res.usage.contextPct,
            });

            const hint = formatMappedDriveSandboxHint({
              platform: process.platform, role, engine: engineId, cwd: effectiveCwd, activities: job.activities, resultText: res.text,
            });
            const resultText = hint ? `${res.text}\n\n${hint}` : res.text;
            const safeText = this.#trimOutputIfHuge(resultText, jobId);
            const footer = this.formatTelemetryFooter({
              role,
              slot: cleanSlot,
              engine: engineId,
              resolvedModel: res.resolvedModel,
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: res.resumedFromDisk,
              fallbackNote: fallbackPrefixNote,
              usage: res.usage,
              usageScope: res.usageProvenance?.scope,
              elapsedMs: res.elapsedMs,
            });
            const compactHint =
              res.usage?.contextPct != null && res.usage.contextPct >= 70
                ? `\n\n[Notice: context window at ${res.usage.contextPct}%. Consider agent_relay_session(action="compact") soon.]`
                : "";

            job.hitRate = res.usage?.cacheReported ? res.usage.hitRate : null;
            job.contextPct = res.usage?.contextPct ?? null;
            job.finalText = resultText === safeText ? "" : `${resultText}\n\n${footer}`;
            job.result = {
              status: "completed",
              jobId,
              sessionId: res.sessionId,
              role,
              slot: cleanSlot,
              engine: engineId,
              resolvedModel: res.resolvedModel,
              reused: res.reused,
              usage: res.usage,
              elapsedMs: res.elapsedMs,
              outputPath: this.#outputPath(jobId),
              text: `${safeText}${compactHint}\n\n${footer}`,
            };
            terminalStatus = "completed";
            terminalError = "";
            return;
          } catch (err) {
            if (job.status !== "running") return;
            lastErr = err;
            this.#recordActivity(job, { type: "error", summary: err?.message || String(err) });
            if (job.interruptRequested) {
              terminalStatus = "interrupted";
              terminalError = err?.message || String(err);
              return;
            }
            const channelFailure = classifyChannelFailure(err);
            if (channelFailure) {
              let untilMs = null;
              if (channelFailure === "rate_limit" || channelFailure === "quota") {
                untilMs = channelFailure === "quota"
                  ? null
                  : err.resetsAtMs || Date.now() + 5 * 60 * 60 * 1000;
                this.store.setCooldown(model.id, {
                  untilMs,
                  reason: channelFailure === "quota" ? "balance_depleted" : "rate_limit_reached",
                  manualOnly: channelFailure === "quota",
                });
              }
              if (!this.store.settings.autoFallbackOnLimit || idx === available.length - 1) break;

              const fromLabel = this.#displayModelName(model);
              const reason = channelFailureLabel(channelFailure);
              if (!canReuse && this.#hasMeaningfulProgress(job)) {
                handoffPrompt = buildLocalHandoffBrief({
                  originalPrompt: prompt,
                  fromLabel,
                  reason,
                  activities: job.activities,
                  cwd: effectiveCwd,
                  lastOutput: this.#handoffOutput(job),
                });
              }
              fallbackPrefixNote = `fallback from ${fromLabel} (${reason})`;
              this.#recordActivity(job, {
                type: "fallback",
                summary: `${fromLabel} ${reason}; switching to ${this.#displayModelName(available[idx + 1])}`,
              });
              this.#writeStatusSnapshot(job, { force: true });
              continue;
            }
            // User cancellation, invalid 400 requests and silent/hung agents stay on the check-in path.
            break;
          }
        }

        const pinnedModelId = selection.resumeForced && queue.length === 1 ? queue[0]?.id || "" : "";
        terminalError =
          describeQueueExhaustion({
            role,
            queue: roleCfg.queue,
            getCooldown: (id) => this.store.getActiveCooldown(id),
            pinnedModelId,
            lastErr,
          }) || lastErr?.message || terminalError;
      } catch (err) {
        terminalError = err?.message || String(err);
      } finally {
        stopGatekeeper();
        if (wt) this.#finalizeWorktree(job, wt);
        if (job.status === "running") this.#markJobTerminal(job, terminalStatus, terminalError);
        else if (wt) {
          this.#saveJobOutput(job);
          this.#writeStatusSnapshot(job, { force: true });
        }
        for (const key of [wsKey, repoKey]) {
          if (this.activeWriters.get(key) === jobId) this.activeWriters.delete(key);
        }
        for (const w of job.waiters) w();
        job.waiters = [];
      }
    })();

    if (waitSec === 0) {
      return {
        status: "started",
        jobId,
        role,
        slot: cleanSlot,
        engine: job.engine,
        modelId: job.modelId,
        selectionMode: selection.mode,
        logPath,
        outputPath: job.outputPath,
        sessionId: job.sessionId || "",
        ...(conversationId && { conversationId }),
        text: this.#asyncLaunchText(
          `[Started · async] Job ${jobId} (${role}:${cleanSlot} · ${job.engine}) launched in background.`,
          job,
          selection.notes
        ),
      };
    }

    return this.#waitWithCheckins(job, runPromise, { explicitWaitSec: waitSec, deadline, onHeartbeat });
  }

  async poll(jobId, { waitSec, detail = "summary", onHeartbeat } = {}) {
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const job = this.jobs.get(jobId);
    if (!job) {
      const snap = this.#readHandoffJob(jobId);
      if (snap?.status === "completed") {
        const text = this.#readFinalText(jobId);
        if (text) return { status: "completed", jobId, sessionId: snap.sessionId, text: this.#trimOutputIfHuge(text, jobId) };
      }
      return { status: "not_found", text: `Job ${jobId} has no available result.` };
    }
    if (job.status === "completed") return job.result;
    if (job.status === "failed") {
      return { status: "failed", jobId, text: `Job ${jobId} failed: ${job.error}${job.worktreeNotice || ""}` };
    }
    if (job.status === "interrupted") {
      const sid = job.sessionId ? ` · sessionId=${job.sessionId}` : "";
      return {
        status: "interrupted",
        jobId,
        sessionId: job.sessionId || "",
        text: `[INTERRUPTED] Job ${jobId} (${job.role}:${job.slot}${sid}) — ${job.error || CRASH_RECOVERY_ERROR}. Last step: ${job.lastSummary || "(none)"}. To resume, re-send the task with sessionId="${job.sessionId || ""}" and note it should check the current workspace diff first.${job.worktreeNotice || ""}`,
      };
    }
    if (waitSec === 0) {
      return this.#buildCheckinReport(job, "manual_inspect", detail);
    }
    job.lastCheckinAt = Date.now();
    let waiter;
    const waitPromise = new Promise((resolve) => {
      waiter = resolve;
      job.waiters.push(waiter);
    });
    return this.#waitWithCheckins(job, waitPromise, {
      explicitWaitSec: waitSec,
      deadline,
      detail,
      onHeartbeat,
    }).finally(() => {
      const index = job.waiters.indexOf(waiter);
      if (index !== -1) job.waiters.splice(index, 1);
    });
  }

  async pollMany(jobIds, { waitSec, detail = "summary", onHeartbeat } = {}) {
    const ids = [...new Set((jobIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
    if (ids.length === 0) {
      return { status: "not_found", text: "Provide jobId or non-empty jobIds." };
    }
    if (ids.length === 1) {
      return this.poll(ids[0], { waitSec, detail, onHeartbeat });
    }

    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const explicitMs = waitSec && waitSec > 0 ? Math.min(waitSec * 1000, MAX_BLOCKING_WAIT_MS) : MAX_BLOCKING_WAIT_MS;
    const longRunMs = this.store.settings.longRunCheckinMin * 60_000;
    const due = (job, now) => job.stallAlert?.at > (job.lastCheckinAt || 0) ? "silent_checkin"
      : longRunMs && now - (job.lastLongRunAt || job.startedAt) >= longRunMs ? "long_run_checkin" : "";
    const runningSet = () =>
      ids
        .map((id) => this.jobs.get(id))
        .filter((j) => j && j.status === "running");

    if (waitSec !== 0 && runningSet().length > 0) {
      const waitBudget = Math.max(0, Math.min(explicitMs, deadline - Date.now()));
      await new Promise((resolve) => {
        let settled = false;
        let heartbeatTick = 0;
        const attached = [];
        const done = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearInterval(interval);
          for (const { job, fn } of attached) {
            const idx = job.waiters.indexOf(fn);
            if (idx !== -1) job.waiters.splice(idx, 1);
          }
          resolve();
        };
        const checkDone = () => {
          if (runningSet().length === 0) done();
        };
        for (const job of runningSet()) {
          const fn = () => checkDone();
          job.waiters.push(fn);
          attached.push({ job, fn });
        }
        const timer = setTimeout(done, waitBudget);
        const interval = setInterval(() => {
          if (settled) return;
          const active = runningSet();
          if (active.length === 0) {
            done();
            return;
          }
          heartbeatTick++;
          if (heartbeatTick % 5 === 0 && onHeartbeat) {
            try {
              onHeartbeat(heartbeatTick, `${active.length}/${ids.length} parallel jobs running`);
            } catch {}
          }
          const now = Date.now();
          if (active.some((job) => due(job, now))) {
            done();
          }
        }, 3000);
        checkDone();
      });
    }

    const sections = [];
    let anyRunning = false;
    let allFailed = true;
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (!job) {
        const result = await this.poll(id, { waitSec: 0 });
        if (result.status === "completed") allFailed = false;
        sections.push(`=== Job ${id} (${result.status}) ===\n${result.text}`);
        continue;
      }
      if (job.status === "completed") {
        allFailed = false;
        sections.push(`=== Job ${id} (${job.role}:${job.slot} · completed) ===\n${job.result?.text || ""}`);
      } else if (job.status === "failed") {
        sections.push(`=== Job ${id} (${job.role}:${job.slot} · failed) ===\nJob ${id} failed: ${job.error}${job.worktreeNotice || ""}`);
      } else if (job.status === "interrupted") {
        sections.push(
          `=== Job ${id} (${job.role}:${job.slot} · interrupted) ===\nJob ${id} was interrupted: ${job.error || "Host/MCP exited while running"}${job.sessionId ? ` (sessionId=${job.sessionId})` : ""}${job.worktreeNotice || ""}`
        );
      } else {
        anyRunning = true;
        allFailed = false;
        const now = Date.now();
        const reason = waitSec === 0 ? "manual_inspect" : due(job, now) || "running_checkin";
        if (reason === "long_run_checkin") job.lastLongRunAt = now;
        job.lastCheckinAt = now;
        const report = await this.#buildCheckinReport(job, reason, detail);
        sections.push(`=== Job ${id} (${job.role}:${job.slot} · running) ===\n${report.text}`);
      }
    }
    return {
      status: anyRunning ? "running_checkin" : allFailed ? "failed" : "completed",
      jobIds: ids,
      text: sections.join("\n\n"),
    };
  }

  async #waitWithCheckins(
    job,
    donePromise,
    { explicitWaitSec, deadline, detail = "summary", onHeartbeat }
  ) {
    const silentMs = this.store.settings.silentCheckinMin * 60_000;
    const longRunMin = Number(this.store.settings.longRunCheckinMin) || 0;
    const longRunMs = longRunMin > 0 ? longRunMin * 60_000 : Number.POSITIVE_INFINITY;
    const remainingMs = Math.max(0, deadline - Date.now());
    const explicitMs = explicitWaitSec ? Math.max(1, explicitWaitSec) * 1000 : Infinity;
    const checkinMs = Math.min(explicitMs, remainingMs);
    let heartbeatTick = 0;

    return new Promise((resolve) => {
      let settled = false;
      let reporting = false;
      let checkinTimer;
      // Local cooldowns prevent a tight loop when the judge defers or a check-in is already in flight.
      let nextSilenceCheckAt = 0;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearInterval(interval);
        clearTimeout(deadlineTimer);
        clearTimeout(checkinTimer);
        resolve(result);
      };
      const checkIn = async (reason) => {
        if (settled || reporting) return;
        reporting = true;
        job.lastCheckinAt = Date.now();
        if (reason === "long_run_checkin") job.lastLongRunAt = Date.now();
        // The report itself persists the durable checkpoint exactly once (no duplicate write).
        finish(await this.#buildCheckinReport(job, reason, detail));
      };
      const deadlineTimer = setTimeout(async () => {
        job.lastCheckinAt = Date.now();
        finish(await this.#buildCheckinReport(job, "running_checkin", detail));
      }, remainingMs);
      if (checkinMs < remainingMs) {
        checkinTimer = setTimeout(() => checkIn("running_checkin"), checkinMs);
      }

      // Terminal completion is the primary wakeup; a dropped notification still falls back to ticks below.
      donePromise.then(() => {
        if (job.status === "completed") finish(job.result);
        else if (job.status === "failed" || job.status === "interrupted") {
          void this.poll(job.jobId).then(finish);
        }
      });

      const interval = setInterval(() => {
        if (settled || reporting) return;
        const now = Date.now();

        // Zero-token MCP protocol progress heartbeat every ~15s (does NOT reset lastActivityAt)
        heartbeatTick++;
        if (heartbeatTick % 5 === 0 && onHeartbeat) {
          try {
            onHeartbeat(heartbeatTick, `running ${Math.round((now - job.startedAt) / 1000)}s`);
          } catch {}
        }

        // Dropped terminal notification guard: if the run settled without waking us, resolve now.
        if (job.status === "completed") {
          finish(job.result);
          return;
        }
        if (job.status === "failed" || job.status === "interrupted") {
          void this.poll(job.jobId).then(finish);
          return;
        }

        const silentFor = now - job.lastActivityAt;
        const sinceLastCheckin = now - job.lastCheckinAt;
        const sinceLastLongRun = now - (job.lastLongRunAt || job.startedAt);

        // Long-run interval: distinct exit/event so the Lead decides and re-arms the waiter.
        if (longRunMs !== Number.POSITIVE_INFINITY && sinceLastLongRun >= longRunMs && now >= nextSilenceCheckAt) {
          void checkIn("long_run_checkin");
          return;
        }

        if (silentFor < silentMs || sinceLastCheckin < silentMs || now < nextSilenceCheckAt) return;

        if (!this.#isGatekeeperArmed()) {
          // Gatekeeper OFF: surface the silence to the Lead immediately (never silent).
          void checkIn("silent_checkin");
          return;
        }
        if (job.stallAlert) {
          void checkIn("silent_checkin");
          return;
        }
        if (job.gatekeeperVerdictPending) {
          nextSilenceCheckAt = now + GATEKEEPER_VERDICT_GRACE_MS;
          return;
        }
        // Gatekeeper ON: judge first. Deferrals are bounded; the shared judge also feeds the doorbell.
        reporting = true;
        void this.#judgeSilence(job, silentFor)
          .then(() => {
            reporting = false;
            if (settled) return;
            if (job.stallAlert) {
              void checkIn("silent_checkin");
              return;
            }
            nextSilenceCheckAt = Math.max(now + GATEKEEPER_VERDICT_GRACE_MS, job.gatekeeperNextJudgeAt || 0);
          })
          .catch(() => {
            reporting = false;
            nextSilenceCheckAt = now + GATEKEEPER_VERDICT_GRACE_MS;
          });
      }, 3000);
    });
  }

  async stopJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") {
      return { ok: false, text: `Job ${jobId} is not running.` };
    }
    const engine = this.#getEngine(job.engine);
    const model = this.store.getModelById(job.modelId);
    job.interruptRequested = true;
    this.#recordActivity(job, { type: "interrupt", summary: "Interrupt requested" });
    try {
      if (job.sessionId) await engine?.interruptTurn?.(job.sessionId, model);
    } catch {}
    return { ok: true, text: `Interrupt sent to job ${jobId}.` };
  }

  async review({
    cwd,
    targetType = "uncommittedChanges",
    branch,
    sha,
    instructions,
    sessionId: requestedSessionId,
    title,
    waitSec: requestedWaitSec,
    modelId: requestedModelId,
    conversationId: requestedConversationId,
    clientContext,
    onHeartbeat,
  }) {
    const waitSec = this.#effectiveWaitSec(requestedWaitSec);
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const gate = this.#checkEnabled();
    if (gate.blocked) return { blocked: true, text: gate.message };
    this.#pruneFinishedJobs();
    const clientAttribution = sanitizeClientContext(clientContext);

    const workDir = path.resolve(cwd || process.cwd());
    const cleanRequestedSid = typeof requestedSessionId === "string" ? requestedSessionId.trim() : "";
    const explicitTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const sessionTitle = deriveSessionTitle(title, instructions || `Review (${targetType})`);
    const requestedExisting = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) : null;
    const conversationId = sanitizeConversationId(requestedConversationId);
    const running = this.#runningJobs();
    if (running.length >= this.store.settings.maxConcurrency) {
      return {
        blocked: true,
        status: "concurrency_limit",
        text: `Concurrency cap reached (${running.length}/${this.store.settings.maxConcurrency} running: ${running.map((j) => `${j.jobId}:${j.role}`).join(", ")}). Poll or finish an existing job, or raise maxConcurrency in A.stand settings.`,
      };
    }

    const roleCfg = this.store.getRoleConfig("oracle");
    if ((roleCfg.queue || []).length === 0) {
      return { blocked: true, text: "No AI models configured for role=oracle." };
    }
    const selection = this.#selectModels(roleCfg, requestedModelId, cleanRequestedSid ? requestedExisting : null);
    if (selection.error) {
      return { blocked: true, status: "invalid_model_choice", text: selection.error };
    }
    const queue = selection.models;

    await this.#syncCodexQuotaAndCooldowns(queue);

    const available = [];
    const skippedCooldowns = [];
    for (const m of queue) {
      const cd = this.store.getActiveCooldown(m.id);
      if (cd) skippedCooldowns.push({ model: m, cd });
      else available.push(m);
    }

    if (available.length === 0) {
      const details = skippedCooldowns
        .map(({ model, cd }) => `• ${model.name} (${model.engine}): ${cd.reason}, resets ${formatResetTime(cd.untilMs)}`)
        .join("\n");
      const pinnedModelId = selection.resumeForced && queue.length === 1 ? queue[0]?.id || "" : "";
      const exhaustionText = describeQueueExhaustion({
        role: "oracle",
        queue: roleCfg.queue,
        getCooldown: (id) => this.store.getActiveCooldown(id),
        pinnedModelId,
        lastErr: {
          message: skippedCooldowns.map(({ model, cd }) => `${model.name}: ${cd.reason}`).join("; "),
          isRateLimit: true,
        },
      });
      if (exhaustionText) {
        return {
          status: exhaustionText.startsWith("[SESSION_MODEL_RATE_LIMITED]")
            ? "session_model_rate_limited"
            : "all_exhausted",
          blocked: true,
          text: exhaustionText,
        };
      }
      return {
        status: "all_exhausted",
        blocked: true,
        text: `[ALL_ENGINES_EXHAUSTED] All configured AI models in the oracle priority queue are currently rate-limited or depleted:\n${details}`,
      };
    }

    if (skippedCooldowns.length > 0 && !this.store.settings.autoFallbackOnLimit) {
      const primary = skippedCooldowns[0];
      const next = available[0];
      return {
        status: "fallback_confirmation_needed",
        blocked: true,
        text: `Primary AI "${primary.model.name}" hit its quota limit (resets ${formatResetTime(primary.cd.untilMs)}), and auto-fallback is disabled in settings. Ask the user whether to fall back to "${next.name}", enable auto-fallback in the panel, or continue solo.`,
      };
    }

    const reviewPrompt =
      instructions ||
      `Perform an independent adversarial code review of the ${targetType} in ${workDir}. Focus on bugs, race conditions, security flaws, and edge cases. Cite exact file:line.`;

    // If the first available oracle model is not Codex, delegate directly through the unified ask pipeline
    if (available[0].engine !== "codex") {
      return this.ask({
        role: "oracle",
        cwd: workDir,
        prompt: reviewPrompt,
        sessionId: cleanRequestedSid || undefined,
        title: sessionTitle,
        waitSec,
        modelId: requestedModelId,
        conversationId,
        onHeartbeat,
      });
    }

    let target = { type: "uncommittedChanges" };
    if (targetType === "baseBranch" && branch) target = { type: "baseBranch", branch };
    else if (targetType === "commit" && sha) target = { type: "commit", sha };
    else if (targetType === "custom" && instructions) target = { type: "custom", instructions };

    const jobId = `rev_${crypto.randomBytes(4).toString("hex")}`;
    const jobsDir = path.join(this.store.dataDir, "jobs");
    fs.mkdirSync(jobsDir, { recursive: true });
    const logPath = path.join(jobsDir, `${jobId}.log`);
    fs.writeFileSync(
      logPath,
      `[${new Date().toISOString()}] Review ${jobId} started (oracle:default, target=${targetType}, cwd=${workDir})\n`,
      "utf8"
    );

    const now = Date.now();
    const job = {
      jobId,
      role: "oracle",
      slot: "default",
      title: requestedExisting?.title || sessionTitle,
      promptPreview: reviewPrompt.trim().slice(0, 4000),
      taskSummary: String(instructions || sessionTitle || `Review ${targetType}`).replace(/\s+/g, " ").trim().slice(0, 1200),
      cwd: workDir,
      ...(conversationId && { conversationId }),
      ...(clientAttribution && { client: clientAttribution }),
      selectionMode: selection.mode,
      requestedEffort: roleCfg.effort || "medium",
      appliedEffort: "",
      engine: available[0].engine,
      modelId: available[0].id,
      modelDisplayName: this.#displayModelName(available[0]),
      sessionId: "",
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      lastCheckinAt: now,
      lastLongRunAt: now,
      lastSummary: "",
      logPath,
      outputPath: this.#outputPath(jobId),
      activities: [],
      result: null,
      error: null,
      waiters: [],
    };
    this.jobs.set(jobId, job);
    this.#writeStatusSnapshot(job, { force: true });

    const stopGatekeeper = this.#startStallGatekeeper(job);
    const runPromise = (async () => {
      try {
        let lastErr = null;
        let fallbackPrefixNote =
          skippedCooldowns.length > 0
            ? `fallback from ${skippedCooldowns[0].model.name} (resets ${formatResetTime(skippedCooldowns[0].cd.untilMs)})`
            : "";

        for (let idx = 0; idx < available.length; idx++) {
          const model = available[idx];
          const engineId = model.engine;
          const engine = this.#getEngine(engineId);
          if (!engine) continue;

          job.engine = engineId;
          job.modelId = model.id;
          job.modelDisplayName = this.#displayModelName(model);

          const existing = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) : null;
          const canReuse = Boolean(
            cleanRequestedSid &&
              (!existing || (existing.engine === engineId && existing.modelId === model.id))
          );
          const existingSessionId = canReuse ? cleanRequestedSid : null;
          job.sessionId = existingSessionId || "";

          try {
            const onSessionReady = (sid) => this.#onSessionReady(job, sid);
            const onActivity = attachTurnSigToJob(job, (ev) => this.#recordActivity(job, ev));
            const turn1Rules = this.#roleTurn1Rules(roleCfg, "oracle", !canReuse);
            const res =
              engineId === "codex"
                ? await this.engines.codex.runReview({
                    cwd: workDir,
                    model,
                    existingSessionId,
                    customRules: canReuse ? undefined : turn1Rules,
                    target,
                    onSessionReady,
                    onActivity,
                  })
                : await engine.runTurn({
                    cwd: workDir,
                    role: "oracle",
                    model,
                    effort: roleCfg.effort || "medium",
                    sandbox: "read-only",
                    prompt: applyTurn1CustomRules(reviewPrompt, turn1Rules, !canReuse),
                    existingSessionId,
                    onSessionReady,
                    onActivity,
                  });

            if (job.status !== "running") return;
            job.resolvedModel = res.resolvedModel || model.name;
            job.appliedEffort = res.appliedEffort || job.requestedEffort;
            job.reused = Boolean(res.reused);
            job.resumedFromDisk = Boolean(res.resumedFromDisk);
            job.cacheReported = Boolean(res.usage?.cacheReported);
            if (job.interruptRequested || res.interrupted) {
              this.#markJobTerminal(job, "interrupted");
              return;
            }
            const prevTurns = canReuse ? existing?.turns || 0 : 0;
            if (res.sessionId) {
              this.store.setSessionById(res.sessionId, {
                cwd: workDir,
                role: "oracle",
                slot: "default",
                engine: engineId,
                modelId: model.id,
                modelDisplayName: model.name,
                resolvedModel: res.resolvedModel,
                effort: roleCfg.effort || "medium",
                title: explicitTitle || existing?.title || sessionTitle,
                turns: prevTurns + 1,
                lastHitRate: res.usage?.cacheReported ? res.usage.hitRate : null,
                contextPct: res.usage?.contextPct ?? null,
              });
            }

            this.telemetry.record({
              jobId,
              cwd: workDir,
              role: "oracle",
              slot: "default",
              engine: engineId,
              modelId: model.id,
              modelName: res.resolvedModel,
              requestedEffort: job.requestedEffort,
              appliedEffort: job.appliedEffort,
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: Boolean(res.resumedFromDisk),
              elapsedMs: res.elapsedMs,
              cacheReported: res.usage.cacheReported,
              ...(res.usage?.cacheReported
                ? {}
                : {
                    usageSkipReason: String(
                      res.usageProvenance?.skipReason ||
                        res.usageProvenance?.projectionSkipReason ||
                        res.usageProvenance?.reason ||
                        "cache-not-reported"
                    ).slice(0, 200),
                  }),
              totalInputTokens: res.usage.totalInputTokens,
              cachedInputTokens: res.usage.cachedInputTokens,
              cacheWriteTokens: res.usage.cacheWriteTokens,
              outputTokens: res.usage.outputTokens,
              hitRate: res.usage.hitRate,
              contextPct: res.usage.contextPct,
            });

            const hint = formatMappedDriveSandboxHint({
              platform: process.platform, role: "oracle", engine: engineId, cwd: workDir, activities: job.activities, resultText: res.text,
            });
            const resultText = hint ? `${res.text}\n\n${hint}` : res.text;
            const safeText = this.#trimOutputIfHuge(resultText, jobId);
            const footer = this.formatTelemetryFooter({
              role: "oracle",
              slot: "default",
              engine: engineId,
              resolvedModel: res.resolvedModel,
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: Boolean(res.resumedFromDisk),
              fallbackNote: fallbackPrefixNote,
              usage: res.usage,
              elapsedMs: res.elapsedMs,
            });
            job.hitRate = res.usage?.cacheReported ? res.usage.hitRate : null;
            job.contextPct = res.usage?.contextPct ?? null;
            job.finalText = resultText === safeText ? "" : `${resultText}\n\n${footer}`;
            job.result = {
              status: "completed",
              jobId,
              sessionId: res.sessionId,
              role: "oracle",
              engine: engineId,
              resolvedModel: res.resolvedModel,
              outputPath: this.#outputPath(jobId),
              text: `${safeText}\n\n${footer}`,
            };
            this.#markJobTerminal(job, "completed");
            return;
          } catch (err) {
            if (job.status !== "running") return;
            lastErr = err;
            this.#recordActivity(job, { type: "error", summary: err?.message || String(err) });
            if (job.interruptRequested) {
              this.#markJobTerminal(job, "interrupted", err?.message || String(err));
              return;
            }
            const channelFailure = classifyChannelFailure(err);
            if (channelFailure) {
              if (channelFailure === "rate_limit" || channelFailure === "quota") {
                const untilMs = channelFailure === "quota"
                  ? null
                  : err.resetsAtMs || Date.now() + 5 * 60 * 60 * 1000;
                this.store.setCooldown(model.id, {
                  untilMs,
                  reason: channelFailure === "quota" ? "balance_depleted" : "rate_limit_reached",
                  manualOnly: channelFailure === "quota",
                });
              }
              if (!this.store.settings.autoFallbackOnLimit || idx === available.length - 1) break;
              fallbackPrefixNote = `fallback from ${model.name} (${channelFailureLabel(channelFailure)})`;
              this.#recordActivity(job, {
                type: "fallback",
                summary: `${model.name} ${channelFailureLabel(channelFailure)}; switching to ${available[idx + 1]?.name || "next model"}`,
              });
              continue;
            }
            break;
          }
        }

        const pinnedModelId = selection.resumeForced && queue.length === 1 ? queue[0]?.id || "" : "";
        this.#markJobTerminal(
          job,
          "failed",
          describeQueueExhaustion({
            role: "oracle",
            queue: roleCfg.queue,
            getCooldown: (id) => this.store.getActiveCooldown(id),
            pinnedModelId,
            lastErr,
          }) ||
            lastErr?.message ||
            "Unknown review error"
        );
      } finally {
        stopGatekeeper();
        job.finishedAt = job.finishedAt || Date.now();
        this.#writeStatusSnapshot(job, { force: true });
        for (const w of job.waiters) w();
        job.waiters = [];
      }
    })();

    if (waitSec === 0) {
      return {
        status: "started",
        jobId,
        role: "oracle",
        slot: "default",
        engine: job.engine,
        modelId: job.modelId,
        selectionMode: selection.mode,
        logPath,
        outputPath: job.outputPath,
        sessionId: job.sessionId || "",
        ...(conversationId && { conversationId }),
        text: this.#asyncLaunchText(
          `[Started · async] Review job ${jobId} (oracle:default · ${job.engine}) launched in background.`,
          job,
          selection.notes
        ),
      };
    }

    return this.#waitWithCheckins(job, runPromise, { explicitWaitSec: waitSec, deadline, onHeartbeat });
  }

  #roleStatus(role) {
    const cfg = this.store.getRoleConfig(role);
    return {
      effort: this.store.settings.roles[role].effort,
      selectionMode: cfg.selectionMode,
      selectedModelId: cfg.modelId,
      queue: cfg.queue.map((m) => ({
        id: m.id,
        name: m.name,
        engine: m.engine,
        cooldown: this.store.getActiveCooldown(m.id),
      })),
    };
  }

  // ---- Durable conditional handoff: disk-only discovery, no quota probes, no live model calls. ----

  #readHandoffJob(jobId) {
    if (!/^[a-zA-Z0-9_-]{3,48}$/.test(String(jobId || ""))) return null;
    let snap;
    try { snap = JSON.parse(fs.readFileSync(this.#statusPath(jobId), "utf8")); } catch { return null; }
    if (!snap || snap.jobId !== jobId) return null;
    const cutoff = Date.now() - RECOVER_WINDOW_MS;
    // For an orphan, use the time it actually stopped rather than when startup rewrote it.
    const recentAt = Number(snap.finishedAt || snap.updatedAt);
    if (!recentAt || recentAt < cutoff) return null;
    return snap;
  }

  #matchesHandoffCwd(snap, cwd) {
    const key = normalizeWorkspaceKey(cwd);
    return [snap.cwd, snap.originalCwd, snap.worktree?.repoRoot].some((value) =>
      value && normalizeWorkspaceKey(value) === key);
  }

  #canResumeHandoff(snap) {
    return snap?.status === "interrupted" && Boolean(snap.hostInterrupted || snap.error === CRASH_RECOVERY_ERROR) &&
      Boolean(snap.sessionId && snap.modelId && snap.cwd && snap.engine) && !snap.resumedBy;
  }

  // Recovery is only called on demand. Avoid reading out-of-window status files.
  #scanRecentJobs({ cwd, conversationId }) {
    const dir = path.join(this.store.dataDir, "jobs");
    const cutoff = Date.now() - RECOVER_WINDOW_MS;
    let names;
    try { names = fs.readdirSync(dir); } catch { return []; }
    const recent = [];
    for (const name of names) {
      if (!name.endsWith(".status.json")) continue;
      try {
        const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
        if (mtime >= cutoff) recent.push({ id: name.slice(0, -12), mtime });
      } catch {}
    }
    return recent.sort((a, b) => b.mtime - a.mtime).slice(0, RECOVER_SCAN_LIMIT)
      .map(({ id }) => this.#readHandoffJob(id))
      .filter((snap) => snap && snap.conversationId === conversationId && this.#matchesHandoffCwd(snap, cwd));
  }

  #recoverPromptFor(snap) {
    const title = sanitizeHandoffText(snap.title || snap.jobId, 80);
    const cwd = snap.cwd || "(unknown cwd)";
    const status = snap.status || "unknown";
    const action = snap.lastAction || lastMeaningfulAction(this.jobs.get(snap.jobId)?.activities, RECOVER_ACTION_TEXT_MAX);
    const task = sanitizeHandoffText(snap.taskSummary || snap.lastSummary || "", 600);
    const worktree = snap.worktree
      ? ` · worktree=${snap.worktree.worktreeRoot} · branch=${snap.worktree.branch}`
      : "";
    return [
      `继续上次任务（${status}）: ${title} · job=${snap.jobId} · role=${snap.role || "?"}:${snap.slot || "default"}`,
      `原始 cwd=${cwd} · sessionId=${snap.sessionId || "(none)"} · engine=${snap.engine || "?"} · modelId=${snap.modelId || "(unknown)"}${worktree}`,
      action ? `上次有效动作: [${action.kind}] ${sanitizeHandoffText(action.text, RECOVER_ACTION_TEXT_MAX)}` : "上次有效动作: (none)",
      task ? `任务检查点: ${task}` : "任务检查点: (none persisted)",
      this.#canResumeHandoff(snap)
        ? `Continue through agent_relay_ask(resumeJobId="${snap.jobId}", role="${snap.role}", cwd=${JSON.stringify(cwd)}, prompt="Inspect the existing edits and continue the original task").`
        : snap.status === "completed" ? `Read the result via agent_relay_poll(jobId="${snap.jobId}") or its saved output, then acknowledge receipt.` : "No automatic restart checkpoint for this state.",
    ].join("\n");
  }

  #resultAvailable(snap, ack) {
    if (snap.status !== "completed") return false;
    if (!ack) return true;
    const ackedAt = Date.parse(ack.createdAt || "") || 0;
    const finishedAt = Number(snap.finishedAt) || Number(snap.updatedAt) || 0;
    // A newer completion (e.g. a resumed job) invalidates an older ACK for the same jobId.
    return finishedAt > ackedAt;
  }

  #summarizeRecoverRow(snap) {
    const ack = this.store.getReceipt(snap.jobId, "result_ack");
    const accepted = this.store.getReceipt(snap.jobId, "user_accept");
    return {
      jobId: snap.jobId,
      role: snap.role || "",
      slot: snap.slot || "default",
      title: sanitizeHandoffText(snap.title || "", 60),
      status: snap.status || "unknown",
      engine: snap.engine || "",
      modelId: snap.modelId || "",
      sessionId: snap.sessionId || "",
      conversationId: snap.conversationId || "",
      cwd: snap.cwd || "",
      startedAt: snap.startedAt || null,
      finishedAt: snap.finishedAt || null,
      updatedAt: snap.updatedAt || null,
      elapsedSec: snap.elapsedSec ?? null,
      lastAction: snap.lastAction || null,
      lastSummary: sanitizeHandoffText(snap.lastSummary || "", 240),
      logPath: snap.logPath || "",
      outputPath: snap.outputPath || this.#outputPath(snap.jobId),
      checkpointPath: this.#checkpointPath(snap.jobId),
      worktree: snap.worktree || null,
      resultAck: ack || null,
      resultUnread: this.#resultAvailable(snap, ack),
      resumable: this.#canResumeHandoff(snap),
      userAccepted: Boolean(accepted),
    };
  }

  #recoverHandoff({ jobId, jobIds, cwd, role, conversationId }) {
    const explicitIds = [...new Set(
      [...(Array.isArray(jobIds) ? jobIds : []), ...(jobId ? [jobId] : [])]
        .map((id) => String(id || "").trim())
        .filter((id) => /^[a-zA-Z0-9_-]{3,48}$/.test(id))
    )];
    const scopedCwd = cwd ? path.resolve(cwd) : "";
    const wantedConv = sanitizeConversationId(conversationId);

    if (!explicitIds.length && (!scopedCwd || !wantedConv)) {
      return { ok: false, status: "scope_required", text: "Recovery needs exact job IDs, or the original cwd and conversationId." };
    }
    let matches = explicitIds.length
      ? explicitIds.map((id) => this.#readHandoffJob(id)).filter(Boolean)
      : this.#scanRecentJobs({ cwd: scopedCwd, conversationId: wantedConv }).filter((snap) =>
        this.#canResumeHandoff(snap) || this.#resultAvailable(snap, this.store.getReceipt(snap.jobId, "result_ack")) || snap.status === "running");
    matches = matches.filter((snap) => (!scopedCwd || this.#matchesHandoffCwd(snap, scopedCwd)) &&
      (!wantedConv || wantedConv === snap.conversationId) && (!role || snap.role === role));
    if (!matches.length) return { ok: false, status: "not_found", text: "No outstanding A.stand work matched this scope in the last 24 hours." };

    const rows = matches.map((s) => this.#summarizeRecoverRow(s));
    const lines = rows.map((r) => {
      const sid = r.sessionId ? ` · sessionId=${r.sessionId}` : "";
      const unread = r.resultUnread ? " · RESULT_UNREAD" : " · result_ack_recorded";
      const accepted = r.userAccepted ? " · user_accepted" : "";
      const wt = r.worktree ? ` · worktree=${r.worktree.worktreeRoot} (${r.worktree.branch})` : "";
      const snap = matches.find((s) => s.jobId === r.jobId);
      return `=== ${r.jobId} (${r.role}:${r.slot} · ${r.status}) ===\n${this.#recoverPromptFor(snap)}${sid}${wt}${r.status === "completed" ? unread : ""}${accepted}`;
    });
    return {
      ok: true,
      status: "recovered",
      jobIds: rows.map((r) => r.jobId),
      recovered: rows,
      unreadCount: rows.filter((r) => r.resultUnread).length,
      text: [
        `[Durable handoff · recovered ${rows.length} job(s) from disk, nothing restarted]`,
        ...lines,
        `ACK when the Lead has actually read a result: agent_relay_session(action="ack", jobId="<id>", kind="result_ack") — this records a durable receipt, it is NOT user acceptance.`,
        `Record real user acceptance separately with kind="user_accept".`,
      ].join("\n\n"),
    };
  }

  #ackHandoff({ jobId, jobIds, kind = "result_ack" }) {
    const receiptKind = kind === "user_accept" ? "user_accept" : "result_ack";
    const ids = [...new Set(
      [...(Array.isArray(jobIds) ? jobIds : []), ...(jobId ? [jobId] : [])]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )];
    if (ids.length === 0) {
      return { ok: false, text: "ack requires an explicit jobId or jobIds." };
    }
    const known = new Map(ids.map((id) => [id, this.#readHandoffJob(id)]).filter(([, snap]) =>
      snap?.status === "completed" && fs.existsSync(this.#outputPath(snap.jobId))));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      return { ok: false, text: `Cannot ACK unknown job(s): ${unknown.join(", ")}. ACK only jobs you actually recovered.` };
    }
    const receipts = ids.map((id) => {
      const snap = known.get(id);
      const receipt = this.store.putReceipt(id, receiptKind, {
        role: snap.role || "",
        sessionId: snap.sessionId || "",
        conversationId: snap.conversationId || "",
        cwd: snap.cwd || "",
        status: snap.status || "",
        finishedAt: snap.finishedAt || null,
        outputPath: snap.outputPath || this.#outputPath(id),
        readAt: new Date().toISOString(),
      });
      return receipt;
    });
    return {
      ok: true,
      kind: receiptKind,
      jobIds: ids,
      duplicate: receipts.every((r) => r.duplicate),
      receipts,
      text: [
        `[Durable receipt · ${receiptKind}] ${ids.join(", ")}`,
        receiptKind === "user_accept"
          ? "Recorded USER ACCEPTANCE (the user approved the result)."
          : "Recorded RESULT ACK (the Lead read the result). This is NOT user acceptance.",
        receipts.some((r) => r.duplicate) ? "Duplicate ACK(s) were idempotent — the first receipt is preserved." : "",
      ].filter(Boolean).join("\n"),
    };
  }

  async sessionAction({
    action,
    cwd,
    role,
    slot = "default",
    sessionId,
    jobId,
    jobIds,
    conversationId,
    modelId,
    kind,
    message,
  }) {
    if (action === "status") {
      const codexRateLimits = await this.engines.codex.readRateLimits(false);
      return {
        enabled: this.store.settings.enabled,
        limits: {
          maxConcurrency: this.store.settings.maxConcurrency,
          silentCheckinMin: this.store.settings.silentCheckinMin,
          longRunCheckinMin: this.store.settings.longRunCheckinMin,
          retentionDays: this.store.settings.retentionDays,
          autoFallbackOnLimit: this.store.settings.autoFallbackOnLimit,
          allowHephaestusFullAccess: Boolean(this.store.settings.allowHephaestusFullAccess),
          allowWorktreeParallelWrite: this.store.settings.allowWorktreeParallelWrite === true,
          asyncBackgroundMode: this.store.settings.asyncBackgroundMode === true,
          inspectorEnabled: this.store.settings.inspectorEnabled === true,
          inspectorModelId: this.store.settings.inspectorModelId || null,
          waitJobScript: resolveWaitJobScript(),
        },
        interruptedJobs: this.#interruptedJobs(),
        roles: {
          oracle: this.#roleStatus("oracle"),
          hephaestus: this.#roleStatus("hephaestus"),
        },
        codexRateLimits,
        activeJobs: this.#runningJobs().map((j) => ({
          jobId: j.jobId,
          role: j.role,
          slot: j.slot,
          title: j.title || "",
          sessionId: j.sessionId || "",
          conversationId: j.conversationId || "",
          engine: j.engine,
          modelId: j.modelId || "",
          elapsedSec: Number(((Date.now() - j.startedAt) / 1000).toFixed(1)),
          silentSec: Number(((Date.now() - j.lastActivityAt) / 1000).toFixed(1)),
          lastAction: j.lastAction || lastMeaningfulAction(j.activities, RECOVER_ACTION_TEXT_MAX),
          stallAlert: j.stallAlert || null,
          logPath: j.logPath,
          checkpointPath: this.#checkpointPath(j.jobId),
        })),
        sessions: this.store.listSessions(),
        receipts: this.store.listReceipts().slice(0, 50),
        telemetry: this.telemetry.getSummary(10),
      };
    }

    if (action === "recover") {
      return this.#recoverHandoff({ jobId, jobIds, cwd, role, conversationId });
    }

    if (action === "ack") {
      return this.#ackHandoff({ jobId, jobIds, kind });
    }

    if (action === "interrupt" && jobId) {
      return this.stopJob(jobId);
    }

    role ||= "oracle";
    // Check live jobs first so Turn 1 sessions can be steered before persisting.
    if (action === "steer" || action === "interrupt") {
      const runningJob =
        (jobId ? this.jobs.get(jobId) : null) ||
        this.#runningJobs().find((j) =>
          sessionId
            ? j.sessionId === sessionId
            : (!cwd || normalizeWorkspaceKey(j.cwd) === normalizeWorkspaceKey(cwd)) &&
              j.role === role &&
              j.slot === ((slot || "default").trim() || "default")
        );
      if (runningJob && runningJob.status === "running") {
        if (action === "interrupt") {
          return this.stopJob(runningJob.jobId);
        }
        if (!message) return { ok: false, text: "message is required for steer." };
        if (runningJob.engine === "codex" && runningJob.sessionId) {
          await this.engines.codex.steerTurn(runningJob.sessionId, message);
          this.#appendJobLog(runningJob, { type: "steer", summary: `steer: ${String(message).slice(0, 120)}` });
          return { ok: true, text: `Steered active turn on ${runningJob.sessionId} (${runningJob.jobId}).` };
        }
        return { ok: false, text: `Mid-turn steer is currently supported on Codex (running job ${runningJob.jobId} is on ${runningJob.engine}).` };
      }
    }

    const roleCfg = this.store.getRoleConfig(role);
    const rec = sessionId
      ? this.store.getSessionById(sessionId)
      : this.store.getSession(cwd || process.cwd(), role, slot, roleCfg.model?.id || "");

    if (!rec) {
      return { ok: false, text: `No active session found for role=${role}.` };
    }

    const engine = this.#getEngine(rec.engine);
    if (action === "reset") {
      if (rec.engine === "codex") await this.engines.codex.deleteSession(rec.sessionId);
      this.store.deleteSessionById(rec.sessionId);
      return { ok: true, text: `Reset session ${rec.sessionId} (${rec.role}).` };
    }

    if (action === "compact") {
      if (rec.engine === "codex") {
        await this.engines.codex.compactSession(rec.sessionId);
        return { ok: true, text: `Compaction started for Codex session ${rec.sessionId}.` };
      }
      return {
        ok: false,
        text: `Native compaction is supported on Codex; for ${rec.engine}, use reset when switching tasks.`,
      };
    }

    if (action === "fork") {
      if (rec.engine === "codex") {
        const res = await this.engines.codex.forkSession(rec.sessionId, rec.cwd, rec.role);
        if (res.sessionId) {
          this.store.setSessionById(res.sessionId, {
            ...rec,
            sessionId: res.sessionId,
            title: rec.title ? `${rec.title} (fork)` : "",
            createdAt: new Date().toISOString(),
          });
        }
        return { ok: true, sessionId: res.sessionId, text: `Forked to new Codex session ${res.sessionId}.` };
      }
      return { ok: false, text: `Session fork is currently supported on Codex.` };
    }

    if (action === "steer") {
      if (!message) return { ok: false, text: "message is required for steer." };
      if (rec.engine === "codex") {
        await this.engines.codex.steerTurn(rec.sessionId, message);
        return { ok: true, text: `Steered active turn on ${rec.sessionId}.` };
      }
      return { ok: false, text: `Mid-turn steer is currently supported on Codex.` };
    }

    if (action === "interrupt") {
      const model = this.store.getModelById(rec.modelId);
      await engine?.interruptTurn?.(rec.sessionId, model);
      return { ok: true, text: `Interrupt signal sent to ${rec.sessionId}.` };
    }

    return { ok: false, text: `Unknown action: ${action}` };
  }

  async fetchProviderModels(input) {
    let connection;
    try {
      connection = this.#resolveApiConnection(input);
    } catch (err) {
      return { ok: false, latencyMs: 0, models: [], error: err.message };
    }
    return this.engines["deepseek-harness"].fetchProviderModels(connection);
  }

  #resolveApiConnection(input) {
    const { channelId, modelId } = input;
    let existing;
    if (channelId) {
      existing = this.store.getChannelById(channelId);
    } else if (modelId) {
      const model = this.store.getModelById(modelId);
      if (model?.id === modelId && model.mode === "api") existing = model;
    }
    const baseUrl = input.baseUrl?.trim() || existing?.baseUrl || "";
    const explicitKey = input.apiKey?.trim() || "";
    if (existing && !explicitKey) assertCanReuseApiKey(baseUrl, existing.baseUrl);
    return {
      baseUrl,
      apiKey: explicitKey || existing?.apiKey || "",
      modelName: input.modelName || existing?.modelName || existing?.models?.[0]?.modelName,
    };
  }

  async testConnection(input) {
    if (input.mode === "api") {
      let connection;
      try {
        connection = this.#resolveApiConnection(input);
      } catch (err) {
        return { ok: false, latencyMs: 0, error: err.message };
      }
      return this.engines["deepseek-harness"].testApiConnection(connection);
    }

    const detected = detectEngines(true, this.store.dataDir, this.store.settings.customCliEngines || []);
    const engineId = input.engine || "codex";
    const info = detected[engineId];
    if (!info || !info.installed) {
      return {
        ok: false,
        error: `${engineId} CLI not installed`,
        installCmd: info?.installCmd || "",
      };
    }
    if (engineId === "codex") {
      try {
        const health = await this.engines.codex.healthCheck();
        return {
          ok: info.loggedIn,
          latencyMs: health.latencyMs,
          version: health.version || info.version,
          loggedIn: info.loggedIn,
          rateLimits: health.rateLimits,
          error: info.loggedIn ? undefined : "Not logged in — run: codex login",
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    }
    if (info.extensible) {
      const engine = this.#getEngine(engineId);
      if (engine?.healthCheck) {
        try {
          const health = await engine.healthCheck();
          return {
            ok: Boolean(health.ok && info.loggedIn),
            latencyMs: health.latencyMs,
            version: health.version || info.version,
            loggedIn: info.loggedIn,
            agentInfo: health.agentInfo || null,
            protocol: info.protocol,
            error: health.ok
              ? info.loggedIn
                ? undefined
                : `Not logged in — run: ${info.loginCmd || `${info.command} login`}`
              : health.error || "CLI handshake failed",
          };
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      }
    }
    return {
      ok: info.loggedIn,
      version: info.version,
      loggedIn: info.loggedIn,
      error: info.loggedIn ? undefined : `Not logged in — run: ${info.loginCmd}`,
    };
  }

  async getDashboardState(forceDetect = false, fetchRateLimits = false) {
    const customCliEngines = this.store.settings.customCliEngines || [];
    if (forceDetect) this.invalidateCliCaches();
    const engines = detectEngines(forceDetect, this.store.dataDir, customCliEngines, {
      nonBlocking: true,
      onVersionsReady: () => {
        if (!this.shuttingDown) this.#emitStateChange("cli_versions_ready", {});
      },
    });
    const dshEngine = this.engines["deepseek-harness"];
    const dshReady = engines["deepseek-harness"]?.status === "ready";
    const dshSyncEnabled = dshReady && (forceDetect || fetchRateLimits);
    const codexQuotaCachePath = this.store?.dataDir ? path.join(this.store.dataDir, "codex-quota-cache.json") : "";
    const readCachedCodexQuota = () => {
      if (!codexQuotaCachePath) return null;
      try {
        if (!fs.existsSync(codexQuotaCachePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(codexQuotaCachePath, "utf8"));
        return parsed && typeof parsed === "object" ? { ...parsed, cached: true } : null;
      } catch {
        return null;
      }
    };
    const writeCachedCodexQuota = (rl) => {
      if (!codexQuotaCachePath || !rl) return;
      try {
        fs.writeFileSync(codexQuotaCachePath, JSON.stringify(rl, null, 2), "utf8");
      } catch {}
    };

    let codexRateLimits = this.engines.codex.latestRateLimits;
    if (engines.codex?.status === "ready" && fetchRateLimits) {
      await Promise.allSettled([
        this.engines.codex.readRateLimits(true),
        this.engines.codex.listModels(false),
        ...(dshSyncEnabled ? [dshEngine.listAccountModels(forceDetect)] : []),
      ]);
      codexRateLimits = this.engines.codex.latestRateLimits;
      if (codexRateLimits) writeCachedCodexQuota(codexRateLimits);
    } else if (dshSyncEnabled) {
      await Promise.allSettled([dshEngine.listAccountModels(forceDetect)]);
    } else {
      if (
        engines.codex?.status === "ready" &&
        this.engines.codex.rateLimitsFetchedAt === 0 &&
        !this.cliModelProbes.has("codex-quota")
      ) {
        const cp = Promise.resolve()
          .then(async () => {
            if (this.shuttingDown) return;
            const prev = JSON.stringify(this.engines.codex.latestRateLimits || null);
            await Promise.allSettled([
              this.engines.codex.readRateLimits(false),
              this.engines.codex.listModels(false),
            ]);
            if (this.engines.codex.latestRateLimits) {
              writeCachedCodexQuota(this.engines.codex.latestRateLimits);
              if (JSON.stringify(this.engines.codex.latestRateLimits) !== prev) {
                this.#emitStateChange("cli_models_ready", { engineId: "codex" });
              }
            }
          })
          .catch(() => {})
          .finally(() => this.cliModelProbes.delete("codex-quota"));
        this.cliModelProbes.set("codex-quota", cp);
      }
      if (dshReady && dshEngine.modelsFetchedAt === 0 && !this.cliModelProbes.has("deepseek-harness")) {
        const p = Promise.resolve()
          .then(() => (this.shuttingDown ? null : dshEngine.listAccountModels(false)))
          .then(() => this.#emitStateChange("cli_models_ready", { engineId: "deepseek-harness" }))
          .catch(() => {})
          .finally(() => this.cliModelProbes.delete("deepseek-harness"));
        this.cliModelProbes.set("deepseek-harness", p);
      }
    }
    if (!codexRateLimits && engines.codex?.status === "ready") {
      codexRateLimits = readCachedCodexQuota();
    }

    const codexModels =
      this.engines.codex.latestModels.length > 0
        ? this.engines.codex.latestModels
        : [
            {
              id: "cli-codex-default",
              modelName: engines.codex?.detectedModel || "gpt-6.2-sol",
              displayName: engines.codex?.detectedModel || "gpt-6.2-sol",
              description: "",
              isDefault: true,
              engine: "codex",
            },
          ];

    const dshChannelMap = new Map();
    const dshModels = [];
    const seenDshModelIds = new Set();
    // Account models discovered live via ACP first, then static ~/.dsh/ config models.
    const dshSources = [...(dshEngine.latestModels || []), ...readDshConfigModels()];
    for (const rawModel of dshSources) {
      if (!rawModel || typeof rawModel !== "object") continue;
      const { apiKey, ...model } = rawModel;
      if (!model.id || seenDshModelIds.has(model.id)) continue;
      seenDshModelIds.add(model.id);
      const providerId = model.providerId || "dsh";
      const isAccount = model.authType === "account" || providerId === "deepseek-account";
      let channel = dshChannelMap.get(providerId);
      if (!channel) {
        channel = {
          id: `dsh:${providerId}`,
          name:
            (isAccount ? model.channelName : "") ||
            API_PROVIDERS.find((p) => p.id === providerId)?.nameEn ||
            model.channelName ||
            providerId,
          providerId,
          baseUrl: model.baseUrl || "",
          source: "dsh",
          readOnly: true,
          authType: isAccount ? "account" : undefined,
          hasApiKey: isAccount ? true : Boolean(apiKey),
          maskedApiKey: isAccount ? "" : maskSecret(apiKey),
          models: [],
        };
        dshChannelMap.set(providerId, channel);
      }
      channel.models.push({ id: model.id, modelName: model.modelName, name: model.displayName || model.name });
      dshModels.push({
        ...model,
        channelId: channel.id,
        channelName: channel.name,
        hasApiKey: isAccount ? true : Boolean(apiKey),
        maskedApiKey: isAccount ? "" : maskSecret(apiKey),
      });
    }
    const settings = this.store.getPublicState();
    const cliSubModels = {
      codex: codexModels,
      ...CLI_DEFAULT_MODELS_MAP,
    };
    const installedAcp = Object.entries(engines).filter(
      ([, info]) => info?.extensible && info.installed && info.protocol === "acp"
    );
    for (const [id] of installedAcp) {
      const engine = this.#getEngine(id);
      if (!engine?.listModels) continue;
      const hasConcrete = Array.isArray(engine.latestModels) && engine.latestModels.some((m) => m && !m.isDefault);
      if (Array.isArray(engine.latestModels) && engine.latestModels.length > 0) {
        cliSubModels[id] = engine.latestModels;
      }
      const fetchedAt = Number(engine.modelsFetchedAt || 0);
      const needsProbe =
        forceDetect ||
        fetchedAt === 0 ||
        (!hasConcrete && Date.now() - fetchedAt >= 60_000);
      if (needsProbe) {
        this.#startCliModelProbe(id, engine, forceDetect);
      }
    }
    const cliAccounts = this.#getCliAccountsSnapshot(engines);
    // Sync honest login state from live account probes onto installed extensible CLIs.
    for (const [id, acc] of Object.entries(cliAccounts)) {
      const info = engines[id];
      if (!info || !info.installed || !info.extensible) continue;
      const discoveredConcrete = (cliSubModels[id] || []).some((m) => m && !m.isDefault);
      // Junie publishes its full model catalog even when logged out, so models cannot imply a login.
      const modelsImplyLogin = discoveredConcrete && id !== "junie";
      if (acc.status === "ready" || modelsImplyLogin) {
        info.loggedIn = true;
        info.status = "ready";
        if (modelsImplyLogin && acc.status !== "ready") {
          const cleanPrev =
            acc.accountLabel && acc.accountLabel !== "未登录" && acc.accountLabel !== "正在读取账号…"
              ? acc.accountLabel
              : "";
          cliAccounts[id] = {
            ...acc,
            status: "ready",
            loggedIn: true,
            accountLabel:
              cleanPrev ||
              (id === "opencode"
                ? "本机桌面配置"
                : id === "minimax"
                ? "MiniMax OAuth"
                : id === "junie"
                ? "JetBrains 账号"
                : id === "kiro"
                ? "AWS Kiro 账号"
                : id === "codearts"
                ? "华为云 CodeArts"
                : "已登录"),
          };
        }
      } else if (acc.status === "logged_out") {
        info.loggedIn = false;
        info.status = "not_logged_in";
      }
    }
    const cliEnginesMeta = {};
    for (const [id, info] of Object.entries(engines)) {
      cliEnginesMeta[id] = { ...info };
    }
    const cliAccountProfiles = {};
    for (const engineId of ["codex", "deepseek-harness", "qoder-cn", "qoder", "opencode", "codebuddy", "minimax", "doubao", "junie", "kiro", "codearts"]) {
      if (supportsMultiAccountIsolation(engineId)) cliAccountProfiles[engineId] = this.store.getCliAccountProfiles(engineId);
    }

    return {
      settings,
      channels: settings.channels,
      engines,
      codexRateLimits,
      codexModels,
      dshModels,
      dshModelsSynced: dshEngine.modelsFetchedAt > 0,
      dshChannels: [...dshChannelMap.values()],
      cliEnginePresets: EXTENSIBLE_CLI_PRESETS,
      customCliEngines,
      cliEnginesMeta,
      cliSubModels,
      cliModelWhitelist: this.store.getCliModelWhitelist(),
      cliAccountProfiles,
      cliAccounts,
      cliInstalls: getAllCliInstalls(),
      cooldowns: this.store.getAllActiveCooldowns(),
      sessions: this.store.listSessions(),
      telemetry: this.telemetry.getSummary(30),
      activeJobs: this.#runningJobs().map((j) => ({
        ...this.#summarizeJob(j),
        sessionId: j.sessionId || "",
        checkpointPath: this.#checkpointPath(j.jobId),
        stallAlert: j.stallAlert || null,
      })),
      recentJobs: this.#recentJobs(30),
      interruptedJobs: this.#interruptedJobs(),
      receipts: this.store.listReceipts().slice(0, 50),
      extensions: this.extensionRegistry?.getPublicState?.() || { version: 1, items: [], counts: {} },
    };
  }

  #readLegacyLog(jobId) {
    try {
      const logPath = path.join(this.store.dataDir, "jobs", `${jobId}.log`);
      const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
      const started = /\b(?:Job|Review)\s+\S+\s+started\s+\((oracle|hephaestus):([^,)]+)/.exec(lines[0]);
      return { role: started?.[1] || "", slot: started?.[2]?.trim() || "default", activities: parseLegacyLog(lines) };
    } catch {
      return null;
    }
  }

  // Live and reopened jobs use the same activity shape. Older jobs can replay their text log.
  getJobDetail(jobId) {
    const id = String(jobId || "").trim();
    if (!/^[a-zA-Z0-9_-]{3,48}$/.test(id)) return { ok: false, error: "Invalid jobId" };

    const job = this.jobs.get(id);
    if (job) {
      return {
        ok: true,
        job: {
          ...this.#summarizeJob(job),
          activities: (job.activities || []).map((a) => ({ ...this.#timelineRow(a), detail: a.detail || "" })),
          prompt: job.promptPreview || "",
          finalText: job.finalText || job.result?.text || this.#readFinalText(id),
          recovered: Boolean(job.recovered),
          checkpointPath: this.#checkpointPath(id),
          resultAck: this.store.getReceipt(id, "result_ack"),
          userAccepted: Boolean(this.store.getReceipt(id, "user_accept")),
        },
      };
    }

    const events = this.#readJobEvents(id);
    const legacy = events ? null : this.#readLegacyLog(id);
    let snapshot = null;
    try { snapshot = JSON.parse(fs.readFileSync(this.#statusPath(id), "utf8")); } catch {}
    const finalText = this.#readFinalText(id);
    if (!events && !legacy && !snapshot && !finalText) return { ok: false, error: "Job log not found" };
    const activities = events?.activities || legacy?.activities || [];
    const error = snapshot?.error || activities.findLast((a) => a.type === "error")?.summary || "";
    const checkpoint = safeReadCheckpoint(this.#checkpointPath(id));
    return {
      ok: true,
      job: {
        jobId: id,
        role: snapshot?.role || legacy?.role || "",
        slot: snapshot?.slot || legacy?.slot || "default",
        title: snapshot?.title || "",
        cwd: snapshot?.cwd || "",
        ...(snapshot?.worktree && { worktree: snapshot.worktree }),
        ...(snapshot?.client && { client: snapshot.client }),
        sessionId: snapshot?.sessionId || "",
        conversationId: snapshot?.conversationId || checkpoint?.conversationId || "",
        engine: snapshot?.engine || "",
        modelId: snapshot?.modelId || checkpoint?.modelId || "",
        modelDisplayName: this.#formatJobModelDisplay(snapshot),
        status: snapshot?.status || (error ? "failed" : "completed"),
        elapsedSec: snapshot?.elapsedSec ?? null,
        silentSec: null,
        startedAt: snapshot?.startedAt ?? null,
        finishedAt: snapshot?.finishedAt ?? null,
        hitRate: snapshot?.hitRate ?? null,
        contextPct: snapshot?.contextPct ?? null,
        activityCount: activities.length,
        recentActivities: activities.slice(-5).map((a) => this.#timelineRow(a)),
        logPath: path.join(this.store.dataDir, "jobs", `${id}.log`),
        activities,
        prompt: events?.prompt || "",
        finalText,
        error,
        lastAction: snapshot?.lastAction || lastMeaningfulAction(activities, RECOVER_ACTION_TEXT_MAX),
        checkpointPath: this.#checkpointPath(id),
        checkpoint: checkpoint || null,
        resultAck: this.store.getReceipt(id, "result_ack"),
        userAccepted: Boolean(this.store.getReceipt(id, "user_accept")),
      },
    };
  }

  async shutdown() {
    this.shuttingDown = true;
    for (const job of this.jobs.values()) {
      if (job.status === "running") this.#markJobTerminal(job, "interrupted", job.error || CRASH_RECOVERY_ERROR);
    }
    const engines = [
      ...Object.values(this.engines),
      ...[...this.extensibleEngines.values()].map((entry) => entry.engine),
    ];
    await Promise.allSettled(engines.map((e) => e.shutdown?.()));
  }
}
