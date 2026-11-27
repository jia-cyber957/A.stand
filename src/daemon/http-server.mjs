import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { API_PROVIDERS, CLI_ENGINES_META, PLUGIN_VERSION } from "../core/constants.mjs";
import { CLIENT_PRESETS } from "../core/clients.mjs";
import { appendDaemonEvent, exportSanitizedDiagnostics, openInExplorer } from "../core/diagnostics.mjs";
import {
  cancelAllCliLogins,
  cancelCliLogin,
  getAllCliLoginStatuses,
  getCliLoginStatus,
  reopenCliLoginBrowser,
  startCliLogin,
} from "../core/cli-login.mjs";
import {
  cancelAllCliInstalls,
  cancelCliInstall,
  checkUpdates,
  getCliInstallStatus,
  startCliInstall,
} from "../core/cli-install.mjs";
import {
  probeCliAccountInfo,
  resolveProfileDir,
  supportsMultiAccountIsolation,
} from "../core/cli-profiles.mjs";
import { findExtensibleCliDef } from "../core/cli-registry.mjs";
import { detectEngines } from "../core/paths.mjs";
import { createRelayMcpServer } from "./mcp-factory.mjs";

const DEFAULT_PORT = 3426;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SSE_PING_MS = 20_000;
const BROADCAST_THROTTLE_MS = 250;
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^http:\/\/localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/i,
  /^http:\/\/tauri\.localhost$/i,
  /^https:\/\/tauri\.localhost$/i,
];

function isAllowedHost(hostHeader) {
  const value = String(hostHeader || "").trim().toLowerCase();
  if (!value) return false;
  return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(value);
}

function isAllowedOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return true; // Non-browser clients (curl / MCP SDK) omit Origin.
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(value));
}

function timingSafeEqualString(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJsonRpcError(res, status, message, code = -32001) {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null });
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish({ ok: false, status: 413, error: "Request body too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return finish({ ok: true, value: undefined });
      try {
        finish({ ok: true, value: JSON.parse(text) });
      } catch {
        finish({ ok: false, status: 400, error: "Invalid JSON body" });
      }
    });
    req.on("error", () => finish({ ok: false, status: 400, error: "Request stream error" }));
    req.on("aborted", () => finish({ ok: false, status: 400, error: "Request aborted" }));
  });
}

function parseBooleanFlag(value) {
  return value === "1" || value === "true" || value === "yes";
}

function splitPath(urlPath) {
  try {
    return urlPath.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    const err = new Error("Invalid path encoding");
    err.status = 400;
    throw err;
  }
}

const SESSION_IDLE_TTL_MS = 30 * 60_000;
const SESSION_SWEEP_MS = 60_000;
const MAX_SESSIONS = 256;

/**
 * Local daemon HTTP surface:
 *   /mcp      Streamable HTTP MCP endpoint (per-client bearer token auth)
 *   /api/*    Local REST + SSE console API (uiToken protected)
 *   /         Static desktop UI
 */
export async function createDaemonHttpServer({
  store,
  telemetry,
  orchestrator,
  clientRegistry,
  extensionRegistry = null,
  port = Number(process.env.ASTAND_PORT || DEFAULT_PORT),
  host = "127.0.0.1",
  uiToken,
  desktopHtmlPath,
  bridgeScript,
  rulesFile,
  skillsFile,
  version = PLUGIN_VERSION,
} = {}) {
  if (!store || !orchestrator || !clientRegistry) {
    throw new Error("createDaemonHttpServer requires store, orchestrator and clientRegistry");
  }
  const listenHost = "127.0.0.1"; // Never bind a LAN/public interface.
  const resolvedUiToken = uiToken || crypto.randomBytes(24).toString("hex");
  const startedAt = new Date().toISOString();
  const htmlPath = desktopHtmlPath || path.resolve(process.cwd(), "dist", "desktop.html");
  const resolvedBridge = bridgeScript || path.resolve(process.cwd(), "dist", "stdio-bridge.mjs");
  const resolvedRules = rulesFile || path.resolve(process.cwd(), "plugin", "rules", "AGENTS.md");
  const resolvedSkills = skillsFile || path.resolve(process.cwd(), "plugin", "skills", "agent-relay", "SKILL.md");

  const sessions = new Map(); // mcp-session-id -> { transport, server, clientId, transportKind, lastUsedAt }
  const sseClients = new Set();
  let broadcastTimer = null;
  let pendingReasons = new Set();
  let actualPort = Number(port);
  let closed = false;

  const mcpUrl = () => `http://${listenHost}:${actualPort}/mcp`;

  function broadcast(reason) {
    if (closed) return;
    pendingReasons.add(String(reason || "state_changed"));
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      const reasons = [...pendingReasons];
      pendingReasons = new Set();
      const payload = `event: state_changed\ndata: ${JSON.stringify({ reason: reasons.join(","), ts: Date.now() })}\n\n`;
      for (const res of sseClients) {
        try {
          res.write(payload);
        } catch {
          sseClients.delete(res);
        }
      }
    }, BROADCAST_THROTTLE_MS);
    broadcastTimer.unref?.();
  }

  const unsubscribeRegistry = clientRegistry.subscribe?.((evt) => broadcast(evt?.reason || "client_changed"));
  const unsubscribeOrchestrator = orchestrator.subscribe?.(() => broadcast("orchestrator_state"));

  function requireUiToken(req, url) {
    const headerToken = req.headers["x-astand-ui-token"];
    const queryToken = url.searchParams.get("uiToken") || "";
    const provided = typeof headerToken === "string" && headerToken ? headerToken : queryToken;
    if (!provided) return { ok: false, error: "Missing X-Astand-UI-Token" };
    if (!timingSafeEqualString(provided, resolvedUiToken)) return { ok: false, error: "Invalid UI token" };
    return { ok: true };
  }

  function extractMcpToken(req, url) {
    const auth = req.headers.authorization;
    if (typeof auth === "string") {
      const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
      if (match) return match[1].trim();
    }
    const headerToken = req.headers["x-astand-token"];
    if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
    return url.searchParams.get("token") || "";
  }

  async function buildStatePayload(forceDetect, fetchRateLimits) {
    const dashboard = await orchestrator.getDashboardState(forceDetect, fetchRateLimits);
    return {
      version,
      dataDir: store.dataDir,
      daemon: {
        host: listenHost,
        port: actualPort,
        mcpUrl: mcpUrl(),
        bridgeScript: resolvedBridge,
        rulesFile: resolvedRules,
        startedAt,
      },
      providers: API_PROVIDERS,
      cliEnginesMeta: CLI_ENGINES_META,
      ...dashboard,
      extensions: extensionRegistry?.getPublicState?.() || dashboard.extensions || { version: 1, items: [], counts: {} },
      perf: typeof orchestrator.getPerfSummary === "function" ? orchestrator.getPerfSummary() : null,
      clients: clientRegistry.listPublic(),
      clientPresets: CLIENT_PRESETS,
      cliLogins: getAllCliLoginStatuses(),
    };
  }

  const dataDirHash = crypto.createHash("sha256").update(path.resolve(store.dataDir || "")).digest("hex").slice(0, 16);

  function closeSessionEntry(entry) {
    try {
      entry?.server?.close?.()?.catch?.(() => {});
    } catch {}
    try {
      entry?.transport?.close?.()?.catch?.(() => {});
    } catch {}
  }

  function registerSession({ transport, server, clientId, transportKind, sessionId }) {
    while (sessions.size >= MAX_SESSIONS) {
      let oldestId = null;
      let oldestTs = Infinity;
      for (const [sid, s] of sessions.entries()) {
        if (s.lastUsedAt < oldestTs) {
          oldestTs = s.lastUsedAt;
          oldestId = sid;
        }
      }
      if (!oldestId) break;
      const evicted = sessions.get(oldestId);
      sessions.delete(oldestId);
      closeSessionEntry(evicted);
    }
    sessions.set(sessionId, {
      transport,
      server,
      clientId,
      transportKind,
      lastUsedAt: Date.now(),
    });
    broadcast("client_session_opened");
  }

  function dropSession(sessionId, closeHandles = false) {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    sessions.delete(sessionId);
    if (closeHandles) closeSessionEntry(entry);
    broadcast("client_session_closed");
  }

  const logEvent = (type, detail = {}) => appendDaemonEvent(store.dataDir, { type, ...detail });

  const sessionSweeper = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_TTL_MS;
    for (const [sid, entry] of [...sessions.entries()]) {
      if (entry.lastUsedAt < cutoff) {
        logEvent("mcp_session_evicted", { sessionId: sid, clientId: entry.clientId, transport: entry.transportKind });
        dropSession(sid, true);
      }
    }
  }, SESSION_SWEEP_MS);
  sessionSweeper.unref?.();

  async function createSessionFor({ clientId, transportKind }) {
    const holder = { sessionId: "" };
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        holder.sessionId = sessionId;
        registerSession({ transport, server, clientId, transportKind, sessionId });
        logEvent("mcp_session_opened", { sessionId, clientId, transport: transportKind });
      },
    });
    transport.onclose = () => {
      if (holder.sessionId) {
        logEvent("mcp_session_closed", { sessionId: holder.sessionId, clientId, transport: transportKind });
        dropSession(holder.sessionId);
      }
    };
    const server = createRelayMcpServer({
      store,
      telemetry,
      orchestrator,
      clientRegistry,
      clientId,
      transportKind,
      onEvent: (reason) => broadcast(reason),
      onToolCall: (info) => logEvent("mcp_tool_call", info),
    });
    await server.connect(transport);
    return { transport, server };
  }

  function captureInitializeHandshake(body, clientId, transportKind) {
    const messages = Array.isArray(body) ? body : [body];
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      if (message.method !== "initialize") continue;
      const info = message.params?.clientInfo;
      if (!info || typeof info !== "object") continue;
      try {
        const updated = clientRegistry.recordHandshake(clientId, {
          name: typeof info.name === "string" ? info.name : "",
          version: typeof info.version === "string" ? info.version : "",
          transport: transportKind,
        });
        logEvent("client_handshake", {
          clientId,
          detectedClientName: info.name || "",
          detectedClientVersion: info.version || "",
          matchedIcon: updated?.iconKey || "generic",
          transport: transportKind,
        });
        broadcast("client_connected");
      } catch {}
    }
  }

  async function handleMcp(req, res, url) {
    const transportKind = req.headers["x-astand-transport"] === "stdio-bridge" ? "stdio-bridge" : "http";
    const auth = clientRegistry.authenticate(extractMcpToken(req, url));
    if (!auth.ok) {
      logEvent("mcp_auth_failed", {
        status: auth.status || 401,
        reason: auth.error || "Unauthorized",
        method: req.method,
        transport: transportKind,
      });
      sendJsonRpcError(res, auth.status || 401, auth.error || "Unauthorized");
      return;
    }
    const clientId = auth.client.id;
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader.trim() : "";

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body.ok) {
        sendJsonRpcError(res, body.status, body.error, body.status === 413 ? -32001 : -32700);
        return;
      }
      // Fallback handshake capture: some stateless clients never send `notifications/initialized`.
      captureInitializeHandshake(body.value, clientId, transportKind);

      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          sendJsonRpcError(res, 404, "Session not found");
          return;
        }
        if (session.clientId !== clientId) {
          sendJsonRpcError(res, 403, "Session belongs to a different A.stand client");
          return;
        }
        session.lastUsedAt = Date.now();
        session.transportKind = transportKind;
        await session.transport.handleRequest(req, res, body.value);
        return;
      }

      const { transport } = await createSessionFor({ clientId, transportKind });
      await transport.handleRequest(req, res, body.value);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!sessionId) {
        sendJsonRpcError(res, 400, "Mcp-Session-Id header is required");
        return;
      }
      const session = sessions.get(sessionId);
      if (!session) {
        sendJsonRpcError(res, 404, "Session not found");
        return;
      }
      if (session.clientId !== clientId) {
        sendJsonRpcError(res, 403, "Session belongs to a different A.stand client");
        return;
      }
      session.lastUsedAt = Date.now();
      await session.transport.handleRequest(req, res);
      if (req.method === "DELETE") dropSession(sessionId, true);
      return;
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    sendJsonRpcError(res, 405, "Method Not Allowed");
  }

  async function handleApi(req, res, url, segments) {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      sendJson(res, 403, { ok: false, error: "Origin not allowed" });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Astand-UI-Token, X-Astand-Token, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // /api/health stays unauthenticated so supervisors can probe liveness cheaply.
    if (req.method === "GET" && segments.length === 2 && segments[1] === "health") {
      sendJson(res, 200, { ok: true, version, pid: process.pid, dataDirHash });
      return;
    }

    const gate = requireUiToken(req, url);
    if (!gate.ok) {
      sendJson(res, 401, { ok: false, error: gate.error });
      return;
    }

    const [, resource, id, action] = segments;

    if (req.method === "POST" && resource === "diagnostics" && id === "export") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const input = body.value || {};
      const maxJobs = Math.max(1, Math.min(100, Number(input.maxJobs) || 15));
      const collectSecrets = (bag) =>
        bag && typeof bag === "object"
          ? Object.values(bag).filter((value) => typeof value === "string" && value.length >= 6)
          : [];
      const extraSecrets = [
        ...collectSecrets(store.secrets?.apiKeys),
        ...collectSecrets(store.secrets?.clientTokens),
      ];
      try {
        const result = await exportSanitizedDiagnostics({
          dataDir: store.dataDir,
          daemonInfo: { host: listenHost, port: actualPort, startedAt },
          version,
          maxJobs,
          extraSecrets,
        });
        let revealError = "";
        if (input.reveal === true && result.zipPath) {
          try {
            openInExplorer(result.zipPath, { dataDir: store.dataDir, selectFile: true });
          } catch (err) {
            revealError = err?.message || String(err);
          }
        }
        sendJson(res, 200, { ok: true, ...result, ...(revealError ? { revealError } : {}) });
      } catch (err) {
        sendJson(res, Number(err?.status) || 500, { ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (req.method === "POST" && resource === "diagnostics" && id === "open-logs") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const subdir = ["root", "jobs", "diagnostics"].includes(body.value?.subdir) ? body.value.subdir : "root";
      const target = subdir === "root" ? store.dataDir : path.join(store.dataDir, subdir);
      try {
        fs.mkdirSync(target, { recursive: true });
        openInExplorer(target, { dataDir: store.dataDir });
        sendJson(res, 200, { ok: true, path: target });
      } catch (err) {
        sendJson(res, Number(err?.status) || 500, { ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (req.method === "GET" && resource === "state") {
      const forceDetect = parseBooleanFlag(url.searchParams.get("forceDetect"));
      const fetchRateLimits = parseBooleanFlag(url.searchParams.get("fetchRateLimits"));
      sendJson(res, 200, await buildStatePayload(forceDetect, fetchRateLimits));
      return;
    }

    if (req.method === "GET" && resource === "events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write("retry: 3000\n\n");
      sseClients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(ping);
          sseClients.delete(res);
        }
      }, SSE_PING_MS);
      ping.unref?.();
      const cleanup = () => {
        clearInterval(ping);
        sseClients.delete(res);
      };
      req.on("close", cleanup);
      req.on("error", cleanup);
      res.on("close", cleanup);
      return;
    }

    if (req.method === "GET" && resource === "jobs" && id) {
      sendJson(res, 200, orchestrator.getJobDetail(id));
      return;
    }

    if (req.method === "POST" && resource === "ui-theme") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const theme = body.value?.theme === "dark" ? "dark" : body.value?.theme === "light" ? "light" : "";
      if (!theme) return sendJson(res, 400, { ok: false, error: "Invalid theme" });
      try {
        const themePath = path.join(store.dataDir, "ui-theme.txt");
        fs.mkdirSync(path.dirname(themePath), { recursive: true });
        fs.writeFileSync(themePath, `${theme}\n`, "utf8");
        sendJson(res, 200, { ok: true, theme });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err?.message || String(err) });
      }
      return;
    }

    if (resource === "clients") {
      const setupOpts = () => ({
        httpUrl: mcpUrl(),
        bridgeScript: resolvedBridge,
        rulesFile: resolvedRules,
        skillsFile: resolvedSkills,
      });
      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const created = clientRegistry.create(body.value || {});
        const setup = clientRegistry.buildSetupBundle(created.client.id, setupOpts());
        broadcast("client_created");
        sendJson(res, 201, {
          ok: true,
          ...created,
          setup,
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "GET" && id && action === "setup") {
        const bundle = clientRegistry.buildSetupBundle(id, setupOpts());
        if (!bundle) return sendJson(res, 404, { ok: false, error: "Client not found" });
        sendJson(res, 200, {
          ok: true,
          client: clientRegistry.getPublic(id),
          ...bundle,
          setup: bundle,
        });
        return;
      }
      if (req.method === "PATCH" && id) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const updated = clientRegistry.update(id, body.value || {});
        if (!updated) return sendJson(res, 404, { ok: false, error: "Client not found" });
        const setup = updated.token ? clientRegistry.buildSetupBundle(id, setupOpts()) : undefined;
        broadcast("client_updated");
        sendJson(res, 200, {
          ok: true,
          ...updated,
          ...(setup ? { setup } : {}),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "DELETE" && id) {
        const removed = clientRegistry.delete(id);
        if (!removed) return sendJson(res, 404, { ok: false, error: "Client not found" });
        broadcast("client_deleted");
        sendJson(res, 200, { ok: true, state: await buildStatePayload(false, false) });
        return;
      }
    }

    if (resource === "extensions") {
      const requireRegistry = () => {
        if (extensionRegistry) return true;
        sendJson(res, 503, { ok: false, error: "Extension registry is not available" });
        return false;
      };
      if (!requireRegistry()) return;

      // Registry validation errors carry a friendly message + HTTP status (400/404).
      // Without this mapping they would escape to the outer handler as a bare 500.
      const runRegistry = (fn) => {
        try {
          return { ok: true, value: fn() };
        } catch (err) {
          const status = Number(err?.status) || 500;
          sendJson(res, status, { ok: false, error: err?.message || String(err) });
          return { ok: false };
        }
      };

      if (req.method === "GET" && segments.length === 2) {
        sendJson(res, 200, { ok: true, ...extensionRegistry.getPublicState() });
        return;
      }

      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const result = runRegistry(() => extensionRegistry.upsert(body.value || {}));
        if (!result.ok) return;
        broadcast("extensions_changed");
        sendJson(res, 200, { ok: true, item: result.value, state: await buildStatePayload(false, false) });
        return;
      }

      if (req.method === "POST" && id === "import-skill") {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const input = body.value || {};
        const result = runRegistry(() =>
          extensionRegistry.importSkill(input.path, {
            roles: input.roles,
            mountMode: input.mountMode,
          })
        );
        if (!result.ok) return;
        broadcast("extensions_changed");
        sendJson(res, 200, { ok: true, item: result.value, state: await buildStatePayload(false, false) });
        return;
      }

      if (req.method === "PATCH" && id) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const result = runRegistry(() => extensionRegistry.update(id, body.value || {}));
        if (!result.ok) return;
        broadcast("extensions_changed");
        sendJson(res, 200, { ok: true, item: result.value, state: await buildStatePayload(false, false) });
        return;
      }

      if (req.method === "DELETE" && id) {
        const removed = extensionRegistry.delete(id);
        if (!removed) return sendJson(res, 404, { ok: false, error: "Extension not found" });
        broadcast("extensions_changed");
        sendJson(res, 200, { ok: true, state: await buildStatePayload(false, false) });
        return;
      }
    }

    if (req.method === "POST" && resource === "settings") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const settings = store.updateTopSettings(body.value || {});
      broadcast("settings_changed");
      sendJson(res, 200, { ok: true, settings, state: await buildStatePayload(false, false) });
      return;
    }

    if (req.method === "GET" && resource === "updates" && id === "check") {
      const customEngines = Array.isArray(store.settings?.customCliEngines) ? store.settings.customCliEngines : [];
      const detectedEngines = detectEngines(false, store.dataDir, customEngines);
      const result = await checkUpdates({
        currentVersion: version,
        detectedEngines,
        force: parseBooleanFlag(url.searchParams.get("force")),
      });
      sendJson(res, 200, result);
      return;
    }

    if (resource === "cli-engines") {
      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const result = store.upsertCustomCliEngine(body.value || {});
        if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });
        broadcast("state_changed");
        sendJson(res, 200, {
          ok: true,
          engine: result.engine,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "DELETE" && id && !action) {
        const deleted = store.deleteCustomCliEngine(id);
        if (!deleted) return sendJson(res, 404, { ok: false, error: "Custom CLI engine not found" });
        broadcast("state_changed");
        sendJson(res, 200, {
          ok: true,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (id && action === "install") {
        const subAction = segments[4] ? decodeURIComponent(segments[4]) : "";
        if (req.method === "GET" && !subAction) {
          sendJson(res, 200, { ok: true, install: getCliInstallStatus(id) });
          return;
        }
        if (req.method === "POST" && !subAction) {
          const body = await readJsonBody(req);
          if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
          const mode = body.value?.mode ?? "install";
          if (mode !== "install" && mode !== "update") {
            return sendJson(res, 400, { ok: false, error: 'mode must be "install" or "update"' });
          }
          const result = await startCliInstall({
            engineId: id,
            customEngines: Array.isArray(store.settings?.customCliEngines) ? store.settings.customCliEngines : [],
            mode,
            onUpdate: () => broadcast("cli_install"),
          });
          broadcast("state_changed");
          sendJson(res, result.ok ? 200 : 400, result);
          return;
        }
        if (req.method === "POST" && subAction === "cancel") {
          const cancelled = cancelCliInstall(id);
          broadcast("cli_install");
          sendJson(res, 200, cancelled);
          return;
        }
      }
      if (id && action === "whitelist" && req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const result = store.setCliModelWhitelist(id, body.value?.modelIds);
        if (!result.ok) return sendJson(res, 400, result);
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          engineId: id,
          modelIds: result.modelIds,
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (id && action === "accounts") {
        const profileId = segments[4] ? decodeURIComponent(segments[4]) : "";
        const isolated = supportsMultiAccountIsolation(id);
        const customEngines = Array.isArray(store.settings?.customCliEngines) ? store.settings.customCliEngines : [];
        const def = findExtensibleCliDef(id, customEngines) ||
          (CLI_ENGINES_META[id] ? { ...CLI_ENGINES_META[id], command: id } : null);

        if (req.method === "GET" && !profileId) {
          const account = def ? await probeCliAccountInfo(id, def, "") : null;
          sendJson(res, 200, {
            ok: true,
            engineId: id,
            supportsMultiAccountIsolation: isolated,
            profiles: store.getCliAccountProfiles(id),
            account,
          });
          return;
        }
        if (req.method === "POST" && !profileId) {
          const body = await readJsonBody(req);
          if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
          const result = store.addCliAccountProfile(id, body.value?.label);
          if (!result.ok) return sendJson(res, 400, result);
          broadcast("state_changed");
          sendJson(res, 200, {
            ok: true,
            engineId: id,
            profile: result.profile,
            profiles: store.getCliAccountProfiles(id),
          });
          return;
        }
        if (req.method === "PATCH" && profileId) {
          const body = await readJsonBody(req);
          if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
          const result = store.updateCliAccountProfile(id, profileId, body.value || {});
          if (!result.ok) return sendJson(res, 400, result);
          broadcast("state_changed");
          sendJson(res, 200, {
            ok: true,
            engineId: id,
            profile: result.profile,
            profiles: store.getCliAccountProfiles(id),
          });
          return;
        }
        if (req.method === "DELETE" && profileId) {
          const result = store.deleteCliAccountProfile(id, profileId);
          if (!result.ok) return sendJson(res, result.error === "Account profile not found" ? 404 : 400, result);
          if (isolated && profileId !== "default") {
            try {
              fs.rmSync(resolveProfileDir(store.dataDir, id, profileId), { recursive: true, force: true });
            } catch {}
          }
          broadcast("state_changed");
          sendJson(res, 200, {
            ok: true,
            engineId: id,
            profiles: store.getCliAccountProfiles(id),
          });
          return;
        }
      }
      if (id && action === "login") {
        const subAction = segments[4] ? decodeURIComponent(segments[4]) : "";
        if (req.method === "GET" && !subAction) {
          sendJson(res, 200, { ok: true, login: getCliLoginStatus(id) });
          return;
        }
        if (req.method === "POST" && !subAction) {
          const body = await readJsonBody(req);
          if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
          const region = body.value?.region === "global" ? "global" : "cn";
          const requestedProfile = String(body.value?.profileId || "").trim();
          const isolated = supportsMultiAccountIsolation(id);
          let profileId = isolated ? requestedProfile || "default" : "";
          let profileDir = "";
          if (profileId) {
            const profile = store.getCliAccountProfiles(id).find((item) => item.id === profileId);
            if (!profile) return sendJson(res, 400, { ok: false, error: "Account profile not found" });
            if (!profile.enabled) return sendJson(res, 400, { ok: false, error: "Account profile is disabled" });
            if (profileId !== "default") {
              try {
                profileDir = resolveProfileDir(store.dataDir, id, profileId);
              } catch (err) {
                return sendJson(res, 400, { ok: false, error: err?.message || String(err) });
              }
            }
          } else if (requestedProfile && requestedProfile !== "default") {
            return sendJson(res, 400, { ok: false, error: `Engine "${id}" does not support isolated accounts` });
          }
          const result = await startCliLogin({
            engineId: id,
            customEngines: Array.isArray(store.settings?.customCliEngines) ? store.settings.customCliEngines : [],
            region,
            autoOpen: body.value?.autoOpen !== false,
            profileId,
            profileDir,
            onUpdate: (snapshot) => {
              broadcast("state_changed");
              if (snapshot?.status === "succeeded") {
                orchestrator
                  .getDashboardState(true, false)
                  .then(() => broadcast("state_changed"))
                  .catch(() => {});
              }
            },
          });
          broadcast("state_changed");
          sendJson(res, result.ok ? 200 : 400, {
            ...result,
            state: await buildStatePayload(result.login?.status === "succeeded", false),
          });
          return;
        }
        if (req.method === "POST" && subAction === "reopen") {
          const opened = reopenCliLoginBrowser(id);
          sendJson(res, opened.ok ? 200 : 400, opened);
          return;
        }
        if (req.method === "POST" && subAction === "cancel") {
          const cancelled = cancelCliLogin(id);
          broadcast("state_changed");
          sendJson(res, 200, { ...cancelled, state: await buildStatePayload(false, false) });
          return;
        }
      }
    }

    if (resource === "models") {
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const input = body.value || {};
        let lastSavedModelId = "";
        let savedIds = [];
        if (Array.isArray(input.modelNames) && input.modelNames.length > 0) {
          const batch = store.upsertModelsBatch(input);
          savedIds = batch.savedIds;
          lastSavedModelId = batch.firstId;
        } else {
          const saved = store.upsertModel(input);
          lastSavedModelId = saved.id;
          savedIds = [saved.id];
        }
        if (input.setAsInspector && lastSavedModelId) {
          store.updateTopSettings({ inspectorModelId: lastSavedModelId });
        }
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          lastSavedModelId,
          savedIds,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "DELETE" && id) {
        const deleted = store.deleteModel(id);
        if (!deleted) return sendJson(res, 404, { ok: false, error: "Model not found or builtin" });
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
    }

    if (resource === "channels") {
      if (req.method === "POST" && segments.length === 2) {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const channel = store.upsertChannel(body.value || {});
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          channel,
          lastSavedChannelId: channel.id,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "DELETE" && id && !action) {
        const deleted = store.deleteChannel(id);
        if (!deleted) return sendJson(res, 404, { ok: false, error: "Channel not found" });
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
      if (req.method === "POST" && id && action === "remove-model") {
        const body = await readJsonBody(req);
        if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
        const { modelId, modelName } = body.value || {};
        if (!modelId && !modelName?.trim()) {
          return sendJson(res, 400, { ok: false, error: "Provide a model ID or model name." });
        }
        const removed = store.removeChannelModel(id, modelName, modelId);
        if (!removed) return sendJson(res, 404, { ok: false, error: "Channel or model not found" });
        broadcast("settings_changed");
        sendJson(res, 200, {
          ok: true,
          settings: store.getPublicState(),
          state: await buildStatePayload(false, false),
        });
        return;
      }
    }

    if (req.method === "POST" && resource === "fetch-models") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      sendJson(res, 200, await orchestrator.fetchProviderModels(body.value || {}));
      return;
    }

    if (req.method === "POST" && resource === "test-connection") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      sendJson(res, 200, await orchestrator.testConnection(body.value || {}));
      return;
    }

    if (req.method === "POST" && resource === "session-action") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const { action: sessionAction, sessionId, jobId, modelId } = body.value || {};
      let result;
      if (sessionAction === "clear_cooldown" && modelId) {
        store.clearCooldown(modelId);
        result = { ok: true, text: "cooldown cleared" };
      } else if (sessionAction === "interrupt" && jobId) {
        result = await orchestrator.stopJob(jobId);
      } else {
        result = await orchestrator.sessionAction({ action: sessionAction, sessionId });
      }
      broadcast("orchestrator_state");
      sendJson(res, 200, {
        ok: true,
        actionResult: result,
        state: await buildStatePayload(false, false),
      });
      return;
    }

    if (req.method === "POST" && resource === "dismiss-interrupted") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendJson(res, body.status, { ok: false, error: body.error });
      const result = orchestrator.dismissInterrupted(body.value?.jobId);
      broadcast("orchestrator_state");
      sendJson(res, 200, {
        ok: true,
        actionResult: result,
        state: await buildStatePayload(false, false),
      });
      return;
    }

    if (req.method === "POST" && resource === "clear-logs") {
      telemetry.clear();
      broadcast("telemetry_cleared");
      sendJson(res, 200, { ok: true, state: await buildStatePayload(false, false) });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  }

  function serveDesktopHtml(req, res) {
    let html = "";
    try {
      html = fs.readFileSync(htmlPath, "utf8");
    } catch {
      html =
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A.stand</title>` +
        `<style>body{font-family:system-ui,sans-serif;background:#0b1120;color:#e2e8f0;padding:32px;line-height:1.6}` +
        `code{background:#1e293b;padding:2px 6px;border-radius:4px}</style></head><body>` +
        `<h1>A.stand daemon is running</h1>` +
        `<p>The desktop UI bundle was not found at <code>${htmlPath}</code>. Run <code>npm run build</code>.</p>` +
        `<p>MCP endpoint: <code>${mcpUrl()}</code></p>` +
        `</body></html>`;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host)) {
        sendJson(res, 421, { ok: false, error: "Host header not allowed" });
        return;
      }
      const url = new URL(req.url || "/", `http://${listenHost}:${actualPort}`);
      const segments = splitPath(url.pathname);

      if (url.pathname === "/mcp") {
        await handleMcp(req, res, url);
        return;
      }
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, segments);
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        serveDesktopHtml(req, res);
        return;
      }
      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      if (!res.headersSent) {
        const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
        sendJson(res, status, { ok: false, error: err?.message || String(err) });
      } else {
        try {
          res.end();
        } catch {}
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, listenHost, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  actualPort = httpServer.address().port;

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(sessionSweeper);
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    try {
      unsubscribeRegistry?.();
    } catch {}
    try {
      cancelAllCliLogins();
    } catch {}
    try {
      cancelAllCliInstalls();
    } catch {}
    try {
      unsubscribeOrchestrator?.();
    } catch {}
    for (const res of sseClients) {
      try {
        res.end();
      } catch {}
    }
    sseClients.clear();
    for (const [sessionId, session] of [...sessions.entries()]) {
      sessions.delete(sessionId);
      try {
        await session.server?.close?.();
      } catch {}
      try {
        await session.transport?.close?.();
      } catch {}
    }
    await new Promise((resolve) => httpServer.close(() => resolve()));
    // Force-close any lingering keep-alive sockets so `close()` cannot hang.
    try {
      httpServer.closeAllConnections?.();
    } catch {}
  }

  return {
    server: httpServer,
    host: listenHost,
    get port() {
      return actualPort;
    },
    mcpUrl,
    uiToken: resolvedUiToken,
    startedAt,
    close,
    sessions,
  };
}
