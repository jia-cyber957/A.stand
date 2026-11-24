# Agent Relay

[English](./README.md) · [🤖 AI Agent 安装与配置手册（`AGENT_INSTALL.md`）](./AGENT_INSTALL.md)

**面向 Antigravity 的零侵入、多 AI 持久化子 Agent 插件（实时折叠对话流 + 99% 缓存监控 + 后台零轮询门铃）。**

> **🤖 最省事安装法：直接让你的 Antigravity 帮你装！**
> 把本仓库链接发给你的 **Antigravity**，附上一句：
> ```text
> 请先阅读这个仓库里的 AGENT_INSTALL.md，帮我把 Agent Relay 安装到 Antigravity，并引导我配置想用的外部模型。
> ```

Agent Relay 让你的 Antigravity 主 Agent 专注于架构决策、任务拆解与最终验收，把耗时耗额度的重活外包给本机原版外部 AI 引擎（**OpenAI Codex CLI**、**DeepSeek Harness / 任意 OpenAI 兼容 API 与中转站**、**Claude Code**、**Antigravity CLI**）：
- **`Oracle`（严格只读 · 多路并行）**：并行深挖代码库、架构权衡、连续排错破局、独立 Code Review；
- **`Hephaestus`（工作区可写 · 写互斥锁）**：多文件开发、核心重构、单测排错闭环。

---

## 为什么好用？（7 大核心特点）

1. **真省主模型额度，绝不把 200K+ 过程上下文灌回主对话**
   - 子 Agent 内部读几十个文件、反复改代码编译滚出来的 200K+ 上下文，**全部隔离在子 Agent 自己进程里**；
   - 主 Agent 验收时永远只收最后精炼出的 **1–3K 结果摘要**，大幅省下主模型 Token，同时防止主对话变脏变慢。

2. **实测 95%–99.8% 真实 Prompt Cache 命中率 + 干净的会话隔离**
   - **新任务默认开全新会话**（不同任务绝不串上下文）；
   - **同任务追问凭 `sessionId` 续接**，跨重启依然秒接原上下文与缓存；命中率 100% 读取上游真实计费字段（Codex / DeepSeek / Anthropic / `dsh` 压缩会话日志），绝不估算造假。

3. **Antigravity 原生风格实时折叠对话流**
   - 右侧面板点击任意运行中或历史任务，直接查看清爽无框的对话时间线：
     - 可折叠的 **主 Agent 指令 ›**
     - **`思考了 8s ›`**（点击展开完整推理段落）
     - **`已分析 gateway.go #L315-455`** / **`已编辑 gate.go +13 -4`** / **`已搜索 "pattern"`**
     - **`运行 go test ./... · 退出码 1 ›`**（点击展开完整终端输出）
     - 底部直接渲染干净的 **Markdown 最终回复**，2 秒实时刷新时保持已展开项不乱收起。

4. **可选「后台异步模式（边干边聊）」+ 零 Token 小门铃**
   - 默认关闭（保持传统同步直等）；在 **设置 → 后台异步模式（边干边聊）** 开启后：
   - 派活 **1 秒解锁聊天框**，后台挂零依赖 Node 门铃脚本（`wait-job.mjs`，**0 AI 消耗**），**子 Agent 干活期间主模型 0 次轮询**；
   - 干完、报错或卡死时门铃自动响铃唤醒主 Agent（若你正聊着别的话题，主 Agent 会先答完当前问题再轻声提醒，绝不打断思路）。

5. **可选「二选一卡顿守门员 AI」+ 防误关断点续跑**
   - **卡顿守门员 AI**（默认关闭）：静默超时时只读任务目标 + 最近 30 行透视日志（绝不读 200K 全量），只做二选一判断——`继续等`（慢编译不吵主 Agent）或 `叫醒主 Agent`（真卡死立刻告警），绝不越权改代码。
   - **防误关兜底**：任务状态与 `sessionId` 实时原子落盘；万一中途关掉 Antigravity，重开后团队页顶部自动弹出 **`⚠ 意外中断`** 提醒条，带 **一键复制续跑提示词**。

6. **零侵入纯净性 & 强安全边界**
   - **绝不修改**你的 `~/.codex/config.toml`、`~/.dsh/*`、`~/.claude/*` 等任何外部软件配置；
   - 右上角 **总硬开关**（关闭即代码层硬拦截，0 外部调用）；
   - API Key 独立存放于插件私有 `secrets.json`，改跨域名地址强制重填 Key 防泄密；
   - `Oracle` 始终只读，`Hephaestus` 默认 `workspace-write` 沙箱隔离（全权限需在设置里显式手动开启）。

7. **API 渠道两级管理 + Codex 额度追踪 + 全自动 E2E 测试**
   - 添加一次 API 渠道（支持 DeepSeek、OpenRouter 及任意自建 OpenAI 兼容反代网关），点「拉取模型」批量导入；
   - 实时读取 Codex 5 小时 / 7 天配额与重置倒计时，支持按角色配置多 AI 顺延队列与自动回切；中英双语界面，内置 9 组全自动端到端测试（含无头浏览器严格 CSP 校验）。

---

## 手动快速安装

### 环境要求
- **Node.js `>= 20`**（若要通过 DeepSeek Harness `dsh` 接入 API Key / 中转站模型，需 **Node.js `>= 24.9.0`**）
- 本机至少安装一个外部引擎（不懂怎么选可以直接问你的 Antigravity，它会参考 [AGENT_INSTALL.md](./AGENT_INSTALL.md) 给你推荐）：
  - **OpenAI Codex CLI**：`npm install -g @openai/codex` → `codex login`
  - **DeepSeek Harness（`dsh`）** *(支持官方 DeepSeek 及所有 OpenAI 兼容 API/中转站)*：`npm install -g @deepseek-ai/dsh@latest`（必须带 `@latest`）
  - **Claude Code CLI**：`npm install -g @anthropic-ai/claude-code` → `claude`
  - **Antigravity CLI**：`agy`

### 安装到 Antigravity
```bash
npm install
npm run install:antigravity
```
安装完成后**重启一次 Antigravity**，从左侧插件栏或右侧面板 **`+`** 菜单打开 **Agent Relay** 即可。

### 自检、测试与卸载
```bash
npm run check:contracts       # 检测本机引擎状态并校验 Codex 协议契约
npm run test:e2e              # 跑全套 9 组 E2E（含严格 CSP 浏览器、门铃、崩溃恢复、跨重启缓存）
npm run uninstall:antigravity # 一键干净卸载（零残留、绝不改外部配置）
```

---

## 文档导航

- [AGENT_INSTALL.md](./AGENT_INSTALL.md) — 写给 AI Agent 的自动化安装、引擎排坑与模型选型手册
- [HANDOVER.md](./HANDOVER.md) — 完整技术交接文档与后续 Roadmap（含独立轻量 `.exe` 多宿主规划）
- [UPGRADING_ENGINES.md](./UPGRADING_ENGINES.md) — 上游 CLI 升级适配指南
- [docs/ROADMAP_WORKTREE.md](./docs/ROADMAP_WORKTREE.md) — 后续 `git worktree` 多工程师并行写设计方案
