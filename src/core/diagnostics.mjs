import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const SECRET_KEY_RE =
  /("?(?:api[_-]?key|client[_-]?token|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|token)"?\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'[^']*'|[^\s,;}\]]+)/gi;
export function redactText(text) {
  return String(text ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, "[REDACTED]")
    .replace(/\bast_[A-Za-z0-9_-]{6,}/g, "[REDACTED]")
    .replace(SECRET_KEY_RE, '$1"[REDACTED]"');
}
function scrub(text, extraSecrets) {
  let out = redactText(text);
  for (const secret of extraSecrets) {
    if (typeof secret !== "string" || secret.length < 6) continue;
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}
function stripApiKeys(value) {
  if (Array.isArray(value)) return value.map(stripApiKeys);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^api[_-]?key$/i.test(key)) continue;
    out[key] = stripApiKeys(child);
  }
  return out;
}
function safeReadText(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
function sanitizeJson(text, secrets) {
  try {
    return scrub(JSON.stringify(stripApiKeys(JSON.parse(text)), null, 2) + "\n", secrets);
  } catch {
    return scrub(text, secrets);
  }
}
function sanitizeJsonl(text, secrets) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return scrub(JSON.stringify(stripApiKeys(JSON.parse(line))), secrets);
      } catch {
        return scrub(line, secrets);
      }
    })
    .join("\n")
    .concat("\n");
}
function stamp(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}
function uniqueDir(base) {
  let candidate = base;
  for (let i = 2; fs.existsSync(candidate); i++) candidate = `${base}-${i}`;
  return candidate;
}
function listJobIds(dataDir) {
  const jobsDir = path.join(dataDir, "jobs");
  let names;
  try {
    names = fs.readdirSync(jobsDir);
  } catch {
    return [];
  }
  const byJob = new Map();
  for (const name of names) {
    const match = /^(.+?)(?:\.status\.json|\.checkpoint\.json|\.log)$/.exec(name);
    if (!match) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(jobsDir, name)).mtimeMs;
    } catch {}
    const prev = byJob.get(match[1]);
    if (!prev || mtime > prev) byJob.set(match[1], mtime);
  }
  return [...byJob.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
const DAEMON_EVENTS_FILE = "daemon-events.jsonl";
const DAEMON_EVENTS_MAX_BYTES = 1_500_000;
const DAEMON_EVENTS_KEEP_LINES = 1500;

export function appendDaemonEvent(dataDir, event = {}) {
  if (!dataDir || !event || typeof event !== "object") return;
  try {
    const root = path.resolve(dataDir);
    fs.mkdirSync(root, { recursive: true });
    const filePath = path.join(root, DAEMON_EVENTS_FILE);
    const clean = stripApiKeys(event);
    const row = { ts: new Date().toISOString(), ...clean };
    const line = redactText(JSON.stringify(row)) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
    try {
      if (fs.statSync(filePath).size > DAEMON_EVENTS_MAX_BYTES) {
        const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
        const trimmed = lines.slice(-DAEMON_EVENTS_KEEP_LINES).join("\n") + "\n";
        fs.writeFileSync(filePath, trimmed, "utf8");
      }
    } catch {}
  } catch {}
}

function summarize(dataDir, jobIds, version, daemonInfo, includedJobs) {
  const readCount = (file, key) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8"));
      return Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.[key]) ? parsed[key].length : 0;
    } catch { return 0; }
  };
  let turns = 0;
  let reported = 0;
  const tel = safeReadText(path.join(dataDir, "telemetry.jsonl")) || "";
  for (const line of tel.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      turns++;
      if (row?.cacheReported === true) reported++;
    } catch {}
  }
  const failed = [];
  for (const jobId of jobIds) {
    try {
      const snap = JSON.parse(fs.readFileSync(path.join(dataDir, "jobs", `${jobId}.status.json`), "utf8"));
      if (snap?.status !== "failed" && !snap?.error) continue;
      failed.push({ at: Number(snap.finishedAt || snap.updatedAt || snap.startedAt) || 0,
        line: `${jobId} · ${snap.role || "?"} · ${snap.modelDisplayName || snap.modelId || snap.engine || "?"} · ${snap.error || "failed"}` });
    } catch {}
  }
  failed.sort((a, b) => b.at - a.at);
  const recentEvents = [];
  let authFailures = 0;
  let handshakes = 0;
  const evText = safeReadText(path.join(dataDir, DAEMON_EVENTS_FILE)) || "";
  for (const line of evText.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev?.type === "mcp_auth_failed" || ev?.type === "host_rejected" || ev?.type === "origin_rejected") authFailures++;
      if (ev?.type === "client_handshake") handshakes++;
      recentEvents.push(ev);
    } catch {}
  }
  const tailEvents = recentEvents
    .slice(-10)
    .reverse()
    .map((ev) => `- ${ev.ts || "?"} · ${ev.type || "event"} · ${redactText(JSON.stringify({ ...ev, ts: undefined, type: undefined })).slice(0, 260)}`);

  const host = daemonInfo?.host || "127.0.0.1";
  const port = daemonInfo?.port ?? "?";
  return [
    "# A.stand Diagnostic Bundle",
    "",
    `- Version: ${version || "unknown"}`,
    `- Generated: ${new Date().toISOString()}`,
    `- OS: ${process.platform} ${process.arch}`,
    `- Node: ${process.version}`,
    `- Daemon: http://${host}:${port}`,
    "",
    "## Counts",
    `- Clients: ${readCount("clients.json", "clients")}`,
    `- Extensions: ${readCount("extensions.json", "items")}`,
    `- Telemetry turns: ${turns}`,
    `- Cache turns reported: ${reported}`,
    `- Cache turns unreported: ${turns - reported}`,
    `- Daemon events logged: ${recentEvents.length} (handshakes=${handshakes}, auth/origin rejections=${authFailures})`,
    `- Job artifacts included: ${includedJobs}`,
    "",
    "## Recent Daemon & Upstream Communication Events",
    ...(tailEvents.length ? tailEvents : ["- (none)"]),
    "",
    "## Last failed / errored jobs",
    ...(failed.length ? failed.slice(0, 5).map((row) => `- ${redactText(row.line).slice(0, 400)}`) : ["- (none)"]),
    "",
  ].join("\n");
}
function run(command, args, { cwd, timeout = 20_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      finish({ code: -1, stderr: "", error: err });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish({ code: -1, stderr, error: new Error(`timeout after ${timeout}ms`) });
    }, timeout);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({ code: -1, stderr, error: err });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code, stderr });
    });
  });
}
async function compressWindows(stageDir, zipPath) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -LiteralPath ${quote(stageDir)} -DestinationPath ${quote(zipPath)} -Force`,
  ];
  let result = await run("powershell.exe", args);
  if (result.error?.code === "ENOENT") result = await run("pwsh", args);
  if (result.error?.code === "ENOENT") throw new Error("PowerShell is unavailable for zip compression");
  if (result.code !== 0) throw new Error(`Compress-Archive failed: ${result.stderr.trim().slice(-500)}`);
}
async function compressPosix(stageDir, zipPath) {
  const result = await run("zip", ["-r", zipPath, "."], { cwd: stageDir });
  if (result.error?.code === "ENOENT") return false;
  if (result.code !== 0) throw new Error(`zip failed: ${result.stderr.trim().slice(-500)}`);
  return true;
}
export async function exportSanitizedDiagnostics({
  dataDir,
  daemonInfo = {},
  version = "",
  maxJobs = 15,
  extraSecrets = [],
} = {}) {
  if (!dataDir) throw Object.assign(new Error("dataDir is required"), { status: 400 });
  const root = path.resolve(dataDir);
  const secrets = Array.isArray(extraSecrets) ? extraSecrets : [];
  const name = `Astand_diag_${stamp(new Date())}`;
  const stageDir = uniqueDir(path.join(os.tmpdir(), name));
  fs.mkdirSync(stageDir, { recursive: true });
  const jobIds = listJobIds(root).slice(0, Math.max(0, Math.min(200, Number(maxJobs) || 15)));
  const jobSet = new Set(jobIds);
  let includedJobs = 0;
  const safeJsonFiles = [
    ["settings.json", "settings.json"],
    ["clients.json", "clients.json"],
    ["extensions.json", "extensions.json"],
    ["sessions.json", "sessions.json"],
    ["receipts.json", "receipts.json"],
    ["ui-trace.json", "ui-trace.json"],
  ];
  for (const [source, target] of safeJsonFiles) {
    const text = safeReadText(path.join(root, source));
    if (text != null) fs.writeFileSync(path.join(stageDir, target), sanitizeJson(text, secrets), "utf8");
  }
  for (const source of ["telemetry.jsonl", "job-perf.jsonl", DAEMON_EVENTS_FILE]) {
    const text = safeReadText(path.join(root, source));
    if (text != null) fs.writeFileSync(path.join(stageDir, source), sanitizeJsonl(text, secrets), "utf8");
  }

  const jobsDir = path.join(root, "jobs");
  for (const jobId of jobIds) {
    let jobIncluded = false;
    for (const suffix of [".status.json", ".log", ".checkpoint.json"]) {
      const file = `${jobId}${suffix}`;
      const text = safeReadText(path.join(jobsDir, file));
      if (text == null) continue;
      fs.mkdirSync(path.join(stageDir, "jobs"), { recursive: true });
      fs.writeFileSync(path.join(stageDir, "jobs", file), scrub(text, secrets), "utf8");
      jobIncluded = true;
    }
    const output = safeReadText(path.join(root, "outputs", `${jobId}.txt`));
    if (output != null && jobSet.has(jobId)) {
      fs.mkdirSync(path.join(stageDir, "outputs"), { recursive: true });
      fs.writeFileSync(path.join(stageDir, "outputs", `${jobId}.txt`), scrub(output, secrets), "utf8");
      jobIncluded = true;
    }
    if (jobIncluded) includedJobs++;
  }
  fs.writeFileSync(
    path.join(stageDir, "00-DIAGNOSTIC-SUMMARY.md"),
    scrub(summarize(root, jobIds, version, daemonInfo, includedJobs), secrets),
    "utf8"
  );
  fs.writeFileSync(
    path.join(stageDir, "SECRETS_EXCLUDED.txt"),
    [
      "SECRETS EXCLUDED / 已排除敏感信息",
      "",
      "This bundle deliberately EXCLUDES secrets.json and every raw API key, client token,",
      "Bearer credential, sk-* key and ast_* token. All copied text was scrubbed through",
      "A.stand redactText plus the live daemon secret list.",
      "",
      "本诊断包故意排除了 secrets.json 及所有原始 API Key、客户端令牌、Bearer 凭据、",
      "sk-* 与 ast_* 密钥；所有文本均经过脱敏处理，可安全用于问题排查与共享。",
      "",
    ].join("\n"),
    "utf8"
  );
  const outDir = path.join(root, "diagnostics");
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(outDir, `${name}.zip`);
  let zipOk = true;
  if (process.platform === "win32") await compressWindows(stageDir, zipPath);
  else zipOk = await compressPosix(stageDir, zipPath);

  if (!zipOk) {
    return { ok: true, zipPath: null, fileName: path.basename(stageDir), sizeBytes: null, includedJobs, dirPath: stageDir };
  }
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(zipPath).size;
  } catch {}
  fs.rmSync(stageDir, { recursive: true, force: true });
  return { ok: true, zipPath, fileName: path.basename(zipPath), sizeBytes, includedJobs, dirPath: stageDir };
}
export function openInExplorer(targetPath, { dataDir, selectFile = false } = {}) {
  const root = path.resolve(String(dataDir || ""));
  const target = path.resolve(String(targetPath || ""));
  if (!root || (target !== root && !target.startsWith(root + path.sep))) {
    throw Object.assign(new Error("Target path is outside the data directory"), { status: 400 });
  }
  const isFile = (() => { try { return fs.statSync(target).isFile(); } catch { return false; } })();
  let command;
  let args;
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = selectFile && isFile ? [`/select,${target}`] : [target];
  } else if (process.platform === "darwin") {
    command = "open";
    args = selectFile ? ["-R", target] : [target];
  } else {
    command = "xdg-open";
    args = [target];
  }

  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
  return { ok: true, path: target };
}
