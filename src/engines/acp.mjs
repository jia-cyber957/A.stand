import { execFileSync, spawn } from "node:child_process";
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
// Prompt deadlines are progress-based, not wall-clock based: a turn may legitimately run for
// hours while it streams reasoning/tool activity, but a silent stall must not hold a session forever.
const DEFAULT_PROMPT_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_PROMPT_ABSOLUTE_TIMEOUT_MS = 4 * 60 * 60_000;
const DEFAULT_PROMPT_DRAIN_TIMEOUT_MS = 60_000;
// Projection row schema versions this adapter understands. A version bump means the row shape
// may have changed, so the projection sample is ignored and the transcript/RPC paths are used.
const PROJECTION_CACHE_VERSIONS = { tokenUsage: 2, turnBoundary: 2, contextPressure: 5 };
// dsh only emits these committed-progress updates during a turn. Topology/config
// notifications and transport keepalives must not extend the prompt idle deadline.
const PROGRESS_UPDATE_KINDS = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "usage_update",
]);
const FILE_TOOL_RE = /\b(read|read_file|view|open_file|edit|edit_file|write|write_file|create_file|apply_patch|patch|replace|multiedit|str_replace|insert)\b/i;
const SEARCH_TOOL_RE = /\b(grep|glob|find|search|search_files|list_dir|ls|tree|codebase_search)\b/i;
const THOUGHT_EMIT_MS = 1500;
const THOUGHT_GROWTH_CHARS = 80;
const SLOW_TOOL_MS = 2000;
const MAX_THOUGHT_TAIL = 140;
const MAX_RESULT_TAIL = 120;

function toLongFsPath(rawPath) {
  if (process.platform !== "win32" || !rawPath) return rawPath;
  const resolved = path.resolve(rawPath);
  if (resolved.length < 200 || resolved.startsWith("\\\\?\\") || resolved.startsWith("\\\\.\\")) return resolved;
  if (resolved.startsWith("\\\\")) return `\\\\?\\UNC\\${resolved.slice(2)}`;
  return `\\\\?\\${resolved}`;
}

function decompressZstdFile(filePath, dataDir) {
  const fsPath = toLongFsPath(filePath);
  if (!filePath.endsWith(".zstd")) return fs.readFileSync(fsPath, "utf8");
  if (typeof zlib.zstdDecompressSync === "function") {
    return zlib.zstdDecompressSync(fs.readFileSync(fsPath)).toString("utf8");
  }
  // Fallback when the host MCP runtime is Node < 24: reuse dsh's Node 24 runtime to decompress.
  try {
    const bin = resolveDshBinary(dataDir);
    const nodeExe = bin?.nodeExe || (bin?.prefixArgs?.length ? bin.command : "");
    if (!nodeExe) return "";
    return execFileSync(
      nodeExe,
      ["-e", "const fs=require('fs'),z=require('zlib');process.stdout.write(z.zstdDecompressSync(fs.readFileSync(process.argv[1])))", fsPath],
      { encoding: "utf8", windowsHide: true, timeout: 4000, maxBuffer: 32 * 1024 * 1024 }
    );
  } catch {
    return "";
  }
}

// Strip dsh's Windows ConstrainedLanguage boilerplate injected by its UTF8Encoding preamble.
// When that boilerplate was the ONLY reason exitCode became 1 (real command stdout succeeded),
// downgrade the false-positive exitCode 1 to 0 so the timeline isn't flooded with fake errors.
const CONSTRAINED_BLOCK_RE =
  /(?:^|\r?\n)(?:\[stderr\]\s*)?(?:Cannot create type\. Only core types are supported in this language mode\.|无法创建类型。仅在此语言模式下支持核心类型。)[\s\S]*?CannotCreateTypeConstrainedLanguage\s*/g;
const REAL_ERROR_RE =
  /\b(CategoryInfo|FullyQualifiedErrorId|CommandNotFoundException|Permission denied|Access is denied|syntax error|SyntaxError|Traceback|fatal:|ERROR:)\b/i;

export function sanitizeConstrainedLangOutput(output, exitCode) {
  const raw = String(output ?? "");
  if (!raw.includes("CannotCreateTypeConstrainedLanguage") || !/UTF8Encoding/i.test(raw)) {
    return { output: raw, exitCode, falsePositiveCleared: false };
  }
  const stripped = raw
    .replace(CONSTRAINED_BLOCK_RE, "\n")
    .replace(/\n\[stderr\]\s*$/g, "")
    .replace(/^\s*\[stderr\]\s*\r?\n/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const hasRealError = REAL_ERROR_RE.test(stripped);
  if (exitCode === 1 && !hasRealError && stripped.length > 0) {
    return { output: stripped, exitCode: 0, falsePositiveCleared: true };
  }
  return { output: stripped || raw, exitCode, falsePositiveCleared: false };
}

// ---- Prompt deadline / session busy guard helpers ----

export const ACP_PROMPT_TIMEOUT_DEFAULTS = Object.freeze({
  idleMs: DEFAULT_PROMPT_IDLE_TIMEOUT_MS,
  absoluteMs: DEFAULT_PROMPT_ABSOLUTE_TIMEOUT_MS,
  drainMs: DEFAULT_PROMPT_DRAIN_TIMEOUT_MS,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * True only for committed agent progress that proves the model is still working.
 * `config_option_update`, `available_commands_update`, permission requests and any
 * transport keepalive must NOT extend the prompt idle deadline.
 */
export function isPromptProgressUpdate(update) {
  return Boolean(update && PROGRESS_UPDATE_KINDS.has(String(update.sessionUpdate || "")));
}

/**
 * Sliding idle + absolute deadline for one `session/prompt` request.
 * The idle window is renewed only by `touch()` (real progress); the absolute cap never moves.
 * The deadline is cleared at turn exit.
 */
export class PromptDeadline {
  constructor({ idleMs = DEFAULT_PROMPT_IDLE_TIMEOUT_MS, absoluteMs = DEFAULT_PROMPT_ABSOLUTE_TIMEOUT_MS, now = Date.now, onExpire } = {}) {
    this.idleMs = Math.max(1, Number(idleMs) || DEFAULT_PROMPT_IDLE_TIMEOUT_MS);
    this.absoluteMs = Math.max(this.idleMs, Number(absoluteMs) || DEFAULT_PROMPT_ABSOLUTE_TIMEOUT_MS);
    this.now = now;
    this.onExpire = typeof onExpire === "function" ? onExpire : null;
    this.startedAt = 0;
    this.lastProgressAt = 0;
    this.expiredReason = "";
    this.timer = null;
    this.armed = false;
  }

  start() {
    if (this.armed) return this;
    this.armed = true;
    this.startedAt = this.now();
    this.lastProgressAt = this.startedAt;
    this.#schedule();
    return this;
  }

  /** Record meaningful progress; only this renews the idle window. */
  touch() {
    if (!this.armed || this.expiredReason) return;
    this.lastProgressAt = this.now();
  }

  stop() {
    this.armed = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  snapshot() {
    return {
      startedAt: this.startedAt,
      lastProgressAt: this.lastProgressAt,
      idleMs: this.idleMs,
      absoluteMs: this.absoluteMs,
      expiredReason: this.expiredReason,
      armed: this.armed,
    };
  }

  #schedule() {
    if (this.timer) clearTimeout(this.timer);
    const now = this.now();
    const idleRemaining = this.lastProgressAt + this.idleMs - now;
    const absoluteRemaining = this.startedAt + this.absoluteMs - now;
    const wait = Math.max(1, Math.min(idleRemaining, absoluteRemaining));
    // Deliberately NOT unref'd: an in-flight prompt already owns a pending RPC, and the deadline
    // must fire deterministically so a stalled turn can never be left dangling.
    this.timer = setTimeout(() => this.#check(), wait);
  }

  #check() {
    this.timer = null;
    if (!this.armed || this.expiredReason) return;
    const now = this.now();
    let reason = "";
    if (now >= this.startedAt + this.absoluteMs) reason = "absolute";
    else if (now >= this.lastProgressAt + this.idleMs) reason = "idle";
    if (!reason) {
      this.#schedule();
      return;
    }
    this.expiredReason = reason;
    this.armed = false;
    try {
      this.onExpire?.(reason);
    } catch {}
  }
}

// ---- DeepSeek Harness projection-cache telemetry ----

function isNonNegInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function cwdKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const resolved = path.resolve(raw);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  } catch {
    return raw;
  }
}

function tryRealpath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(raw) : fs.realpathSync(raw);
  } catch {
    try {
      return fs.realpathSync(raw);
    } catch {
      return "";
    }
  }
}

function isDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || "")) || /^[A-Za-z]:$/.test(String(value || ""));
}

function isUncPath(value) {
  return /^[\\/]{2}[^\\/]/.test(String(value || ""));
}

/**
 * A path's comparable tail: drive letter and UNC server are stripped, so
 * `Z:\share\repo\src` and `\\host\share\repo\src` both become `share/repo/src`.
 * Only used for the drive-vs-UNC SMB case; never relaxes same-namespace mismatches.
 */
function pathTailSegments(value) {
  const norm = String(value || "").trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm) return [];
  let parts = norm.split("/").filter(Boolean);
  if (isUncPath(norm) && parts.length > 0) parts = parts.slice(1);
  else if (/^[A-Za-z]:$/.test(parts[0] || "")) parts = parts.slice(1);
  return parts.map((part) => (process.platform === "win32" ? part.toLowerCase() : part));
}

/**
 * Compare two cwds, tolerating Windows SMB mapped-drive aliases (Z:\share\repo vs
 * \\host\share\repo). The tail fallback only applies when one side is a drive path and the
 * other is UNC, and only when the projection record was read from `<sessionId>.json`.
 */
export function acpCwdEquivalent(a, b, options = {}) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left || !right) return true;
  if (cwdKey(left) === cwdKey(right)) return true;

  const alias = (isDrivePath(left) && isUncPath(right)) || (isUncPath(left) && isDrivePath(right));
  if (alias && options.sessionId && options.sessionIdMatched !== false) {
    // Cheap tail match first: a valid mapped drive must not pay an SMB realpath round-trip.
    const leftTail = pathTailSegments(left);
    const rightTail = pathTailSegments(right);
    if (leftTail.length > 0 && rightTail.length > 0) {
      const common = Math.min(leftTail.length, rightTail.length);
      let same = true;
      for (let i = 0; i < common; i++) {
        if (leftTail[leftTail.length - 1 - i] !== rightTail[rightTail.length - 1 - i]) {
          same = false;
          break;
        }
      }
      if (same) return true;
    }
  }

  // Canonicalize as a best-effort fallback (handles localized share names where Z:\公共 maps to
  // \\host\Important). Only reached for aliases whose tails differ, or same-namespace paths.
  const leftReal = tryRealpath(left);
  const rightReal = tryRealpath(right);
  return Boolean(leftReal && rightReal && cwdKey(leftReal) === cwdKey(rightReal));
}

const PROJECTION_BUCKET_FIELDS = ["uncachedInputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];

function validBuckets(buckets) {
  if (!buckets || typeof buckets !== "object") return false;
  return PROJECTION_BUCKET_FIELDS.every((field) => isNonNegInt(buckets[field]));
}

function bucketTotal(buckets) {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens;
}

/**
 * Parse one `storages/session_projcache/sessions/<sessionId>.json` document.
 *
 * dsh persists `{ version, record: { identity, rows } }`; each row is `{ ver, seq, val }`.
 * The token usage row is the projection defined in dsh-token-meter:
 * `record.rows.tokenUsage.val = { totals, last: { turn, step, buckets } }`.
 * Returns null for anything that is not that shape; never throws.
 */
export function parseAcpProjectionRecord(raw) {
  let doc = raw;
  if (typeof raw === "string") {
    try {
      doc = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!doc || typeof doc !== "object") return null;
  const record = doc.record && typeof doc.record === "object" ? doc.record : doc;
  const rows = record.rows;
  if (!rows || typeof rows !== "object") return null;
  const row = (key) => (rows[key] && typeof rows[key] === "object" ? rows[key] : null);
  const identity = record.identity && typeof record.identity === "object" ? record.identity : {};
  const tokenUsage = row("tokenUsage");
  const turnBoundary = row("turnBoundary");
  const contextPressure = row("contextPressure");
  return {
    identity: {
      formatVersion: isNonNegInt(identity.formatVersion) ? identity.formatVersion : null,
      cwd: typeof identity.cwd === "string" ? identity.cwd : "",
      isSeeded: identity.isSeeded === true,
      inheritedEventCount: isNonNegInt(identity.inheritedEventCount) ? identity.inheritedEventCount : 0,
    },
    tokenUsage: tokenUsage ? { ver: tokenUsage.ver, seq: tokenUsage.seq, val: tokenUsage.val } : null,
    turnBoundary: turnBoundary ? { ver: turnBoundary.ver, seq: turnBoundary.seq, val: turnBoundary.val } : null,
    contextPressure: contextPressure
      ? { ver: contextPressure.ver, seq: contextPressure.seq, val: contextPressure.val }
      : null,
  };
}

/** Snapshot the projection watermarks a turn must advance past before its sample is trusted. */
export function captureAcpProjectionBaseline(snapshot) {
  if (!snapshot?.tokenUsage) return null;
  const { seq, val } = snapshot.tokenUsage;
  const last = val && typeof val === "object" ? val.last : null;
  if (!last || !isNonNegInt(last.turn) || !isNonNegInt(last.step)) {
    return {
      seq: isNonNegInt(seq) ? seq : null,
      turn: null,
      step: null,
      totals: validBuckets(val?.totals) ? { ...val.totals } : null,
    };
  }
  return {
    seq: isNonNegInt(seq) ? seq : null,
    turn: last.turn,
    step: last.step,
    totals: validBuckets(val?.totals) ? { ...val.totals } : null,
  };
}

/**
 * Decide whether a projection snapshot is a trustworthy sample for the turn that just ran.
 *
 * Freshness requires BOTH: the row watermark advanced past the pre-dispatch baseline AND the
 * provider step advanced. Without a baseline, the sample must match the transcript's last
 * assistant step or have been written after dispatch. Stale/reused sessions are rejected.
 *
 * `usage` is deliberately scoped to the LAST PROVIDER STEP (`tokenUsage.val.last.buckets`),
 * matching the existing transcript/RPC semantics. Whole-turn numbers, when derivable from the
 * session-cumulative `totals` delta, are reported separately under `provenance.turnTotals`.
 */
export function evaluateAcpProjectionUsage(snapshot, options = {}) {
  if (!snapshot) return { ok: false, reason: "no-projection-record" };
  const identity = snapshot.identity || {};
  if (options.cwd && identity.cwd && !acpCwdEquivalent(identity.cwd, options.cwd, options)) {
    return { ok: false, reason: "cwd-mismatch" };
  }
  const tokenUsage = snapshot.tokenUsage;
  if (!tokenUsage) return { ok: false, reason: "missing-tokenUsage-row" };
  if (tokenUsage.ver !== PROJECTION_CACHE_VERSIONS.tokenUsage) {
    return { ok: false, reason: `unsupported-tokenUsage-version:${tokenUsage.ver}` };
  }
  const val = tokenUsage.val;
  if (!val || typeof val !== "object") return { ok: false, reason: "malformed-tokenUsage-row" };
  const last = val.last;
  if (!last || typeof last !== "object") return { ok: false, reason: "no-provider-step-sample" };
  if (!isNonNegInt(last.turn) || !isNonNegInt(last.step) || last.step < 1) {
    return { ok: false, reason: "malformed-provider-step" };
  }
  if (!validBuckets(last.buckets)) return { ok: false, reason: "malformed-tokenUsage-buckets" };

  const seq = isNonNegInt(tokenUsage.seq) ? tokenUsage.seq : null;
  const baseline = options.baseline || null;
  const transcriptLastStep = options.transcriptLastStep || null;
  let freshness = "";
  if (baseline) {
    const advanced =
      (isNonNegInt(baseline.turn) && last.turn > baseline.turn) ||
      (baseline.turn === last.turn && isNonNegInt(baseline.step) && last.step > baseline.step);
    if (!advanced) return { ok: false, reason: "stale-sample" };
    if (baseline.seq !== null && baseline.seq !== undefined && seq !== null && seq <= baseline.seq) {
      return { ok: false, reason: "stale-watermark" };
    }
    freshness = "advanced-since-dispatch-baseline";
  } else if (
    transcriptLastStep &&
    transcriptLastStep.turn === last.turn &&
    transcriptLastStep.step === last.step
  ) {
    freshness = "matches-transcript-last-step";
  } else if (
    isNonNegInt(options.mtimeMs) &&
    isNonNegInt(options.startedAtMs) &&
    options.mtimeMs >= options.startedAtMs - 5_000
  ) {
    freshness = "projection-mtime-after-dispatch";
  } else {
    return { ok: false, reason: "unverified-freshness" };
  }

  const buckets = last.buckets;
  const totalInput = bucketTotal(buckets);

  let context = null;
  const pressureRow = snapshot.contextPressure;
  if (pressureRow && pressureRow.ver === PROJECTION_CACHE_VERSIONS.contextPressure && pressureRow.val) {
    const pv = pressureRow.val;
    const window = isNonNegInt(pv.contextWindow) ? pv.contextWindow : null;
    const pressure = isNonNegInt(pv.pressureTokens) ? pv.pressureTokens : null;
    const surface = isNonNegInt(pv.surfaceTokens) ? pv.surfaceTokens : null;
    const sampled = isNonNegInt(pv.sampledSurfaceTokens) ? pv.sampledSurfaceTokens : null;
    let tokens = null;
    let field = "";
    if (pressure !== null && surface !== null && sampled !== null) {
      tokens = Math.max(0, pressure + surface - sampled);
      field = "record.rows.contextPressure.val.{pressureTokens + surfaceTokens - sampledSurfaceTokens}";
    } else if (pressure !== null) {
      tokens = pressure;
      field = "record.rows.contextPressure.val.pressureTokens";
    }
    if (tokens !== null && window) {
      context = { tokens, contextWindow: window, contextPct: round1((tokens / window) * 100), field };
    }
  }

  let turnTotals = null;
  let turnTotalsReason = "";
  const totals = val.totals;
  if (!baseline?.totals) {
    turnTotalsReason = "no cumulative totals captured before dispatch";
  } else if (!validBuckets(totals)) {
    turnTotalsReason = "malformed cumulative totals";
  } else {
    const delta = {};
    for (const field of PROJECTION_BUCKET_FIELDS) delta[field] = totals[field] - baseline.totals[field];
    if (PROJECTION_BUCKET_FIELDS.some((field) => delta[field] < 0)) {
      turnTotalsReason = "cumulative totals decreased (retry replacement/compaction); whole-turn delta not derivable";
    } else {
      const deltaInput = bucketTotal(delta);
      turnTotals = {
        ...delta,
        totalInputTokens: deltaInput,
        cacheHitRate: deltaInput > 0 ? round1((delta.cacheReadTokens / deltaInput) * 100) : null,
        scope: "whole-turn",
        basis: "record.rows.tokenUsage.val.totals after minus before dispatch",
      };
    }
  }

  const usage = {
    inputTokens: totalInput,
    cachedInputTokens: buckets.cacheReadTokens,
    cacheWriteInputTokens: buckets.cacheWriteTokens,
    outputTokens: buckets.outputTokens,
    ...(context ? { contextWindow: context.contextWindow } : {}),
  };
  const provenance = {
    source: "projection.session_projcache",
    scope: "last-provider-step",
    sessionId: String(options.sessionId || ""),
    turn: last.turn,
    step: last.step,
    seq,
    tokenUsageSeq: seq,
    formatVersion: identity.formatVersion,
    freshness,
    fields: {
      inputTokens:
        "record.rows.tokenUsage.val.last.buckets.{uncachedInputTokens + cacheReadTokens + cacheWriteTokens}",
      cachedInputTokens: "record.rows.tokenUsage.val.last.buckets.cacheReadTokens",
      cacheWriteInputTokens: "record.rows.tokenUsage.val.last.buckets.cacheWriteTokens",
      outputTokens: "record.rows.tokenUsage.val.last.buckets.outputTokens",
      contextTokens: context ? context.field : null,
      contextWindow: context ? "record.rows.contextPressure.val.contextWindow" : null,
    },
    context,
    turnTotals,
    ...(turnTotalsReason ? { turnTotalsReason } : {}),
    note: "tokenUsage.val.last is the latest provider step; tokenUsage.val.totals is session-cumulative, so it is never reported as a turn total.",
  };
  return { ok: true, usage, provenance, turnTotals, context };
}

// dsh write-behind projection cache: poll long enough to survive a slow Turn-1 flush, but only
// when the cache plugin's sessions directory exists at all (zero overhead for plugin-less dsh).
export const PROJECTION_POLL_ATTEMPTS = 12;
export const PROJECTION_POLL_INTERVAL_MS = 100;

export function projectionCacheSessionsDir(dshHome) {
  return dshHome ? path.join(dshHome, "storages", "session_projcache", "sessions") : "";
}

/**
 * Poll for a fresh projection sample. The sessions directory must already exist; if it does not,
 * the cache plugin is absent and we return immediately instead of waiting 1.2s per turn.
 *
 * `readRecord(dshHome, sessionId)` is injected so the polling contract is unit-testable without
 * spawning dsh. Returns `{ record, evaluated }` for the freshest sample, or null.
 */
export async function readFreshProjectionSample({
  dshHome,
  sessionId,
  baseline,
  options = {},
  readRecord,
  attempts = PROJECTION_POLL_ATTEMPTS,
  intervalMs = PROJECTION_POLL_INTERVAL_MS,
  sleep,
} = {}) {
  if (!dshHome || !sessionId || typeof readRecord !== "function") return null;
  const sessionsDir = projectionCacheSessionsDir(dshHome);
  if (!fs.existsSync(toLongFsPath(sessionsDir))) return null;
  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const record = readRecord(dshHome, sessionId);
    if (record) {
      const evaluated = evaluateAcpProjectionUsage(record.snapshot, {
        ...options,
        baseline,
        mtimeMs: record.mtimeMs,
      });
      if (evaluated.ok) return { record, evaluated };
      best = { record, evaluated };
    }
    if (attempt < attempts - 1) await wait(intervalMs);
  }
  return best;
}

function extractLeadingJsonObject(text) {
  if (!text.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { json: text.slice(0, i + 1), remainder: text.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Detect the raw `{"content":"","tool_calls":[...]}` protocol dump that a misbehaving upstream
 * sometimes emits as assistant prose instead of executing the tools.
 *
 * Conservative by construction: the trimmed output must START with `{` (or a ```json fence), the
 * whole payload must be a tool_calls envelope with empty content, and any bytes outside the JSON
 * object may only be stray closing braces/commas. A normal answer that merely mentions
 * `"tool_calls"` in prose or a documentation snippet cannot match.
 */
export function isLeakedToolCallsOutput(text) {
  if (typeof text !== "string") return false;
  let body = text.trim();
  if (!body) return false;
  const fenced = body.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i);
  if (fenced) body = fenced[1].trim();
  if (!body.startsWith("{")) return false;
  if (!/"tool_calls"\s*:\s*\[/.test(body)) return false;
  if (!(/"content"\s*:\s*""/.test(body) || /"type"\s*:\s*"function"/.test(body))) return false;

  const extracted = extractLeadingJsonObject(body);
  if (extracted) {
    const tail = extracted.remainder.trim();
    if (tail && !/^[}\]\s,;]*$/.test(tail)) return false;
    try {
      const parsed = JSON.parse(extracted.json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      if (!Array.isArray(parsed.tool_calls)) return false;
      if (typeof parsed.content === "string" && parsed.content.trim() !== "") return false;
      return true;
    } catch {
      // Malformed/truncated dump (e.g. one extra trailing `}`): still a leak when structurally
      // tool_calls-shaped and an empty content field proves it is not human prose.
      return true;
    }
  }

  // Unbalanced object (truncated mid-stream). Accept only when the payload is unambiguous and no
  // natural-language lines leak outside it.
  if (!/[}\]][\s}\]]*$/.test(body)) return false;
  const proseLines = body.split(/\r?\n/).filter((line) => {
    const clean = line.trim();
    if (!clean) return false;
    if (/^[{"}\],;\s]*$/.test(clean)) return false;
    if (!/\s/.test(clean)) return false;
    return !/[{}[\]]/.test(clean);
  });
  return proseLines.length === 0;
}

/** Raised when a prompt is requested for a session that already has an unacknowledged turn. */
export class AcpSessionBusyError extends Error {
  constructor(sessionId, detail = "") {
    super(
      `[deepseek-harness] session ${sessionId} is busy: ${detail || "a prompt is already in flight"}. ` +
        "Wait for the in-flight turn to settle (or cancel it) before sending another prompt."
    );
    this.name = "AcpSessionBusyError";
    this.sessionId = sessionId;
    this.isSessionBusy = true;
  }
}

/** Raised when a delta resume cannot be distinguished from a busy/failed upstream session. */
export class AcpResumeIndeterminateError extends Error {
  constructor(sessionId, cause) {
    const detail = String(cause?.message || cause || "unknown error");
    super(
      `[deepseek-harness] session/resume for ${sessionId} failed indeterminately: ${detail}. ` +
        "Refusing to silently start a new session and drop the resumed delta; retry after the session settles."
    );
    this.name = "AcpResumeIndeterminateError";
    this.sessionId = sessionId;
    this.isResumeIndeterminate = true;
    this.cause = cause;
  }
}

/**
 * A resume failure is indeterminate when it may mean "the session is still active" rather than
 * "the session does not exist". Only an explicit unknown/unresumable/not-found error is treated
 * as a definitive miss that may fall back to a fresh session.
 */
export function isIndeterminateResumeFailure(err) {
  const detail = String(err?.message || err || "").toLowerCase();
  if (!detail) return true;
  if (/\b(unknown session|not resumable|no such session|session not found|does not exist)\b/.test(detail)) {
    return false;
  }
  if (/(already active|in flight|busy|timeout|timed out|aborted|cancelled|canceled|econnreset|epipe|exited)/.test(detail)) {
    return true;
  }
  // Unknown/unclassified upstream errors are treated as indeterminate on purpose: retrying is
  // recoverable, silently starting a new session is not.
  return true;
}

/**
 * Extract the official DeepSeek Account models that `dsh --profile acp` dynamically
 * returns in `session/new -> result.configOptions`.
 *
 * Only the `"deepseek-account"` group is used: ACP also advertises `"deepseek-official"`
 * even when no API key is configured, while `"deepseek-account"` requires the logged-in
 * account session. Returns [] for malformed input and never throws.
 */
export function parseAcpModelOptions(configOptions) {
  if (!Array.isArray(configOptions)) return [];
  const modelOption = configOptions.find((opt) => opt && (opt.id === "model" || opt.category === "model"));
  if (!modelOption || !Array.isArray(modelOption.options)) return [];

  const out = [];
  const seen = new Set();
  for (const group of modelOption.options) {
    if (!group || typeof group !== "object") continue;
    if (String(group.group || "").trim() !== "deepseek-account") continue;
    const groupName = String(group.name || "").trim() || "DeepSeek Account";
    const entries = Array.isArray(group.options) ? group.options : [];
    for (const opt of entries) {
      let parsed;
      try {
        parsed = JSON.parse(opt?.value);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed) || parsed.length < 2) continue;
      const providerId = String(parsed[0] || "").trim();
      const modelName = String(parsed[1] || "").trim();
      if (!providerId || !modelName) continue;
      const id = `dsh:${providerId}:${modelName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const displayName = String(opt?.name || "").trim() || modelName;
      out.push({
        id,
        name: displayName,
        displayName,
        modelName,
        mode: "api",
        engine: "deepseek-harness",
        providerId,
        channelName: groupName,
        baseUrl: "",
        source: "dsh",
        authType: "account",
        readonly: true,
        description: String(opt?.description || ""),
        apiKey: "",
      });
    }
  }
  return out;
}

/**
 * Extract supported `reasoning_effort` values advertised in ACP `configOptions`.
 * Returns null if `reasoning_effort` is absent or empty.
 */
export function parseAcpEffortOptions(configOptions) {
  if (!Array.isArray(configOptions)) return null;
  const opt = configOptions.find((o) => o && (o.id === "reasoning_effort" || o.category === "reasoning_effort"));
  if (!opt || !Array.isArray(opt.options)) return null;
  const values = [];
  const seen = new Set();
  for (const entry of opt.options) {
    const items = Array.isArray(entry?.options) ? entry.options : [entry];
    for (const item of items) {
      const val = typeof item === "string" ? item : typeof item?.value === "string" ? item.value : "";
      const norm = val.trim().toLowerCase();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      values.push(norm);
    }
  }
  return values.length > 0 ? values : null;
}

/**
 * Dynamically map A.stand's 4-tier effort (`off` / `low` / `medium` / `high`) to upstream ACP values.
 * When upstream omits `medium` and offers `low / high / max` (3-tier scale), map:
 *   low -> low, medium -> high, high -> max.
 */
export function resolveAcpEffortCandidates(requestedEffort, supportedOptions = null) {
  const eff = ["off", "low", "medium", "high"].includes(requestedEffort) ? requestedEffort : "medium";
  if (Array.isArray(supportedOptions) && supportedOptions.length > 0) {
    const supported = new Set(supportedOptions.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean));
    const hasMedium = supported.has("medium");
    const hasMax = supported.has("max");
    const preferred =
      !hasMedium && hasMax
        ? eff === "off"
          ? ["off", "low"]
          : eff === "low"
            ? ["low", "off"]
            : eff === "medium"
              ? ["high", "low"]
              : ["max", "high"]
        : eff === "off"
          ? ["off", "low"]
          : eff === "low"
            ? ["low", "medium", "off"]
            : eff === "medium"
              ? ["medium", "high", "low"]
              : ["high", "max", "medium"];
    const matched = preferred.filter((v) => supported.has(v));
    if (matched.length > 0) return matched;
  }
  return eff === "medium" ? ["medium", "high", "low"] : eff === "high" ? ["high", "max"] : [eff];
}

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
    // sessionId -> busy guard. Held from prompt dispatch until the ORIGINAL RPC replies
    // (or the child dies). Shared across profiles: a session id is globally unique in dsh.
    this.busySessions = new Map();
    this.latestModels = [];
    this.modelsFetchedAt = 0;
    this.modelsPromise = null;
  }

  #acquireSessionGuard(sessionId, state) {
    const existing = this.busySessions.get(sessionId);
    if (existing) return { acquired: false, guard: existing };
    const guard = {
      sessionId,
      state,
      startedAt: Date.now(),
      reason: "",
      settled: deferred(),
      released: false,
    };
    this.busySessions.set(sessionId, guard);
    return { acquired: true, guard };
  }

  #releaseSessionGuard(guard) {
    if (!guard || guard.released) return;
    guard.released = true;
    if (this.busySessions.get(guard.sessionId) === guard) this.busySessions.delete(guard.sessionId);
    guard.settled.resolve();
  }

  /** Send `session/cancel` for exactly one session on exactly one client. Never kills shared clients. */
  #sendCancel(state, sessionId, reason = "") {
    if (!state || !sessionId) return false;
    try {
      state.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover the logged-in DeepSeek Account models by briefly spawning `dsh --profile acp`
   * and reading `session/new -> result.configOptions`. Cached for 5 minutes, deduplicated
   * across concurrent callers, read-only, and never throws.
   */
  async listAccountModels(force = false) {
    if (!force && this.modelsFetchedAt > 0 && Date.now() - this.modelsFetchedAt < 300_000) {
      return this.latestModels;
    }
    if (this.modelsPromise) return this.modelsPromise;

    this.modelsPromise = (async () => {
      let proc = null;
      let timer = null;
      try {
        const bin = resolveDshBinary(this.dataDir);
        if (!bin || bin.nodeTooOld) {
          this.modelsFetchedAt = Date.now();
          return this.latestModels;
        }

        proc = spawn(bin.command, [...(bin.prefixArgs || []), "--profile", "acp"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          shell: bin.useShell,
          env: utf8Env({ DSH_PERMISSION_MODE: "read-only" }),
        });

        const configOptions = await new Promise((resolve) => {
          let settled = false;
          let nextId = 1;
          const pending = new Map();
          const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };

          const send = (obj) => {
            try {
              if (proc.stdin?.writable) proc.stdin.write(JSON.stringify(obj) + "\n");
            } catch {
              finish(null);
            }
          };

          const request = (method, params) =>
            new Promise((resolveReq) => {
              const id = nextId++;
              pending.set(id, { method, resolveReq });
              send({ jsonrpc: "2.0", id, method, params });
            });

          timer = setTimeout(() => finish(null), 18_000);
          timer.unref?.();

          proc.on("error", () => finish(null));
          proc.on("exit", () => finish(null));
          readline.createInterface({ input: proc.stdout }).on("line", async (line) => {
            const trimmed = String(line || "").trim();
            if (!trimmed) return;
            let msg;
            try {
              msg = JSON.parse(trimmed);
            } catch {
              return;
            }
            if (msg?.id === undefined) return;
            const pendingReq = pending.get(msg.id);
            if (!pendingReq) return;
            pending.delete(msg.id);
            pendingReq.resolveReq(msg.error ? null : msg.result);

            if (pendingReq.method !== "initialize") return;
            // initialize replied -> create a throwaway session and read its model catalog.
            try {
              const created = await request("session/new", {
                cwd: this.dataDir || process.cwd(),
                mcpServers: [],
              });
              finish(Array.isArray(created?.configOptions) ? created.configOptions : null);
            } catch {
              finish(null);
            }
          });

          request("initialize", {
            protocolVersion: 1,
            clientCapabilities: {},
            clientInfo: { name: "agent-relay", version: "1.0.0" },
          });
        });

        const parsed = parseAcpModelOptions(configOptions);
        if (parsed.length > 0) this.latestModels = parsed;
        this.modelsFetchedAt = Date.now();
        return this.latestModels;
      } catch {
        this.modelsFetchedAt = Date.now();
        return this.latestModels;
      } finally {
        if (timer) clearTimeout(timer);
        if (proc) await Promise.resolve(safeKill(proc)).catch(() => {});
        this.modelsPromise = null;
      }
    })();

    return this.modelsPromise;
  }

  #profileKey(model, permissionMode = "workspace-write") {
    const keyHash = createHash("sha256").update(model?.apiKey || "").digest("hex").slice(0, 16);
    return `${model?.id || "default"}::${model?.source || "custom"}::${model?.baseUrl || ""}::${model?.modelName || ""}::${keyHash}::${permissionMode}`;
  }

  /**
   * Read the dsh session-projection cache record for one session.
   * Returns `{ snapshot, path, mtimeMs }` or null; never throws.
   */
  #readProjectionCacheRecord(dshHome, sessionId) {
    if (!dshHome || !sessionId) return null;
    try {
      const file = path.join(dshHome, "storages", "session_projcache", "sessions", `${sessionId}.json`);
      const fsPath = toLongFsPath(file);
      if (!fs.existsSync(fsPath)) return null;
      const stat = fs.statSync(fsPath);
      const text = fs.readFileSync(fsPath, "utf8");
      const snapshot = parseAcpProjectionRecord(text);
      if (!snapshot) return null;
      return { snapshot, path: file, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }

  /**
   * Wait briefly for dsh's write-behind projection cache to publish a sample for this turn.
   * The `turn/end` checkpoint is mandatory, but the write can land a few ms after the session
   * log; polling here avoids losing telemetry to a flush race.
   *
   * Cost is bounded and self-limiting: no cache file at all (dsh without the cache plugin)
   * returns immediately, and polling stops as soon as a fresh sample appears.
   */
  async #readFreshProjectionSample(dshHome, sessionId, baseline, options) {
    return readFreshProjectionSample({
      dshHome,
      sessionId,
      baseline,
      // The record is read from `<sessionId>.json`, so the filename already binds it to this turn.
      options: { ...options, sessionIdMatched: true },
      readRecord: (home, sid) => this.#readProjectionCacheRecord(home, sid),
    });
  }

  async #readDshSessionCacheUsage(dshHome, sessionId, prevTurnCount = 0) {
    if (!dshHome || !sessionId) return null;
    const readOnce = () => {
      try {
        const sessionsRoot = path.join(dshHome, "sessions");
        if (!fs.existsSync(toLongFsPath(sessionsRoot))) return null;
        let targetFile = "";
        for (const wsEntry of fs.readdirSync(toLongFsPath(sessionsRoot))) {
          const candZstd = path.join(sessionsRoot, wsEntry, sessionId, "session.v4.jsonl.zstd");
          if (fs.existsSync(toLongFsPath(candZstd))) {
            targetFile = candZstd;
            break;
          }
          const candPlain = path.join(sessionsRoot, wsEntry, sessionId, "session.v4.jsonl");
          if (fs.existsSync(toLongFsPath(candPlain))) {
            targetFile = candPlain;
            break;
          }
        }
        if (!targetFile) return null;
        const text = decompressZstdFile(targetFile, this.dataDir);
        if (!text) return null;
        const lines = text.split(/\r?\n/);
        let turnEnds = 0;
        let lastStopReason = "";
        let lastUsage = null;
        let lastStep = null;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          if (line.includes('"turn/end"')) {
            turnEnds++;
            try {
              const obj = JSON.parse(line);
              const kind = obj?.data?.reason?.kind || obj?.data?.stopReason || "";
              if (kind) lastStopReason = String(kind);
            } catch {}
          } else if (line.includes('"assistant/message"')) {
            try {
              const obj = JSON.parse(line);
              const u = obj?.data?.usage || obj?.data?.message?.usage;
              if (u && typeof u === "object" && (typeof u.inputTokens === "number" || typeof u.cacheReadTokens === "number")) {
                lastUsage = u;
              }
              const turn = obj?.data?.turn;
              const step = obj?.data?.step;
              if (Number.isInteger(turn) && Number.isInteger(step)) lastStep = { turn, step };
            } catch {}
          }
        }
        if (!lastUsage) return { turnEnds, lastStopReason, lastStep, usage: null };
        const uncached = typeof lastUsage.inputTokens === "number" ? lastUsage.inputTokens : 0;
        const hasCache = typeof lastUsage.cacheReadTokens === "number";
        const cached = hasCache ? lastUsage.cacheReadTokens : null;
        const cacheWrite = typeof lastUsage.cacheWriteTokens === "number" ? lastUsage.cacheWriteTokens : 0;
        const totalInput = uncached + (cached || 0) + cacheWrite;
        return {
          turnEnds,
          lastStopReason,
          lastStep,
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
      if (snap && (snap.usage || snap.lastStopReason)) best = snap;
      if (snap && snap.turnEnds > prevTurnCount && (snap.usage || snap.lastStopReason)) return snap;
      await new Promise((r) => setTimeout(r, 60));
    }
    return best;
  }

  #countDshTurnEnds(dshHome, sessionId) {
    if (!dshHome || !sessionId) return 0;
    try {
      const sessionsRoot = path.join(dshHome, "sessions");
      if (!fs.existsSync(toLongFsPath(sessionsRoot))) return 0;
      for (const wsEntry of fs.readdirSync(toLongFsPath(sessionsRoot))) {
        for (const fname of ["session.v4.jsonl.zstd", "session.v4.jsonl"]) {
          const fp = path.join(sessionsRoot, wsEntry, sessionId, fname);
          if (!fs.existsSync(toLongFsPath(fp))) continue;
          const text = decompressZstdFile(fp, this.dataDir);
          if (!text) continue;
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
            const legacyDir = path.join(this.dataDir, "dsh-profiles", safeId);
            // Keep existing legacy profile dir to preserve sessions; use compact 12-char id for new long UUID models
            // so Windows paths stay safely under 260-char MAX_PATH even with Chinese-encoded workspace dirs.
            const shortId = safeId.length > 16
              ? `p_${createHash("sha256").update(safeId).digest("hex").slice(0, 10)}`
              : safeId;
            const profileDir = fs.existsSync(legacyDir)
              ? legacyDir
              : path.join(this.dataDir, "dsh-profiles", shortId);
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
              "        compat:",
              "          supportsDeveloperRole: false",
              "          supportsReasoningEffort: true",
              "          thinkingFormat: openai",
              "        models:",
              `          - id: ${JSON.stringify(model.modelName)}`,
              "            reasoningEfforts:",
              "              off: null",
              "              low: low",
              "              medium: medium",
              "              high: high",
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
        sessionEffortOptions: new Map(),
        listeners: new Map(), // sessionId -> fn(msg)
        earlyCancelSessions: new Set(),
        stderrRing: [],
      };

      const sendRaw = (obj) => {
        if (!proc.stdin.writable) throw new Error("ACP stdin closed");
        proc.stdin.write(JSON.stringify(obj) + "\n");
      };

      const request = (method, params = {}, timeoutMs = 45_000) => {
        const id = state.nextId++;
        return new Promise((resolve, reject) => {
          // timeoutMs <= 0 disables the transport timer; callers that manage their own
          // progress-based deadline (session/prompt) must not also be killed by a fixed one.
          const timer =
            timeoutMs > 0
              ? setTimeout(() => {
                  state.pending.delete(id);
                  reject(new UpstreamProtocolError("deepseek-harness", state.agentVersion, method, `timeout ${timeoutMs}ms`));
                }, timeoutMs)
              : null;
          timer?.unref?.();
          state.pending.set(id, {
            method,
            resolve: (v) => {
              if (timer) clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              if (timer) clearTimeout(timer);
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
        // A dead child genuinely ends its turns: release only THIS client's session guards.
        for (const [sid, guard] of this.busySessions) {
          if (guard.state === state) this.#releaseSessionGuard(guard);
        }
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

  async runTurn({
    cwd,
    role,
    model,
    effort = "medium",
    sandbox,
    prompt,
    existingSessionId,
    requireResume = false,
    onActivity,
    onSessionReady,
    idleTimeoutMs,
    absoluteTimeoutMs,
    drainTimeoutMs,
  }) {
    const t0 = Date.now();
    const effectiveEffort = ["off", "low", "medium", "high"].includes(effort) ? effort : "medium";
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

    const reserve = (id) => {
      const { acquired, guard } = this.#acquireSessionGuard(id, state);
      if (!acquired) throw new AcpSessionBusyError(id, "another turn is still active for this session");
      return guard;
    };
    let guard = sessionId ? reserve(sessionId) : null;
    let appliedEffort = "";
    try {
      const recordEffortOpts = (sid, cfgOpts) => {
        const parsed = parseAcpEffortOptions(cfgOpts);
        if (parsed) {
          if (!state.sessionEffortOptions) state.sessionEffortOptions = new Map();
          state.sessionEffortOptions.set(sid, parsed);
        }
      };

      if (sessionId && state.loadedSessions.has(sessionId)) {
        reused = true;
      } else if (sessionId) {
        try {
          const resumed = await state.request("session/resume", { sessionId, cwd, mcpServers: [] });
          state.loadedSessions.add(sessionId);
          recordEffortOpts(sessionId, resumed?.configOptions);
          reused = true;
          resumedFromDisk = true;
        } catch (err) {
          if (isIndeterminateResumeFailure(err) || requireResume) {
            throw new AcpResumeIndeterminateError(sessionId, err);
          }
          this.#releaseSessionGuard(guard);
          guard = null;
          sessionId = "";
        }
      }

      if (!sessionId) {
        const created = await state.request("session/new", { cwd, mcpServers: [] });
        sessionId = created?.sessionId;
        if (!sessionId) {
          throw new UpstreamProtocolError("deepseek-harness", state.agentVersion, "session/new", "missing sessionId");
        }
        guard = reserve(sessionId);
        state.loadedSessions.add(sessionId);
        recordEffortOpts(sessionId, created?.configOptions);
        if (model?.source === "dsh" && model?.providerId && model?.modelName) {
          try {
            const setModelRes = await state.request("session/set_config_option", {
              sessionId,
              configId: "model",
              value: JSON.stringify([model.providerId, model.modelName]),
            });
            recordEffortOpts(sessionId, setModelRes?.configOptions);
          } catch {}
        }
      }
      // Dynamically map low/medium/high onto low/high/max when upstream omits medium.
      const advertisedEfforts = state.sessionEffortOptions?.get(sessionId) || null;
      const effortCandidates = resolveAcpEffortCandidates(effectiveEffort, advertisedEfforts);
      for (const candidate of effortCandidates) {
        try {
          await state.request("session/set_config_option", {
            sessionId,
            configId: "reasoning_effort",
            value: candidate,
          });
          appliedEffort = candidate;
          break;
        } catch {}
      }
      state.sessionRoles.set(sessionId, role);
      onSessionReady?.(sessionId);
    } catch (err) {
      if (guard) this.#releaseSessionGuard(guard);
      throw err;
    }

    const messages = new Map();
    const actions = [];
    let rawUsage = null;
    let anonymousMessage = 0;
    let currentMessageId = "";
    // Progress-based deadline: declared before the listener so real updates can renew it.
    let deadline = null;

    // X-ray state: streamed reasoning + per-tool-call lifecycle for the live timeline.
    // Every activity carries a stable `id` so the orchestrator can merge in place instead of
    // pushing 30 duplicate rows for one thought / tool call / streamed answer.
    const toolCalls = new Map(); // toolCallId -> { kind, title, meta, added, removed, summary, detail, startedAt }
    const thought = { open: false, id: "", full: "", startedAt: 0, emitAt: 0, emittedLen: 0, seq: 0 };
    // Anchor timestamp for measuring real thinking duration even when dsh flushes a thought block in one burst.
    let stepAnchorAt = t0;
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
      const now = Date.now();
      const durationSec = formatDuration(Math.max(100, now - thought.startedAt));
      const text = thought.full.slice(0, 4000);
      const id = thought.id;
      thought.open = false;
      thought.id = "";
      thought.full = "";
      stepAnchorAt = now;
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
      const now = Date.now();
      thought.seq += 1;
      thought.open = true;
      thought.id = `thought_${messageId || thought.seq}`;
      thought.full = "";
      // Anchor at the prior step completion (capped at 120s) so burst-flushed reasoning shows real wait time, not 0s.
      thought.startedAt = stepAnchorAt > 0 && now - stepAnchorAt <= 120_000 ? stepAnchorAt : now;
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
      // Only committed agent progress renews the idle window; config/topology updates and
      // transport keepalives do not.
      if (isPromptProgressUpdate(update)) deadline?.touch();
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
          const rawCaptured = tc?.output || cleanOutput;
          const sanitized = terminal
            ? sanitizeConstrainedLangOutput(rawCaptured, exitCode)
            : { output: rawCaptured, exitCode, falsePositiveCleared: false };
          const effectiveExitCode = sanitized.exitCode;
          const captured = sanitized.output;
          const failed = terminal && (
            (status === "failed" && !sanitized.falsePositiveCleared) ||
            (effectiveExitCode !== null && effectiveExitCode !== 0)
          );
          const durationSec = tc ? Number(((Date.now() - tc.startedAt) / 1000).toFixed(1)) : 0;
          const label = tc?.summary || "tool call";
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
            exitCode: effectiveExitCode,
            status: terminal ? (failed ? "error" : "done") : "running",
            summary: terminal
              ? `${failed ? "✗" : "✓"} ${label} (${Math.round(durationSec)}s)${excerpt ? ` → ${excerpt}` : ""}`
              : label,
            detail: [tc?.detail, captured].filter(Boolean).join("\n\n"),
          });
          if (terminal) {
            toolCalls.delete(update.toolCallId);
            stepAnchorAt = Date.now();
          }
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

    // Capture the projection watermarks BEFORE dispatch so a stale/reused record can never be
    // mistaken for this turn's sample.
    const projectionBaselineRecord = this.#readProjectionCacheRecord(state.dshHome, sessionId);
    const projectionBaseline = captureAcpProjectionBaseline(projectionBaselineRecord?.snapshot);

    let rpcSettled = true;
    let handedOff = false;
    let drainTimer = null;
    try {
      const prevTurnEnds = this.#countDshTurnEnds(state.dshHome, sessionId);
      const fullPrompt = reused ? prompt : `[Role Instructions]\n${spec.developerInstructions}\n\n[Task]\n${prompt}`;
      const drainMs = Math.max(100, Number(drainTimeoutMs) || DEFAULT_PROMPT_DRAIN_TIMEOUT_MS);
      let deadlineReason = "";
      const drainExpired = deferred();
      const clearDrain = () => {
        if (drainTimer) clearTimeout(drainTimer);
        drainTimer = null;
      };
      const armDrain = () => {
        if (guard.drainArmed) return;
        guard.drainArmed = true;
        // Not unref'd: this timer must deterministically settle the timeout path. It is cleared
        // as soon as the original RPC settles so it can never delay process exit.
        drainTimer = setTimeout(() => drainExpired.resolve({ kind: "drain-expired" }), drainMs);
      };
      deadline = new PromptDeadline({
        idleMs: Number(idleTimeoutMs) || DEFAULT_PROMPT_IDLE_TIMEOUT_MS,
        absoluteMs: Number(absoluteTimeoutMs) || DEFAULT_PROMPT_ABSOLUTE_TIMEOUT_MS,
        onExpire: (reason) => {
          deadlineReason = reason;
          guard.reason = `prompt-${reason}-timeout`;
          guard.timedOut = true;
          // Ask only this session to stop; the client (and any sibling sessions) stays alive.
          this.#sendCancel(state, sessionId, reason);
          armDrain();
        },
      }).start();
      // Manual cancellation from the orchestrator drains the same way a timeout does.
      guard.cancel = () => {
        guard.cancelRequested = true;
        this.#sendCancel(state, sessionId, "manual");
        armDrain();
      };
      const promptRpc = state.request(
        "session/prompt",
        {
          sessionId,
          prompt: [{ type: "text", text: fullPrompt }],
        },
        0
      );
      rpcSettled = false;
      const settle = () => {
        rpcSettled = true;
        if (handedOff) this.#releaseSessionGuard(guard);
      };
      promptRpc.then(settle, settle);
      if (guard.cancelRequested || state.earlyCancelSessions?.delete(sessionId)) guard.cancel();
      const outcome = await Promise.race([
        promptRpc.then((r) => ({ kind: "reply", result: r }), (e) => ({ kind: "error", error: e })),
        drainExpired.promise,
      ]);
      clearDrain();

      if (deadlineReason) {
        deadline.stop();
        const acknowledged = outcome.kind !== "drain-expired";
        const timeoutErr = new UpstreamProtocolError(
          "deepseek-harness",
          state.agentVersion,
          "session/prompt",
          `${deadlineReason} deadline exceeded (idle ${deadline.idleMs}ms / absolute ${deadline.absoluteMs}ms); ` +
            (acknowledged
              ? "session/cancel acknowledged by the agent, turn aborted"
              : `session/cancel not acknowledged within ${drainMs}ms; the per-session busy guard stays held until the original reply or client exit`)
        );
        timeoutErr.isPromptTimeout = true;
        timeoutErr.timeoutReason = deadlineReason;
        timeoutErr.cancelAcknowledged = acknowledged;
        timeoutErr.guardHeld = !acknowledged;
        timeoutErr.partialText = Array.from(messages.values()).at(-1)?.text || "";
        if (acknowledged && outcome.kind === "error") timeoutErr.cause = outcome.error;
        throw timeoutErr;
      }
      deadline.stop();
      if (guard.cancelRequested && outcome.kind === "drain-expired") {
        const cancelErr = new UpstreamProtocolError(
          "deepseek-harness",
          state.agentVersion,
          "session/prompt",
          `manual session/cancel was not acknowledged within ${drainMs}ms; the per-session busy guard stays held until the original reply or client exit`
        );
        cancelErr.isInterrupted = true;
        cancelErr.cancelAcknowledged = false;
        cancelErr.guardHeld = true;
        cancelErr.partialText = Array.from(messages.values()).at(-1)?.text || "";
        throw cancelErr;
      }
      if (outcome.kind === "error") throw outcome.error;
      const res = outcome.result;
      if (guard.cancelRequested) {
        // Manual cancel acknowledged: return the partial transcript as an interruption.
        finalizeThought();
        finishMessage();
        return {
          sessionId,
          turnId: "",
          reused,
          resumedFromDisk,
          resolvedModel: model?.modelName || "deepseek-harness",
          appliedEffort: appliedEffort || effectiveEffort,
          text: Array.from(messages.values()).at(-1)?.text.trim() || "(interrupted)",
          stopReason: String(res?.stopReason || "cancelled").toLowerCase(),
          truncated: false,
          interrupted: true,
          usage: normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", rawUsage),
          usageProvenance: { source: "none", scope: "interrupted", reason: "turn cancelled before telemetry settled" },
          actions,
          elapsedMs: Date.now() - t0,
        };
      }
      if (res?.usage || res?._meta?.usage) {
        rawUsage = { ...(rawUsage || {}), ...(res.usage || res._meta.usage) };
      }
      let diskSnap = null;
      const usageEngine = model?.providerId === "deepseek" ? "deepseek" : "openai";
      const hasRpcCache = normalizeUsage(usageEngine, rawUsage).cacheReported;
      if (!hasRpcCache || !res?.stopReason) {
        diskSnap = await this.#readDshSessionCacheUsage(state.dshHome, sessionId, prevTurnEnds);
        if (!hasRpcCache && diskSnap?.usage) {
          rawUsage = { ...(rawUsage || {}), ...diskSnap.usage };
        }
      }

      // Projection-cache sample: preferred when it is FRESH and strictly more informative than
      // the transcript/RPC sample. A stale/reused record never overrides a real provider sample.
      const projectionSample = await this.#readFreshProjectionSample(state.dshHome, sessionId, projectionBaseline, {
        transcriptLastStep: diskSnap?.lastStep || null,
        sessionId,
        cwd,
        startedAtMs: t0,
      });
      // Precedence (strongest first):
      //   1. RPC `result.usage`      - the provider's own per-turn report; never overridden.
      //   2. Fresh projection cache  - exact per-step buckets incl. explicit 0 cache reads.
      //   3. Session transcript      - last assistant/message usage (older samples, unchanged).
      //   4. Whatever `usage_update` notifications carried.
      const projectionEval = projectionSample?.evaluated || { ok: false, reason: "no-projection-record" };
      const transcriptHasCache = !hasRpcCache && diskSnap?.usage?.cachedInputTokens !== undefined;
      const useProjection = projectionEval.ok && !hasRpcCache;
      let usageProvenance;
      let usage;
      if (hasRpcCache) {
        usage = normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", rawUsage);
        usageProvenance = {
          source: "rpc",
          scope: "rpc-usage-field",
          ...(diskSnap?.lastStep ? { turn: diskSnap.lastStep.turn, step: diskSnap.lastStep.step } : {}),
          ...(projectionEval.ok ? { projectionSkipReason: "stronger rpc telemetry present" } : { projectionSkipReason: projectionEval.reason }),
        };
      } else if (useProjection) {
        usage = normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", projectionEval.usage);
        usageProvenance = projectionEval.provenance;
      } else if (transcriptHasCache) {
        usage = normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", rawUsage);
        usageProvenance = {
          source: "transcript",
          scope: "last-assistant-step",
          ...(diskSnap?.lastStep ? { turn: diskSnap.lastStep.turn, step: diskSnap.lastStep.step } : {}),
          projectionSkipReason: projectionEval.reason,
        };
      } else {
        usage = normalizeUsage(model?.providerId === "deepseek" ? "deepseek" : "openai", rawUsage);
        usageProvenance = { source: "none", scope: "unreported", projectionSkipReason: projectionEval.reason };
      }
      if (projectionEval.ok) {
        // Expose the projection detail (fields, whole-turn totals) regardless of which sample won.
        usageProvenance.projection = projectionEval.provenance;
        if (projectionEval.turnTotals) usageProvenance.turnTotals = projectionEval.turnTotals;
      }
      if (!usage?.cacheReported) {
        // Transparent unreported reason for `telemetry.jsonl`; never fabricate a cache sample.
        const skipReason = String(
          usageProvenance?.skipReason ||
            usageProvenance?.projectionSkipReason ||
            usageProvenance?.reason ||
            (hasRpcCache ? "cache-not-reported-by-upstream" : "projection-cache-unavailable")
        ).trim().slice(0, 200) || "cache-not-reported-by-upstream";
        usageProvenance = { ...usageProvenance, skipReason };
      }
      const stopReason = String(res?.stopReason || res?.stop_reason || diskSnap?.lastStopReason || "").toLowerCase();
      const truncatedByMaxTokens =
        stopReason === "max_tokens" || stopReason === "max-tokens" || stopReason === "length";
      finalizeThought();
      finishMessage();
      let finalText = Array.from(messages.values()).at(-1)?.text.trim() || "(no response text)";
      if (isLeakedToolCallsOutput(finalText)) {
        throw new Error(
          "[PROTOCOL_LEAK] Upstream model emitted raw tool_calls JSON as plain text instead of executing tools; retry or switch model."
        );
      }
      if (truncatedByMaxTokens) {
        const notice =
          `⚠️ [Output truncated: model hit its max_tokens output limit (${stopReason}). Resume with the same sessionId (e.g. "continue") to finish the remaining output.]`;
        finalText = `${finalText}\n\n${notice}`;
        onActivity?.({
          id: `trunc_${msgKey}`,
          type: "output",
          kind: "output",
          title: "⚠️ 输出已达模型上限 (max_tokens) 被截断",
          status: "error",
          detail: notice,
          summary: "⚠️ 输出已达模型上限 (max_tokens) 被截断",
        });
      }
      return {
        sessionId,
        turnId: "",
        reused,
        resumedFromDisk,
        resolvedModel: model?.modelName || "deepseek-harness",
        appliedEffort: appliedEffort || effectiveEffort,
        text: finalText,
        stopReason: stopReason || undefined,
        truncated: truncatedByMaxTokens,
        usage,
        usageProvenance,
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
      deadline?.stop();
      if (drainTimer) clearTimeout(drainTimer);
      state.listeners.delete(sessionId);
      finishMessage();
      // Close the trailing reasoning block with its exact duration (also on interrupt/error).
      finalizeThought();
      if (rpcSettled) this.#releaseSessionGuard(guard);
      else handedOff = true;
    }
  }
  async interruptTurn(sessionId, model) {
    if (!sessionId) return;
    const matchingProfile = this.clients.get(this.#profileKey(model));
    const state = matchingProfile?.listeners.has(sessionId)
      ? matchingProfile
      : [...this.clients.values()].find((client) => client.listeners.has(sessionId)) || matchingProfile;
    // Manual cancel goes through the same drain path as a timeout so the busy guard is kept
    // until the original session/prompt reply lands.
    const guard = this.busySessions.get(sessionId);
    if (guard) {
      if (typeof guard.cancel === "function") guard.cancel();
      else guard.cancelRequested = true;
      return;
    }
    if (!state) return;
    // No turn is registered yet (session-ready race): remember the cancel for the dispatch path.
    if (!state.earlyCancelSessions) state.earlyCancelSessions = new Set();
    state.earlyCancelSessions.add(sessionId);
    this.#sendCancel(state, sessionId, "manual");
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
    // Clients are being killed: every guard for them is genuinely dead, release it.
    for (const guard of Array.from(this.busySessions.values())) this.#releaseSessionGuard(guard);
    await Promise.allSettled(list.map((st) => safeKill(st.proc)));
  }
}
