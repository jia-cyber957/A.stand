# AI Agent Installation, Setup & Model Advisor Guide

> **Audience**: This document is written specifically for **AI Agents** (e.g. Antigravity, Claude Code, Codex CLI) when a user shares this repository URL and asks you to install, configure, or troubleshoot **Agent Relay** (or asks which external engines/models to choose).
>
> **Golden Rule**: NEVER silently install global packages, upgrade system Node.js, or modify external CLI configs (`~/.codex/config.toml`, `~/.dsh/*`, `~/.claude/*`) without clearly explaining the options and getting the user's confirmation first.

---

## Step 1: Environment Pre-Check (Read-Only)

Run read-only checks first to see what the user already has:

```bash
node -v
npm -v
git --version
```

Check which external harnesses are already installed (any missing ones are OK — the plugin installs cleanly first and engines can be added anytime):

```bash
codex --version      # OpenAI Codex CLI (optional)
dsh --version        # DeepSeek Harness for API-key & proxy models (optional; requires Node >= 24.9.0)
claude --version     # Anthropic Claude Code CLI (optional)
agy --version        # Google Antigravity CLI (optional)
```

> **Important Node.js check for `dsh`**:
> - Agent Relay itself runs on **Node.js >= 20**.
> - However, **DeepSeek Harness (`dsh`)** strictly requires **Node.js >= 24.9.0** (on Node 20/22, `dsh --version` exits 0 silently without printing anything!).
> - If the user wants API-key / OpenAI-compatible proxy models via `dsh` and `node -v` is `< 24.9.0`, present two clear choices:
>   1. **Upgrade system Node.js to Node 24 LTS** (Recommended — `dsh` works everywhere in terminal too).
>   2. **Keep system Node untouched** and place a portable Node 24 runtime at `<PLUGIN_DATA>/runtime/node24` (or set `AGENT_RELAY_DSH_NODE`).

---

## Step 2: Clone, Build & Install into Antigravity

Ask the user where they'd like the repo cloned (or clone into their chosen projects directory), then run:

```bash
git clone <REPO_URL> agent-relay
cd agent-relay
npm install
npm run install:antigravity
```

This builds `dist/server.mjs`, `dist/console.html`, and `dist/wait-job.mjs`, and deploys the plugin cleanly into:
- Windows: `%USERPROFILE%\.gemini\config\plugins\agent-relay\`
- macOS / Linux: `~/.gemini/config/plugins/agent-relay/`

Verify the installation:

```bash
npm run check:contracts
```

Tell the user:
1. **Restart Antigravity once** so the MCP server registers cleanly.
2. Open **Agent Relay** from the left sidebar or the right side-pane **`+`** button.
3. Keep the top-right **Master Switch** OFF until at least one engine/model is ready, then turn it **ON** to enable autonomous delegation.

---

## Step 3: Interactive External Engine Setup (Ask User First!)

After the plugin is installed, ask the user which external AI engine(s) they want to connect, then guide or run ONLY the ones they pick:

### Option A: OpenAI Codex CLI (ChatGPT Plus / Pro / Team Subscription)
- **Best for**: Highest coding quality, deep refactoring, mid-turn steering (`steer`), live 5h/7d quota tracking.
- **Install & login**:
  ```bash
  npm install -g @openai/codex
  codex login
  ```
- **In Agent Relay**: Open **Models** tab → click **Re-scan**. Live Codex models (e.g. `gpt-5` / `gpt-6` series) auto-populate via `model/list`. Zero changes made to `~/.codex/config.toml`.

### Option B: DeepSeek Harness (`dsh`) — Official DeepSeek & Any OpenAI-Compatible API / Proxy
- **Best for**: Saving main-model quota dramatically, connecting DeepSeek API, OpenRouter, or self-hosted OpenAI-compatible gateways/proxies with **95%–99.8% Prompt Cache** hit rates.
- **Prerequisite**: Node.js `>= 24.9.0`.
- **Install** (MUST include `@latest` because official releases use prerelease tags — omitting `@latest` fails with `npm ERR! ETARGET`!):
  ```bash
  npm install -g @deepseek-ai/dsh@latest
  dsh --version
  ```
- **Connect your API / Proxy in Agent Relay**:
  1. Open **Models** tab → click **`+ Add API Channel`**.
  2. Enter Provider / Channel Name, Base URL (e.g. `https://api.deepseek.com/v1` or your own OpenAI-compatible gateway URL), and API Key (stored strictly in private `secrets.json`).
  3. Click **Fetch Models** (`GET /models`) to batch-import models (or type model IDs manually) → Save.
  4. In **Team** tab, pick the imported model under **DeepSeek Harness** for `Oracle` and/or `Hephaestus`.

### Option C: Anthropic Claude Code CLI
- **Best for**: Complex reasoning, architecture review, and code generation using a Claude subscription.
- **Install & login**:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude
  ```
- **In Agent Relay**: Open **Models** tab → click **Re-scan**.

### Option D: Google Antigravity CLI (`agy`)
- If `agy` is already installed and signed in on PATH, Agent Relay detects it automatically on **Re-scan**.

---

## Step 4: Model Selection & Pairing Advisor (Answer User Questions With This!)

When a user asks *"I don't know which models to pick for Oracle vs Hephaestus — what do you recommend?"*, give clear, practical presets tailored to their budget and available accounts:

| Preset | `Oracle` (Read-Only Advisor & Reviewer) | `Hephaestus` (Workspace-Write Engineer) | Why It Works |
|---|---|---|---|
| **Maximum Quota Saver** *(API / Proxy / DeepSeek)* | Fast long-context model via `dsh` (e.g. `deepseek-chat` / proxy flash-long) | Same long-context model via `dsh`, fallback `② Codex` | 95%–99% Prompt Cache makes multi-step tool loops dirt cheap; Lead Agent burns near-zero tokens |
| **Balanced Quality & Cost** *(Recommended)* | Fast/cheap model via `dsh` (parallel read-only audits) or `Codex (medium)` | `Codex` (`medium`/`high`) with `dsh` API fallback | Fast parallel codebase research + top-tier coding precision + automatic quota failover |
| **Maximum Code Quality** *(Subscription Heavy)* | `Claude Code` or `Codex (high)` | `Codex (high)` or `Claude Code` | Cross-model adversarial review (different model families catch each other's blind spots) |

### Recommended Settings Guide (Explain When Asked)
- **Async Background Mode (`后台异步模式 / 边干边聊`)** *(default OFF)*:
  - Keep OFF if you prefer classic "ask → wait → get answer".
  - Turn ON if you want 1-second non-blocking dispatch + zero-token doorbell (`wait-job.mjs`) so you can keep chatting with the Lead Agent while `Hephaestus` runs 5–15 min tasks (0 Lead polling tokens!).
- **Stall Gatekeeper AI (`卡顿守门员 AI`)** *(default OFF)*:
  - Keep OFF for zero extra API calls (the timeline + silence timeout doorbell already catches stalls).
  - Turn ON with a fast API model if you run slow builds/downloads (> 3 min silent) and want a strict 2-choice `CONTINUE` vs `ALERT` gatekeeper before waking the Lead Agent.
- **Allow Hephaestus Full Access** *(default OFF)*:
  - Keep OFF by default (`workspace-write` sandbox).
  - Turn ON only for trusted workspaces where `Hephaestus` needs to run build tools (`esbuild`, Docker, headless browsers) that touch paths outside the workspace.

---

## Step 5: Common Troubleshooting Cheat Sheet

| Symptom | Root Cause | Exact Fix |
|---|---|---|
| `npm install -g @deepseek-ai/dsh` fails with `ETARGET` | Package publishes prerelease tags | Run `npm install -g @deepseek-ai/dsh@latest` |
| `dsh --version` prints nothing and exits 0 | Node.js `< 24.9.0` | Upgrade to Node 24 LTS (or install portable Node 24 into `<PLUGIN_DATA>/runtime/node24`) |
| Side panel doesn't show newly built features | Resident MCP server caches `dist/server.mjs` | Close/reopen panel refreshes UI (`console.html`); **restart Antigravity** refreshes backend (`server.mjs`) |
| `hephaestus` fails `esbuild` / browser E2E with `EPERM` | `workspace-write` sandbox blocks parent-dir / pipe spawn | Run build/E2E on host, or enable **Allow Hephaestus Full Access** in Settings for trusted workspaces |
| Antigravity closed while subagent was running | Local MCP child process stops with host | Reopen Antigravity → Team tab shows **`⚠ 意外中断`** banner → click **Copy Resume Prompt** to resume the same `sessionId` |
| Want to completely uninstall | Clean removal | Run `npm run uninstall:antigravity` (zero external CLI configs touched) |
