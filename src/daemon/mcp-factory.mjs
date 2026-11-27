import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PLUGIN_VERSION } from "../core/constants.mjs";

// Identical model-visible tool schemas to src/server.mjs (keep both in sync).
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

export const MODEL_VISIBLE_TOOLS = ["agent_relay_ask", "agent_relay_poll", "agent_relay_review", "agent_relay_session"];

/**
 * Build an McpServer bound to one authenticated upstream client slot.
 * Each HTTP/stdio-bridge session gets its own instance so client attribution never leaks.
 */
export function createRelayMcpServer({
  store,
  telemetry,
  orchestrator,
  clientRegistry,
  clientId,
  transportKind = "http",
  onEvent,
  onToolCall,
} = {}) {
  if (!orchestrator) throw new Error("createRelayMcpServer requires an orchestrator");
  if (!clientRegistry) throw new Error("createRelayMcpServer requires a clientRegistry");

  const emit = (reason) => {
    try {
      onEvent?.(reason);
    } catch {}
  };

  // Resolved lazily on every call so display-name / icon edits apply to the very next turn.
  const clientContext = () => {
    const publicClient = clientRegistry.getPublic?.(clientId);
    if (!publicClient) return { clientId, clientLabel: "", iconKey: "generic" };
    return {
      clientId,
      clientLabel: publicClient.customName || publicClient.label || "",
      iconKey: publicClient.customIconKey || publicClient.iconKey || "generic",
    };
  };

  const recordCall = (toolName = "", meta = {}) => {
    try {
      clientRegistry.recordCall(clientId, transportKind);
    } catch {}
    try {
      const ctx = clientContext();
      onToolCall?.({
        clientId,
        clientLabel: ctx.clientLabel,
        transport: transportKind,
        toolName,
        ...meta,
      });
    } catch {}
  };

  const server = new McpServer(
    { name: "a-stand", version: PLUGIN_VERSION },
    { capabilities: { tools: {} } }
  );

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
        resumeJobId: z.string().optional().describe("Continue a matching host-interrupted job returned by recover, with its original workspace, role and model."),
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
      recordCall("agent_relay_ask", { role: args.role || "oracle", worktree: Boolean(args.worktree), resumed: Boolean(args.sessionId) });
      try {
        const res = await orchestrator.ask({
          ...args,
          clientContext: clientContext(),
          onHeartbeat: makeHeartbeat(extra),
        });
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
      recordCall("agent_relay_poll", { count: Array.isArray(jobIds) ? jobIds.length : jobId ? 1 : 0 });
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
      recordCall("agent_relay_review", { targetType: args.targetType || "uncommittedChanges" });
      try {
        const res = await orchestrator.review({
          ...args,
          clientContext: clientContext(),
          onHeartbeat: makeHeartbeat(extra),
        });
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
        role: z.enum(["oracle", "hephaestus"]).optional(),
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
      recordCall("agent_relay_session", { action: args.action || "" });
      try {
        const res = await orchestrator.sessionAction(args);
        const text = typeof res.text === "string" ? res.text : JSON.stringify(res, null, 2);
        const handoff = args.action === "recover" || args.action === "ack";
        return { content: [{ type: "text", text }], ...(handoff && { structuredContent: res }) };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Session action error: ${err?.message || String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // The SDK fires this only when the client sends `notifications/initialized`.
  // http-server.mjs additionally records the handshake from the initialize body as a fallback,
  // so this hook must never erase richer info captured there (empty name/version is a no-op).
  server.server.oninitialized = () => {
    try {
      const info = server.server.getClientVersion?.();
      clientRegistry.recordHandshake(clientId, {
        name: info?.name || "",
        version: info?.version || "",
        transport: transportKind,
      });
      emit("client_connected");
    } catch {}
  };

  return server;
}
