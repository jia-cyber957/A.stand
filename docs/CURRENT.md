# A.stand 当前状态与验收接力棒

- **分支**：`main`（本地领先 `origin/main`，按用户要求暂不推送 GitHub，待验收后统一推送）
- **最新纯代码基线**：`7526654`（2026-11-27）
- **便携桌面包**：`dist-desktop/A.stand/a-stand.exe`（最新 `daemon.mjs` / `desktop.html` 已同步至 `dist-desktop/A.stand` 与 `%LOCALAPPDATA%\A.stand`）
- **本机数据目录**：`%USERPROFILE%\.astand`（已手动只读复制旧插件配置；保留原 Antigravity v1 插件双轨并行）

## 最近自动化回归与实机验收结果（全部通过）
- `npm run build`：6 份产物全部通过（`desktop.html` 300.7 KB、`daemon.mjs` 1339.8 KB）
- `node scripts/test-cli-platform.mjs`：**10/10 PASS**
- `node scripts/test-universal-cli.mjs`：**12/12 PASS**（含 OpenCode 真机实测 `hitRate=66%`）
- `node scripts/test-v2-fixes.mjs`：**6/6 PASS**
- `npm run test:v2`：**10/10 PASS**
- `guard_common.py --all --links`：**PASS**（96 文件，0 阻塞，0 警告）
- **实机 7-CLI 全链路验收 + 浏览器视觉验收**：修复 Windows `.cmd` 引号转义（`windowsVerbatimArguments: true`）与 ACP `models.availableModels` 解析后，全部 7 个本机 CLI 在真实守护进程与浏览器界面下全部就绪：Codex (`74` 模型)、DeepSeek 官方账号 (`2` 模型归位至左侧账号区)、OpenCode (`18` 模型)、豆包 CLI (`16` 模型)、MiniMax Code (`4` 模型)、Qoder 中国版 (`14` 模型 / `nick5088404370`)、Qoder 国际版 (`17` 模型 / `kuo jia`)；「模型供应商」三区排版（上 CLI 容器网格 / 下左 CLI 账号与套餐 / 下右纯净 API 渠道）与 5 个 CLI 详情弹窗均无空白/报错。

## 四态验收清单
| 功能项 | 当前状态 | 备注 |
|---|---|---|
| 多 CLI 平台升级（软件内安装/登录、豆包扫码、Qoder 中/国际双卡、极简 3 段详情弹窗、全套 SVG 图标、账号打码、检查更新） | `待用户验收` | 豆包/MiniMax/Qoder 国际已实测登录；Qoder 中国版 `qoderclicn` 已装好待用户在软件内一键登录；禁止伪造用量/额度条 |
| 角色与队列恢复 v1 两级级联选模型（容器 → 按渠道分组模型 + 白名单过滤 + `+ 添加备选`） | `待用户验收` | DSH 按 `DeepSeek 账号` / 各 API 渠道分组，带 `来自 DSH` 标识；未安装引擎灰显直达配置 |
| 实时任务三方视觉区分（用户纠偏气泡 / 子 Agent 步骤 / 卡顿守门员 AI 琥珀盾卡）与运行中纠偏栏 | `待用户验收` | 底部纠偏框直连 `POST /api/session-action`；容错轮换仅限 429/5xx/401，静默卡死保持巡检交主 Agent 诊断 |
| 多 CLI 通用引擎底座（Universal ACP + Headless + 10 官方预设 + 自定义 CLI） | `待用户验收` | OpenCode/豆包/MiniMax 均为原生 ACP v1，Qoder 中国/国际为 Headless |
| v2 常驻守护进程 + 注册制 + AI 接入/剥离 Prompt + 配套 Skill | `待用户验收` | 草稿邀请零污染、接入 Prompt 含 AGENTS.md 与 SKILL.md、对称 AI 剥离 Prompt、极简弹窗 |
| 仿 Magpie 独立桌面控制台（方案 A 实时任务聊天室 + 7 页面） | `待用户验收` | 已重构左右分栏聊天流、零跳动智能吸底、来源上游徽标、真实模型名、真实品牌图标、侧边栏展开修复与高对比度 |
| 技能与扩展中心（Skills / 子 Agent MCP / 模板） | `待用户验收` | 已预置 2 条模块化与防作弊护栏 |
| Tauri 2 原生窗口 + 系统托盘 + 原生深色标题栏 + 正式 `AA` 图标 | `待用户验收` | Rust 壳直接监听 `ui-theme.txt` 在主线程同步 Windows 原生深/浅标题栏并换用正式双线 `AA` 图标 |
| 实战诊断包 4 项 Bug 修复 + 设置页一键脱敏诊断包 | `待用户验收` | 含 `daemon-events.jsonl` 通信日志 |
| 仓库治理：`docs/` 四件套 + 官方 AOCI-CODE 索引 | `待用户验收` | 随代码增量同步 |
