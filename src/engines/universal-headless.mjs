import { spawn } from "node:child_process";
import { ROLE_SPECS } from "../core/constants.mjs";
import { resolveCliPresetBinary } from "../core/paths.mjs";
import { normalizeUsage } from "../core/telemetry.mjs";
import { safeKill, utf8Env } from "./base.mjs";
import { launchForShell, markRateLimitError } from "./universal-acp.mjs";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const HEALTH_TIMEOUT_MS = 8_000;

function oneLine(text, max = 140) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildPrompt(prompt, role) {
  const spec = ROLE_SPECS[role] || ROLE_SPECS.oracle;
  return `[Role Instructions]\n${spec.developerInstructions}\n\n[Task]\n${prompt}`;
}

/** Replace `{prompt}` inside an argv slot; append when no placeholder exists. Never joins a shell string. */
export function buildHeadlessArgv(template, prompt) {
  const args = Array.isArray(template) ? [...template] : [];
  let replaced = false;
  const out = args.map((arg) => {
    if (typeof arg !== "string" || !arg.includes("{prompt}")) return arg;
    replaced = true;
    return arg.replaceAll("{prompt}", prompt);
  });
  if (!replaced) out.push(prompt);
  return out;
}

export class UniversalHeadlessEngine {
  constructor(descriptor, resolveBinaryFn = resolveCliPresetBinary) {
    this.id = descriptor.id;
    this.descriptor = descriptor;
    this.resolveBinaryFn = resolveBinaryFn;
    this.proc = null;
    this.latestModels = [];
  }

  #resolveBinary() {
    const bin = this.resolveBinaryFn?.(this.descriptor);
    if (!bin?.command) {
      throw new Error(
        `${this.descriptor.labelEn || this.id} CLI is not installed. Install via: ${this.descriptor.installCmd || "(see docs)"}`
      );
    }
    return bin;
  }

  async runTurn({ cwd, role, prompt, model, onActivity, timeoutMs, absoluteTimeoutMs }) {
    const startedAt = Date.now();
    const bin = this.#resolveBinary();
    const fullPrompt = buildPrompt(String(prompt || ""), role);
    const args = buildHeadlessArgv(this.descriptor.args, fullPrompt);
    const launched = launchForShell(bin.command, args, bin.useShell);
    const proc = spawn(launched.command, launched.args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: utf8Env(),
    });
    this.proc = proc;
    let stdout = "";
    let stderr = "";
    let lastEmit = 0;
    const emit = (status = "running", final = false) => {
      const now = Date.now();
      if (!final && now - lastEmit < 800) return;
      lastEmit = now;
      const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`;
      onActivity?.({
        id: `headless_${startedAt}`,
        type: "output",
        kind: "output",
        title: oneLine(stdout || stderr || "receiving output"),
        status,
        summary: oneLine(stdout || stderr || "(no output yet)"),
        detail: combined.slice(0, 4000),
      });
    };
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      emit();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      emit();
    });
    emit();

    const limit = Math.max(1000, Number(timeoutMs || absoluteTimeoutMs) || DEFAULT_TIMEOUT_MS);
    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        safeKill(proc).catch(() => {});
        const err = new Error(`[${this.id}] headless turn exceeded ${limit}ms`);
        err.isPromptTimeout = true;
        finish({ error: err });
      }, limit);
      timer.unref?.();
      proc.on("error", (err) => finish({ error: err }));
      proc.on("exit", (code, signal) => finish({ code, signal }));
    });
    this.proc = null;

    if (outcome.error) throw markRateLimitError(outcome.error, stderr);
    if (outcome.code !== 0) {
      const err = new Error(
        `[${this.id}] headless CLI exited with code ${outcome.code}${outcome.signal ? ` (${outcome.signal})` : ""}: ${oneLine(stderr, 400)}`
      );
      throw markRateLimitError(err, stderr);
    }
    const text = stdout.trim() || stderr.trim() || "(no response text)";
    emit("done", true);
    return {
      sessionId: "",
      turnId: "",
      reused: false,
      resumedFromDisk: false,
      resolvedModel: model?.modelName || `${this.id}:default`,
      appliedEffort: "medium",
      text,
      stopReason: "end_turn",
      truncated: false,
      usage: normalizeUsage("universal-headless", null),
      usageProvenance: { source: "none", scope: "headless", skipReason: "headless-cli-reports-no-usage" },
      actions: [],
      elapsedMs: Date.now() - startedAt,
    };
  }

  async listModels() {
    const label = this.descriptor.labelEn || this.descriptor.labelZh || this.id;
    const labelZh = this.descriptor.labelZh || label;
    this.latestModels = [
      {
        id: `cli:${this.id}:default`,
        modelName: "",
        displayName: `${label} (Default)`,
        displayNameZh: `${labelZh}（默认）`,
        isDefault: true,
        engine: this.id,
      },
    ];
    return this.latestModels;
  }

  async healthCheck() {
    const startedAt = Date.now();
    let proc = null;
    let timer = null;
    try {
      const bin = this.#resolveBinary();
      const launched = launchForShell(bin.command, ["--version"], bin.useShell);
      proc = spawn(launched.command, launched.args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: utf8Env(),
      });
      const result = await new Promise((resolve, reject) => {
        let out = "";
        timer = setTimeout(() => reject(new Error(`[${this.id}] --version timeout`)), HEALTH_TIMEOUT_MS);
        timer.unref?.();
        proc.stdout.on("data", (chunk) => {
          out += chunk.toString();
        });
        proc.on("error", reject);
        proc.on("exit", (code) => resolve({ code, out }));
      });
      const version = String(result.out || "").trim().split(/\r?\n/)[0]?.slice(0, 80) || "";
      return {
        ok: result.code === 0 && Boolean(version),
        latencyMs: Date.now() - startedAt,
        version,
        error: result.code === 0 ? undefined : `exited with code ${result.code}`,
      };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - startedAt, version: "", error: err?.message || String(err) };
    } finally {
      if (timer) clearTimeout(timer);
      if (proc) await safeKill(proc).catch(() => {});
    }
  }

  async interruptTurn() {
    if (!this.proc) return false;
    await safeKill(this.proc).catch(() => {});
    this.proc = null;
    return true;
  }

  async shutdown() {
    await this.interruptTurn().catch(() => {});
  }
}
