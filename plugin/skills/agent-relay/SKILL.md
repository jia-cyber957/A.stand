---
name: agent-relay
description: Orchestrate persistent-context external AI subagents (Oracle read-only advisor/reviewer and Hephaestus deep engineer) through Agent Relay while maximizing Prompt Cache hit rate, handling non-interrupting check-ins and quota fallbacks, and guiding users through zero-mutation CLI/API setup.
---

# Agent Relay Collaboration & Setup Guide

Agent Relay is a **zero-mutation broker** connecting the lead agent to persistent external AI harnesses (`codex`, `claude-code`, `antigravity`, and `deepseek-harness` via ACP). External CLI configs are never altered — runtime scoping is applied strictly via ephemeral launch arguments and per-process environment variables.

## 1. Check Live User Settings Before Parallel Delegation

Before fanning out parallel tasks or modifying orchestration behavior, call `agent_relay_session(action="status")` to inspect the user's live configuration:
- `limits.maxConcurrency` (default `3`, configurable `1–6`)
- `limits.silentCheckinMin` (default `3m`) & `limits.longRunCheckinMin` (default `10m`)
- `limits.autoFallbackOnLimit` & per-role priority `queue` + cooldowns / Codex 5h & 7d quotas
- `limits.asyncBackgroundMode` (default `false`) and `limits.inspectorEnabled` (default `false`)
- `limits.waitJobScript` — absolute path of the zero-token doorbell script
- `activeJobs` currently running and `interruptedJobs` recovered after a host crash

**Concurrency & Execution Rules**:
- Read-only `oracle` supports parallel subtasks by passing distinct `slot` names (e.g. `slot="backend"`, `slot="frontend"`, `slot="security"`), keeping total active jobs within `limits.maxConcurrency`.
- **True Parallel Launch Pattern (CRITICAL for stdio MCP hosts)**: Because host MCP clients often serialize blocking calls to the same stdio server, whenever launching 2+ parallel `oracle` slots, pass **`waitSec: 0`** on each `agent_relay_ask` (returns `jobId` in ~10ms so all subagents start simultaneously!), then wait for all of them together in one call via **`agent_relay_poll(jobIds=["job_...", "job_..."])`**!
- Workspace-write `hephaestus` enforces a strict per-workspace write mutex — never run two `hephaestus` jobs or edit the same directory concurrently alongside `hephaestus`.
- **Dynamic `effort` selection**: Pass `effort="low"` for fast targeted fixes/lookups, `effort="medium"` by default, and `effort="high"` only for hard architecture/debugging tasks.
- **Two-Layer Sandbox Gating (No Privilege Escalation)**:
  - `oracle` is ALWAYS `read-only`.
  - `hephaestus` defaults to `sandbox="workspace-write"`. Only pass `sandbox="danger-full-access"` when `limits.allowHephaestusFullAccess` is `true` AND the task legitimately needs host builds/browsers (the backend hard-blocks escalation if disabled).
  - If `limits.allowHephaestusFullAccess` is `false` and a check-in shows `hephaestus` hitting a Windows sandbox wall on build/browser tests (e.g. `esbuild` parent-dir access or nested browser sandbox), steer it immediately (`action="steer"`) to finish code + `node --check` and run the build/browser test yourself on host, adding one brief closing note that the user can enable "Allow Hephaestus Full Access" in Settings for trusted workspaces.

## 2. Decision Rubric (When to Delegate vs. Work Solo)

### Never Delegate (Handle Directly)
- Simple Q&A, web searches, documentation lookup, translations, or summaries.
- Clear 1–3 file edits, config tweaks, or straightforward bug fixes you can finish in 1–2 minutes.
- Host-native tasks (browser automation, image generation, local host skills).

### Delegate to `oracle` (Strictly Read-Only)
- **Architecture & Tradeoffs**: High-impact design choices, concurrency/state-machine review, or security evaluation needing a second frontier brain.
- **2-Strike Debugging Escalation**: After 2 failed fix attempts on a stubborn bug, stop guessing — send the symptom, ruled-out hypotheses, and exact `file:line` pointers to `oracle`.
- **Independent Code Review**: Before finalizing major changes, call `agent_relay_review` (or `oracle`) for adversarial review.

### Delegate to `hephaestus` (Workspace-Write Deep Engineer)
- **Deep Multi-File Implementation / Refactoring**: Complex backend logic, type systems, protocol code, or algorithms where sustained focused iteration shines.
- **Long Test-Fix Loops**: Offload verbose multi-round compile/test/debug cycles so massive logs stay isolated in the subagent's thread and do not cause context rot in the lead conversation.
- **Always spell out test timeouts in the prompt** (e.g. `go test -timeout 30s ./...`, `npm test -- --testTimeout=20000`, `pytest --timeout=30`) plus "never start a dev server or interactive watcher in the foreground" — a hung test is the #1 cause of a silent/stalled job.

## 3. Async Doorbell Flow (`asyncBackgroundMode` ON — "后台异步模式 / 边干边聊")

When the user enables **Settings -> 后台异步模式（边干边聊）** (`asyncBackgroundMode: true`), `agent_relay_ask` / `agent_relay_review` calls that **omit `waitSec`** automatically become async (`waitSec = 0`): they return a `jobId` in ~1 second so the chat box unlocks immediately. Every async reply ends with a ready-to-run doorbell line:

```
Doorbell (zero-token background wakeup): node "<distDir>/wait-job.mjs" --data-dir "<dataDir>" <jobId>
```

**Steps for the Lead Agent**

1. Call `agent_relay_ask` (or `agent_relay_review`) **without `waitSec`** and keep the returned `jobId` + doorbell line.
2. Immediately launch that exact doorbell line as a **background command** in your host shell (`WaitMsBeforeAsync=500` so it detaches; it costs **0 tokens** and ~0% CPU — it only stats `<dataDir>/jobs/<jobId>.status.json` every 1.5s).
3. End the turn with `⏳ 后台运行中... 请勿关闭 Antigravity` (the doorbell dies if the host exits).
4. When the doorbell wakes you:
   - **User is idle** -> read `<dataDir>/outputs/<jobId>.txt`, auto-verify (run the tests / `git diff`), and report the result.
   - **User is actively chatting about topic B** -> answer B fully first, then append one line: `🔔 job <jobId> 已完成/失败（<title>），需要我现在复核吗？`
5. Explicit `waitSec > 0` still forces a blocking/check-in wait even in async mode; `agent_relay_poll(jobId=...)` remains the manual fallback.

**Doorbell exit codes** (it always prints a concise 3-line summary per job, never the raw log):

| Code | Meaning | Lead Agent action |
| --- | --- | --- |
| `0` | every watched job `completed` | verify + report |
| `1` | at least one job `error` / `interrupted` | open the job detail, decide resume or take over |
| `2` | a running job silent > `--stall-sec` (default 180s) | poll with `detail="full"`, then steer / interrupt |
| `3` | the MCP process (`pid`) that owned the job exited | treat as crash; offer the resume prompt |

Optional flags: `--stall-sec 180`, `--timeout-sec 3600`. It can watch many jobs at once: `node wait-job.mjs --data-dir "<dataDir>" job_a job_b`.

**Crash recovery**: `<dataDir>/jobs/<jobId>.status.json` is written atomically on start, on `sessionId` arrival, every ~2.5s of activity and immediately on completion. On the next startup any snapshot still `running` under a dead pid is rewritten as `interrupted`, so `getState().interruptedJobs` and the Team panel show an `⚠ 意外中断` banner with a one-click **复制续跑指令** (`继续上次中断的任务（sessionId=<sid>），先检查当前工作区改动再接着完成。`). Resume with that prompt + the original `sessionId`; dismiss the banner via `agent_relay_ui_dismiss_interrupted`.

**Stall Gatekeeper AI is opt-in** (`inspectorEnabled`, default OFF): with it off, diagnosis relies purely on the live timeline, silent-timeout alerts, and doorbell exit codes. When turned on, on silence timeout it reads ONLY the task brief (<=1.2K) + last 30 X-ray lines (never full 200K history) and returns strictly a 2-choice verdict: `CONTINUE` (healthy slow progress — extend timer without waking Lead Agent, up to 3x) or `ALERT` (truly stuck — ring doorbell immediately). It never edits or steers code.

## 4. Non-Interrupting Check-in & Control Protocol

Agent Relay uses zero-token MCP protocol heartbeats during long runs and **never auto-kills** a running subagent. Instead, it triggers non-interrupting check-ins at the user's `silentCheckinMin` (no output/commands/file edits) or `longRunCheckinMin` (periodic check on long tasks):

1. When `agent_relay_ask` or `agent_relay_poll` returns `silent_checkin` or `long_run_checkin`, the subagent is **still running undisturbed**.
2. Review the returned summary (either from the user's configured Inspector Summarizer AI or structured error-prioritized trace).
3. If anything looks suspicious (or errors appear), inspect more deeply **without interrupting** by calling:
   - `agent_relay_poll(jobId="...", waitSec=0, detail="full")` or reading the raw `logPath` file directly;
   - Checking real workspace edits via `git diff` or reading touched files directly.
4. Make your Lead Agent decision:
   - **Progressing cleanly / legitimate deep work** -> continue waiting with `agent_relay_poll(jobId="...")`.
   - **Drifting off-track, repeating `exit!=0` errors, or fighting sandbox walls**:
     - On **Codex**: redirect mid-flight via `agent_relay_session(action="steer", sessionId="...", message="...")`.
     - On **DeepSeek Harness (`dsh`, ACP v1)**: ACP v1 does not support mid-turn steer; call `agent_relay_session(action="interrupt", jobId="...")` and immediately re-call `agent_relay_ask` with the same `sessionId` and a concise corrective delta (retains ~99% Prompt Cache).
   - **Truly wedged / endless error loop** -> stop it cleanly via `agent_relay_session(action="interrupt", jobId="...")` and diagnose/take over.

## 5. Quota Exhaustion & Priority Fallback Handling

- When `autoFallbackOnLimit` is ON, Agent Relay automatically cools down rate-limited models (tracking exact upstream `resetsAt`), fails over to the next AI in the role's priority queue, and automatically restores the primary once its reset window passes.
- If `agent_relay_ask` returns `fallback_confirmation_needed`, ask the user whether to fall back to the next AI in the queue.
- If `agent_relay_ask` returns `[ALL_ENGINES_EXHAUSTED]`, **pause external delegation immediately**, display each model's reset time, and ask the user whether to turn off the Agent Relay switch (so you continue solo), top up/switch keys in the console, or wait for quota reset.

## 6. Prompt Cache & Session Lifecycle

Agent Relay uses an **explicit `sessionId` lifecycle** so unrelated tasks never contaminate each other while multi-turn tasks maintain 95%–99% Prompt Cache hit rates:

1. **New Unrelated Task**: Omit `sessionId` (always starts a clean fresh session — zero cross-task contamination!) and pass a short `title` (e.g. `title="API channel refactor"`). On Turn 1, send goals, constraints, and file pointers rather than raw file dumps.
2. **Follow-Up on the Same Task**: Pass the `sessionId` printed in the previous turn's footer (`sessionId="..."`) with a concise **delta-only prompt** (new errors, answers, or next instruction — never summarize or re-paste earlier turns) to maximize 95%–99% Prompt Cache hit rate!
3. **Resuming a Prior Session Across Conversations**: Call `agent_relay_session(action="status")` to see recent titled sessions and pass the desired `sessionId`.
4. **Context Hygiene**: Monitor `ctx %` in the footer. Near 70%+, compact that session via `agent_relay_session(action="compact", sessionId="...")`.

## 7. Transparent Setup & Model Selection Advisor

When the user asks how to install/configure Codex, Claude Code, Antigravity CLI, DeepSeek Harness (`dsh`), or asks **which models to pick for Oracle vs Hephaestus**:
1. Check live detection status via `agent_relay_console` or `agent_relay_session(action="status")`.
2. **Transparency & User Choice First**:
   - Never silently modify existing external CLI config files (`~/.codex/config.toml`, `~/.dsh/`, `~/.claude/`) and never silently download runtimes or global packages without asking.
   - Always explain clearly what is missing or incompatible, lay out concrete options, and let the user decide whether to run commands themselves or have you run them:
     - **Codex CLI**: `npm install -g @openai/codex` -> `codex login` (live models auto-discovered via `model/list`).
     - **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code` -> `claude`.
     - **Antigravity CLI**: `agy`.
     - **DeepSeek Harness (API Key & OpenAI-compatible Proxy engine)**: `npm install -g @deepseek-ai/dsh@latest` (`@latest` is required because official releases use prerelease tags; Agent Relay syncs `~/.dsh/` read-only and uses `--patch` + `AGENT_RELAY_API_KEY` without mutating `~/.dsh/`).
     - **If `dsh` reports `node_too_old` (`Node < 24.9.0`)**: Explain transparently that `dsh` requires Node.js >= 24.9.0 and offer:
       - *Option A (Recommended)*: Upgrade system Node.js to Node 24 LTS.
       - *Option B (Isolated)*: Install a portable Node 24 runtime into `plugin_data/agent-relay/runtime/node24` (or set `AGENT_RELAY_DSH_NODE`).
   - **API Channels -> Models (Shared by DeepSeek Harness & optional Stall Gatekeeper AI)**:
     - In **Models -> + Add API Channel**, enter the provider/gateway Base URL + API Key (stored in private `secrets.json`), click **Fetch Models** (`GET /models`) to batch-import models, or enter model IDs manually.
3. **Model Pairing Recommendations (when user asks what to pick)**:
   - **Max Quota Saver**: Long-context API/proxy model via `dsh` for both `Oracle` & `Hephaestus` (95%–99% Prompt Cache), with `Codex` as fallback `②`.
   - **Balanced Quality & Cost**: Fast API/proxy model via `dsh` for parallel `Oracle` audits + `Codex` (`medium`/`high`) for `Hephaestus` coding (with `dsh` fallback).
   - **Max Cross-Model Quality**: Pair different model families between `Oracle` (review) and `Hephaestus` (coding), e.g., `Codex` + `Claude Code` or `DeepSeek`.
4. Unready harnesses are intentionally disabled in the **Team** picker and link directly to setup in the **Models** tab. Ask the user to click **Re-scan** after installing, upgrading Node, or logging in.
