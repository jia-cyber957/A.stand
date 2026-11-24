// Capture crisp, 100% synthetic product screenshots of the A.stand console for docs/screenshots/.
//
// How it works:
//   1. Builds dist/console.html unless AGENT_RELAY_SKIP_BUILD=1 (esbuild may be unavailable in restricted sandboxes).
//   2. Serves dist/console.html behind a minimal MCP-Apps host harness (same ui/initialize + tool-result
//      postMessage contract the real Antigravity host uses) bound to an ephemeral port on 127.0.0.1.
//   3. Injects a completely synthetic dashboard state (fake workspace /projects/demo-web-app, mock engine
//      versions, 98.6% prompt-cache hit rate, Codex quota windows, role cards and one expanded
//      Antigravity-native X-ray job). No real paths, keys, hostnames or IPs ever appear.
//      The state is rendered twice: English (settings.lang="en", hostContext.locale="en-US") for
//      README.md, and Chinese (settings.lang="zh", hostContext.locale="zh-CN") for README.zh-CN.md.
//      The injected UI HTML's <html lang> and the harness page's <html lang> are switched to match.
//   4. Renders the iframe at 480x920 CSS px @ 2x DPR and exports the PNG with CDP
//      Page.captureScreenshot (the browser viewport is oversized so nothing is cut off).
//
// Output (4 files):
//   docs/screenshots/console-team-en.png   English Team X-ray timeline
//   docs/screenshots/console-cache-en.png  English Cache analytics
//   docs/screenshots/console-team.png      Chinese Team X-ray timeline
//   docs/screenshots/console-cache.png     Chinese Cache analytics
//
// Usage: node scripts/capture-screenshots.mjs   (PORT=0 style ephemeral ports only; no server left running)

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_DEFAULT_MODELS_MAP, CLI_ENGINES_META } from "../src/core/constants.mjs";
import { TelemetryLogger } from "../src/core/telemetry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_HTML = path.join(ROOT, "dist", "console.html");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const MIN_PNG_BYTES = 100 * 1024; // docs must ship crisp Retina PNGs, not near-empty frames
const FRAME_WIDTH = 480; // CSS px — matches the Antigravity inline/side panel width
const DEVICE_SCALE = 2; // 2x DPR -> 960 px wide QR-ready PNGs
const VIEWPORT = { width: FRAME_WIDTH, height: 3600 };
const DEMO_CWD = "/projects/demo-web-app";

// Locale pairing for the two READMEs. `lang` drives state.settings.lang (UI strings),
// `locale` drives hostContext.locale and both <html lang> attributes.
const LANGS = {
  en: { lang: "en", locale: "en-US" },
  zh: { lang: "zh", locale: "zh-CN" },
};

// ---------------------------------------------------------------------------------------------
// Synthetic, zero-PII copy for the demo job — localized so each screenshot reads naturally in
// its own language instead of mixing English body text into the Chinese UI (and vice versa).
// ---------------------------------------------------------------------------------------------
const SHOT_COPY = {
  en: {
    jobTitle: "Checkout retry + idempotency key",
    jobPrompt:
      "Checkout retries double-charge VIP users on network timeout. Add an idempotency key end-to-end (client → `POST /api/checkout` → payment adapter), keep the legacy `chargeId` field for older mobile clients, and prove it with an integration test for the timeout-retry path. Don't touch the admin billing UI.",
    thoughtDetail:
      "Two code paths can retry a checkout: the client `withRetry()` helper and the server-side gateway on 502/504.\n\nI'll mint the key once per checkout at the client boundary, persist it on the order draft, and make the payment adapter dedupe on `Idempotency-Key`. Then add a timeout-retry integration test.",
    finalText:
      "## Summary\n\nAdds a client-minted **idempotency key** that survives retries and is enforced server-side, so a timeout retry can never double-charge.\n\n- `withRetry()` now only retries **transient** failures with jittered backoff and reuses the same key\n- `POST /api/checkout` dedupes on `Idempotency-Key`; replays get the original receipt\n- Legacy `chargeId` kept for older mobile clients\n\n```ts\nconst key = newIdempotencyKey();\nawait withRetry(() => charge({ key, order }), 3, key);\n```\n\n`pnpm vitest` → **5 passed**. No changes to the admin billing UI.\n\n[A.stand · hephaestus · gpt-5-codex (codex) · warm · cache 98.9% (189,241 / 194,562) | ctx 71% · 86.4s]\n\n[Git Worktree] Branch: astand/job_demo_checkout · 3 files changed",
    recent: {
      checkout: "Checkout retry + idempotency key",
      cache: "Gateway prompt-prefix audit",
      webhook: "Webhook signature parity",
    },
    sessions: {
      review: "Checkout race review",
      checkout: "Checkout retry + idempotency key",
      webhook: "Webhook signature parity",
    },
  },
  zh: {
    jobTitle: "结算重试 + 幂等键",
    jobPrompt:
      "VIP 用户在网络超时重试结算时会被重复扣款。请端到端加上幂等键（客户端 → `POST /api/checkout` → 支付适配器），为老版本移动端保留 `chargeId` 字段，并用一个针对超时重试路径的集成测试证明它。不要改动管理后台的计费界面。",
    thoughtDetail:
      "结算有两条重试路径：客户端的 `withRetry()` 辅助函数，以及服务端网关在 502/504 时的重试。\n\n我会在客户端边界为每次结算生成一次幂等键，持久化到订单草稿上，并让支付适配器按 `Idempotency-Key` 去重。然后补一个超时重试的集成测试。",
    finalText:
      "## 摘要\n\n在客户端生成**幂等键**并贯穿重试，服务端强制去重，因此超时重试永远不会重复扣款。\n\n- `withRetry()` 现在只重试**瞬时**故障，带抖动退避，并复用同一个键\n- `POST /api/checkout` 按 `Idempotency-Key` 去重；重放请求返回原始回执\n- 为老版本移动端保留 `chargeId`\n\n```ts\nconst key = newIdempotencyKey();\nawait withRetry(() => charge({ key, order }), 3, key);\n```\n\n`pnpm vitest` → **5 passed**。未改动管理后台的计费界面。\n\n[A.stand · hephaestus · gpt-5-codex (codex) · warm · cache 98.9% (189,241 / 194,562) | ctx 71% · 86.4s]\n\n[Git Worktree] Branch: astand/job_demo_checkout · 3 files changed",
    recent: {
      checkout: "结算重试 + 幂等键",
      cache: "网关 Prompt 前缀审计",
      webhook: "Webhook 签名一致性",
    },
    sessions: {
      review: "结算竞态审查",
      checkout: "结算重试 + 幂等键",
      webhook: "Webhook 签名一致性",
    },
  },
};

// ---------------------------------------------------------------------------------------------
// 1. Build
// ---------------------------------------------------------------------------------------------
function build() {
  if (process.env.AGENT_RELAY_SKIP_BUILD === "1") {
    console.log("Skipping build (AGENT_RELAY_SKIP_BUILD=1); using existing dist/console.html.");
  } else {
    try {
      execFileSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], {
        cwd: ROOT,
        stdio: ["ignore", "inherit", "inherit"],
        timeout: 120_000,
      });
    } catch (err) {
      throw new Error(
        `npm run build failed (${err?.message || err}). Run it manually, then re-run this script.`
      );
    }
  }
  if (!fs.existsSync(DIST_HTML)) {
    throw new Error("dist/console.html is missing — run `npm run build` first.");
  }
  return fs.readFileSync(DIST_HTML, "utf8");
}

// ---------------------------------------------------------------------------------------------
// 2. Synthetic state (zero PII)
// ---------------------------------------------------------------------------------------------
const agoIso = (ms) => new Date(Date.now() - ms).toISOString();
const inMs = (ms) => Date.now() + ms;
const MIN = 60_000;
const HOUR = 60 * MIN;

function buildTelemetry() {
  // Route through the real logger so token math is exactly what the UI would receive.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-shot-tel-"));
  const logger = new TelemetryLogger(dir);
  const rows = [
    ["oracle", "codex", "gpt-5-codex", 16, 98.85, 62, "warm", 4200],
    ["hephaestus", "codex", "gpt-5-codex", 20, 98.60, 54, "warm", 5100],
    ["oracle", "claude-code", "claude-opus-4-6", 12, 97.90, 31, "new", 3600],
    ["hephaestus", "deepseek-harness", "deepseek-reasoner", 9, 99.20, 27, "warm", 7300],
    ["oracle", "codex", "gpt-5-codex", 18, 98.40, 66, "resumed", 4800],
    ["hephaestus", "codex", "gpt-5-codex", 22, 98.70, 58, "warm", 6100],
    ["oracle", "antigravity", "gemini-4-pro", 10, 98.10, 24, "warm", 3900],
    ["hephaestus", "codex", "gpt-5-codex", 24, 99.00, 71, "warm", 8200],
    ["oracle", "codex", "gpt-5-codex", 14, 98.30, 57, "warm", 4300],
    ["hephaestus", "claude-code", "claude-opus-4-6", 8, 97.60, 33, "new", 5600],
    ["oracle", "codex", "gpt-5-codex", 19, 98.55, 64, "warm", 4500],
    ["hephaestus", "codex", "gpt-5-codex", 26, 98.95, 73, "warm", 9400],
    ["oracle", "codex", "gpt-5-codex", 17, 98.90, 61, "warm", 4100],
    ["hephaestus", "deepseek-harness", "deepseek-reasoner", 11, 99.10, 29, "warm", 6800],
    ["oracle", "codex", "gpt-5-codex", 21, 98.75, 68, "warm", 5200],
    ["hephaestus", "codex", "gpt-5-codex", 25, 98.80, 70, "warm", 7600],
    ["oracle", "antigravity", "gemini-4-flash", 7, 98.00, 22, "new", 2800],
    ["hephaestus", "codex", "gpt-5-codex", 23, 98.85, 69, "warm", 8900],
    ["oracle", "codex", "gpt-5-codex", 20, 98.65, 63, "warm", 4700],
    ["hephaestus", "codex", "gpt-5-codex", 128, 98.70, 74, "warm", 41_200],
  ];
  rows.forEach(([role, engine, modelName, secs, hit, ctx, mode, elapsedMs], i) => {
    const totalInputTokens = 24_000 + i * 1_900;
    const cachedInputTokens = Math.round((totalInputTokens * hit) / 100);
    logger.record({
      ts: agoIso((rows.length - i) * 7 * MIN),
      jobId: `job_demo_${String(i + 1).padStart(2, "0")}`,
      cwd: DEMO_CWD,
      role,
      slot: "default",
      engine,
      modelId: engine === "codex" ? "cli-codex-default" : `cli:${engine}:${modelName}`,
      modelName,
      sessionId: `sess-demo-${String(i + 1).padStart(2, "0")}`,
      reused: mode === "warm",
      resumedFromDisk: mode === "resumed",
      elapsedMs,
      cacheReported: true,
      totalInputTokens,
      cachedInputTokens,
      cacheWriteTokens: 0,
      outputTokens: 1_200 + i * 140,
      hitRate: hit,
      contextPct: ctx,
      _secs: secs,
    });
  });
  const summary = logger.getSummary(30);
  fs.rmSync(dir, { recursive: true, force: true });
  summary.logPath = "~/.gemini/antigravity/plugin_data/agent-relay/telemetry.jsonl";
  if (Math.abs(summary.cumulativeHitRate - 98.6) > 0.06) {
    throw new Error(`Synthetic telemetry drifted from 98.6% (got ${summary.cumulativeHitRate}%)`);
  }
  return summary;
}

function cliSubModels() {
  const zh = {
    "cli-agy-default": { displayName: "Gemini (CLI Default)", displayNameZh: "Gemini（CLI 默认）" },
    "cli:antigravity:gemini-4-pro": { displayName: "gemini-4-pro" },
    "cli:antigravity:gemini-4-flash": { displayName: "gemini-4-flash" },
  };
  const antigravity = (CLI_DEFAULT_MODELS_MAP.antigravity || []).map((m) => ({
    ...m,
    displayName: m.displayName || m.modelName,
    displayNameZh: m.displayNameZh || zh[m.id]?.displayNameZh || m.displayName || m.modelName,
  }));
  const claude = (CLI_DEFAULT_MODELS_MAP["claude-code"] || []).map((m) => ({
    ...m,
    displayNameZh: m.displayNameZh || m.displayName || m.modelName,
  }));
  return {
    codex: [
      { id: "cli-codex-default", modelName: "gpt-5-codex", displayName: "gpt-5-codex", isDefault: true, engine: "codex" },
      { id: "cli:codex:gpt-5-codex-mini", modelName: "gpt-5-codex-mini", displayName: "gpt-5-codex-mini", isDefault: false, engine: "codex" },
      { id: "cli:codex:gpt-5", modelName: "gpt-5", displayName: "gpt-5", isDefault: false, engine: "codex" },
    ],
    "claude-code": claude,
    antigravity,
  };
}

function buildDashboardState(lang = "zh") {
  const L = LANGS[lang] || LANGS.zh;
  const copy = SHOT_COPY[L.lang];
  const telemetry = buildTelemetry();
  const cliModels = cliSubModels();
  const engines = {
    codex: {
      id: "codex",
      installed: true,
      status: "ready",
      version: "codex 0.48.1",
      detectedModel: "gpt-5-codex",
      ...CLI_ENGINES_META.codex,
    },
    "claude-code": {
      id: "claude-code",
      installed: true,
      status: "ready",
      version: "2.1.4 (Claude Code)",
      detectedModel: "claude-opus-4-6",
      ...CLI_ENGINES_META["claude-code"],
    },
    antigravity: {
      id: "antigravity",
      installed: true,
      status: "ready",
      version: "agy 1.8.0",
      detectedModel: "gemini-4-pro",
      ...CLI_ENGINES_META.antigravity,
    },
    "deepseek-harness": {
      id: "deepseek-harness",
      installed: true,
      status: "ready",
      version: "dsh 0.9.2",
      detectedModel: "deepseek-reasoner",
      ...CLI_ENGINES_META["deepseek-harness"],
    },
  };

  const channels = [
    {
      id: "channel-demo-openai",
      name: "OpenAI API",
      providerId: "openai",
      baseUrl: "https://api.openai.com/v1",
      source: "custom",
      hasApiKey: true,
      maskedApiKey: "sk-demo-••••••01ab",
      models: [
        { id: "custom-demo-openai-1", modelName: "gpt-5-codex" },
        { id: "custom-demo-openai-2", modelName: "gpt-5" },
      ],
    },
    {
      id: "channel-demo-antigravity",
      name: "Google Gemini",
      providerId: "gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      source: "custom",
      hasApiKey: true,
      maskedApiKey: "AIza-demo-••••07cd",
      models: [
        { id: "custom-demo-gemini-1", modelName: "gemini-4-pro" },
        { id: "custom-demo-gemini-2", modelName: "gemini-4-flash" },
      ],
    },
    {
      id: "channel-demo-deepseek",
      name: "DeepSeek",
      providerId: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      source: "custom",
      hasApiKey: true,
      maskedApiKey: "sk-deep-demo-••••f3e2",
      models: [{ id: "custom-demo-deepseek-1", modelName: "deepseek-reasoner" }],
    },
  ];

  const channelModels = channels.flatMap((channel) =>
    channel.models.map((model) => ({
      id: model.id,
      name: model.modelName,
      modelName: model.modelName,
      providerId: channel.providerId,
      channelId: channel.id,
      channelName: channel.name,
      baseUrl: channel.baseUrl,
      source: "custom",
      mode: "api",
      hasApiKey: true,
      maskedApiKey: channel.maskedApiKey,
    }))
  );

  const settings = {
    version: 3,
    enabled: true,
    lang: L.lang,
    codexKeepOfficePlugins: false,
    allowHephaestusFullAccess: false,
    allowWorktreeParallelWrite: true,
    maxConcurrency: 3,
    silentCheckinMin: 3,
    longRunCheckinMin: 10,
    retentionDays: 30,
    autoFallbackOnLimit: true,
    asyncBackgroundMode: true,
    inspectorEnabled: false,
    inspectorModelId: "",
    roles: {
      oracle: { modelId: "cli-codex-default", queue: ["cli-codex-default"], effort: "medium" },
      hephaestus: {
        modelId: "cli-codex-default",
        queue: ["cli-codex-default", "cli:antigravity:gemini-4-pro"],
        effort: "high",
      },
    },
    models: [
      { id: "cli-codex-default", name: "GPT (Codex)", mode: "cli", engine: "codex", modelName: "", providerId: "openai", baseUrl: "", builtin: true },
      { id: "cli-claude-default", name: "Claude (Claude Code)", mode: "cli", engine: "claude-code", modelName: "", providerId: "anthropic", baseUrl: "", builtin: true },
      { id: "cli-agy-default", name: "Gemini (Antigravity CLI)", mode: "cli", engine: "antigravity", modelName: "", providerId: "google", baseUrl: "", builtin: true },
      ...channelModels,
    ],
    channels,
  };

  const sessions = [
    {
      sessionId: "sess-demo-7f3a91c0",
      role: "oracle",
      slot: "default",
      cwd: DEMO_CWD,
      engine: "codex",
      modelId: "cli-codex-default",
      modelDisplayName: "gpt-5-codex",
      resolvedModel: "gpt-5-codex",
      title: copy.sessions.review,
      turns: 17,
      lastHitRate: 98.4,
      contextPct: 46,
      createdAt: agoIso(3 * HOUR),
      updatedAt: agoIso(12 * MIN),
    },
    {
      sessionId: "sess-demo-1b44de02",
      role: "hephaestus",
      slot: "default",
      cwd: DEMO_CWD,
      engine: "codex",
      modelId: "cli-codex-default",
      modelDisplayName: "gpt-5-codex",
      resolvedModel: "gpt-5-codex",
      title: copy.sessions.checkout,
      turns: 42,
      lastHitRate: 98.9,
      contextPct: 71,
      createdAt: agoIso(9 * HOUR),
      updatedAt: agoIso(4 * MIN),
    },
    {
      sessionId: "sess-demo-5c2e0a71",
      role: "hephaestus",
      slot: "default",
      cwd: DEMO_CWD,
      engine: "deepseek-harness",
      modelId: "custom-demo-deepseek-1",
      modelDisplayName: "deepseek-reasoner",
      resolvedModel: "deepseek-reasoner",
      title: copy.sessions.webhook,
      turns: 12,
      lastHitRate: 99.1,
      contextPct: 33,
      createdAt: agoIso(26 * HOUR),
      updatedAt: agoIso(2 * HOUR),
    },
  ];

  const rateLimits = {
    planType: "Pro",
    primary: { usedPercent: 38, remainingPercent: 62, resetsAtMs: inMs(3 * HOUR + 41 * MIN) },
    secondary: { usedPercent: 21, remainingPercent: 79, resetsAtMs: inMs(5 * 24 * HOUR + 2 * HOUR) },
    updatedAt: agoIso(40_000),
  };

  const recentJobs = [
    {
      jobId: "job_demo_checkout",
      role: "hephaestus",
      slot: "default",
      title: copy.recent.checkout,
      cwd: DEMO_CWD,
      engine: "codex",
      modelDisplayName: "gpt-5-codex",
      status: "completed",
      elapsedSec: 86.4,
      hitRate: 98.9,
      contextPct: 71,
      finishedAt: agoIso(4 * MIN),
      activityCount: 7,
    },
    {
      jobId: "job_demo_cache",
      role: "oracle",
      slot: "default",
      title: copy.recent.cache,
      cwd: DEMO_CWD,
      engine: "codex",
      modelDisplayName: "gpt-5-codex",
      status: "completed",
      elapsedSec: 41.2,
      hitRate: 98.7,
      contextPct: 52,
      finishedAt: agoIso(14 * MIN),
      activityCount: 6,
    },
    {
      jobId: "job_demo_webhook",
      role: "hephaestus",
      slot: "default",
      title: copy.recent.webhook,
      cwd: DEMO_CWD,
      engine: "deepseek-harness",
      modelDisplayName: "deepseek-reasoner",
      status: "completed",
      elapsedSec: 63.5,
      hitRate: 99.1,
      contextPct: 33,
      finishedAt: agoIso(2 * HOUR),
      activityCount: 9,
    },
  ];

  return {
    settings,
    channels,
    engines,
    codexRateLimits: rateLimits,
    codexModels: cliModels.codex,
    dshModels: [],
    dshChannels: [],
    cliSubModels,
    cooldowns: {},
    sessions,
    telemetry,
    activeJobs: [],
    recentJobs,
    interruptedJobs: [],
  };
}

// One completed job whose Antigravity-native X-ray timeline shows every row kind:
// Thought / Analyzed / Edited / Created / Ran (+ live pulse) / Markdown final response.
// `lang` localizes the synthetic prompt, thought, and final response so the timeline body text
// matches the surrounding UI language (Chinese screenshots must not read as mixed-language).
function buildJobDetail(lang = "zh") {
  const L = LANGS[lang] || LANGS.zh;
  const copy = SHOT_COPY[L.lang];
  return {
    ok: true,
    job: {
      jobId: "job_demo_checkout",
      role: "hephaestus",
      slot: "default",
      title: copy.jobTitle,
      cwd: DEMO_CWD,
      sessionId: "sess-demo-1b44de02",
      engine: "codex",
      modelDisplayName: "gpt-5-codex",
      status: "completed",
      elapsedSec: 86.4,
      silentSec: 0,
      startedAt: agoIso(88 * MIN),
      finishedAt: agoIso(86 * MIN),
      hitRate: 98.9,
      contextPct: 71,
      activityCount: 7,
      logPath: "/var/lib/a-stand/jobs/job_demo_checkout.log",
      prompt: copy.jobPrompt,
      activities: [
        {
          id: "demo_thought_1",
          kind: "thought",
          title: L.lang === "en" ? "Plan" : "计划",
          status: "done",
          durationSec: 11,
          detail: copy.thoughtDetail,
        },
        { id: "demo_read_1", kind: "read", title: "checkout.ts", meta: "#L88-142" },
        { id: "demo_search_1", kind: "search", title: '"withRetry("', meta: "src/lib" },
        {
          id: "demo_edit_1",
          kind: "edit",
          title: "src/lib/retry.ts",
          added: 18,
          removed: 3,
          detail:
            "--- a/src/lib/retry.ts\n+++ b/src/lib/retry.ts\n@@ -1,6 +1,9 @@\n-export function withRetry<T>(fn: () => Promise<T>, times = 3) {\n+export function withRetry<T>(fn: () => Promise<T>, times = 3, idempotencyKey?: string) {\n   for (let attempt = 1; ; attempt++) {\n     try {\n-      return await fn();\n+      return await fn();\n     } catch (err) {\n+      if (!isTransient(err) || attempt >= times) throw err;\n+      await sleep(150 * 2 ** attempt);\n     }\n   }\n }",
        },
        {
          id: "demo_write_1",
          kind: "write",
          title: "src/lib/idempotency.ts",
          added: 24,
          removed: 0,
          detail:
            "+export const newIdempotencyKey = () => globalThis.crypto.randomUUID();\n+\n+// Server-side dedupe: first 200/201 wins, replays return the cached receipt.\n+export function dedupe(key: string, fn: () => Promise<Receipt>) {\n+  return inFlight.get(key) ?? remember(key, fn);\n+}",
        },
        {
          id: "demo_cmd_1",
          kind: "cmd",
          title: "pnpm vitest run tests/checkout-retry.test.ts",
          status: "done",
          durationSec: 14,
          exitCode: 0,
          detail:
            " RUN  v2.1.8 /projects/demo-web-app\n\n ✓ tests/checkout-retry.test.ts (5 tests) 412ms\n   ✓ retries transient timeout exactly once (88ms)\n   ✓ reuses idempotency key across retries (5ms)\n   ✓ dedupes duplicate webhook delivery (3ms)\n\n Test Files  1 passed (1)\n      Tests  5 passed (5)\n   Duration  1.42s",
        },
      ],
      prompt_preview: "",
      finalText: copy.finalText,
      error: "",
      recovered: false,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Host harness page (clean, self-contained, same postMessage contract as e2e-test.mjs)
// ---------------------------------------------------------------------------------------------
function hostHtml({ uiHtml, state, jobDetail, lang = "zh" }) {
  const L = LANGS[lang] || LANGS.zh;
  // dist/console.html hardcodes <html lang="zh-CN"> (the product default), so the harness rewrites
  // the srcdoc document's lang attribute to match the synthetic locale for this capture.
  const localizedUiHtml = /<html\s+lang="[^"]*"/i.test(uiHtml)
    ? uiHtml.replace(/<html\s+lang="[^"]*"/i, `<html lang="${L.locale}"`)
    : uiHtml.replace(/<html\b/i, `<html lang="${L.locale}"`);
  const payload = {
    content: [{ type: "text", text: "A.stand demo dashboard (synthetic)" }],
    structuredContent: state,
  };
  const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${L.locale}"><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#0b0b0d}
  #frame{border:0;display:block;width:${FRAME_WIDTH}px;height:100px;background:#0b0b0d}
</style></head><body>
<iframe id="frame"></iframe>
<script>
  const TOOL_RESULT = ${safe(payload)};
  const JOB_DETAIL = ${safe(jobDetail)};
  const HTML_SRC = ${safe(localizedUiHtml)};
  const UI_LANG = ${safe(L.locale)};
  const frame = document.getElementById("frame");
  const ready = { done: false };

  function initResult() {
    return {
      protocolVersion: "2026-01-26",
      hostInfo: { name: "AntigravityHost", version: "1.0.0" },
      hostCapabilities: { serverTools: {}, openLinks: {}, updateModelContext: { text: {} } },
      hostContext: {
        theme: "dark",
        platform: "desktop",
        displayMode: "inline",
        locale: UI_LANG,
        containerDimensions: { width: ${FRAME_WIDTH}, maxHeight: 920 },
      },
    };
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.jsonrpc !== "2.0" || !msg.method) return;
    const src = e.source;
    if (msg.method === "ui/initialize") {
      src.postMessage({ jsonrpc: "2.0", id: msg.id, result: initResult() }, "*");
    } else if (msg.method === "ui/notifications/initialized") {
      src.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: TOOL_RESULT }, "*");
    } else if (msg.method === "tools/call") {
      let result = TOOL_RESULT;
      const name = msg.params && msg.params.name;
      if (name === "agent_relay_ui_get_job_detail") {
        result = { content: [{ type: "text", text: "ok" }], structuredContent: JOB_DETAIL };
      } else if (name === "agent_relay_ui_get_state") result = TOOL_RESULT;
      src.postMessage({ jsonrpc: "2.0", id: msg.id, result }, "*");
    } else if (msg.id !== undefined) {
      src.postMessage({ jsonrpc: "2.0", id: msg.id, result: {} }, "*");
    }
  });

  // Deterministic clock so countdowns/relative labels never depend on capture timing.
  const RealDate = Date;
  const fixedNow = RealDate.now();
  function ShotDate(...args) {
    if (!(this instanceof ShotDate)) return new RealDate(fixedNow).toString();
    return args.length ? new RealDate(...args) : new RealDate(fixedNow);
  }
  ShotDate.prototype = RealDate.prototype;
  ShotDate.now = () => fixedNow;
  ShotDate.parse = RealDate.parse;
  ShotDate.UTC = RealDate.UTC;

  const settle = (el) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const waitFor = async (fn) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try { if (fn()) return true; } catch {}
      await new Promise((r) => setTimeout(r, 40));
    }
    return false;
  };

  frame.srcdoc = HTML_SRC;
  window.__shot = {
    ready,
    async run(mode) {
      const win = frame.contentWindow;
      win.Date = ShotDate;
      const doc = () => frame.contentDocument;
      await waitFor(() => doc().querySelector(".nav-tab"));
      // Re-render under the frozen clock so quota countdowns are stable.
      await settle(frame);
      if (mode === "cache") {
        doc().querySelector('[data-action="set-tab"][data-tab="cache"]').click();
        await settle(frame);
      } else {
        await waitFor(() => doc().querySelector(".recent-job"));
        doc().querySelector('[data-action="open-job-detail"][data-job="job_demo_checkout"]').click();
        const gotDetail = await waitFor(() => doc().querySelector('[data-step-id="demo_thought_1"]'));
        for (const id of ["demo_thought_1", "demo_edit_1"]) {
          const el = doc().querySelector('[data-step-id="' + id + '"]');
          if (el) el.click();
        }
        await waitFor(() => doc().querySelector(".job-final"));
        await settle(frame);
        const scroller = doc().querySelector('[data-scroll="job-detail"]');
        if (scroller) {
          scroller.style.maxHeight = "none";
          scroller.style.overflow = "visible";
          scroller.scrollTop = 0;
        }
        if (!gotDetail) throw new Error("job detail never rendered");
      }
      await new Promise((r) => setTimeout(r, 400));
      const body = doc().body;
      const height = Math.min(3200, Math.ceil(Math.max(body.scrollHeight, doc().documentElement.scrollHeight, 920)));
      frame.style.height = height + "px";
      frame.style.width = ${FRAME_WIDTH} + "px";
      await new Promise((r) => setTimeout(r, 250));
      return {
        height,
        title: doc().querySelector(".job-detail-title")?.textContent || "",
        text: body.innerText,
        htmlLang: doc().documentElement.lang || "",
        errorShell: Boolean(doc().querySelector(".empty-state") && body.innerText.includes("UI Error")),
        frames: doc().querySelectorAll("iframe,frame").length,
        images: doc().querySelectorAll("img").length,
      };
    },
  };
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------------------------
// 4. Browser plumbing (local headless Edge/Chrome)
// ---------------------------------------------------------------------------------------------
function browserCandidates() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
  const edgePfx = path.join(programFilesX86, "Microsoft", "Edge", "Application");
  const edgeLegacyPfx = path.join(programFiles, "Microsoft", "Edge", "Application");
  return [
    process.env.AGENT_RELAY_BROWSER_EXE || "",
    path.join(edgePfx, "msedge.exe"),
    path.join(edgeLegacyPfx, "msedge.exe"),
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
    path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
}

function findBrowserExe() {
  return browserCandidates().find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function fetchJson(url, attempts = 100) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await sleep(100);
  }
  throw new Error(`CDP endpoint ${url} unreachable: ${lastErr?.message || "timeout"}`);
}

function openCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const events = [];
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = nextId++;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
          });
        },
        events,
        close: () => ws.close(),
      })
    );
    ws.addEventListener("error", (e) => reject(new Error(`CDP websocket error: ${e?.message || e?.type || "unknown"}`)));
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`));
        else res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
  });
}

function screenshotsHasContent(buf) {
  return buf.length >= MIN_PNG_BYTES && buf.length >= 8 && buf.subarray(1, 4).toString("latin1") === "PNG";
}

async function captureWithCdp({ browser, url, mode, outFile }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ar-shot-profile-"));
  const flags = [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-color-profile=srgb",
    "--force-device-scale-factor=1",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    "about:blank",
  ];
  if (process.env.AGENT_RELAY_E2E_NO_BROWSER_SANDBOX === "1") flags.unshift("--no-sandbox");
  const proc = spawn(browser, flags, { stdio: "ignore", windowsHide: true });
  let cdp;
  const exited = new Promise((resolve) => {
    proc.once("error", (err) => resolve({ err }));
    proc.once("exit", (code) => resolve({ code }));
  });
  try {
    cdp = await withTimeout(
      (async () => {
        const seen = await Promise.race([
          new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = setInterval(() => {
              try {
                const lines = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split(/\r?\n/);
                const port = Number(lines[0]);
                const wsPath = (lines[1] || "").trim();
                if (port > 0 && wsPath) {
                  clearInterval(poll);
                  resolve({ port, wsPath });
                }
              } catch {}
              if (Date.now() - started > 12_000) {
                clearInterval(poll);
                reject(new Error("DevToolsActivePort never appeared"));
              }
            }, 100);
          }),
          exited.then((r) => {
            throw new Error(r.err ? `browser spawn failed: ${r.err.message}` : `browser exited early (code ${r.code})`);
          }),
        ]);
        return openCdp(`ws://127.0.0.1:${seen.port}${seen.wsPath}`);
      })(),
      15_000,
      "Browser/CDP startup timed out"
    );
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const S = (method, params) => cdp.send(method, params, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: DEVICE_SCALE,
      mobile: false,
    });
    await S("Page.navigate", { url });

    const deadline = Date.now() + 20_000;
    let report = null;
    while (Date.now() < deadline) {
      const res = await S("Runtime.evaluate", {
        expression: "window.__shot ? window.__shot.run(" + JSON.stringify(mode) + ") : null",
        awaitPromise: true,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Harness error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`);
      }
      if (res.result?.value) {
        report = res.result.value;
        break;
      }
      await sleep(150);
    }
    if (!report) throw new Error(`Harness never rendered mode "${mode}" within 20s`);
    if (report.errorShell) throw new Error(`Console rendered a fatal UI error: ${report.text.slice(0, 400)}`);
    if (report.frames || report.images) throw new Error(`Unexpected nested frames/images in console (${report.frames}/${report.images})`);

    const captureHeight = Math.min(VIEWPORT.height, report.height + 2);
    await S("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: captureHeight,
      deviceScaleFactor: DEVICE_SCALE,
      mobile: false,
    });
    await sleep(250);
    const { data } = await S("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const buf = Buffer.from(data, "base64");
    if (!screenshotsHasContent(buf)) throw new Error(`CDP screenshot too small (${buf.length} bytes)`);
    fs.writeFileSync(outFile, buf);
    return { ...report, bytes: buf.length, method: "cdp" };
  } finally {
    try {
      if (cdp) await withTimeout(cdp.send("Browser.close"), 3000, "Browser.close timed out");
    } catch {}
    try {
      cdp?.close();
    } catch {}
    await sleep(300);
    try {
      proc.kill();
    } catch {}
    for (let i = 0; i < 10; i++) {
      // Windows keeps profile handles briefly after exit; retry, then leave the temp dir alone.
      if (!proc.exitCode && i === 5) {
        try {
          proc.kill();
        } catch {}
      }
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  }
}

async function captureWithScreenshotFlag({ browser, url, outFile }) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ar-shot-profile-"));
  const { spawnSync } = await import("node:child_process");
  try {
    const res = spawnSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-color-profile=srgb",
        ...(process.env.AGENT_RELAY_E2E_NO_BROWSER_SANDBOX === "1" ? ["--no-sandbox"] : []),
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        `--window-size=${FRAME_WIDTH},2400`,
        `--user-data-dir=${prof}`,
        `--screenshot=${outFile}`,
        "--virtual-time-budget=6000",
        url,
      ],
      { stdio: "ignore", timeout: 45_000, windowsHide: true }
    );
    if (res.error) throw res.error;
    if (!fs.existsSync(outFile)) throw new Error(`Browser exited ${res.status} without writing ${outFile}`);
    const bytes = fs.statSync(outFile).size;
    if (bytes < MIN_PNG_BYTES) throw new Error(`Screenshot too small (${bytes} bytes)`);
    return { bytes, method: "screenshot-flag" };
  } finally {
    try {
      fs.rmSync(prof, { recursive: true, force: true });
    } catch {}
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Main
// ---------------------------------------------------------------------------------------------
// The exact strings each screenshot must prove it rendered — a language/regression guard so a
// silently-Chinese English PNG (or vice versa) can never be committed to docs/.
const SHOT_EXPECT = {
  "console-team-en": {
    lang: "en",
    must: ["Hephaestus", "Thought for 11s", "Analyzed", "Edited", "98.9%"],
    mustNot: ["祝融", "白泽", "思考了", "已分析", "已编辑"],
  },
  "console-cache-en": {
    lang: "en",
    must: ["98.6%", "Hephaestus", "Oracle"],
    mustNot: ["祝融", "白泽"],
  },
  "console-team": {
    lang: "zh",
    must: ["祝融", "思考了 11s", "已分析", "已编辑", "98.9%"],
    mustNot: ["Thought for 11s", "Analyzed"],
  },
  "console-cache": {
    lang: "zh",
    must: ["98.6%", "祝融", "白泽"],
    mustNot: ["Hephaestus"],
  },
};

function assertShotContent(name, report) {
  const expect = SHOT_EXPECT[name];
  const text = String(report.text || "");
  const missing = expect.must.filter((s) => !text.includes(s));
  const leaked = expect.mustNot.filter((s) => text.includes(s));
  const problems = [];
  if (missing.length) problems.push(`missing ${missing.map((s) => JSON.stringify(s)).join(", ")}`);
  if (leaked.length) problems.push(`unexpected ${leaked.map((s) => JSON.stringify(s)).join(", ")}`);
  if (report.htmlLang !== LANGS[expect.lang].locale) {
    problems.push(`<html lang> is "${report.htmlLang || ""}", expected "${LANGS[expect.lang].locale}"`);
  }
  if (problems.length) {
    throw new Error(`${name} rendered the wrong locale/content: ${problems.join("; ")}`);
  }
}

async function main() {
  let browser = "";
  const uiHtml = build();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // One harness page per language: its embedded state, job detail, locale and <html lang> all match.
  const pages = {};
  for (const [lang, L] of Object.entries(LANGS)) {
    pages[lang] = hostHtml({
      uiHtml,
      state: buildDashboardState(lang),
      jobDetail: buildJobDetail(lang),
      lang,
    });
    if (!pages[lang].includes(`<html lang="${L.locale}"`)) {
      throw new Error(`Host harness for "${lang}" did not get <html lang="${L.locale}">`);
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/host" || url.pathname === "/") {
      const lang = url.searchParams.get("lang") === "en" ? "en" : "zh";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(pages[lang]);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const shots = [
    { out: "console-team-en.png", lang: "en", mode: "team" },
    { out: "console-cache-en.png", lang: "en", mode: "cache" },
    { out: "console-team.png", lang: "zh", mode: "team" },
    { out: "console-cache.png", lang: "zh", mode: "cache" },
  ];

  try {
    browser = findBrowserExe();
    if (!browser) {
      throw new Error("No local Edge/Chrome executable found; set AGENT_RELAY_BROWSER_EXE.");
    }
    console.log(`Browser: ${browser}`);
    for (const shot of shots) {
      const name = shot.out.replace(/\.png$/, "");
      const url = `${base}/host?lang=${shot.lang}&mode=${shot.mode}`;
      const outFile = path.join(OUT_DIR, shot.out);
      fs.rmSync(outFile, { force: true });
      let result;
      try {
        result = await captureWithCdp({ browser, url, mode: shot.mode, outFile });
      } catch (err) {
        console.warn(`  CDP capture failed for ${shot.out} (${err.message}); retrying with --screenshot + virtual time.`);
        result = await captureWithScreenshotFlag({ browser, url, outFile });
      }
      if (result.text !== undefined) assertShotContent(name, result);
      else console.warn(`  ${shot.out}: content/locale assertions skipped (fallback renderer cannot report text).`);
      if (process.env.AGENT_RELAY_SHOT_DEBUG === "1" && result.text) {
        console.log(`----- ${shot.out} rendered text -----\n${result.text}\n-----`);
      }
      console.log(
        `  ${shot.out}: ${(result.bytes / 1024).toFixed(1)} KB (${result.method}, ${FRAME_WIDTH}px @${DEVICE_SCALE}x, ` +
          `${result.height ?? "?"} CSS px tall, lang=${shot.lang})` + (result.title ? ` · "${result.title}"` : "")
      );
    }
  } finally {
    await new Promise((r) => server.close(r));
  }

  // Verify everything promised to docs: all four files exist, are real PNGs and are non-trivial.
  let failed = false;
  for (const shot of shots) {
    const file = path.join(OUT_DIR, shot.out);
    if (!fs.existsSync(file)) {
      console.error(`FAIL ${shot.out}: missing`);
      failed = true;
      continue;
    }
    const buf = fs.readFileSync(file);
    const isPng = buf.subarray(1, 4).toString("latin1") === "PNG";
    const ok = isPng && buf.length >= MIN_PNG_BYTES;
    console.log(`${ok ? "OK  " : "FAIL"} docs/screenshots/${shot.out}: ${buf.length} bytes, PNG=${isPng}`);
    if (!ok) failed = true;
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`capture-screenshots failed: ${err?.message || err}`);
  process.exitCode = 1;
});
