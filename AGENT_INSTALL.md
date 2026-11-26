# AI Agent Installation, Setup & Model Advisor Guide

> **Audience**: This document is written specifically for **AI Agents** (e.g. Antigravity, Claude Code, Codex CLI) when a user shares this repository URL and asks you to install, configure, or troubleshoot **A.stand** (or asks which external engines/models to choose).
>
> **Golden Rule**: NEVER silently install global packages, upgrade system Node.js, or modify external CLI configs (`~/.codex/config.toml`, `~/.dsh/*`, `~/.claude/*`, `~/.gemini/antigravity-cli/*`) without clearly explaining the options and getting the user's confirmation first.

**Project facts you can rely on**
- License: **Apache License 2.0** (`LICENSE`, `"license": "Apache-2.0"` in `package.json`).
- A.stand itself runs on **Node.js >= 20**; DeepSeek Harness (`dsh`) needs **Node.js >= 24.9.0**.
- Supported engines: **OpenAI Codex CLI**, **DeepSeek Harness (`dsh` / ACP)** for DeepSeek, Gemini 4 and any OpenAI-compatible API/proxy, **Anthropic Claude Code CLI**, and **Google Antigravity CLI (`agy` / Gemini 4)**.
- Architecture, sandbox layers and Git worktree behavior: [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). Security guarantees: [`SECURITY.md`](./SECURITY.md).

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
agy --version        # Google Antigravity CLI — Gemini 4 via `agy` (optional)
```

> **Important Node.js check for `dsh`**:
> - A.stand itself runs on **Node.js >= 20**.
> - However, **DeepSeek Harness (`dsh`)** strictly requires **Node.js >= 24.9.0** (on Node 20/22, `dsh --version` exits 0 silently without printing anything!).
> - If the user wants API-key / OpenAI-compatible proxy models via `dsh` and `node -v` is `< 24.9.0`, present two clear choices:
>   1. **Upgrade system Node.js to Node 24 LTS** (Recommended — `dsh` works everywhere in terminal too).
>   2. **Keep system Node untouched** and place a portable Node 24 runtime at `<PLUGIN_DATA>/runtime/node24` (or set `AGENT_RELAY_DSH_NODE`).

---

## Step 2: Clone, Build & Install into Antigravity

Ask the user where they'd like the repo cloned (or clone into their chosen projects directory), then run:

```bash
git clone https://github.com/jia-cyber957/A.stand.git A.stand
cd A.stand
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
2. Open **A.stand** under **Plugins** in the left sidebar, or from the conversation’s upper-right **⋮** menu under **Plugins**. See the [two entry points with screenshots](./README.md#open-the-astand-panel).
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
- **In A.stand**: Open **Models** tab → click **Re-scan**. Live Codex models (e.g. `gpt-5` / `gpt-6` series) auto-populate via `model/list`. Zero changes made to `~/.codex/config.toml`.

### Option B: DeepSeek Harness (`dsh`) — DeepSeek, Gemini 4 & Any OpenAI-Compatible API / Proxy
- **Best for**: Saving main-model quota dramatically, connecting **DeepSeek API**, **Gemini 4** through any OpenAI-compatible gateway, OpenRouter, or self-hosted OpenAI-compatible proxies with **95%–99.8% Prompt Cache** hit rates. This is the native path for Gemini 4 through a Gemini API channel.
- **Prerequisite**: Node.js `>= 24.9.0`.
- **Install** (MUST include `@latest` because official releases use prerelease tags — omitting `@latest` fails with `npm ERR! ETARGET`!):
  ```bash
  npm install -g @deepseek-ai/dsh@latest
  dsh --version
  ```
- **Connect your API / Proxy in A.stand**:
  1. Open **Models** tab → click **`+ Add API Channel`**.
  2. Enter Provider / Channel Name, Base URL (e.g. `https://api.deepseek.com/v1`, a Gemini API–compatible OpenAI endpoint, or your own OpenAI-compatible gateway URL), and API Key (stored strictly in private `secrets.json`). Changing the Base URL to a different origin forces re-entering the key.
  3. Click **Fetch Models** (`GET /models`) to batch-import models (or type model IDs manually) → Save.
  4. In **Team** tab, pick the imported model under **DeepSeek Harness** for `Oracle` and/or `Hephaestus`.

### Option C: Anthropic Claude Code CLI
- **Best for**: Complex reasoning, architecture review, and code generation using a Claude subscription.
- **Install & login**:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude
  ```
- **In A.stand**: Open **Models** tab → click **Re-scan**.

### Option D: Google Antigravity CLI (`agy`) — Gemini 4
- **Best for**: Delegating to **Gemini 4** through the `agy` headless CLI when no API key is available.
- **Maturity**: **Experimental / basic**. `agy` delegation returns plain text output — no structured X-ray timeline and no upstream Prompt Cache counters yet.
- If `agy` is already installed and signed in on PATH, A.stand detects it automatically on **Re-scan**.
- For full Gemini 4 support (X-ray timeline + real Prompt Cache), prefer **Option B** with a Gemini API channel.

**Engine maturity at a glance**: OpenAI Codex CLI (full native) · DeepSeek Harness / ACP (full native) · Claude Code CLI (standard) · Antigravity CLI `agy` (experimental / basic). See the matrix in [`README.md`](./README.md#engine-support-matrix).

---

## Step 4: Model Selection & Pairing Advisor (Answer User Questions With This!)

When a user asks *"I don't know which models to pick for Oracle vs Hephaestus — what do you recommend?"*, give clear, practical presets tailored to their budget and available accounts:

| Preset | `Oracle` (Read-Only Advisor & Reviewer) | `Hephaestus` (Workspace-Write Engineer) | Why It Works |
|---|---|---|---|
| **Maximum Quota Saver** *(API / Proxy / DeepSeek / Gemini 4)* | Fast long-context model via `dsh` (e.g. `deepseek-chat` / proxy flash-long) | Same long-context model via `dsh`, fallback `② Codex` | 95%–99% Prompt Cache makes multi-step tool loops dirt cheap; Lead Agent burns near-zero tokens |
| **Balanced Quality & Cost** *(Recommended)* | Fast/cheap model via `dsh` (parallel read-only audits) or `Codex (medium)` | `Codex` (`medium`/`high`) with `dsh` API fallback | Fast parallel codebase research + top-tier coding precision + automatic quota failover |
| **Maximum Code Quality** *(Subscription Heavy)* | `Claude Code` or `Codex (high)` | `Codex (high)` or `Claude Code` | Cross-model adversarial review (different model families catch each other's blind spots) |

### Recommended Settings Guide (Explain When Asked)
- **Smart Model Selection (`智能选型`)** *(per-role, default OFF / ordered queue)*:
  - Keep OFF to strictly follow each role's priority order (`① -> ②`).
  - Turn ON so the Lead Agent can pick a configured model from that role's queue per task based on complexity, while still honoring cooldowns and fallbacks.
- **Async Background Mode (`后台异步模式 / 边干边聊`)** *(default OFF)*:
  - Keep OFF if you prefer classic "ask → wait → get answer".
  - Turn ON if you want 1-second non-blocking dispatch + zero-token doorbell (`wait-job.mjs`) with recurring duration check-ins (`Off / 15 / 30 / 60m` or custom) so you can keep chatting with the Lead Agent while `Hephaestus` runs long tasks (0 Lead polling tokens!).
- **Stall Gatekeeper AI (`卡顿守门员 AI`)** *(paired under the silence interval, default OFF)*:
  - Keep OFF for zero extra API calls (the timeline + silence timeout doorbell already wakes the Lead directly).
  - Turn ON with a fast API model if you run slow builds/downloads and want a concise localized `CONTINUE` (up to 3 deferrals) vs `ALERT` judgment expandable in the timeline before waking the Lead Agent.
- **Role Custom Rules (`角色常驻守则`)** *(pre-filled by default)*:
  - Ships with editable Turn-1 rules for `Oracle` and `Hephaestus` (never re-injected on follow-up turns, keeping Prompt Cache intact). Clear and save a role's box to disable rules for that role.
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
| Antigravity closed while subagent was running | Local MCP child process stops with host | Reopen Antigravity and say "continue" in that thread — the Lead runs one scoped `recover` lookup to collect unread results or resume via `resumeJobId` with the original session, model, and worktree (Team tab also shows the `⚠ 意外中断` banner) |
| API key rejected after editing a channel | Base URL changed to a different origin | Re-enter the key — A.stand never replays a saved key against a new endpoint |
| Want to completely uninstall | Clean removal | Run `npm run uninstall:antigravity` (zero external CLI configs touched) |

---

## Step 6: Licensing & Support

- A.stand is released under the **Apache License 2.0**. You may use, modify, and redistribute it (including commercially) as long as you keep the license and attribution notices.
- Security guarantees (zero-mutation, API key isolation, sandbox layers) and private vulnerability reporting are documented in [`SECURITY.md`](./SECURITY.md). Do not open a public issue for a security problem.
- Deeper technical detail for debugging or extending the project lives in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
