import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * Milestone 1 (v2 standalone daemon) end-to-end verification.
 *
 * Every step has its own hard timeout; the whole script is bounded by OVERALL_TIMEOUT_MS.
 * All servers use ephemeral ports (port: 0) and all child processes are killed in finally.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DAEMON_BUNDLE = path.join(ROOT, "dist", "daemon.mjs");
const BRIDGE_BUNDLE = path.join(ROOT, "dist", "stdio-bridge.mjs");

const STEP_TIMEOUT_MS = 15_000;
const OVERALL_TIMEOUT_MS = 45_000;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "astand-v2-e2e-"));

const children = [];
let daemonProc = null;
let daemonInfo = null;

function log(step) {
  console.log(`\n=== ${step}`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function startDaemon() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [DAEMON_BUNDLE, "--port", "0", "--data-dir", DATA_DIR, "--print-ready"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    );
    children.push(child);
    daemonProc = child;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("daemon did not print ready line in 15s")), STEP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((l) => l.startsWith("ASTAND_DAEMON_READY "));
      if (!line) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(line.slice("ASTAND_DAEMON_READY ".length)));
      } catch (err) {
        reject(err);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`daemon exited early (code=${code}) stderr=${stderr.slice(-800)}`));
    });
  });
}

function request(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractZip(zipPath, destDir) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$ErrorActionPreference='Stop'; try { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(zipPath)}, ${quote(destDir)}) } catch { Write-Error $_; exit 1 }`,
          ],
          { encoding: "utf8", timeout: 20_000, windowsHide: true }
        )
      : spawnSync("unzip", ["-q", zipPath, "-d", destDir], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, `zip extraction failed: ${result.stderr || result.error || "unknown error"}`);
}

function walkFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function uiHeaders(extra = {}) {
  return { "X-Astand-UI-Token": daemonInfo.uiToken, ...extra };
}

function mcpHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Astand-Token": token,
    Accept: "application/json, text/event-stream",
    ...extra,
  };
}

// Parse either a plain JSON-RPC response or an SSE frame carrying one.
function parseRpc(res) {
  if (res.json && typeof res.json === "object" && !Array.isArray(res.json)) return res.json;
  for (const frame of String(res.text || "").split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n")
      .trim();
    if (!data) continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
}

async function mcpPost(token, message, sessionId, extraHeaders = {}) {
  return request(daemonInfo.port, "POST", "/mcp", {
    headers: mcpHeaders(token, {
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...extraHeaders,
    }),
    body: message,
  });
}

async function runMcpHandshake(token, clientName, { transportHeader } = {}) {
  const initRes = await mcpPost(
    token,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: clientName, version: "9.9.9" },
      },
    },
    "",
    transportHeader ? { "X-Astand-Transport": transportHeader } : {}
  );
  assert.equal(initRes.status, 200, `initialize failed: ${initRes.status} ${initRes.text.slice(0, 300)}`);
  const initRpc = parseRpc(initRes);
  assert.ok(initRpc?.result, `initialize returned no result: ${initRes.text.slice(0, 400)}`);
  const sessionId = initRes.headers["mcp-session-id"];
  assert.ok(sessionId, "initialize did not return mcp-session-id header");

  // Initialized notification (202 Accepted, no payload expected).
  const notifyRes = await mcpPost(
    token,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sessionId,
    transportHeader ? { "X-Astand-Transport": transportHeader } : {}
  );
  assert.ok([200, 202, 204].includes(notifyRes.status), `initialized notification status ${notifyRes.status}`);

  const listRes = await mcpPost(
    token,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    sessionId,
    { "mcp-protocol-version": "2025-06-18", ...(transportHeader ? { "X-Astand-Transport": transportHeader } : {}) }
  );
  assert.equal(listRes.status, 200, `tools/list failed: ${listRes.status}`);
  const listRpc = parseRpc(listRes);
  const names = (listRpc?.result?.tools || []).map((t) => t.name).sort();
  assert.deepEqual(
    names,
    ["agent_relay_ask", "agent_relay_poll", "agent_relay_review", "agent_relay_session"],
    `unexpected tool set: ${names.join(",")}`
  );

  const callRes = await mcpPost(
    token,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "agent_relay_session", arguments: { action: "status" } } },
    sessionId,
    { "mcp-protocol-version": "2025-06-18", ...(transportHeader ? { "X-Astand-Transport": transportHeader } : {}) }
  );
  assert.equal(callRes.status, 200, `tools/call failed: ${callRes.status} ${callRes.text.slice(0, 300)}`);
  const callRpc = parseRpc(callRes);
  assert.ok(callRpc?.result, `tools/call returned no result: ${callRes.text.slice(0, 400)}`);
  const text = (callRpc.result.content || []).map((c) => c.text || "").join("\n");
  assert.match(text, /enabled|limits/i, `status payload unexpected: ${text.slice(0, 300)}`);

  return { sessionId, text };
}

function openSse(port, uiToken, onEvent) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "GET",
        path: `/api/events?uiToken=${encodeURIComponent(uiToken)}`,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE handshake failed: ${res.statusCode}`));
          return;
        }
        const rl = readline.createInterface({ input: res });
        let eventName = "";
        rl.on("line", (line) => {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:") && eventName === "state_changed") {
            try {
              onEvent(JSON.parse(line.slice(5).trim()));
            } catch {}
            eventName = "";
          }
        });
        resolve({ req, res, close: () => { try { rl.close(); res.destroy(); req.destroy(); } catch {} } });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function startBridge(url, token) {
  const child = spawn(process.execPath, [BRIDGE_BUNDLE, "--url", url, "--token", token], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  const pending = new Map();
  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (msg?.id !== undefined && pending.has(msg.id)) {
      const { resolve, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      resolve(msg);
    }
  });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    waitFor(id) {
      return withTimeout(
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`bridge: no response for id=${id}`));
          }, STEP_TIMEOUT_MS);
          pending.set(id, { resolve, timer });
        }),
        STEP_TIMEOUT_MS,
        `bridge response id=${id}`
      );
    },
    closeStdin() {
      child.stdin.end();
    },
    exited,
  };
}

async function waitFor(predicate, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  assert.ok(fs.existsSync(DAEMON_BUNDLE), "dist/daemon.mjs missing — run npm run build first");
  assert.ok(fs.existsSync(BRIDGE_BUNDLE), "dist/stdio-bridge.mjs missing — run npm run build first");

  log("1. Ephemeral daemon startup & /api/health");
  daemonInfo = await withTimeout(startDaemon(), STEP_TIMEOUT_MS, "daemon startup");
  assert.ok(daemonInfo.port > 0, "daemon did not bind an ephemeral port");
  assert.equal(daemonInfo.host, "127.0.0.1");
  assert.match(daemonInfo.mcpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  assert.ok(daemonInfo.uiToken && daemonInfo.uiToken.length >= 32, "uiToken missing/short");
  const health = await withTimeout(
    request(daemonInfo.port, "GET", "/api/health"),
    STEP_TIMEOUT_MS,
    "health"
  );
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(typeof health.json.pid, "number");
  assert.equal(typeof health.json.version, "string");
  const daemonFile = path.join(DATA_DIR, "daemon.json");
  assert.ok(fs.existsSync(daemonFile), "daemon.json was not written");
  const daemonRecord = JSON.parse(fs.readFileSync(daemonFile, "utf8"));
  assert.equal(daemonRecord.pid, health.json.pid);
  assert.equal(daemonRecord.port, daemonInfo.port);
  console.log(`   ok: port=${daemonInfo.port} pid=${health.json.pid} version=${health.json.version}`);

  log("2. UI token auth enforcement");
  const noToken = await withTimeout(request(daemonInfo.port, "GET", "/api/state"), STEP_TIMEOUT_MS, "state no token");
  assert.equal(noToken.status, 401, `expected 401 without token, got ${noToken.status}`);
  const badToken = await request(daemonInfo.port, "GET", "/api/state", {
    headers: { "X-Astand-UI-Token": "deadbeef" },
  });
  assert.equal(badToken.status, 401, `expected 401 with bad token, got ${badToken.status}`);
  const goodState = await withTimeout(
    request(daemonInfo.port, "GET", "/api/state?forceDetect=0&fetchRateLimits=0", { headers: uiHeaders() }),
    STEP_TIMEOUT_MS,
    "state with token"
  );
  assert.equal(goodState.status, 200, `expected 200 with token, got ${goodState.status}`);
  assert.equal(goodState.json.ok, undefined); // dashboard payload, not an ok envelope
  assert.ok(goodState.json.daemon, "state payload missing daemon block");
  assert.equal(goodState.json.daemon.port, daemonInfo.port);
  assert.equal(goodState.json.daemon.mcpUrl, daemonInfo.mcpUrl);
  assert.ok(Array.isArray(goodState.json.providers) && goodState.json.providers.length > 0);
  assert.ok(goodState.json.cliEnginesMeta);
  assert.ok(Array.isArray(goodState.json.clients));
  assert.ok(Array.isArray(goodState.json.clientPresets) && goodState.json.clientPresets.length === 8);
  assert.ok(goodState.json.perf && typeof goodState.json.perf.total === "number", "perf summary missing");
  // Anti DNS-rebinding: a foreign Host header is rejected.
  const badHost = await request(daemonInfo.port, "GET", "/api/health", { headers: { Host: "evil.example.com" } });
  assert.equal(badHost.status, 421, `expected 421 for foreign Host, got ${badHost.status}`);
  console.log("   ok: 401 without token, 200 with token, 421 on foreign Host");

  log("3. Client CRUD + AI setup prompt bundle");
  const created = await withTimeout(
    request(daemonInfo.port, "POST", "/api/clients", {
      headers: uiHeaders(),
      body: { label: "Cursor Laptop", iconKey: "cursor", note: "e2e" },
    }),
    STEP_TIMEOUT_MS,
    "create client"
  );
  assert.equal(created.status, 201, `create failed: ${created.status} ${created.text.slice(0, 200)}`);
  const cursorClient = created.json.client;
  const cursorToken = created.json.token;
  assert.match(cursorClient.id, /^cli_[0-9a-f]{12}$/, `bad client id: ${cursorClient.id}`);
  assert.match(cursorToken, /^ast_[0-9a-f]{32}$/, "bad token format");
  assert.equal(cursorClient.status, "waiting");
  assert.equal(cursorClient.enabled, true);
  assert.equal(cursorClient.iconKey, "cursor");
  assert.match(cursorClient.maskedToken, /^ast_/, "masked token must be masked");
  assert.ok(!cursorClient.maskedToken.includes(cursorToken.slice(4)), "masked token leaks the raw token");

  const listed = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
  const listedClient = listed.json.clients.find((c) => c.id === cursorClient.id);
  assert.ok(listedClient, "created client missing from /api/state");
  assert.equal(listedClient.customName, "");

  const patched = await withTimeout(
    request(daemonInfo.port, "PATCH", `/api/clients/${cursorClient.id}`, {
      headers: uiHeaders(),
      body: { customName: "Cursor Dev", customIconKey: "vscode" },
    }),
    STEP_TIMEOUT_MS,
    "patch client"
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.json.client.customName, "Cursor Dev");
  assert.equal(patched.json.client.customIconKey, "vscode");

  const setup = await withTimeout(
    request(daemonInfo.port, "GET", `/api/clients/${cursorClient.id}/setup`, { headers: uiHeaders() }),
    STEP_TIMEOUT_MS,
    "setup bundle"
  );
  assert.equal(setup.status, 200);
  const bundle = setup.json;
  assert.equal(bundle.httpUrl, daemonInfo.mcpUrl);
  assert.equal(bundle.token, cursorToken);
  assert.match(bundle.stdioCommand, /^node ".+stdio-bridge\.mjs" --url "http:\/\/127\.0\.0\.1:\d+\/mcp" --token "ast_[0-9a-f]{32}"$/);
  assert.ok(bundle.httpConfigJson.includes(daemonInfo.mcpUrl), "httpConfigJson missing url");
  assert.ok(bundle.httpConfigJson.includes(`Bearer ${cursorToken}`), "httpConfigJson missing bearer token");
  assert.ok(bundle.stdioBridgeConfigJson.includes("stdio-bridge.mjs"), "stdio config missing bridge script");
  for (const prompt of [bundle.promptZh, bundle.promptEn]) {
    assert.ok(prompt.includes(daemonInfo.mcpUrl), "prompt missing HTTP URL");
    assert.ok(prompt.includes(cursorToken), "prompt missing token");
    assert.ok(prompt.includes("Authorization: Bearer"), "prompt missing Authorization header");
    assert.ok(prompt.includes("X-Astand-Token"), "prompt missing X-Astand-Token header");
    assert.ok(prompt.includes(bundle.stdioCommand), "prompt missing stdio bridge command");
    assert.ok(prompt.includes('agent_relay_session(action="status")'), "prompt missing handshake call");
    assert.ok(prompt.includes("sessionId"), "prompt missing sessionId guidance");
    assert.ok(prompt.includes("oracle") && prompt.includes("hephaestus"), "prompt missing role summary");
    assert.ok(prompt.includes("a-stand"), "prompt missing a-stand server name");
  }
  console.log(`   ok: client=${cursorClient.id} setup bundle prompts contain URL+token+bridge command`);

  log("4. Real Streamable HTTP MCP handshake (cursor auto-match + totalCalls)");
  const beforeCalls = (await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() }))
    .json.clients.find((c) => c.id === cursorClient.id).totalCalls;
  const httpSession = await withTimeout(
    runMcpHandshake(cursorToken, "Cursor"),
    STEP_TIMEOUT_MS,
    "http mcp handshake"
  );
  const afterCursor = await withTimeout(
    request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() }),
    STEP_TIMEOUT_MS,
    "state after mcp"
  );
  const cursorAfter = afterCursor.json.clients.find((c) => c.id === cursorClient.id);
  assert.equal(cursorAfter.status, "connected", `expected connected, got ${cursorAfter.status}`);
  assert.equal(cursorAfter.iconKey, "cursor", `expected cursor icon, got ${cursorAfter.iconKey}`);
  assert.equal(cursorAfter.detectedClientName, "Cursor");
  assert.equal(cursorAfter.transport, "http");
  assert.ok(cursorAfter.firstSeenAt, "firstSeenAt not set");
  assert.ok(cursorAfter.lastSeenAt, "lastSeenAt not set");
  // Only real tool invocations count (initialize / tools/list are not calls).
  assert.equal(cursorAfter.totalCalls, beforeCalls + 1, `expected ${beforeCalls + 1} calls, got ${cursorAfter.totalCalls}`);
  assert.ok(httpSession.sessionId);
  // A second tool call on the same session must increment again.
  const secondCall = await mcpPost(
    cursorToken,
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "agent_relay_session", arguments: { action: "status" } } },
    httpSession.sessionId,
    { "mcp-protocol-version": "2025-06-18" }
  );
  assert.equal(secondCall.status, 200);
  const afterSecond = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
  const cursorSecond = afterSecond.json.clients.find((c) => c.id === cursorClient.id);
  assert.equal(cursorSecond.totalCalls, beforeCalls + 2, `expected ${beforeCalls + 2} calls, got ${cursorSecond.totalCalls}`);
  // Session hijack protection: another client's token cannot reuse this session.
  const otherCreated = await request(daemonInfo.port, "POST", "/api/clients", {
    headers: uiHeaders(),
    body: { label: "Other Client" },
  });
  const hijack = await mcpPost(
    otherCreated.json.token,
    { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} },
    httpSession.sessionId,
    { "mcp-protocol-version": "2025-06-18" }
  );
  assert.equal(hijack.status, 403, `session hijack should be rejected with 403, got ${hijack.status}`);
  await request(daemonInfo.port, "DELETE", `/api/clients/${otherCreated.json.client.id}`, { headers: uiHeaders() });
  console.log(`   ok: session=${httpSession.sessionId} icon=${cursorAfter.iconKey} calls=${cursorSecond.totalCalls}`);

  log("5. Paused client -> 403, invalid token -> 401");
  const paused = await withTimeout(
    request(daemonInfo.port, "PATCH", `/api/clients/${cursorClient.id}`, {
      headers: uiHeaders(),
      body: { enabled: false },
    }),
    STEP_TIMEOUT_MS,
    "pause client"
  );
  assert.equal(paused.status, 200);
  assert.equal(paused.json.client.status, "paused");
  assert.equal(paused.json.client.enabled, false);
  const pausedInit = await mcpPost(cursorToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Cursor", version: "1" } },
  });
  assert.equal(pausedInit.status, 403, `paused client should get 403, got ${pausedInit.status}`);
  assert.equal(pausedInit.json.error.code, -32001);
  const invalidInit = await mcpPost("ast_00000000000000000000000000000000", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Cursor", version: "1" } },
  });
  assert.equal(invalidInit.status, 401, `invalid token should get 401, got ${invalidInit.status}`);
  const resumed = await request(daemonInfo.port, "PATCH", `/api/clients/${cursorClient.id}`, {
    headers: uiHeaders(),
    body: { enabled: true },
  });
  assert.equal(resumed.json.client.status, "connected", "re-enabled client should return to connected");
  console.log("   ok: 403 paused, 401 invalid, re-enable restores connected");

  log("6. Real child-process dist/stdio-bridge.mjs (codex auto-match, EOF leaves daemon alive)");
  const codexCreated = await withTimeout(
    request(daemonInfo.port, "POST", "/api/clients", { headers: uiHeaders(), body: { label: "Codex Bridge" } }),
    STEP_TIMEOUT_MS,
    "create codex client"
  );
  const codexClient = codexCreated.json.client;
  const codexToken = codexCreated.json.token;
  const bridge = startBridge(daemonInfo.mcpUrl, codexToken);
  try {
    bridge.send({
      jsonrpc: "2.0",
      id: 101,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "codex_cli", version: "0.9.1" },
      },
    });
    const initMsg = await bridge.waitFor(101);
    assert.ok(initMsg.result, `bridge initialize failed: ${JSON.stringify(initMsg).slice(0, 300)}`);

    bridge.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    bridge.send({ jsonrpc: "2.0", id: 102, method: "tools/list", params: {} });
    const listMsg = await bridge.waitFor(102);
    const bridgeTools = (listMsg.result?.tools || []).map((t) => t.name).sort();
    assert.deepEqual(bridgeTools, [
      "agent_relay_ask",
      "agent_relay_poll",
      "agent_relay_review",
      "agent_relay_session",
    ]);

    // One real tool call over the bridge so recordCall(transportKind="stdio-bridge") is exercised.
    bridge.send({
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: { name: "agent_relay_session", arguments: { action: "status" } },
    });
    const bridgeCall = await bridge.waitFor(103);
    assert.ok(bridgeCall.result, `bridge tools/call failed: ${JSON.stringify(bridgeCall).slice(0, 300)}`);

    await waitFor(async () => {
      const state = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
      const row = state.json.clients.find((c) => c.id === codexClient.id);
      return row?.status === "connected" && row?.transport === "stdio-bridge";
    }, STEP_TIMEOUT_MS, "codex bridge handshake recorded");

    const state = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
    const codexRow = state.json.clients.find((c) => c.id === codexClient.id);
    assert.equal(codexRow.iconKey, "codex", `expected codex icon, got ${codexRow.iconKey}`);
    assert.equal(codexRow.transport, "stdio-bridge");
    assert.equal(codexRow.status, "connected");
    assert.equal(codexRow.detectedClientName, "codex_cli");
    assert.equal(codexRow.totalCalls, 1, `expected exactly 1 bridged tool call, got ${codexRow.totalCalls}`);

    bridge.closeStdin();
    const exitCode = await withTimeout(bridge.exited, STEP_TIMEOUT_MS, "bridge exit");
    assert.equal(exitCode, 0, `bridge should exit 0 on stdin EOF, got ${exitCode}`);
    // The resident daemon must survive the bridge closing.
    await new Promise((r) => setTimeout(r, 400));
    const healthAfter = await withTimeout(
      request(daemonInfo.port, "GET", "/api/health"),
      STEP_TIMEOUT_MS,
      "health after bridge EOF"
    );
    assert.equal(healthAfter.status, 200, "daemon died after bridge EOF");
    assert.equal(healthAfter.json.ok, true);
    assert.equal(healthAfter.json.pid, health.json.pid, "daemon pid changed after bridge EOF");
    console.log(`   ok: codex icon matched, bridge exit=${exitCode}, daemon pid=${healthAfter.json.pid} still alive`);
  } finally {
    try {
      bridge.child.kill();
    } catch {}
  }

  log("7. SSE /api/events state_changed on client update");
  const events = [];
  const sse = await withTimeout(
    openSse(daemonInfo.port, daemonInfo.uiToken, (payload) => events.push(payload)),
    STEP_TIMEOUT_MS,
    "sse open"
  );
  try {
    await new Promise((r) => setTimeout(r, 150));
    const ssePatch = await request(daemonInfo.port, "PATCH", `/api/clients/${codexClient.id}`, {
      headers: uiHeaders(),
      body: { customName: "Codex SSE" },
    });
    assert.equal(ssePatch.status, 200);
    await waitFor(() => events.some((e) => /client_updated|client_changed/.test(e.reason || "")), STEP_TIMEOUT_MS, "state_changed event");
    const evt = events.find((e) => /client_updated|client_changed/.test(e.reason || ""));
    assert.equal(typeof evt.ts, "number");
    console.log(`   ok: SSE event reason=${evt.reason} ts=${evt.ts}`);
  } finally {
    sse.close();
  }

  log("8. Client delete + job detail route");
  const jobDetail = await request(daemonInfo.port, "GET", "/api/jobs/job_does_not_exist", { headers: uiHeaders() });
  assert.equal(jobDetail.status, 200);
  assert.equal(jobDetail.json.ok, false);
  const deleted = await request(daemonInfo.port, "DELETE", `/api/clients/${codexClient.id}`, { headers: uiHeaders() });
  assert.equal(deleted.status, 200);
  const finalState = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
  assert.ok(!finalState.json.clients.some((c) => c.id === codexClient.id), "deleted client still listed");
  const deletedTokenInit = await mcpPost(codexToken, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "codex", version: "1" } },
  });
  assert.equal(deletedTokenInit.status, 401, "deleted client token should be rejected");
  const missingSetup = await request(daemonInfo.port, "GET", "/api/clients/cli_ffffffffffff/setup", { headers: uiHeaders() });
  assert.equal(missingSetup.status, 404);
  console.log("   ok: delete revokes token, 404 for unknown client setup");

  log("9. Skills & Extensions CRUD + built-in guardrails + local SKILL.md import + compileForRole");
  const { ExtensionRegistry, compileRoleExtensionsPrompt } = await import("../src/core/extensions.mjs");

  const extList = await withTimeout(
    request(daemonInfo.port, "GET", "/api/extensions", { headers: uiHeaders() }),
    STEP_TIMEOUT_MS,
    "extensions list"
  );
  assert.equal(extList.status, 200);
  assert.equal(extList.json.ok, true);
  const seeded = extList.json.items;
  assert.equal(seeded.length, 2, `expected 2 seeded built-ins, got ${seeded.length}`);
  const modular = seeded.find((item) => item.id === "builtin-modular-files");
  const integrity = seeded.find((item) => item.id === "builtin-test-integrity");
  assert.ok(modular && integrity, "built-in guardrails missing");
  assert.equal(modular.kind, "skill");
  assert.equal(modular.builtin, true);
  assert.equal(modular.mountMode, "inject");
  assert.deepEqual(modular.roles, ["hephaestus"]);
  assert.deepEqual(integrity.roles, ["oracle", "hephaestus"]);
  assert.match(modular.content, /500 行/);
  assert.match(integrity.content, /断言/);

  // Persisted atomically as { version: 1, items: [...] }.
  const extStore = path.join(DATA_DIR, "extensions.json");
  assert.ok(fs.existsSync(extStore), "extensions.json was not written");
  const extDisk = JSON.parse(fs.readFileSync(extStore, "utf8"));
  assert.equal(extDisk.version, 1);
  assert.ok(Array.isArray(extDisk.items));

  // /api/state exposes the registry.
  const stateWithExt = await request(daemonInfo.port, "GET", "/api/state", { headers: uiHeaders() });
  assert.ok(stateWithExt.json.extensions, "state payload missing extensions block");
  assert.equal(stateWithExt.json.extensions.items.length, 2);
  assert.equal(stateWithExt.json.extensions.counts.active, 2);

  // Create a template + an MCP entry (secrets in the body must never be persisted).
  const templateCreated = await request(daemonInfo.port, "POST", "/api/extensions", {
    headers: uiHeaders(),
    body: {
      kind: "template",
      name: "Review Checklist",
      description: "Reusable review checklist",
      roles: ["oracle"],
      mountMode: "inject",
      content: "1. Check boundaries\n2. Check null/async",
    },
  });
  assert.equal(templateCreated.status, 200, `create template failed: ${templateCreated.text.slice(0, 300)}`);
  const templateItem = templateCreated.json.item;
  assert.match(templateItem.id, /^ext_[0-9a-f]{12}$/);
  assert.equal(templateItem.enabled, true);
  assert.equal(templateItem.builtin, false);
  assert.ok(templateCreated.json.state?.extensions, "create response missing state");

  const mcpCreated = await request(daemonInfo.port, "POST", "/api/extensions", {
    headers: uiHeaders(),
    body: {
      kind: "mcp",
      name: "Docs MCP",
      description: "Docs server",
      roles: ["hephaestus"],
      transport: "stdio",
      command: "npx",
      args: ["-y", "@acme/docs-mcp"],
      envKeys: ["DOCS_TOKEN"],
      apiKey: ["sk", "should", "never", "be", "stored"].join("-"),
      token: "ast_should_never_be_stored",
    },
  });
  assert.equal(mcpCreated.status, 200, `create mcp failed: ${mcpCreated.text.slice(0, 300)}`);
  assert.equal(mcpCreated.json.item.transport, "stdio");
  assert.deepEqual(mcpCreated.json.item.args, ["-y", "@acme/docs-mcp"]);
  assert.deepEqual(mcpCreated.json.item.envKeys, ["DOCS_TOKEN"]);
  assert.equal(mcpCreated.json.item.apiKey, undefined);
  const mcpDisk = fs.readFileSync(extStore, "utf8");
  assert.ok(!mcpDisk.includes(["sk", "should", "never", "be", "stored"].join("-")), "raw secret leaked into extensions.json");
  assert.ok(!mcpDisk.includes("ast_should_never_be_stored"), "raw token leaked into extensions.json");

  // PATCH toggles enabled + edits roles/mountMode/content.
  const patchedExt = await request(daemonInfo.port, "PATCH", `/api/extensions/${templateItem.id}`, {
    headers: uiHeaders(),
    body: { enabled: false, roles: ["oracle", "hephaestus"], mountMode: "path_index" },
  });
  assert.equal(patchedExt.status, 200);
  assert.equal(patchedExt.json.item.enabled, false);
  assert.deepEqual(patchedExt.json.item.roles, ["oracle", "hephaestus"]);
  assert.equal(patchedExt.json.item.mountMode, "path_index");

  // Re-enable it as an oracle-only inject so compileForRole can be asserted precisely.
  const reEnabled = await request(daemonInfo.port, "PATCH", `/api/extensions/${templateItem.id}`, {
    headers: uiHeaders(),
    body: { enabled: true, roles: ["oracle"], mountMode: "inject" },
  });
  assert.equal(reEnabled.status, 200);
  assert.equal(reEnabled.json.item.enabled, true);
  assert.deepEqual(reEnabled.json.item.roles, ["oracle"]);
  assert.equal(reEnabled.json.item.mountMode, "inject");

  // Local SKILL.md import: folder path with frontmatter + long body → auto path_index.
  const skillDir = path.join(DATA_DIR, "demo-skill");
  fs.mkdirSync(skillDir, { recursive: true });
  const longBody = `# Demo\n\n${"Long skill guidance line.\n".repeat(80)}`;
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: Demo Imported Skill\ndescription: imported from folder\n---\n${longBody}`,
    "utf8"
  );
  const imported = await request(daemonInfo.port, "POST", "/api/extensions/import-skill", {
    headers: uiHeaders(),
    body: { path: skillDir, roles: ["oracle"] },
  });
  assert.equal(imported.status, 200, `import failed: ${imported.text.slice(0, 300)}`);
  assert.equal(imported.json.item.kind, "skill");
  assert.equal(imported.json.item.name, "Demo Imported Skill");
  assert.equal(imported.json.item.description, "imported from folder");
  assert.equal(imported.json.item.mountMode, "path_index", "long SKILL.md should auto-recommend path_index");
  assert.equal(imported.json.item.sourcePath, path.join(skillDir, "SKILL.md"));
  assert.ok(!imported.json.item.content.includes("name: Demo Imported Skill"), "frontmatter should not be stored");

  // Direct .md file path also works; a short file recommends inject.
  const shortSkill = path.join(DATA_DIR, "short-skill.md");
  fs.writeFileSync(shortSkill, "# Short\n\nBe concise.\n", "utf8");
  const importedFile = await request(daemonInfo.port, "POST", "/api/extensions/import-skill", {
    headers: uiHeaders(),
    body: { path: shortSkill, roles: ["hephaestus"], mountMode: "inject" },
  });
  assert.equal(importedFile.status, 200, `file import failed: ${importedFile.text.slice(0, 300)}`);
  assert.equal(importedFile.json.item.mountMode, "inject");
  assert.deepEqual(importedFile.json.item.roles, ["hephaestus"]);

  // Missing path → 400 with a friendly error (never a 500).
  const badImport = await request(daemonInfo.port, "POST", "/api/extensions/import-skill", {
    headers: uiHeaders(),
    body: { path: path.join(DATA_DIR, "does-not-exist") },
  });
  assert.equal(badImport.status, 400, `missing path should be 400, got ${badImport.status}`);
  assert.equal(badImport.json.ok, false);
  assert.match(badImport.json.error, /不存在|not found/i);

  // compileForRole: inject + path_index + MCP summary, and role filtering.
  const registry = new ExtensionRegistry(DATA_DIR);
  const oracleCompiled = registry.compileForRole("oracle");
  assert.ok(oracleCompiled.injectedText.includes("测试防作弊护栏"), "oracle inject missing built-in");
  assert.ok(oracleCompiled.injectedText.includes("Review Checklist"), "oracle inject missing template");
  assert.ok(oracleCompiled.indexLines.some((line) => line.includes("Demo Imported Skill")), "path_index line missing");
  assert.ok(oracleCompiled.indexLines.some((line) => line.includes("SKILL.md")), "path_index line missing sourcePath");
  assert.equal(oracleCompiled.mcpNames.length, 0, "oracle should not see the hephaestus MCP entry");
  assert.equal(oracleCompiled.activeCount, 3, `expected 3 mounted oracle items, got ${oracleCompiled.activeCount}`);

  const hepCompiled = registry.compileForRole("hephaestus");
  assert.ok(hepCompiled.injectedText.includes("单文件红线与模块化"), "hephaestus inject missing modular guardrail");
  assert.ok(hepCompiled.injectedText.includes("Short"), "hephaestus inject missing imported short skill");
  assert.deepEqual(hepCompiled.mcpNames, ["Docs MCP"], "hephaestus MCP summary missing");
  assert.ok(!hepCompiled.injectedText.includes("Review Checklist"), "oracle-only template leaked into hephaestus");
  assert.ok(hepCompiled.injectedChars <= 6_000, "injected budget exceeded");

  assert.equal(compileRoleExtensionsPrompt(registry, "oracle"), oracleCompiled.promptText);
  assert.equal(compileRoleExtensionsPrompt(null, "oracle"), "");

  // Total inject cap: many long skills must stay <= 6000 chars.
  for (let i = 0; i < 6; i++) {
    await request(daemonInfo.port, "POST", "/api/extensions", {
      headers: uiHeaders(),
      body: {
        kind: "skill",
        name: `Bulk ${i}`,
        roles: ["oracle"],
        mountMode: "inject",
        content: "B".repeat(1_900),
      },
    });
  }
  const capped = new ExtensionRegistry(DATA_DIR).compileForRole("oracle");
  assert.ok(capped.injectedChars <= 6_000, `inject cap exceeded: ${capped.injectedChars}`);
  assert.ok(capped.indexLines.length > 0, "overflow skills should degrade to index lines");

  // DELETE is permanent: reloading the registry must not resurrect built-ins.
  const deletedIntegrity = await request(daemonInfo.port, "DELETE", `/api/extensions/${integrity.id}`, {
    headers: uiHeaders(),
  });
  assert.equal(deletedIntegrity.status, 200);
  const afterDelete = await request(daemonInfo.port, "GET", "/api/extensions", { headers: uiHeaders() });
  assert.ok(!afterDelete.json.items.some((item) => item.id === integrity.id), "deleted built-in still listed");
  const reloaded = new ExtensionRegistry(DATA_DIR);
  assert.ok(!reloaded.get(integrity.id), "deleted built-in was re-seeded");
  const missingDelete = await request(daemonInfo.port, "DELETE", "/api/extensions/ext_ffffffffffff", {
    headers: uiHeaders(),
  });
  assert.equal(missingDelete.status, 404);
  console.log(
    `   ok: seeded=${seeded.length} imported=${imported.json.item.id} oracleActive=${oracleCompiled.activeCount} ` +
      `injectChars=${capped.injectedChars} mcp=${hepCompiled.mcpNames.join(",")}`
  );

  log("10. Sanitized diagnostic bundle export (secrets excluded + redacted)");
  const fixtureJobId = "job_diagfixture";
  const fakeApiKey = ["sk", "diag", "leak", "test"].join("-") + "-" + Date.now().toString(36);
  const fakeClientToken = ["ast", "client", "diag", "leak"].join("_") + "_" + Date.now().toString(36);
  const jobsDir = path.join(DATA_DIR, "jobs");
  const outputsDir = path.join(DATA_DIR, "outputs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobsDir, `${fixtureJobId}.status.json`),
    JSON.stringify({
      jobId: fixtureJobId,
      role: "hephaestus",
      modelId: "diag-model",
      engine: "codex",
      status: "failed",
      error: `upstream rejected credential apiKey=${fakeApiKey}`,
      startedAt: Date.now() - 1000,
      finishedAt: Date.now(),
    }),
    "utf8"
  );
  fs.writeFileSync(
    path.join(jobsDir, `${fixtureJobId}.log`),
    [
      `Authorization: Bearer ${fakeApiKey}`,
      JSON.stringify({ apiKey: fakeApiKey, clientToken: fakeClientToken }),
      "normal diagnostic line",
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(jobsDir, `${fixtureJobId}.checkpoint.json`),
    JSON.stringify({ jobId: fixtureJobId, secret: fakeClientToken, note: "checkpoint" }),
    "utf8"
  );
  fs.writeFileSync(path.join(outputsDir, `${fixtureJobId}.txt`), `output token=${fakeClientToken}\n`, "utf8");
  fs.appendFileSync(
    path.join(DATA_DIR, "telemetry.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), jobId: fixtureJobId, cacheReported: false, usageSkipReason: "no-projection-record", secret: fakeApiKey }) + "\n",
    "utf8"
  );
  const settingsFile = path.join(DATA_DIR, "settings.json");
  const settingsOnDisk = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  settingsOnDisk.apiKey = fakeApiKey;
  settingsOnDisk.nested = { apiKey: fakeApiKey, keep: "safe" };
  fs.writeFileSync(settingsFile, JSON.stringify(settingsOnDisk, null, 2), "utf8");

  const noAuthExport = await request(daemonInfo.port, "POST", "/api/diagnostics/export", { body: { reveal: false } });
  assert.equal(noAuthExport.status, 401, `diagnostics export must require UI token, got ${noAuthExport.status}`);
  const exportRes = await withTimeout(
    request(daemonInfo.port, "POST", "/api/diagnostics/export", {
      headers: uiHeaders(),
      body: { reveal: false, maxJobs: 5 },
    }),
    20_000,
    "diagnostics export"
  );
  assert.equal(exportRes.status, 200, `diagnostics export failed: ${exportRes.status} ${exportRes.text.slice(0, 400)}`);
  assert.equal(exportRes.json.ok, true);
  assert.match(exportRes.json.fileName, /^Astand_diag_\d{4}-\d{2}-\d{2}_\d{6}\.zip$/);
  assert.equal(exportRes.json.zipPath, path.join(DATA_DIR, "diagnostics", exportRes.json.fileName));
  assert.ok(fs.existsSync(exportRes.json.zipPath), "diagnostics zip was not created");
  assert.ok(exportRes.json.sizeBytes > 0, "diagnostics zip is empty");
  assert.ok(exportRes.json.includedJobs >= 1, "fixture job was not included");

  const extractDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "astand-diag-extract-")), "out");
  try {
    extractZip(exportRes.json.zipPath, extractDir);
    const files = walkFiles(extractDir);
    const names = files.map((file) => path.relative(extractDir, file).split(path.sep).join("/"));
    assert.ok(names.some((name) => name.endsWith("SECRETS_EXCLUDED.txt")), "SECRETS_EXCLUDED.txt missing");
    assert.ok(names.some((name) => name.endsWith("00-DIAGNOSTIC-SUMMARY.md")), "00-DIAGNOSTIC-SUMMARY.md missing");
    assert.ok(names.some((name) => name.endsWith(`${fixtureJobId}.log`)), "recent job log missing");
    assert.ok(names.some((name) => name.endsWith(`${fixtureJobId}.status.json`)), "recent job status missing");
    assert.ok(names.some((name) => name.endsWith(`outputs/${fixtureJobId}.txt`)), "recent job output missing");

    const text = files
      .filter((file) => /\.(md|txt|json|jsonl|log)$/i.test(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    assert.ok(!text.includes(fakeApiKey), "raw API key leaked into the diagnostic bundle");
    assert.ok(!text.includes(fakeClientToken), "raw client token leaked into the diagnostic bundle");
    assert.ok(!/Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/=-]{16,}/.test(text), "unredacted Bearer credential leaked");

    const exportedSettings = JSON.parse(fs.readFileSync(files.find((file) => file.endsWith("settings.json")), "utf8"));
    assert.equal(exportedSettings.apiKey, undefined, "settings.json apiKey was not stripped");
    assert.equal(exportedSettings.nested?.apiKey, undefined, "nested settings apiKey was not stripped");
    assert.equal(exportedSettings.nested?.keep, "safe", "unrelated settings were dropped");

    const summary = fs.readFileSync(files.find((file) => file.endsWith("00-DIAGNOSTIC-SUMMARY.md")), "utf8");
    assert.match(summary, /# A\.stand Diagnostic Bundle/);
    assert.match(summary, /Cache turns unreported: [1-9]/);
    assert.match(summary, /Last failed \/ errored jobs[\s\S]*job_diagfixture/, "failed job missing from summary");
    const notice = fs.readFileSync(files.find((file) => file.endsWith("SECRETS_EXCLUDED.txt")), "utf8");
    assert.match(notice, /secrets\.json/);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
  console.log(`   ok: ${exportRes.json.fileName} (${exportRes.json.sizeBytes} bytes, jobs=${exportRes.json.includedJobs}) zero secret leakage`);

  console.log("\nALL v2 DAEMON E2E CHECKS PASSED!");
}

const overallTimer = setTimeout(() => {
  console.error(`\nFATAL: overall timeout after ${OVERALL_TIMEOUT_MS}ms`);
  cleanup();
  process.exit(1);
}, OVERALL_TIMEOUT_MS);
overallTimer.unref?.();

function cleanup() {
  for (const child of children) {
    try {
      if (!child.killed) child.kill();
    } catch {}
  }
}

try {
  await main();
  cleanup();
  clearTimeout(overallTimer);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  console.error("\nv2 DAEMON E2E FAILED:", err?.stack || err?.message || String(err));
  cleanup();
  clearTimeout(overallTimer);
  try {
    if (daemonProc) daemonProc.kill();
  } catch {}
  process.exit(1);
}
