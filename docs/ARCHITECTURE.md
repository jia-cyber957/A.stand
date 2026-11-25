# A.stand Architecture

This document describes how A.stand is built: the moving parts, why they are separated the way they are, how data and processes flow between them, and the rules each layer must uphold. It is the canonical reference for contributors and for AI agents that need to extend or debug the system.

- [1. What A.stand Is](#1-what-astand-is)
- [2. High-Level Architecture](#2-high-level-architecture)
- [3. Repository Layout](#3-repository-layout)
- [4. Request Lifecycle](#4-request-lifecycle)
- [5. Engine Adapters](#5-engine-adapters)
- [6. Sessions, Jobs & Prompt Cache](#6-sessions-jobs--prompt-cache)
- [7. Async Doorbell & Stall Gatekeeper](#7-async-doorbell--stall-gatekeeper)
- [8. Data & Secrets Model](#8-data--secrets-model)
- [9. Sandbox & Safety Boundaries](#9-sandbox--safety-boundaries)
- [10. Git Worktree Isolation](#10-git-worktree-isolation)
- [11. Build, Install & Test](#11-build-install--test)
- [12. Extending A.stand](#12-extending-astand)

---

## 1. What A.stand Is

A.stand is an **MCP server packaged as an Antigravity plugin** that brokers work between three parties:

| Party | Responsibility | Typical cost profile |
| :--- | :--- | :--- |
| **Lead Agent** (e.g. Antigravity) | Architecture, task decomposition, final verification, user conversation | Expensive in tokens and attention; must stay clean |
| **`Oracle`** (`白泽` in Chinese UI copy) | Read-only advisor: codebase research, architecture trade-offs, debugging hypotheses, independent code review | Cheapest when run in parallel on long-context models |
| **`Hephaestus`** (`祝融` in Chinese UI copy) | Workspace-write engineer: multi-file implementation, refactors, test-fix loops | Coder-grade model quality required |

The central design goal: **keep the Lead Agent's context small and coherent**. A subagent may read dozens of files and accumulate 200K+ tokens of tool output, but the Lead Agent only ever receives a concise final report (capped inline; the full transcript is always persisted to `outputs/<jobId>.txt`).

The second design goal: **zero mutation**. A.stand must never alter the configuration or state of the external CLIs it drives. See [§9](#9-sandbox--safety-boundaries).

---

## 2. High-Level Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                Antigravity Lead Agent (host model)           │
│  tools: agent_relay_ask / _poll / _review / _session / _cfg  │
└───────────────────────────────┬──────────────────────────────┘
                                │ MCP (stdio JSON-RPC)
┌───────────────────────────────▼──────────────────────────────┐
│                    A.stand MCP server (dist/server.mjs)      │
│                                                              │
│  ┌────────────────────┐   ┌───────────────────────────────┐  │
│  │ Side-panel console │   │ Core broker                   │  │
│  │ (console.html +    │   │  · hard switch / admission    │  │
│  │  app.js snapshot)  │   │  · priority queues & cooldown │  │
│  │ Team · Models ·    │   │  · sessions & job lifecycle   │  │
│  │ Cache · Settings   │   │  · doorbell + gatekeeper      │  │
│  └────────────────────┘   │  · crash recovery             │  │
│                           └───────────────┬───────────────┘  │
│  ┌────────────────────────────────────────▼───────────────┐  │
│  │ Engine adapters (one file per engine)                  │  │
│  │  codex.mjs │ acp.mjs │ claude-code.mjs │ antigravity.mjs│ │
│  └──────┬─────────┬──────────────┬──────────────┬─────────┘  │
└─────────┼─────────┼──────────────┼──────────────┼────────────┘
          │         │              │              │
   codex app-server │  dsh --profile acp   claude -p     agy -p
       (JSON-RPC)   │  (ACP over stdio)  (stream-json)  (headless)
                    ▼
        ~/.codex/config.toml  … read-only, never written by A.stand
```

The plugin manifest (`plugin/plugin.json`) and MCP configuration (`plugin/mcp_config.json`) are portable: `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are resolved by the host, so the same artifact installs into any Antigravity profile.

### 2.1 MCP tool surface

Only **five tools are visible to the host model**; everything else is UI-only (`visibility: ["app"]`) so it cannot consume the Lead Agent's context.

| Tool | Purpose |
| :--- | :--- |
| `agent_relay_ask` | Delegate a task to `oracle` (read-only, parallel slots) or `hephaestus` (workspace-write, write mutex or worktree). Honors master switch, concurrency cap, and priority fallback. |
| `agent_relay_poll` | Inspect or wait on one (`jobId`) or many (`jobIds`) running jobs without interrupting them. |
| `agent_relay_review` | Run an adversarial read-only review over uncommitted changes, a branch diff, a commit, or a custom scope. |
| `agent_relay_session` | Read live status/limits (`action="status"`) or control a session (`compact`, `fork`, `steer`, `interrupt`, `reset`). |
| `agent_relay_configure` | Codex-host only: read or patch settings when the interactive panel is unavailable. |

The console itself is exposed as an MCP App resource plus the app-only `agent_relay_console` entrypoint (aux pane + global view).

---

## 3. Repository Layout

```text
A.stand/
├── plugin/
│   ├── plugin.json                  # Antigravity plugin manifest
│   ├── mcp_config.json              # Portable MCP stdio config (${PLUGIN_ROOT} / ${PLUGIN_DATA})
│   ├── assets/logo.{svg,png}        # Plugin icon
│   ├── rules/AGENTS.md              # Host-agnostic delegation gate (always loaded)
│   └── skills/agent-relay/SKILL.md  # Detailed orchestration, doorbell & model-selection guide
├── src/
│   ├── server.mjs                   # MCP server: tool registration + app-only UI tools
│   ├── core/
│   │   ├── constants.mjs            # Provider presets, CLI engine metadata, role specs, defaults
│   │   ├── paths.mjs                # CLI detection (codex, dsh, claude, agy), Node >= 24.9 check
│   │   ├── store.mjs                # Atomic JSON persistence (settings, secrets, sessions, cooldowns)
│   │   ├── orchestrator.mjs         # Job lifecycle, admission, sessions, gatekeeper, crash recovery
│   │   ├── worktree.mjs             # Git detection + worktree create/finalize
│   │   └── telemetry.mjs            # Usage normalization + Prompt Cache JSONL ledger
│   ├── engines/
│   │   ├── base.mjs                 # Shared role prompts, activity helpers, process utilities
│   │   ├── codex.mjs                # Codex app-server adapter
│   │   ├── acp.mjs                  # DeepSeek Harness / ACP adapter
│   │   ├── claude-code.mjs          # Claude Code stream-json adapter
│   │   └── antigravity.mjs          # Antigravity CLI (agy) adapter
│   └── ui/
│       ├── template.html            # Single-file strict-CSP shell
│       ├── app.js                   # Side-panel console (Team, Models/Channels, Cache, Settings)
│       └── styles.css               # Dark/light adaptive styling + timeline
├── scripts/
│   ├── build.mjs                    # esbuild bundle -> dist/server.mjs, dist/console.html, dist/wait-job.mjs
│   ├── install-antigravity.mjs      # Build & deploy into the Antigravity plugins directory
│   ├── uninstall-antigravity.mjs    # Clean plugin removal
│   ├── check-contracts.mjs          # Local engine detection & Codex protocol contract check
│   ├── wait-job.mjs                 # Zero-token, ~0% CPU background doorbell
│   └── e2e-test.mjs                 # Full 9-section E2E suite (incl. strict-CSP headless browser check)
├── docs/
│   ├── ARCHITECTURE.md              # This document
│   └── screenshots/                 # Console screenshots used by the READMEs
├── .github/workflows/ci.yml         # Build + E2E on Node 24
├── AGENT_INSTALL.md                 # Executable install/engine/model guide for AI agents
├── README.md / README.zh-CN.md      # Human-facing docs (English / 中文)
├── SECURITY.md                      # Security policy & private disclosure
├── UPGRADING_ENGINES.md             # Adapting to upstream CLI changes
├── llms.txt                         # Machine-readable project map for AI crawlers
└── LICENSE                          # Apache License 2.0
```

---

## 4. Request Lifecycle

```text
Lead Agent                         Orchestrator                      Engine adapter
    │ agent_relay_ask(role, cwd, prompt, sessionId?, waitSec?, worktree?)
    ├──────────────────────────────▶│
    │                               │ 1. master switch gate (hard block if OFF)
    │                               │ 2. resolve effective sandbox by role
    │                               │ 3. admission: concurrency cap + write mutex / worktree
    │                               │ 4. resolve model from the role's priority queue
    │                               │ 5. open or resume session (sessionId semantics)
    │                               ├───────────────────────────────▶│ spawn CLI / JSON-RPC session
    │                               │◀──── activity / usage events ──┤
    │                               │ 6. normalize usage -> telemetry.jsonl
    │                               │ 7. persist events + status snapshot atomically
    │◀── final report + sessionId ──┤ 8. finalize worktree, update job status
```

### 4.1 Admission rules

1. **Master switch** — checked first, inside the MCP server. OFF ⇒ the call returns a blocked result and no external process is ever spawned.
2. **Concurrency cap** — `maxConcurrency` (default 3, allowed range 1–6) bounds all running jobs across engines.
3. **Role sandbox** — `oracle` is forced to `read-only`; `hephaestus` is `workspace-write` unless full access was explicitly enabled.
4. **Writers** — a per-workspace (and per-repo) mutex serializes `hephaestus` jobs. With worktree parallelism enabled, a busy Git checkout admits an additional writer in an isolated worktree instead of queueing.
5. **Priority queues** — each role has an ordered model list. A model in cooldown (e.g. Codex quota exhausted) is skipped and automatically restored when its window resets; if every model is exhausted the call returns a confirmation-required result instead of silently degrading.

### 4.2 Blocking vs. async

- `waitSec` omitted or `> 0` ⇒ blocking wait capped at 120 s per call with zero-token heartbeats; long jobs continue and are reported through non-interrupting check-ins (`silent_checkin`, `long_run_checkin`, `running_checkin`). A.stand never auto-kills a healthy job.
- `waitSec: 0` ⇒ fire-and-return; parallel `oracle` slots are collected in a single `agent_relay_poll(jobIds=[...])`.
- With **async background mode** enabled and `waitSec` omitted, the reply includes a ready-to-run doorbell command (see [§7](#7-async-doorbell--stall-gatekeeper)).

---

## 5. Engine Adapters

Every external harness lives behind **one adapter file**; the broker, UI, persistence, and telemetry layers are engine-agnostic. Upstream CLI changes therefore stay contained to a single file (see [UPGRADING_ENGINES.md](../UPGRADING_ENGINES.md)).

| Engine | Adapter | Transport | Maturity |
| :--- | :--- | :--- | :--- |
| OpenAI Codex CLI | `src/engines/codex.mjs` | native `codex app-server` JSON-RPC over stdio | Full native support |
| DeepSeek Harness (`dsh`) | `src/engines/acp.mjs` | Agent Client Protocol (`dsh --profile acp`) over stdio | Full native support |
| Anthropic Claude Code | `src/engines/claude-code.mjs` | `claude -p --output-format stream-json --resume` | Standard support |
| Google Antigravity CLI | `src/engines/antigravity.mjs` | `agy -p` headless one-shot | Experimental / basic |

### 5.1 Codex (`codex.mjs`)

- Drives `codex app-server` directly, so it receives structured item deltas (agent messages, reasoning summaries, command output) rather than parsing a text log.
- Emits normalized timeline events: thought blocks, `analyzed` file ranges, `edited` diffs with `+added/-removed` counts, command executions with status and exit code.
- Parses rate-limit snapshots into live **5 h / 7 d quota** windows with reset timestamps, shown in the console and used by the priority queue.
- Supports **mid-turn steering** (`turn/steer` with an `expectedTurnId`), exposed through `agent_relay_session(action="steer")`.
- Reads `CODEX_HOME`/`~/.codex` only to detect login state and available models; it never writes there.

### 5.2 DeepSeek Harness / ACP (`acp.mjs`)

- Implements the standard ACP client handshake, session creation, prompt turns, and `session/update` notification handling.
- **Structured X-ray timeline**: ACP `tool_call` payloads are condensed into one-line human summaries — shell tools become `title: command`, file tools become `title path L{start}-{end}`, search tools become `title "pattern" in path` — and merged in place by event `id`.
- **Real Prompt Cache**: reads upstream usage counters, including reading `<dshHome>/sessions/**/<sid>/session.v4.jsonl.zstd` with Node 24's built-in zstd support (with a short flush wait) to recover exact `cacheReadTokens`.
- **Two-level API channels**: a channel (Base URL + API key) owns models. For channel models the adapter writes an overlay profile **inside the plugin data directory** (`<PLUGIN_DATA>/dsh-profiles/<channel>/agent-relay-overlay.yml`), passes `--patch <overlay>`, and sets `DSH_HOME` and the API key through per-process environment variables only. The user's `~/.dsh/*` is read for detection but never modified.
- ACP v1 enforces one in-flight prompt per session, so there is no native mid-turn steer: redirecting a wedged job means `interrupt` followed by re-asking with the same `sessionId`, which preserves the cache.
- Requires **Node.js >= 24.9.0**; A.stand can use a portable Node 24 runtime instead of changing the system Node (see `AGENT_INSTALL.md`).

### 5.3 Claude Code (`claude-code.mjs`)

- Runs `claude -p --output-format stream-json --resume <sessionId>` and maps stream events to usage telemetry.
- Anthropic reports `input_tokens` **excluding** cache reads/writes, so the adapter reconstructs total input as `input + cache_read + cache_creation` before computing hit rate (see [§6.3](#63-usage-normalization)).

### 5.4 Antigravity CLI (`antigravity.mjs`)

- Headless one-shot delegation via `agy -p` with optional `--resume` and `--model`.
- Produces plain text output: no structured timeline, no upstream cache counters. Treated as experimental.
- Never writes `~/.gemini/antigravity-cli/*`.

---

## 6. Sessions, Jobs & Prompt Cache

### 6.1 Explicit session lifecycle

| Situation | Behavior |
| :--- | :--- |
| `sessionId` omitted | A **clean new session** is created. Unrelated tasks never share context. |
| `sessionId` provided | The same session is resumed, preserving context **and** the upstream prompt cache, across A.stand restarts. |

Every reply footer carries the `sessionId`, so a follow-up is just the same call with a delta-only prompt plus that id. The UI distinguishes "new task" from "follow-up" so the model matches.

### 6.2 Job artifacts

All state lives under the plugin data directory (`<PLUGIN_DATA>`, passed to the server as `--data-dir`):

```text
<PLUGIN_DATA>/
├── settings.json          # settings, model/channel definitions, priority queues
├── secrets.json           # API keys only (0600, atomic write)
├── sessions.json          # session records (role, engine, model, timestamps, retention)
├── cooldowns.json         # per-model cooldown & reset bookkeeping
├── telemetry.jsonl        # one JSON line per reported turn (real upstream counters)
├── jobs/
│   ├── <jobId>.status.json    # atomic snapshot: pid, sessionId, status, lastSummary
│   ├── <jobId>.events.json    # structured timeline events
│   └── <jobId>.log            # raw turn transcript
├── outputs/<jobId>.txt        # full final transcript (when the inline report is capped)
├── worktrees/<jobId>/         # retained Git worktrees (see §10)
└── dsh-profiles/<channel>/agent-relay-overlay.yml
```

Writes are atomic (temp file + rename). `retentionDays` (default 30) prunes expired sessions and job artifacts.

### 6.3 Usage normalization

`normalizeUsage()` in `telemetry.mjs` converts each engine's native usage shape into one schema and **never fabricates numbers**: if upstream did not report cache counters, the field is `null` and the UI shows `N/A` rather than an estimate.

- **OpenAI / Codex / DeepSeek / ACP**: `inputTokens` already includes cached input. `hitRate = cached / input`.
- **Anthropic / Claude Code**: `input_tokens` excludes cache read and creation. `totalInput = input + cache_read + cache_creation`, then `hitRate = cache_read / totalInput`.
- Context utilization (`contextPct`) is computed only when the engine reports a context window.

`TelemetryLogger` appends one JSONL row per turn and derives a summary: cumulative hit rate, last hit rate, token totals, latest context usage, and the last 20 chart points. In practice, long tool-loop sessions against Codex and DeepSeek reach 95%–99.8% hit rates, which is the main reason offloading is cheaper than doing the work inline.

### 6.4 Crash recovery

Job snapshots are written atomically and include the owning `pid`. On startup, snapshots still marked `running` whose owning process has exited are promoted to `interrupted`. The Team panel shows an `⚠ Interrupted` banner with **Copy Resume Prompt**, which carries the same `sessionId` so the task resumes with its cache intact rather than from scratch.

---

## 7. Async Doorbell & Stall Gatekeeper

Both features are **off by default** for predictable synchronous behavior.

### 7.1 Async background mode + doorbell

When `asyncBackgroundMode` is ON and `waitSec` is omitted:

1. `agent_relay_ask` returns in about a second with the job id and a ready-to-run doorbell command:
   ```bash
   node dist/wait-job.mjs --data-dir <PLUGIN_DATA> --stall-sec 180 <jobId>
   ```
2. The Lead Agent runs that command as a host background command. The chat is unlocked immediately and the Lead Agent spends **zero polling tokens** while the subagent works.
3. `wait-job.mjs` is a zero-dependency script that reads `<dataDir>/jobs/<jobId>.status.json` every 1.5 s (polls exit codes):

   | Exit | Meaning |
   | :--- | :--- |
   | `0` | Every watched job completed |
   | `1` | At least one job errored or was interrupted (including host crash) |
   | `2` | A running job exceeded `--stall-sec` of silence |
   | `3` | The MCP process that owned a running job exited |
   | `4` | Bad usage, or no status file appeared within the grace period |
   | `5` | The continuing job reached its duration check-in interval |

4. On exit, the host wakes the Lead Agent with a concise summary — never the raw log. If the user is chatting about something else, the Lead Agent answers that first and appends a one-line notice.

A waiter can watch one job or a group. Grouped completion waits for every watched job to finish. After a duration check-in, the lead may continue waiting by running the printed rearm command. The waiter starts the next interval and retains the original list of job IDs.

### 7.2 Stall gatekeeper AI

When `inspectorEnabled` is ON and a job goes silent beyond the timeout, the gatekeeper reads **only** the task summary (≤ ~1.2K chars) and the last ~30 X-ray lines — never the full history — and returns exactly one verdict:

- `VERDICT: CONTINUE` — the job is merely slow (e.g. a long build); the silence timer is extended up to three times without waking the Lead Agent.
- `VERDICT: ALERT` — the job is genuinely stuck; the doorbell exits with code `2`.

The gatekeeper records a short description of the latest activity in the selected UI language. Its verdict expands in the timeline. Real progress clears deferrals. When the gatekeeper is enabled, the broker sets the silence alert after its verdict.

### 7.3 Restart handoff

For a continuation with evidence of outstanding work, `recover` checks recent disk snapshots by known job IDs or by the original workspace and conversation ID. A completed result stays unread until the lead reads and acknowledges it. An interrupted job supplies `resumeJobId` for the original session, model, and effective worktree. Regular turns use no recovery lookup.

---

## 8. Data & Secrets Model

- **Two-level channels**: a *channel* (provider, Base URL, API key) owns *models*. Clicking **Fetch Models** issues `GET /models` against the channel and batch-imports the result. Reserved id prefixes (`dsh:`, `cli:`) are rejected for user-defined ids.
- **Secret isolation**: API keys are stored only in `secrets.json`, written atomically with mode `0600`. They never appear in `settings.json`, job logs, telemetry rows, or the UI payload — the UI only receives masked strings (`maskSecret`).
- **Origin-change re-entry**: changing a channel's Base URL to a different origin requires re-entering the key. A stored key is never replayed against a new endpoint.
- Keys reach child processes only through per-process environment variables; nothing is persisted into external CLI configuration.
- A corrupted `secrets.json` fails closed: the server refuses to start and asks you to restore a readable file rather than silently discarding keys.

Full threat model and disclosure process: [SECURITY.md](../SECURITY.md).

---

## 9. Sandbox & Safety Boundaries

A.stand enforces six independent layers:

1. **Zero-mutation guarantee** — `~/.codex/config.toml`, `~/.dsh/` configs, `~/.claude/` configs, and `~/.gemini/antigravity-cli/settings.json` are never modified by A.stand (upstream CLIs still manage their own normal session logs). Isolation uses ephemeral env vars, ephemeral CLI flags, and overlay files inside the plugin data directory.
2. **Master hard switch** — enforced inside the MCP server, not in the UI. OFF blocks all new subagent delegation (`ask` / `review`); manual UI checks (Test Connection, Fetch Models, Codex status) remain available when clicked.
3. **Read-only `Oracle`** — not configurable to a higher privilege level; enforced natively on Codex (`read-only`), fail-closed permission denial on ACP (`dsh`), read-only tool allowlist on Claude Code, and prompt-level only on experimental `agy`.
4. **Workspace-write `Hephaestus`** — serialized by a per-workspace write mutex by default (with native `workspace-write` sandbox on Codex; `danger-full-access` exists only behind an explicit, default-off setting).
5. **Secret isolation** — see [§8](#8-data--secrets-model).
6. **Worktree boundary** — optional parallel writers get isolated Git checkouts/branches (not OS containers), see [§10](#10-git-worktree-isolation).

Practical note for contributors: when `Hephaestus` runs against A.stand's own repository inside a `workspace-write` sandbox on Windows, some toolchains (piped `esbuild` spawns, headless browser tests, writes into the host plugin directory) are blocked by the sandbox. Finish code changes and syntax checks inside the subagent, then run `npm run install:antigravity` and `npm run test:e2e` on the host.

---

## 10. Git Worktree Isolation

**Status: implemented, opt-in** (`allowWorktreeParallelWrite`, default `false`).

### 10.1 Default behavior

- `oracle` jobs run in parallel slots bounded by `maxConcurrency`.
- `hephaestus` jobs take a per-workspace write mutex, keyed by the normalized workspace path (and by repository root when the target is inside a Git checkout, so two directories of the same repo cannot race).

### 10.2 Parallel writer behavior

When the setting is ON and the target is a Git checkout with an existing commit:

1. A second concurrent writer for a busy checkout gets its own worktree instead of queueing. A job can also request this explicitly with `worktree: true`.
2. The worktree is created from `HEAD` at `<dataDir>/worktrees/<jobId>` on branch `astand/<jobId>`.
3. If the requested `cwd` is a subdirectory of the repository, that relative subdirectory is recreated inside the worktree (Git does not materialize empty or untracked directories) and becomes the job's working directory.
4. Non-Git directories always fall back to the mutex.

### 10.3 Finalization

- A worktree that finishes with **no local changes and no new commits** is removed automatically and its branch is deleted.
- A worktree with changes is **retained**. To integrate it from the source checkout:

  ```bash
  cd "<source-checkout>"
  git -C "<worktreePath>" add -A && git -C "<worktreePath>" commit -m "<message>"
  git merge astand/<jobId>
  git worktree remove "<worktreePath>"
  ```

- Session follow-ups for a retained worktree must use that worktree's working directory as `cwd`.
- Because worktrees share the machine, tests inside them must use ephemeral resources — bind `port: 0` rather than fixed ports.

---

## 11. Build, Install & Test

```bash
npm ci                          # deterministic install (used by CI)
npm run build                   # esbuild bundle -> dist/server.mjs, dist/console.html, dist/wait-job.mjs
npm run install:antigravity     # build + deploy into the Antigravity plugins directory
npm run check:contracts         # detect local engines & verify the Codex protocol contract
npm run test:e2e                # full 9-section E2E suite incl. strict-CSP headless browser checks
npm run uninstall:antigravity   # clean removal; external CLI configs untouched
```

The E2E suite covers: console syntax and MCP stdio handshake; the master hard switch; legacy migration, channel CRUD, and secret isolation; settings, quotas, and cooldown/exhaustion pausing; Codex persistence and cross-restart cache; MCP restart and cross-restart cache verification; X-ray tool summarization and the zero-token doorbell; status snapshots, `outputs/*.txt`, and opt-in settings; and startup crash recovery.

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run build`, and `npm run test:e2e` on `ubuntu-latest` with Node 24, setting `AGENT_RELAY_E2E_NO_BROWSER_SANDBOX=1` so the headless browser check works inside the CI container.

> Antigravity hot-reloads `dist/console.html` when the side panel is reopened, but backend changes in `dist/server.mjs` require restarting Antigravity.

---

## 12. Extending A.stand

### 12.1 Adding or fixing an engine adapter

1. Each engine is exactly one file under `src/engines/` implementing the same turn interface (spawn/resume, activity callbacks, usage reporting, session id discovery).
2. Reuse `src/engines/base.mjs` for role prompts, activity helpers, process teardown, and UTF-8 environment handling.
3. Report usage through `normalizeUsage()`; never invent counters.
4. Call `npm run check:contracts`, then `npm run build` and `npm run test:e2e`. For Codex, the authoritative schema can be exported locally:
   ```bash
   codex app-server generate-json-schema --out ./tmp-schema
   ```
5. Update only the affected adapter, the engine metadata in `src/core/constants.mjs`, and the maturity table in the READMEs.

### 12.2 Design invariants

Any change must preserve:

- **Zero mutation** of external CLI configuration.
- **Read-only `Oracle`** and a write mutex for `Hephaestus` unless explicitly overridden.
- **Explicit session semantics** — no implicit context bleed between unrelated tasks.
- **Honest telemetry** — `null`/`N/A` instead of fabricated cache numbers.
- **Bounded Lead context** — new tools that return large payloads must be UI-only (`visibility: ["app"]`).
- **Atomic persistence** for any file the UI or the doorbell reads concurrently.

### 12.3 Roadmap direction

1. **Public release hygiene** — documentation, security policy, CI, and machine-readable discovery files (this repository state).
2. **Standalone portable runtime (v2 vision)** — decouple the MCP core into a local daemon (HTTP MCP + lightweight WebView2/Tauri tray UI) with a **Hosts** tab for one-click install into Antigravity, Codex CLI, Claude Code, and Cursor, plus **per-host routing / anti-self-recursion** (e.g. a Codex host skips Codex and delegates to DeepSeek, Claude, or Gemini) so closing an IDE no longer kills running subagents.
