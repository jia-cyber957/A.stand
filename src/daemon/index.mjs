import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_VERSION } from "../core/constants.mjs";
import { ClientRegistry } from "../core/clients.mjs";
import { RelayOrchestrator } from "../core/orchestrator.mjs";
import { RelayStore } from "../core/store.mjs";
import { TelemetryLogger } from "../core/telemetry.mjs";
import { createDaemonHttpServer } from "./http-server.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "..", "..", "dist");
const DEFAULT_PORT = 3426;

export function parseDaemonArgs(argv = []) {
  const opts = { port: null, dataDir: "", desktopHtml: "", printReady: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && argv[i + 1] !== undefined) opts.port = Number(argv[++i]);
    else if (arg.startsWith("--port=")) opts.port = Number(arg.slice("--port=".length));
    else if (arg === "--data-dir" && argv[i + 1] !== undefined) opts.dataDir = argv[++i];
    else if (arg.startsWith("--data-dir=")) opts.dataDir = arg.slice("--data-dir=".length);
    else if (arg === "--desktop-html" && argv[i + 1] !== undefined) opts.desktopHtml = argv[++i];
    else if (arg.startsWith("--desktop-html=")) opts.desktopHtml = arg.slice("--desktop-html=".length);
    else if (arg === "--print-ready") opts.printReady = true;
  }
  return opts;
}

export function resolvePort(cliPort) {
  // An explicit --port always wins (including 0 for an ephemeral test port).
  const raw = cliPort !== null && cliPort !== undefined && Number.isFinite(cliPort)
    ? Number(cliPort)
    : Number(process.env.ASTAND_PORT || DEFAULT_PORT);
  if (!Number.isInteger(raw) || raw < 0 || raw > 65535) return DEFAULT_PORT;
  return raw;
}

function resolveDataDir(cliDataDir) {
  return path.resolve(
    cliDataDir || process.env.ASTAND_DATA_DIR || process.env.PLUGIN_DATA || path.join(os.homedir(), ".astand")
  );
}

function readDaemonFile(daemonFile) {
  try {
    return JSON.parse(fs.readFileSync(daemonFile, "utf8"));
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

async function healthResponds(port) {
  if (!Number.isInteger(port) || port <= 0) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function writeDaemonFile(daemonFile, info) {
  fs.mkdirSync(path.dirname(daemonFile), { recursive: true });
  const tmp = `${daemonFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, daemonFile);
}

function emitReady(info) {
  process.stdout.write(
    `ASTAND_DAEMON_READY ${JSON.stringify({
      host: info.host,
      port: info.port,
      uiToken: info.uiToken,
      mcpUrl: info.mcpUrl,
    })}\n`
  );
}

async function main() {
  const cli = parseDaemonArgs(process.argv.slice(2));
  const dataDir = resolveDataDir(cli.dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const daemonFile = path.join(dataDir, "daemon.json");

  // Single-instance guard: reuse a live daemon instead of clobbering it.
  const existing = readDaemonFile(daemonFile);
  if (existing && isPidAlive(existing.pid) && existing.pid !== process.pid && (await healthResponds(existing.port))) {
    if (cli.printReady) emitReady(existing);
    return 0;
  }

  const store = new RelayStore(dataDir);
  const telemetry = new TelemetryLogger(dataDir);
  const orchestrator = new RelayOrchestrator(store, telemetry);
  const clientRegistry = new ClientRegistry(store, dataDir);

  const handle = await createDaemonHttpServer({
    store,
    telemetry,
    orchestrator,
    clientRegistry,
    port: resolvePort(cli.port),
    uiToken: crypto.randomBytes(24).toString("hex"),
    desktopHtmlPath: cli.desktopHtml
      ? path.resolve(cli.desktopHtml)
      : path.join(DIST_DIR, "desktop.html"),
    bridgeScript: path.join(DIST_DIR, "stdio-bridge.mjs"),
    rulesFile: path.resolve(DIST_DIR, "..", "plugin", "rules", "AGENTS.md"),
    version: PLUGIN_VERSION,
  });

  const info = {
    pid: process.pid,
    host: handle.host,
    port: handle.port,
    mcpUrl: handle.mcpUrl(),
    uiToken: handle.uiToken,
    startedAt: handle.startedAt,
    version: PLUGIN_VERSION,
  };
  writeDaemonFile(daemonFile, info);
  if (cli.printReady) emitReady(info);

  let shuttingDown = false;
  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await handle.close();
    } catch {}
    try {
      await orchestrator.shutdown();
    } catch {}
    // Only remove daemon.json when this process still owns it.
    try {
      const current = readDaemonFile(daemonFile);
      if (current && Number(current.pid) === process.pid) fs.rmSync(daemonFile, { force: true });
    } catch {}
    process.exit(code);
  }

  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
  return new Promise(() => {});
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  main()
    .then((code) => {
      if (typeof code === "number") process.exit(code);
    })
    .catch((err) => {
      process.stderr.write(`A.stand daemon failed: ${err?.stack || err?.message || String(err)}\n`);
      process.exit(1);
    });
}

export { main };
