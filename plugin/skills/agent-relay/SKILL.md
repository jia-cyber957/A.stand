---
name: agent-relay
description: A.stand multi-agent orchestration manual — read when delegating complex or parallel tasks to external subagents (Oracle read-only advisor/reviewer and Hephaestus workspace-write engineer), deciding what to keep vs. delegate across general or coding workflows, passing host Skill rules safely to subagents, using async doorbell/worktree parallelism, or setting up CLI/API engines.
---

# A.stand Collaboration & Setup Guide

A.stand is a **zero-mutation broker** connecting the lead agent to persistent external AI harnesses (`codex`, `claude-code`, `antigravity`, and `deepseek-harness` via ACP). External CLI configs are never altered — runtime scoping is applied strictly via ephemeral launch arguments and per-process environment variables.

## 1. Check Live User Settings Before Parallel Delegation

Before fanning out parallel tasks or modifying orchestration behavior, call `agent_relay_session(action="status")` to inspect the user's live configuration:
- `limits.maxConcurrency` (default `3`, configurable `1–6`)
- `limits.silentCheckinMin` (default `3m`) & `limits.longRunCheckinMin` (default `10m`)
- `limits.autoFallbackOnLimit`, per-role `queue` and `selectionMode`, model cooldowns, and reported Codex quota windows
- `limits.allowWorktreeParallelWrite` (default `false`)
- `limits.asyncBackgroundMode` (default `false`) and `limits.inspectorEnabled` (default `false`)
- `limits.waitJobScript` — absolute path of the zero-token doorbell script
- `activeJobs` currently running and `interruptedJobs` recovered after a host crash

**Concurrency & Execution Rules**:
- Read-only `oracle` supports parallel subtasks by passing distinct `slot` names (e.g. `slot="backend"`, `slot="frontend"`, `slot="security"`), keeping total active jobs within `limits.maxConcurrency`.
- **True Parallel Launch Pattern (CRITICAL for stdio MCP hosts)**: Because host MCP clients often serialize blocking calls to the same stdio server, whenever launching 2+ parallel `oracle` slots — or 2+ parallel `hephaestus` worktree writers — pass **`waitSec: 0`** on each `agent_relay_ask` (returns `jobId` in ~10ms so all subagents start simultaneously!), then collect all of them together via **`agent_relay_poll(jobIds=["job_...", "job_..."])`** (or one multi-job `wait-job.mjs` doorbell in async mode).
- **Workspace-Write `hephaestus` & Parallel Git Worktrees**:
  - By default (`allowWorktreeParallelWrite: false`) and in non-Git directories, `hephaestus` uses a per-workspace write mutex (1 writer per workspace).
  - When `limits.allowWorktreeParallelWrite` is `true` on a Git repo and a large feature cleanly decomposes into **2–3 non-overlapping file sets** (e.g. backend API vs. frontend UI, or independent modules), **proactively split** the work into parallel `hephaestus` jobs (`waitSec: 0`, `worktree: true`, within `limits.maxConcurrency`) — spell out each job's exact owned files and "do not touch files owned by other parallel jobs" in the prompt so merges stay conflict-free.
  - Keep tightly coupled changes that edit the same files/interfaces in a **single** `hephaestus` job.
  - After parallel worktree jobs finish, inspect each worktree's `git diff` (optionally delegate review to `oracle` / `agent_relay_review` so a stronger reviewer checks a faster coder's diff), commit changes in each retained worktree, merge each `astand/<jobId>` branch into your current branch, run host tests, and clean up with `git worktree remove`.
- **Role, model and reasoning effort**: Choose Oracle for independent investigation or review and Hephaestus for implementation. In smart mode, select a model from that role’s queue. For a normal dispatch, choose the reasoning effort per task when helpful, with enough depth to meet the acceptance criteria.
- **Two-Layer Sandbox Gating (No Privilege Escalation)**:
  - `oracle` is ALWAYS `read-only`.
  - `hephaestus` defaults to `sandbox="workspace-write"`. Only pass `sandbox="danger-full-access"` when `limits.allowHephaestusFullAccess` is `true` AND the task legitimately needs host builds/browsers (the backend hard-blocks escalation if disabled).
  - If `limits.allowHephaestusFullAccess` is `false` and a check-in shows `hephaestus` hitting a Windows sandbox wall on build/browser tests (e.g. `esbuild` parent-dir access or nested browser sandbox), steer it immediately (`action="steer"`) to finish code + `node --check` and run the build/browser test yourself on host, adding one brief closing note that the user can enable "Allow Hephaestus Full Access" in Settings for trusted workspaces.

## 2. Decision Rubric & Skills Handoff (抓大放小 · 保护主上下文)

Act as the user's chief assistant and tech lead: hold the main thread, define overall framing/architecture, review quality, and keep noisy execution loops out of the main conversation. Pause briefly on non-trivial work to decide whether it is a quick direct win or belongs in a scoped subagent:

### Track A — Universal Tasks (Research, Planning, Docs, Analysis)
- **Handle Directly (Lead Agent)**: Simple Q&A, 1–2 step lookups or small rewrites, overall framing/outlines, final synthesis/decisions, and host-native tasks (browser automation, image generation, local host skills).
- **Delegate to `oracle` (Strictly Read-Only, Parallel OK)**: Multi-angle deep research across many files/sources, tradeoff comparisons, or independent critiques/reviews (fan out 2–3 parallel slots and synthesize on the lead thread).
- **Delegate to `hephaestus` (Workspace-Write)**: Heavy multi-file workspace organization, drafting, or iterative verification work.

### Track B — Coding Tasks (Primary Token & Context Consumer)
- **Handle Directly (Lead Agent)**: Architecture/interface planning, slim `docs/` updates, Git/AOCI wrap-up, and clear 1–2 file edits or quick targeted fixes.
- **Delegate to `hephaestus` (Workspace-Write Deep Engineer)**:
  - Coordinated edits across >=3 source/script files, feature implementation, or deep refactors.
  - Long write->compile->test->fix loops so verbose error logs stay isolated in the subagent's thread and never rot the lead context.
  - **Always spell out test timeouts in the prompt** (e.g. `go test -timeout 30s ./...`, `npm test -- --testTimeout=20000`, `pytest --timeout=30`) plus "never start a dev server or interactive watcher in the foreground" — a hung test is the #1 cause of a silent/stalled job.
- **Delegate to `oracle` / `agent_relay_review` (Strictly Read-Only)**:
  - Independent `git diff` review after major edits or parallel worktree merges.
  - High-impact architecture/concurrency/security tradeoffs.
  - **2-Strike Debugging Escalation**: After 2 failed fix attempts on a stubborn bug, stop guessing — send the symptom, ruled-out hypotheses, and exact `file:line` pointers to `oracle`.

### Skills & Persistent Role Guardrails Handoff
- **Containment First**: Subagents do **not** automatically inherit all host Skills (preventing out-of-scope side effects like Git pushes or unrelated scripts).
- **Brief the subagent**: Pass along the symptoms, file pointers, scope and acceptance criteria you already know. Delegate any remaining investigation in the same brief.
- **Persistent Role Rules**: Settings ships with editable rules for both roles, applied on the first turn of a new session. Clearing and saving a role’s rules disables them for that role.
- **Explicit Skill Passing**: When a delegated job genuinely needs to follow a specific host Skill, the Lead Agent should explicitly include that Skill's file path (for read-only reference) or its distilled relevant clauses in the Turn 1 brief, and specify which wrap-up actions remain with the Lead Agent.

## 3. Async Doorbell Flow (`asyncBackgroundMode` ON — "后台异步模式 / 边干边聊")

When the user enables **Settings -> 后台异步模式（边干边聊）** (`asyncBackgroundMode: true`), `agent_relay_ask` / `agent_relay_review` calls that **omit `waitSec`** automatically become async (`waitSec = 0`): they return a `jobId` in ~1 second so the chat box unlocks immediately. Every async reply ends with a ready-to-run doorbell line:

```
Doorbell (zero-token background wakeup): node "<distDir>/wait-job.mjs" --data-dir "<dataDir>" <jobId>
```

**Steps for the Lead Agent**

1. Call `agent_relay_ask` (or `agent_relay_review`) **without `waitSec`** and keep the returned `jobId` and doorbell command. Include the host's actual `conversationId` when available so an outstanding job can be found in that conversation after a restart.
2. Immediately launch that exact doorbell line as a **background daemon command** in your host shell (`IsDaemon: true`, `WaitMsBeforeAsync=500`, without `NotificationTimeoutSeconds` — it costs **0 tokens** and ~0% CPU, only statting `<dataDir>/jobs/<jobId>.status.json` every 1.5s, and still wakes you immediately on exit).
3. While you wait, you can continue independent work or leave the conversation available for the user. The doorbell process is bound to the host. If the host closes, the next session can recover persisted results or interrupted work.
4. When the doorbell wakes you:
   - **Completed** → read the result (including the saved output if referenced), acknowledge receipt, verify the work, and report the outcome. Polling and reading the output are lead-agent actions.
   - **Check-in** → review the elapsed time, time since real activity, and latest useful step. Decide whether to wait, inspect further, steer where supported, or stop. When continuing to wait, run the returned rearm command to start the next interval. You may handle a routine check-in without sending the user a progress message.
5. Explicit `waitSec > 0` still forces a blocking/check-in wait even in async mode; `agent_relay_poll(jobId=...)` remains the manual fallback.

**Doorbell exit codes** (a brief receipt includes a log locator for deeper inspection):

| Code | Meaning | Lead Agent action |
| --- | --- | --- |
| `0` | every watched job `completed` | verify + report |
| `1` | at least one job `error` / `interrupted` | open the job detail, decide resume or take over |
| `2` | a running job silent > `--stall-sec` (default 180s) | poll with `detail="full"`, then steer / interrupt |
| `3` | the MCP process that owned the job exited | recover when the conversation resumes |
| `5` | `long_run_checkin` during continuing execution | review progress and rearm when waiting again |

Optional flags: `--stall-sec 180`, `--timeout-sec 3600`. It can watch many jobs at once: `node wait-job.mjs --data-dir "<dataDir>" job_a job_b`.

**Crash recovery**: A.stand persists job status, session checkpoints, and terminal output. A running snapshot owned by a dead host becomes interrupted on startup. On “继续” or a status request, look up recovery **once** if the thread shows outstanding A.stand work, a relevant restart, or an explicit job reference. Use known `jobId`s or the actual conversation ID together with the original workspace. Skip recovery on regular conversation and new tasks. Acknowledge a completed result after reading it. Receipt is independent of user acceptance. For a matching interrupted job, use `agent_relay_ask(resumeJobId=...)` with the original role and workspace returned by recovery. The checkpoint supplies the original session and model. Ask only when matching is ambiguous or the checkpoint is insufficient. Main-model quota exhaustion can leave workers active while the host is running. After a restart, the persisted checkpoint determines what can continue.

**Stall Gatekeeper AI** (`inspectorEnabled`, default OFF): At the silence threshold, the lead receives a check-in directly if the gatekeeper is disabled. If enabled, the gatekeeper reads a bounded task brief and recent timeline, then gives a short explanation of current progress in the UI language. `CONTINUE` defers the silence alert up to three times per period of silence. `ALERT` wakes the lead. The timeline row expands to show its explanation. The duration check-in has its own timer.

## 4. Non-Interrupting Check-in & Control Protocol

A.stand uses zero-token MCP protocol heartbeats. Check-ins leave the subagent running. Silence check-ins use `silentCheckinMin`. Duration check-ins use `longRunCheckinMin` and can recur while the lead continues waiting.

1. When `agent_relay_ask` or `agent_relay_poll` returns `silent_checkin` or `long_run_checkin`, the subagent is **still running undisturbed**.
2. Review the returned summary (either from the user's configured Inspector Summarizer AI or structured error-prioritized trace).
3. If anything looks suspicious (or errors appear), inspect more deeply **without interrupting** by calling:
   - `agent_relay_poll(jobId="...", waitSec=0, detail="full")` or reading the raw `logPath` file directly;
   - Checking real workspace edits via `git diff` or reading touched files directly.
4. Make your Lead Agent decision:
   - **Progressing cleanly / legitimate deep work** -> continue waiting with `agent_relay_poll(jobId="...")`.
   - **Drifting off-track, repeating `exit!=0` errors, or fighting sandbox walls**:
     - On **Codex**: redirect mid-flight via `agent_relay_session(action="steer", sessionId="...", message="...")`.
     - On **DeepSeek Harness (`dsh`, ACP v1)**: ACP v1 does not support mid-turn steer; request `agent_relay_session(action="interrupt", jobId="...")`, wait for the turn to clear, then call `agent_relay_ask` with the same `sessionId` and a concise corrective delta.
   - **Truly wedged / endless error loop** -> stop it cleanly via `agent_relay_session(action="interrupt", jobId="...")` and diagnose/take over.

## 5. Quota Exhaustion & Model Selection

- `selectionMode: "ordered"` follows the configured role queue. With `"smart"`, the lead can pass a configured `modelId` on a new `ask` or `review`, based on the task and the role’s queue. Use the original model for a continuation. Candidate cooldown and fallback settings still apply.

- When `autoFallbackOnLimit` is ON, A.stand automatically cools down rate-limited models (tracking exact upstream `resetsAt`), fails over to the next AI in the role's priority queue, and automatically restores the primary once its reset window passes.
- If `agent_relay_ask` returns `fallback_confirmation_needed`, ask the user whether to fall back to the next AI in the queue.
- If `agent_relay_ask` returns `[ALL_ENGINES_EXHAUSTED]`, **pause external delegation immediately**, display each model's reset time, and ask the user whether to turn off the A.stand switch (so you continue solo), top up/switch keys in the console, or wait for quota reset.

## 6. Context Isolation First & Session Lifecycle

A.stand uses an **explicit `sessionId` lifecycle** where **clean task isolation always takes priority over Prompt Cache hit rate**:

1. **New or Unrelated Task (Omit `sessionId`)**: Whenever switching to a different task, different module, different problem type, or running an independent review, **always omit `sessionId`**. A.stand guarantees a brand-new, uncontaminated subagent session (never auto-reuses old sessions). Pass a short `title` (e.g. `title="API channel refactor"`). On Turn 1, send goals, constraints, and file pointers rather than raw file dumps.
2. **Follow-Up on the Exact Same Task (Pass `sessionId`)**: Only when continuing, iterating, or fixing review feedback on the **same ongoing task**, pass the `sessionId` printed in the previous turn's footer (`sessionId="..."`) with a concise **delta-only prompt** (new errors, answers, or next instruction — never summarize or re-paste earlier turns) to get 95%–99% Prompt Cache hit rate.
3. **Resuming After a Restart or Model Switch**: Use the scoped recovery procedure above when the conversation indicates a prior unfinished handoff. Use `status` for a requested configuration or overall status view.
4. **Context Hygiene**: Monitor `ctx %` in the footer. Near 70%+, compact that session via `agent_relay_session(action="compact", sessionId="...")` or start fresh for the next subtask.

## 7. Transparent Setup & Model Selection Advisor

When the user asks how to install/configure Codex, Claude Code, Antigravity CLI, DeepSeek Harness (`dsh`), or asks **which models to pick for Oracle vs Hephaestus**:
1. Check live detection status via `agent_relay_console` or `agent_relay_session(action="status")`.
2. **Transparency & User Choice First**:
   - Never silently modify existing external CLI config files (`~/.codex/config.toml`, `~/.dsh/`, `~/.claude/`) and never silently download runtimes or global packages without asking.
   - Always explain clearly what is missing or incompatible, lay out concrete options, and let the user decide whether to run commands themselves or have you run them:
     - **Codex CLI**: `npm install -g @openai/codex` -> `codex login` (live models auto-discovered via `model/list`).
     - **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code` -> `claude`.
     - **Antigravity CLI**: `agy`.
     - **DeepSeek Harness (API Key & OpenAI-compatible Proxy engine)**: `npm install -g @deepseek-ai/dsh@latest` (`@latest` is required because official releases use prerelease tags; A.stand syncs `~/.dsh/` read-only and uses `--patch` + `AGENT_RELAY_API_KEY` without mutating `~/.dsh/`).
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
