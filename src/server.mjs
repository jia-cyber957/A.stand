import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { API_PROVIDERS, CLI_ENGINES_META, PLUGIN_VERSION } from "./core/constants.mjs";
import { RelayOrchestrator } from "./core/orchestrator.mjs";
import { RelayStore } from "./core/store.mjs";
import { TelemetryLogger } from "./core/telemetry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseCliArgs(argv) {
  const opts = { dataDir: "", htmlPath: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data-dir" && argv[i + 1]) opts.dataDir = argv[++i];
    else if (a.startsWith("--data-dir=")) opts.dataDir = a.slice("--data-dir=".length);
    else if (a === "--html" && argv[i + 1]) opts.htmlPath = argv[++i];
    else if (a.startsWith("--html=")) opts.htmlPath = a.slice("--html=".length);
  }
  return opts;
}

const cliOpts = parseCliArgs(process.argv.slice(2));
const DATA_DIR = cliOpts.dataDir || process.env.PLUGIN_DATA || path.join(__dirname, "..", "data");
const HTML_PATH = cliOpts.htmlPath || process.env.AGENT_RELAY_HTML || path.join(__dirname, "console.html");

const APP_URI = "ui://agent-relay/console.html";
const APP_ONLY_META = { ui: { visibility: ["app"] } };
const isCodexPlugin = Boolean(process.env.AGENT_RELAY_CODEX_PLUGIN_ID);
const roleSettings = z.object({
  modelId: z.string().optional(),
  queue: z.array(z.string()).optional(),
  selectionMode: z.enum(["ordered", "smart"]).optional(),
  effort: z.enum(["off", "low", "medium", "high"]).optional(),
  customRules: z.string().max(4000).optional(),
});
const chatSettings = {
  enabled: z.boolean().optional(),
  lang: z.enum(["zh", "en"]).optional(),
  maxConcurrency: z.number().int().min(1).max(6).optional(),
  silentCheckinMin: z.number().int().min(1).max(30).optional(),
  longRunCheckinMin: z.number().int().min(0).max(120).optional(),
  autoFallbackOnLimit: z.boolean().optional(),
  roles: z.object({ oracle: roleSettings.optional(), hephaestus: roleSettings.optional() }).optional(),
};

const store = new RelayStore(DATA_DIR);
const telemetry = new TelemetryLogger(DATA_DIR);
const orchestrator = new RelayOrchestrator(store, telemetry);
const UI_TRACE_PATH = path.join(DATA_DIR, "ui-trace.json");

function recordUiTrace(patch) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let cur = {};
    if (fs.existsSync(UI_TRACE_PATH)) {
      try {
        cur = JSON.parse(fs.readFileSync(UI_TRACE_PATH, "utf8")) || {};
      } catch {
        cur = {};
      }
    }
    const next = { ...cur, ...patch };
    fs.writeFileSync(UI_TRACE_PATH, JSON.stringify(next, null, 2), "utf8");
  } catch {}
}

async function buildFullUiPayload(forceDetect = false, fetchRateLimits = false) {
  return {
    version: PLUGIN_VERSION,
    dataDir: DATA_DIR,
    providers: API_PROVIDERS,
    cliEnginesMeta: CLI_ENGINES_META,
    ...(await orchestrator.getDashboardState(forceDetect, fetchRateLimits)),
  };
}

function makeHeartbeat(extra) {
  const token = extra?._meta?.progressToken;
  if (!token || typeof extra?.sendNotification !== "function") return undefined;
  return (progress, message) => {
    extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress, message },
      })
      .catch(() => {});
  };
}

const server = new McpServer(
  { name: "agent-relay", version: PLUGIN_VERSION },
  { capabilities: { tools: {}, resources: {} } }
);

// 1. UI Resource for MCP App Console
server.registerResource(
  "agent-relay-console",
  APP_URI,
  {
    title: "A.stand Console",
    description: "Interactive control panel, quota tracker, live activity feed, and Prompt Cache monitor",
    mimeType: "text/html;profile=mcp-app",
    _meta: { ui: { prefersBorder: false } },
  },
  async () => {
    const html = fs.existsSync(HTML_PATH)
      ? fs.readFileSync(HTML_PATH, "utf8")
      : `<!doctype html><html><body style="font-family:sans-serif;padding:16px">A.stand UI bundle missing at ${HTML_PATH}. Run npm run build.</body></html>`;
    recordUiTrace({
      lastResourceReadAt: new Date().toISOString(),
      htmlBytes: Buffer.byteLength(html),
      htmlPath: HTML_PATH,
    });
    return {
      contents: [
        {
          uri: APP_URI,
          mimeType: "text/html;profile=mcp-app",
          text: html,
          _meta: { ui: { prefersBorder: false } },
        },
      ],
    };
  }
);

// 2. UI Entrypoint Tool (aux_pane + left sidebar global view)
server.registerTool(
  "agent_relay_console",
  {
    title: "A.stand",
    description:
      "Open the A.stand control panel to toggle external subagents, manage AI priority queues, inspect GPT 5h/7d quotas, watch live subagent activity, and monitor real Prompt Cache hit rates.",
    inputSchema: {},
    _meta: {
      ui: { resourceUri: APP_URI },
      "ui/resourceUri": APP_URI,
      ...(isCodexPlugin && { "openai/outputTemplate": APP_URI }),
      "com.google.antigravity/ui": {
        entrypoints: [
          { type: "aux_pane", title: "A.stand" },
          { type: "global", title: "A.stand" },
        ],
      },
    },
  },
  async () => {
    const t0 = Date.now();
    const payload = await buildFullUiPayload(false, false);
    recordUiTrace({
      lastConsoleToolAt: new Date().toISOString(),
      lastConsoleLatencyMs: Date.now() - t0,
    });
    const statusText = payload.settings.enabled ? "ON" : "OFF";
    const hit = payload.telemetry.cumulativeHitRate != null ? `${payload.telemetry.cumulativeHitRate}%` : "N/A";
    return {
      content: [
        {
          type: "text",
          text: `A.stand console opened (Master Switch: ${statusText}, Cumulative Cache Hit Rate: ${hit}, Turns: ${payload.telemetry.totalTurns}).`,
        },
      ],
      structuredContent: payload,
    };
  }
);

// 3. Model-Visible Tools (4 concise tools)
server.registerTool(
  "agent_relay_ask",
  {
    title: "Delegate task to persistent external subagent",
    description:
      "Send a task to a persistent external AI subagent ('oracle' read-only advisor/reviewer — supports parallel slots; 'hephaestus' workspace-write engineer — write-mutex guarded by default, or parallel Git worktree writers via worktree=true when allowWorktreeParallelWrite is ON). Respects the master switch, concurrency cap, and priority fallback queue. Uses zero-token heartbeats and non-interrupting check-ins (never auto-kills). Async replies include a ready-to-run `node wait-job.mjs --data-dir <dataDir> <jobId>` doorbell for zero-token background wakeups.",
    inputSchema: {
      role: z.enum(["oracle", "hephaestus"]).default("oracle"),
      cwd: z.string().describe("Absolute workspace directory path."),
      prompt: z
        .string()
        .describe("Turn 1: goal, constraints, file paths. Turn 2+: concise incremental delta only."),
      sessionId: z
        .string()
        .optional()
        .describe("Optional existing sessionId to resume the same task's context & Prompt Cache. Omit to start a clean new session."),
      title: z
        .string()
        .optional()
        .describe("Optional short task title shown in the Team panel and status list."),
      slot: z
        .string()
        .optional()
        .describe("Optional parallel slot name for read-only oracle (e.g. 'security', 'perf'). Ignored for hephaestus."),
      waitSec: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .optional()
        .describe(
          "Optional check-in wait in seconds. Pass 0 to launch asynchronously and return jobId immediately (use for true parallel launches), or omit/set 5-120 to wait (capped at 120s). When the user enables Async Background Mode and this is omitted, the launch is automatically async and the reply includes a zero-token `wait-job.mjs` doorbell command."
        ),
      effort: z.enum(["off", "low", "medium", "high"]).optional(),
      sandbox: z
        .enum(["workspace-write", "danger-full-access"])
        .optional()
        .describe(
          "Optional sandbox mode for hephaestus only. 'danger-full-access' is strictly gated by the user's allowHephaestusFullAccess setting (downgraded to 'workspace-write' if disabled). Ignored for oracle (always read-only)."
        ),
      forceNew: z.boolean().optional(),
      modelId: z
        .string()
        .optional()
        .describe(
          "Optional model id for this turn. Honored only when roles.<role>.selectionMode='smart' AND the id is already in that role's configured queue; it is promoted to the front and the remaining queue stays as fallback order. In 'ordered' mode (default) it is ignored with a note. Invalid ids return an actionable error."
        ),
      conversationId: z
        .string()
        .optional()
        .describe("Optional opaque conversation/thread id persisted with the job so a later durable handoff can match the exact thread without guessing."),
      worktree: z.boolean().optional().describe(
        "Request an isolated Git worktree (branch astand/<jobId>) for hephaestus when allowWorktreeParallelWrite is enabled. Use with waitSec=0 to proactively split large independent multi-module work across 2-3 parallel hephaestus jobs on non-overlapping file sets; a busy Git checkout also auto-triggers isolation."
      ),
    },
  },
  async (args, extra) => {
    try {
      const res = await orchestrator.ask({ ...args, onHeartbeat: makeHeartbeat(extra) });
      return {
        content: [{ type: "text", text: res.text }],
        isError: Boolean(res.status === "failed"),
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `A.stand error: ${err?.message || String(err)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "agent_relay_poll",
  {
    title: "Inspect or wait on running subagent job(s) (non-interrupting)",
    description:
      "Inspect or wait on one running subagent (`jobId`) or multiple parallel subagents (`jobIds`) without interrupting them. Pass waitSec=0 & detail='full' for immediate non-blocking inspection, or omit waitSec to wait until completion or next check-in (capped at 120s).",
    inputSchema: {
      jobId: z.string().optional().describe("Single running jobId to poll."),
      jobIds: z
        .array(z.string())
        .min(1)
        .max(6)
        .optional()
        .describe("Multiple parallel jobIds to wait on together in one call."),
      waitSec: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .optional()
        .describe("0 for immediate inspection. Blocking waits are capped at 120 seconds."),
      detail: z.enum(["summary", "full"]).optional().default("summary"),
    },
  },
  async ({ jobId, jobIds, waitSec, detail }, extra) => {
    const hb = makeHeartbeat(extra);
    const res =
      Array.isArray(jobIds) && jobIds.length > 0
        ? await orchestrator.pollMany(jobIds, { waitSec, detail, onHeartbeat: hb })
        : jobId
        ? await orchestrator.poll(jobId, { waitSec, detail, onHeartbeat: hb })
        : { status: "not_found", text: "Provide jobId or jobIds." };
    return {
      content: [{ type: "text", text: res.text }],
      isError: res.status === "failed" || res.status === "not_found",
    };
  }
);

server.registerTool(
  "agent_relay_review",
  {
    title: "Run independent code review via Oracle subagent",
    description: "Run an adversarial read-only code review on uncommitted changes, a branch diff, a commit, or custom scope.",
    inputSchema: {
      cwd: z.string(),
      targetType: z.enum(["uncommittedChanges", "baseBranch", "commit", "custom"]).default("uncommittedChanges"),
      branch: z.string().optional(),
      sha: z.string().optional(),
      instructions: z.string().optional(),
      sessionId: z
        .string()
        .optional()
        .describe("Optional existing sessionId to resume the same task's context & Prompt Cache. Omit to start a clean new session."),
      title: z
        .string()
        .optional()
        .describe("Optional short task title shown in the Team panel and status list."),
      modelId: z
        .string()
        .optional()
        .describe(
          "Optional model id for this review. Honored only when roles.oracle.selectionMode='smart' AND the id is in the oracle configured queue; the rest of the queue remains the fallback order."
        ),
      conversationId: z
        .string()
        .optional()
        .describe("Optional opaque conversation/thread id persisted with the review job for durable handoff matching."),
      waitSec: z.number().int().min(0).max(1800).optional(),
    },
  },
  async (args, extra) => {
    try {
      const res = await orchestrator.review({ ...args, onHeartbeat: makeHeartbeat(extra) });
      return {
        content: [{ type: "text", text: res.text }],
        isError: Boolean(res.status === "failed"),
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `A.stand review error: ${err?.message || String(err)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "agent_relay_session",
  {
    title: "Inspect settings/quotas or control persistent subagent sessions",
    description:
      "Read live A.stand settings (concurrency cap, check-in timers, per-role selectionMode + priority queues, quotas) via action='status'; control a session (compact, fork, steer, interrupt, reset); or recover/ACK a durable handoff from disk via action='recover' / action='ack' (never restarts a stopped job, never consumes unread output).",
    inputSchema: {
      action: z.enum(["status", "recover", "ack", "compact", "fork", "steer", "interrupt", "reset"]),
      cwd: z.string().optional(),
      role: z.enum(["oracle", "hephaestus"]).optional().default("oracle"),
      slot: z.string().optional().default("default"),
      sessionId: z.string().optional(),
      jobId: z.string().optional().describe("Optional running jobId for interrupt, or the exact jobId for recover/ack."),
      jobIds: z.array(z.string()).max(10).optional().describe("Exact jobIds for recover/ack (multi-job handoff)."),
      conversationId: z
        .string()
        .optional()
        .describe("Optional thread id used to scope recover so it never borrows another thread's jobs."),
      kind: z
        .enum(["result_ack", "user_accept"])
        .optional()
        .describe("For action='ack': result_ack means the Lead read the result (NOT user acceptance); user_accept means the user approved it."),
      message: z.string().optional().describe("Steering message when action='steer'."),
    },
  },
  async (args) => {
    try {
      const res = await orchestrator.sessionAction(args);
      const text = typeof res.text === "string" ? res.text : JSON.stringify(res, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Session action error: ${err?.message || String(err)}` }],
        isError: true,
      };
    }
  }
);

if (isCodexPlugin) {
  server.registerTool(
    "agent_relay_configure",
    {
      title: "View or change A.stand settings",
      description:
        "Read the current settings and model IDs with an empty patch. Change settings only when the user explicitly asks. Use this tool when the interactive panel is unavailable.",
      inputSchema: { patch: z.object(chatSettings).strict().optional() },
    },
    async ({ patch }) => {
      const settings = patch && Object.keys(patch).length > 0
        ? store.updateTopSettings(patch)
        : store.getPublicState();
      const summary = Object.fromEntries(Object.keys(chatSettings).map((key) => [key, settings[key]]));
      const models = settings.models.map(({ id, name, engine }) => ({ id, name, engine }));
      return {
        content: [{ type: "text", text: JSON.stringify({ settings: summary, models }, null, 2) }],
      };
    }
  );
}

// 4. App-Only UI Tools (hidden from host model via visibility: ["app"])
server.registerTool(
  "agent_relay_ui_get_state",
  {
    title: "UI get dashboard state",
    inputSchema: {
      forceDetect: z.boolean().optional(),
      fetchRateLimits: z.boolean().optional(),
      clientDiag: z.record(z.any()).optional(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ forceDetect, fetchRateLimits, clientDiag }) => {
    recordUiTrace({
      lastUiStateCallAt: new Date().toISOString(),
      fetchRateLimits: Boolean(fetchRateLimits),
      ...(clientDiag ? { lastUiDiag: clientDiag } : {}),
    });
    const payload = await buildFullUiPayload(Boolean(forceDetect), Boolean(fetchRateLimits));
    return { content: [{ type: "text", text: "ok" }], structuredContent: payload };
  }
);

server.registerTool(
  "agent_relay_ui_get_job_detail",
  {
    title: "UI get job detail timeline",
    inputSchema: { jobId: z.string() },
    _meta: APP_ONLY_META,
  },
  async ({ jobId }) => {
    const detail = orchestrator.getJobDetail(jobId);
    return {
      content: [{ type: "text", text: detail.ok ? "ok" : detail.error || "not found" }],
      structuredContent: detail,
      isError: !detail.ok,
    };
  }
);

server.registerTool(
  "agent_relay_ui_update_settings",
  {
    title: "UI update settings",
    inputSchema: {
      ...chatSettings,
      codexKeepOfficePlugins: z.boolean().optional(),
      allowHephaestusFullAccess: z.boolean().optional(),
      allowWorktreeParallelWrite: z.boolean().optional(),
      retentionDays: z.number().int().min(0).max(3650).optional(),
      asyncBackgroundMode: z.boolean().optional(),
      inspectorEnabled: z.boolean().optional(),
      inspectorModelId: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (patch) => {
    store.updateTopSettings(patch);
    const payload = await buildFullUiPayload(false, false);
    return { content: [{ type: "text", text: "saved" }], structuredContent: payload };
  }
);

server.registerTool(
  "agent_relay_ui_upsert_model",
  {
    title: "UI save AI model profile",
    inputSchema: {
      id: z.string().optional(),
      name: z.string().optional(),
      mode: z.enum(["cli", "api"]).default("api"),
      engine: z.enum(["codex", "claude-code", "antigravity", "deepseek-harness"]).optional(),
      providerId: z.string().optional(),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      modelName: z.string().optional(),
      modelNames: z.array(z.string()).optional(),
      setAsInspector: z.boolean().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (input) => {
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
    const payload = await buildFullUiPayload(false, false);
    return {
      content: [{ type: "text", text: `saved:${lastSavedModelId}` }],
      structuredContent: { ...payload, lastSavedModelId, savedIds },
    };
  }
);

server.registerTool(
  "agent_relay_ui_upsert_channel",
  {
    title: "UI save API channel and its models",
    inputSchema: {
      id: z.string().min(1).optional(),
      name: z.string().optional(),
      providerId: z.string().optional(),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      modelNames: z.array(z.string()),
      setAsInspector: z.boolean().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (input) => {
    const channel = store.upsertChannel(input);
    const payload = await buildFullUiPayload(false, false);
    return {
      content: [{ type: "text", text: "saved" }],
      structuredContent: { ...payload, lastSavedChannelId: channel.id },
    };
  }
);

server.registerTool(
  "agent_relay_ui_delete_channel",
  {
    title: "UI delete API channel",
    inputSchema: { channelId: z.string().min(1) },
    _meta: APP_ONLY_META,
  },
  async ({ channelId }) => {
    store.deleteChannel(channelId);
    return { content: [{ type: "text", text: "deleted" }], structuredContent: await buildFullUiPayload(false, false) };
  }
);

server.registerTool(
  "agent_relay_ui_remove_channel_model",
  {
    title: "UI remove a model from an API channel",
    inputSchema: {
      channelId: z.string().min(1),
      modelId: z.string().min(1).optional(),
      modelName: z.string().min(1).optional(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ channelId, modelId, modelName }) => {
    if (!modelId && !modelName?.trim()) throw new Error("Provide a model ID or model name.");
    store.removeChannelModel(channelId, modelName, modelId);
    return { content: [{ type: "text", text: "deleted" }], structuredContent: await buildFullUiPayload(false, false) };
  }
);

server.registerTool(
  "agent_relay_ui_fetch_models",
  {
    title: "UI fetch upstream OpenAI-compatible models",
    inputSchema: {
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      modelId: z.string().optional(),
      channelId: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (input) => {
    const res = await orchestrator.fetchProviderModels(input);
    return {
      content: [{ type: "text", text: res.ok ? "ok" : res.error || "failed" }],
      structuredContent: res,
    };
  }
);

server.registerTool(
  "agent_relay_ui_delete_model",
  {
    title: "UI delete custom AI model",
    inputSchema: { modelId: z.string().min(1) },
    _meta: APP_ONLY_META,
  },
  async ({ modelId }) => {
    store.deleteModel(modelId);
    const payload = await buildFullUiPayload(false, false);
    return { content: [{ type: "text", text: "deleted" }], structuredContent: payload };
  }
);

server.registerTool(
  "agent_relay_ui_test_connection",
  {
    title: "UI test CLI or API connection",
    inputSchema: {
      mode: z.enum(["cli", "api"]),
      engine: z.enum(["codex", "claude-code", "antigravity", "deepseek-harness"]).optional(),
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      modelName: z.string().optional(),
      modelId: z.string().optional(),
      channelId: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async (input) => {
    const res = await orchestrator.testConnection(input);
    return { content: [{ type: "text", text: res.ok ? "ok" : res.error || "failed" }], structuredContent: res };
  }
);

server.registerTool(
  "agent_relay_ui_session_action",
  {
    title: "UI control persistent session or job",
    inputSchema: {
      action: z.enum(["compact", "reset", "interrupt", "clear_cooldown"]),
      sessionId: z.string().optional(),
      jobId: z.string().optional(),
      modelId: z.string().optional(),
    },
    _meta: APP_ONLY_META,
  },
  async ({ action, sessionId, jobId, modelId }) => {
    let res;
    if (action === "clear_cooldown" && modelId) {
      store.clearCooldown(modelId);
      res = { ok: true, text: "cooldown cleared" };
    } else if (action === "interrupt" && jobId) {
      res = await orchestrator.stopJob(jobId);
    } else {
      res = await orchestrator.sessionAction({ action, sessionId });
    }
    const payload = await buildFullUiPayload(false, false);
    return {
      content: [{ type: "text", text: res.text || "done" }],
      structuredContent: { ...payload, actionResult: res },
    };
  }
);

server.registerTool(
  "agent_relay_ui_dismiss_interrupted",
  {
    title: "UI dismiss interrupted job warning",
    description: "Acknowledge crash-recovery banners (optionally for one jobId) so they stop showing in the Team view.",
    inputSchema: { jobId: z.string().optional() },
    _meta: APP_ONLY_META,
  },
  async ({ jobId }) => {
    const res = orchestrator.dismissInterrupted(jobId);
    const payload = await buildFullUiPayload(false, false);
    return {
      content: [{ type: "text", text: res.text || "dismissed" }],
      structuredContent: { ...payload, actionResult: res },
    };
  }
);

server.registerTool(
  "agent_relay_ui_clear_logs",
  {
    title: "UI clear telemetry logs",
    inputSchema: {},
    _meta: APP_ONLY_META,
  },
  async () => {
    telemetry.clear();
    const payload = await buildFullUiPayload(false, false);
    return { content: [{ type: "text", text: "cleared" }], structuredContent: payload };
  }
);

let shuttingDown = false;
async function cleanExit() {
  if (shuttingDown) return;
  shuttingDown = true;
  await orchestrator.shutdown();
  process.exit(0);
}

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
process.stdin.on("end", cleanExit);

const transport = new StdioServerTransport();
await server.connect(transport);
