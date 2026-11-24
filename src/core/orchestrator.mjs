import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PROVIDERS, CLI_DEFAULT_MODELS_MAP } from "./constants.mjs";
import { detectEngines, normalizeWorkspaceKey, readDshConfigModels } from "./paths.mjs";
import { assertCanReuseApiKey, maskSecret } from "./store.mjs";
import { AcpEngine } from "../engines/acp.mjs";
import { AntigravityCliEngine } from "../engines/antigravity.mjs";
import { ClaudeCodeEngine } from "../engines/claude-code.mjs";
import { CodexEngine } from "../engines/codex.mjs";

const MAX_INLINE_TEXT = 24_000;
const MAX_BLOCKING_WAIT_MS = 120_000;
const INSPECTOR_TIMEOUT_MS = 15_000;
const STATUS_WRITE_THROTTLE_MS = 2_500;
const CRASH_RECOVERY_ERROR = "Host/MCP exited while job was running";

const __orchestratorDir = path.dirname(fileURLToPath(import.meta.url));

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

export class RelayOrchestrator {
  constructor(store, telemetry) {
    this.store = store;
    this.telemetry = telemetry;
    this.engines = {
      codex: new CodexEngine(() => this.store.settings.codexKeepOfficePlugins),
      "deepseek-harness": new AcpEngine(store.dataDir),
      "claude-code": new ClaudeCodeEngine(),
      antigravity: new AntigravityCliEngine(),
    };
    this.jobs = new Map(); // jobId -> job state
    this.activeWriters = new Map(); // workspaceKey -> jobId
    this.#recoverOrphanedJobs();
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
    return {
      jobId: job.jobId,
      role: job.role,
      slot: job.slot,
      title: job.title || "",
      cwd: job.cwd || "",
      sessionId: job.sessionId || "",
      engine: job.engine,
      modelDisplayName: job.modelDisplayName || job.engine,
      status,
      pid: process.pid,
      startedAt: job.startedAt,
      updatedAt: Date.now(),
      lastActivityAt: job.lastActivityAt || job.startedAt,
      hitRate: job.hitRate ?? null,
      contextPct: job.contextPct ?? null,
      lastSummary: String(job.lastSummary || lastActivity?.summary || "").slice(0, 240),
      finishedAt: terminal ? endTs : null,
      elapsedSec: Number(((endTs - job.startedAt) / 1000).toFixed(1)),
      error: job.error || null,
      stallAlert: job.stallAlert || null,
      logPath: job.logPath || "",
      outputPath: this.#outputPath(job.jobId),
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
    job.error = error || null;
    job.finishedAt = Date.now();
    for (const activity of job.activities || []) {
      if (activity.status === "running") activity.status = "interrupted";
    }
    this.#saveJobOutput(job);
    this.#saveJobEvents(job);
    this.#writeStatusSnapshot(job, { force: true, status });
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
      if (snap.status !== "running" || snap.pid === process.pid) continue;
      if (this.jobs.has(snap.jobId)) continue;

      const finishedAt = Number(snap.updatedAt) || Date.now();
      const recovered = {
        ...snap,
        status: "interrupted",
        finishedAt,
        updatedAt: Date.now(),
        error: CRASH_RECOVERY_ERROR,
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
        modelId: "",
        modelDisplayName: recovered.modelDisplayName || recovered.engine || "",
        sessionId: recovered.sessionId || "",
        status: "interrupted",
        startedAt: Number(recovered.startedAt) || finishedAt,
        lastActivityAt: Number(recovered.lastActivityAt) || finishedAt,
        lastCheckinAt: finishedAt,
        lastSummary: recovered.lastSummary || "",
        logPath: recovered.logPath || "",
        outputPath: recovered.outputPath || this.#outputPath(recovered.jobId),
        promptPreview: diskTimeline?.prompt || "",
        activities: diskTimeline?.activities || this.#readLegacyLog(recovered.jobId)?.activities || [],
        result: null,
        error: CRASH_RECOVERY_ERROR,
        finishedAt,
        recovered: true,
        dismissed: false,
        waiters: [],
      };
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
        sessionId: j.sessionId || "",
        cwd: j.cwd || "",
        error: j.error || CRASH_RECOVERY_ERROR,
        lastSummary: j.lastSummary || "",
        outputPath: j.outputPath || this.#outputPath(j.jobId),
      }));
  }

  #checkEnabled() {
    if (!this.store.settings.enabled) {
      return {
        blocked: true,
        message:
          "Agent Relay master switch is OFF. External subagents are disabled — handle this task directly or wait for the user to enable Agent Relay in the side panel.",
      };
    }
    return { blocked: false };
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
    job.lastActivityAt = Date.now();
    this.#appendJobLog(job, ev);
    this.#writeStatusSnapshot(job);
  }

  #onSessionReady(job, sid) {
    if (job.status !== "running") return;
    job.sessionId = sid || "";
    this.#writeStatusSnapshot(job, { force: true });
    if (sid && job.interruptRequested) {
      const model = this.store.getModelById(job.modelId);
      void this.engines[job.engine]?.interruptTurn?.(sid, model)?.catch(() => {});
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
      modelDisplayName: j.modelDisplayName || j.engine,
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
      logPath: j.logPath,
      outputPath: j.outputPath || (running ? "" : this.#outputPath(j.jobId)),
      error: j.error || "",
    };
  }

  // Newest-first jobs covering running, completed and failed states.
  #recentJobs(limit) {
    const now = Date.now();
    return Array.from(this.jobs.values())
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, limit)
      .map((j) => this.#summarizeJob(j, now));
  }

  formatTelemetryFooter(meta) {
    const u = meta.usage;
    const hitStr = u?.cacheReported
      ? `${u.hitRate}% (${u.cachedInputTokens.toLocaleString()} / ${u.totalInputTokens.toLocaleString()})`
      : "N/A (unreported)";
    const ctxStr = u?.contextPct != null ? ` | ctx ${u.contextPct}%` : "";
    const modeStr = meta.resumedFromDisk ? "resumed" : meta.reused ? "warm" : "new";
    const fbStr = meta.fallbackNote ? ` · ${meta.fallbackNote}` : "";
    const sidStr = meta.sessionId ? ` · sessionId=${meta.sessionId}` : "";
    return `[Agent Relay · ${meta.role}${meta.slot && meta.slot !== "default" ? `:${meta.slot}` : ""} · ${meta.resolvedModel} (${meta.engine}) · ${modeStr}${fbStr}${sidStr} · cache ${hitStr}${ctxStr} · ${(meta.elapsedMs / 1000).toFixed(1)}s]`;
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

  async #buildCheckinReport(job, reason, detail = "summary", allowInspector = true) {
    const elapsedSec = ((Date.now() - job.startedAt) / 1000).toFixed(1);
    const silentSec = ((Date.now() - job.lastActivityAt) / 1000).toFixed(1);

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
        jobId: job.jobId,
        sessionId: job.sessionId || "",
        elapsedSec: Number(elapsedSec),
        silentSec: Number(silentSec),
        logPath: job.logPath,
        text: [
          `[Non-Interrupting Inspection · ${reason}] Job ${job.jobId} (${job.role} · ${job.engine}) is STILL RUNNING (untouched).`,
          `Elapsed: ${elapsedSec}s | Silent for: ${silentSec}s | Full log: ${job.logPath}`,
          `--- Full Recent Activity ---`,
          tail,
          `--- Lead Agent Decision Options ---`,
          `1) Continue waiting: agent_relay_poll(jobId="${job.jobId}")`,
          `2) Steer direction (Codex): agent_relay_session(action="steer", sessionId="${job.sessionId || ""}", message="...")`,
          `3) Stop subagent: agent_relay_session(action="interrupt", jobId="${job.jobId}")`,
        ].join("\n"),
      };
    }

    // Error-prioritized structured extraction (always computed for gating & fallback)
    const errors = job.activities
      .filter((a) => a.type === "error" || /exit=[1-9]\b/.test(a.summary))
      .slice(-6);
    const recent = job.activities.slice(-12);
    const structuredBlock = [
      errors.length > 0 ? `Errors detected:\n${errors.map((e) => `  ! ${e.summary}`).join("\n")}` : null,
      recent.length > 0
        ? `Recent activity (${recent.length} items):\n${recent.map((a) => `  - [${a.ts.slice(11, 19)}] ${a.summary}`).join("\n")}`
        : `Recent activity: (no commands or text streamed yet)`,
    ]
      .filter(Boolean)
      .join("\n");

    // Optional Inspector Summarizer AI (opt-in, default OFF): only on silent/stuck, long-running, or errors
    let aiSummary = "";
    const inspectorId = this.store.settings.inspectorModelId;
    const shouldInvokeInspector =
      allowInspector &&
      this.store.settings.inspectorEnabled === true &&
      Boolean(inspectorId) &&
      fullLog.trim().length > 0 &&
      (reason === "silent_checkin" || reason === "long_run_checkin" || errors.length > 0);
    if (shouldInvokeInspector) {
      const inspModel = this.store.getModelById(inspectorId);
      if (inspModel?.mode === "api" && inspModel.apiKey && inspModel.baseUrl && inspModel.modelName) {
        aiSummary = await this.#summarizeWithInspectorAi(
          inspModel,
          job,
          reason,
          elapsedSec,
          silentSec,
          fullLog,
          errors
        );
      }
    }

    return {
      status: reason,
      jobId: job.jobId,
      sessionId: job.sessionId || "",
      elapsedSec: Number(elapsedSec),
      silentSec: Number(silentSec),
      logPath: job.logPath,
      text: [
        `[Non-Interrupting Check-in · ${reason}] Job ${job.jobId} (${job.role} · ${job.engine}) is STILL RUNNING (not interrupted).`,
        `Elapsed: ${elapsedSec}s | Silent for: ${silentSec}s | Full raw log: ${job.logPath}`,
        aiSummary
          ? `--- Inspector AI Summary ---\n${aiSummary}${errors.length > 0 ? `\n\nRecent Errors:\n${errors.slice(-3).map((e) => `  ! ${e.summary}`).join("\n")}` : ""}`
          : structuredBlock,
        `--- Lead Agent Decision Options ---`,
        `• Inspect full log without interrupting: agent_relay_poll(jobId="${job.jobId}", waitSec=0, detail="full") or read ${job.logPath}`,
        `• Continue waiting: agent_relay_poll(jobId="${job.jobId}")`,
        `• Steer (Codex): agent_relay_session(action="steer", sessionId="${job.sessionId || ""}", message="...")`,
        `• Stop: agent_relay_session(action="interrupt", jobId="${job.jobId}")`,
      ].join("\n"),
    };
  }

  async #triageStallWithGatekeeper(model, job, elapsedSec, silentSec) {
    try {
      const cleanBase = model.baseUrl.replace(/\/+$/, "");
      const recentLines = (job.activities || [])
        .slice(-30)
        .map((a) => `[${a.ts.slice(11, 19)}] [${a.type}] ${a.summary}`)
        .join("\n");
      const taskGoal = String(job.taskSummary || job.title || "(unspecified)").slice(0, 1200);
      const res = await fetch(`${cleanBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.modelName,
          temperature: 0.1,
          max_tokens: 180,
          messages: [
            {
              role: "system",
              content:
                "You are a strict 2-choice Stall Gatekeeper watching a background coding subagent. You NEVER steer or edit code. Read ONLY the Task Goal and the last 30 X-ray activity lines, then output EXACTLY two lines:\nVERDICT: CONTINUE   (normal slow progress such as compiling, running tests, downloading, or long reasoning — do NOT wake the Lead Agent)\nOR\nVERDICT: ALERT      (deadlocked test, hung interactive prompt, repeated error loop, or genuinely stuck — wake the Lead Agent)\nREASON: <one concise sentence explaining why>",
            },
            {
              role: "user",
              content: `Role: ${job.role} | Engine: ${job.engine} | Elapsed: ${elapsedSec}s | Silent: ${silentSec}s\n\nTask Goal:\n${taskGoal}\n\nRecent X-Ray Activity (last 30 items):\n${recentLines || "(no activity yet)"}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(INSPECTOR_TIMEOUT_MS),
      });
      if (!res.ok) return { verdict: "ALERT", reason: `Gatekeeper HTTP ${res.status}`, raw: "" };
      const json = await res.json();
      const raw = json?.choices?.[0]?.message?.content?.trim() || "";
      const verdictMatch = raw.match(/VERDICT\s*:\s*(CONTINUE|ALERT)/i);
      const reasonMatch = raw.match(/REASON\s*:\s*(.+)/i);
      const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : "ALERT";
      const reason = (reasonMatch ? reasonMatch[1] : raw.split(/\r?\n/).pop() || "Stall check triggered").trim().slice(0, 180);
      return { verdict, reason, raw };
    } catch (err) {
      return { verdict: "ALERT", reason: `Gatekeeper check failed (${err?.message || "timeout"})`, raw: "" };
    }
  }

  async #summarizeWithInspectorAi(model, job, _reason, elapsedSec, silentSec) {
    const t = await this.#triageStallWithGatekeeper(model, job, elapsedSec, silentSec);
    return t.raw || `VERDICT: ${t.verdict}\nREASON: ${t.reason}`;
  }

  #startStallGatekeeper(job) {
    const silentMin = Math.max(1, Number(this.store.settings.silentCheckinMin) || 3);
    const triggerMs = Math.max(20_000, silentMin * 60_000 - 15_000);
    let inFlight = false;
    let consecutiveContinue = 0;
    const timer = setInterval(async () => {
      if (job.status !== "running" || inFlight || job.stallAlert) return;
      if (this.store.settings.inspectorEnabled !== true || !this.store.settings.inspectorModelId) return;
      const now = Date.now();
      const silentMs = now - (job.lastActivityAt || job.startedAt);
      if (silentMs < triggerMs) return;
      const inspModel = this.store.getModelById(this.store.settings.inspectorModelId);
      if (!(inspModel?.mode === "api" && inspModel.apiKey && inspModel.baseUrl && inspModel.modelName)) return;

      inFlight = true;
      try {
        const elapsedSec = ((now - job.startedAt) / 1000).toFixed(1);
        const silentSec = (silentMs / 1000).toFixed(1);
        const res = await this.#triageStallWithGatekeeper(inspModel, job, elapsedSec, silentSec);
        if (job.status !== "running") return;
        if (res.verdict === "CONTINUE" && consecutiveContinue < 3) {
          consecutiveContinue++;
          job.lastActivityAt = Date.now();
          this.#appendJobLog(job, { type: "triage", summary: `守门员判定继续等 (${consecutiveContinue}/3): ${res.reason}` });
          job.lastSummary = `守门员判定继续等: ${res.reason}`;
          this.#writeStatusSnapshot(job, { force: true });
        } else {
          const reason =
            res.verdict === "CONTINUE"
              ? `连续延长 3 次仍无新活动，转交主 Agent (${res.reason})`
              : res.reason;
          job.stallAlert = { at: Date.now(), reason };
          this.#appendJobLog(job, { type: "triage_alert", summary: `守门员拉响警报: ${reason}` });
          job.lastSummary = `守门员拉响警报: ${reason}`;
          this.#writeStatusSnapshot(job, { force: true });
        }
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
    return `node "${resolveWaitJobScript()}" --data-dir "${this.store.dataDir}" --stall-sec ${stallSec} ${jobId}`;
  }

  #asyncLaunchText(headline, job) {
    return `${headline} Use agent_relay_poll(jobIds=["${job.jobId}", ...]) to collect results.
Doorbell (zero-token background wakeup): ${this.#doorbellCommand(job.jobId)}`;
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
    forceNew = false,
    onHeartbeat,
  }) {
    const waitSec = this.#effectiveWaitSec(requestedWaitSec);
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const gate = this.#checkEnabled();
    if (gate.blocked) return { blocked: true, text: gate.message };
    this.#pruneFinishedJobs();

    const effectiveSandbox =
      role === "oracle"
        ? "read-only"
        : sandbox === "danger-full-access" && this.store.settings.allowHephaestusFullAccess
        ? "danger-full-access"
        : "workspace-write";

    const workDir = path.resolve(cwd || process.cwd());
    const wsKey = normalizeWorkspaceKey(workDir);
    const cleanSlot = role === "hephaestus" ? "default" : (slot || "default").trim() || "default";
    const cleanRequestedSid =
      !forceNew && typeof requestedSessionId === "string" ? requestedSessionId.trim() : "";
    const explicitTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const sessionTitle = deriveSessionTitle(title, prompt);
    const requestedExisting = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) : null;

    // Global concurrency guard
    const running = this.#runningJobs();
    if (running.length >= this.store.settings.maxConcurrency) {
      return {
        blocked: true,
        status: "concurrency_limit",
        text: `Concurrency cap reached (${running.length}/${this.store.settings.maxConcurrency} running: ${running.map((j) => `${j.jobId}:${j.role}`).join(", ")}). Poll or finish an existing job, or raise maxConcurrency in Agent Relay settings.`,
      };
    }

    // Per-workspace write mutex for hephaestus
    if (role === "hephaestus" && this.activeWriters.has(wsKey)) {
      const busyJob = this.activeWriters.get(wsKey);
      return {
        blocked: true,
        text: `Hephaestus is already writing in ${workDir} (job ${busyJob}). Poll/wait for that job first to avoid concurrent write conflicts.`,
      };
    }

    const roleCfg = this.store.getRoleConfig(role);
    const queue = roleCfg.queue || [];
    if (queue.length === 0) {
      return { blocked: true, text: `No AI models configured for role=${role}.` };
    }

    await this.#syncCodexQuotaAndCooldowns(queue);

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
      return {
        status: "all_exhausted",
        blocked: true,
        text: [
          `[ALL_ENGINES_EXHAUSTED] All configured AI models in the ${role} priority queue are currently rate-limited or depleted:`,
          details,
          ``,
          `ACTION REQUIRED (PAUSE external delegation and ask the user):`,
          `1) Turn OFF the Agent Relay switch to let the lead agent continue solo;`,
          `2) Top up / switch API key or account in the Agent Relay side panel;`,
          `3) Wait until the earliest quota reset window above.`,
        ].join("\n"),
      };
    }

    // If primary is cooling down and autoFallbackOnLimit is OFF, pause and ask user before switching
    if (skippedCooldowns.length > 0 && !this.store.settings.autoFallbackOnLimit) {
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

    const now = Date.now();
    const job = {
      jobId,
      role,
      slot: cleanSlot,
      title: requestedExisting?.title || sessionTitle,
      promptPreview: String(prompt || "").trim().slice(0, 4000),
      taskSummary: String(prompt || "").replace(/\s+/g, " ").trim().slice(0, 1200),
      cwd: workDir,
      engine: available[0].engine,
      modelId: available[0].id,
      modelDisplayName: available[0].name,
      sessionId: "",
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      lastCheckinAt: now,
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
    if (role === "hephaestus") this.activeWriters.set(wsKey, jobId);

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
          const engine = this.engines[engineId];
          if (!engine) continue;

          job.engine = engineId;
          job.modelId = model.id;
          job.modelDisplayName = model.name;

          const existing = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) : null;
          const canReuse = Boolean(
            cleanRequestedSid &&
              (!existing || (existing.engine === engineId && existing.modelId === model.id))
          );
          const existingSessionId = canReuse ? cleanRequestedSid : null;
          job.sessionId = existingSessionId || "";

          try {
            const turnPrompt =
              idx > 0 && !canReuse
                ? `[Fallback Handoff: primary model hit quota limit; take over cleanly]\n${prompt}`
                : prompt;

            const res = await engine.runTurn({
              cwd: workDir,
              role,
              model,
              effort: effort || roleCfg.effort || "medium",
              sandbox: effectiveSandbox,
              prompt: turnPrompt,
              existingSessionId,
              onSessionReady: (sid) => this.#onSessionReady(job, sid),
              onActivity: attachTurnSigToJob(job, (ev) => this.#recordActivity(job, ev)),
            });

            if (job.status !== "running") return;
            if (job.interruptRequested || res.interrupted) {
              this.#markJobTerminal(job, "interrupted");
              return;
            }
            const prevTurns = canReuse ? existing?.turns || 0 : 0;
            if (res.sessionId) {
              this.store.setSessionById(res.sessionId, {
                cwd: workDir,
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
              cwd: workDir,
              role,
              slot: cleanSlot,
              engine: engineId,
              modelId: model.id,
              modelName: res.resolvedModel,
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: res.resumedFromDisk,
              elapsedMs: res.elapsedMs,
              cacheReported: res.usage.cacheReported,
              totalInputTokens: res.usage.totalInputTokens,
              cachedInputTokens: res.usage.cachedInputTokens,
              cacheWriteTokens: res.usage.cacheWriteTokens,
              outputTokens: res.usage.outputTokens,
              hitRate: res.usage.hitRate,
              contextPct: res.usage.contextPct,
            });

            const safeText = this.#trimOutputIfHuge(res.text, jobId);
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
              elapsedMs: res.elapsedMs,
            });
            const compactHint =
              res.usage?.contextPct != null && res.usage.contextPct >= 70
                ? `\n\n[Notice: context window at ${res.usage.contextPct}%. Consider agent_relay_session(action="compact") soon.]`
                : "";

            job.hitRate = res.usage?.cacheReported ? res.usage.hitRate : null;
            job.contextPct = res.usage?.contextPct ?? null;
            job.finalText = res.text === safeText ? "" : `${res.text}\n\n${footer}`;
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
            if (err?.isRateLimit || err?.isQuotaDepleted) {
              const untilMs = err.isQuotaDepleted
                ? null
                : err.resetsAtMs || Date.now() + 5 * 60 * 60 * 1000;
              this.store.setCooldown(model.id, {
                untilMs,
                reason: err.isQuotaDepleted ? "balance_depleted" : "rate_limit_reached",
                manualOnly: Boolean(err.isQuotaDepleted),
              });
              if (!this.store.settings.autoFallbackOnLimit || idx === available.length - 1) {
                break;
              }
              fallbackPrefixNote = `fallback from ${model.name} (resets ${formatResetTime(untilMs)})`;
              this.#recordActivity(job, {
                type: "fallback",
                summary: `${model.name} hit limit; switching to ${available[idx + 1].name}`,
              });
              this.#writeStatusSnapshot(job, { force: true });
              continue;
            }
            // Non-rate-limit error: fail immediately without burning fallback models
            break;
          }
        }

        const allCooled = queue.every((m) => Boolean(this.store.getActiveCooldown(m.id)));
        this.#markJobTerminal(
          job,
          "failed",
          allCooled
            ? `[ALL_ENGINES_EXHAUSTED] Every AI in the ${role} priority queue hit its quota/balance limit. Pause external delegation and ask the user to disable Agent Relay, top up, or wait for quota reset. Last error: ${lastErr?.message || ""}`
            : lastErr?.message || "Unknown subagent execution error"
        );
      } finally {
        stopGatekeeper();
        job.finishedAt = job.finishedAt || Date.now();
        this.#writeStatusSnapshot(job, { force: true });
        if (this.activeWriters.get(wsKey) === jobId) {
          this.activeWriters.delete(wsKey);
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
        logPath,
        outputPath: job.outputPath,
        sessionId: job.sessionId || "",
        text: this.#asyncLaunchText(`[Started · async] Job ${jobId} (${role}:${cleanSlot} · ${job.engine}) launched in background.`, job),
      };
    }

    return this.#waitWithCheckins(job, runPromise, { explicitWaitSec: waitSec, deadline, onHeartbeat });
  }

  async poll(jobId, { waitSec, detail = "summary", onHeartbeat } = {}) {
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const job = this.jobs.get(jobId);
    if (!job) {
      return { status: "not_found", text: `Job ${jobId} not found.` };
    }
    if (job.status === "completed") return job.result;
    if (job.status === "failed") {
      return { status: "failed", jobId, text: `Job ${jobId} failed: ${job.error}` };
    }
    if (job.status === "interrupted") {
      const sid = job.sessionId ? ` · sessionId=${job.sessionId}` : "";
      return {
        status: "interrupted",
        jobId,
        sessionId: job.sessionId || "",
        text: `[INTERRUPTED] Job ${jobId} (${job.role}:${job.slot}${sid}) — ${job.error || CRASH_RECOVERY_ERROR}. Last step: ${job.lastSummary || "(none)"}. To resume, re-send the task with sessionId="${job.sessionId || ""}" and note it should check the current workspace diff first.`,
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
    const silentMs = this.store.settings.silentCheckinMin * 60_000;
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
          job.lastCheckinAt = Date.now();
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
          if (active.some((j) => now - j.lastActivityAt >= silentMs && now - j.lastCheckinAt >= silentMs)) {
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
        sections.push(`=== Job ${id} (not_found) ===\nJob ${id} not found.`);
        continue;
      }
      if (job.status === "completed") {
        allFailed = false;
        sections.push(`=== Job ${id} (${job.role}:${job.slot} · completed) ===\n${job.result?.text || ""}`);
      } else if (job.status === "failed") {
        sections.push(`=== Job ${id} (${job.role}:${job.slot} · failed) ===\nJob ${id} failed: ${job.error}`);
      } else if (job.status === "interrupted") {
        sections.push(
          `=== Job ${id} (${job.role}:${job.slot} · interrupted) ===\nJob ${id} was interrupted: ${job.error || "Host/MCP exited while running"}${job.sessionId ? ` (sessionId=${job.sessionId})` : ""}`
        );
      } else {
        anyRunning = true;
        allFailed = false;
        const report = await this.#buildCheckinReport(job, waitSec === 0 ? "manual_inspect" : "running_checkin", detail);
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
    const longRunMs =
      this.store.settings.longRunCheckinMin > 0
        ? this.store.settings.longRunCheckinMin * 60_000
        : Number.POSITIVE_INFINITY;
    const remainingMs = Math.max(0, deadline - Date.now());
    const explicitMs = explicitWaitSec ? Math.max(1, explicitWaitSec) * 1000 : Infinity;
    const inspectorActive =
      this.store.settings.inspectorEnabled === true && Boolean(this.store.settings.inspectorModelId);
    const inspectorBudget = detail !== "full" && inspectorActive ? INSPECTOR_TIMEOUT_MS : 0;
    const checkinMs = Math.min(explicitMs, Math.max(0, remainingMs - inspectorBudget));
    let heartbeatTick = 0;

    return new Promise((resolve) => {
      let settled = false;
      let reporting = false;
      let checkinTimer;
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
        finish(await this.#buildCheckinReport(job, reason, detail));
      };
      const deadlineTimer = setTimeout(async () => {
        job.lastCheckinAt = Date.now();
        finish(await this.#buildCheckinReport(job, "running_checkin", detail, false));
      }, remainingMs);
      if (checkinMs < remainingMs) {
        checkinTimer = setTimeout(() => checkIn("running_checkin"), checkinMs);
      }

      donePromise.then(() => {
        if (job.status === "completed") finish(job.result);
        else if (job.status === "failed") {
          finish({ status: "failed", jobId: job.jobId, text: `Job ${job.jobId} failed: ${job.error}` });
        }
      });

      const interval = setInterval(() => {
        if (settled) return;
        const now = Date.now();

        // Zero-token MCP protocol progress heartbeat every ~15s (does NOT reset lastActivityAt)
        heartbeatTick++;
        if (heartbeatTick % 5 === 0 && onHeartbeat) {
          try {
            onHeartbeat(heartbeatTick, `running ${Math.round((now - job.startedAt) / 1000)}s`);
          } catch {}
        }

        const silentFor = now - job.lastActivityAt;
        const sinceLastCheckin = now - job.lastCheckinAt;

        if (silentFor >= silentMs && sinceLastCheckin >= silentMs) {
          void checkIn("silent_checkin");
        } else if (sinceLastCheckin >= longRunMs) {
          void checkIn("long_run_checkin");
        }
      }, 3000);
    });
  }

  async stopJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") {
      return { ok: false, text: `Job ${jobId} is not running.` };
    }
    const engine = this.engines[job.engine];
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
    onHeartbeat,
  }) {
    const waitSec = this.#effectiveWaitSec(requestedWaitSec);
    const deadline = Date.now() + MAX_BLOCKING_WAIT_MS;
    const gate = this.#checkEnabled();
    if (gate.blocked) return { blocked: true, text: gate.message };
    this.#pruneFinishedJobs();

    const workDir = path.resolve(cwd || process.cwd());
    const cleanRequestedSid = typeof requestedSessionId === "string" ? requestedSessionId.trim() : "";
    const explicitTitle = String(title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const sessionTitle = deriveSessionTitle(title, instructions || `Review (${targetType})`);
    const requestedExisting = cleanRequestedSid ? this.store.getSessionById(cleanRequestedSid) : null;
    const running = this.#runningJobs();
    if (running.length >= this.store.settings.maxConcurrency) {
      return {
        blocked: true,
        status: "concurrency_limit",
        text: `Concurrency cap reached (${running.length}/${this.store.settings.maxConcurrency} running: ${running.map((j) => `${j.jobId}:${j.role}`).join(", ")}). Poll or finish an existing job, or raise maxConcurrency in Agent Relay settings.`,
      };
    }

    const roleCfg = this.store.getRoleConfig("oracle");
    const queue = roleCfg.queue || [];
    if (queue.length === 0) {
      return { blocked: true, text: "No AI models configured for role=oracle." };
    }

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
      engine: available[0].engine,
      modelId: available[0].id,
      modelDisplayName: available[0].name,
      sessionId: "",
      status: "running",
      startedAt: now,
      lastActivityAt: now,
      lastCheckinAt: now,
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
          const engine = this.engines[engineId];
          if (!engine) continue;

          job.engine = engineId;
          job.modelId = model.id;
          job.modelDisplayName = model.name;

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
            const res =
              engineId === "codex"
                ? await this.engines.codex.runReview({
                    cwd: workDir,
                    model,
                    existingSessionId,
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
                    prompt: reviewPrompt,
                    existingSessionId,
                    onSessionReady,
                    onActivity,
                  });

            if (job.status !== "running") return;
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
              sessionId: res.sessionId,
              reused: res.reused,
              resumedFromDisk: Boolean(res.resumedFromDisk),
              elapsedMs: res.elapsedMs,
              cacheReported: res.usage.cacheReported,
              totalInputTokens: res.usage.totalInputTokens,
              cachedInputTokens: res.usage.cachedInputTokens,
              cacheWriteTokens: res.usage.cacheWriteTokens,
              outputTokens: res.usage.outputTokens,
              hitRate: res.usage.hitRate,
              contextPct: res.usage.contextPct,
            });

            const safeText = this.#trimOutputIfHuge(res.text, jobId);
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
            job.finalText = res.text === safeText ? "" : `${res.text}\n\n${footer}`;
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
            if (err?.isRateLimit || err?.isQuotaDepleted) {
              const untilMs = err.isQuotaDepleted ? null : err.resetsAtMs || Date.now() + 5 * 60 * 60 * 1000;
              this.store.setCooldown(model.id, {
                untilMs,
                reason: err.isQuotaDepleted ? "balance_depleted" : "rate_limit_reached",
                manualOnly: Boolean(err.isQuotaDepleted),
              });
              if (!this.store.settings.autoFallbackOnLimit || idx === available.length - 1) break;
              fallbackPrefixNote = `fallback from ${model.name} (resets ${formatResetTime(untilMs)})`;
              continue;
            }
            break;
          }
        }

        const allCooled = queue.every((m) => Boolean(this.store.getActiveCooldown(m.id)));
        this.#markJobTerminal(
          job,
          "failed",
          allCooled
            ? `[ALL_ENGINES_EXHAUSTED] Every AI in the oracle priority queue hit its quota/balance limit. Last error: ${lastErr?.message || ""}`
            : lastErr?.message || "Unknown review error"
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
        logPath,
        outputPath: job.outputPath,
        sessionId: job.sessionId || "",
        text: this.#asyncLaunchText(
          `[Started · async] Review job ${jobId} (oracle:default · ${job.engine}) launched in background.`,
          job
        ),
      };
    }

    return this.#waitWithCheckins(job, runPromise, { explicitWaitSec: waitSec, deadline, onHeartbeat });
  }

  async sessionAction({ action, cwd, role = "oracle", slot = "default", sessionId, jobId, message }) {
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
          asyncBackgroundMode: this.store.settings.asyncBackgroundMode === true,
          inspectorEnabled: this.store.settings.inspectorEnabled === true,
          inspectorModelId: this.store.settings.inspectorModelId || null,
          waitJobScript: resolveWaitJobScript(),
        },
        interruptedJobs: this.#interruptedJobs(),
        roles: {
          oracle: {
            effort: this.store.settings.roles.oracle.effort,
            queue: this.store.getRoleConfig("oracle").queue.map((m) => ({
              id: m.id,
              name: m.name,
              engine: m.engine,
              cooldown: this.store.getActiveCooldown(m.id),
            })),
          },
          hephaestus: {
            effort: this.store.settings.roles.hephaestus.effort,
            queue: this.store.getRoleConfig("hephaestus").queue.map((m) => ({
              id: m.id,
              name: m.name,
              engine: m.engine,
              cooldown: this.store.getActiveCooldown(m.id),
            })),
          },
        },
        codexRateLimits,
        activeJobs: this.#runningJobs().map((j) => ({
          jobId: j.jobId,
          role: j.role,
          slot: j.slot,
          title: j.title || "",
          sessionId: j.sessionId || "",
          engine: j.engine,
          elapsedSec: Number(((Date.now() - j.startedAt) / 1000).toFixed(1)),
          silentSec: Number(((Date.now() - j.lastActivityAt) / 1000).toFixed(1)),
          logPath: j.logPath,
        })),
        sessions: this.store.listSessions(),
        telemetry: this.telemetry.getSummary(10),
      };
    }

    if (action === "interrupt" && jobId) {
      return this.stopJob(jobId);
    }

    // For steer / interrupt, check live running jobs first so Turn 1 sessions can be steered before persisting
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

    const engine = this.engines[rec.engine];
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

    const detected = detectEngines(true, this.store.dataDir);
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
    return {
      ok: info.loggedIn,
      version: info.version,
      loggedIn: info.loggedIn,
      error: info.loggedIn ? undefined : `Not logged in — run: ${info.loginCmd}`,
    };
  }

  async getDashboardState(forceDetect = false, fetchRateLimits = false) {
    const engines = detectEngines(forceDetect, this.store.dataDir);
    let codexRateLimits = this.engines.codex.latestRateLimits;
    if (engines.codex?.status === "ready" && fetchRateLimits) {
      await Promise.allSettled([
        this.engines.codex.readRateLimits(true),
        this.engines.codex.listModels(false),
      ]);
      codexRateLimits = this.engines.codex.latestRateLimits;
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
    const dshModels = readDshConfigModels().map(({ apiKey, ...model }) => {
      const providerId = model.providerId;
      let channel = dshChannelMap.get(providerId);
      if (!channel) {
        channel = {
          id: `dsh:${providerId}`,
          name: API_PROVIDERS.find((p) => p.id === providerId)?.nameEn || providerId,
          providerId,
          baseUrl: model.baseUrl,
          source: "dsh",
          readOnly: true,
          hasApiKey: Boolean(apiKey),
          maskedApiKey: maskSecret(apiKey),
          models: [],
        };
        dshChannelMap.set(providerId, channel);
      }
      channel.models.push({ id: model.id, modelName: model.modelName });
      return {
        ...model,
        channelId: channel.id,
        channelName: channel.name,
        hasApiKey: Boolean(apiKey),
        maskedApiKey: maskSecret(apiKey),
      };
    });
    const settings = this.store.getPublicState();

    return {
      settings,
      channels: settings.channels,
      engines,
      codexRateLimits,
      codexModels,
      dshModels,
      dshChannels: [...dshChannelMap.values()],
      cliSubModels: {
        codex: codexModels,
        ...CLI_DEFAULT_MODELS_MAP,
      },
      cooldowns: this.store.getAllActiveCooldowns(),
      sessions: this.store.listSessions(),
      telemetry: this.telemetry.getSummary(30),
      activeJobs: this.#runningJobs().map((j) => ({
        ...this.#summarizeJob(j),
        sessionId: j.sessionId || "",
      })),
      recentJobs: this.#recentJobs(10),
      interruptedJobs: this.#interruptedJobs(),
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
    return {
      ok: true,
      job: {
        jobId: id,
        role: snapshot?.role || legacy?.role || "",
        slot: snapshot?.slot || legacy?.slot || "default",
        title: snapshot?.title || "",
        cwd: snapshot?.cwd || "",
        sessionId: snapshot?.sessionId || "",
        engine: snapshot?.engine || "",
        modelDisplayName: snapshot?.modelDisplayName || "",
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
      },
    };
  }

  async shutdown() {
    for (const job of this.jobs.values()) {
      if (job.status === "running") this.#markJobTerminal(job, "interrupted", job.error || CRASH_RECOVERY_ERROR);
    }
    await Promise.allSettled(Object.values(this.engines).map((e) => e.shutdown?.()));
  }
}
