import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createDaemonHttpServer } from "../src/daemon/http-server.mjs";
import {
  buildCliInstallSpec,
  checkUpdates,
  compareVersions,
  parseInstallProgress,
} from "../src/core/cli-install.mjs";
import { buildLoginLaunchSpec, resolveLoginAutoOpen } from "../src/core/cli-login.mjs";
import {
  buildProfileLaunchOverlay,
  parseDoubaoAuthStatus,
  parseMiniMaxProviderList,
  parseQoderStatus,
  resolveProfileDir,
  supportsMultiAccountIsolation,
} from "../src/core/cli-profiles.mjs";
import { buildLocalHandoffBrief, classifyChannelFailure } from "../src/core/orchestrator.mjs";
import { RelayStore } from "../src/core/store.mjs";

const results = [];
const WATCHDOG_MS = 28_000;
const watchdog = setTimeout(() => {
  console.error(`GLOBAL TIMEOUT after ${WATCHDOG_MS}ms`);
  process.exit(1);
}, WATCHDOG_MS);

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`PASS  ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started });
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

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "safe.directory=*", ...args], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function request(port, method, urlPath, { token = "", body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: {
          ...(token ? { "X-Astand-UI-Token": token } : {}),
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  await test("buildLocalHandoffBrief emits all 5 sections, 15 deduped steps, git state, tail", async () => {
    await withTempDir("astand-handoff-", async (dir) => {
      git(dir, "init", "--quiet");
      git(dir, "config", "core.hooksPath", path.join(dir, "no-hooks"));
      fs.writeFileSync(path.join(dir, "changed.txt"), "fixture\n", "utf8");
      const activities = [];
      for (let i = 0; i < 20; i++) {
        activities.push({ kind: "cmd", type: "cmd_done", status: "done", summary: `completed step ${i}` });
      }
      activities.push({ kind: "cmd", type: "cmd_done", status: "done", summary: "completed step 0" });
      const output = `START_MARKER${"x".repeat(5_000)}END_MARKER`;
      const brief = buildLocalHandoffBrief({
        originalPrompt: "Implement the multi-CLI backend safely.",
        fromLabel: "Qoder Work",
        reason: "5xx/连接中断",
        activities,
        cwd: dir,
        lastOutput: output,
      });
      const headers = [
        "## 1. 原始任务目标",
        "## 2. 已完成操作",
        "## 3. 当前现场（git status --short）",
        "## 4. 中断前最后输出",
        "## 5. 接力要求",
      ];
      let cursor = -1;
      for (const header of headers) {
        const at = brief.indexOf(header);
        assert.ok(at > cursor, `missing or out-of-order section: ${header}`);
        cursor = at;
      }
      assert.match(brief, /Implement the multi-CLI backend safely/);
      assert.match(brief, /changed\.txt/);
      assert.match(brief, /END_MARKER/);
      assert.doesNotMatch(brief, /START_MARKER/);
      assert.match(brief, /Qoder Work/);
      assert.match(brief, /不要推倒重做/);
      const stepSection = brief.split("## 2. 已完成操作\n")[1].split("\n\n## 3.")[0];
      assert.equal((stepSection.match(/^- /gm) || []).length, 15, "must cap meaningful steps at 15");
      assert.equal(stepSection.match(/completed step 0$/gm)?.length, 1, "must deduplicate steps");
    });
  });

  await test("buildLocalHandoffBrief degrades safely outside a git repository", async () => {
    await withTempDir("astand-handoff-plain-", async (dir) => {
      const brief = buildLocalHandoffBrief({
        originalPrompt: "plain task",
        fromLabel: "Codex",
        reason: "401 登录失效",
        activities: [{ kind: "read", type: "read", status: "done", summary: "read source file" }],
        cwd: dir,
        lastOutput: "",
      });
      assert.match(brief, /不是 Git 仓库/);
      assert.match(brief, /read source file/);
      assert.match(brief, /\(无输出\)/);
    });
  });

  await test("channel failures rotate only for 429/quota, 5xx/disconnect, 401", () => {
    assert.equal(classifyChannelFailure({ message: "HTTP 429 too many requests" }), "rate_limit");
    assert.equal(classifyChannelFailure({ message: "balance exhausted", isQuotaDepleted: true }), "quota");
    assert.equal(classifyChannelFailure({ message: "HTTP 503 Service Unavailable" }), "server");
    assert.equal(classifyChannelFailure({ message: "socket hang up" }), "server");
    assert.equal(classifyChannelFailure({ message: "HTTP 401 unauthorized" }), "auth");
    assert.equal(classifyChannelFailure({ message: "HTTP 400 invalid request" }), null);
    assert.equal(classifyChannelFailure({ message: "turn timed out after 500ms" }), null);
    assert.equal(classifyChannelFailure({ message: "silent for 300s", isPromptTimeout: true }), null);
    assert.equal(classifyChannelFailure({ message: "interrupted by user" }), null);
  });

  await test("profile isolation matrix, safe paths and launch overlays", () => {
    const trueIds = ["codex", "deepseek-harness", "qoder", "qoder-cn", "opencode", "codebuddy", "minimax", "doubao"];
    for (const id of trueIds) assert.equal(supportsMultiAccountIsolation(id), true, id);
    for (const id of ["kimi", "qwen", "gemini", "cursor-cli", "claude-code"]) {
      assert.equal(supportsMultiAccountIsolation(id), false, id);
    }

    const base = path.resolve(os.tmpdir(), "astand-profile-root");
    const codexDir = resolveProfileDir(base, "codex", "work-2");
    assert.equal(codexDir, path.join(base, "cli-profiles", "codex", "work-2"));
    for (const bad of ["../escape", "a/b", "..", ".", "Work", "a b", ""]) {
      assert.throws(() => resolveProfileDir(base, "qoder", bad), /Invalid CLI profile id/, bad);
    }
    assert.throws(() => resolveProfileDir(base, "../codex", "work"), /Invalid CLI engine id/);

    const codex = buildProfileLaunchOverlay("codex", codexDir);
    assert.deepEqual(codex.env, { CODEX_HOME: codexDir });
    assert.deepEqual(codex.extraArgs, []);
    const dsh = buildProfileLaunchOverlay("deepseek-harness", codexDir);
    assert.deepEqual(dsh.env, { DSH_HOME: codexDir });
    const qoder = buildProfileLaunchOverlay("qoder", codexDir);
    assert.deepEqual(qoder.extraArgs, ["--config-dir", codexDir]);
    assert.deepEqual(qoder.env, {});
    const opencode = buildProfileLaunchOverlay("opencode", codexDir);
    assert.deepEqual(opencode.env, { XDG_CONFIG_HOME: codexDir });
    const cb = buildProfileLaunchOverlay("codebuddy", codexDir);
    assert.equal(cb.env.HOME, codexDir);
    assert.equal(cb.env.USERPROFILE, codexDir);
    const mm = buildProfileLaunchOverlay("minimax", codexDir);
    assert.equal(mm.env.HOME, codexDir);
    assert.equal(mm.env.USERPROFILE, codexDir);
    assert.deepEqual(buildProfileLaunchOverlay("doubao", codexDir), { env: {}, extraArgs: [] });
  });

  await test("account parsers expose only non-sensitive identity fields", () => {
    const qoder = parseQoderStatus("Username: alice\nEmail: alice@example.com\nLogin Method: oauth\nToken: sk-secret-value");
    assert.equal(qoder.username, "alice");
    assert.equal(qoder.email, "alice@example.com");
    assert.equal(qoder.loginMethod, "oauth");
    assert.equal(qoder.loggedIn, true);
    assert.ok(!JSON.stringify(qoder).includes("sk-secret-value"));

    const doubao = parseDoubaoAuthStatus('{"user_id":"u-123","email":"u@example.com"}');
    assert.equal(doubao.userId, "u-123");
    assert.equal(doubao.loggedIn, true);
    assert.ok(!JSON.stringify(doubao).includes("token"));

    assert.equal(parseMiniMaxProviderList("minimax_oauth   active   default").loggedIn, true);
    assert.equal(parseMiniMaxProviderList("minimax_oauth   disabled").loggedIn, false);
  });

  await test("qoder login never double-opens while minimax/others keep auto-open", () => {
    const fakeResolver = () => ({ command: process.execPath, useShell: false });
    const qoderDef = { command: "qodercli", loginCmd: "qodercli login" };
    const qoderSpec = buildLoginLaunchSpec("qoder", qoderDef, "cn", "C:\\profiles\\work", fakeResolver);
    assert.equal(qoderSpec.ok, true);
    assert.deepEqual(qoderSpec.args, ["--config-dir", "C:\\profiles\\work", "login"]);
    assert.equal(qoderSpec.autoOpen, false);
    assert.equal(resolveLoginAutoOpen("qoder", true), false);

    const minimaxSpec = buildLoginLaunchSpec("minimax", { command: "mcode" }, "global", "", fakeResolver);
    assert.equal(minimaxSpec.autoOpen, true);
    assert.deepEqual(minimaxSpec.args, ["login", "--no-browser", "--region", "global"]);

    const codexSpec = buildLoginLaunchSpec("codex", { command: "codex", loginCmd: "codex login" }, "cn", "C:\\profiles\\codex", fakeResolver);
    assert.equal(codexSpec.env.CODEX_HOME, "C:\\profiles\\codex");
    assert.deepEqual(codexSpec.args, ["login"]);
  });

  await test("store persists CLI model whitelist and account profile CRUD", async () => {
    await withTempDir("astand-store-profiles-", async (dir) => {
      const store = new RelayStore(dir);
      for (const id of ["codex", "qoder", "opencode"]) {
        const profiles = store.getCliAccountProfiles(id);
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].id, "default");
        assert.equal(profiles[0].isDefault, true);
      }
      assert.deepEqual(store.getCliAccountProfiles("kimi"), []);

      const set = store.setCliModelWhitelist("qoder", ["m1", "m1", " m2 ", ""]);
      assert.deepEqual(set.modelIds, ["m1", "m2"]);
      const added = store.addCliAccountProfile("qoder", "Work");
      assert.equal(added.ok, true);
      assert.match(added.profile.id, /^profile-[0-9a-f]{10}$/);

      const reloaded = new RelayStore(dir);
      assert.deepEqual(reloaded.getCliModelWhitelist().qoder, ["m1", "m2"]);
      assert.equal(reloaded.getCliAccountProfiles("qoder").length, 2);
      assert.equal(reloaded.updateCliAccountProfile("qoder", added.profile.id, { enabled: false, label: "Work 2" }).ok, true);
      const afterUpdate = new RelayStore(dir).getCliAccountProfiles("qoder").find((p) => p.id === added.profile.id);
      assert.equal(afterUpdate.enabled, false);
      assert.equal(afterUpdate.label, "Work 2");
      assert.equal(reloaded.deleteCliAccountProfile("qoder", "default").ok, false);
      assert.equal(reloaded.updateCliAccountProfile("qoder", "default", { enabled: false }).ok, false);
      assert.equal(reloaded.deleteCliAccountProfile("qoder", added.profile.id).ok, true);
      assert.equal(reloaded.addCliAccountProfile("kimi", "Nope").ok, false);

      fs.rmSync(path.join(dir, "settings.json"), { force: true });
      fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ version: 3 }), "utf8");
      const legacy = new RelayStore(dir);
      assert.deepEqual(legacy.getCliModelWhitelist(), {});
      assert.equal(legacy.getCliAccountProfiles("codex")[0].id, "default");
    });
  });

  await test("install command builder is fixed-argv and npm 11 script whitelist aware", () => {
    const spec = buildCliInstallSpec({ engineId: "qoder", mode: "install", npmMajor: 11 });
    assert.equal(spec.ok, true);
    assert.equal(spec.command, "npm");
    assert.ok(spec.args.includes("--no-audit"));
    assert.ok(spec.args.includes("--no-fund"));
    assert.ok(spec.args.some((arg) => arg.startsWith("--allow-scripts=@qoder-ai/qodercli")));
    assert.ok(!spec.args.join(" ").includes(";"));

    const legacyNpm = buildCliInstallSpec({ engineId: "qoder", mode: "update", npmMajor: 10 });
    assert.ok(!legacyNpm.args.some((arg) => arg.startsWith("--allow-scripts=")));
    assert.ok(legacyNpm.args.includes("@qoder-ai/qodercli@latest"));
    assert.equal(buildCliInstallSpec({ engineId: "unknown", mode: "install" }).ok, false);

    assert.deepEqual(parseInstallProgress("npm http fetch GET 200 tarball", 10), { percent: 25, stage: "正在从 npm 下载安装包" });
    assert.deepEqual(parseInstallProgress("node-gyp rebuild", 35), { percent: 75, stage: "执行原生初始化脚本" });
    assert.equal(compareVersions("v2.1.0", "2.0.9"), 1);
    assert.equal(compareVersions("2.0.0", "2.0.0"), 0);
  });

  await test("checkUpdates detects app and installed npm CLI updates, fail-silent upstreams", async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("api.github.com")) {
        return { ok: true, json: async () => ({ tag_name: "v9.9.9" }) };
      }
      return { ok: true, json: async () => ({ version: "8.8.8" }) };
    };
    try {
      const result = await checkUpdates({
        currentVersion: "1.0.0",
        detectedEngines: {
          qoder: { installed: true, version: "1.0.0" },
          minimax: { installed: true, version: "2.0.0" },
          doubao: { installed: true, version: "3.0.0" },
        },
        force: true,
      });
      assert.equal(result.app.updateAvailable, true);
      assert.equal(result.app.latestVersion, "v9.9.9");
      assert.equal(result.engines.length, 3);
      assert.ok(result.engines.every((item) => item.updateAvailable && item.latestVersion === "8.8.8"));
    } finally {
      global.fetch = originalFetch;
    }
  });

  await test("HTTP whitelist, account CRUD, login spec and update endpoints", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astand-http-cli-"));
    const store = new RelayStore(dir);
    const orchestrator = {
      subscribe: () => () => {},
      getDashboardState: async () => ({ settings: store.getPublicState(), engines: {}, cliAccounts: {}, cliInstalls: {} }),
      getPerfSummary: () => ({ total: 0 }),
      getJobDetail: () => ({ ok: false, error: "not found" }),
    };
    const clientRegistry = { subscribe: () => () => {}, listPublic: () => [] };
    let server;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("api.github.com")) return { ok: true, json: async () => ({ tag_name: "v99.0.0" }) };
      return { ok: true, json: async () => ({ version: "7.7.7" }) };
    };
    try {
      server = await createDaemonHttpServer({
        store,
        telemetry: { clear() {} },
        orchestrator,
        clientRegistry,
        port: 0,
        uiToken: "test-ui-token",
        desktopHtmlPath: path.join(dir, "desktop.html"),
        bridgeScript: path.join(dir, "bridge.mjs"),
        rulesFile: path.join(dir, "AGENTS.md"),
        skillsFile: path.join(dir, "SKILL.md"),
        version: "1.0.0",
      });
      const token = server.uiToken;
      const port = server.port;

      const whitelist = await request(port, "POST", "/api/cli-engines/qoder/whitelist", {
        token,
        body: { modelIds: ["model-a", "model-a", "model-b"] },
      });
      assert.equal(whitelist.status, 200, whitelist.text);
      assert.deepEqual(whitelist.json.modelIds, ["model-a", "model-b"]);
      assert.deepEqual(whitelist.json.state.settings.cliModelWhitelist.qoder, ["model-a", "model-b"]);

      const created = await request(port, "POST", "/api/cli-engines/opencode/accounts", {
        token,
        body: { label: "Work account" },
      });
      assert.equal(created.status, 200, created.text);
      const profileId = created.json.profile.id;
      assert.equal(created.json.profiles.find((p) => p.id === profileId).label, "Work account");

      const listed = await request(port, "GET", "/api/cli-engines/opencode/accounts", { token });
      assert.equal(listed.status, 200, listed.text);
      assert.equal(listed.json.supportsMultiAccountIsolation, true);
      assert.equal(listed.json.profiles.length, 2);
      assert.ok(listed.json.account);
      assert.ok(!JSON.stringify(listed.json).match(/sk-[A-Za-z0-9_-]{8,}/));

      const patched = await request(port, "PATCH", `/api/cli-engines/opencode/accounts/${profileId}`, {
        token,
        body: { enabled: false, label: "Paused" },
      });
      assert.equal(patched.status, 200, patched.text);
      assert.equal(patched.json.profile.enabled, false);
      assert.equal(patched.json.profile.label, "Paused");

      const traversal = await request(port, "DELETE", "/api/cli-engines/opencode/accounts/..%2F..%2Fescape", { token });
      assert.ok(traversal.status >= 400, "path-like profile id must be rejected");

      const deleted = await request(port, "DELETE", `/api/cli-engines/opencode/accounts/${profileId}`, { token });
      assert.equal(deleted.status, 200, deleted.text);
      assert.equal(deleted.json.profiles.length, 1);

      const deleteDefault = await request(port, "DELETE", "/api/cli-engines/opencode/accounts/default", { token });
      assert.equal(deleteDefault.status, 400);

      const disabledLogin = await request(port, "POST", "/api/cli-engines/opencode/login", {
        token,
        body: { profileId: "missing-profile", autoOpen: false },
      });
      assert.equal(disabledLogin.status, 400);

      const updates = await request(port, "GET", "/api/updates/check?force=1", { token });
      assert.equal(updates.status, 200, updates.text);
      assert.equal(updates.json.app.updateAvailable, true);
      assert.equal(updates.json.app.latestVersion, "v99.0.0");

      const cancelInstall = await request(port, "POST", "/api/cli-engines/qoder/install/cancel", { token });
      assert.equal(cancelInstall.status, 200);
      assert.equal(cancelInstall.json.cancelled, false);
    } finally {
      global.fetch = originalFetch;
      try {
        await server?.close();
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    console.error(`\n${failed.length}/${results.length} CLI platform tests FAILED`);
    process.exitCode = 1;
  } else {
    console.log(`\nALL ${results.length} CLI PLATFORM TESTS PASSED`);
  }
}

main()
  .catch((err) => {
    console.error("Test harness failed:", err?.stack || err);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
