import { spawn } from "node:child_process";
import readline from "node:readline";
import { ROLE_SPECS } from "../core/constants.mjs";
import { resolveGenericBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { safeKill, utf8Env } from "./base.mjs";

/**
 * Official Antigravity CLI (`agy`) adapter for headless delegation & cross-host readiness.
 * Zero mutation to ~/.gemini/antigravity-cli/settings.json.
 */
export class AntigravityCliEngine {
  constructor() {
    this.id = "antigravity";
    this.activeProcs = new Map();
  }

  async runTurn({ cwd, role, model, prompt, existingSessionId, onActivity, onSessionReady }) {
    const bin = resolveGenericBinary("agy");
    if (!bin) {
      throw new Error(
        "Antigravity CLI (`agy`) not found in PATH. See https://antigravity.google/docs/getting-started"
      );
    }

    const t0 = Date.now();
    const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
    const args = [];
    if (existingSessionId) args.push("--resume", existingSessionId);
    if (model?.modelName) args.push("--model", model.modelName);
    const fullPrompt = existingSessionId
      ? prompt
      : `[Role]\n${spec.developerInstructions}\n\n[Task]\n${prompt}`;
    args.push("-p", fullPrompt);

    const proc = spawn(bin.command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: bin.useShell,
      env: utf8Env(),
    });

    const sessionId = existingSessionId || `agy-${Date.now()}`;
    onSessionReady?.(sessionId);
    const procKey = sessionId;
    this.activeProcs.set(procKey, proc);
    const stdoutLines = [];
    const stderrLines = [];

    return new Promise((resolve, reject) => {
      readline.createInterface({ input: proc.stdout }).on("line", (l) => {
        stdoutLines.push(l);
        onActivity?.({ type: "touch" });
      });
      readline.createInterface({ input: proc.stderr }).on("line", (l) => stderrLines.push(l));
      proc.on("error", (err) => {
        this.activeProcs.delete(procKey);
        reject(err);
      });
      proc.on("close", (code) => {
        this.activeProcs.delete(procKey);
        const text = stdoutLines.join("\n").trim();
        if (code !== 0 && !text) {
          reject(new Error(`agy exited (${code}): ${stderrLines.slice(-5).join(" | ")}`));
          return;
        }
        resolve({
          sessionId,
          turnId: "",
          reused: Boolean(existingSessionId),
          resumedFromDisk: Boolean(existingSessionId),
          resolvedModel: model?.modelName || "antigravity-cli",
          text: text || "(no response text)",
          usage: normalizeUsage("antigravity", null),
          actions: [],
          elapsedMs: Date.now() - t0,
        });
      });
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
