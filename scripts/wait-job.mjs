#!/usr/bin/env node
/**
 * Agent Relay doorbell — a zero-dependency, zero-token, ~0% CPU job waiter.
 *
 * Usage:
 *   node wait-job.mjs --data-dir "<dataDir>" [--stall-sec 180] [--long-run-min 10] [--rearm] <jobId1> [jobId2 ...]
 *
 * Reads `<dataDir>/jobs/<jobId>.status.json` (written atomically by the MCP server) every 1.5s
 * and prints a concise, sanitized 3-line summary per job — never the raw log.
 *
 * Recurring long-run doorbell:
 *   With `--long-run-min N` (N > 0, mirrors the `longRunCheckinMin` setting; 0 = off) the waiter
 *   also exits 5 with `[LONG_RUN_CHECKIN]` once a watched job has been running for N minutes since
 *   its durable checkpoint (or since start). The Lead decides, then re-runs the SAME command with
 *   `--rearm`; `--rearm` restarts the interval from now and persists the new anchor in
 *   `<dataDir>/jobs/<jobId>.checkpoint.json`. Without `--rearm` the persisted checkpoint keeps the
 *   original anchor, so a re-run is idempotent (no tight loop) until the interval really elapses.
 *
 * Exit codes:
 *   0  every watched job completed
 *   1  at least one job errored / interrupted (incl. host crash), or --timeout-sec expired
 *   2  a running job was flagged by the stall gatekeeper / went silent past --stall-sec
 *   3  the MCP process (pid) that owned a running job exited
 *   4  bad usage / no status file found
 *   5  long-run check-in interval reached for a still-running job (Lead decides + re-arms)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const POLL_MS = 1500;
const DEFAULT_STALL_SEC = 180;
const MISSING_GRACE_MS = 15_000;
const LONG_RUN_EXIT = 5;
const TEXT_MAX = 160;

function parseArgs(argv) {
  const opts = {
    dataDir: "",
    stallSec: DEFAULT_STALL_SEC,
    jobIds: [],
    timeoutSec: 0,
    longRunMin: 0,
    rearm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir" || a === "-d") opts.dataDir = argv[++i] || "";
    else if (a.startsWith("--data-dir=")) opts.dataDir = a.slice("--data-dir=".length);
    else if (a === "--stall-sec") opts.stallSec = Number(argv[++i]);
    else if (a.startsWith("--stall-sec=")) opts.stallSec = Number(a.slice("--stall-sec=".length));
    else if (a === "--long-run-min") opts.longRunMin = Number(argv[++i]);
    else if (a.startsWith("--long-run-min=")) opts.longRunMin = Number(a.slice("--long-run-min=".length));
    else if (a === "--timeout-sec") opts.timeoutSec = Number(argv[++i]);
    else if (a.startsWith("--timeout-sec=")) opts.timeoutSec = Number(a.slice("--timeout-sec=".length));
    else if (a === "--rearm" || a === "--re-arm") opts.rearm = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (!a.startsWith("-")) opts.jobIds.push(a);
  }
  if (!Number.isFinite(opts.stallSec) || opts.stallSec <= 0) opts.stallSec = DEFAULT_STALL_SEC;
  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec < 0) opts.timeoutSec = 0;
  if (!Number.isFinite(opts.longRunMin) || opts.longRunMin < 0) opts.longRunMin = 0;
  opts.longRunMin = Math.min(120, Math.round(opts.longRunMin));
  return opts;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readStatus(dataDir, jobId) {
  return readJson(path.join(dataDir, "jobs", `${jobId}.status.json`));
}

function checkpointPath(dataDir, jobId) {
  return path.join(dataDir, "jobs", `${jobId}.checkpoint.json`);
}

function readCheckpoint(dataDir, jobId) {
  const raw = readJson(checkpointPath(dataDir, jobId));
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
}

// Atomic write so a concurrent doorbell never observes a half-written checkpoint.
function writeCheckpoint(dataDir, jobId, next) {
  const target = checkpointPath(dataDir, jobId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    return false;
  }
}

function isProcessAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    // EPERM => process exists but is owned by someone else.
    return err?.code === "EPERM";
  }
}

// Status/checkpoint text is untrusted. Strip ANSI + control chars, redact secrets, bound length.
function oneLine(text, max = 90) {
  let clean = String(text ?? "");
  clean = clean.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  clean = clean.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
  clean = clean.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  clean = clean.replace(/\b(?:sk|pk|api|token|secret|key)[-_][A-Za-z0-9_-]{10,}\b/gi, "[redacted]");
  clean = clean.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  clean = clean.replace(/\s+/g, " ").trim();
  const limit = Math.max(8, Number(max) || 90);
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function isZh(snap) {
  return snap?.lang !== "en";
}

function labelsOf(snap) {
  const zh = isZh(snap);
  return {
    zh,
    stillRunning: zh ? "仍在运行" : "still running",
    elapsed: zh ? "已运行" : "elapsed",
    silent: zh ? "静默" : "silent",
    lastAction: zh ? "最近动作" : "last action",
    log: zh ? "日志" : "log",
    session: zh ? "会话" : "session",
    role: zh ? "角色" : "role",
    title: zh ? "标题" : "title",
    interval: zh ? "巡检间隔" : "interval",
    nextStep: zh ? "主 Agent 下一步" : "Lead Agent next step",
    decide: zh ? "决定继续等待 / 查看 / 改方向 / 停止，然后重新挂钟" : "decide (keep waiting / inspect / steer / stop), then re-arm",
    rearmCmd: zh ? "重新挂钟命令" : "re-arm command",
    checkpoint: zh ? "检查点" : "checkpoint",
    completed: zh ? "已完成" : "completed",
    failed: zh ? "失败" : "failed",
    interrupted: zh ? "已中断" : "interrupted",
    stall: zh ? "停滞告警" : "stall alert",
  };
}

function labelOf(snap) {
  return `${snap.role || "?"} · ${oneLine(snap.title || snap.jobId, 48)}`;
}

function actionLine(snap, labels) {
  const action = snap.lastAction;
  if (action?.kind && action?.text) {
    return `${labels.lastAction}=[${oneLine(action.kind, 24)}] ${oneLine(action.text, 120)}`;
  }
  return `${labels.lastAction}=${oneLine(snap.lastSummary || "(none)", 120)}`;
}

function summaryLines(snap, status, labels) {
  const sec = Math.round(Number(snap.elapsedSec) || 0);
  const sid = oneLine(snap.sessionId || "(none)", 96);
  const logPath = oneLine(snap.logPath || "", TEXT_MAX);
  const outputPath = oneLine(snap.outputPath || "", TEXT_MAX);
  if (status === "completed") {
    return [
      `[COMPLETED] ${snap.jobId} (${labelOf(snap)}) · ${sec}s`,
      `  sessionId=${sid} · last=${oneLine(snap.lastSummary || "(none)", 120)}`,
      `  output=${outputPath || "(not written)"}`,
    ];
  }
  if (status === "error") {
    return [
      `[ERROR] ${snap.jobId} (${labelOf(snap)}) · ${sec}s`,
      `  sessionId=${sid} · error=${oneLine(snap.error || "unknown error", 160)}`,
      `  log=${logPath || "(none)"}${outputPath ? ` · output=${outputPath}` : ""}`,
    ];
  }
  return [
    `[INTERRUPTED] ${snap.jobId} (${labelOf(snap)}) · ${sec}s`,
    `  sessionId=${sid} · reason=${oneLine(snap.error || "host/MCP exited while running", 160)}`,
    `  last=${oneLine(snap.lastSummary || "(none)", 120)} · log=${logPath || "(none)"}`,
  ];
}

function normalizeStatus(raw) {
  if (raw === "completed") return "completed";
  if (raw === "failed" || raw === "error") return "error";
  if (raw === "interrupted" || raw === "cancelled" || raw === "canceled") return "interrupted";
  return "running";
}

function normalizeTime(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n; // accept seconds or milliseconds
}

function printBlock(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

// Re-arm token: persisted in the checkpoint so a restarted waiter/Lead can prove the interval reset.
function makeRearmToken() {
  try {
    return `rearm_${crypto.randomBytes(8).toString("hex")}`;
  } catch {
    return `rearm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Atomic claim so two doorbells watching the same job never emit duplicate long-run check-ins.
function claimLongRunCheckin(dataDir, jobId, anchorAt) {
  const target = path.join(dataDir, "jobs", `${jobId}.${anchorAt}.longrun.claim`);
  try {
    fs.writeFileSync(target, String(process.pid), { flag: "wx" });
    return true;
  } catch (err) {
    return err?.code !== "EEXIST";
  }
}

function rearmCommand(opts) {
  return [
    `node "${path.resolve(process.argv[1])}"`,
    `--data-dir "${opts.dataDir}"`,
    `--stall-sec ${Math.round(opts.stallSec)}`,
    opts.longRunMin > 0 ? `--long-run-min ${opts.longRunMin}` : "",
    opts.timeoutSec > 0 ? `--timeout-sec ${opts.timeoutSec}` : "",
    "--rearm",
    ...opts.jobIds,
  ].filter(Boolean).join(" ");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.dataDir || opts.jobIds.length === 0) {
    process.stderr.write(
      'Usage: node wait-job.mjs --data-dir "<dataDir>" [--stall-sec 180] [--long-run-min 10] [--rearm] <jobId1> [jobId2 ...]\n'
    );
    process.exit(4);
  }
  const dataDir = path.resolve(opts.dataDir);
  const jobIds = [...new Set(opts.jobIds)];
  const stallMs = opts.stallSec * 1000;
  const longRunMs = opts.longRunMin > 0 ? opts.longRunMin * 60_000 : 0;
  const startedAt = Date.now();
  // First observation per job (no durable checkpoint yet) seeds the long-run anchor.
  const observedAt = new Map();
  const rearmedThisRun = new Set();

  const finish = (code) => {
    clearInterval(timer);
    process.exit(code);
  };

  // Long-run anchor: durable checkpoint first, then a --rearm reset, else the first observation.
  const longRunAnchor = (jobId, snap) => {
    const cp = readCheckpoint(dataDir, jobId);
    const cpAt = Number(cp?.longRunAnchorAt);
    if (Number.isFinite(cpAt) && cpAt > 0) return { at: cpAt, cp };
    const seen = observedAt.get(jobId);
    if (seen) return { at: seen, cp };
    const seed = Number(snap?.lastLongRunAt) || Number(snap?.startedAt) || Date.now();
    observedAt.set(jobId, seed);
    return { at: seed, cp };
  };

  const maybeRearm = (jobId, snap) => {
    if (!opts.rearm || rearmedThisRun.has(jobId) || opts.longRunMin <= 0) return null;
    if (normalizeStatus(snap?.status) !== "running") return null;
    const now = Date.now();
    const prior = readCheckpoint(dataDir, jobId) || {};
    const next = {
      ...prior,
      version: 1,
      jobId,
      rearmToken: makeRearmToken(),
      rearmCount: (Number(prior.rearmCount) || 0) + 1,
      rearmAt: now,
      longRunAnchorAt: now,
      longRunCheckinMin: opts.longRunMin,
      stallSec: Math.round(opts.stallSec),
      lastAction: snap?.lastAction || prior.lastAction || null,
      sessionId: snap?.sessionId || prior.sessionId || "",
      conversationId: snap?.conversationId || prior.conversationId || "",
      logPath: snap?.logPath || prior.logPath || "",
      updatedAt: now,
      firstAt: prior.firstAt || now,
    };
    const ok = writeCheckpoint(dataDir, jobId, next);
    if (ok) {
      rearmedThisRun.add(jobId);
      observedAt.set(jobId, now);
    }
    return ok ? next : null;
  };

  const tick = () => {
    const blockers = [];
    const results = [];
    for (const jobId of jobIds) {
      const snap = readStatus(dataDir, jobId);
      if (!snap) {
        if (Date.now() - startedAt > MISSING_GRACE_MS) {
          process.stderr.write(
            `[MISSING] ${jobId} status.json not found in ${path.join(dataDir, "jobs")} after ${Math.round(MISSING_GRACE_MS / 1000)}s\n`
          );
          finish(4);
          return;
        }
        results.push([`[WAITING] ${jobId}`, `  status.json not found in ${path.join(dataDir, "jobs")}`, "  (waiting…)"]);
        blockers.push({ kind: "missing", jobId });
        continue;
      }
      const labels = labelsOf(snap);
      const status = normalizeStatus(snap.status);
      results.push(summaryLines(snap, status, labels));
      if (status !== "running") continue;

      // Host/MCP crashed: nobody will ever update this snapshot again.
      if (!isProcessAlive(snap.pid)) {
        process.stdout.write(
          `[INTERRUPTED] ${jobId} MCP process ${snap.pid || "?"} exited · sessionId=${oneLine(snap.sessionId || "(none)", 96)} · last=${oneLine(snap.lastSummary || "(none)", 120)}\n`
        );
        finish(3);
        return;
      }

      if (snap.stallAlert?.reason && (!opts.rearm || Number(snap.stallAlert.at) >= startedAt || Date.now() - startedAt >= stallMs)) {
        process.stdout.write(
          `[STALL_ALERT] ${jobId} ${labels.stall}: ${oneLine(snap.stallAlert.reason, 160)} · source=${oneLine(snap.stallAlert.source || "silence_timeout", 24)} · ${actionLine(snap, labels)} · ${labels.log}=${oneLine(snap.logPath || "(none)", TEXT_MAX)}\n  ${labels.rearmCmd}: ${rearmCommand(opts)}\n`
        );
        finish(2);
        return;
      }

      const lastActivity = normalizeTime(snap.lastActivityAt || snap.updatedAt);
      const silentMs = Date.now() - lastActivity;
      if (!snap.managedSilence && Date.now() - Math.max(lastActivity, opts.rearm ? startedAt : 0) > stallMs) {
        process.stdout.write(
          `[STALL_ALERT] ${jobId} silent for ${Math.round(silentMs / 1000)}s · last=${oneLine(snap.lastSummary || "(none)", 120)} · log=${oneLine(snap.logPath || "(none)", TEXT_MAX)}\n`
        );
        finish(2);
        return;
      }

      // Recurring long-run doorbell: distinct exit 5 + durable checkpoint + explicit re-arm token.
      if (longRunMs > 0) {
        // --rearm restarts the interval from now BEFORE the threshold is evaluated (never re-fire).
        maybeRearm(jobId, snap);
        const { at, cp } = longRunAnchor(jobId, snap);
        const elapsedMs = Date.now() - at;
        if (elapsedMs >= longRunMs) {
          const elapsedSec = Math.round((Date.now() - (Number(snap.startedAt) || Date.now())) / 1000);
          const silentSec = Math.round(silentMs / 1000);
          const now = Date.now();
          const token = makeRearmToken();
          // Advance the durable anchor so a plain re-run waits a fresh interval; the claim file
          // makes concurrent waiters idempotent for the same interval (no duplicate check-ins).
          if (!claimLongRunCheckin(dataDir, jobId, at)) {
            blockers.push({ kind: "running", jobId, silentMs });
            continue;
          }
          const persisted = writeCheckpoint(dataDir, jobId, {
            ...(cp || {}),
            version: 1,
            jobId,
            rearmToken: token,
            rearmCount: (Number(cp?.rearmCount) || 0) + 1,
            rearmAt: now,
            longRunAnchorAt: now,
            longRunCheckinMin: opts.longRunMin,
            stallSec: Math.round(opts.stallSec),
            lastAction: snap.lastAction || cp?.lastAction || null,
            sessionId: snap.sessionId || cp?.sessionId || "",
            conversationId: snap.conversationId || cp?.conversationId || "",
            logPath: snap.logPath || cp?.logPath || "",
            updatedAt: now,
            firstAt: cp?.firstAt || at,
          });
          const cmd = rearmCommand(opts);
          const checkpoint = checkpointPath(dataDir, jobId);
          const action = actionLine(snap, labels);
          process.stdout.write([
            `[LONG_RUN_CHECKIN] ${jobId} (${labelOf(snap)}) · ${labels.elapsed}=${elapsedSec}s · ${labels.silent}=${silentSec}s · ${labels.role}=${snap.role || "?"} · ${labels.title}=${oneLine(snap.title || "", 60)}`,
            `  ${labels.session}=${oneLine(snap.sessionId || "(none)", 96)} · ${action} · ${labels.log}=${oneLine(snap.logPath || "(none)", TEXT_MAX)}`,
            `  ${labels.interval}=${opts.longRunMin}min · rearmToken=${token} · ${labels.checkpoint}=${checkpoint}`,
            `  ${labels.nextStep}: ${labels.decide}`,
            `  ${labels.rearmCmd}: ${cmd}`,
          ].join("\n") + "\n");
          if (!persisted) {
            process.stderr.write(`[WARN] could not persist long-run checkpoint at ${checkpoint}\n`);
          }
          finish(LONG_RUN_EXIT);
          return;
        }
      } else {
        maybeRearm(jobId, snap);
      }
      blockers.push({ kind: "running", jobId, silentMs });
    }

    if (blockers.length === 0) {
      for (const lines of results) printBlock(lines);
      const anyBad = results.some(([head]) => head.startsWith("[ERROR]") || head.startsWith("[INTERRUPTED]"));
      finish(anyBad ? 1 : 0);
      return;
    }

    if (opts.timeoutSec > 0 && Date.now() - startedAt > opts.timeoutSec * 1000) {
      for (const lines of results) printBlock(lines);
      process.stdout.write(`[TIMEOUT] still running after ${opts.timeoutSec}s\n`);
      finish(1);
    }
  };

  const timer = setInterval(tick, POLL_MS);
  tick();
}

main();
