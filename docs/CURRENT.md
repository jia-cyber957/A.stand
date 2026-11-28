# A.stand 当前状态与验收接力棒

- **分支**：`main`（本地领先 `origin/main`，按用户要求先完成阶段性收口并讨论 GitHub 展示文案，获确认后再统一 `git push`）
- **最新纯代码基线**：`84024a9` + 测试修复（2026-11-28）
- **便携桌面包**：`dist-desktop/A.stand/a-stand.exe`（最新 `daemon.mjs` / `desktop.html` / `stdio-bridge.mjs` / `wait-job.mjs` 已同步至 `dist-desktop/A.stand` 与 `%LOCALAPPDATA%\A.stand`）
- **本机数据目录**：`%USERPROFILE%\.astand`（Antigravity 已正式切换直连本地独立版 `a-stand` MCP `http://127.0.0.1:3426/mcp`）

## 最近自动化回归与实机验收结果（全部通过）
- `npm run build`：6 份产物全部通过（`desktop.html` 325.5 KB、`daemon.mjs` 1386.7 KB、`server.mjs` 1189.1 KB）
- `node scripts/test-cli-platform.mjs`：**15/15 PASS**（含 `utf8EnvChecked` 死回环代理剥离、`proxyFingerprint` 切换检测、Junie/Kiro/CodeArts 多账号隔离池）
- `node scripts/test-universal-cli.mjs`：**12/12 PASS**（含 13 预设校验、`session/set_mode` 与 OpenCode 真机实测）
- `node scripts/test-v2-fixes.mjs`：**6/6 PASS**
- `npm run test:v2`：**10/10 PASS**
- `guard_common.py --all --links`：**PASS**（96 文件，0 阻塞，0 警告）
- **实机 8-CLI 全链路端到端实测**：全部 8 个已登录/配置 CLI 实机通过（OpenCode 5.7s、豆包 CLI ACP 8.5s / `-p` 9.5s、MiniMax 8.6s、CodeBuddy 8.6s、Qoder 8.8s、Qoder 国际版 10.7s、Codex 实时 5h/7d 配额拉取恢复、DeepSeek 自定义渠道就绪）；本机共检测就绪 11 个 CLI（另含 JetBrains Junie / AWS Kiro / 华为云 CodeArts 待按需登录）。
- **4K 视觉验收与三区布局定稿**：移除破坏 Windows ClearType 的 `-webkit-font-smoothing: antialiased`，全局升级至 `Segoe UI Variable Text + Microsoft YaHei UI` + `tabular-nums` 配额条，采用 Magpie 浅灰侧栏 + 纯白悬浮选中卡 + 50px 面包屑顶栏，保留「模型供应商」三区布局并完成卡片 4K 锐利化与 `{}` 空详情框清理。

## 四态验收清单
| 功能项 | 当前状态 | 备注 |
|---|---|---|
| 多 CLI 平台（13 官方预设 + Junie/Kiro/CodeArts + 8/8 多账号隔离 + 标准版/国际版双区登录 + 全套官方图标） | `阶段性成品` | 豆包已内嵌官方头像，全界面无敏感地域词（统一标准版/国际版） |
| 通用引擎底座（per-cwd ACP 子进程、死回环代理自动剥离 `utf8EnvChecked`、常驻进程切网自适应重连） | `阶段性成品` | 彻底解决 CodeBuddy 认错目录、死 `127.0.0.1:10808` 代理卡死与 Codex 5h/7d 配额丢失 |
| 实时任务流（Hero CLI 图标、极简上游角标、真实工具标题、去重思考流、过滤空 `{}` 盒、运行中纠偏栏） | `阶段性成品` | 经 Qoder / MiniMax / 豆包实机任务验证 |
| 4K ClearType 桌面控制台（Magpie 侧栏/顶栏 + 经典三区供应商布局 + 不溢出冷却胶囊 + T1 精简白名单） | `阶段性成品` | 亮/暗双主题均已实机自检通过 |
| 协作委托护栏（Claude Code + OMO 主/子 Agent 分工边界、全局 `AGENTS.md` 与 `SKILL.md` 同步） | `阶段性成品` | 已在真实多轮派单中跑通（Qoder / Qoder 国际版 / MiniMax） |
| 仓库治理：`docs/` 四件套 + 官方 AOCI-CODE 增量索引 + 全量隐私安检 | `阶段性成品` | 待讨论 GitHub 展示文案并获用户确认后推送远端 |
