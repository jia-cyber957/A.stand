import { spawn } from "node:child_process";
import readline from "node:readline";
import { CODEX_BROKEN_GUI_PLUGINS, CODEX_OFFICE_PLUGINS, ROLE_SPECS } from "../core/constants.mjs";
import { resolveCodexBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { proseTitle, safeKill, UpstreamProtocolError, utf8Env } from "./base.mjs";

function parseRateLimitSnapshot(snap) {
  if (!snap || typeof snap !== "object") return null;
  const parseWin = (w) => {
    if (!w || typeof w !== "object") return null;
    const usedPercent = typeof w.usedPercent === "number" ? w.usedPercent : null;
    const remainingPercent = usedPercent != null ? Math.max(0, 100 - usedPercent) : null;
    const resetsAtMs = typeof w.resetsAt === "number" ? w.resetsAt * 1000 : null;
    return {
      usedPercent,
      remainingPercent,
      windowDurationMins: w.windowDurationMins ?? null,
      resetsAtMs,
      resetsAtIso: resetsAtMs ? new Date(resetsAtMs).toISOString() : null,
    };
  };
  return {
    planType: snap.planType || null,
    limitName: snap.limitName || snap.limitId || null,
    rateLimitReachedType: snap.rateLimitReachedType || null,
    primary: parseWin(snap.primary),
    secondary: parseWin(snap.secondary),
    credits: snap.credits
      ? {
          balance: snap.credits.balance ?? null,
          hasCredits: Boolean(snap.credits.hasCredits),
          unlimited: Boolean(snap.credits.unlimited),
        }
      : null,
    updatedAt: new Date().toISOString(),
  };
}

const ITEM_DELTAS = {
  "item/agentMessage/delta": ["agentMessage", "text"],
  "item/reasoning/summaryTextDelta": ["reasoning", "summary"],
  "item/reasoning/textDelta": ["reasoning", "reasoning"],
  "item/commandExecution/outputDelta": ["commandExecution", "output"],
};

function conciseCommand(command) {
  const clean = command.replace(/\s+/g, " ").trim()
    .replace(/^(?:pwsh|powershell|bash|sh):\s*/i, "")
    .replace(/^(?:"[^"]*[\\/])?(?:pwsh|powershell|bash|zsh|sh)(?:\.exe)?"?(?: (?:-NoProfile|-NoLogo|-NonInteractive))* (?:-Command|-c|-lc) (["'])(.*)\1$/i, "$2");
  return clean.length > 100 ? `${clean.slice(0, 99).trimEnd()}…` : clean;
}

function fileChangeFields(changes) {
  const files = Array.isArray(changes) ? changes : [];
  let added = 0;
  let removed = 0;
  const previews = files.map(({ path, diff, kind }) => {
    if (diff) {
      const lines = diff.replace(/\r?\n$/, "").split(/\r?\n/);
      if (kind?.type === "add" && !lines.some((line) => line.startsWith("@@ "))) added += lines.length;
      else if (kind?.type === "delete" && !lines.some((line) => line.startsWith("@@ "))) removed += lines.length;
      else {
        for (const line of lines) {
          if (line.startsWith("+") && !line.startsWith("+++ ")) added++;
          if (line.startsWith("-") && !line.startsWith("--- ")) removed++;
        }
      }
    }
    return diff ? [path, diff].filter(Boolean).join("\n") : "";
  });
  return {
    title: String(files[0]?.path || "").split(/[/\\]/).at(-1) || "File changes",
    meta: files.length > 1 ? `+${files.length - 1} files` : "",
    added,
    removed,
    detail: previews.filter(Boolean).join("\n\n").slice(0, 4000),
    summary: `files: ${files.map((c) => c.path).join(", ").slice(0, 140)}`,
  };
}

// One tracker per turn, shared by asks and inline reviews.
function trackCodexItems(onActivity, actions) {
  const items = new Map();

  function publish(state, status) {
    const { item, id } = state;
    const event = {
      id, status, title: "", meta: "", added: 0, removed: 0, detail: "", exitCode: null,
      durationSec: Number((Math.max(0, (state.completedAt || Date.now()) - state.startedAt) / 1000).toFixed(1)),
    };
    if (item.type === "reasoning") {
      const reasoning = state.parts.summary.filter(Boolean).join("\n\n") || state.parts.reasoning.filter(Boolean).join("\n\n");
      if (!reasoning && status !== "running" && !state.lastPush) return;
      Object.assign(event, { type: "thought", kind: "thought", detail: reasoning.slice(0, 4000),
        summary: reasoning ? `Reasoning: ${proseTitle(reasoning)}` : "Reasoning" });
    } else if (item.type === "agentMessage") {
      const title = proseTitle(state.text);
      if (!title) return;
      Object.assign(event, { type: "output", kind: "output", title, summary: title, detail: state.text.slice(0, 4000) });
    } else if (item.type === "commandExecution") {
      const command = String(item.command || "");
      if (!command) return;
      const stdout = String(state.output || item.output || "");
      const stderr = String(item.stderr || "");
      const output = String(item.aggregatedOutput || [stdout, stderr && !stdout.includes(stderr) ? stderr : ""].filter(Boolean).join("\n"));
      const exitCode = Number.isInteger(item.exitCode) ? item.exitCode : null;
      const type = status === "running" ? "cmd_start" : "cmd_done";
      let summary = status === "running" ? `running: ${command.slice(0, 120)}` : `cmd (exit=${exitCode}): ${command.slice(0, 110)}`;
      if (status === "error" && output.trim()) {
        const compact = output.replace(/\s+/g, " ").trim();
        summary += ` — ${compact.length > 260 ? "..." + compact.slice(-260) : compact}`;
      }
      Object.assign(event, { type, kind: "cmd", title: conciseCommand(command), exitCode, summary,
        detail: `$ ${command}\n\n${output.slice(0, 3500)}` });
    } else {
      Object.assign(event, { type: "file", kind: "edit", ...fileChangeFields(item.changes) });
    }
    if ((!state.lastPush || status !== "running") && (event.kind === "cmd" || event.kind === "edit")) {
      actions?.push(event.summary);
    }
    state.lastPush = Date.now();
    onActivity?.(event);
  }

  return {
    handle(method, params) {
      const delta = ITEM_DELTAS[method];
      const completed = method === "item/completed";
      if (!delta && !completed && method !== "item/started") return null;
      const notified = params?.item;
      const type = notified?.type === "exitedReviewMode" ? "agentMessage" : notified?.type || delta?.[0];
      if (!["reasoning", "agentMessage", "commandExecution", "fileChange"].includes(type)) return null;
      const id = notified?.id || params?.itemId || type;
      let state = items.get(id);
      if (!state) {
        state = { id, item: { type }, startedAt: params?.startedAtMs || notified?.startedAtMs || Date.now(), lastPush: 0,
          parts: { summary: [], reasoning: [] }, text: "", output: "" };
        items.set(id, state);
      }
      if (notified) Object.assign(state.item, notified, { type });
      if (delta) {
        const channel = delta[1];
        const value = String(params?.delta || "");
        if (channel === "summary" || channel === "reasoning") {
          const index = channel === "summary" ? params?.summaryIndex ?? 0 : params?.contentIndex ?? 0;
          state.parts[channel][index] = ((state.parts[channel][index] || "") + value).slice(0, 4000);
        } else if (channel === "output") {
          state.output = (state.output + value).slice(0, 3500);
        } else {
          state.text += value;
        }
      } else if (type === "reasoning") {
        if (notified?.summary?.length) state.parts.summary = [].concat(notified.summary);
        if (notified?.content?.length) state.parts.reasoning = [].concat(notified.content);
      } else if (type === "agentMessage") {
        state.text = notified?.text || notified?.review || state.text;
      }

      if (completed) {
        state.completedAt = params?.completedAtMs || notified?.completedAtMs || Date.now();
        const { exitCode, status } = state.item;
        const failed = status === "failed" || status === "declined" || (Number.isInteger(exitCode) && exitCode !== 0);
        publish(state, failed ? "error" : "done");
        items.delete(id);
        return type === "agentMessage" ? state.text : null;
      }
      if ((!delta || Date.now() - state.lastPush >= 1200) && (type !== "agentMessage" || state.text.trim())) {
        publish(state, "running");
      } else {
        onActivity?.({ type: "touch" });
      }
      return null;
    },

    finish() {
      for (const state of items.values()) {
        publish(state, ["reasoning", "agentMessage"].includes(state.item.type) ? "done" : "interrupted");
      }
      items.clear();
    },
  };
}

export class CodexEngine {
  constructor(getKeepOfficePlugins) {
    this.id = "codex";
    this.getKeepOfficePlugins = getKeepOfficePlugins;
    this.proc = null;
    this.initialized = false;
    this.serverVersion = "";
    this.spawnedWithKeepOffice = null;
    this.nextId = 1;
    this.pending = new Map();
    this.loadedThreads = new Set();
    this.threadRoles = new Map();
    this.threadSandboxes = new Map();
    this.activeTurns = new Map(); // threadId -> current turn ID and pending interrupt
    this.turnListeners = new Map(); // threadId -> callback(msg)
    this.stderrRing = [];
    this.latestRateLimits = null;
    this.rateLimitsFetchedAt = 0;
    this.latestModels = [];
    this.modelsFetchedAt = 0;
    this.connectingPromise = null;
  }

  #buildStartupArgs(keepOffice) {
    const disabled = [...CODEX_BROKEN_GUI_PLUGINS, ...(keepOffice ? [] : CODEX_OFFICE_PLUGINS)];
    const relayPluginId = process.env.AGENT_RELAY_CODEX_PLUGIN_ID;
    if (relayPluginId) disabled.push(relayPluginId);
    return [
      "app-server",
      "--stdio",
      "-c",
      "notify=[]",
      "-c",
      'model_reasoning_summary="detailed"',
      "-c",
      "mcp_servers.node_repl.enabled=false",
      ...disabled.flatMap((p) => ["-c", `plugins."${p}".enabled=false`]),
    ];
  }

  async ensureConnected() {
    const keepOffice = Boolean(this.getKeepOfficePlugins?.());
    if (this.proc && !this.proc.killed && this.initialized && this.spawnedWithKeepOffice === keepOffice) {
      return;
    }
    if (this.connectingPromise) {
      await this.connectingPromise;
      if (this.proc && !this.proc.killed && this.initialized && this.spawnedWithKeepOffice === keepOffice) {
        return;
      }
    }

    this.connectingPromise = (async () => {
      if (this.proc) {
        await this.shutdown();
      }

      const bin = resolveCodexBinary();
      if (!bin) {
        throw new Error("Codex CLI not found. Install via: npm install -g @openai/codex");
      }

      const args = this.#buildStartupArgs(keepOffice);
      this.spawnedWithKeepOffice = keepOffice;
      this.loadedThreads.clear();
      this.threadSandboxes.clear();
      this.stderrRing = [];

      this.proc = spawn(bin.command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: bin.useShell,
        env: utf8Env(),
      });

      this.proc.on("exit", (code, signal) => {
        const err = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        for (const listener of this.turnListeners.values()) {
          listener({ method: "__process_exit__", params: { code, signal } });
        }
        this.turnListeners.clear();
        this.activeTurns.clear();
        this.loadedThreads.clear();
        this.threadSandboxes.clear();
        this.initialized = false;
        this.proc = null;
      });

      const rlOut = readline.createInterface({ input: this.proc.stdout });
      rlOut.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) {
              p.reject(
                new UpstreamProtocolError("codex", this.serverVersion, p.method, JSON.stringify(msg.error))
              );
            } else {
              p.resolve(msg.result);
            }
          }
        } else if (msg.id !== undefined && msg.method) {
          this.#handleServerRequest(msg);
        } else if (msg.method) {
          if (msg.method === "account/rateLimits/updated" && msg.params?.rateLimits) {
            this.latestRateLimits = parseRateLimitSnapshot(msg.params.rateLimits);
            this.rateLimitsFetchedAt = Date.now();
          }
          const tid = msg.params?.threadId;
          if (tid && this.turnListeners.has(tid)) {
            if (msg.method === "turn/started") this.#setActiveTurnId(tid, msg.params.turn?.id);
            this.turnListeners.get(tid)(msg);
          }
        }
      });

      const rlErr = readline.createInterface({ input: this.proc.stderr });
      rlErr.on("line", (line) => {
        if (!line.trim()) return;
        this.stderrRing.push(line.trim());
        if (this.stderrRing.length > 40) this.stderrRing.shift();
      });

      const initRes = await this.#request("initialize", {
        clientInfo: { name: "agent-relay", title: "A.stand", version: "1.0.0" },
        capabilities: { experimentalApi: false },
      });
      const ua = initRes?.userAgent || "";
      const verMatch = ua.match(/\/([0-9]+\.[0-9]+\.[0-9]+)/);
      this.serverVersion = verMatch ? verMatch[1] : "";
      this.#sendRaw({ method: "initialized" });
      this.initialized = true;
    })();

    try {
      await this.connectingPromise;
    } finally {
      this.connectingPromise = null;
    }
  }

  #sendRaw(obj) {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new Error("codex app-server stdin is not writable");
    }
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  #request(method, params = {}, timeoutMs = 45_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new UpstreamProtocolError("codex", this.serverVersion, method, `timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.#sendRaw({ id, method, params });
    });
  }

  #handleServerRequest(msg) {
    const tid = msg.params?.threadId;
    const role = tid ? this.threadRoles.get(tid) : "oracle";
    const isReadOnly = role !== "hephaestus";

    if (
      msg.method === "item/commandExecution/requestApproval" ||
      msg.method === "item/fileChange/requestApproval" ||
      msg.method === "execCommandApproval" ||
      msg.method === "applyPatchApproval" ||
      msg.method === "item/permissions/requestApproval"
    ) {
      this.#sendRaw({
        id: msg.id,
        result: { decision: isReadOnly ? "decline" : "accept" },
      });
      return;
    }

    if (msg.method === "item/tool/requestUserInput") {
      this.#sendRaw({ id: msg.id, result: { answers: {} } });
      return;
    }

    this.#sendRaw({ id: msg.id, result: { decision: "decline" } });
  }

  async readRateLimits(force = false) {
    if (!force && this.latestRateLimits && Date.now() - this.rateLimitsFetchedAt < 45_000) {
      return this.latestRateLimits;
    }
    try {
      await this.ensureConnected();
      const res = await this.#request("account/rateLimits/read", {}, 10_000);
      const snap = res?.rateLimits || res?.rateLimitsByLimitId?.codex || Object.values(res?.rateLimitsByLimitId || {})[0];
      if (snap) {
        this.latestRateLimits = parseRateLimitSnapshot(snap);
        this.rateLimitsFetchedAt = Date.now();
      }
      return this.latestRateLimits;
    } catch {
      return this.latestRateLimits;
    }
  }

  async listModels(force = false) {
    if (!force && this.latestModels.length > 0 && Date.now() - this.modelsFetchedAt < 300_000) {
      return this.latestModels;
    }
    try {
      await this.ensureConnected();
      const res = await this.#request("model/list", { includeHidden: false }, 10_000);
      const list = Array.isArray(res?.data) ? res.data : [];
      const mapped = list
        .filter((m) => m && !m.hidden && m.model)
        .map((m) => ({
          id: m.isDefault ? "cli-codex-default" : `cli:codex:${m.model}`,
          modelName: m.model,
          displayName: m.displayName || m.model,
          description: m.description || "",
          isDefault: Boolean(m.isDefault),
          engine: "codex",
        }));
      if (mapped.length > 0) {
        this.latestModels = mapped;
        this.modelsFetchedAt = Date.now();
      }
      return this.latestModels;
    } catch {
      return this.latestModels;
    }
  }

  #classifyError(errText) {
    const low = String(errText || "").toLowerCase();
    const isRateLimit =
      low.includes("rate_limit") ||
      low.includes("rate limit") ||
      low.includes("usage_limit") ||
      low.includes("usage limit") ||
      low.includes("429") ||
      low.includes("credits_depleted") ||
      low.includes("too many requests");
    const err = new Error(errText);
    if (isRateLimit) {
      err.isRateLimit = true;
      err.resetsAtMs =
        this.latestRateLimits?.primary?.resetsAtMs ||
        this.latestRateLimits?.secondary?.resetsAtMs ||
        Date.now() + 5 * 60 * 60 * 1000;
    }
    return err;
  }

  async #ensureThread({ cwd, role, modelName, existingSessionId, sandbox, customRules, requireResume = false }) {
    await this.ensureConnected();
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
    const effectiveSandbox = role === "oracle" ? "read-only" : sandbox || spec.sandbox;

    if (
      existingSessionId &&
      this.loadedThreads.has(existingSessionId) &&
      this.threadSandboxes.get(existingSessionId) === effectiveSandbox
    ) {
      this.threadRoles.set(existingSessionId, role);
      return { sessionId: existingSessionId, reused: true, resumedFromDisk: false };
    }

    if (existingSessionId) {
      try {
        const res = await this.#request("thread/resume", {
          threadId: existingSessionId,
          cwd,
          sandbox: effectiveSandbox,
          approvalPolicy: "never",
        });
        const tid = res?.thread?.id || existingSessionId;
        this.loadedThreads.add(tid);
        this.threadRoles.set(tid, role);
        this.threadSandboxes.set(tid, effectiveSandbox);
        return {
          sessionId: tid,
          reused: true,
          resumedFromDisk: true,
          resolvedModel: res?.model || modelName || "",
        };
      } catch (err) {
        if (requireResume) throw err;
      }
    }

    const rules = !existingSessionId && customRules?.trim();
    const startParams = {
      cwd,
      sandbox: effectiveSandbox,
      approvalPolicy: "never",
      ephemeral: false,
      developerInstructions: rules
        ? `${spec.developerInstructions}\n\n[Role Custom Rules]\n${rules}\n[/Role Custom Rules]`
        : spec.developerInstructions,
    };
    if (modelName) startParams.model = modelName;

    const res = await this.#request("thread/start", startParams);
    const tid = res?.thread?.id;
    if (!tid) {
      throw new UpstreamProtocolError("codex", this.serverVersion, "thread/start", "missing thread.id");
    }
    this.loadedThreads.add(tid);
    this.threadRoles.set(tid, role);
    this.threadSandboxes.set(tid, effectiveSandbox);
    return {
      sessionId: tid,
      reused: false,
      resumedFromDisk: false,
      resolvedModel: res?.model || modelName || "",
    };
  }

  async runTurn({ cwd, role, model, effort = "medium", sandbox, prompt, existingSessionId, onActivity, onSessionReady, requireResume }) {
    const t0 = Date.now();
    const threadInfo = await this.#ensureThread({
      cwd,
      role,
      modelName: model?.modelName || "",
      existingSessionId,
      sandbox,
      requireResume,
    });
    const threadId = threadInfo.sessionId;
    this.activeTurns.set(threadId, { id: "", interruptPending: false });
    onSessionReady?.(threadId);

    let finalText = "";
    let streamedText = "";
    let lastRawUsage = null;
    let modelContextWindow = null;
    const actions = [];
    let turnId = "";
    const timeline = trackCodexItems(onActivity, actions);

    const completedPromise = new Promise((resolve, reject) => {
      this.turnListeners.set(threadId, (msg) => {
        const { method, params } = msg;
        if (method === "__process_exit__") {
          reject(new Error(`codex app-server terminated mid-turn (code=${params.code})`));
          return;
        }
        if (method === "thread/tokenUsage/updated") {
          if (params?.tokenUsage?.last) lastRawUsage = params.tokenUsage.last;
          if (params?.tokenUsage?.modelContextWindow) {
            modelContextWindow = params.tokenUsage.modelContextWindow;
          }
        } else if (method === "error" && params?.willRetry === false) {
          const msgText =
            typeof params.error === "string"
              ? params.error
              : params.error?.message || JSON.stringify(params.error || params);
          reject(this.#classifyError(`Codex stream error: ${msgText}`));
        } else if (method === "turn/completed") {
          resolve(params?.turn || { status: "completed" });
        } else {
          if (method === "item/agentMessage/delta" && params?.delta) streamedText += params.delta;
          const message = timeline.handle(method, params);
          if (message) finalText = message;
        }
      });
    });

    try {
      // CRITICAL CACHE RULE: never pass per-turn disabledPluginIds here;
      // desktop plugins are disabled cleanly once via startup -c flags.
      const codexEffort = ["low", "medium", "high"].includes(effort) ? effort : "low";
      const startRes = await this.#request("turn/start", {
        threadId,
        effort: codexEffort,
        summary: "detailed",
        input: [{ type: "text", text: prompt }],
      });
      turnId = startRes?.turn?.id || "";
      this.#setActiveTurnId(threadId, turnId);

      const completedTurn = await completedPromise;
      const elapsedMs = Date.now() - t0;
      const usage = normalizeUsage(
        "codex",
        lastRawUsage ? { ...lastRawUsage, modelContextWindow } : null
      );

      if (completedTurn?.status === "failed" || completedTurn?.error) {
        const errMsg =
          typeof completedTurn.error === "string"
            ? completedTurn.error
            : JSON.stringify(completedTurn.error || "turn failed");
        throw this.#classifyError(`Codex turn failed: ${errMsg}`);
      }

      return {
        sessionId: threadId,
        turnId,
        interrupted: completedTurn?.status === "interrupted",
        reused: threadInfo.reused,
        resumedFromDisk: threadInfo.resumedFromDisk,
        resolvedModel: threadInfo.resolvedModel || model?.modelName || "gpt-6.2-sol",
        text: finalText || streamedText || "(no response text)",
        usage,
        actions,
        elapsedMs,
      };
    } finally {
      this.turnListeners.delete(threadId);
      this.activeTurns.delete(threadId);
      timeline.finish();
    }
  }

  async runReview({ cwd, model, existingSessionId, customRules, target = { type: "uncommittedChanges" }, onActivity, onSessionReady }) {
    const t0 = Date.now();
    const threadInfo = await this.#ensureThread({
      cwd,
      role: "oracle",
      modelName: model?.modelName || "",
      existingSessionId,
      sandbox: "read-only",
      customRules,
    });
    const threadId = threadInfo.sessionId;
    this.activeTurns.set(threadId, { id: "", interruptPending: false });
    onSessionReady?.(threadId);

    let finalText = "";
    let lastRawUsage = null;
    let modelContextWindow = null;
    const timeline = trackCodexItems(onActivity);

    const completedPromise = new Promise((resolve, reject) => {
      this.turnListeners.set(threadId, (msg) => {
        const { method, params } = msg;
        if (method === "__process_exit__") {
          reject(new Error("codex app-server terminated during review"));
          return;
        }
        if (method === "thread/tokenUsage/updated") {
          if (params?.tokenUsage?.last) lastRawUsage = params.tokenUsage.last;
          if (params?.tokenUsage?.modelContextWindow) {
            modelContextWindow = params.tokenUsage.modelContextWindow;
          }
        } else if (method === "error" && params?.willRetry === false) {
          const msgText =
            typeof params.error === "string"
              ? params.error
              : params.error?.message || JSON.stringify(params.error || params);
          reject(this.#classifyError(`Codex review error: ${msgText}`));
        } else if (method === "turn/completed") {
          resolve(params?.turn || { status: "completed" });
        } else {
          const message = timeline.handle(method, params);
          if (message) finalText = message;
        }
      });
    });

    try {
      const startRes = await this.#request("review/start", {
        threadId,
        delivery: "inline",
        target,
      });
      this.#setActiveTurnId(threadId, startRes?.turn?.id);
      const completedTurn = await completedPromise;
      const usage = normalizeUsage(
        "codex",
        lastRawUsage ? { ...lastRawUsage, modelContextWindow } : null
      );
      return {
        sessionId: threadId,
        interrupted: completedTurn?.status === "interrupted",
        reused: threadInfo.reused,
        resolvedModel: threadInfo.resolvedModel || model?.modelName || "gpt-6.2-sol",
        text: finalText || "(review completed with empty text)",
        usage,
        elapsedMs: Date.now() - t0,
      };
    } finally {
      this.turnListeners.delete(threadId);
      this.activeTurns.delete(threadId);
      timeline.finish();
    }
  }

  async compactSession(sessionId) {
    await this.ensureConnected();
    return this.#request("thread/compact/start", { threadId: sessionId });
  }

  async forkSession(sessionId, cwd, role) {
    await this.ensureConnected();
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
    const res = await this.#request("thread/fork", {
      threadId: sessionId,
      cwd,
      sandbox: spec.sandbox,
      approvalPolicy: "never",
    });
    const newId = res?.thread?.id;
    if (newId) {
      this.loadedThreads.add(newId);
      this.threadRoles.set(newId, role);
    }
    return { sessionId: newId };
  }

  async steerTurn(sessionId, text) {
    await this.ensureConnected();
    const active = this.activeTurns.get(sessionId);
    return this.#request("turn/steer", {
      threadId: sessionId,
      ...(active?.id ? { expectedTurnId: active.id } : {}),
      input: [{ type: "text", text }],
    });
  }

  #setActiveTurnId(threadId, id) {
    const turn = this.activeTurns.get(threadId);
    if (!turn || !id) return;
    turn.id = id;
    if (turn.interruptPending) {
      turn.interruptPending = false;
      void this.#request("turn/interrupt", { threadId, turnId: id }).catch(() => {});
    }
  }

  async interruptTurn(sessionId) {
    const turn = this.activeTurns.get(sessionId);
    if (!turn) return;
    if (!turn.id) {
      turn.interruptPending = true;
      return;
    }
    return this.#request("turn/interrupt", { threadId: sessionId, turnId: turn.id });
  }

  async deleteSession(sessionId) {
    if (!sessionId) return;
    try {
      await this.ensureConnected();
      await this.#request("thread/delete", { threadId: sessionId });
    } catch {}
    this.loadedThreads.delete(sessionId);
    this.threadRoles.delete(sessionId);
    this.threadSandboxes.delete(sessionId);
  }

  async healthCheck() {
    const t0 = Date.now();
    await this.ensureConnected();
    const rateLimits = await this.readRateLimits(true);
    return {
      ok: true,
      engine: "codex",
      version: this.serverVersion,
      latencyMs: Date.now() - t0,
      rateLimits,
    };
  }

  async shutdown() {
    const p = this.proc;
    this.proc = null;
    this.initialized = false;
    this.loadedThreads.clear();
    await safeKill(p);
  }
}
