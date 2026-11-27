# A.stand 当前状态与验收接力棒

- **分支**：`main`（本地领先 `origin/main`，按用户要求暂不推送 GitHub，待验收后统一推送）
- **最新纯代码基线**：`b8c6c07`（2026-11-27）
- **便携桌面包**：`dist-desktop/A.stand/a-stand.exe`（6.33 MB，整包 7.71 MB）
- **本机数据目录**：`%USERPROFILE%\.astand`（已手动只读复制旧插件配置；保留原 Antigravity v1 插件双轨并行）

## 最近自动化回归结果（全部通过）
- `npm run build`：6 份产物全部通过（`server.mjs` / `console.html` / `wait-job.mjs` / `daemon.mjs` / `stdio-bridge.mjs` / `desktop.html`）
- `node scripts/test-v2-fixes.mjs`：**6/6 PASS**（Turn-1 projcache 竞态、映射盘 Worktree、单模型 429 精准报错、裸 `tool_calls` 拦截）
- `npm run test:v2`：**10/10 PASS**（守护进程、鉴权、注册制与 Prompt、HTTP 握手、暂停拦截、stdio 桥、SSE、技能与扩展、脱敏诊断包）
- `npm run test:e2e`：**9/9 段 PASS**（含严格 CSP 无头浏览器校验）
- `guard_common.py --all --links`：**PASS**（0 阻塞，0 警告）

## 四态验收清单
| 功能项 | 当前状态 | 备注 |
|---|---|---|
| v2 常驻守护进程 + 注册制 + AI 接入 Prompt + `stdio` 桥 | `待用户验收` | 白泽独立审计 4 项阻塞已全修 |
| 仿 Magpie 独立桌面控制台（7 页面 + 浅/深色 + 中英文） | `待用户验收` | 需用户双击 `a-stand.exe` 实机体验 |
| 技能与扩展中心（Skills / 子 Agent MCP / 模板） | `待用户验收` | 已预置 2 条模块化与防作弊护栏 |
| Tauri 2 原生窗口 + Windows 系统托盘常驻 | `待用户验收` | 关闭缩托盘、右键退出已实测 |
| 实战诊断包 4 项 Bug 修复 + 设置页一键脱敏诊断包 | `待用户验收` | 含 `daemon-events.jsonl` 通信日志 |
| 仓库治理：`docs/` 四件套 + 官方 AOCI-CODE 索引 | `待用户验收` | 本轮收口完成 |
