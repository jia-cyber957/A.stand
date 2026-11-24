<p align="center">
  <img src="./plugin/assets/logo.png?v=2" width="112" alt="A.stand" />
</p>

<h1 align="center">A.stand</h1>

<p align="center">
  <strong>Zero-mutation multi-AI persistent subagent broker for Antigravity.</strong><br/>
  <a href="./README.zh-CN.md">中文说明</a> · <a href="./AGENT_INSTALL.md">🤖 AI Agent Install &amp; Setup Guide (<code>AGENT_INSTALL.md</code>)</a> · <a href="./docs/ARCHITECTURE.md">Architecture</a> · <a href="./SECURITY.md">Security</a>
</p>

<p align="center">
  <a href="https://github.com/jia-cyber957/A.stand/actions/workflows/ci.yml"><img src="https://github.com/jia-cyber957/A.stand/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node >= 20" />
</p>

> **🤖 Fastest way to install — let your AI Agent do it for you!**
> Just paste this prompt into **Antigravity**:
> ```text
> Please read AGENT_INSTALL.md in https://github.com/jia-cyber957/A.stand, install A.stand into my Antigravity, and walk me through connecting my preferred AI models.
> ```

A.stand lets your Antigravity Lead Agent stay focused on architecture, planning, and final verification while delegating heavy multi-file implementation (**Hephaestus**) and parallel read-only research/review (**Oracle**) to native external AI harnesses (**OpenAI Codex CLI**, **DeepSeek Harness / OpenAI-compatible APIs & proxies**, **Claude Code**, and **Antigravity CLI**) — with a clean bilingual side-panel console and real upstream Prompt Cache telemetry.

---

## Screenshots

### Team panel — live subagent timeline & Prompt Cache

![A.stand Team panel: live subagent jobs with the collapsible X-ray timeline and real Prompt Cache hit rates](./docs/screenshots/console-team-en.png)

### Cache analytics — cumulative hit rate from real upstream billing counters

![A.stand Cache panel: cumulative Prompt Cache hit rate, input/cached/output token totals and recent turn chart](./docs/screenshots/console-cache-en.png)

---

## Why A.stand? (7 Core Highlights)

1. **Real Lead-Quota Savings — Never Floods Your Main Chat**
   - Subagents read dozens of files, edit code, and loop through builds/tests inside their own isolated context (even 200K+ tokens).
   - Your Lead Agent receives **only the concise final report** (1–3K chars), keeping your main conversation crisp and dramatically reducing Lead model token usage.

2. **95%–99.8% Real Upstream Prompt Cache + Explicit Session Lifecycle**
   - Every new unrelated task starts a clean fresh session (zero cross-task bleed).
   - Follow-ups on the same task pass the explicit `sessionId` to resume context and Prompt Cache across restarts (real billing counters from Codex, DeepSeek, Anthropic, and `dsh` zstd session logs — never guessed).

3. **Antigravity-Native Collapsible Conversation Timeline**
   - Click any running or finished job in the side panel to view a calm, borderless, Antigravity-style timeline:
     - Collapsible **Message from Lead Agent**
     - **`Thought for 8s ›`** (expandable reasoning block)
     - **`Analyzed gateway.go #L315-455`** / **`Edited gate.go +13 -4`** / **`Searched "pattern"`**
     - **`Ran go test ./... · Exited with code 1 ›`** (expandable scrollable terminal output)
     - Clean **Markdown Final Response** at the bottom, preserving expanded blocks across live 2s refreshes.

4. **Opt-in Async Background Mode ("Chat While It Works") + Zero-Token Doorbell**
   - Disabled by default for predictable synchronous runs; toggle ON in **Settings → Async Background Mode**.
   - When ON, dispatching a subagent unlocks your chat box in ~1 second and attaches a zero-dependency Node doorbell (`wait-job.mjs`, **0 AI tokens**, ~0% CPU).
   - **0 Lead Agent polling turns** while the subagent works for 5–20 minutes — when it finishes, stalls, or errors, the doorbell automatically wakes the Lead Agent with a 3-line summary (and never interrupts if you're chatting about another topic).

5. **Opt-in 2-Choice Stall Gatekeeper AI + Crash Recovery**
   - Optional **Stall Gatekeeper AI** (default OFF): on silence timeout, reads only the task brief + last 30 X-ray lines (never 200K full history) and strictly returns `CONTINUE` (slow build still healthy, don't wake Lead) or `ALERT` (truly stuck, wake Lead) — never edits or steers code.
   - **Accidental-Close Recovery**: job state & `sessionId` persist atomically to disk; if Antigravity closes mid-run, restarting displays an **`⚠ Interrupted`** banner with one-click **Copy Resume Prompt**.

6. **Zero-Mutation Purity & Hard Safety Guardrails**
   - **Never modifies** your external CLI configs (`~/.codex/config.toml`, `~/.dsh/` configs, `~/.claude/` configs, or `~/.gemini/antigravity-cli/settings.json`).
   - **Master Hard Switch**: OFF = hard-blocks all new subagent delegation inside the MCP server.
   - **Secret Isolation**: API keys live solely in private `secrets.json` (cross-origin endpoint edits require re-entering the key).
   - **Per-Engine Sandbox & Worktree Isolation**: `Oracle` is read-only (native sandbox on Codex, fail-closed permission denial on ACP, read-only tool allowlist on Claude Code, prompt-level on experimental `agy`). `Hephaestus` uses a per-workspace write mutex by default (plus native `workspace-write` on Codex); settings can enable opt-in Git worktree checkouts or full access.
   - Full details: [SECURITY.md](./SECURITY.md).

7. **Two-Level API Channels, Live Codex Quotas & Automatic Failover**
   - Add an OpenAI-compatible API Channel once (DeepSeek, OpenRouter, self-hosted gateway, etc.) and click **Fetch Models** (`GET /models`) to batch-import models.
   - Live **Codex 5h / 7d quota tracking**, per-role ordered priority queues with cooldown/auto-restore, bilingual Chinese/English UI, and a 9-section automated E2E test suite (including headless strict-CSP browser checks).

---

## Engine Support Matrix

Honest, per-engine maturity — what actually works today:

| Engine | Maturity | What you get |
| :--- | :--- | :--- |
| **OpenAI Codex CLI** (`codex app-server`) | ✅ **Full Native Support** | Structured X-ray timeline · Real Prompt Cache · Live 5h / 7d quota · Mid-turn steer |
| **DeepSeek Harness** (`dsh` / ACP) — *DeepSeek, Gemini 4 & OpenAI-compatible APIs / proxies* | ✅ **Full Native Support** | Structured X-ray timeline · Real Prompt Cache · Two-level API channels & **Fetch Models** |
| **Anthropic Claude Code CLI** (`claude stream-json`) | 🟦 **Standard Support** | `stream-json` events · Session resume · Prompt Cache telemetry |
| **Google Antigravity CLI** (`agy` / Gemini 4) | 🟨 **Experimental / Basic** | Headless CLI delegation · Basic text output (no X-ray timeline or upstream cache counters yet) |

> Only the first two engines expose the full structured timeline and upstream cache counters. Claude Code and Antigravity CLI are fully usable but report less structure — the README will be updated as their adapters mature.

---

## Manual Quick Start

### Requirements
- **Node.js `>= 20`** (`>= 24.9.0` if using DeepSeek Harness `dsh` for API-key / proxy models)
- At least one external harness:
  - **OpenAI Codex CLI**: `npm install -g @openai/codex` → `codex login`
  - **DeepSeek Harness (`dsh`)** *(for DeepSeek, Gemini 4 & OpenAI-compatible APIs/proxies)*: `npm install -g @deepseek-ai/dsh@latest`
  - **Claude Code CLI**: `npm install -g @anthropic-ai/claude-code` → `claude`
  - **Antigravity CLI**: `agy`

### Install into Antigravity
```bash
npm install
npm run install:antigravity
```
Restart Antigravity once, then open **A.stand** from the left sidebar or the right pane **`+`** button.

### Verify & Uninstall
```bash
npm run check:contracts       # Detect local CLIs & verify Codex protocol schema
npm run test:e2e              # Run full 9-section E2E + strict-CSP browser suite
npm run uninstall:antigravity # Clean removal (zero external configs touched)
```

---

## Architecture & Docs

```text
Antigravity Lead Agent (5 concise MCP tools + Skill + Rules)
   └── A.stand Plugin (<Antigravity plugins dir>/agent-relay/)
         ├── Side-Panel Console (Team · Models/Channels · Cache · Settings · 中/EN)
         ├── Core Broker (Hard Switch · Concurrency · Doorbell · Gatekeeper · Crash Recovery)
         └── Isolated Engine Adapters (1 file = 1 engine)
               ├── src/engines/codex.mjs        (native codex app-server)
               ├── src/engines/acp.mjs          (standard ACP -> dsh --profile acp)
               ├── src/engines/claude-code.mjs  (claude stream-json --resume)
               └── src/engines/antigravity.mjs  (agy headless CLI)
```

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — System architecture, request lifecycle, engine adapters, data model, sandbox layers, Git worktree isolation & test commands
- [SECURITY.md](./SECURITY.md) — Zero-mutation guarantee, API key isolation, sandbox boundaries & private vulnerability reporting
- [AGENT_INSTALL.md](./AGENT_INSTALL.md) — AI-Agent executable install, engine setup & model pairing guide
- [UPGRADING_ENGINES.md](./UPGRADING_ENGINES.md) — Adapting to upstream CLI updates
- [llms.txt](./llms.txt) — Machine-readable project map for AI crawlers and coding agents

---

## Acknowledgments

- **Oh-My-OpenAgent / Oh-My-OpenCode** — inspiration for the dual-role design: a read-only **Oracle** advisor/reviewer paired with a workspace-write **Hephaestus** engineer.
- **OpenAI Codex CLI** — `codex app-server` JSON-RPC, structured events and mid-turn steering.
- **Anthropic Claude Code** — the `stream-json` CLI protocol and session resume.
- **DeepSeek Harness / Agent Client Protocol (ACP)** — a standard, model-agnostic agent protocol.
- **Google Antigravity & Model Context Protocol (MCP)** — the host platform, MCP App UI convention, and the tool protocol A.stand is built on.

And to every user who reports a bug or a broken engine adapter.

---

## License

Released under the [Apache License 2.0](./LICENSE). Copyright 2026 A.stand Contributors.
