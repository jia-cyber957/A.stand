# A.stand — Project Handover & Current State

> **Last updated**: 2026-11-24
> **Purpose**: Self-contained engineering handover so any future session or AI agent can resume work on this repository immediately with zero context loss.

---

## 1. What This Project Is

**A.stand** is a **zero-mutation, multi-AI persistent subagent broker plugin for Antigravity** (and future standalone desktop/multi-host orchestrator).

- **Core idea**: Keep the expensive/smart Lead Agent (e.g., Antigravity Gemini) focused on architecture, task decomposition, and final verification, while offloading heavy multi-file implementation (`hephaestus`) and parallel read-only research/code review (`oracle`) to native external AI engines:
  - **OpenAI Codex CLI** (`codex app-server`, native subscription)
  - **DeepSeek Harness (`dsh --profile acp`)** — runs official DeepSeek OR any OpenAI-compatible API channel/proxy (verified live at **98%–99.8% Prompt Cache hit rate**)
  - **Claude Code CLI** (`claude --output-format stream-json`)
  - **Antigravity CLI** (`agy` headless)
- **Zero-Mutation Guarantee**: Never alters `~/.codex/config.toml`, `~/.dsh/*`, `~/.claude/*`, or any external CLI files. All runtime scoping uses ephemeral CLI flags, `--patch` overlays in plugin data, and per-process env vars.

---

## 2. Repository Structure & File Ownership

```text
agent-relay/
├── plugin/
│   ├── plugin.json                    # Antigravity plugin manifest
│   ├── mcp_config.json                # Portable MCP stdio config (${PLUGIN_ROOT} / ${PLUGIN_DATA})
│   ├── assets/logo.svg                # Dual-A plugin icon
│   ├── rules/AGENTS.md                # Concise host-agnostic delegation gate (always loaded by host)
│   └── skills/agent-relay/SKILL.md    # Detailed orchestration, doorbell, setup & model-selection guide
├── src/
│   ├── server.mjs                     # MCP server + UI-only tools (visibility: ["app"])
│   ├── core/
│   │   ├── constants.mjs              # Provider presets & defaults
│   │   ├── paths.mjs                  # CLI detection (codex, dsh, claude, agy) & Node >= 24.9 check
│   │   ├── store.mjs                  # Atomic JSON persistence (settings, secrets, sessions, cooldowns)
│   │   ├── orchestrator.mjs           # Job lifecycle, concurrency, explicit sessionId, stall gatekeeper, crash recovery
│   │   ├── worktree.mjs               # Git checkout detection and worktree lifecycle
│   │   └── telemetry.mjs              # Real upstream Prompt Cache JSONL ledger
│   ├── engines/
│   │   ├── base.mjs                   # Shared role specs, usage normalization & structured activity helpers
│   │   ├── codex.mjs                  # Codex app-server (structured timeline events, rate limits, turn/steer with expectedTurnId)
│   │   ├── acp.mjs                    # DeepSeek Harness ACP (zstd cache extraction, parseToolActivity, structured timeline)
│   │   ├── claude-code.mjs            # Claude Code stream-json adapter
│   │   └── antigravity.mjs            # Antigravity CLI adapter
│   └── ui/
│       ├── template.html              # Single-file strict-CSP HTML shell
│       ├── app.js                     # Side-panel console (Team, Models/Channels, Cache, Settings, Job Conversation View)
│       └── styles.css                 # Dark/light adaptive styling & Antigravity-native borderless timeline
├── scripts/
│   ├── build.mjs                      # esbuild bundle -> dist/server.mjs, dist/console.html, dist/wait-job.mjs
│   ├── install-antigravity.mjs        # Build & deploy to ~/.gemini/config/plugins/agent-relay/
│   ├── uninstall-antigravity.mjs      # Clean plugin removal
│   ├── check-contracts.mjs            # Local engine detection & Codex schema contract check
│   ├── wait-job.mjs                   # Zero-token, ~0% CPU background doorbell waiter
│   └── e2e-test.mjs                   # Full 9-section E2E suite (incl. headless Edge strict-CSP check)
├── docs/
│   └── ROADMAP_WORKTREE.md            # Opt-in parallel Hephaestus worktree behavior
├── AGENT_INSTALL.md                   # Deterministic install, engine setup & model advisor for AI Agents
├── README.md / README.zh-CN.md        # Human-facing English & Chinese docs
└── UPGRADING_ENGINES.md               # Guide for adapting when upstream CLIs change
```

---

## 3. Current Implemented Capabilities

1. **Two-Level API Channels -> Models Architecture**:
   - Configure one API Channel (Base URL + API Key stored isolated in `secrets.json`), click **Fetch Models** (`GET /models`) to batch-import models; cross-origin endpoint edits enforce re-entering API key (P0 leak guard); reserved `dsh:`/`cli:` IDs rejected.
2. **Real Upstream Prompt Cache & Explicit `sessionId` Lifecycle**:
   - Omitting `sessionId` always opens a clean fresh session (zero cross-task bleed). Passing footer `sessionId` resumes context & Prompt Cache across restarts.
   - `acp.mjs` uses Node 24's built-in `zlib.zstdDecompressSync` with a brief flush-wait to extract exact `cacheReadTokens` from `<dshHome>/sessions/**/<sid>/session.v4.jsonl.zstd` (verified live: 96%–99.8%).
   - Subagent internal context (e.g., 200K+ tokens) stays strictly inside the subagent process; Lead Agent receives only the concise final report (capped at 24K inline, full copy saved to `outputs/<jobId>.txt`).
3. **True Parallel Read-Only `oracle` + Write-Mutex `hephaestus`**:
   - `waitSec: 0` async fire-and-return + `agent_relay_poll(jobIds=[...])` (`pollMany`) + `acp.mjs` `connecting` lock for true parallel startups.
   - `allowHephaestusFullAccess` toggle (default `false`) gates `sandbox="danger-full-access"` for `hephaestus` only (`oracle` always `read-only`).
   - `allowWorktreeParallelWrite` (default `false`) isolates parallel Git writers. Jobs keep worktrees with uncommitted changes or new commits.
4. **Antigravity-Native Borderless Collapsible Job Conversation View**:
   - Both `codex.mjs` and `acp.mjs` emit structured events (`id`, `kind`, `title`, `meta`, `added`, `removed`, `durationSec`, `status`, `exitCode`, `detail`).
   - In-place merge by `id` (thought ticks update one row; tool start + result update one row).
   - Persisted to `jobs/<jobId>.events.json` (with smart legacy `.log` parser fallback, zero duplicate left/right text).
   - Displays collapsible **Message from Lead Agent**, `Thought for Ns ›` (left-bordered prose), `Analyzed file #L10-50`, `Edited file +13 -4`, `Ran cmd · exit code ›` (scrollable terminal output), and safe Markdown **Final Response**. Expand state persists across 2s live refreshes.
   - Narrow side-panel dropdowns disable hover auto-expand (click-only accordion; wide panels retain side flyout).
5. **Opt-in Async Background Mode ("边干边聊") + Zero-Token Doorbell (`wait-job.mjs`)**:
   - Setting `asyncBackgroundMode` (default `false`). When ON and `waitSec` is omitted, `agent_relay_ask` returns immediately with a `Doorbell:` command (`node dist/wait-job.mjs --data-dir <dataDir> --stall-sec <N> <jobId>`).
   - Running `wait-job.mjs` as a host background command unlocks chat immediately, burns **0 Lead Agent polling tokens**, and wakes the Lead Agent with a 3-line summary on exit `0` (completed), `1` (error/interrupted), `2` (stall/gatekeeper alert), `3` (MCP pid died), or `4` (missing status file > 15s).
6. **Opt-in 2-Choice Stall Gatekeeper AI**:
   - Setting `inspectorEnabled` (default `false`). When ON, on silence timeout it reads ONLY `taskSummary` (≤ 1.2K) + last 30 X-ray lines (never full 200K context) and returns strictly `VERDICT: CONTINUE` (extends silence timer up to 3× without waking Lead Agent) or `VERDICT: ALERT` (triggers doorbell exit `2`). Never edits or steers code.
7. **Accidental-Close / Crash Recovery**:
   - Atomic `jobs/<jobId>.status.json` snapshots track `pid`, `sessionId`, `lastSummary`, `status`.
   - `shutdown()` and startup recovery mark orphaned `running` jobs as `interrupted` and show an `⚠ 意外中断` banner in the Team tab with one-click **Copy Resume Prompt (`sessionId`)** and **Dismiss**.

---

## 4. Build, Install & Test Commands

```bash
# Install dependencies (first time)
npm install

# Build dist/server.mjs, dist/console.html, dist/wait-job.mjs and deploy to ~/.gemini/config/plugins/agent-relay/
npm run install:antigravity

# Check detected CLIs & Codex protocol contract
npm run check:contracts

# Run full 9-section E2E suite (incl. headless Edge strict-CSP browser checks)
npm run test:e2e
```

> **Note**: Antigravity hot-reloads `dist/console.html` when closing & reopening the side panel, but reloading `dist/server.mjs` (backend MCP server changes) requires restarting Antigravity.

---

## 5. Known Constraints & Gotchas

- **Node.js >= 24.9.0** is required to run DeepSeek Harness (`@deepseek-ai/dsh@latest`, prerelease tags so `@latest` is required). System Node on this dev machine is `v24.22.3`.
- **ACP v1 (`dsh`) has no mid-turn `steer`**: `dsh-acp` enforces one inflight prompt per session; to redirect a wedged `dsh` job, call `interrupt` then re-ask with the same `sessionId` (preserves 99% cache). Codex `0.172.0` supports mid-turn `turn/steer` (requires `expectedTurnId`, now wired in `codex.mjs`).
- **Windows sandbox note**: When `hephaestus` runs in `workspace-write` sandbox inside `agent-relay` itself, `esbuild` piped spawn, `~/.gemini/config/plugins/` installs, and headless Edge browser tests hit `EPERM` — finish code + syntax checks in subagent, then run `npm run install:antigravity` & `npm run test:e2e` on host.

---

## 6. Pending Roadmap (Next Up)

1. **GitHub Public Release**:
   - Review the repository for public release and publish with `README.md`, `README.zh-CN.md`, and `AGENT_INSTALL.md`.
2. **Standalone Portable `.exe` + Multi-Host Hub (v2 Vision)**:
   - Decouple MCP core into a local daemon (HTTP MCP + Tauri/WebView2 lightweight portable `.exe` tray UI) with a **Hosts** tab for one-click install/uninstall into Antigravity, Codex CLI, Claude Code, and Cursor — plus **per-host routing / anti-self-recursion** (e.g., Codex skips Codex and delegates to DeepSeek/Claude/Gemini; closing an IDE no longer kills running subagents).
