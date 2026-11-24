import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { RelayStore } from "../src/core/store.mjs";
import { createJobWorktree, detectGitRepo, finalizeJobWorktree } from "../src/core/worktree.mjs";
import { AcpEngine, parseToolActivity, summarizeToolInput } from "../src/engines/acp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVER_BUNDLE = path.join(ROOT, "dist", "server.mjs");
const HTML_BUNDLE = path.join(ROOT, "dist", "console.html");
const WAIT_JOB_BUNDLE = path.join(ROOT, "dist", "wait-job.mjs");
const WAIT_JOB_SRC = path.join(ROOT, "scripts", "wait-job.mjs");

const LONG_CALL_OPTS = { timeout: 240_000 };

function testWorktrees() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-worktree-"));
  try {
    const repo = path.join(dir, "source repo");
    const dataDir = path.join(dir, "plugin data");
    const subdir = path.join(repo, "src");
    fs.mkdirSync(subdir, { recursive: true });
    const git = (cwd, ...args) => execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5000,
    }).trim();
    assert.deepEqual(detectGitRepo(dir), { isGit: false });
    git(repo, "init", "--quiet");
    git(repo, "config", "core.hooksPath", path.join(dir, "no-hooks"));
    assert.deepEqual(detectGitRepo(subdir), { isGit: false });
    fs.writeFileSync(path.join(subdir, "tracked.txt"), "fixture\n");
    git(repo, "add", "src/tracked.txt");
    const commit = (cwd, message) =>
      git(cwd, "-c", "user.name=Worktree Fixture", "-c", "user.email=fixture@example.test",
        "commit", "--quiet", "--no-gpg-sign", "-m", message);
    commit(repo, "Base");
    const detected = detectGitRepo(subdir);
    assert.deepEqual(detected, {
      isGit: true, repoRoot: fs.realpathSync(repo), headSha: git(repo, "rev-parse", "HEAD"), relSubdir: "src",
    });

    const create = (jobId) => createJobWorktree({ ...detected, dataDir, jobId });
    const clean = create("job_clean");
    assert.deepEqual(clean, {
      worktreeRoot: path.join(dataDir, "worktrees", "job_clean"),
      effectiveCwd: path.join(dataDir, "worktrees", "job_clean", "src"),
      branch: "astand/job_clean",
      repoRoot: detected.repoRoot,
      baseHead: detected.headSha,
    });
    assert.equal(git(clean.effectiveCwd, "branch", "--show-current"), clean.branch);
    assert.equal(fs.readFileSync(path.join(clean.effectiveCwd, "tracked.txt"), "utf8").trim(), "fixture");
    assert.deepEqual(finalizeJobWorktree(clean), { kept: false, pruned: true });
    assert.equal(fs.existsSync(clean.worktreeRoot), false);
    assert.equal(git(repo, "branch", "--list", clean.branch), "");

    const localDir = path.join(subdir, "local");
    fs.mkdirSync(localDir);
    const emptyCwd = createJobWorktree({ ...detectGitRepo(localDir), dataDir, jobId: "job_empty_cwd" });
    assert.ok(fs.statSync(emptyCwd.effectiveCwd).isDirectory());
    assert.deepEqual(finalizeJobWorktree(emptyCwd), { kept: false, pruned: true });

    const dirty = create("job_dirty");
    git(dirty.effectiveCwd, "mv", "tracked.txt", "renamed.txt");
    fs.writeFileSync(path.join(dirty.effectiveCwd, "untracked.txt"), "isolated\n");
    assert.deepEqual(finalizeJobWorktree(dirty), {
      kept: true, pruned: false, branch: dirty.branch, worktreeRoot: dirty.worktreeRoot,
      changedFilesCount: 2, commitsCount: 0,
    });
    assert.equal(git(repo, "status", "--porcelain"), "");
    git(dirty.effectiveCwd, "add", "untracked.txt");
    commit(dirty.effectiveCwd, "Isolated work");
    assert.deepEqual(finalizeJobWorktree(dirty), {
      kept: true, pruned: false, branch: dirty.branch, worktreeRoot: dirty.worktreeRoot,
      changedFilesCount: 0, commitsCount: 1,
    });
    assert.ok(fs.existsSync(dirty.worktreeRoot));
    assert.equal(git(repo, "rev-parse", "refs/heads/" + dirty.branch), git(dirty.effectiveCwd, "rev-parse", "HEAD"));

    // Verify worktree dependency/config hydration & safe junction cleanup (never deletes main repo deps!)
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n.venv/\n.env\nlocal_assets/\n");
    fs.writeFileSync(path.join(repo, ".worktreeinclude"), "# custom ignored dir\nlocal_assets\n");
    git(repo, "add", ".gitignore", ".worktreeinclude");
    commit(repo, "Add gitignore and worktreeinclude");
    fs.mkdirSync(path.join(repo, "node_modules", "demo-pkg"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "demo-pkg", "index.js"), "module.exports = 42;\n");
    fs.mkdirSync(path.join(repo, ".venv"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
    fs.writeFileSync(path.join(repo, ".env"), "DEMO_PORT=3000\n");
    fs.mkdirSync(path.join(repo, "local_assets"), { recursive: true });
    fs.writeFileSync(path.join(repo, "local_assets", "seed.txt"), "seed-ok\n");

    const hydrated = createJobWorktree({ ...detectGitRepo(subdir), dataDir, jobId: "job_hydrated" });
    assert.equal(fs.readFileSync(path.join(hydrated.worktreeRoot, "node_modules", "demo-pkg", "index.js"), "utf8").trim(), "module.exports = 42;");
    assert.equal(fs.readFileSync(path.join(hydrated.worktreeRoot, ".venv", "pyvenv.cfg"), "utf8").trim(), "home = /usr/bin");
    assert.equal(fs.readFileSync(path.join(hydrated.worktreeRoot, ".env"), "utf8").trim(), "DEMO_PORT=3000");
    assert.equal(fs.readFileSync(path.join(hydrated.worktreeRoot, "local_assets", "seed.txt"), "utf8").trim(), "seed-ok");
    // .env must be an independent copy so modifying it in worktree does not mutate main repo
    fs.writeFileSync(path.join(hydrated.worktreeRoot, ".env"), "DEMO_PORT=3099\n");
    assert.equal(fs.readFileSync(path.join(repo, ".env"), "utf8").trim(), "DEMO_PORT=3000");
    // Clean prune must remove the worktree and leave main repo dependencies 100% untouched
    assert.deepEqual(finalizeJobWorktree(hydrated), { kept: false, pruned: true });
    assert.equal(fs.existsSync(hydrated.worktreeRoot), false);
    assert.equal(fs.readFileSync(path.join(repo, "node_modules", "demo-pkg", "index.js"), "utf8").trim(), "module.exports = 42;");
    assert.equal(fs.readFileSync(path.join(repo, ".venv", "pyvenv.cfg"), "utf8").trim(), "home = /usr/bin");
    assert.equal(fs.readFileSync(path.join(repo, "local_assets", "seed.txt"), "utf8").trim(), "seed-ok");

    const settings = new RelayStore(dataDir);
    assert.equal(settings.settings.allowWorktreeParallelWrite, false);
    settings.updateTopSettings({ allowWorktreeParallelWrite: true });
    assert.equal(new RelayStore(dataDir).settings.allowWorktreeParallelWrite, true);
    settings.updateTopSettings({ allowWorktreeParallelWrite: false });
    assert.equal(new RelayStore(dataDir).settings.allowWorktreeParallelWrite, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("Git worktree lifecycle and Settings persistence PASSED.");
}

async function connectClient(dataDir, engineEnv) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_BUNDLE, "--data-dir", dataDir],
    env: { ...process.env, ...engineEnv },
    stderr: "pipe",
  });
  const client = new Client({ name: "e2e-runner", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function verifyHtmlSyntax(htmlText) {
  const doctypeCount = (htmlText.match(/<!doctype html>/gi) || []).length;
  assert.equal(doctypeCount, 1, `Expected exactly 1 doctype, found ${doctypeCount}`);
  assert.ok(!htmlText.includes("/*__INLINE_JS__*/"), "Unreplaced JS placeholder!");
  assert.ok(!htmlText.includes("/*__INLINE_CSS__*/"), "Unreplaced CSS placeholder!");
  assert.ok(!htmlText.includes('<script type="module">'), "Unexpected type=\"module\" script tag!");
  assert.ok(htmlText.includes('id="ar-boot-status"'), "Missing static boot fallback shell!");

  const m = htmlText.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
  assert.ok(m && m[1], "Missing <script> block in console.html");
  const jsBody = m[1];
  assert.ok(jsBody.length > 5000, "Bundled UI JS unexpectedly short");

  const tmpJs = path.join(os.tmpdir(), `ar-ui-check-${Date.now()}.js`);
  fs.writeFileSync(tmpJs, jsBody, "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmpJs], { stdio: "pipe" });
  } finally {
    fs.rmSync(tmpJs, { force: true });
  }
}

function findBrowserExe() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((p) => fs.existsSync(p)) || "";
}

async function testBrowserStrictCspRender(htmlText, realToolResult) {
  const browser = findBrowserExe();
  if (!browser) {
    console.log("  (Skipping browser CSP test — no Edge/Chrome executable found)");
    return;
  }

  const activities = [
    { id: "thought", kind: "thought", durationSec: 8, status: "done", detail: "Check the gateway first." },
    { id: "read", kind: "read", title: "gateway.go", meta: "#L315-455" },
    { id: "edit", kind: "edit", title: "gate.go", added: 13, removed: 4, detail: "-before\n+after" },
    { id: "search", kind: "search", title: '"sessionKeyOf"', meta: "gateway/" },
    { id: "cmd", kind: "cmd", title: "pwsh: go test ./internal/gateway", status: "error", durationSec: 2,
      exitCode: 1, detail: "$ go test ./internal/gateway\n\nFAIL <optional>" },
    { id: "message", kind: "output", title: "Gateway verified.", detail: "## Results\n\n**Gateway verified.**" },
  ];
  const running = {
    jobId: "job_fixture_timeline", status: "running", role: "oracle", title: "Check gateway", elapsedSec: 12,
    modelDisplayName: "fixture-codex", logPath: "C:\\fixtures\\gateway-job.log", recentActivities: activities.slice(0, 5),
    prompt: "Inspect **gateway** and preserve <raw> tags.", activities: activities.slice(0, 5),
  };
  const complete = {
    ...running, status: "completed", activities,
    finalText: "## Results\n\n**Gateway verified.**\n\n- Use `go test`\n- Keep <img src=x onerror=alert(1)> escaped\n\n```go\nfmt.Println(1)\n```\n\n[A.stand · fixture]\n\n[Git Worktree] Branch: astand/job_fixture",
  };
  realToolResult.structuredContent.settings.lang = "en";
  realToolResult.structuredContent.activeJobs = [running];

  let resolveReport;
  const reportPromise = new Promise((r) => {
    resolveReport = r;
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/report" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
        try {
          resolveReport(JSON.parse(body));
        } catch (err) {
          resolveReport({ parseError: String(err) });
        }
      });
      return;
    }
    if (req.url === "/host") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>
        <iframe id="fMain" src="/app" style="width:700px;height:600px"></iframe>
        <iframe id="fOpaque" sandbox="allow-scripts allow-forms" style="width:400px;height:400px"></iframe>
        <script>
          const TOOL_RESULT = ${JSON.stringify(realToolResult).replace(/</g, "\\u003c")};
          TOOL_RESULT.structuredContent.engines["deepseek-harness"].status = "ready";
          TOOL_RESULT.structuredContent.engines["claude-code"].status = "missing";
          const HTML_SRC = ${JSON.stringify(htmlText).replace(/</g, "\\u003c")};
          const LIVE_JOB = ${JSON.stringify(running).replace(/</g, "\\u003c")};
          const DONE_JOB = ${JSON.stringify(complete).replace(/</g, "\\u003c")};
          let detailCalls = 0;
          const events = [];
          const errors = [];
          const fMain = document.getElementById("fMain");
          const fOpaque = document.getElementById("fOpaque");

          fMain.addEventListener("load", () => {
            try {
              fMain.contentWindow.addEventListener("error", (e) => errors.push(e.message || String(e.error)));
              fMain.contentWindow.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
              fMain.contentDocument.addEventListener("securitypolicyviolation", (e) => errors.push(e.violatedDirective));
            } catch {}
          });

          function hostileInitResult() {
            return {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "AntigravityHost", extraField: null },
              hostCapabilities: {
                serverTools: true,
                openLinks: true,
                message: true,
                updateModelContext: { text: true, resourceLink: true },
                badCap: null
              },
              hostContext: {
                theme: "dark",
                platform: "web",
                displayMode: "inline",
                locale: null,
                containerDimensions: { maxHeight: 800, width: null },
                styles: {
                  variables: {
                    "--color-background-primary": "#111113",
                    "--color-text-primary": "#f4f4f5",
                    "--antigravity-custom": "#123456",
                    "--unknown-extra-token": "12px"
                  }
                }
              }
            };
          }

          window.addEventListener("message", (e) => {
            const who = e.source === fMain.contentWindow ? "main" : e.source === fOpaque.contentWindow ? "opaque" : "other";
            const msg = e.data;
            if (!msg || msg.jsonrpc !== "2.0") return;
            events.push({ who, method: msg.method, id: msg.id });
            if (msg.method === "ui/initialize") {
              e.source.postMessage({ jsonrpc: "2.0", id: msg.id, result: hostileInitResult() }, "*");
            } else if (msg.method === "ui/notifications/initialized") {
              e.source.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } }, "*");
              e.source.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: TOOL_RESULT }, "*");
            } else if (msg.method === "tools/call") {
              let result = TOOL_RESULT;
              if (msg.params?.name === "agent_relay_ui_fetch_models") {
                result = { content: [], structuredContent: { ok: true, models: [{ id: "upstream-only" }] } };
              }
              if (msg.params?.name === "agent_relay_ui_get_job_detail") {
                result = { content: [], structuredContent: { ok: true, job: ++detailCalls === 1 ? LIVE_JOB : DONE_JOB } };
              }
              if (msg.params?.name === "agent_relay_ui_update_settings") {
                TOOL_RESULT.structuredContent.settings.allowWorktreeParallelWrite =
                  msg.params.arguments.allowWorktreeParallelWrite;
              }
              e.source.postMessage({ jsonrpc: "2.0", id: msg.id, result }, "*");
            }
          });

          fOpaque.srcdoc = HTML_SRC;

          setTimeout(async () => {
            let text = "";
            let customVar = "";
            const uiChecks = {};
            try {
              const doc = fMain.contentDocument;
              text = doc?.body?.innerText || "";
              customVar = doc?.documentElement?.style?.getPropertyValue("--antigravity-custom") || "";

              // Interactive check 1 (Left card Oracle): open dropdown, hover Codex -> flyout MUST open on RIGHT inside viewport
              const winH = fMain.contentWindow.innerHeight;
              const oracleTrig = doc.querySelector('[data-action="toggle-role-dd"][data-role="oracle"]');
              oracleTrig?.click();
              const oracleMenu = doc.querySelector(".dropdown-menu.harness-menu");
              const codexHoverO = doc.querySelector('[data-harness-hover="codex"]');
              codexHoverO?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              const codexGroupO = doc.querySelector('.harness-group[data-harness-group="codex"]');
              const subO = codexGroupO?.querySelector(".harness-sublist");
              const omr = oracleMenu?.getBoundingClientRect();
              const osr = subO?.getBoundingClientRect();
              uiChecks.codexExpanded = Boolean(codexGroupO?.classList.contains("expanded"));
              uiChecks.codexSubCount = subO?.querySelectorAll(".dropdown-item")?.length || 0;
              uiChecks.codexHasCustomBtn = Boolean(codexGroupO?.querySelector('[data-action="open-add-modal"]'));
              uiChecks.oracleFlyoutRight = Boolean(
                subO?.classList.contains("flyout") && omr && osr && osr.left >= omr.right - 2 && osr.bottom <= winH + 1
              );

              // Interactive check 2 (Right card Hephaestus): open dropdown, hover Codex -> flyout MUST auto-flip LEFT
              const hephTrig = doc.querySelector('[data-action="toggle-role-dd"][data-role="hephaestus"]');
              hephTrig?.click();
              const hephMenu = doc.querySelector(".dropdown-menu.harness-menu");
              const codexHoverH = doc.querySelector('[data-harness-hover="codex"]');
              codexHoverH?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              const subH = doc.querySelector('.harness-group[data-harness-group="codex"] .harness-sublist');
              const hmr = hephMenu?.getBoundingClientRect();
              const hsr = subH?.getBoundingClientRect();
              uiChecks.hephFlyoutLeft = Boolean(
                subH?.classList.contains("flyout") && hmr && hsr && hsr.right <= hmr.left + 2 && hsr.bottom <= winH + 1
              );

              const dshHover = doc.querySelector('[data-harness-hover="deepseek-harness"]');
              dshHover?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
              const dshFlyout = doc.querySelector('[data-harness-group="deepseek-harness"] .harness-sublist');
              const groupNames = (menu) => Array.from(menu?.querySelectorAll(".channel-group-title") || [], (el) => el.textContent);
              uiChecks.flyoutGroups = groupNames(dshFlyout);
              uiChecks.dshFixedFlyout = dshFlyout && fMain.contentWindow.getComputedStyle(dshFlyout).position === "fixed";
              uiChecks.dshAddChannel = Boolean(dshFlyout?.querySelector('[data-action="open-add-modal"]'));

              doc.querySelector('[data-action="set-tab"][data-tab="settings"]')?.click();
              uiChecks.hasNativeSelect = Boolean(doc.querySelector("#s-inspector-model"));
              doc.querySelector('[data-action="toggle-inspector-dd"]')?.click();
              uiChecks.inspectorItems = doc.querySelectorAll('[data-action="pick-inspector-model"]').length;
              uiChecks.inspectorGroups = groupNames(doc.querySelector(".dropdown-menu.fixed-pop"));
              uiChecks.inspectorTrigger = doc.querySelector('[data-action="toggle-inspector-dd"] .dropdown-name')?.textContent;
              doc.querySelector('[data-action="open-add-modal"][data-for-inspector="1"]')?.click();
              uiChecks.inspectorCheckbox = doc.querySelector("#m-set-inspector")?.checked;
              doc.querySelector('[data-action="close-modal"]')?.click();

              // Interactive check 4: Back to Team, click unready Claude harness -> jumps to Models tab
              doc.querySelector('[data-action="set-tab"][data-tab="team"]')?.click();
              doc.querySelector('[data-action="toggle-role-dd"][data-role="oracle"]')?.click();
              const claudeBtn = doc.querySelector('[data-action="goto-engine-setup"][data-engine="claude-code"]');
              if (claudeBtn) {
                claudeBtn.click();
                uiChecks.jumpedToModels = Boolean(doc.querySelector("#engine-card-deepseek-harness"));
              } else {
                doc.querySelector('[data-action="set-tab"][data-tab="models"]')?.click();
                uiChecks.jumpedToModels = Boolean(doc.querySelector("#engine-card-deepseek-harness"));
              }

              const channelCard = '[data-channel-card]:has([data-action="open-manage-channel"])';
              const toggle = () => doc.querySelector(channelCard + ' [data-action="toggle-channel"]');
              uiChecks.channelCards = doc.querySelectorAll(".channel-card").length;
              uiChecks.channelInitiallyCollapsed = toggle()?.getAttribute("aria-expanded") === "false";
              toggle()?.click();
              uiChecks.channelExpanded = toggle()?.getAttribute("aria-expanded") === "true";
              uiChecks.channelChips = doc.querySelectorAll(channelCard + ' [data-action="remove-channel-model"]').length;
              toggle()?.click();
              uiChecks.channelCollapsed = !doc.querySelector(channelCard + " .channel-models");
              uiChecks.dshReadOnly = Boolean(doc.querySelector(".channel-readonly"));

              doc.querySelector(channelCard + ' [data-action="open-manage-channel"]')?.click();
              const checked = () => Array.from(doc.querySelectorAll('[data-action="toggle-fetched-model"][aria-checked="true"]'), (el) => el.dataset.modelId);
              uiChecks.managePrechecked = checked();
              uiChecks.manageSavedKey = doc.querySelector("#m-api-key")?.value === "";
              doc.querySelector('[data-action="modal-fetch-models"]')?.click();
              const started = Date.now();
              while (!doc.querySelector('[data-model-id="upstream-only"]') && Date.now() - started < 2000) {
                await new Promise((resolve) => setTimeout(resolve, 25));
              }
              uiChecks.fetchMerged = ["model-alpha", "model-beta", "upstream-only"].every((id) => doc.querySelector('[data-model-id="' + id + '"]'));
              uiChecks.fetchPrechecked = checked();
              const manual = doc.querySelector("#m-manual-model");
              manual.value = "manual-only";
              manual.dispatchEvent(new Event("input", { bubbles: true }));
              doc.querySelector('[data-action="add-manual-model"]')?.click();
              uiChecks.manualChecked = checked().includes("manual-only");
              uiChecks.modalHasDisplayName = Boolean(doc.querySelector("#m-display-name"));
              doc.querySelector('[data-action="close-modal"]')?.click();
              doc.querySelector('[data-action="open-add-modal"]')?.click();
              uiChecks.modalHasFetch = Boolean(doc.querySelector('[data-action="modal-fetch-models"]'));
              uiChecks.modalHasCliMode = Boolean(doc.querySelector('[data-action="modal-mode"]'));

              doc.querySelector('[data-action="close-modal"]')?.click();
              doc.querySelector('[data-tab="team"]')?.click();
              const preview = doc.querySelector(".live-feed");
              uiChecks.previewRows = preview?.querySelectorAll(".ar-step").length || 0;
              uiChecks.previewNoDup = (preview?.textContent.match(/go test/g) || []).length === 1;
              doc.querySelector(".live-job")?.click();
              const until = async (selector) => {
                const deadline = Date.now() + 3500;
                while (!doc.querySelector(selector) && Date.now() < deadline) {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
                return doc.querySelector(selector);
              };
              const prompt = await until(".job-prompt button");
              uiChecks.promptCollapsed = prompt?.getAttribute("aria-expanded") === "false";
              uiChecks.working = doc.querySelector(".job-detail-foot")?.innerText.includes("Working");
              uiChecks.stopVisible = Boolean(doc.querySelector(".job-detail-head [data-action=stop-job]"));
              uiChecks.noRawPath = !doc.querySelector(".job-detail-head")?.innerText.includes("gateway-job.log");
              uiChecks.copyIcon = Boolean(doc.querySelector('[data-action="copy-job-log"] svg'));
              uiChecks.commandSingle = (doc.querySelector(".ar-step-cmd")?.innerText.match(/go test/g) || []).length === 1;
              uiChecks.cleanCommand = !doc.querySelector(".ar-step-cmd")?.innerText.includes("pwsh:")
                && doc.querySelector(".ar-step-cmd .ar-failed")?.innerText.includes("Exited with code 1");
              uiChecks.readRange = doc.querySelector(".ar-step-read .ar-meta")?.innerText === "#L315-455";
              uiChecks.editCounts = doc.querySelector(".ar-added")?.innerText === "+13" && doc.querySelector(".ar-removed")?.innerText === "-4";
              prompt?.click();
              doc.querySelector('[data-step-id="thought"]')?.click();
              doc.querySelector('[data-step-id="cmd"]')?.click();
              const final = await until(".job-final");
              uiChecks.expandedAfterPoll = ["__lead_prompt", "thought", "cmd"].every(
                (step) => doc.querySelector('[data-step-id="' + step + '"]')?.getAttribute("aria-expanded") === "true"
              );
              uiChecks.thought = doc.querySelector(".ar-step-thought .ar-indent p")?.textContent === "Check the gateway first.";
              uiChecks.commandOutput = doc.querySelector(".ar-terminal")?.textContent.includes("FAIL <optional>");
              uiChecks.finalMarkdown = Boolean(final?.querySelector("h4") && final.querySelector("strong")
                && final.querySelector("ul code") && final.querySelector("pre code") && final.querySelector("footer"));
              uiChecks.finalEscaped = final?.textContent.includes("<img src=x onerror=alert(1)>") && !final.querySelector("img");
              uiChecks.finalSingle = (doc.querySelector(".job-conversation")?.textContent.match(/Gateway verified/g) || []).length === 1;
              uiChecks.worktreeNotice = final?.textContent.includes("[Git Worktree]");

              doc.querySelector('[data-tab="settings"]')?.click();
              const worktreeSelector = '[data-key="allowWorktreeParallelWrite"]';
              const worktreeToggle = doc.querySelector(worktreeSelector);
              uiChecks.worktreeOff = worktreeToggle?.getAttribute("aria-checked") === "false";
              worktreeToggle?.click();
              uiChecks.worktreeOn = Boolean(await until(worktreeSelector + '[aria-checked="true"]'));
            } catch (err) {
              errors.push("inspect:" + String(err));
            }
            fetch("/report", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ events, errors, text, customVar, uiChecks }),
            });
          }, 1500);
        </script>
      </body></html>`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:;",
    });
    res.end(htmlText);
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ar-e2e-edge-"));
  const proc = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      ...(process.env.AGENT_RELAY_E2E_NO_BROWSER_SANDBOX === "1" ? ["--no-sandbox", "--disable-software-rasterizer"] : []),
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${prof}`,
      `http://127.0.0.1:${port}/host`,
    ],
    { stdio: "ignore" }
  );

  let timeout;
  try {
    const failure = new Promise((_, reject) => {
      proc.once("error", reject);
      proc.once("exit", (code) => reject(new Error(`Headless browser exited before reporting (code ${code})`)));
      timeout = setTimeout(() => reject(new Error("Browser strict CSP test timed out after 25s")), 25_000);
    });
    const report = await Promise.race([reportPromise, failure]);
    assert.deepEqual(report.errors || [], [], `Unexpected browser errors: ${JSON.stringify(report.errors)}`);
    assert.ok(
      report.events.some((e) => e.who === "main" && e.method === "ui/initialize"),
      "main iframe missing ui/initialize"
    );
    assert.ok(
      report.events.some((e) => e.who === "main" && e.method === "ui/notifications/initialized"),
      "main iframe missing ui/notifications/initialized (handshake validation likely failed)"
    );
    assert.ok(
      report.events.some((e) => e.who === "opaque" && e.method === "ui/notifications/initialized"),
      "opaque srcdoc iframe missing ui/notifications/initialized"
    );
    assert.equal(report.customVar, "#123456", "Expected raw custom CSS var to still be applied");
    assert.ok(report.text.includes("A.stand"), `Rendered UI missing 'A.stand': ${report.text}`);
    assert.equal(report.uiChecks?.worktreeNotice, true, "Expected retained worktree notice in job result");
    assert.equal(report.uiChecks?.worktreeOff, true, "Expected the Settings worktree switch to start off");
    assert.equal(report.uiChecks?.worktreeOn, true, "Expected the Settings worktree switch to turn on when clicked");
    assert.ok(report.text.includes("Oracle"), `Rendered UI missing 'Oracle': ${report.text}`);
    assert.ok(report.text.includes("Hephaestus"), `Rendered UI missing 'Hephaestus': ${report.text}`);
    assert.equal(report.uiChecks?.codexExpanded, true, "Expected Codex hover to expand sub-models");
    assert.ok(report.uiChecks?.codexSubCount >= 1, "Expected >= 1 sub-model under Codex");
    assert.equal(report.uiChecks?.codexHasCustomBtn, false, "Codex menu must not contain Configure custom model");
    assert.equal(report.uiChecks?.oracleFlyoutRight, true, "Oracle Codex flyout should open to the RIGHT within viewport");
    assert.equal(report.uiChecks?.hephFlyoutLeft, true, "Hephaestus Codex flyout should auto-flip LEFT within viewport");
    assert.equal(report.uiChecks?.hasNativeSelect, false, "Native <select> should be replaced by dark custom dropdown");
    assert.equal(report.uiChecks?.inspectorItems, 4);
    assert.deepEqual(report.uiChecks?.inspectorGroups, ["fixture-relay", "legacy.example"]);
    assert.equal(report.uiChecks?.inspectorTrigger, "model-alpha · legacy.example");
    assert.equal(report.uiChecks?.inspectorCheckbox, true);
    assert.deepEqual(report.uiChecks?.flyoutGroups, report.uiChecks.inspectorGroups);
    assert.equal(report.uiChecks?.dshFixedFlyout, true);
    assert.equal(report.uiChecks?.dshAddChannel, true);
    assert.equal(report.uiChecks?.channelCards, 2);
    assert.equal(report.uiChecks?.channelInitiallyCollapsed, true);
    assert.equal(report.uiChecks?.channelExpanded, true);
    assert.equal(report.uiChecks?.channelChips, 2);
    assert.equal(report.uiChecks?.channelCollapsed, true);
    assert.equal(report.uiChecks?.dshReadOnly, true);
    assert.deepEqual(report.uiChecks?.managePrechecked, ["model-alpha", "model-beta"]);
    assert.equal(report.uiChecks?.manageSavedKey, true);
    assert.equal(report.uiChecks?.fetchMerged, true);
    assert.deepEqual(report.uiChecks?.fetchPrechecked, report.uiChecks.managePrechecked);
    assert.equal(report.uiChecks?.manualChecked, true);
    assert.equal(report.uiChecks?.modalHasDisplayName, false);
    assert.equal(report.uiChecks?.jumpedToModels, true, "Expected 4 harnesses in Models tab");
    assert.equal(report.uiChecks?.modalHasFetch, true, "Expected Fetch Models button in pure API modal");
    assert.equal(report.uiChecks?.modalHasCliMode, false, "CLI subscription toggle must be removed from modal");
    assert.equal(report.uiChecks.previewRows, 4);
    for (const key of [
      "previewNoDup", "promptCollapsed", "working", "stopVisible", "noRawPath", "copyIcon", "commandSingle",
      "cleanCommand", "readRange", "editCounts", "expandedAfterPoll", "thought", "commandOutput", "finalMarkdown",
      "finalEscaped", "finalSingle",
    ]) assert.equal(report.uiChecks[key], true, `Browser timeline check failed: ${key}`);
    console.log("Browser strict CSP and job conversation checks PASSED (0 errors).");
  } finally {
    clearTimeout(timeout);
    try {
      proc.kill();
    } catch {}
    server.close();
    await new Promise((r) => setTimeout(r, 300));
    try {
      fs.rmSync(prof, { recursive: true, force: true });
    } catch {}
  }
}

async function askWithPoll(client, args) {
  let res = await client.callTool(
    { name: "agent_relay_ask", arguments: args },
    undefined,
    LONG_CALL_OPTS
  );
  let text = res.content[0].text;
  let polls = 0;
  while (text.includes("STILL RUNNING") && polls < 4) {
    const m = text.match(/jobId="([^"]+)"/);
    if (!m) break;
    console.log(`  [auto-poll #${++polls}] ${text.split("\n")[0]}`);
    res = await client.callTool(
      { name: "agent_relay_poll", arguments: { jobId: m[1] } },
      undefined,
      LONG_CALL_OPTS
    );
    text = res.content[0].text;
  }
  return text;
}

async function runCodexFixture() {
  if (process.argv.includes("--version")) {
    console.log("codex-cli 0.1.0");
    return;
  }
  const threadPath = path.join(process.env.CODEX_HOME, "fixture-thread.json");
  const send = (message) => console.log(JSON.stringify(message));
  const model = "fixture-codex";
  const waitingTurns = new Map();
  const loadThreads = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(threadPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
    return {};
  };
  const saveThreads = (threads) => fs.writeFileSync(threadPath, JSON.stringify(threads));
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const { id, method, params } = JSON.parse(line);
    if (id === undefined) continue;
    const reply = (result) => send({ id, result });
    switch (method) {
      case "initialize":
        reply({ userAgent: "codex/0.1.0" });
        break;
      case "model/list":
        reply({ data: [{ model, isDefault: true }, { model: "fixture-codex-fast" }] });
        break;
      case "account/rateLimits/read":
        reply({ rateLimits: { planType: "test", primary: { usedPercent: 12, windowDurationMins: 300 } } });
        break;
      case "thread/start": {
        const brief = fs.readFileSync(path.join(params.cwd, "brief.md"), "utf8");
        const threads = loadThreads();
        const threadId = `fixture-thread-${crypto.randomUUID().slice(0, 8)}`;
        const thread = { id: threadId, codeword: brief.match(/Codeword: (\S+)/)[1], turns: 0 };
        threads[threadId] = thread;
        saveThreads(threads);
        reply({ thread: { id: thread.id }, model });
        break;
      }
      case "thread/resume":
      case "turn/start": {
        const threads = loadThreads();
        const thread = threads[params.threadId];
        assert.ok(thread, `Unknown fixture threadId: ${params.threadId}`);
        if (method === "thread/resume") {
          reply({ thread: { id: thread.id }, model });
          break;
        }
        const turn = { id: `fixture-turn-${++thread.turns}`, status: "completed" };
        saveThreads(threads);
        reply({ turn });
        const notify = (m, fields) => send({ method: m, params: { threadId: thread.id, ...fields } });
        const reasoning = { id: "reason-1", type: "reasoning", summary: [], content: [] };
        notify("item/started", { item: reasoning });
        notify("item/reasoning/textDelta", { itemId: reasoning.id, delta: "raw reason" });
        notify("item/reasoning/summaryTextDelta", { itemId: reasoning.id, summaryIndex: 0, delta: "Check " });
        notify("item/reasoning/summaryTextDelta", { itemId: reasoning.id, summaryIndex: 0, delta: "the brief." });
        notify("item/completed", { item: reasoning });
        const prompt = params.input?.[0]?.text;
        if (prompt === "Fixture interrupt") {
          waitingTurns.set(thread.id, turn.id);
          break;
        }
        if (prompt === "Fixture failure") {
          notify("turn/completed", { turn: { ...turn, status: "failed", error: "fixture failure" } });
          break;
        }
        const command = { id: "cmd-1", type: "commandExecution", command: "pwsh: npm run check" };
        notify("item/started", { item: command });
        notify("item/commandExecution/outputDelta", { itemId: command.id, delta: "fixture stdout" });
        notify("item/completed", { item: { ...command, status: "failed", exitCode: 1 } });
        const file = { id: "edit-1", type: "fileChange", changes: [{ path: "C:\\fixture\\brief.md", diff: "--- a/brief.md\n+++ b/brief.md\n@@ -1 +1,2 @@\n-old\n+new\n+second" }] };
        notify("item/started", { item: file });
        notify("item/completed", { item: { ...file, status: "completed" } });
        const message = { id: "message-1", type: "agentMessage", text: "" };
        notify("item/started", { item: message });
        notify("item/agentMessage/delta", { itemId: message.id, delta: thread.codeword });
        notify("item/completed", { item: { ...message, text: thread.codeword } });
        notify("thread/tokenUsage/updated", {
          tokenUsage: { last: { inputTokens: 100, cachedInputTokens: thread.turns > 1 ? 90 : 0, outputTokens: 5 } },
        });
        notify("turn/completed", { turn });
        break;
      }
      case "review/start": {
        const threads = loadThreads();
        const thread = threads[params.threadId];
        assert.ok(thread, `Unknown fixture threadId: ${params.threadId}`);
        const turnId = `fixture-review-${++thread.turns}`;
        saveThreads(threads);
        reply({ turn: { id: turnId, status: "completed" } });
        const notify = (m, fields) => send({ method: m, params: { threadId: thread.id, ...fields } });
        notify("item/completed", { item: { type: "exitedReviewMode", review: `Review OK (${thread.codeword})` } });
        notify("thread/tokenUsage/updated", {
          tokenUsage: { last: { inputTokens: 100, cachedInputTokens: 90, outputTokens: 12 } },
        });
        notify("turn/completed", { turn: { id: turnId, status: "completed" } });
        break;
      }
      case "turn/steer":
        reply({ ok: true });
        break;
      case "turn/interrupt": {
        const { threadId, turnId } = params;
        assert.equal(turnId, waitingTurns.get(threadId));
        waitingTurns.delete(threadId);
        reply({});
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted" } } });
        break;
      }
      case "thread/delete": {
        const threads = loadThreads();
        if (params?.threadId) {
          delete threads[params.threadId];
          saveThreads(threads);
        } else {
          fs.rmSync(threadPath, { force: true });
        }
        reply({});
        break;
      }
      default:
        send({ id, error: { message: `Unexpected Codex fixture request: ${method}` } });
    }
  }
}

function prepareEngineFixtures(tmpData) {
  const dshHome = path.join(tmpData, "dsh-fixture");
  fs.mkdirSync(dshHome);
  const dshConfig = JSON.stringify({
    providers: {
      "fixture-relay": { baseUrl: "https://dsh.example/v1", apiKey: "sk-dsh-fixture-3333", models: ["dsh-alpha", "dsh-beta"] },
    },
  });
  const dshConfigPath = path.join(dshHome, "settings.json");
  fs.writeFileSync(dshConfigPath, dshConfig);
  const liveHome = process.env.AGENT_RELAY_E2E_CODEX_HOME;
  if (liveHome) {
    assert.notEqual(path.resolve(liveHome).toLowerCase(), path.join(os.homedir(), ".codex").toLowerCase(),
      "Use an isolated Codex home for live E2E");
    return { engineEnv: { DSH_HOME: dshHome, CODEX_HOME: liveHome }, dshConfigPath, dshConfig };
  }

  const codexHome = path.join(tmpData, "codex-fixture");
  fs.mkdirSync(codexHome);
  fs.writeFileSync(path.join(codexHome, "auth.json"), JSON.stringify({ fixture: "test-only auth marker" }));
  const windows = process.platform === "win32";
  const launcher = path.join(codexHome, windows ? "codex.cmd" : "codex");
  const command = `"${process.execPath}" "${fileURLToPath(import.meta.url)}" --codex-fixture`;
  fs.writeFileSync(launcher, windows ? `@echo off\r\n${command} %*\r\n` : `#!/bin/sh\nexec ${command} "$@"\n`, { mode: 0o755 });
  const engineEnv = {
    DSH_HOME: dshHome,
    CODEX_HOME: codexHome,
    APPDATA: tmpData,
    PATH: [codexHome, ...(windows ? [path.join(process.env.SystemRoot || "C:\\Windows", "System32")] : ["/usr/bin", "/bin"])].join(path.delimiter),
  };
  return { engineEnv, dshConfigPath, dshConfig };
}

async function testAcpActivity() {
  const engine = new AcpEngine();
  const listeners = new Map();
  const sessionId = "fixture-acp";
  const profile = `default::custom::::::${crypto.createHash("sha256").update("").digest("hex").slice(0, 16)}::read-only`;
  engine.clients.set(profile, {
    proc: { killed: false, exitCode: 0 },
    initialized: true,
    loadedSessions: new Set([sessionId]),
    sessionRoles: new Map(),
    listeners,
    async request(method) {
      assert.equal(method, "session/prompt");
      const emit = (sessionUpdate, fields) => listeners.get(sessionId)({
        method: "session/update", params: { update: { sessionUpdate, ...fields } },
      });
      const chunk = (messageId, text) => emit("agent_message_chunk", { messageId, content: { text } });
      chunk("intro", "I’ll check the gateway.");
      emit("tool_call", { title: "pwsh", toolCallId: "cmd", rawInput: { command: "npm run check" } });
      emit("tool_call_update", { toolCallId: "cmd", status: "in_progress",
        content: [{ type: "content", content: { type: "text", text: "fixture stdout" } }] });
      emit("tool_call_update", { toolCallId: "cmd", status: "completed",
        content: [{ type: "content", content: { type: "text", text: "fixture stdout\nfixture stderr\n[exit code: 1]" } }] });
      chunk("final", "The check finished.\n\n");
      chunk("final", "One assertion failed.");
      return { usage: { inputTokens: 25, cachedInputTokens: 0, outputTokens: 12 } };
    },
  });
  const events = [];
  const result = await engine.runTurn({ cwd: ROOT, role: "oracle", prompt: "Check gateway", existingSessionId: sessionId,
    onActivity: (ev) => events.push(ev) });
  const final = events.filter((event) => event.kind === "output").at(-1);
  assert.equal(final.title, "One assertion failed.");
  assert.equal(final.detail, "The check finished.\n\nOne assertion failed.");
  assert.equal(final.status, "done");
  assert.equal(result.text, final.detail);
  assert.equal(new Set(events.filter((ev) => ev.kind === "output").map((ev) => ev.id)).size, 2);
  const cmd = events.findLast((ev) => ev.id === "cmd");
  assert.equal(cmd.exitCode, 1);
  assert.equal(cmd.status, "error");
  assert.equal(cmd.detail, "$ npm run check\n\nfixture stdout\nfixture stderr");
  console.log("ACP streamed prose and command exit status PASSED.");
}

function seedLegacyLibrary(dataDir) {
  const key = "sk-legacy-shared-1234";
  const otherKey = "sk-legacy-separate-5678";
  const entry = (id, modelName, baseUrl, providerId = "custom") => ({
    id, modelName, name: "Old display name", mode: "api", providerId, baseUrl, builtin: false,
  });
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify({
    version: 2,
    inspectorModelId: "custom-legacy-a",
    roles: { oracle: { modelId: "custom-legacy-a", queue: ["custom-legacy-a", "custom-legacy-b"] } },
    models: [
      entry("custom-legacy-a", "model-alpha", " https://LEGACY.EXAMPLE/v1/ ", " Custom "),
      { ...entry("custom-legacy-b", "model-beta", "https://legacy.example/v1"), apiKey: key },
      entry("custom-legacy-other", "model-alpha", "https://legacy.example/v1"),
    ],
  }));
  fs.writeFileSync(path.join(dataDir, "secrets.json"), JSON.stringify({
    apiKeys: { "custom-legacy-a": key, "custom-legacy-other": otherKey },
  }));
  return { key, otherKey };
}

// ---------------------------------------------------------------------------
// X-Ray / Doorbell / Crash-recovery helpers
// ---------------------------------------------------------------------------

function writeStatusFile(dataDir, snap) {
  const dir = path.join(dataDir, "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${snap.jobId}.status.json`), JSON.stringify(snap, null, 2), "utf8");
}

function readStatusFile(dataDir, jobId) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, "jobs", `${jobId}.status.json`), "utf8"));
}

// Run the doorbell with a hard wall-clock guard so a logic bug can never hang the suite.
function runWaitJob(dataDir, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [WAIT_JOB_BUNDLE, "--data-dir", dataDir, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const killer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);
    // On Windows a killed child settles without a signal, so a timeout is reported explicitly.
    child.on("exit", (code) => {
      clearTimeout(killer);
      resolve({ code, out, timedOut: Date.now() - started >= timeoutMs });
    });
  });
}

function testSummarizeToolInput() {
  const cases = [
    // Shell tools -> `${title}: ${command}`
    [summarizeToolInput("pwsh", { command: "npm run test:e2e" }), /^pwsh: npm run test:e2e$/],
    [summarizeToolInput("bash", { cmd: "ls -la" }), /^bash: ls -la$/],
    [summarizeToolInput("run_command", { script: "go test ./..." }), /^run_command: go test \.\/\.\.\.$/],
    // File tools -> `${title} ${shortPath} L{start}-{end}`
    [
      summarizeToolInput("read", {
        path: "C:\\Users\\me\\Desktop\\proj\\src\\core\\store.mjs",
        start_line: 10,
        end_line: 20,
      }),
      /^read …\/core\/store\.mjs L10-20$/,
    ],
    [summarizeToolInput("edit", { file_path: "/home/u/app/src/ui/app.js" }), /^edit …\/ui\/app\.js$/],
    [summarizeToolInput("write", { target_file: "README.md" }), /^write README\.md$/],
    // Search tools -> `${title} "${pattern}" in ${shortPath}`
    [summarizeToolInput("grep", { pattern: "fooBar", path: "src/core/store.mjs" }), /^grep "fooBar" in …\/core\/store\.mjs$/],
    [summarizeToolInput("glob", { pattern: "**/*.mjs" }), /^glob "\*\*\/\*\.mjs"$/],
    // Generic fallbacks
    [summarizeToolInput("mystery", { alpha: "hello world" }), /^mystery hello world$/],
    [summarizeToolInput("mystery", { n: 1, flag: true }), /^mystery \{"n":1,"flag":true\}$/],
    [summarizeToolInput("tool", null), /^tool$/],
  ];
  for (const [actual, expected] of cases) {
    assert.match(actual, expected, `summarizeToolInput mismatch: got "${actual}"`);
    assert.ok(actual.length <= 110, `summarizeToolInput must stay <=110 chars, got ${actual.length}: ${actual}`);
    assert.ok(!/[\r\n]/.test(actual), "summarizeToolInput must stay single-line");
  }
  const long = summarizeToolInput("pwsh", { command: `echo ${"x".repeat(400)}` });
  assert.ok(long.length <= 110, `Long command must be capped, got ${long.length}`);
  assert.ok(long.endsWith("…"), "Long command should be ellipsized");
  console.log("summarizeToolInput (shell / file+range / search / generic) PASSED.");
}

async function testWaitJobScript() {
  assert.ok(fs.existsSync(WAIT_JOB_BUNDLE), "dist/wait-job.mjs missing — run node scripts/build.mjs / npm run install:antigravity");
  assert.equal(
    fs.readFileSync(WAIT_JOB_BUNDLE, "utf8"),
    fs.readFileSync(WAIT_JOB_SRC, "utf8"),
    "dist/wait-job.mjs must be an exact copy of scripts/wait-job.mjs"
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-e2e-doorbell-"));
  const now = Date.now();
  try {
    writeStatusFile(dir, {
      jobId: "job_doorbell_ok",
      role: "oracle",
      slot: "default",
      title: "Doorbell completed",
      status: "completed",
      pid: process.pid,
      startedAt: now - 42_000,
      updatedAt: now,
      lastActivityAt: now,
      lastSummary: "all good",
      finishedAt: now,
      elapsedSec: 42.3,
      error: null,
      sessionId: "sid-doorbell-1",
      logPath: path.join(dir, "jobs", "job_doorbell_ok.log"),
      outputPath: path.join(dir, "outputs", "job_doorbell_ok.txt"),
    });
    const ok = await runWaitJob(dir, ["job_doorbell_ok"], { timeoutMs: 10_000 });
    assert.equal(ok.code, 0, `wait-job must exit 0 on completion, got ${ok.code}: ${ok.out}`);
    const okLines = ok.out.trim().split("\n");
    assert.equal(okLines.length, 3, `Expected a concise 3-line summary, got:\n${ok.out}`);
    assert.match(okLines[0], /^\[COMPLETED\] job_doorbell_ok \(oracle · Doorbell completed\) · 42s/);
    assert.match(okLines[1], /sessionId=sid-doorbell-1 · last=all good/);
    assert.match(okLines[2], /output=.*job_doorbell_ok\.txt/);

    writeStatusFile(dir, {
      jobId: "job_doorbell_stall",
      role: "hephaestus",
      slot: "default",
      title: "Doorbell stalled",
      status: "running",
      pid: process.pid,
      startedAt: now - 600_000,
      updatedAt: now - 300_000,
      lastActivityAt: now - 300_000,
      lastSummary: "running tests",
      sessionId: "sid-doorbell-2",
      logPath: path.join(dir, "jobs", "job_doorbell_stall.log"),
      outputPath: path.join(dir, "outputs", "job_doorbell_stall.txt"),
    });
    const stall = await runWaitJob(dir, ["--stall-sec", "180", "job_doorbell_stall"], { timeoutMs: 15_000 });
    assert.equal(stall.code, 2, `wait-job must exit 2 on stall, got ${stall.code}: ${stall.out}`);
    assert.match(stall.out, /\[STALL_ALERT\] job_doorbell_stall silent for \d+s/);
    assert.match(stall.out, /last=running tests/);
    assert.match(stall.out, /job_doorbell_stall\.log/);

    writeStatusFile(dir, {
      jobId: "job_doorbell_dead",
      role: "oracle",
      slot: "default",
      title: "Doorbell dead host",
      status: "running",
      pid: 0x7ffffffe,
      startedAt: now - 10_000,
      updatedAt: now,
      lastActivityAt: now,
      lastSummary: "half way",
      sessionId: "sid-doorbell-3",
      logPath: path.join(dir, "jobs", "job_doorbell_dead.log"),
    });
    const dead = await runWaitJob(dir, ["job_doorbell_dead"], { timeoutMs: 10_000 });
    assert.equal(dead.code, 3, `wait-job must exit 3 when the MCP pid is gone, got ${dead.code}: ${dead.out}`);
    assert.match(dead.out, /\[INTERRUPTED\] job_doorbell_dead MCP process \d+ exited/);

    writeStatusFile(dir, {
      jobId: "job_doorbell_fail",
      role: "oracle",
      slot: "default",
      title: "Doorbell failed",
      status: "failed",
      pid: process.pid,
      startedAt: now - 5_000,
      updatedAt: now,
      lastActivityAt: now,
      lastSummary: "boom",
      finishedAt: now,
      elapsedSec: 5,
      error: "engine crashed",
      sessionId: "sid-doorbell-4",
      logPath: path.join(dir, "jobs", "job_doorbell_fail.log"),
    });
    const failed = await runWaitJob(dir, ["job_doorbell_fail"], { timeoutMs: 10_000 });
    assert.equal(failed.code, 1, `wait-job must exit 1 on error, got ${failed.code}: ${failed.out}`);
    assert.match(failed.out, /\[ERROR\] job_doorbell_fail/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log("wait-job.mjs doorbell (exit 0 completed / 2 stall / 3 dead pid / 1 error) PASSED.");
}

async function main() {
  testWorktrees();
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "ar-e2e-data-"));
  const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), "ar-e2e-work-"));
  fs.writeFileSync(
    path.join(tmpWork, "brief.md"),
    "# A.stand Test Brief\n\nCodeword: RELAY-9041\nRole count: 2 (oracle read-only, hephaestus write).\nZero mutation policy: never modify ~/.codex/config.toml.\n",
    "utf8"
  );

  console.log("=== 1. Verifying console.html syntax & MCP stdio handshake ===");
  const diskHtml = fs.readFileSync(HTML_BUNDLE, "utf8");
  verifyHtmlSyntax(diskHtml);
  console.log(`console.html syntax check PASSED (${(Buffer.byteLength(diskHtml) / 1024).toFixed(1)} KB).`);

  const { engineEnv, dshConfigPath, dshConfig } = prepareEngineFixtures(tmpData);
  let { client } = await connectClient(tmpData, engineEnv);
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${result.content[0]?.text}`);
    return result.structuredContent;
  };

  const toolsRes = await client.listTools();
  const toolNames = toolsRes.tools.map((t) => t.name);
  console.log("Tools registered:", toolNames.join(", "));
  for (const reqTool of [
    "agent_relay_ask",
    "agent_relay_poll",
    "agent_relay_review",
    "agent_relay_session",
    "agent_relay_console",
    "agent_relay_ui_upsert_channel",
    "agent_relay_ui_delete_channel",
    "agent_relay_ui_remove_channel_model",
  ]) {
    assert.ok(toolNames.includes(reqTool), `Missing required tool ${reqTool}`);
  }
  const consoleTool = toolsRes.tools.find((t) => t.name === "agent_relay_console");
  assert.equal(consoleTool._meta?.ui?.resourceUri, "ui://agent-relay/console.html");
  assert.ok(Array.isArray(consoleTool._meta?.["com.google.antigravity/ui"]?.entrypoints));
  const appOnly = toolsRes.tools.find((t) => t.name === "agent_relay_ui_update_settings");
  assert.deepEqual(appOnly._meta?.ui?.visibility, ["app"]);

  const resList = await client.listResources();
  assert.ok(resList.resources.some((r) => r.uri === "ui://agent-relay/console.html"));
  const uiDoc = await client.readResource({ uri: "ui://agent-relay/console.html" });
  assert.equal(uiDoc.contents[0].mimeType, "text/html;profile=mcp-app");
  verifyHtmlSyntax(uiDoc.contents[0].text);
  console.log("MCP Resource UI HTML verified OK.");

  console.log("\n=== 2. Testing Master Hard Switch (default OFF -> must block) ===");
  const blockedRes = await client.callTool({
    name: "agent_relay_ask",
    arguments: { role: "oracle", cwd: tmpWork, prompt: "hello" },
  });
  const blockedText = blockedRes.content[0].text;
  assert.ok(blockedText.includes("master switch is OFF"), `Expected hard block, got: ${blockedText}`);
  console.log("Hard switch block OK.");

  console.log("\n=== 3. Testing legacy migration, channel CRUD and secret isolation ===");
  await client.close();
  const legacy = seedLegacyLibrary(tmpData);
  const settingsPath = path.join(tmpData, "settings.json");
  const secretsPath = path.join(tmpData, "secrets.json");
  const legacySettings = fs.readFileSync(settingsPath, "utf8");
  const legacySecrets = fs.readFileSync(secretsPath, "utf8");
  fs.writeFileSync(secretsPath, "{");
  assert.throws(() => new RelayStore(tmpData), /Cannot read secrets\.json/);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), legacySettings);
  assert.equal(fs.readFileSync(secretsPath, "utf8"), "{");
  fs.writeFileSync(secretsPath, legacySecrets);
  ({ client } = await connectClient(tmpData, engineEnv));
  const readJson = (filename) => JSON.parse(fs.readFileSync(path.join(tmpData, filename), "utf8"));
  const checkSecretIsolation = (state, key) => {
    assert.ok(!JSON.stringify(state).includes(key), "API key leaked into dashboard payload");
    assert.ok(!fs.readFileSync(path.join(tmpData, "settings.json"), "utf8").includes(key), "API key leaked into settings.json");
  };
  const migrated = await call("agent_relay_ui_get_state");
  assert.deepEqual(migrated.channels, migrated.settings.channels);
  assert.equal(migrated.channels.length, 2, "Normalize the address and group only models with the same key");
  const [shared, separate] = migrated.channels;
  assert.equal(shared.name, "legacy.example");
  assert.equal(shared.baseUrl, "https://legacy.example/v1");
  assert.deepEqual(shared.models, [
    { id: "custom-legacy-a", modelName: "model-alpha" },
    { id: "custom-legacy-b", modelName: "model-beta" },
  ]);
  assert.deepEqual(separate.models.map((m) => m.id), ["custom-legacy-other"]);
  assert.equal(migrated.settings.inspectorModelId, "custom-legacy-a");
  assert.deepEqual(migrated.settings.roles.oracle.queue, ["custom-legacy-a", "custom-legacy-b"]);
  const migratedModel = migrated.settings.models.find((m) => m.id === "custom-legacy-b");
  assert.equal(migratedModel.name, "model-beta");
  assert.equal(migratedModel.channelId, shared.id);
  assert.equal(migratedModel.hasApiKey, true);
  assert.deepEqual(readJson("secrets.json").apiKeys, { [shared.id]: legacy.key, [separate.id]: legacy.otherKey });
  assert.ok(!readJson("settings.json").models.some((m) => m.id.startsWith("custom-legacy-")));
  checkSecretIsolation(migrated, legacy.key);
  checkSecretIsolation(migrated, legacy.otherKey);
  assert.equal(migrated.dshChannels.length, 1);
  assert.equal(migrated.dshChannels[0].readOnly, true);
  assert.equal(migrated.dshChannels[0].models.length, 2);
  assert.ok(migrated.dshModels.every((m) => m.channelId === migrated.dshChannels[0].id));
  checkSecretIsolation(migrated, "sk-dsh-fixture-3333");
  await call("agent_relay_ui_delete_channel", { channelId: separate.id });

  const key = "sk-mock-channel-9999";
  const mockApiServer = http.createServer((req, res) => {
    if (req.url === "/v1/models" && req.headers.authorization === `Bearer ${key}`) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "mock-chat" }, { id: "mock-reasoner" }] }));
    } else {
      res.writeHead(401).end();
    }
  });
  await new Promise((resolve) => mockApiServer.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${mockApiServer.address().port}/v1`;

  try {
    const fetched = await call("agent_relay_ui_fetch_models", { baseUrl, apiKey: key });
    assert.equal(fetched.ok, true);
    assert.deepEqual(fetched.models.map((m) => m.id), ["mock-chat", "mock-reasoner"]);

    const created = await call("agent_relay_ui_upsert_channel", {
      name: "Local relay", providerId: "custom", baseUrl, apiKey: key,
      modelNames: ["mock-chat", "mock-reasoner"], setAsInspector: true,
    });
    const channelId = created.lastSavedChannelId;
    const channel = created.channels.find((c) => c.id === channelId);
    const [chat, reasoner] = channel.models;
    assert.equal(channel.name, "Local relay");
    assert.equal(channel.hasApiKey, true);
    assert.equal(channel.maskedApiKey, "sk-m••••9999");
    assert.equal(created.settings.inspectorModelId, chat.id);
    assert.ok(channel.models.every((m) => m.id.startsWith("custom-")));
    assert.equal(readJson("secrets.json").apiKeys[channelId], key);
    checkSecretIsolation(created, key);

    const newEndpoint = baseUrl.replace("127.0.0.1", "localhost");
    const keyRequired = /explicit API key.*新接口地址/;
    await assert.rejects(call("agent_relay_ui_upsert_channel", {
      id: channelId, baseUrl: newEndpoint, apiKey: " ", modelNames: ["mock-chat"],
    }), keyRequired);
    for (const ref of [{ channelId }, { modelId: chat.id }]) {
      const endpoint = { ...ref, baseUrl: newEndpoint };
      const fetched = await call("agent_relay_ui_fetch_models", endpoint);
      const tested = await call("agent_relay_ui_test_connection", { ...endpoint, mode: "api" });
      for (const result of [fetched, tested]) {
        assert.equal(result.ok, false);
        assert.match(result.error, keyRequired);
      }
    }
    const reservedId = migrated.dshModels[0].id;
    await assert.rejects(call("agent_relay_ui_upsert_model", { id: reservedId, baseUrl, modelName: "shadow" }), /Reserved/);
    await assert.rejects(call("agent_relay_ui_upsert_channel", { id: reservedId, modelNames: ["shadow"] }), /Reserved/);

    await call("agent_relay_ui_update_settings", {
      roles: {
        oracle: { queue: [chat.id, reasoner.id, "custom-legacy-a"] },
        hephaestus: { queue: [chat.id] },
      },
    });
    const edited = await call("agent_relay_ui_upsert_channel", {
      id: channelId, name: "Renamed relay", apiKey: " ", modelNames: ["mock-reasoner", "manual-model"],
    });
    const afterEdit = edited.channels.find((c) => c.id === channelId);
    assert.equal(afterEdit.name, "Renamed relay");
    assert.equal(afterEdit.createdAt, channel.createdAt);
    assert.deepEqual(afterEdit.models[0], reasoner);
    assert.equal(afterEdit.models[1].modelName, "manual-model");
    assert.equal(edited.settings.inspectorModelId, "");
    assert.deepEqual(edited.settings.roles.oracle.queue, [reasoner.id, "custom-legacy-a"]);
    assert.deepEqual(edited.settings.roles.hephaestus.queue, ["cli-codex-default"]);
    assert.equal(readJson("secrets.json").apiKeys[channelId], key);
    checkSecretIsolation(edited, key);
    assert.equal((await call("agent_relay_ui_fetch_models", { channelId })).ok, true);
    const connection = await call("agent_relay_ui_test_connection", { mode: "api", channelId });
    assert.equal(connection.ok, true);
    assert.equal(connection.modelFound, true);

    const legacyBatch = await call("agent_relay_ui_upsert_model", {
      baseUrl, apiKey: key, modelNames: ["mock-reasoner", "batch-compat"],
    });
    assert.equal(legacyBatch.savedIds[0], reasoner.id);
    const legacySingle = await call("agent_relay_ui_upsert_model", { baseUrl, apiKey: key, modelName: "single-compat" });
    assert.equal(legacySingle.settings.models.find((m) => m.id === legacySingle.lastSavedModelId).channelId, channelId);
    await call("agent_relay_ui_delete_model", { modelId: legacySingle.lastSavedModelId });

    const duplicate = await call("agent_relay_ui_upsert_model", { baseUrl, apiKey: key, modelName: "mock-reasoner" });
    const removed = await call("agent_relay_ui_remove_channel_model", { channelId, modelId: reasoner.id });
    assert.deepEqual(removed.channels.find((c) => c.id === channelId).models.map((m) => m.id),
      [afterEdit.models[1].id, legacyBatch.savedIds[1], duplicate.lastSavedModelId]);
    assert.deepEqual(removed.settings.roles.oracle.queue, ["custom-legacy-a"]);
    await call("agent_relay_ui_remove_channel_model", { channelId, modelName: "mock-reasoner" });
    const manualId = afterEdit.models[1].id;
    await call("agent_relay_ui_update_settings", {
      roles: { hephaestus: { queue: [manualId] } }, inspectorModelId: manualId,
    });
    const deleted = await call("agent_relay_ui_delete_channel", { channelId });
    assert.deepEqual(deleted.channels.map((c) => c.id), [shared.id]);
    assert.equal(deleted.settings.inspectorModelId, "");
    assert.deepEqual(deleted.settings.roles.hephaestus.queue, ["cli-codex-default"]);
    assert.deepEqual(readJson("secrets.json").apiKeys, { [shared.id]: legacy.key });
  } finally {
    mockApiServer.close();
  }

  await call("agent_relay_ui_update_settings", { inspectorModelId: "custom-legacy-a" });
  await client.close();
  const persistedStore = new RelayStore(tmpData);
  assert.equal(persistedStore.getModelById("custom-legacy-a").apiKey, legacy.key);
  assert.equal(persistedStore.getModelById("custom-legacy-a").channelId, shared.id);
  assert.equal(persistedStore.getRoleConfig("oracle").model.id, "custom-legacy-a");
  ({ client } = await connectClient(tmpData, engineEnv));
  const reloaded = await call("agent_relay_ui_get_state");
  assert.deepEqual(reloaded.channels, [shared]);
  assert.equal(reloaded.settings.inspectorModelId, "custom-legacy-a");
  assert.equal(fs.readFileSync(dshConfigPath, "utf8"), dshConfig);
  console.log("Legacy migration, channel CRUD, saved-key reuse and secret isolation PASSED.");

  console.log("\n=== 4. Testing v2 Settings, Quotas, & Cooldown/Exhaustion Pause ===");
  const updRes = await client.callTool({
    name: "agent_relay_ui_update_settings",
    arguments: {
      enabled: true,
      maxConcurrency: 4,
      silentCheckinMin: 3,
      longRunCheckinMin: 10,
      retentionDays: 30,
      autoFallbackOnLimit: true,
      roles: { oracle: { queue: ["cli-codex-default"] } },
    },
  });
  const s2 = updRes.structuredContent.settings;
  assert.equal(s2.maxConcurrency, 4);
  assert.equal(s2.silentCheckinMin, 3);
  assert.equal(s2.longRunCheckinMin, 10);
  assert.equal(s2.retentionDays, 30);
  assert.equal(s2.autoFallbackOnLimit, true);
  assert.deepEqual(s2.roles.oracle.queue, ["cli-codex-default"]);

  // Warm call latency check + explicit background quota check
  const tConsole0 = Date.now();
  const consoleState = await client.callTool({ name: "agent_relay_console", arguments: {} });
  const consoleMs = Date.now() - tConsole0;
  console.log(`agent_relay_console warm latency: ${consoleMs}ms`);
  assert.ok(consoleMs < 2000, `Expected non-blocking agent_relay_console (<2000ms), took ${consoleMs}ms`);

  const uiQuotaState = await client.callTool({
    name: "agent_relay_ui_get_state",
    arguments: { forceDetect: false, fetchRateLimits: true },
  });
  const codexModels = uiQuotaState.structuredContent.codexModels || [];
  assert.ok(codexModels.length >= 1, "Expected live codexModels from model/list");
  console.log(`Codex model/list count: ${codexModels.length} (default=${codexModels[0]?.modelName})`);

  // Verify selecting a dynamic Codex sub-model persists cleanly
  if (codexModels.length >= 2) {
    const alt = codexModels[1];
    const dynUpd = await client.callTool({
      name: "agent_relay_ui_update_settings",
      arguments: { roles: { oracle: { modelId: alt.id } } },
    });
    assert.equal(dynUpd.structuredContent.settings.roles.oracle.modelId, alt.id);
    await client.callTool({
      name: "agent_relay_ui_update_settings",
      arguments: { roles: { oracle: { queue: ["cli-codex-default"] } } },
    });
  }

  const browserFixtureState = structuredClone(uiQuotaState);
  browserFixtureState.structuredContent.settings.inspectorEnabled = true;
  await testBrowserStrictCspRender(uiDoc.contents[0].text, browserFixtureState);

  const rl = uiQuotaState.structuredContent.codexRateLimits;
  console.log("Codex rate limits:", rl ? {
    planType: rl.planType,
    primaryRemaining: rl.primary?.remainingPercent,
    secondaryRemaining: rl.secondary?.remainingPercent,
  } : "null (unavailable)");

  // Verify live status tool exposes v2 limits including allowHephaestusFullAccess (default false)
  const statusRes = await client.callTool({
    name: "agent_relay_session",
    arguments: { action: "status" },
  });
  const statusJson = JSON.parse(statusRes.content[0].text);
  assert.equal(statusJson.limits.maxConcurrency, 4);
  assert.equal(statusJson.limits.allowHephaestusFullAccess, false);
  assert.equal(statusJson.limits.allowWorktreeParallelWrite, false);
  const worktreeOn = await call("agent_relay_ui_update_settings", { allowWorktreeParallelWrite: true });
  assert.equal(worktreeOn.settings.allowWorktreeParallelWrite, true);
  const liveWorktreeStatus = await client.callTool({
    name: "agent_relay_session", arguments: { action: "status" },
  });
  assert.equal(JSON.parse(liveWorktreeStatus.content[0].text).limits.allowWorktreeParallelWrite, true);
  const worktreeOff = await call("agent_relay_ui_update_settings", { allowWorktreeParallelWrite: false });
  assert.equal(worktreeOff.settings.allowWorktreeParallelWrite, false);

  // Verify toggling allowHephaestusFullAccess persists and restores cleanly
  const fullAccOn = await client.callTool({
    name: "agent_relay_ui_update_settings",
    arguments: { allowHephaestusFullAccess: true },
  });
  assert.equal(fullAccOn.structuredContent.settings.allowHephaestusFullAccess, true);
  const fullAccOff = await client.callTool({
    name: "agent_relay_ui_update_settings",
    arguments: { allowHephaestusFullAccess: false },
  });
  assert.equal(fullAccOff.structuredContent.settings.allowHephaestusFullAccess, false);

  // Verify expired jobs/*.log files are pruned alongside retentionDays
  const pruneJobsDir = path.join(tmpData, "jobs");
  fs.mkdirSync(pruneJobsDir, { recursive: true });
  const staleLog = path.join(pruneJobsDir, "job_expired_test.log");
  const staleEvents = staleLog.replace(/\.log$/, ".events.json");
  fs.writeFileSync(staleLog, "old log\n", "utf8");
  fs.writeFileSync(staleEvents, JSON.stringify({ prompt: "", activities: [] }), "utf8");
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(staleLog, oldDate, oldDate);
  fs.utimesSync(staleEvents, oldDate, oldDate);
  await client.callTool({
    name: "agent_relay_ui_update_settings",
    arguments: { retentionDays: 30 },
  });
  assert.equal(fs.existsSync(staleLog), false, "Expected expired job log to be pruned by retentionDays");
  assert.equal(fs.existsSync(staleEvents), false, "Expected expired timeline to be pruned by retentionDays");

  // Verify exhaustion pause by temporarily injecting a cooldown into cooldowns.json on a fresh server
  await client.close();
  await new Promise((r) => setTimeout(r, 400));
  fs.writeFileSync(
    path.join(tmpData, "cooldowns.json"),
    JSON.stringify({
      items: {
        "cli-codex-default": {
          modelId: "cli-codex-default",
          untilMs: Date.now() + 3600_000,
          untilIso: new Date(Date.now() + 3600_000).toISOString(),
          reason: "simulated_test_cooldown",
          manualOnly: true,
        },
      },
    }),
    "utf8"
  );
  ({ client } = await connectClient(tmpData, engineEnv));
  const exhaustedRes = await client.callTool({
    name: "agent_relay_ask",
    arguments: { role: "oracle", cwd: tmpWork, prompt: "test pause" },
  });
  assert.ok(
    exhaustedRes.content[0].text.includes("[ALL_ENGINES_EXHAUSTED]"),
    `Expected [ALL_ENGINES_EXHAUSTED], got: ${exhaustedRes.content[0].text}`
  );
  console.log("Exhaustion pause check OK.");

  // Clear cooldown via UI tool
  await client.callTool({
    name: "agent_relay_ui_session_action",
    arguments: { action: "clear_cooldown", modelId: "cli-codex-default" },
  });
  console.log("Clear cooldown check OK.");

  const isLiveCodex = Boolean(process.env.AGENT_RELAY_E2E_CODEX_HOME);
  const codexTestMode = isLiveCodex ? "Live" : "Isolated fixture";
  console.log(`\n=== 5. ${codexTestMode} Codex persistence & cross-restart cache test ===`);
  const t1Prompt = "读取当前目录下的 brief.md，记住里面的 Codeword 和两个角色名，用一句话极简总结。";
  const getDetail = async (jobId) => (await call("agent_relay_ui_get_job_detail", { jobId })).job;
  const t1Text = await askWithPoll(client, {
    role: "oracle",
    cwd: tmpWork,
    title: "Brief codeword test",
    prompt: t1Prompt,
  });
  console.log("Turn 1:\n" + t1Text);
  assert.ok(t1Text.includes("RELAY-9041"));
  assert.ok(t1Text.includes("· new ·"), `Expected new session on Turn 1, got: ${t1Text}`);
  const sidMatch = t1Text.match(/sessionId=(\S+?)(?:\s*·|\])/);
  assert.ok(sidMatch && sidMatch[1], `Expected sessionId in Turn 1 footer, got: ${t1Text}`);
  const sessionId = sidMatch[1];

  const t1Job = (await call("agent_relay_ui_get_state")).recentJobs.find((j) => j.title === "Brief codeword test");
  const t1Detail = await getDetail(t1Job.jobId);
  assert.equal(t1Detail.prompt, t1Prompt);
  assert.equal(t1Detail.finalText, t1Text);
  const eventsPath = path.join(tmpData, "jobs", `${t1Job.jobId}.events.json`);
  const savedTimeline = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
  assert.equal(savedTimeline.prompt, t1Prompt);
  assert.deepEqual(savedTimeline.activities, t1Detail.activities);
  if (!isLiveCodex) {
    const [thought, cmd, file, output] = t1Detail.activities;
    assert.equal(t1Detail.activities.length, 4, "Codex starts, deltas, and completions must merge by id");
    assert.equal(thought.kind, "thought");
    assert.equal(thought.status, "done");
    assert.equal(thought.detail, "Check the brief.");
    assert.ok(Number.isFinite(thought.durationSec));
    assert.equal(cmd.kind, "cmd");
    assert.equal(cmd.title, "npm run check");
    assert.equal(cmd.exitCode, 1);
    assert.equal(cmd.status, "error");
    assert.match(cmd.detail, /\n\nfixture stdout$/);
    assert.equal(file.kind, "edit");
    assert.equal(file.title, "brief.md");
    assert.deepEqual([file.added, file.removed], [2, 1]);
    assert.equal(output.kind, "output");
    assert.equal(output.title, "RELAY-9041");
  }
  assert.ok(!fs.readdirSync(path.dirname(eventsPath)).some((name) => name.endsWith(".tmp")));

  const legacyJob = "job_legacy_timeline";
  fs.writeFileSync(path.join(tmpData, "jobs", `${legacyJob}.log`), [
    `[2026-01-01T00:00:00.000Z] Job ${legacyJob} started (oracle:default)`,
    "[00:00:00] [cmd_start] read src/gateway.go L315-455",
    "[00:00:01] [cmd_start] edit src/gate.go",
    "[00:00:01] [cmd_done] ✓ edit src/gate.go (1s)",
    '[00:00:02] [cmd_start] grep "sessionKeyOf" in gateway/',
    "[00:00:03] [cmd_start] pwsh: go test ./internal/gateway",
    "[00:00:04] [cmd_done] ✓ pwsh: go test ./internal/gateway (1s) → ok",
    "[00:00:05] [cmd_start] pwsh: npm run check",
    "[00:00:06] [cmd_err] ✗ pwsh: npm run check — failed [exit code: 1]",
    "[00:00:07] [thought] 思考 (8s): Read the output.",
    "[00:00:08] [output] writing: Gateway verified.",
  ].join("\n"));
  const legacyDetail = await getDetail(legacyJob);
  assert.deepEqual(legacyDetail.activities.map(({ kind, title, meta }) => [kind, title, meta]), [
    ["read", "gateway.go", "#L315-455"], ["edit", "gate.go", ""], ["search", '"sessionKeyOf"', "gateway/"],
    ["cmd", "go test ./internal/gateway", ""], ["cmd", "npm run check", ""], ["thought", "", ""],
    ["output", "Gateway verified.", ""],
  ]);
  assert.equal(legacyDetail.activities[3].status, "done");
  assert.equal(legacyDetail.activities[4].exitCode, 1);
  assert.equal(legacyDetail.activities[4].status, "error");
  assert.equal(legacyDetail.activities[5].durationSec, 8);

  const t2Text = await askWithPoll(client, {
    role: "oracle",
    cwd: tmpWork,
    sessionId,
    prompt: "不要重读文件。只回答刚才 brief.md 里的 Codeword 是什么？",
  });
  console.log("\nTurn 2 (warm):\n" + t2Text);
  assert.ok(t2Text.includes("RELAY-9041"));
  assert.ok(t2Text.includes("warm"), `Expected warm session on Turn 2, got: ${t2Text}`);
  if (!isLiveCodex) {
    assert.ok(t2Text.includes("90%"), `Expected 90% cache hit on Turn 2, got: ${t2Text}`);
  }

  console.log("\n=== 6. Restarting MCP server completely & verifying Turn 3 cross-restart cache ===");
  await client.close();
  await new Promise((r) => setTimeout(r, 1200));
  ({ client } = await connectClient(tmpData, engineEnv));

  const reopened = await getDetail(t1Job.jobId);
  assert.equal(reopened.prompt, t1Prompt);
  assert.equal(reopened.finalText, t1Text);
  assert.deepEqual(reopened.activities, savedTimeline.activities);
  console.log("Structured timeline persistence, disk response, and legacy replay PASSED.");

  const t3Text = await askWithPoll(client, {
    role: "oracle",
    cwd: tmpWork,
    sessionId,
    prompt: "不要重读文件。重启后只用 10 个字内回答：Codeword 是什么？",
  });
  console.log("Turn 3 (after full restart):\n" + t3Text);
  assert.ok(t3Text.includes("RELAY-9041"));
  assert.ok(t3Text.includes("resumed"), "Expected resumed session after server restart!");
  if (!isLiveCodex) {
    assert.ok(t3Text.includes("90%"), `Expected 90% cache hit on Turn 3, got: ${t3Text}`);
  }

  const finalConsole = await client.callTool({ name: "agent_relay_console", arguments: {} });
  const tel = finalConsole.structuredContent.telemetry;
  console.log("\nTelemetry Summary:", {
    totalTurns: tel.totalTurns,
    reportedTurns: tel.reportedTurns,
    lastHitRate: tel.lastHitRate,
    cumulativeHitRate: tel.cumulativeHitRate,
    totalCachedTokens: tel.totalCachedTokens,
  });
  assert.equal(tel.totalTurns, 3);
  const maxHit = Math.max(...tel.recent.map((r) => (r.cacheReported ? r.hitRate : 0)));
  assert.ok(maxHit >= 70, `Expected high cache hit rate, got max=${maxHit}%`);
  const trackedSess = (finalConsole.structuredContent.sessions || []).find((s) => s.sessionId === sessionId);
  assert.ok(trackedSess, `Expected session ${sessionId} in finalConsole.structuredContent.sessions`);
  assert.equal(
    trackedSess.title,
    "Brief codeword test",
    `Expected session title "Brief codeword test", got: ${trackedSess.title}`
  );

  // Omitting sessionId must start a clean isolated new session
  const tNew = await askWithPoll(client, {
    role: "oracle",
    cwd: tmpWork,
    title: "Fresh isolated task",
    prompt: "用一句话确认这是一个全新的会话。",
  });
  console.log("\nTurn New (omitted sessionId -> clean new session):\n" + tNew);
  assert.ok(tNew.includes("· new ·"), `Expected clean new session when sessionId omitted, got: ${tNew}`);
  const newSidMatch = tNew.match(/sessionId=(\S+?)(?:\s*·|\])/);
  assert.ok(
    newSidMatch && newSidMatch[1] && newSidMatch[1] !== sessionId,
    `Expected a distinct new sessionId, got: ${tNew}`
  );

  const jobDir = path.join(tmpData, "jobs");
  for (const log of fs.readdirSync(jobDir)) {
    assert.doesNotMatch(fs.readFileSync(path.join(jobDir, log), "utf8"), /\[touch\]/);
  }

  // Verify tracked agent_relay_review runs cleanly through the unified job pipeline
  const revRes = await client.callTool({
    name: "agent_relay_review",
    arguments: { cwd: tmpWork, targetType: "uncommittedChanges" },
  });
  assert.equal(Boolean(revRes.isError), false, `Expected agent_relay_review success, got: ${revRes.content?.[0]?.text}`);
  assert.ok(
    fs.readdirSync(jobDir).some((f) => f.startsWith("rev_") && f.endsWith(".log")),
    "Expected tracked rev_*.log created by agent_relay_review"
  );

  // Verify true parallel async launch (waitSec: 0) + multi-job agent_relay_poll(jobIds)
  const par1 = await client.callTool({
    name: "agent_relay_ask",
    arguments: { role: "oracle", slot: "par_a", cwd: tmpWork, prompt: "parallel slot A", waitSec: 0 },
  });
  const par2 = await client.callTool({
    name: "agent_relay_ask",
    arguments: { role: "oracle", slot: "par_b", cwd: tmpWork, prompt: "parallel slot B", waitSec: 0 },
  });
  const m1 = par1.content[0].text.match(/Job (job_[a-f0-9]+)/);
  const m2 = par2.content[0].text.match(/Job (job_[a-f0-9]+)/);
  assert.ok(m1 && m2 && m1[1] !== m2[1], `Expected two distinct async jobIds, got: ${par1.content[0].text} | ${par2.content[0].text}`);
  const multiPoll = await client.callTool({
    name: "agent_relay_poll",
    arguments: { jobIds: [m1[1], m2[1]], waitSec: 30 },
  });
  assert.equal(Boolean(multiPoll.isError), false, `Expected pollMany success, got: ${multiPoll.content[0].text}`);
  assert.ok(multiPoll.content[0].text.includes(m1[1]) && multiPoll.content[0].text.includes(m2[1]));
  console.log("Tracked agent_relay_review, log retention & true parallel waitSec=0 + pollMany checks PASSED.");

  // Verify live job detail: dashboard exposes recentJobs + agent_relay_ui_get_job_detail returns the timeline
  const uiJobsState = await client.callTool({
    name: "agent_relay_ui_get_state",
    arguments: { forceDetect: false, fetchRateLimits: false },
  });
  const recentJobs = uiJobsState.structuredContent.recentJobs || [];
  assert.ok(Array.isArray(recentJobs) && recentJobs.length > 0, "Expected recentJobs in agent_relay_ui_get_state");
  assert.ok(recentJobs.length <= 10, `Expected recentJobs capped at 10, got ${recentJobs.length}`);
  const doneJob = recentJobs.find((j) => j.status === "completed");
  assert.ok(doneJob, `Expected a completed job in recentJobs, got: ${recentJobs.map((j) => j.status).join(",")}`);
  for (const key of ["jobId", "role", "status", "elapsedSec", "logPath", "recentActivities"]) {
    assert.ok(key in doneJob, `Expected recentJobs entry to include ${key}`);
  }
  const detailRes = await client.callTool({
    name: "agent_relay_ui_get_job_detail",
    arguments: { jobId: doneJob.jobId },
  });
  assert.equal(detailRes.structuredContent?.ok, true, `Expected ok:true job detail for ${doneJob.jobId}`);
  assert.ok(Array.isArray(detailRes.structuredContent.job?.activities), "Expected job.activities array in job detail");
  const missingDetail = await client.callTool({
    name: "agent_relay_ui_get_job_detail",
    arguments: { jobId: "job_deadbeef" },
  });
  assert.equal(missingDetail.structuredContent?.ok, false, "Expected ok:false for unknown jobId");
  console.log(`recentJobs=${recentJobs.length} & agent_relay_ui_get_job_detail(${doneJob.jobId}) checked PASSED.`);

  console.log("\n=== 7. X-Ray summarizeToolInput & zero-token doorbell (wait-job.mjs) ===");
  testSummarizeToolInput();
  await testAcpActivity();
  assert.equal(parseToolActivity("read", { path: "gateway.go", start_line: 315, end_line: 455 }).meta, "#L315-455");
  assert.equal(parseToolActivity("read", null).kind, "read");
  await testWaitJobScript();

  console.log("\n=== 8. Status snapshots, outputs/*.txt & new opt-in settings ===");
  const settingsNow = (await call("agent_relay_ui_get_state")).settings;
  assert.equal(settingsNow.asyncBackgroundMode, false, "asyncBackgroundMode must default to false");
  assert.equal(settingsNow.inspectorEnabled, false, "inspectorEnabled must default to false");
  const statusLimits = JSON.parse(
    (await client.callTool({ name: "agent_relay_session", arguments: { action: "status" } })).content[0].text
  ).limits;
  assert.equal(statusLimits.asyncBackgroundMode, false);
  assert.equal(statusLimits.inspectorEnabled, false);
  assert.ok(statusLimits.waitJobScript?.endsWith("wait-job.mjs"), "status must expose the doorbell script path");

  if (!isLiveCodex) {
    const startFixtureJob = async (prompt) => {
      const started = await client.callTool({
        name: "agent_relay_ask", arguments: { role: "oracle", cwd: tmpWork, prompt, waitSec: 0 },
      });
      const match = started.content[0].text.match(/Job (job_[a-f0-9]+)/);
      assert.ok(match, started.content[0].text);
      return match[1];
    };
    const waitForFixtureJob = async (id) => {
      await client.callTool({ name: "agent_relay_poll", arguments: { jobId: id, waitSec: 5 } });
      const detail = await getDetail(id);
      assert.equal(detail.status, readStatusFile(tmpData, id).status);
      assert.deepEqual(detail.activities, readJson(`jobs/${id}.events.json`).activities);
      return detail;
    };
    const failed = await waitForFixtureJob(await startFixtureJob("Fixture failure"));
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /fixture failure/);
    assert.equal(failed.activities[0].kind, "thought");

    const interruptedId = await startFixtureJob("Fixture interrupt");
    await call("agent_relay_ui_session_action", { action: "interrupt", jobId: interruptedId });
    const interrupted = await waitForFixtureJob(interruptedId);
    assert.equal(interrupted.status, "interrupted");
    assert.ok(interrupted.activities.some((event) => event.kind === "thought" && event.status === "done"));
    assert.ok(interrupted.activities.some((event) => event.kind === "interrupt"));
    console.log("Failed and explicitly interrupted timelines persisted PASSED.");
  }

  // Every tracked job must have a terminal, atomic status.json with the documented fields.
  const statusFiles = fs.readdirSync(path.join(tmpData, "jobs")).filter((f) => f.endsWith(".status.json"));
  assert.ok(statusFiles.length > 0, "Expected <dataDir>/jobs/*.status.json snapshots");
  const STATUS_FIELDS = [
    "jobId", "role", "slot", "title", "cwd", "sessionId", "engine", "modelDisplayName", "status", "pid",
    "startedAt", "updatedAt", "lastActivityAt", "lastSummary", "finishedAt", "elapsedSec", "error",
    "logPath", "outputPath",
  ];
  for (const file of statusFiles) {
    const snap = JSON.parse(fs.readFileSync(path.join(tmpData, "jobs", file), "utf8"));
    for (const field of STATUS_FIELDS) assert.ok(field in snap, `${file} missing field ${field}`);
    assert.ok(["completed", "failed", "interrupted"].includes(snap.status), `${file} left in status=${snap.status}`);
    assert.ok(!file.includes(".tmp"), "Leftover temp status file");
  }
  const finishedSnap = JSON.parse(fs.readFileSync(path.join(tmpData, "jobs", `${doneJob.jobId}.status.json`), "utf8"));
  assert.equal(finishedSnap.status, "completed");
  assert.equal(finishedSnap.sessionId, doneJob.sessionId);

  // Full response text is always persisted for the Lead Agent (even when not truncated).
  const outPath = path.join(tmpData, "outputs", `${doneJob.jobId}.txt`);
  assert.ok(fs.existsSync(outPath), `Expected full output at ${outPath}`);
  assert.match(fs.readFileSync(outPath, "utf8"), /RELAY-9041|A\.stand/);
  assert.equal(finishedSnap.outputPath, outPath);

  const toggledOn = await call("agent_relay_ui_update_settings", { asyncBackgroundMode: true, inspectorEnabled: true });
  assert.equal(toggledOn.settings.asyncBackgroundMode, true);
  assert.equal(toggledOn.settings.inspectorEnabled, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmpData, "settings.json"), "utf8")).asyncBackgroundMode, true);
  const statusOn = JSON.parse(
    (await client.callTool({ name: "agent_relay_session", arguments: { action: "status" } })).content[0].text
  ).limits;
  assert.equal(statusOn.asyncBackgroundMode, true);
  assert.equal(statusOn.inspectorEnabled, true);

  // Async Background Mode: omitting waitSec must auto-launch async and return the ready-to-run doorbell.
  const autoAsyncRes = await client.callTool(
    {
      name: "agent_relay_ask",
      arguments: {
        role: "oracle",
        slot: "auto_async",
        cwd: tmpWork,
        title: "Auto async",
        // waitSec intentionally omitted -> asyncBackgroundMode=true must make this async.
        prompt: "读取 brief.md 并用一句话总结。",
      },
    },
    undefined,
    LONG_CALL_OPTS
  );
  const autoAsyncText = autoAsyncRes.content[0].text;
  assert.match(autoAsyncText, /^\[Started · async\]/, `Expected auto-async launch, got: ${autoAsyncText}`);
  const autoJob = autoAsyncText.match(/Job (job_[a-f0-9]+)/)?.[1];
  assert.ok(autoJob, `Expected jobId in auto-async reply: ${autoAsyncText}`);
  const doorbellLine = autoAsyncText.split("\n").find((l) => l.startsWith("Doorbell (zero-token background wakeup):"));
  assert.ok(doorbellLine, `Missing doorbell line: ${autoAsyncText}`);
  assert.ok(doorbellLine.includes(`"${path.join(ROOT, "dist", "wait-job.mjs")}"`), `Doorbell must point at dist/wait-job.mjs: ${doorbellLine}`);
  assert.ok(doorbellLine.includes(`--data-dir "${tmpData}"`), `Doorbell must carry --data-dir: ${doorbellLine}`);
  assert.ok(doorbellLine.trim().endsWith(autoJob), `Doorbell must end with the jobId: ${doorbellLine}`);
  const autoSnap = readStatusFile(tmpData, autoJob);
  assert.ok(["running", "completed"].includes(autoSnap.status), `Unexpected async status ${autoSnap.status}`);
  assert.ok(autoJob !== doneJob.jobId);
  // Deterministic doorbell check: mark the job completed and confirm the real script exits 0.
  writeStatusFile(tmpData, { ...autoSnap, status: "completed", finishedAt: Date.now(), updatedAt: Date.now(), lastSummary: "auto async done" });
  const doorbellDone = await runWaitJob(tmpData, [autoJob], { timeoutMs: 12_000 });
  assert.equal(doorbellDone.code, 0, `Doorbell should exit 0: ${doorbellDone.out}`);
  assert.match(doorbellDone.out, new RegExp(`\\[COMPLETED\\] ${autoJob}`));
  const autoCollect = await client.callTool({ name: "agent_relay_poll", arguments: { jobId: autoJob } }, undefined, LONG_CALL_OPTS);
  assert.equal(Boolean(autoCollect.isError), false, autoCollect.content[0].text);

  // Explicit waitSec still forces a blocking/check-in wait even in async mode.
  const explicitWait = await askWithPoll(client, {
    role: "oracle",
    slot: "explicit_wait",
    cwd: tmpWork,
    title: "Explicit wait",
    prompt: "只用一句话回答：当前目录有哪些文件？",
    waitSec: 30,
  });
  assert.doesNotMatch(explicitWait, /^\[Started · async\]/, `Explicit waitSec must block: ${explicitWait}`);
  assert.match(explicitWait, /\[A\.stand · oracle/);

  await call("agent_relay_ui_update_settings", { asyncBackgroundMode: false, inspectorEnabled: false });
  const toggledOff = (await call("agent_relay_ui_get_state")).settings;
  assert.equal(toggledOff.asyncBackgroundMode, false);
  assert.equal(toggledOff.inspectorEnabled, false);
  console.log("status.json snapshots, outputs/*.txt, async doorbell & inspector settings PASSED.");

  console.log("\n=== 9. Startup crash recovery (stale running snapshot with a dead PID) ===");
  const staleJobId = `job_crash${crypto.randomBytes(3).toString("hex")}`;
  const staleStarted = Date.now() - 95_000;
  const staleUpdated = Date.now() - 5_000;
  writeStatusFile(tmpData, {
    jobId: staleJobId,
    role: "hephaestus",
    slot: "default",
    title: "Crash-recovered refactor",
    cwd: tmpWork,
    sessionId: "sid-crash-recovery",
    engine: "deepseek-harness",
    modelDisplayName: "crash-model",
    status: "running",
    pid: 0x7ffffffe,
    startedAt: staleStarted,
    updatedAt: staleUpdated,
    lastActivityAt: staleUpdated,
    lastSummary: "editing src/core/store.mjs",
    finishedAt: null,
    elapsedSec: 90,
    error: null,
    logPath: path.join(tmpData, "jobs", `${staleJobId}.log`),
    outputPath: path.join(tmpData, "outputs", `${staleJobId}.txt`),
  });
  fs.writeFileSync(path.join(tmpData, "jobs", `${staleJobId}.log`), "[00:00:00] [cmd_start] edit src/core/store.mjs\n", "utf8");
  // An expired snapshot must be ignored by crash recovery (retention window).
  const expiredJobId = `job_expiredcrash${crypto.randomBytes(2).toString("hex")}`;
  const expiredPath = path.join(tmpData, "jobs", `${expiredJobId}.status.json`);
  writeStatusFile(tmpData, {
    jobId: expiredJobId, role: "oracle", slot: "default", title: "Old", status: "running",
    pid: 0x7ffffffe, startedAt: staleStarted, updatedAt: staleUpdated, lastActivityAt: staleUpdated,
    sessionId: "sid-old", logPath: "", outputPath: "",
  });
  const oldMtime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  fs.utimesSync(expiredPath, oldMtime, oldMtime);

  await client.close();
  await new Promise((r) => setTimeout(r, 600));
  ({ client } = await connectClient(tmpData, engineEnv));

  const recoveredState = await call("agent_relay_ui_get_state");
  const interrupted = recoveredState.interruptedJobs || [];
  const banner = interrupted.find((j) => j.jobId === staleJobId);
  assert.ok(banner, `Expected ${staleJobId} in getState().interruptedJobs, got: ${interrupted.map((j) => j.jobId)}`);
  assert.equal(banner.status, "interrupted");
  assert.equal(banner.sessionId, "sid-crash-recovery");
  assert.equal(banner.cwd, tmpWork);
  assert.equal(banner.role, "hephaestus");
  assert.equal(banner.title, "Crash-recovered refactor");
  assert.equal(banner.lastSummary, "editing src/core/store.mjs");
  assert.match(banner.logPath, new RegExp(`${staleJobId}\\.log$`));
  assert.match(banner.error, /Host\/MCP exited while job was running/);
  assert.ok(!interrupted.some((j) => j.jobId === expiredJobId), "Expired snapshots must not surface");
  assert.ok(recoveredState.recentJobs.some((j) => j.jobId === staleJobId), "Recovered job must appear in recentJobs");
  const rewritten = readStatusFile(tmpData, staleJobId);
  assert.equal(rewritten.status, "interrupted");
  assert.equal(rewritten.finishedAt, staleUpdated, "finishedAt should fall back to the last updatedAt");
  assert.match(rewritten.error, /Host\/MCP exited while job was running/);

  const recoveredDetail = await client.callTool({ name: "agent_relay_ui_get_job_detail", arguments: { jobId: staleJobId } });
  assert.equal(recoveredDetail.structuredContent?.ok, true);
  assert.equal(recoveredDetail.structuredContent.job.status, "interrupted");
  assert.equal(recoveredDetail.structuredContent.job.recovered, true);
  const recoveredEvents = readJson(`jobs/${staleJobId}.events.json`);
  assert.equal(recoveredEvents.activities[0].kind, "edit");
  assert.equal(recoveredEvents.activities[0].status, "interrupted");
  const interruptedPoll = await client.callTool({ name: "agent_relay_poll", arguments: { jobId: staleJobId } });
  assert.match(interruptedPoll.content[0].text, /\[INTERRUPTED\]/);
  assert.match(interruptedPoll.content[0].text, /sid-crash-recovery/);

  const dismissed = await call("agent_relay_ui_dismiss_interrupted", { jobId: staleJobId });
  assert.equal(dismissed.interruptedJobs.length, 0, "Dismiss must clear the banner");
  assert.ok(dismissed.recentJobs.some((j) => j.jobId === staleJobId), "Dismissed job stays in history as interrupted");
  assert.equal(readStatusFile(tmpData, staleJobId).status, "interrupted");
  console.log(`Crash recovery & dismiss for ${staleJobId} PASSED.`);

  await client.callTool({
    name: "agent_relay_session",
    arguments: { action: "reset", sessionId, cwd: tmpWork, role: "oracle" },
  });

  await client.close();
  fs.rmSync(tmpData, { recursive: true, force: true });
  fs.rmSync(tmpWork, { recursive: true, force: true });
  console.log("\nALL E2E TESTS PASSED!");
}

const run = process.argv.includes("--codex-fixture") ? runCodexFixture
  : process.argv.includes("--worktree-only") ? testWorktrees : main;
Promise.resolve().then(run).catch((err) => {
  console.error("E2E TEST FAILED:", err);
  process.exit(1);
});
