#!/usr/bin/env node
/**
 * Agent Relay doorbell — a zero-dependency, zero-token, ~0% CPU job waiter.
 *
 * Usage:
 *   node wait-job.mjs --data-dir "<dataDir>" [--stall-sec 180] <jobId1> [jobId2 ...]
 *
 * Reads `<dataDir>/jobs/<jobId>.status.json` (written atomically by the MCP server) every 1.5s
 * and prints a concise 3-line summary per job — never the raw log.
 *
 * Exit codes:
 *   0  every watched job completed
 *   1  at least one job errored / interrupted (incl. host crash)
 *   2  a running job went silent for longer than --stall-sec
 *   3  the MCP process (pid) that owned a running job exited
 *   4  bad usage / no status file found
 */
import fs from "node:fs";
import path from "node:path";

const POLL_MS = 1500;
const DEFAULT_STALL_SEC = 180;
const MISSING_GRACE_MS = 15_000;

function parseArgs(argv) {
  const opts = { dataDir: "", stallSec: DEFAULT_STALL_SEC, jobIds: [], timeoutSec: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir" || a === "-d") opts.dataDir = argv[++i] || "";
    else if (a.startsWith("--data-dir=")) opts.dataDir = a.slice("--data-dir=".length);
    else if (a === "--stall-sec") opts.stallSec = Number(argv[++i]);
    else if (a.startsWith("--stall-sec=")) opts.stallSec = Number(a.slice("--stall-sec=".length));
    else if (a === "--timeout-sec") opts.timeoutSec = Number(argv[++i]);
    else if (a.startsWith("--timeout-sec=")) opts.timeoutSec = Number(a.slice("--timeout-sec=".length));
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (!a.startsWith("-")) opts.jobIds.push(a);
  }
  if (!Number.isFinite(opts.stallSec) || opts.stallSec <= 0) opts.stallSec = DEFAULT_STALL_SEC;
  if (!Number.isFinite(opts.timeoutSec) || opts.timeoutSec < 0) opts.timeoutSec = 0;
  return opts;
}

function readStatus(dataDir, jobId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "jobs", `${jobId}.status.json`), "utf8"));
  } catch {
    return null;
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

function oneLine(text, max = 90) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function labelOf(snap) {
  return `${snap.role || "?"} · ${oneLine(snap.title || snap.jobId, 48)}`;
}

function summaryLines(snap, status) {
  const sec = Math.round(Number(snap.elapsedSec) || 0);
  const sid = snap.sessionId || "(none)";
  const last = oneLine(snap.lastSummary || snap.error || "(none)", 120);
  const logPath = snap.logPath || "";
  const outputPath = snap.outputPath || "";
  if (status === "completed") {
    return [
      `[COMPLETED] ${snap.jobId} (${labelOf(snap)}) · ${sec}s`,
      `  sessionId=${sid} · last=${last}`,
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
    `  last=${last} · log=${logPath || "(none)"}`,
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.dataDir || opts.jobIds.length === 0) {
    process.stderr.write(
      'Usage: node wait-job.mjs --data-dir "<dataDir>" [--stall-sec 180] <jobId1> [jobId2 ...]\n'
    );
    process.exit(4);
  }
  const dataDir = path.resolve(opts.dataDir);
  const jobIds = [...new Set(opts.jobIds)];
  const stallMs = opts.stallSec * 1000;
  const startedAt = Date.now();

  const finish = (code) => {
    clearInterval(timer);
    process.exit(code);
  };

  const tick = () => {
    const blockers = [];
    const results = [];
    for (const jobId of jobIds) {
      const snap = readStatus(dataDir, jobId);
      if (!snap) {
        if (Date.now() - startedAt > MISSING_GRACE_MS) {
          process.stderr.write(`[MISSING] ${jobId} status.json not found in ${path.join(dataDir, "jobs")} after ${Math.round(MISSING_GRACE_MS / 1000)}s\n`);
          finish(4);
          return;
        }
        results.push([`[WAITING] ${jobId}`, `  status.json not found in ${path.join(dataDir, "jobs")}`, "  (waiting…)"]);
        blockers.push({ kind: "missing", jobId });
        continue;
      }
      const status = normalizeStatus(snap.status);
      results.push(summaryLines(snap, status));
      if (status !== "running") continue;

      // Host/MCP crashed: nobody will ever update this snapshot again.
      if (!isProcessAlive(snap.pid)) {
        process.stdout.write(
          `[INTERRUPTED] ${jobId} MCP process ${snap.pid || "?"} exited · sessionId=${snap.sessionId || "(none)"} · last=${oneLine(snap.lastSummary || "(none)")}\n`
        );
        finish(3);
        return;
      }

      if (snap.stallAlert?.reason) {
        process.stdout.write(
          `[STALL_ALERT] ${jobId} gatekeeper alert: ${oneLine(snap.stallAlert.reason, 160)} · last=${oneLine(snap.lastSummary || "(none)")} · log=${snap.logPath || "(none)"}\n`
        );
        finish(2);
        return;
      }

      const lastActivity = normalizeTime(snap.lastActivityAt || snap.updatedAt);
      const silentMs = Date.now() - lastActivity;
      if (silentMs > stallMs) {
        process.stdout.write(
          `[STALL_ALERT] ${jobId} silent for ${Math.round(silentMs / 1000)}s · last=${oneLine(snap.lastSummary || "(none)")} · log=${snap.logPath || "(none)"}\n`
        );
        finish(2);
        return;
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
