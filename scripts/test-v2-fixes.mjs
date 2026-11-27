import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acpCwdEquivalent,
  evaluateAcpProjectionUsage,
  isLeakedToolCallsOutput,
  parseAcpProjectionRecord,
  projectionCacheSessionsDir,
  readFreshProjectionSample,
} from "../src/engines/acp.mjs";
import { detectGitRepo, relSubdirFromPrefix, resolveRepoRootFromPrefix } from "../src/core/worktree.mjs";
import { describeQueueExhaustion } from "../src/core/orchestrator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const results = [];

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

function projectionDocument({ cwd, turn, step, seq }) {
  return JSON.stringify({
    version: 3,
    record: {
      identity: { formatVersion: 1, cwd, isSeeded: false, inheritedEventCount: 0 },
      rows: {
        tokenUsage: {
          ver: 2,
          seq,
          val: {
            totals: {
              uncachedInputTokens: 100,
              outputTokens: 20,
              cacheReadTokens: 80,
              cacheWriteTokens: 0,
            },
            last: {
              turn,
              step,
              buckets: {
                uncachedInputTokens: 5,
                outputTokens: 2,
                cacheReadTokens: 12,
                cacheWriteTokens: 0,
              },
            },
          },
        },
      },
    },
  });
}

const BASELINE = {
  seq: 1,
  turn: 1,
  step: 1,
  totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

// ---- Bug 1a: Turn-1 delayed project-cache flush must be polled, not aborted ----
async function testTurn1DelayedProjectionFlush() {
  await withTempDir("ar-fix-proj-", async (dshHome) => {
    const sessionsDir = projectionCacheSessionsDir(dshHome);
    fs.mkdirSync(sessionsDir, { recursive: true });
    const doc = projectionDocument({ cwd: "C:\\work\\repo", turn: 1, step: 3, seq: 9 });
    let reads = 0;
    const pending = { n: 0 };
    const result = await readFreshProjectionSample({
      dshHome,
      sessionId: "sess-turn1",
      baseline: BASELINE,
      options: { cwd: "C:\\work\\repo", sessionId: "sess-turn1", startedAtMs: Date.now() },
      attempts: 12,
      intervalMs: 5,
      readRecord: () => {
        reads += 1;
        pending.n += 1;
        if (pending.n <= 3) return null; // dsh has not flushed the file yet
        return {
          snapshot: parseAcpProjectionRecord(doc),
          path: path.join(sessionsDir, "sess-turn1.json"),
          mtimeMs: Date.now(),
        };
      },
    });
    assert.ok(result, "Turn 1 must keep polling until the projection file appears");
    assert.equal(reads, 4, `Expected 4 reads (3 empty + 1 hit), got ${reads}`);
    assert.equal(result.evaluated.ok, true, result.evaluated.reason);
    assert.equal(result.evaluated.provenance.freshness, "advanced-since-dispatch-baseline");
    assert.equal(result.evaluated.usage.cachedInputTokens, 12);
  });
}

// ---- Bug 1a: plugin-less dsh (no sessions directory) must return instantly ----
async function testProjectionPollSkipsWhenCachePluginAbsent() {
  await withTempDir("ar-fix-nocache-", async (dshHome) => {
    let reads = 0;
    const started = Date.now();
    const result = await readFreshProjectionSample({
      dshHome,
      sessionId: "sess-none",
      baseline: BASELINE,
      options: { cwd: "C:\\work\\repo", sessionId: "sess-none" },
      readRecord: () => {
        reads += 1;
        return null;
      },
    });
    assert.equal(result, null);
    assert.equal(reads, 0, "Must not poll when the cache plugin directory is absent");
    assert.ok(Date.now() - started < 200, "Absent cache plugin must not add polling latency");
  });
}

// ---- Bug 1b: SMB mapped-drive / UNC cwd aliases must not be rejected ----
async function testSmbCwdNormalization() {
  const snap = parseAcpProjectionRecord(
    projectionDocument({ cwd: "\\\\host\\share\\repo", turn: 2, step: 1, seq: 10 })
  );
  const options = { cwd: "Z:\\share\\repo", sessionId: "sess-smb", startedAtMs: Date.now() };
  const evaluated = evaluateAcpProjectionUsage(snap, { ...options, baseline: BASELINE });
  assert.equal(evaluated.ok, true, `drive-vs-UNC alias rejected: ${evaluated.reason}`);

  assert.equal(acpCwdEquivalent("\\\\host\\share\\repo", "Z:\\share\\repo", { sessionId: "sess-smb" }), true);
  assert.equal(acpCwdEquivalent("\\\\host\\share\\repo", "Z:\\share\\other", { sessionId: "sess-smb" }), false);
  assert.equal(acpCwdEquivalent("\\\\host\\share\\repo", "Z:\\share\\repo", {}), false, "tail alias needs a session match");

  const mismatch = evaluateAcpProjectionUsage(snap, {
    cwd: "Z:\\share\\other",
    sessionId: "sess-smb",
    baseline: BASELINE,
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "cwd-mismatch");

  // Same-namespace mismatches must still be rejected (different repo tail).
  const localMismatch = evaluateAcpProjectionUsage(snap, {
    cwd: "C:\\other\\checkout",
    sessionId: "sess-smb",
    baseline: BASELINE,
  });
  assert.equal(localMismatch.reason, "cwd-mismatch");
}

// ---- Bug 2: SMB UNC-vs-drive detectGitRepo must stay a repo ----
async function testDetectGitRepoLocalAndMappedDrive() {
  withTempDir("ar-fix-git-", (dir) => {
    const repo = path.join(dir, "source repo");
    const subdir = path.join(repo, "src");
    fs.mkdirSync(subdir, { recursive: true });
    const git = (cwd, ...args) =>
      execFileSync("git", ["-c", "safe.directory=*", ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 5000,
      }).trim();
    git(repo, "init", "--quiet");
    git(repo, "config", "core.hooksPath", path.join(dir, "no-hooks"));
    fs.writeFileSync(path.join(subdir, "tracked.txt"), "fixture\n");
    git(repo, "add", "src/tracked.txt");
    git(repo, "-c", "user.name=Fix Fixture", "-c", "user.email=fix@example.test", "commit", "--quiet", "--no-gpg-sign", "-m", "Base");

    const detected = detectGitRepo(subdir);
    assert.equal(detected.isGit, true, "local repo must be detected");
    assert.equal(detected.repoRoot, fs.realpathSync(repo));
    assert.equal(detected.relSubdir, "src");

    const atRoot = detectGitRepo(repo);
    assert.equal(atRoot.isGit, true);
    assert.equal(atRoot.relSubdir, "");

    // A non-repo directory stays non-repo.
    const plain = path.join(dir, "plain dir");
    fs.mkdirSync(plain);
    assert.deepEqual(detectGitRepo(plain), { isGit: false });
  });

  assert.equal(relSubdirFromPrefix("src/\n"), "src");
  assert.equal(relSubdirFromPrefix("\n"), "");

  const simulatedBase = path.resolve(os.tmpdir(), "ar-fix-sim-root");
  assert.equal(
    resolveRepoRootFromPrefix(path.join(simulatedBase, "a", "b"), path.join("a", "b")),
    path.normalize(simulatedBase)
  );

  if (process.platform === "win32") {
    // Simulated SMB mismatch: Git reports \\host\share\repo as toplevel while cwd lives on Z:.
    // Prefix-derived walking must stay on the drive namespace instead of path.relative()ing to
    // an absolute UNC path (which used to yield { isGit: false }).
    assert.equal(
      resolveRepoRootFromPrefix("Z:\\share\\repo\\src", "src"),
      path.normalize("Z:\\share\\repo")
    );
    assert.equal(
      resolveRepoRootFromPrefix("Z:\\公共\\project\\pkg", "pkg"),
      path.normalize("Z:\\公共\\project")
    );
  }
}

// ---- Bug 3: pinned-session 429 vs genuine all-engines exhaustion ----
async function testPinnedSessionRateLimitClassification() {
  const queue = [
    { id: "gpt-6.2-sol", name: "GPT-6.2 Sol" },
    { id: "claude-opus", name: "Claude Opus" },
    { id: "gemini-pro", name: "Gemini Pro" },
  ];
  const cooled = new Set(["gpt-6.2-sol"]);
  const getCooldown = (id) =>
    cooled.has(id) ? { reason: "rate_limit_reached", untilMs: Date.now() + 3_600_000 } : null;

  const pinned = describeQueueExhaustion({
    role: "hephaestus",
    queue,
    getCooldown,
    pinnedModelId: "gpt-6.2-sol",
    lastErr: { message: "HTTP 429 rate limit", isRateLimit: true },
  });
  assert.match(pinned, /^\[SESSION_MODEL_RATE_LIMITED\]/);
  assert.match(pinned, /gpt-6\.2-sol/);
  assert.match(pinned, /claude-opus/);
  assert.match(pinned, /gemini-pro/);
  assert.match(pinned, /omit sessionId/i);
  assert.doesNotMatch(pinned, /ALL_ENGINES_EXHAUSTED/);

  assert.equal(
    describeQueueExhaustion({
      role: "hephaestus",
      queue,
      getCooldown: () => null,
      pinnedModelId: "",
      lastErr: { message: "boom" },
    }),
    null,
    "A plain non-exhaustion error must not be rewritten"
  );

  cooled.add("claude-opus");
  cooled.add("gemini-pro");
  const allCooled = describeQueueExhaustion({
    role: "hephaestus",
    queue,
    getCooldown,
    pinnedModelId: "gpt-6.2-sol",
    lastErr: { message: "HTTP 429 rate limit", isRateLimit: true },
  });
  assert.match(allCooled, /^\[ALL_ENGINES_EXHAUSTED\]/);
  assert.doesNotMatch(allCooled, /SESSION_MODEL_RATE_LIMITED/);

  // Unpinned but genuinely all cooled still reports exhaustion.
  assert.match(
    describeQueueExhaustion({
      role: "oracle",
      queue,
      getCooldown,
      pinnedModelId: "",
      lastErr: { message: "quota", isQuotaDepleted: true },
    }),
    /^\[ALL_ENGINES_EXHAUSTED\]/
  );
}

// ---- Bug 4: leaked raw tool_calls JSON must be detected; prose/docs must not ----
async function testLeakedToolCallsDetector() {
  const dump =
    '{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"read","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}';
  assert.equal(isLeakedToolCallsOutput(dump), true, "raw dump must be detected");
  assert.equal(isLeakedToolCallsOutput(`${dump}]}`), true, "malformed trailing braces must still be detected");
  assert.equal(isLeakedToolCallsOutput("```json\n" + dump + "\n```"), true, "fenced dump must be detected");
  assert.equal(
    isLeakedToolCallsOutput(
      '{"tool_calls":[{"id":"call_2","type":"function","function":{"name":"write","arguments":"{}"}}]}'
    ),
    true,
    "type=function payload without content must be detected"
  );

  assert.equal(
    isLeakedToolCallsOutput(
      'During review I noticed the "tool_calls" array is never validated before dispatch.'
    ),
    false,
    "prose mentioning tool_calls must not trip the detector"
  );
  assert.equal(
    isLeakedToolCallsOutput('Here is an example:\n{"content":"","tool_calls":[]}'),
    false,
    "prose followed by an example must not trip the detector"
  );
  assert.equal(
    isLeakedToolCallsOutput('{"content":"Real answer about tool_calls","tool_calls":[]}'),
    false,
    "non-empty content is a normal response"
  );
  assert.equal(
    isLeakedToolCallsOutput("```json\n{\"tool_calls\":[]}\n```\nThis snippet documents the protocol."),
    false,
    "documentation with trailing prose must not trip the detector"
  );
  assert.equal(isLeakedToolCallsOutput('{"tool_calls":"not an array"}'), false);
  assert.equal(isLeakedToolCallsOutput(""), false);
  assert.equal(isLeakedToolCallsOutput(null), false);
}

await test("Bug1a Turn-1 delayed project-cache flush", testTurn1DelayedProjectionFlush);
await test("Bug1a plugin-less dsh cache fast path", testProjectionPollSkipsWhenCachePluginAbsent);
await test("Bug1b SMB mapped-drive cwd normalization", testSmbCwdNormalization);
await test("Bug2 SMB UNC-vs-drive detectGitRepo", testDetectGitRepoLocalAndMappedDrive);
await test("Bug3 pinned-session 429 classification", testPinnedSessionRateLimitClassification);
await test("Bug4 leaked tool_calls detector", testLeakedToolCallsDetector);

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} fix regression tests FAILED`);
  process.exitCode = 1;
} else {
  console.log(`\nALL ${results.length} V2 FIX REGRESSION TESTS PASSED! (${ROOT})`);
}
