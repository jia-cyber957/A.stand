# A.stand v2 — AI Agent Installation & Onboarding Playbook

> **Audience:** AI agents (Antigravity, Claude Code, Cursor, Codex, Windsurf, or any MCP-capable coding agent) asked by a user to install, connect, configure, or troubleshoot **A.stand v2**.
>
> **Golden Rule:** Never silently install global packages, upgrade system Node.js, mutate external CLI configuration, invent tokens, or enable autonomous delegation without explaining the option and getting the user's confirmation first.
>
> **中文提示：** 本手册是给 AI Agent 执行的可运行剧本。先只读探测环境，再构建/启动，接入 MCP，落位规则与 Skill，最后让用户确认供应商与队列。任何全局安装、升级 Node、改写用户配置的动作都必须先征得用户同意。

---

## Project facts you can rely on

- **Product:** A.stand v2 — one resident desktop console plus a local HTTP daemon that brokers persistent, isolated subagents for any MCP host.
- **Daemon endpoint:** `http://127.0.0.1:3426` (loopback only; default port `3426`).
- **MCP endpoint:** `http://127.0.0.1:3426/mcp` (Streamable HTTP, per-upstream bearer token).
- **stdio fallback:** `dist/stdio-bridge.mjs` (a client-side proxy; it never stops the daemon).
- **MCP tools (exactly 4):** `agent_relay_ask`, `agent_relay_poll`, `agent_relay_review`, `agent_relay_session`.
- **Roles:** `oracle` (read-only advisor/reviewer, parallel-capable) and `hephaestus` (workspace-write engineer, write-mutex by default).
- **Supported CLIs:** Codex CLI, DeepSeek Harness (`dsh`), OpenCode, Doubao CLI, MiniMax Code, Qoder, Qoder Global, CodeBuddy CLI, JetBrains Junie, AWS Kiro CLI, Huawei Cloud CodeArts, Kimi Code, Qwen Code, Gemini CLI, Claude Code, Antigravity CLI, Cursor CLI, plus custom ACP/headless CLIs and OpenAI-compatible API channels.
- **Runtime:** Node.js `>= 20`; Node.js `>= 24.9.0` when using DeepSeek Harness (`dsh`).
- **License:** Apache License 2.0.
- **Security invariants:** loopback-only bind; secrets in private `secrets.json` (`0600`); no external CLI config mutation; Oracle read-only; Hephaestus workspace-write by default; master hard switch default OFF.

---

## Step 1: Read-only environment probe

Do not write anything yet. Collect facts and report them to the user.

```bash
node -v
npm -v
git --version
```

Check whether an A.stand daemon is already running:

```bash
curl -s http://127.0.0.1:3426/api/health
```

- HTTP 200 with `{"ok":true,...}` means a daemon is alive.
- Also check `%USERPROFILE%\.astand\daemon.json` (Windows) or `~/.astand/daemon.json` (macOS/Linux) for `port`, `mcpUrl`, `uiToken`, and `pid`.
- A healthy existing daemon on the same data directory must be **reused**, not killed or duplicated.

Detect installed CLIs (missing ones are fine; do not install anything yet):

```bash
codex --version
claude --version
dsh --version
agy --version
opencode --version
qoderclicn --version
qodercli --version
mcode --version
kimi --version
junie --version
kiro-cli --version
codearts --version
codebuddy --version
qwen --version
gemini --version
cursor-agent --version
doubao --version
```

**Important `dsh` check:** DeepSeek Harness requires Node.js `>= 24.9.0`. On Node 20/22, `dsh --version` may exit 0 while printing nothing. If the user wants API-key / proxy models through `dsh` and Node is too old, present two choices and wait:

1. Upgrade system Node.js to Node 24 LTS (recommended).
2. Keep system Node untouched and point A.stand at a portable Node 24 runtime (for example via `AGENT_RELAY_DSH_NODE`).

**Report format (keep it short):** Node version, npm version, whether A.stand is already running, and which CLIs are present/missing.

---

## Step 2: Clone, build, and launch the resident daemon

Ask the user where to clone the repository. Then use **one** of the launch modes below.

### Mode A — Source daemon (developer-friendly)

```bash
git clone https://github.com/jia-cyber957/A.stand.git
cd A.stand
npm install
npm run build
node dist/daemon.mjs
```

- `npm run build` produces `dist/daemon.mjs`, `dist/stdio-bridge.mjs`, `dist/wait-job.mjs`, `dist/desktop.html`, and the legacy `dist/server.mjs`.
- The daemon serves the console at `http://127.0.0.1:3426`.
- In pure daemon mode, the browser URL needs the UI token: `http://127.0.0.1:3426/?uiToken=<UI_TOKEN>`, where `<UI_TOKEN>` is read from `~/.astand/daemon.json`.
- Run the daemon in the background or in a separate terminal. Do **not** leave a foreground dev server attached to the agent session.

### Mode B — Portable Windows desktop bundle (recommended for humans)

```bash
npm run package:desktop
# Output: dist-desktop/A.stand/a-stand.exe
```

`a-stand.exe` is a Tauri 2 tray application. Closing the window hides it; quitting from the tray menu stops the daemon. It opens the console automatically.

### Mode C — Legacy Antigravity plugin (optional)

Only if the user explicitly wants the old plugin path:

```bash
npm run install:antigravity
```

v2 does not require this. Any MCP host can connect directly to the local daemon.

### After launch

```bash
curl -s http://127.0.0.1:3426/api/health
```

Do not proceed until the health probe returns `{"ok":true,...}`. If the port is occupied by an unhealthy or unrelated process, stop and report the conflict; do not kill processes blindly.

---

## Step 3: Connect the host MCP client

**Never invent or reuse a token.** The token is generated by A.stand per upstream client.

1. Open the console (`http://127.0.0.1:3426`).
2. Go to **Upstream Clients** (`已接上游`).
3. Click **Connect upstream** (`+ 接入新上游`).
4. Optionally enter a nickname; leave it blank to auto-detect on first handshake.
5. Click **Generate token & setup prompt**.
6. Click **Copy prompt** (`复制 Prompt`).

Send that prompt to the host AI being connected. It performs all three wiring steps at once: MCP server entry, delegation rules, and the bundled Skill.

### Manual wiring — Streamable HTTP

```json
{
  "mcpServers": {
    "a-stand": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:3426/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>",
        "X-Astand-Token": "<YOUR_TOKEN>"
      }
    }
  }
}
```

### Manual wiring — stdio bridge

Use this when the host cannot speak local HTTP MCP, or when localhost triggers an OAuth prompt:

```bash
node dist/stdio-bridge.mjs --url http://127.0.0.1:3426/mcp --token <YOUR_TOKEN>
```

```json
{
  "mcpServers": {
    "a-stand": {
      "command": "node",
      "args": [
        "dist/stdio-bridge.mjs",
        "--url",
        "http://127.0.0.1:3426/mcp",
        "--token",
        "<YOUR_TOKEN>"
      ]
    }
  }
}
```

### Connection rules

- Keep the daemon running; the stdio bridge is only a proxy and exits cleanly when its stdin closes.
- Every upstream has its own token, its own client slot, and its own MCP session attribution. Never share tokens between hosts.
- After writing the config, most hosts need an MCP refresh, a client restart, or one more message before the tools appear.
- Once the tools are visible, call `agent_relay_session(action="status")` once to complete the handshake. A reply containing `enabled` and `limits` means success.
- If the host still shows no tools, report the exact client name and version. Do not loop retries.

---

## Step 4: Install the host-level delegation gate and Skill cleanly

The setup prompt already contains these instructions. Follow it rather than improvising.

### 4.1 Delegation gate — `plugin/rules/AGENTS.md`

Read `plugin/rules/AGENTS.md` and merge it into the host's global/user rules file. Wrap it with explicit markers so it can be removed cleanly:

```text
<!-- a-stand:start -->
...contents of plugin/rules/AGENTS.md...
<!-- a-stand:end -->
```

This gate is host-agnostic. It covers:

- Lead Agent as digital twin / tech lead and protection of the expensive main context.
- Claude Code + OMO-style context-protection boundaries.
- Converting user screenshots into exact visual specs before delegating UI work.
- Clean `sessionId` discipline: omit for new tasks, reuse only for the exact same task.
- No substitute subagents: do not route A.stand work to host-native generic subagents.
- Browser restraint: only for major visual/interaction issues.

If the user already has a rules file, **append** the marked block; never overwrite unrelated rules.

### 4.2 Orchestration Skill — `plugin/skills/agent-relay/SKILL.md`

Install it where the host loads local Skills, for example:

```text
<HOST_SKILLS_DIR>/a-stand/SKILL.md
```

The folder name may be `a-stand` or `agent-relay` depending on the host. The Skill is an on-demand playbook for:

- Parallel `oracle` slots.
- True parallel launch: `waitSec: 0` + one `agent_relay_poll(jobIds=[...])`.
- Zero-token async doorbell `wait-job.mjs`.
- Git worktree parallel writers.
- Crash recovery and quota exhaustion handling.

### 4.3 Containment rules

- **Never duplicate unrelated host skills into subagents.** Business/tool Skills stay on the Lead Agent.
- Do not copy the user's other Skills into the `a-stand` Skill folder.
- Do not inject host-only tools or credentials into subagent briefs.
- If the host has no rules or Skills mechanism, skip gracefully and rely on the MCP tool descriptions plus the setup prompt.
- To remove later, use the console's **Copy AI disconnect prompt** (`一键复制 AI 剥离 Prompt`). It removes only the `a-stand` MCP entry, the marked rules block, and the Skill folder.

---

## Step 5: Guide the user through Providers, login, whitelist, and role pairing

**Consent first.** Never run a global package install, upgrade Node, or alter an external CLI config unless the user explicitly approves it. Prefer A.stand's in-app install and login flows, which use the official CLIs in isolated profiles.

### 5.1 Providers page (`模型供应商`)

Walk the user through the 3-zone page:

1. **Top: CLI engines.**
   - Detect, install, or update CLIs in-app with live progress.
   - `Test` checks connectivity; `Details` opens account, quota, model whitelist, and multi-account controls.
   - `Refresh detection` rescans the machine.
2. **Bottom-left: accounts & quotas.**
   - OAuth or QR sign-in runs through the official CLI.
   - CodeBuddy and MiniMax expose **Standard (`标准版`) / Global (`国际版`)** region selection.
   - Accounts use isolated profile directories (`CODEX_HOME`, `DSH_HOME`, `XDG_*`, and similar). Multi-account pools auto-rotate on 429 / 5xx / 401.
   - Codex shows real 5-hour / 7-day quota windows. Channels without a balance API are labeled unavailable; never fabricate quota bars.
3. **Bottom-right: API channels.**
   - Add Base URL + API key, then `Fetch Models` (`GET /models`) to batch-import.
   - Keys are stored only in private `secrets.json` (`0600`).
   - Changing to a different origin requires re-entering the key.
   - `utf8EnvChecked` drops dead loopback proxies (for example an inactive `127.0.0.1:10808` after Clash/TUN is stopped) while keeping live proxies.

### 5.2 Model whitelist

In a CLI's details, enable only the models the user wants. An empty whitelist means all discovered models are enabled. Do not silently narrow the whitelist.

### 5.3 Role pairing presets

When the user asks which models to use, offer these clear presets:

| Preset | Oracle (`白泽`, read-only) | Hephaestus (`祝融`, workspace-write) | Why |
|---|---|---|---|
| **Maximum quota saver** | Long-context `dsh` / API model | Same `dsh` / API model, Codex as fallback ② | 95%–99.8% cache makes tool loops cheap; Lead burns near-zero tokens |
| **Balanced quality & cost** (recommended) | Fast/cheap `dsh`, OpenCode, or Qoder slot | Codex (`medium`/`high`) with `dsh` fallback | Parallel research plus top-tier coding precision and automatic failover |
| **Maximum cross-model quality** | Claude Code or Codex (`high`) | Codex (`high`) or Claude Code | Different model families catch each other's blind spots |

### 5.4 Queue behavior to explain

- **`ordered` (default):** strictly follows the configured priority queue.
- **`smart`:** the Lead may choose a model from that role's queue by task complexity; cooldowns and fallbacks still apply.
- **Failover:** 429 / 5xx / 401 → cooldown, next entry, auto-restore at `resetsAt`.
- **Exhaustion:** `[ALL_ENGINES_EXHAUSTED]` returns a zero-AI, zero-network local handoff brief (goal, completed steps, `git status --short`, output tail).
- **Master switch:** defaults OFF. Keep it OFF until verification passes, then ask the user before enabling autonomous delegation.

---

## Step 6: Verification checklist

Run these checks before declaring success. Use bounded timeouts for long commands; never leave a foreground server or watcher running.

- [ ] `curl -s http://127.0.0.1:3426/api/health` returns `{"ok":true,...}`.
- [ ] The upstream client shows as connected in **Upstream Clients** (green / `已连接`).
- [ ] `agent_relay_session(action="status")` returns `enabled` and `limits`.
- [ ] A read-only Oracle smoke test succeeds:

  ```text
  agent_relay_ask(
    role="oracle",
    cwd="<ABSOLUTE_WORKSPACE>",
    prompt="Read-only smoke test: list the top-level files and summarize this project in 5 bullets. Do not modify anything.",
    waitSec=120
  )
  ```

- [ ] `git status --short` in the workspace is unchanged by the Oracle smoke test.
- [ ] Optional: `npm run test:v2` passes (10 checks). Use a timeout of at least 5 minutes.
- [ ] Optional legacy check: `npm run check:contracts`.
- [ ] Only after the user approves, turn the master switch ON in **Roles & Queues** (`角色与队列`).

If any check fails, report the exact command, output, and the smallest next action. Do not guess, and do not weaken tests or assertions to force a pass.

---

## Troubleshooting cheat sheet

| Symptom | Root cause | Exact fix |
|---|---|---|
| MCP returns 401 | Wrong token, revoked token, or paused client slot | Regenerate the token in Upstream Clients and resend the setup prompt |
| Host shows no `agent_relay_*` tools | Config written but MCP not reloaded | Refresh MCP, restart the client, or send one more message |
| Port 3426 already in use | Another daemon is running | Check `~/.astand/daemon.json`; reuse the healthy daemon; do not kill blindly |
| `dsh --version` prints nothing, exit 0 | Node.js < 24.9.0 | Upgrade to Node 24 LTS, or use a portable Node 24 runtime |
| Codex quota unavailable | `chatgpt.com` unreachable | Restore network access, then click refresh; do not fabricate values |
| CLI hangs on outbound requests | Dead loopback proxy left by a stopped TUN/VPN | A.stand strips it automatically via `utf8EnvChecked`; verify a live proxy if the issue persists |
| `EPERM` during build/browser tests | `workspace-write` sandbox blocks parent-dir or pipe spawn | Run the build on the host, or ask the user to enable Hephaestus full access |
| Tools work, then stop after a network change | Stale proxy environment in an idle child | A.stand recycles idle processes via `proxyFingerprint`; retry the delegation |
| Want to unbind | Cleanup | Use the console's AI disconnect prompt; never hand-delete unrelated config |
| daemon duplicated after restart | The user started another instance | Let the single-instance guard reuse the live daemon; do not start a second one |

---

## Final report to the user

Return a compact handoff:

1. **Summary** — installed/launched, upstream connected, providers configured.
2. **Files touched** — list only the files you actually changed (host MCP config, rules block, Skill folder).
3. **Verification** — health check, handshake, Oracle smoke test, optional test results.
4. **Remaining risks** — unlogged CLIs, unavailable quotas, pending user choices, master-switch state.

Never include raw API keys, bearer tokens, private LAN addresses, or full local user paths in the report.