# Security Policy / 安全策略

A.stand brokers work between your Antigravity Lead Agent and external AI CLIs running locally on your machine. Its safety model rests on a small number of hard invariants. If you find a way to break one of them, please report it privately.

A.stand 在本机的 Antigravity 主 Agent 与外部 AI CLI 之间做任务转接。其安全模型由几条硬性不变量支撑。如果你发现了可以破坏其中任意一条的方式，请私下报告。

---

## 1. Zero-Mutation Guarantee / 零侵入保证

A.stand **never modifies or deletes** your existing external CLI configuration files:

A.stand **绝不修改或删除**你本机已有的外部 CLI 配置文件：

- `~/.codex/config.toml`
- `~/.dsh/` user config files
- `~/.claude/` user config files
- `~/.gemini/antigravity-cli/settings.json`

All runtime scoping uses ephemeral mechanisms only: per-process environment variables, ephemeral CLI session flags, and adapter overlay files that live **inside the plugin's own private data directory** (`<PLUGIN_DATA>/dsh-profiles/<channel>/agent-relay-overlay.yml`). Note that upstream CLIs themselves still write their own normal session logs/caches under their standard runtime directories (e.g. `~/.codex/sessions`, `~/.dsh/sessions`, `~/.claude/`). Uninstalling the plugin with `npm run uninstall:antigravity` removes only plugin files and never touches your CLI configs.

所有运行期隔离只使用临时机制：进程级环境变量、临时 CLI 会话参数，以及只存在于**插件私有数据目录**内的适配器覆盖文件（`<PLUGIN_DATA>/dsh-profiles/<channel>/agent-relay-overlay.yml`）。注：上游 CLI 在正常运行时仍会在其各自的标准目录（如 `~/.codex/sessions`、`~/.dsh/sessions`、`~/.claude/`）写入自身的会话日志与缓存。执行 `npm run uninstall:antigravity` 只会移除插件文件，绝不触碰你的 CLI 配置文件。

> A report that shows A.stand directly modifying any of your external CLI configuration files is treated as a security vulnerability.

> 如果报告能证明 A.stand 直接修改了上述任一外部 CLI 配置文件，将被视为安全漏洞。

---

## 2. API Key Isolation / API Key 隔离

- API keys are written **only** to the plugin-private `secrets.json` (`<PLUGIN_DATA>/secrets.json`), written atomically with mode `0600` on POSIX (and stored under your OS user-profile directory on Windows; standard OS account permissions apply).
- Keys are never placed in `settings.json`, job logs, telemetry, the UI payload, or any file outside the plugin data directory. The UI only ever receives masked values (e.g. `sk-a••••1234`).
- **Origin-change re-entry**: editing a channel's Base URL to a different origin requires re-entering the API key. A saved key can never be silently replayed against a new endpoint.
- Keys are passed to engine child processes through per-process environment variables and are never persisted into external CLI configs.

- API Key **只会**写入插件私有的 `secrets.json`（`<PLUGIN_DATA>/secrets.json`），以原子方式写入，POSIX 平台设置 `0600` 权限（Windows 平台受当前用户目录权限保护）。
- Key 绝不会出现在 `settings.json`、任务日志、遥测数据、UI 数据载荷或插件数据目录之外的任何文件中；UI 只接收脱敏值（如 `sk-a••••1234`）。
- **跨源重填**：把渠道 Base URL 修改为不同源（origin）时，必须重新输入 API Key；已保存的 Key 绝不会被静默复用于新端点。
- Key 仅通过进程级环境变量传给引擎子进程，绝不写入外部 CLI 配置。

---

## 3. Sandbox & Git Worktree Boundaries (Per Engine) / 各引擎沙箱与 Git Worktree 边界

Enforcement depends on what each upstream CLI exposes:

| Engine | `Oracle` (read-only) | `Hephaestus` (engineer) |
| :--- | :--- | :--- |
| **Codex CLI** | Native `read-only` sandbox flag | Native `workspace-write` (default) or opt-in `danger-full-access` |
| **DeepSeek Harness (`dsh` / ACP)** | Fail-closed permission handler (denies/cancels write/exec permission requests) + prompt constraints | Allows workspace edits; respects write mutex / opt-in worktree |
| **Claude Code CLI** | Read-only tool allowlist (`Read,Grep,Glob,LS,WebSearch`) + prompt constraints | Workspace edit/bash tools enabled; respects write mutex / opt-in worktree |
| **Antigravity CLI (`agy`)** *(Experimental)* | Prompt-level read-only instructions only (no hard CLI sandbox flag yet) | Prompt-level instructions; respects write mutex / opt-in worktree |

- The **Master Hard Switch** is enforced inside the MCP server: when OFF, all delegation tools (`agent_relay_ask` / `agent_relay_review`) are hard-blocked and no new subagent jobs can be launched. (Explicit user-initiated UI checks such as **Test Connection**, **Fetch Models**, or Codex status reads still contact the selected CLI/endpoint when invoked.)
- **Opt-in Git worktree isolation**: when **Git Worktree Parallel Writers** is enabled and the target is a Git checkout with an existing `HEAD`, a concurrent writer gets an isolated Git checkout at `<dataDir>/worktrees/<jobId>` on branch `astand/<jobId>`. Worktrees provide **Git checkout / branch isolation** (not an OS container). Clean worktrees with no local changes and no new commits are pruned automatically; dirty worktrees are retained for you to inspect, merge, and remove.
- Non-Git directories always fall back to the single-writer mutex.

- **总硬开关**在 MCP server 内部强制执行：关闭时彻底拦截所有新任务委托（`agent_relay_ask` / `agent_relay_review`），不会派发任何子 Agent 任务。（你在 UI 中主动点击的“测试连接 / 获取模型”或读取 Codex 额度状态仍会按需联系对应端点。）
- **可选 Git worktree 隔离**：开启 **Git Worktree 并行写入** 且目标为已有 `HEAD` 的 Git 仓库时，并发写手获得位于 `<dataDir>/worktrees/<jobId>`、分支为 `astand/<jobId>` 的独立工作副本。Worktree 提供的是 **Git 检出与分支级隔离**（并非操作系统容器）。无改动且无新提交的 worktree 会自动清理；有改动的会保留供你审查、合并与清理。
- 非 Git 目录始终回退为单写手互斥。

---

## 4. Reporting a Vulnerability / 漏洞报告

**Please do not open a public issue for security problems.**

- **Preferred**: report privately via [GitHub Security Advisories](https://github.com/jia-cyber957/A.stand/security/advisories/new) *("Report a vulnerability" on the Security tab)*.
- **Alternative**: if you cannot use Advisories, contact the maintainer `@jia-cyber957` without disclosing any exploit details in a public issue.

Please include: affected version/commit, your OS and Node.js version, the external engine involved, reproduction steps, and (if possible) a minimal proof of concept.

**请勿为安全问题提交公开 Issue。**

- **首选**：[GitHub Security Advisories](https://github.com/jia-cyber957/A.stand/security/advisories/new)（仓库 Security 标签页中的 "Report a vulnerability"）。
- **备选**：如无法使用 Security Advisories，请在不公开任何漏洞细节的前提下联系维护者 `@jia-cyber957`。

请尽量提供：受影响版本/提交、操作系统与 Node.js 版本、涉及的外部引擎、复现步骤，以及（如可能）最小复现用例。

### Our Commitment / 我们的承诺

- We acknowledge reports within **72 hours** and aim to issue a fix or mitigation within **7 days** for confirmed issues.
- We will credit reporters in the advisory and release notes unless you prefer to remain anonymous.
- Please give us a reasonable window to ship a fix before any public disclosure.

- 我们会在 **72 小时**内确认收到报告，确认的问题争取在 **7 天**内给出修复或缓解方案。
- 除非你希望匿名，我们会在安全公告和发布说明中致谢报告者。
- 在公开披露前，请给我们合理的时间窗口发布修复。

---

## 5. Scope / 适用范围

**In scope**: A.stand's own code — the MCP server (`src/server.mjs`), orchestrator, store/secrets handling, engine adapters (`src/engines/*`), the claim that the zero-mutation guarantee is upheld, secret leakage in UI payloads/logs, sandbox-flag bypasses, and worktree boundary escapes.

**Out of scope**: vulnerabilities in the upstream engines themselves (report those to OpenAI Codex, Anthropic Claude Code, DeepSeek Harness, and Google Antigravity respectively); the behavior of models you deliberately connect (prompt injection originating from repository content you give a subagent); and issues that require pre-existing full local access to the machine's user account.

**范围内**：A.stand 自身代码 —— MCP server（`src/server.mjs`）、编排器、存储与密钥处理、引擎适配器（`src/engines/*`）、零侵入保证被破坏、UI 载荷或日志中的密钥泄漏、沙箱参数绕过、worktree 边界逃逸。

**范围外**：上游引擎自身的漏洞（请分别报告给 OpenAI Codex、Anthropic Claude Code、DeepSeek Harness、Google Antigravity）；你主动连接的模型的行为（例如来自仓库内容的提示注入）；以及需要预先获得本机用户账户完全访问权限才能触发的问题。

---

*This policy applies to all versions of A.stand distributed from [github.com/jia-cyber957/A.stand](https://github.com/jia-cyber957/A.stand). / 本策略适用于从 [github.com/jia-cyber957/A.stand](https://github.com/jia-cyber957/A.stand) 发布的所有版本。*
