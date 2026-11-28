import { spawn } from "node:child_process";
import readline from "node:readline";
import { ROLE_SPECS } from "../core/constants.mjs";
import { resolveGenericBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { safeKill, utf8EnvChecked } from "./base.mjs";

/**
 * Official Claude Code CLI adapter (`claude -p --output-format stream-json --resume`).
 * Zero mutation to ~/.claude — all scoping & permissions are passed via ephemeral flags.
 */
export class ClaudeCodeEngine {
  constructor() {
    this.id = "claude-code";
    this.activeProcs = new Map(); // sessionId -> proc
  }

  async runTurn({ cwd, role, model, sandbox, prompt, existingSessionId, onActivity, onSessionReady }) {
    const bin = resolveGenericBinary("claude");
    if (!bin) {
      throw new Error(
        "Claude Code CLI (`claude`) not found. Install via: npm install -g @anthropic-ai/claude-code"
      );
    }

    const t0 = Date.now();
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
    const args = ["-p", "--output-format", "stream-json", "--verbose"];

    if (existingSessionId) {
      args.push("--resume", existingSessionId);
    } else {
      // Only set static role prompt on session creation so --resume prefix stays cache-stable
      args.push("--append-system-prompt", spec.developerInstructions);
    }

    if (model?.modelName) {
      args.push("--model", model.modelName);
    }

    if (role === "oracle") {
      args.push("--allowedTools", "Read,Glob,Grep,LS");
    } else if (sandbox === "danger-full-access") {
      args.push("--permission-mode", "bypassPermissions");
    } else {
      args.push("--permission-mode", "acceptEdits");
    }

    const proc = spawn(bin.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: bin.useShell,
      env: await utf8EnvChecked(),
    });

    const procKey = existingSessionId || `pending-${Date.now()}`;
    this.activeProcs.set(procKey, proc);

    let sessionId = existingSessionId || "";
    let finalText = "";
    let rawUsage = null;
    let resolvedModel = model?.modelName || "claude-code";
    const actions = [];
    const stderrLines = [];

    return new Promise((resolve, reject) => {
      readline.createInterface({ input: proc.stdout }).on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let ev;
        try {
          ev = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (ev.session_id) {
          sessionId = ev.session_id;
          onSessionReady?.(sessionId);
        }
        if (ev.type === "assistant" && ev.message) {
          if (ev.message.model) resolvedModel = ev.message.model;
          if (ev.message.usage) rawUsage = ev.message.usage;
          if (Array.isArray(ev.message.content)) {
            for (const block of ev.message.content) {
              if (block.type === "tool_use" && block.name) {
                actions.push(`tool: ${block.name}`);
                onActivity?.({ type: "cmd_start", summary: `tool: ${block.name}` });
              } else if (block.type === "text" && block.text) {
                finalText = block.text;
                onActivity?.({ type: "output", summary: `message (${block.text.length} chars)` });
              }
            }
          }
        } else if (ev.type === "result") {
          if (ev.session_id) sessionId = ev.session_id;
          if (typeof ev.result === "string" && ev.result) finalText = ev.result;
          if (ev.usage) rawUsage = ev.usage;
        }
      });

      readline.createInterface({ input: proc.stderr }).on("line", (line) => {
        if (line.trim()) stderrLines.push(line.trim());
      });

      proc.on("error", (err) => {
        this.activeProcs.delete(procKey);
        reject(err);
      });

      proc.on("close", (code) => {
        this.activeProcs.delete(procKey);
        if (code !== 0 && !finalText) {
          const msg = `claude exited (${code}): ${stderrLines.slice(-5).join(" | ")}`;
          const err = new Error(msg);
          const low = msg.toLowerCase();
          if (low.includes("rate limit") || low.includes("429") || low.includes("limit reached")) {
            err.isRateLimit = true;
            err.resetsAtMs = Date.now() + 5 * 60 * 60 * 1000;
          }
          reject(err);
          return;
        }
        resolve({
          sessionId,
          turnId: "",
          reused: Boolean(existingSessionId),
          resumedFromDisk: Boolean(existingSessionId),
          resolvedModel,
          text: finalText || "(no response text)",
          usage: normalizeUsage("claude-code", rawUsage),
          actions,
          elapsedMs: Date.now() - t0,
        });
      });

      proc.stdin.write(prompt);
      proc.stdin.end();
    });
  }

  async interruptTurn(sessionId) {
    const proc = this.activeProcs.get(sessionId);
    if (proc) {
      safeKill(proc);
      this.activeProcs.delete(sessionId);
    }
  }

  async shutdown() {
    const list = Array.from(this.activeProcs.values());
    this.activeProcs.clear();
    await Promise.allSettled(list.map((p) => safeKill(p)));
  }
}
