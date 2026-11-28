import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { ROLE_SPECS } from "../core/constants.mjs";
import { resolveCliPresetBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { proxyFingerprint, safeKill, utf8EnvChecked } from "./base.mjs";

const MODELS_TTL_MS = 300_000, MODELS_EMPTY_RETRY_MS = 15_000, MODELS_TIMEOUT_MS = 25_000, HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 1_800_000, DEFAULT_ABSOLUTE_TIMEOUT_MS = 7_200_000;
const READ_ONLY_TOOL_RE = /^(read|view|open|search|grep|glob|find|list|ls|stat|inspect|cat|head|tail|describe)\b/i;
const WRITE_TOOL_RE = /\b(write|edit|delete|remove|create|move|rename|patch|apply|shell|command|exec|execute|run|terminal|spawn|bash|sh|powershell|cmd|mkdir|rm|cp|mv|chmod)\b/i;
const RATE_LIMIT_RE = /\b429\b|rate[\s_-]?limit|too many requests|quota|credits?\b|insufficient|balance/i;
const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
/**
 * Dead loopback proxies (e.g. a stopped 127.0.0.1:10808 left over from a TUN/VPN
 * tool) are dropped for every engine by utf8EnvChecked(). Only Doubao clears the
 * proxy variables unconditionally, mirroring the login path in cli-login.mjs:
 * other engines must keep a *live* local proxy, otherwise MiniMax Global breaks
 * while the user is outside a VPN.
 */
export async function buildAcpEnv(engineId) {
  const env = await utf8EnvChecked();
  if (engineId !== "doubao") return env;
  for (const key of PROXY_ENV_KEYS) {
    if (env[key]) env[key] = "";
  }
  return env;
}
/**
 * Normalize a working directory into a stable map key plus the absolute path
 * used to spawn the child process. Windows paths are case-insensitive, so the
 * key is lowercased there to avoid two clients for the same directory.
 */
function normalizeCwd(cwd) {
  const resolved = path.resolve(cwd || process.cwd());
  return { key: process.platform === "win32" ? resolved.toLowerCase() : resolved, resolved };
}
const round1 = (n) => Math.round(n * 10) / 10;
const asNumber = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function oneLine(text, max = 140) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
function nonEmptyDetail(val) {
  if (val == null) return "";
  if (typeof val === "string") return val.trim().slice(0, 2000);
  if (Array.isArray(val)) return val.length ? JSON.stringify(val).slice(0, 2000) : "";
  if (typeof val === "object") return Object.keys(val).length ? JSON.stringify(val).slice(0, 2000) : "";
  return String(val).slice(0, 2000);
}
export function launchForShell(command, args, useShell) {
  if (!useShell || process.platform !== "win32") return { command, args, windowsVerbatimArguments: false };
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const inner = [quote(command), ...args.map(quote)].join(" ");
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", `"${inner}"`],
    windowsVerbatimArguments: true,
  };
}
export function markRateLimitError(err, extra = "") {
  const text = `${err?.message || err || ""} ${extra || ""}`.toLowerCase();
  if (RATE_LIMIT_RE.test(text)) {
    err.isRateLimit = true;
    if (/credits?|insufficient|balance|quota/.test(text)) err.isQuotaDepleted = true;
    if (!err.resetsAtMs && !err.isQuotaDepleted) err.resetsAtMs = Date.now() + 60 * 60_000;
  }
  return err;
}
function isReadOnlyPermission(params) {
  const tool = params?.toolCall || params || {};
  const kind = String(tool.kind || params?.kind || "").toLowerCase();
  const title = String(tool.title || params?.title || "");
  if (WRITE_TOOL_RE.test(kind) || WRITE_TOOL_RE.test(title)) return false;
  return ["read", "search", "fetch", "think"].includes(kind) || READ_ONLY_TOOL_RE.test(title);
}
function pickOption(options, kinds) {
  for (const kind of kinds) {
    const match = options.find((option) => String(option?.kind || "") === kind);
    if (match) return match;
  }
  return null;
}
/**
 * Flatten ACP model catalogs from either:
 *  - `configOptions` array (`{ id/category: "model", options: [...] }`, used by OpenCode / Doubao / MiniMax Code)
 *  - `session/new` result object (`{ configOptions, models: { availableModels: [...] } }`, used by Qoder CN / Global)
 */
export function collectAcpModelOptions(source) {
  const configOptions = Array.isArray(source) ? source : source?.configOptions;
  const catalog = (Array.isArray(configOptions) ? configOptions : []).find(
    (option) => option?.id === "model" || option?.category === "model"
  );
  const out = [], seen = new Set();
  const push = (value, name = "", description = "") => {
    const clean = typeof value === "string" ? value.trim() : "";
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push({
      value: clean,
      name: typeof name === "string" ? name.trim() : "",
      ...(description ? { description: String(description).trim() } : {}),
    });
  };
  const walk = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== "object") continue;
      if (Array.isArray(item.options)) { walk(item.options); continue; }
      const value =
        typeof item.value === "string"
          ? item.value
          : typeof item.modelId === "string"
          ? item.modelId
          : typeof item.id === "string"
          ? item.id
          : "";
      push(value, item.name || item.displayName || "", item.description || "");
    }
  };
  walk(catalog?.options);
  if (!Array.isArray(source)) {
    const avail = source?.models?.availableModels || source?.availableModels || [];
    walk(avail);
  }
  return out;
}
/**
 * OpenCode reports inputTokens EXCLUDING cachedReadTokens while totalTokens covers both.
 * Detect that shape and normalize to normalizeUsage's inclusive contract.
 */
export function normalizeAcpUsage(raw, { contextWindow = null, contextUsed = null } = {}) {
  if (!raw || typeof raw !== "object") {
    const usage = normalizeUsage("openai", contextWindow ? { contextWindow } : null);
    if (contextWindow && contextUsed != null) usage.contextPct = round1((contextUsed / contextWindow) * 100);
    return usage;
  }
  const input = asNumber(raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens);
  const cached = asNumber(raw.cachedReadTokens ?? raw.cacheReadInputTokens ?? raw.cachedInputTokens ?? raw.cache_read_input_tokens);
  const cacheWrite = asNumber(raw.cachedWriteTokens ?? raw.cacheWriteInputTokens ?? raw.cachedWriteInputTokens ?? raw.cache_write_input_tokens);
  const output = asNumber(raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens);
  const total = asNumber(raw.totalTokens ?? raw.total_tokens);
  let totalInput = input;
  if (input != null && cached != null && total != null) {
    const expected = input + cached + (output || 0);
    if (Math.abs(total - expected) <= Math.max(2, Math.round(total * 0.02))) totalInput = input + cached;
  }
  const usage = normalizeUsage("openai", {
    inputTokens: totalInput, cachedInputTokens: cached, cacheWriteInputTokens: cacheWrite,
    outputTokens: output, contextWindow: contextWindow ?? raw.contextWindow,
  });
  if (contextWindow && contextUsed != null) usage.contextPct = round1((contextUsed / contextWindow) * 100);
  return usage;
}
export class UniversalAcpEngine {
  constructor(descriptor, resolveBinaryFn = resolveCliPresetBinary) {
    this.id = descriptor.id;
    this.descriptor = descriptor;
    this.resolveBinaryFn = resolveBinaryFn;
    // One child process per working directory: some ACP CLIs (CodeBuddy) ignore
    // session/new's cwd and only honour the spawned process cwd.
    this.clients = new Map();
    this.connecting = new Map();
    this.sessions = new Map();
    this.busy = new Set();
    this.pendingCancels = new Set();
    this.latestModels = [];
    this.modelsFetchedAt = 0;
    this.modelsPromise = null;
  }
  #resolveBinary() {
    const bin = this.resolveBinaryFn?.(this.descriptor);
    if (!bin?.command) {
      throw new Error(`${this.descriptor.labelEn || this.id} CLI is not installed. Install via: ${this.descriptor.installCmd || "(see docs)"}`);
    }
    return bin;
  }
  async #connect(cwdKey, normalizedCwd, env, fingerprint) {
    const bin = this.#resolveBinary();
    const launched = launchForShell(bin.command, this.descriptor.args || [], bin.useShell);
    const proc = spawn(launched.command, launched.args, {
      cwd: normalizedCwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      ...(launched.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      env,
    });
    const state = { proc, cwdKey, cwd: normalizedCwd, proxyFingerprint: fingerprint, initialized: false, agentInfo: null, nextId: 1, pending: new Map(), listeners: new Map(), sessionRoles: new Map(), sessions: new Set(), stderrRing: [] };
    const sendRaw = (obj) => {
      if (!proc.stdin?.writable) throw new Error("ACP stdin closed");
      proc.stdin.write(`${JSON.stringify(obj)}\n`);
    };
    const request = (method, params = {}, timeoutMs = 45_000) =>
      new Promise((resolve, reject) => {
        const id = state.nextId++;
        const timer = timeoutMs > 0
          ? setTimeout(() => {
              state.pending.delete(id);
              reject(Object.assign(new Error(`[${this.id}] ACP ${method} timeout after ${timeoutMs}ms`), { method }));
            }, timeoutMs)
          : null;
        timer?.unref?.();
        state.pending.set(id, {
          method,
          resolve: (value) => { if (timer) clearTimeout(timer); resolve(value); },
          reject: (err) => { if (timer) clearTimeout(timer); reject(err); },
        });
        sendRaw({ jsonrpc: "2.0", id, method, params });
      });
    state.sendRaw = sendRaw;
    state.request = request;

    proc.on("error", (err) => {
      for (const pending of state.pending.values()) pending.reject(err);
      state.pending.clear();
    });
    proc.on("exit", (code, signal) => {
      const err = new Error(`[${this.id}] ACP process exited (code=${code}, signal=${signal})`);
      for (const pending of state.pending.values()) pending.reject(err);
      state.pending.clear();
      for (const listener of state.listeners.values()) listener({ method: "__exit__", params: { code } });
      state.listeners.clear();
      if (this.clients.get(cwdKey) === state) this.clients.delete(cwdKey);
    });
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;
      let msg;
      try { msg = JSON.parse(trimmed); } catch { return; }
      if (msg.id !== undefined && msg.method === "session/request_permission") { this.#answerPermission(state, msg); return; }
      if (msg.id !== undefined && msg.method) {
        try { sendRaw({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not supported" } }); } catch {}
        return;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        const pending = state.pending.get(msg.id);
        if (!pending) return;
        state.pending.delete(msg.id);
        if (msg.error) {
          const err = new Error(`[${this.id}] ACP ${pending.method}: ${JSON.stringify(msg.error)}`);
          err.acpError = msg.error;
          pending.reject(err);
        } else pending.resolve(msg.result);
        return;
      }
      if (msg.method === "session/update" && msg.params?.update?.sessionUpdate === "config_option_update") {
        if (Array.isArray(msg.params.update.configOptions)) {
          state.lastConfigOptions = msg.params.update.configOptions;
        }
      }
      const listener = msg.method && msg.params?.sessionId ? state.listeners.get(msg.params.sessionId) : null;
      if (listener) listener(msg);
    });
    readline.createInterface({ input: proc.stderr }).on("line", (line) => {
      if (!line.trim()) return;
      state.stderrRing.push(line.trim());
      if (state.stderrRing.length > 40) state.stderrRing.shift();
    });
    try {
      const init = await request("initialize", {
        protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "agent-relay", version: "1.0.0" },
      }, 20_000);
      state.agentInfo = init?.agentInfo || null;
      state.initialized = true;
      this.clients.set(cwdKey, state);
      return state;
    } catch (err) {
      await safeKill(proc).catch(() => {});
      throw markRateLimitError(err, state.stderrRing.join("\n"));
    }
  }
  /**
   * A client is idle when no turn is streaming on it and no request is in
   * flight. Only idle clients may be recycled on a proxy state flip.
   */
  #isClientIdle(state) {
    if (!state) return true;
    if (state.listeners?.size) return false;
    if (state.pending?.size) return false;
    for (const sessionId of state.sessions || []) {
      if (this.busy.has(sessionId)) return false;
    }
    return true;
  }
  #clientForSession(sessionId) {
    for (const state of this.clients.values()) {
      if (state.sessions?.has(sessionId)) return state;
    }
    return null;
  }
  #anyLiveClient() {
    for (const state of this.clients.values()) {
      if (state.initialized && state.proc && state.proc.exitCode === null) return state;
    }
    return null;
  }
  async #ensureClient(cwd) {
    const { key: cwdKey, resolved: normalizedCwd } = normalizeCwd(cwd);
    const env = await buildAcpEnv(this.id);
    const fp = proxyFingerprint(env);
    const existing = this.clients.get(cwdKey);
    if (existing?.initialized && existing.proc && existing.proc.exitCode === null) {
      const proxyFlipped = Boolean(existing.proxyFingerprint) && existing.proxyFingerprint !== fp;
      if (!proxyFlipped || !this.#isClientIdle(existing)) return existing;
      // The proxy state flipped while this client was idle: recycle the child
      // process so the next turn runs with a fresh environment.
      this.clients.delete(cwdKey);
      await safeKill(existing.proc).catch(() => {});
    }
    const pending = this.connecting.get(cwdKey);
    if (pending) return pending;
    const promise = this.#connect(cwdKey, normalizedCwd, env, fp);
    this.connecting.set(cwdKey, promise);
    try {
      return await promise;
    } finally {
      if (this.connecting.get(cwdKey) === promise) this.connecting.delete(cwdKey);
    }
  }
  #answerPermission(state, msg) {
    const params = msg.params || {};
    const role = state.sessionRoles.get(params.sessionId) || "oracle";
    const options = Array.isArray(params.options) ? params.options : [];
    const allow = pickOption(options, ["allow_once", "allow_always"]) || options.find((o) => /allow/i.test(String(o?.kind || "")));
    const reject = pickOption(options, ["reject_once", "reject_always"]) || options.find((o) => /reject/i.test(String(o?.kind || "")));
    let chosen = null;
    if (role === "hephaestus") chosen = allow || options[0] || null;
    else if (isReadOnlyPermission(params)) chosen = allow || null;
    else chosen = reject || null;
    try {
      state.sendRaw({
        jsonrpc: "2.0", id: msg.id,
        result: chosen ? { outcome: { outcome: "selected", optionId: chosen.optionId } } : { outcome: { outcome: "cancelled" } },
      });
    } catch {}
  }
  async #configureSession(state, sessionId, { role, model, effort }) {
    const mode = role === "oracle" ? this.descriptor.readOnlyMode || "plan" : this.descriptor.writeMode || "build";
    if (mode) {
      try { await state.request("session/set_mode", { sessionId, modeId: mode }, 10_000); } catch {}
    }
    const attempts = [];
    if (model?.modelName) attempts.push(["model", model.modelName]);
    const effortValue = ["off", "low", "medium", "high"].includes(effort) ? effort : "medium";
    attempts.push(["effort", effortValue], ["thought_level", effortValue], ["reasoning_effort", effortValue], ["thinkingEffort", effortValue]);
    if (mode) attempts.push(["mode", mode]);
    if (role === "hephaestus") attempts.push(["permissionMode", "bypassPermissions"]);
    for (const [configId, value] of attempts) {
      try { await state.request("session/set_config_option", { sessionId, configId, value }, 10_000); } catch {}
    }
  }
  async runTurn({ cwd, role, model, effort = "medium", prompt, existingSessionId, requireResume = false, onActivity, onSessionReady, idleTimeoutMs, absoluteTimeoutMs }) {
    const startedAt = Date.now();
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
    const { key: cwdKey, resolved: normalizedCwd } = normalizeCwd(cwd);
    const state = await this.#ensureClient(normalizedCwd);
    let sessionId = existingSessionId || "";
    let reused = false, resumedFromDisk = false;
    if (sessionId && this.sessions.get(sessionId) === cwdKey) reused = true;
    else if (sessionId) {
      try {
        await state.request("session/load", { sessionId, cwd: normalizedCwd, mcpServers: [] }, 20_000);
        this.sessions.set(sessionId, cwdKey);
        state.sessions.add(sessionId);
        reused = resumedFromDisk = true;
      } catch (err) {
        if (requireResume) throw err;
        sessionId = "";
      }
    }
    if (!sessionId) {
      const created = await state.request("session/new", { cwd: normalizedCwd, mcpServers: [] }, 30_000);
      sessionId = created?.sessionId;
      if (!sessionId) throw new Error(`[${this.id}] ACP session/new returned no sessionId`);
      this.sessions.set(sessionId, cwdKey);
      state.sessions.add(sessionId);
    }
    if (this.busy.has(sessionId)) throw new Error(`[${this.id}] session ${sessionId} already has an active turn`);
    this.busy.add(sessionId);
    this.pendingCancels.delete(sessionId);
    state.sessionRoles.set(sessionId, role);
    await this.#configureSession(state, sessionId, { role, model, effort });
    if (this.pendingCancels.delete(sessionId)) {
      try { state.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }); } catch {}
    }
    onSessionReady?.(sessionId);

    let text = "", rawUsage = null, contextWindow = null, contextUsed = null, lastEmit = 0;
    const actions = [];
    const toolMeta = new Map(); // toolCallId -> { title, kind }
    const thoughtBuffers = new Map(); // messageId -> accumulated text
    let lastThoughtEmit = 0;
    let idleTimer = null, absoluteTimer = null, failTimeout = null;
    const timeoutPromise = new Promise((_, reject) => { failTimeout = reject; });
    const expire = (reason) => {
      try { state.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } }); } catch {}
      const err = new Error(`[${this.id}] ACP turn exceeded the ${reason} deadline`);
      err.isPromptTimeout = true;
      failTimeout(err);
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => expire("idle"), Math.max(100, Number(idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS));
      idleTimer.unref?.();
    };
    absoluteTimer = setTimeout(() => expire("absolute"), Math.max(100, Number(absoluteTimeoutMs) || DEFAULT_ABSOLUTE_TIMEOUT_MS));
    armIdle();

    state.listeners.set(sessionId, (msg) => {
      if (msg.method === "__exit__") return failTimeout(new Error(`[${this.id}] ACP process exited mid-turn`));
      if (msg.method !== "session/update") return;
      const update = msg.params?.update || {};
      armIdle();
      if (update.sessionUpdate === "agent_message_chunk" && update.content?.text) {
        text += update.content.text;
        if (Date.now() - lastEmit >= 700) {
          lastEmit = Date.now();
          onActivity?.({ id: `msg_${startedAt}_${update.messageId || "anon"}`, type: "output", kind: "output", title: oneLine(text), status: "running", summary: oneLine(text), detail: text.slice(0, 4000) });
        }
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        const chunk = String(update.content?.text || "");
        if (chunk) {
          const mid = update.messageId || `thought_${startedAt}`;
          const acc = (thoughtBuffers.get(mid) || "") + chunk;
          thoughtBuffers.set(mid, acc);
          const now = Date.now();
          if (now - lastThoughtEmit >= 700) {
            lastThoughtEmit = now;
            onActivity?.({ id: `thought_${mid}`, type: "thought", kind: "thought", title: "", status: "running", summary: `思考: ${oneLine(acc, 120)}`, detail: acc.slice(0, 4000) });
          }
        }
      } else if (update.sessionUpdate === "tool_call") {
        const callId = update.toolCallId || update.callId || update.id || `tool_${startedAt}_${toolMeta.size}`;
        const title = String(update.title || update.name || "").trim() || "tool call";
        const kind = update.kind || "cmd";
        toolMeta.set(callId, { title, kind });
        actions.push(title);
        onActivity?.({ id: callId, type: "cmd_start", kind, title, status: "running", summary: title, detail: nonEmptyDetail(update.rawInput) });
      } else if (update.sessionUpdate === "tool_call_update" && ["completed", "failed"].includes(String(update.status || ""))) {
        const failed = update.status === "failed";
        const callId = update.toolCallId || update.callId || update.id || `tool_${startedAt}`;
        const prev = toolMeta.get(callId);
        const title = String(update.title || update.name || prev?.title || "tool call").trim() || "tool call";
        const kind = update.kind || prev?.kind || "cmd";
        onActivity?.({ id: callId, type: failed ? "cmd_err" : "cmd_done", kind, title, status: failed ? "error" : "done", summary: `${failed ? "✗" : "✓"} ${title}`, detail: nonEmptyDetail(update.rawOutput ?? update.content) });
      } else if (update.sessionUpdate === "usage_update") {
        if (typeof update.size === "number") contextWindow = update.size;
        if (typeof update.used === "number") contextUsed = update.used;
      }
      if (update.usage || msg.params?.usage) rawUsage = { ...(rawUsage || {}), ...(update.usage || msg.params.usage) };
    });

    const fullPrompt = reused ? prompt : `[Role Instructions]\n${spec.developerInstructions}\n\n[Task]\n${prompt}`;
    try {
      const result = await Promise.race([
        state.request("session/prompt", { sessionId, prompt: [{ type: "text", text: fullPrompt }] }, 0),
        timeoutPromise,
      ]);
      if (result?.usage || result?._meta?.usage) rawUsage = { ...(rawUsage || {}), ...(result.usage || result._meta.usage) };
      const usage = normalizeAcpUsage(rawUsage, { contextWindow, contextUsed });
      const stopReason = String(result?.stopReason || "").toLowerCase();
      return {
        sessionId, turnId: "", reused, resumedFromDisk,
        resolvedModel: model?.modelName || `${this.id}:default`,
        appliedEffort: effort,
        text: text.trim() || "(no response text)",
        stopReason: stopReason || undefined,
        truncated: ["max_tokens", "max-tokens", "length"].includes(stopReason),
        usage,
        usageProvenance: {
          source: result?.usage ? "rpc" : rawUsage ? "notifications" : "none",
          scope: "turn",
          ...(usage.cacheReported ? {} : { skipReason: "cache-not-reported-by-upstream" }),
        },
        actions, elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      throw markRateLimitError(err, state.stderrRing.join("\n"));
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(absoluteTimer);
      state.listeners.delete(sessionId);
      this.busy.delete(sessionId);
    }
  }
  invalidateModelsCache() {
    this.modelsFetchedAt = 0;
  }
  async listModels(force = false) {
    const hasConcrete = this.latestModels.some((m) => m && !m.isDefault);
    const ttl = hasConcrete ? MODELS_TTL_MS : MODELS_EMPTY_RETRY_MS;
    if (!force && this.modelsFetchedAt > 0 && Date.now() - this.modelsFetchedAt < ttl) return this.latestModels;
    if (this.modelsPromise) return this.modelsPromise;
    this.modelsPromise = (async () => {
      const label = this.descriptor.labelEn || this.descriptor.labelZh || this.id;
      const fallback = {
        id: `cli:${this.id}:default`, modelName: "", displayName: `${label} (Default)`,
        displayNameZh: `${this.descriptor.labelZh || label}（默认）`, isDefault: true, engine: this.id,
      };
      try {
        const existing = this.#anyLiveClient();
        const state = await Promise.race([
          existing ? Promise.resolve(existing) : this.#ensureClient(process.cwd()),
          new Promise((resolve) => setTimeout(() => resolve(null), MODELS_TIMEOUT_MS).unref?.()),
        ]);
        if (!state) throw new Error(`[${this.id}] model discovery timed out`);
        state.lastConfigOptions = null;
        const created = await state.request("session/new", { cwd: state.cwd || process.cwd(), mcpServers: [] }, MODELS_TIMEOUT_MS);
        let rawModels = collectAcpModelOptions(created);
        if (!rawModels.length) {
          if (!Array.isArray(state.lastConfigOptions)) {
            await new Promise((r) => setTimeout(r, 350));
          }
          if (Array.isArray(state.lastConfigOptions)) {
            rawModels = collectAcpModelOptions(state.lastConfigOptions);
          }
        }
        const discovered = rawModels.map((model) => ({
          id: `cli:${this.id}:${model.value}`, modelName: model.value,
          displayName: model.name || model.value, displayNameZh: model.name || model.value,
          ...(model.description ? { description: model.description } : {}),
          isDefault: false, engine: this.id,
        }));
        this.latestModels = [fallback, ...discovered];
      } catch {
        this.latestModels = this.latestModels.length > 0 ? this.latestModels : [fallback];
      } finally {
        this.modelsFetchedAt = Date.now();
        this.modelsPromise = null;
      }
      return this.latestModels;
    })();
    return this.modelsPromise;
  }
  async interruptTurn(sessionId) {
    if (!sessionId) return false;
    const state = this.#clientForSession(sessionId);
    if (!state || !this.busy.has(sessionId)) { this.pendingCancels.add(sessionId); return false; }
    try {
      state.sendRaw({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
      return true;
    } catch { return false; }
  }

  async healthCheck() {
    const startedAt = Date.now();
    let proc = null, timer = null;
    try {
      const bin = this.#resolveBinary();
      const launched = launchForShell(bin.command, this.descriptor.args || [], bin.useShell);
      proc = spawn(launched.command, launched.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        ...(launched.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        env: await buildAcpEnv(this.id),
      });
      const agentInfo = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`[${this.id}] ACP initialize timeout`)), HEALTH_TIMEOUT_MS);
        timer.unref?.();
        proc.on("error", reject);
        proc.on("exit", () => reject(new Error(`[${this.id}] ACP process exited during initialize`)));
        readline.createInterface({ input: proc.stdout }).on("line", (line) => {
          let msg;
          try { msg = JSON.parse(String(line || "").trim()); } catch { return; }
          if (msg.id !== 1) return;
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result?.agentInfo || null);
        });
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "agent-relay", version: "1.0.0" } } })}\n`);
      });
      return { ok: true, latencyMs: Date.now() - startedAt, agentInfo };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - startedAt, agentInfo: null, error: err?.message || String(err) };
    } finally {
      if (timer) clearTimeout(timer);
      if (proc) await safeKill(proc).catch(() => {});
    }
  }

  async shutdown() {
    const states = [...this.clients.values()];
    this.clients.clear();
    this.connecting.clear();
    this.sessions.clear();
    this.busy.clear();
    for (const state of states) {
      if (state.proc) await safeKill(state.proc).catch(() => {});
    }
  }
}
