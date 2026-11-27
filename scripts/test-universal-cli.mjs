import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIBLE_CLI_PRESETS, listAllExtensibleCliDefs, sanitizeCustomCliEngine } from "../src/core/cli-registry.mjs";
import { detectEngines, resolveCliPresetBinary } from "../src/core/paths.mjs";
import { RelayStore } from "../src/core/store.mjs";
import { UniversalAcpEngine } from "../src/engines/universal-acp.mjs";
import { UniversalHeadlessEngine } from "../src/engines/universal-headless.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const results = [];
const WATCHDOG_MS = 60_000;

const watchdog = setTimeout(() => {
  console.error(`GLOBAL TIMEOUT after ${WATCHDOG_MS}ms`);
  process.exit(1);
}, WATCHDOG_MS);

const MOCK_ACP = `
import readline from "node:readline";
const argv = process.argv.slice(2);
const rateLimit = argv.includes("--rate-limit");
const grouped = argv.includes("--grouped");
const tool = argv.includes("--tool-read") ? "read" : "write";
const sid = "ses_mock_1";
let mode = "";
let loaded = false;
let promptId = 0;
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
const flat = [
  { value: "model-flat-a", name: "Flat A" },
  { value: "model-flat-b", name: "Flat B" },
];
const groupedOptions = [
  { group: "Group One", options: [{ value: "grouped-a", name: "Grouped A" }] },
  { value: "grouped-b", name: "Grouped B" },
];
const configOptions = [
  { id: "model", name: "Model", category: "model", type: "select", currentValue: "model-flat-a", options: grouped ? groupedOptions : flat },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "medium", options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }] },
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "build", options: [{ value: "plan", name: "Plan" }, { value: "build", name: "Build" }] },
];
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, agentInfo: { name: "Mock ACP", version: "1.0.0" } } });
  }
  if (msg.method === "session/new") {
    return send({ jsonrpc: "2.0", id: msg.id, result: { sessionId: sid, configOptions } });
  }
  if (msg.method === "session/load") {
    loaded = true;
    return send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
  if (msg.method === "session/set_config_option") {
    if (msg.params.configId === "mode") mode = msg.params.value;
    return send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
  if (msg.id === 9000) {
    const outcome = msg.result && msg.result.outcome ? msg.result.outcome : {};
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: {
      sessionUpdate: "agent_message_chunk", messageId: "msg_2",
      content: { type: "text", text: "PERM=" + outcome.outcome + ":" + (outcome.optionId || "") + ";MODE=" + mode + ";REUSED=" + loaded },
    } } });
    return send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn", usage: { inputTokens: 1000, outputTokens: 10, cachedReadTokens: 500, totalTokens: 1510 } } });
  }
  if (msg.method === "session/prompt") {
    if (rateLimit) return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "429 too many requests" } });
    promptId = msg.id;
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: sid, update: {
      sessionUpdate: "agent_thought_chunk", messageId: "th_1", content: { type: "text", text: "thinking" },
    } } });
    return send({ jsonrpc: "2.0", id: 9000, method: "session/request_permission", params: {
      sessionId: sid, toolCall: { toolCallId: "tc_1", title: tool, kind: tool },
      options: [{ optionId: "allow-1", kind: "allow_once" }, { optionId: "reject-1", kind: "reject_once" }],
    } });
  }
});
`;

const MOCK_HEADLESS = `
const args = process.argv.slice(2);
if (args.includes("--rate-limit")) {
  process.stderr.write("429 too many requests\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(args) + "\\n");
setTimeout(() => process.exit(0), 10);
`;

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS  ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, error: err });
    console.error(`FAIL  ${name}: ${err?.stack || err}`);
  }
}

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function acpDescriptor(mockPath, extraArgs = []) {
  return {
    id: "mock-acp",
    labelZh: "Mock ACP",
    labelEn: "Mock ACP",
    protocol: "acp",
    command: process.execPath,
    args: [mockPath, ...extraArgs],
    readOnlyMode: "plan",
    writeMode: "build",
    installCmd: "n/a",
    loginCmd: "n/a",
  };
}

const nodeResolver = () => ({ command: process.execPath, useShell: false });
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "astand-universal-cli-"));
const mockAcpPath = path.join(tempRoot, "mock-acp.mjs");
const mockHeadlessPath = path.join(tempRoot, "mock-headless.mjs");
fs.writeFileSync(mockAcpPath, MOCK_ACP, "utf8");
fs.writeFileSync(mockHeadlessPath, MOCK_HEADLESS, "utf8");

async function main() {
  await test("registry sanitizes ids, rejects builtins, lists presets + customs", async () => {
    assert.equal(EXTENSIBLE_CLI_PRESETS.length, 10);
    assert.equal(EXTENSIBLE_CLI_PRESETS.find((p) => p.id === "opencode")?.protocol, "acp");
    assert.equal(EXTENSIBLE_CLI_PRESETS.find((p) => p.id === "doubao")?.protocol, "acp");
    assert.equal(EXTENSIBLE_CLI_PRESETS.find((p) => p.id === "qoder")?.protocol, "acp");
    assert.equal(EXTENSIBLE_CLI_PRESETS.find((p) => p.id === "qoder-cn")?.protocol, "acp");
    const bad = sanitizeCustomCliEngine({ id: "codex", name: "x", command: "x", protocol: "acp" });
    assert.equal(bad.ok, false);
    const injected = sanitizeCustomCliEngine({ id: "my-cli", name: "Mine", command: "node; rm -rf /", protocol: "acp" });
    assert.equal(injected.ok, false);
    const ok = sanitizeCustomCliEngine({ id: "my-cli", name: "Mine", command: "node", args: ["{prompt}"], protocol: "headless" });
    assert.equal(ok.ok, true);
    assert.equal(ok.engine.custom, true);
    assert.equal(listAllExtensibleCliDefs([ok.engine]).filter((d) => d.id === "my-cli").length, 1);
  });

  await test("ACP listModels parses flat catalog + default entry", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath), nodeResolver);
    try {
      const models = await engine.listModels(true);
      assert.equal(models[0].id, "cli:mock-acp:default");
      assert.equal(models[0].isDefault, true);
      assert.ok(models.some((m) => m.id === "cli:mock-acp:model-flat-a" && m.displayName === "Flat A"));
      assert.ok(models.some((m) => m.id === "cli:mock-acp:model-flat-b"));
    } finally {
      await engine.shutdown();
    }
  });

  await test("store persists custom CLI engines and resolves cli:<engine>:default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astand-store-cli-"));
    try {
      const store = new RelayStore(dir);
      const saved = store.upsertCustomCliEngine({
        id: "my-cli", name: "My CLI", command: "node", args: ["{prompt}"], protocol: "headless",
      });
      assert.equal(saved.ok, true);
      const reset = new RelayStore(dir);
      assert.equal(reset.settings.customCliEngines.length, 1);
      const def = reset.getModelById("cli:my-cli:default");
      assert.equal(def.modelName, "");
      assert.equal(def.isDefault, true);
      assert.equal(def.name, "My CLI (Default)");
      const preset = reset.getModelById("cli:opencode:opencode/deepseek-v4.1-flash-free");
      assert.equal(preset.engine, "opencode");
      assert.equal(preset.modelName, "opencode/deepseek-v4.1-flash-free");
      assert.equal(reset.deleteCustomCliEngine("my-cli"), true);
      assert.equal(reset.settings.customCliEngines.length, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test("ACP listModels parses grouped catalog", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath, ["--grouped"]), nodeResolver);
    try {
      const models = await engine.listModels(true);
      assert.ok(models.some((m) => m.id === "cli:mock-acp:grouped-a" && m.displayName === "Grouped A"));
      assert.ok(models.some((m) => m.id === "cli:mock-acp:grouped-b"));
    } finally {
      await engine.shutdown();
    }
  });

  await test("oracle mode=plan rejects write permission + honest cache math", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath), nodeResolver);
    try {
      const res = await engine.runTurn({
        cwd: tempRoot, role: "oracle", effort: "medium",
        model: { modelName: "model-flat-a" }, prompt: "hello", idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
      });
      assert.match(res.text, /PERM=selected:reject-1/);
      assert.match(res.text, /MODE=plan/);
      assert.equal(res.usage.cacheReported, true);
      assert.equal(res.usage.cachedInputTokens, 500);
      assert.equal(res.usage.totalInputTokens, 1500);
      assert.equal(res.usage.hitRate, 33.3);
    } finally {
      await engine.shutdown();
    }
  });

  await test("oracle allows an explicitly read-only tool", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath, ["--tool-read"]), nodeResolver);
    try {
      const res = await engine.runTurn({
        cwd: tempRoot, role: "oracle", model: { modelName: "model-flat-a" },
        prompt: "read it", idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
      });
      assert.match(res.text, /PERM=selected:allow-1/);
    } finally {
      await engine.shutdown();
    }
  });

  await test("hephaestus auto-approves write tools and uses build mode", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath), nodeResolver);
    try {
      const res = await engine.runTurn({
        cwd: tempRoot, role: "hephaestus", model: { modelName: "model-flat-a" },
        prompt: "write it", idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
      });
      assert.match(res.text, /PERM=selected:allow-1/);
      assert.match(res.text, /MODE=build/);
    } finally {
      await engine.shutdown();
    }
  });

  await test("warm session reuses session/load instead of session/new", async () => {
    let first;
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath, ["--tool-read"]), nodeResolver);
    try {
      first = await engine.runTurn({
        cwd: tempRoot, role: "oracle", model: { modelName: "model-flat-a" },
        prompt: "first", idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
      });
      assert.equal(first.reused, false);
    } finally {
      await engine.shutdown();
    }
    // A fresh engine process must restore the on-disk session through session/load.
    const resumed = new UniversalAcpEngine(acpDescriptor(mockAcpPath, ["--tool-read"]), nodeResolver);
    try {
      const second = await resumed.runTurn({
        cwd: tempRoot, role: "oracle", model: { modelName: "model-flat-a" },
        prompt: "second", existingSessionId: first.sessionId, requireResume: true,
        idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
      });
      assert.equal(second.reused, true);
      assert.equal(second.resumedFromDisk, true);
      assert.match(second.text, /REUSED=true/);
    } finally {
      await resumed.shutdown();
    }
  });

  await test("ACP 429 is classified as rate limit", async () => {
    const engine = new UniversalAcpEngine(acpDescriptor(mockAcpPath, ["--rate-limit"]), nodeResolver);
    try {
      await assert.rejects(
        () => engine.runTurn({
          cwd: tempRoot, role: "oracle", model: { modelName: "model-flat-a" },
          prompt: "hello", idleTimeoutMs: 15_000, absoluteTimeoutMs: 20_000,
        }),
        (err) => err.isRateLimit === true
      );
    } finally {
      await engine.shutdown();
    }
  });

  await test("headless passes prompt as one argv element (no shell splitting)", async () => {
    const engine = new UniversalHeadlessEngine({
      id: "mock-headless", labelZh: "Mock Headless", labelEn: "Mock Headless",
      protocol: "headless", command: process.execPath, args: [mockHeadlessPath, "-p", "{prompt}"],
      installCmd: "n/a", loginCmd: "n/a",
    }, nodeResolver);
    const tricky = 'Say "hi"; rm -rf / #';
    try {
      const res = await engine.runTurn({ cwd: tempRoot, role: "oracle", prompt: tricky, timeoutMs: 10_000 });
      const argv = JSON.parse(res.text.trim());
      assert.equal(argv.length, 2);
      assert.equal(argv[0], "-p");
      assert.ok(argv[1].includes(tricky));
      assert.ok(argv[1].includes("[Task]"));
      assert.equal(res.usage.cacheReported, false);
      assert.equal(res.usage.totalInputTokens, null);
    } finally {
      await engine.shutdown();
    }
  });

  await test("headless 429 stderr is classified as rate limit", async () => {
    const engine = new UniversalHeadlessEngine({
      id: "mock-headless", labelZh: "Mock Headless", labelEn: "Mock Headless",
      protocol: "headless", command: process.execPath, args: [mockHeadlessPath, "--rate-limit", "{prompt}"],
      installCmd: "n/a", loginCmd: "n/a",
    }, nodeResolver);
    try {
      await assert.rejects(
        () => engine.runTurn({ cwd: tempRoot, role: "oracle", prompt: "x", timeoutMs: 10_000 }),
        (err) => err.isRateLimit === true
      );
    } finally {
      await engine.shutdown();
    }
  });

  await test("real OpenCode: detect + listModels + runTurn with real cache telemetry", async () => {
    const preset = EXTENSIBLE_CLI_PRESETS.find((p) => p.id === "opencode");
    const bin = resolveCliPresetBinary(preset);
    if (!bin) {
      console.log("SKIP  OpenCode CLI not installed on this machine");
      return;
    }
    const detected = detectEngines(true, ROOT, []);
    assert.equal(detected.opencode.installed, true);
    assert.equal(detected.opencode.loggedIn, true);
    assert.equal(detected.opencode.status, "ready");
    assert.equal(detected.opencode.protocol, "acp");
    assert.equal(detected.opencode.extensible, true);

    const engine = new UniversalAcpEngine(preset);
    try {
      const models = await engine.listModels(true);
      const targetId = "cli:opencode:opencode/deepseek-v4.1-flash-free";
      const target = models.find((m) => m.id === targetId);
      assert.ok(target, `expected ${targetId} in real OpenCode model list`);
      const res = await engine.runTurn({
        cwd: tempRoot,
        role: "oracle",
        model: target,
        prompt: "Reply with exactly: PONG",
        idleTimeoutMs: 60_000,
        absoluteTimeoutMs: 90_000,
      });
      assert.match(res.text, /PONG/);
      assert.equal(res.usage.cacheReported, true);
      assert.ok(res.usage.cachedInputTokens > 0, "real cachedReadTokens must be > 0");
      console.log(
        `      OpenCode real turn: model=${res.resolvedModel} cached=${res.usage.cachedInputTokens} ` +
          `input=${res.usage.totalInputTokens} hitRate=${res.usage.hitRate}%`
      );
    } finally {
      await engine.shutdown();
    }
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed in ${results.reduce((n, r) => n + r.ms, 0)}ms`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Test harness failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTimeout(watchdog);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
