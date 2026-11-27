# A.stand 生效架构决策记录

## D1. 桌面形态：Tauri 2 轻壳 + 复用 Node.js 核心（方案 A）
- **决策**：采用 `desktop/src-tauri`（Rust + WebView2 + `tray-icon`）拉起并托管打包后的 `dist/daemon.mjs`，关闭窗口隐藏至系统托盘，显式点击托盘退出才终止受管守护进程。
- **理由**：安装包极轻（`a-stand.exe` ~6.3 MB，整包 ~7.7 MB），同时 100% 复用 v1 已打磨稳定的引擎适配、Prompt Cache 遥测、Worktree 并行、门铃巡检与耗时账本，避免 Rust/Go 全量重写风险。

## D2. 上游接入协议：Streamable HTTP 主力 + `stdio-bridge.mjs` 兜底
- **决策**：守护进程暴露 `/mcp` Streamable HTTP（Bearer / `X-Astand-Token` 鉴权），同时附带零依赖 `dist/stdio-bridge.mjs` 将 `stdin/stdout` JSON-RPC 转发至同一 `/mcp` 端点；桥进程在 `stdin` EOF 时仅退出自身，绝不关闭守护进程。
- **理由**：Antigravity、Codex CLI、Claude Code、Cursor、WorkBuddy 均支持本地 HTTP；`stdio` 桥兜底可规避 Cursor 本地 HTTP 偶发 OAuth 弹窗及老旧 MCP 客户端限制。

## D3. 上游初始化体验：通用注册码 + 一键 AI 接入 Prompt（替代首批硬编码适配器）
- **决策**：v2.0 不为各家 IDE 维护易碎的配置文件读写器，而是生成带 URL、Token、`stdio` 兜底命令与极简规则的一键 Prompt，由上游 AI 自行完成配置；首次 `initialize` 握手自动匹配内置品牌图标，允许手动改名与换图标。

## D4. Windows Tauri 编译目录默认隔离到 `%TEMP%\astand-tauri-target`
- **决策**：`scripts/package-desktop.mjs` 在 Windows 下未显式指定 `CARGO_TARGET_DIR` 时，默认指向 `%TEMP%\astand-tauri-target`。
- **理由**：规避 Windows Defender 受控文件夹访问在 `Desktop/` 下拦截 Cargo `build_script_build.exe` 调用 `rustc` 的环境坑，且支持秒级增量复用编译产物。

## D5. 门铃活配置动态重载 + 全局脱敏诊断日志体系
- **决策**：`scripts/wait-job.mjs` 轮询动态读取 `settings.json`（长任务巡检实时生效，显式 `--stall-sec` 仅在运行中配置变更后覆盖）；新增自动滚动的 `daemon-events.jsonl` 记录守护进程与上游通信事件，统一汇入设置页「一键导出脱敏诊断包」。

## D6. Worktree 安全双提交 + AOCI 索引维护
- **决策**：并行祝融只改工单内源码与测试，严禁触碰 `docs/` 与 `aoci*`；主 Agent 合并验收后先做 Commit #1（纯代码），再在同一基线统一更新 `docs/CURRENT.md` 与增量 AOCI 索引做 Commit #2。
