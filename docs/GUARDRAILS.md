# A.stand 架构红线与核心契约

## 1. 安全与隐私底线（零容忍）
1. **仅监听本机回环**：守护进程强制绑定 `127.0.0.1`，绝不监听 `0.0.0.0` 或公网/局域网接口。
2. **防 DNS Rebinding / CSRF**：校验 `Host`（仅 `127.0.0.1` / `localhost`）与 `/api/*` 的 `Origin` 白名单（loopback + `tauri://localhost`）。
3. **鉴权与隔离**：UI Token 与上游 Client Token 统一使用 SHA-256 + `crypto.timingSafeEqual` 校验；每个 MCP 会话独占一个 `McpServer` 实例，严禁跨客户端复用或劫持 `mcp-session-id`；空闲会话超时自动清扫（30 分钟 / 上限 256）。
4. **密钥绝不外泄**：所有 API Key 与 Client Token 仅存 `<dataDir>/secrets.json`（`0o600`）；`settings.json`、`extensions.json`、`daemon-events.jsonl` 与一键导出的脱敏诊断包严禁包含明文密钥或未脱敏 Token。
5. **零越界修改外部 CLI 配置**：绝不私自修改 `~/.codex/config.toml`、`~/.dsh/*`、`~/.claude/*` 等外部工具配置。

## 2. Prompt Cache 与引擎契约
1. **Turn 1 注入纪律**：角色常驻守则与启用的 Skills/Templates 仅在会话 Turn 1 注入，Turn 2+ 保持前缀字节一致，严禁破坏上游 Prompt Cache。
2. **上下文隔离优于缓存**：新任务/独立审查必须省略 `sessionId`，绝不跨无关任务硬复用旧会话。
3. **诚实报错**：续接热会话单模型撞 429 但同队列仍有健康备选时，必须返回 `[SESSION_MODEL_RATE_LIMITED]`（绝不误报 `[ALL_ENGINES_EXHAUSTED]`）；上游返回裸 `tool_calls` JSON 文本时必须拦截判 `[PROTOCOL_LEAK]` 失败。
4. **映射盘兼容**：Git 仓库检测统一使用 `git -c safe.directory=* rev-parse --show-prefix`，避免 Windows `Z:\` 与 UNC `//host/...` 路径比对失败。

## 3. 前端与模块化红线
1. **桌面前端全离线 + 严格 CSP**：`dist/desktop.html` 严禁引用任何外链 CDN/脚本/样式，严禁 `eval` 与内联事件处理器，所有动态文本必须经 `esc()` 转义。
2. **单文件体量控制**：新增后端核心模块与前端视图模块必须按职责拆分，新文件严格控制在 **≤ 450 行**（历史大文件 `src/desktop-ui/app.js`、`src/ui/app.js`、`src/core/orchestrator.mjs` 坚持只减不增，新功能一律外提独立模块）。

## 4. 交付与 Git 纪律
1. **验证必带超时**：自动化测试与构建脚本必须设置明确超时，不残留前台或孤儿 `a-stand.exe` / `node` 进程。
2. **提交前必过安检**：每次重要提交前运行 `guard_common.py`，推送 GitHub 必须经用户明确确认。
3. **四态验收**：AI 测试全绿仅可记为 `待用户验收`，严禁替用户标记 `用户已验收`。
