import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

function showFatalError(err) {
  try {
    if (typeof state !== "undefined" && state) return;
    const root = document.getElementById("root");
    if (!root) return;
    const msg = err?.message || err?.reason?.message || String(err?.reason || err || "Unknown UI error");
    const safeMsg = String(msg)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    root.innerHTML = `<div class="app-shell"><div class="card empty-state" style="color:var(--ar-rose,#f43f5e);border-color:rgba(244,63,94,0.35)">A.stand UI Error: ${safeMsg}</div></div>`;
  } catch {}
}

window.addEventListener("error", (ev) => showFatalError(ev.error || ev.message));
window.addEventListener("unhandledrejection", (ev) => showFatalError(ev));

const I18N = {
  zh: {
    brand: "A.stand",
    on: "已开启",
    off: "已关闭",
    tabTeam: "团队",
    tabModels: "模型",
    tabCache: "缓存",
    tabSettings: "设置",
    gateOff: "硬开关已关闭 · 主 Agent 独立完成任务，绝不触发外部子 Agent",
    gateOn: "硬开关已开启 · 主 Agent 自主决策委派并支持不打断巡检",
    liveTitle: "运行中子 Agent（实时动态）",
    recentTitle: "最近任务",
    inspectCue: "查看过程 →",
    jobBack: "← 返回",
    jobRunning: "运行中",
    jobCompleted: "已完成",
    jobFailed: "失败",
    jobCacheHit: "缓存命中",
    copyLogPath: "复制日志路径",
    jobNoSteps: "暂无步骤记录",
    jobLoading: "加载中...",
    jobStreaming: "运行中…",
    jobLeadPrompt: "主 Agent 指令",
    jobFinalResponse: "最终回复",
    jobExitCode: "退出码 %s",
    jobArchived: "历史记录",
    stepError: "错误",
    stepSteer: "指令",
    stepStop: "停止",
    stepFallback: "顺延",
    elapsed: "已耗时",
    silent: "静默",
    stopJob: "停止",
    quotaTitle: "Codex (GPT) 配额窗口",
    win5h: "5 小时窗口",
    win7d: "7 天窗口",
    remaining: "剩余",
    resetsIn: "重置",
    // Display-only mythological pair (internal role ids stay "oracle" / "hephaestus").
    oracleTitle: "白泽",
    oracleSub: "独立审查 · Oracle",
    oracleBadge: "只读 · 可并行",
    oracleDesc: "架构权衡、卡壳诊断、独立 Code Review（严禁改文件）",
    hephTitle: "祝融",
    hephSub: "代码执行 · Hephaestus",
    hephBadge: "可写 · 写互斥",
    hephDesc: "复杂重构、核心逻辑、长循环单测排错（同目录互斥写）",
    primaryAi: "首选 AI 与顺延队列",
    addFallback: "添加备选",
    promote: "设为首选",
    remove: "移除",
    effort: "推理档位",
    low: "低",
    medium: "中",
    high: "高",
    cooldownPrefix: "冷却中",
    balanceDepleted: "余额不足",
    restore: "恢复",
    noSession: "暂无活跃持久化会话（首次调用自动建立）",
    turns: "轮",
    hit: "命中",
    ctx: "上下文",
    compact: "压缩",
    reset: "重置",
    cliSection: "子 Agent 基座（自动检测）",
    apiSection: "API 渠道（DeepSeek Harness & 巡检总结共用）",
    addModel: "添加 API 渠道",
    addApiModel: "添加 API 渠道",
    refresh: "刷新检测",
    ready: "已就绪",
    needLogin: "待登录",
    needNode24: "需 Node >= 24.9",
    notInstalled: "未安装",
    unreadyBadge: "未就绪",
    gotoInstall: "未安装 · 去配置 →",
    gotoLogin: "待登录 · 去配置 →",
    gotoUpgradeNode: "需 Node 24 · 去查看 →",
    sourceDsh: "来自 DSH",
    readOnlyDsh: "DSH 只读",
    manageChannel: "管理",
    changeModels: "增减模型",
    channelName: "渠道名称（可选）",
    autoChannelName: "根据供应商或接口地址自动命名",
    manualModel: "手动输入模型名",
    joinModel: "加入",
    setAsInspector: "设为巡检总结 AI",
    missingBaseUrl: "请填写接口地址",
    saveFailed: "保存失败",
    sourceCustom: "插件自定义",
    modelCountSuffix: "个模型",
    syncedSuffix: "已同步",
    download: "下载",
    copyCmd: "复制命令",
    testConn: "测试连接",
    testing: "测试中...",
    fetchModels: "拉取模型",
    fetching: "拉取中...",
    selectedCount: "已选",
    clearSel: "清空已选",
    fetchEmpty: "没有匹配的模型",
    del: "删除",
    noApiModels: "暂无 API 渠道。",
    dshHintOk: "DeepSeek Harness (dsh) 已就绪（只读同步 ~/.dsh/）",
    dshHintNodeTooOld: "已检测到 dsh，但当前 Node 版本低于 24.9；请升级至 Node 24 LTS 或在对话中让主 Agent 协助配置。",
    dshHintMissing: "子 Agent 调用 API 模型需安装 dsh；若仅用于「巡检总结 AI」则无需安装可直接使用。",
    nodeUpgradeTip: "dsh 需 Node.js >= 24.9，当前为",
    nodeDownloadBtn: "Node.js 官网",
    kpiCumHit: "累计缓存命中率",
    kpiSaved: "累计命中输入 Token",
    kpiLast: "最近一轮命中 / 上下文",
    unreported: "未上报",
    trendTitle: "最近 20 轮缓存命中趋势",
    logTitle: "调用明细日志",
    logEmpty: "暂无调用记录，开启总开关并完成一次协作后实时显示",
    clearLogs: "清空",
    copyPath: "复制路径",
    secConcurrency: "调度与巡检",
    maxConcTitle: "最大并发数",
    maxConcDesc: "全局并行上限；仅只读 Oracle 支持多开，Hephaestus 同目录严格互斥写",
    silentTitle: "静默巡检间隔",
    silentDesc: "子 Agent 连续无吐字、无命令、无改文件时，不打断并通知主 Agent 看一眼",
    longRunTitle: "持续运行巡检",
    longRunDesc: "大任务持续运行时定期向主 Agent 汇报进展（始终不打断）",
    retentionTitle: "记忆保留天数",
    retentionDesc: "仅清理本插件索引；绝不删除 Codex / Claude 等外部 CLI 原生记录",
    minSuffix: "分",
    unlimited: "关闭",
    days7: "7 天",
    days30: "30 天",
    forever: "永久",
    secAutomation: "顺延、总结与兼容",
    autoFbTitle: "限额自动无缝顺延",
    autoFbDesc: "开启则主模型撞限额时自动切备选、到点自动切回；关闭则暂停询问用户",
    inspectorTitle: "卡顿守门员 AI（可选）",
    inspectorDesc: "静默超时时只读任务目标与最后 30 行透视日志，做二选一判定（继续等 / 叫醒主 Agent），绝不越权改代码",
    inspectorEnabledNote: "已开启 · 静默超时时先判「继续等」或「叫醒主 Agent」（绝不越权改代码）",
    inspectorOffHint: "当前关闭（0 费用纯代码结构化提取）；打开开关即可启用",
    inspectorNeedApi: "尚未配置任何 API Key 模型，请先配置（支持一键拉取）：",
    inspectorConfigureBtn: "配置并开启",
    inspectorOff: "关闭（纯代码结构化提取）",
    keepOfficeTitle: "Codex 保留办公插件",
    keepOfficeDesc: "开启保留 PDF / Excel / Word / PPT 插件；关闭则前缀最轻、缓存最稳",
    fullAccessTitle: "允许 Hephaestus 无沙箱运行",
    fullAccessDesc: "默认关闭（严格限制在项目目录沙箱内）；仅限信任项目开启，开启后主 Agent 仅在打包/浏览器等需要时才按需放开（Oracle 永久只读）",
    worktreeTitle: "Git Worktree 并行改代码",
    worktreeDesc: "开启后，同一 Git 仓库可并行运行多个 Hephaestus（各自独立分支目录，互不覆盖）；非 Git 目录自动回退写互斥。默认关闭",
    modalAdd: "添加 API 渠道",
    modalEdit: "管理 API 渠道",
    providerLabel: "供应商（OpenAI 兼容协议 API）",
    selectProvider: "请选择提供商",
    searchPlaceholder: "搜索",
    otherGroup: "其他",
    baseUrlLabel: "接口地址 (Base URL)",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "输入你的 API Key",
    apiKeyKeepPlaceholder: "已保存（留空保持不变）",
    cancel: "取消",
    save: "保存",
    missingBaseOrModel: "请至少选择或添加一个模型",
    missingBaseOrKey: "请先填写接口地址和 API Key",
    keyLooksLikeUrl: "API Key 栏误填了网址，请粘贴实际密钥（如 sk-...）",
    newEndpointKeyRequired: "请为新接口地址输入 API Key。",
    copied: "已复制",
    saved: "已保存",
    deleted: "已删除",
    refreshed: "已刷新",
    connOk: "连接正常",
    connFail: "连接失败",
    warm: "热续聊",
    resumed: "恢复",
    fresh: "新会话",
    // X-ray timeline
    stepThought: "思考",
    stepThinkingNow: "思考中…",
    xrayHint: "透视时间线：思考 / 命令 / 文件 / 检索全量可见",
    // Antigravity-native collapsible timeline
    stepThoughtFor: "思考了 %s",
    stepThinking: "思考中 %s…",
    stepAnalyzed: "已分析",
    stepEdited: "已编辑",
    stepCreated: "已新建",
    stepSearched: "已搜索",
    stepRan: "运行",
    stepInPath: "于 %s",
    // Interrupted jobs banner
    interruptedTitle: "意外中断",
    interruptedDesc: "宿主/MCP 在任务运行中退出。保留 sessionId 与原工作区，可一键复制续跑指令。",
    interruptedLast: "最后步骤",
    interruptedSession: "会话",
    copyResumePrompt: "复制续跑指令",
    resumePrompt: "继续上次中断的任务（sessionId=%s），先检查当前工作区改动再接着完成。",
    dismiss: "知道了",
    dismissAll: "全部忽略",
    jobInterrupted: "已中断",
    // Async background mode
    asyncTitle: "后台异步模式（边干边聊）",
    asyncDesc: "开启后派活 1 秒解锁聊天框、后台挂零消耗门铃，干完或卡死自动唤醒主 Agent；默认关闭",
    asyncOnNote: "已开启 · 派活立即返回 jobId + 门铃命令，主 Agent 挂后台后即可继续对话",
    asyncOffNote: "当前关闭（默认同步等待与巡检）；打开开关即可边干边聊",
    inspectorEnabledTitle: "启用巡检 AI（默认关闭）",
    inspectorEnabledDesc: "默认关闭，直接依赖透视日志与静默超时告警；开启后仅在卡死/报错时调用巡检模型",
    inspectorEnabledOn: "已开启 · 静默超时时先读最后 30 行透视日志，只判「继续等」或「叫醒主 Agent」",
    inspectorEnabledOff: "当前关闭（0 费用，静默超时后直接拉响门铃叫醒主 Agent）",
  },
  en: {
    brand: "A.stand",
    on: "Active",
    off: "Off",
    tabTeam: "Team",
    tabModels: "Models",
    tabCache: "Cache",
    tabSettings: "Settings",
    gateOff: "Master switch OFF · Lead agent works solo with zero external calls",
    gateOn: "Master switch ON · Lead agent delegates autonomously with live check-ins",
    liveTitle: "Running Subagents (Live Activity)",
    recentTitle: "Recent Jobs",
    inspectCue: "Inspect →",
    jobBack: "← Back",
    jobRunning: "Running",
    jobCompleted: "Completed",
    jobFailed: "Failed",
    jobCacheHit: "Cache hit",
    copyLogPath: "Copy Log Path",
    jobNoSteps: "No steps recorded yet",
    jobLoading: "Loading...",
    jobStreaming: "Working",
    jobLeadPrompt: "Message from Lead Agent",
    jobFinalResponse: "Final Response",
    jobExitCode: "Exited with code %s",
    jobArchived: "Archived",
    stepError: "Error",
    stepSteer: "Steer",
    stepStop: "Stop",
    stepFallback: "Fallback",
    elapsed: "elapsed",
    silent: "silent",
    stopJob: "Stop",
    quotaTitle: "Codex (GPT) Quota Windows",
    win5h: "5h Window",
    win7d: "7d Window",
    remaining: "left",
    resetsIn: "Resets",
    oracleTitle: "Oracle",
    oracleSub: "",
    oracleBadge: "Read-Only · Parallel",
    oracleDesc: "Architecture tradeoffs, 2-strike debugging, independent code review",
    hephTitle: "Hephaestus",
    hephSub: "",
    hephBadge: "Write · Mutex",
    hephDesc: "Multi-file refactors, core logic, long test loops (workspace write-mutex)",
    primaryAi: "Primary AI & Priority Queue",
    addFallback: "Add fallback",
    promote: "Make primary",
    remove: "Remove",
    effort: "Reasoning Effort",
    low: "Low",
    medium: "Medium",
    high: "High",
    cooldownPrefix: "Cooldown",
    balanceDepleted: "Balance depleted",
    restore: "Restore",
    noSession: "No active persistent session yet (created on first call)",
    turns: "turns",
    hit: "hit",
    ctx: "ctx",
    compact: "Compact",
    reset: "Reset",
    cliSection: "Subagent Harnesses (Auto-Detected)",
    apiSection: "API Channels (DSH & Inspector AI)",
    addModel: "Add API Channel",
    addApiModel: "Add API Channel",
    refresh: "Re-scan",
    ready: "Ready",
    needLogin: "Login Required",
    needNode24: "Node >= 24.9 Req",
    notInstalled: "Not Installed",
    unreadyBadge: "Not Ready",
    gotoInstall: "Not installed · Setup →",
    gotoLogin: "Login req · Setup →",
    gotoUpgradeNode: "Node 24 req · Setup →",
    sourceDsh: "From DSH",
    readOnlyDsh: "DSH · Read-only",
    manageChannel: "Manage",
    changeModels: "Edit Models",
    channelName: "Channel Name (optional)",
    autoChannelName: "Defaults to the provider or endpoint hostname",
    manualModel: "Enter a model name manually",
    joinModel: "Add",
    setAsInspector: "Set as Inspector Summarizer AI",
    missingBaseUrl: "Enter the Base URL",
    saveFailed: "Save failed",
    sourceCustom: "Custom",
    modelCountSuffix: "models",
    syncedSuffix: "synced",
    download: "Install Docs",
    copyCmd: "Copy Cmd",
    testConn: "Test Connection",
    testing: "Testing...",
    fetchModels: "Fetch Models",
    fetching: "Fetching...",
    selectedCount: "Selected",
    clearSel: "Clear",
    fetchEmpty: "No matching models",
    del: "Delete",
    noApiModels: "No API channels yet.",
    dshHintOk: "DeepSeek Harness (dsh) is ready (read-only ~/.dsh/ sync)",
    dshHintNodeTooOld: "dsh is installed, but Node.js < 24.9. Upgrade to Node 24 LTS or ask the main agent for setup options.",
    dshHintMissing: "DeepSeek Harness (dsh) is needed to run API models as subagents; Inspector AI works immediately without dsh.",
    nodeUpgradeTip: "dsh requires Node.js >= 24.9; current",
    nodeDownloadBtn: "Node.js",
    kpiCumHit: "Cumulative Cache Hit",
    kpiSaved: "Cached Input Tokens",
    kpiLast: "Last Turn / Context",
    unreported: "Unreported",
    trendTitle: "Recent 20-Turn Cache Hit Rate",
    logTitle: "Telemetry Log",
    logEmpty: "No turns recorded yet. Enable the master switch to see live cache metrics.",
    clearLogs: "Clear",
    copyPath: "Copy Path",
    secConcurrency: "Concurrency & Non-Interrupting Check-ins",
    maxConcTitle: "Max Concurrent Jobs",
    maxConcDesc: "Global cap; only read-only Oracle runs parallel, Hephaestus is write-mutex guarded",
    silentTitle: "Silent Check-in Interval",
    silentDesc: "Notify lead agent (without interrupting) if no output/cmds/edits happen for N mins",
    longRunTitle: "Long-Run Check-in",
    longRunDesc: "Periodic non-interrupting progress check-in during long tasks",
    retentionTitle: "Session Index Retention",
    retentionDesc: "Prunes A.stand index only; never deletes external CLI transcripts",
    minSuffix: "m",
    unlimited: "Off",
    days7: "7d",
    days30: "30d",
    forever: "Forever",
    secAutomation: "Fallback, Inspector & Compatibility",
    autoFbTitle: "Auto-Fallback on Quota Limit",
    autoFbDesc: "On: seamlessly switch to fallback & restore on reset. Off: pause and ask user",
    inspectorTitle: "Stall Gatekeeper AI (Optional)",
    inspectorDesc: "On silence timeout, reads only task goal + last 30 X-ray lines to decide CONTINUE vs ALERT (never edits or steers)",
    inspectorEnabledNote: "On · On silence timeout, decides CONTINUE vs ALERT without touching code",
    inspectorOffHint: "Off (0-token structured extraction); toggle on to enable",
    inspectorNeedApi: "No API Key models configured yet. Add one first:",
    inspectorConfigureBtn: "Configure & Enable",
    inspectorOff: "Off (Code structured extraction)",
    keepOfficeTitle: "Keep Codex Office Plugins",
    keepOfficeDesc: "Keep PDF / Excel / Word / PPT plugins; off keeps prefix leanest for cache",
    fullAccessTitle: "Allow Hephaestus Full Access (No Sandbox)",
    fullAccessDesc: "Off by default (workspace-write sandbox). Enable only for trusted workspaces so the lead agent can opt out of sandbox for builds/browsers (Oracle is always read-only)",
    worktreeTitle: "Git Worktree Parallel Writers",
    worktreeDesc: "Allow multiple Hephaestus jobs on the same Git repo via isolated worktree branches (auto-pruned if clean; non-Git dirs stay write-mutex guarded). Off by default",
    modalAdd: "Add API Channel",
    modalEdit: "Manage API Channel",
    providerLabel: "Provider (OpenAI-compatible API)",
    selectProvider: "Select a provider",
    searchPlaceholder: "Search",
    otherGroup: "Other",
    baseUrlLabel: "Base URL",
    apiKeyLabel: "API Key",
    apiKeyPlaceholder: "Enter your API Key",
    apiKeyKeepPlaceholder: "Saved (leave blank to keep)",
    cancel: "Cancel",
    save: "Save",
    missingBaseOrModel: "Select or add at least one model",
    missingBaseOrKey: "Base URL and API Key are required first",
    keyLooksLikeUrl: "API Key looks like a URL — paste your secret key (e.g. sk-...) instead",
    newEndpointKeyRequired: "Enter an explicit API key for the new endpoint.",
    copied: "Copied",
    saved: "Saved",
    deleted: "Deleted",
    refreshed: "Refreshed",
    connOk: "Connected",
    connFail: "Failed",
    warm: "warm",
    resumed: "resumed",
    fresh: "new",
    // X-ray timeline
    stepThought: "Thought",
    stepThinkingNow: "Thinking…",
    xrayHint: "X-ray timeline: thoughts, commands, files and searches fully visible",
    // Antigravity-native collapsible timeline
    stepThoughtFor: "Thought for %s",
    stepThinking: "Thinking %s…",
    stepAnalyzed: "Analyzed",
    stepEdited: "Edited",
    stepCreated: "Created",
    stepSearched: "Searched",
    stepRan: "Ran",
    stepInPath: "in %s",
    // Interrupted jobs banner
    interruptedTitle: "Interrupted",
    interruptedDesc: "The host/MCP exited while this job was running. The sessionId and workspace are intact — copy the resume prompt to continue.",
    interruptedLast: "Last step",
    interruptedSession: "Session",
    copyResumePrompt: "Copy Resume Prompt",
    resumePrompt: "Continue the previous interrupted task (sessionId=%s); inspect the current workspace diff first, then finish it.",
    dismiss: "Dismiss",
    dismissAll: "Dismiss all",
    jobInterrupted: "Interrupted",
    // Async background mode
    asyncTitle: "Async Background Mode (chat while working)",
    asyncDesc: "On: launching returns in ~1s and unlocks the chat box, a zero-token doorbell runs in the background and wakes the Lead Agent on completion or stall. Off by default.",
    asyncOnNote: "On · launches return jobId + a doorbell command instantly; the Lead Agent can keep chatting right away",
    asyncOffNote: "Off (default blocking waits & check-ins). Toggle on to chat while subagents work",
    inspectorEnabledTitle: "Enable Inspector AI (default off)",
    inspectorEnabledDesc: "Off by default — rely on the X-ray timeline and silent-timeout alerts; when on, the inspector model is only called on stalls/errors.",
    inspectorEnabledOn: "On · Reads task goal + last 30 X-ray lines on silence to return CONTINUE or ALERT only",
    inspectorEnabledOff: "Off (zero cost — silence timeout wakes Lead Agent directly)",
  },
};

const ALLOWED_STYLE_VARS = new Set([
  "--color-background-primary",
  "--color-background-secondary",
  "--color-background-tertiary",
  "--color-background-inverse",
  "--color-background-ghost",
  "--color-background-info",
  "--color-background-danger",
  "--color-background-success",
  "--color-background-warning",
  "--color-background-disabled",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-tertiary",
  "--color-text-inverse",
  "--color-text-ghost",
  "--color-text-info",
  "--color-text-danger",
  "--color-text-success",
  "--color-text-warning",
  "--color-text-disabled",
  "--color-border-primary",
  "--color-border-secondary",
  "--color-border-tertiary",
  "--color-border-inverse",
  "--color-border-ghost",
  "--color-border-info",
  "--color-border-danger",
  "--color-border-success",
  "--color-border-warning",
  "--color-border-disabled",
  "--color-ring-primary",
  "--color-ring-secondary",
  "--color-ring-inverse",
  "--color-ring-info",
  "--color-ring-danger",
  "--color-ring-success",
  "--color-ring-warning",
  "--font-sans",
  "--font-mono",
  "--font-weight-normal",
  "--font-weight-medium",
  "--font-weight-semibold",
  "--font-weight-bold",
  "--font-text-xs-size",
  "--font-text-sm-size",
  "--font-text-md-size",
  "--font-text-lg-size",
  "--font-heading-xs-size",
  "--font-heading-sm-size",
  "--font-heading-md-size",
  "--font-heading-lg-size",
  "--font-heading-xl-size",
  "--font-heading-2xl-size",
  "--font-heading-3xl-size",
  "--font-text-xs-line-height",
  "--font-text-sm-line-height",
  "--font-text-md-line-height",
  "--font-text-lg-line-height",
  "--font-heading-xs-line-height",
  "--font-heading-sm-line-height",
  "--font-heading-md-line-height",
  "--font-heading-lg-line-height",
  "--font-heading-xl-line-height",
  "--font-heading-2xl-line-height",
  "--font-heading-3xl-line-height",
  "--border-radius-xs",
  "--border-radius-sm",
  "--border-radius-md",
  "--border-radius-lg",
  "--border-radius-xl",
  "--border-radius-full",
  "--border-width-regular",
  "--shadow-hairline",
  "--shadow-sm",
  "--shadow-md",
  "--shadow-lg",
]);

function isPlainObj(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function applyRawCssVars(vars) {
  if (!isPlainObj(vars)) return;
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === "string") {
      try {
        document.documentElement.style.setProperty(k, v);
      } catch {}
    }
  }
}

let rawHostContext = null;
let handshakeDiag = null;
let reportedDiag = false;

function sanitizeHostContext(rawCtx, strippedOut) {
  if (!isPlainObj(rawCtx)) return {};
  const known = new Set([
    "toolInfo",
    "theme",
    "styles",
    "displayMode",
    "availableDisplayModes",
    "containerDimensions",
    "locale",
    "timeZone",
    "userAgent",
    "platform",
    "deviceCapabilities",
    "safeAreaInsets",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(rawCtx)) {
    if (!known.has(k) && v !== null && v !== undefined) out[k] = v;
  }
  if (rawCtx.theme === "light" || rawCtx.theme === "dark") out.theme = rawCtx.theme;
  if (rawCtx.platform === "web" || rawCtx.platform === "desktop" || rawCtx.platform === "mobile") {
    out.platform = rawCtx.platform;
  }
  if (rawCtx.displayMode === "inline" || rawCtx.displayMode === "fullscreen" || rawCtx.displayMode === "pip") {
    out.displayMode = rawCtx.displayMode;
  }
  if (Array.isArray(rawCtx.availableDisplayModes)) {
    const valid = rawCtx.availableDisplayModes.filter((d) => d === "inline" || d === "fullscreen" || d === "pip");
    if (valid.length > 0) out.availableDisplayModes = valid;
  }
  for (const sk of ["locale", "timeZone", "userAgent"]) {
    if (typeof rawCtx[sk] === "string") out[sk] = rawCtx[sk];
  }
  if (
    isPlainObj(rawCtx.toolInfo) &&
    isPlainObj(rawCtx.toolInfo.tool) &&
    typeof rawCtx.toolInfo.tool.name === "string" &&
    isPlainObj(rawCtx.toolInfo.tool.inputSchema)
  ) {
    const ti = { tool: rawCtx.toolInfo.tool };
    if (typeof rawCtx.toolInfo.id === "string" || typeof rawCtx.toolInfo.id === "number") {
      ti.id = rawCtx.toolInfo.id;
    }
    out.toolInfo = ti;
  }
  if (isPlainObj(rawCtx.containerDimensions)) {
    const cd = {};
    const d = rawCtx.containerDimensions;
    if (typeof d.height === "number" && Number.isFinite(d.height)) cd.height = d.height;
    else if (typeof d.maxHeight === "number" && Number.isFinite(d.maxHeight)) cd.maxHeight = d.maxHeight;
    if (typeof d.width === "number" && Number.isFinite(d.width)) cd.width = d.width;
    else if (typeof d.maxWidth === "number" && Number.isFinite(d.maxWidth)) cd.maxWidth = d.maxWidth;
    out.containerDimensions = cd;
  }
  if (isPlainObj(rawCtx.deviceCapabilities)) {
    const dc = {};
    if (typeof rawCtx.deviceCapabilities.touch === "boolean") dc.touch = rawCtx.deviceCapabilities.touch;
    if (typeof rawCtx.deviceCapabilities.hover === "boolean") dc.hover = rawCtx.deviceCapabilities.hover;
    out.deviceCapabilities = dc;
  }
  if (isPlainObj(rawCtx.safeAreaInsets)) {
    const sa = rawCtx.safeAreaInsets;
    if (["top", "right", "bottom", "left"].every((k) => typeof sa[k] === "number" && Number.isFinite(sa[k]))) {
      out.safeAreaInsets = { top: sa.top, right: sa.right, bottom: sa.bottom, left: sa.left };
    }
  }
  if (isPlainObj(rawCtx.styles)) {
    const cleanStyles = {};
    if (isPlainObj(rawCtx.styles.variables)) {
      applyRawCssVars(rawCtx.styles.variables);
      const cleanVars = {};
      for (const [k, v] of Object.entries(rawCtx.styles.variables)) {
        if (ALLOWED_STYLE_VARS.has(k) && typeof v === "string") {
          cleanVars[k] = v;
        } else if (strippedOut) {
          strippedOut.push(k);
        }
      }
      cleanStyles.variables = cleanVars;
    }
    if (isPlainObj(rawCtx.styles.css) && typeof rawCtx.styles.css.fonts === "string") {
      cleanStyles.css = { fonts: rawCtx.styles.css.fonts };
    }
    if (cleanStyles.variables || cleanStyles.css) out.styles = cleanStyles;
  }
  return out;
}

function sanitizeHostCapabilities(rawCaps) {
  if (!isPlainObj(rawCaps)) return {};
  const out = {};
  for (const k of ["openLinks", "downloadFile", "logging"]) {
    if (rawCaps[k] === true || isPlainObj(rawCaps[k])) out[k] = {};
  }
  for (const k of ["serverTools", "serverResources"]) {
    if (rawCaps[k] === true) out[k] = {};
    else if (isPlainObj(rawCaps[k])) {
      out[k] = typeof rawCaps[k].listChanged === "boolean" ? { listChanged: rawCaps[k].listChanged } : {};
    }
  }
  for (const k of ["updateModelContext", "message"]) {
    if (rawCaps[k] === true) out[k] = {};
    else if (isPlainObj(rawCaps[k])) {
      const m = {};
      for (const mk of ["text", "image", "audio", "resource", "resourceLink", "structuredContent"]) {
        if (rawCaps[k][mk] === true || isPlainObj(rawCaps[k][mk])) m[mk] = {};
      }
      out[k] = m;
    }
  }
  if (rawCaps.sampling === true) out.sampling = {};
  else if (isPlainObj(rawCaps.sampling)) {
    out.sampling =
      rawCaps.sampling.tools === true || isPlainObj(rawCaps.sampling.tools) ? { tools: {} } : {};
  }
  if (isPlainObj(rawCaps.sandbox)) out.sandbox = {};
  if (isPlainObj(rawCaps.experimental)) {
    const exp = {};
    for (const [ek, ev] of Object.entries(rawCaps.experimental)) {
      if (isPlainObj(ev)) exp[ek] = ev;
    }
    if (Object.keys(exp).length > 0) out.experimental = exp;
  }
  return out;
}

function sanitizeToolResult(rawRes) {
  if (!isPlainObj(rawRes)) return { content: [] };
  const out = { ...rawRes };
  if (!Array.isArray(out.content)) out.content = [];
  if (out.isError !== undefined && typeof out.isError !== "boolean") delete out.isError;
  return out;
}

function createCompatibleTransport() {
  const inner = new PostMessageTransport(window.parent, window.parent);
  const initReqIds = new Set();
  const toolCallReqIds = new Set();
  let userOnMessage;

  function sanitizeIncoming(msg) {
    if (!isPlainObj(msg)) return msg;
    if ("result" in msg && initReqIds.has(msg.id) && isPlainObj(msg.result)) {
      initReqIds.delete(msg.id);
      const r = msg.result;
      const strippedVars = [];
      const rawVars = isPlainObj(r.hostContext?.styles?.variables) ? r.hostContext.styles.variables : null;
      if (isPlainObj(r.hostContext)) {
        rawHostContext = r.hostContext;
        applyRawCssVars(rawVars);
      }
      handshakeDiag = {
        protocolVersion: typeof r.protocolVersion === "string" ? r.protocolVersion : String(r.protocolVersion || ""),
        hostInfo: isPlainObj(r.hostInfo) ? r.hostInfo : null,
        hostContextKeys: isPlainObj(r.hostContext) ? Object.keys(r.hostContext) : [],
        rawVarCount: rawVars ? Object.keys(rawVars).length : 0,
        strippedVars,
      };
      return {
        ...msg,
        result: {
          ...r,
          protocolVersion:
            typeof r.protocolVersion === "string" && r.protocolVersion ? r.protocolVersion : "2026-01-26",
          hostInfo: {
            ...(isPlainObj(r.hostInfo) ? r.hostInfo : {}),
            name: String(r.hostInfo?.name || "host"),
            version: String(r.hostInfo?.version || "0.0.0"),
          },
          hostCapabilities: sanitizeHostCapabilities(r.hostCapabilities),
          hostContext: sanitizeHostContext(r.hostContext, strippedVars),
        },
      };
    }
    if ("result" in msg && toolCallReqIds.has(msg.id)) {
      toolCallReqIds.delete(msg.id);
      return { ...msg, result: sanitizeToolResult(msg.result) };
    }
    if (msg.method === "ui/notifications/host-context-changed" && isPlainObj(msg.params)) {
      rawHostContext = { ...(rawHostContext || {}), ...msg.params };
      applyRawCssVars(msg.params.styles?.variables);
      return { ...msg, params: sanitizeHostContext(msg.params) };
    }
    if (msg.method === "ui/notifications/tool-result") {
      return { ...msg, params: sanitizeToolResult(msg.params) };
    }
    return msg;
  }

  return {
    start() {
      return inner.start();
    },
    send(msg, options) {
      if (msg?.method === "ui/initialize" && msg.id !== undefined) initReqIds.add(msg.id);
      if (msg?.method === "tools/call" && msg.id !== undefined) toolCallReqIds.add(msg.id);
      return inner.send(msg, options);
    },
    close() {
      return inner.close();
    },
    set onmessage(fn) {
      userOnMessage = fn;
      inner.onmessage = fn ? (msg, extra) => fn(sanitizeIncoming(msg), extra) : undefined;
    },
    get onmessage() {
      return userOnMessage;
    },
    set onclose(fn) {
      inner.onclose = fn;
    },
    get onclose() {
      return inner.onclose;
    },
    set onerror(fn) {
      inner.onerror = fn;
    },
    get onerror() {
      return inner.onerror;
    },
    get sessionId() {
      return inner.sessionId;
    },
    setProtocolVersion(v) {
      return inner.setProtocolVersion?.(v);
    },
  };
}

const app = new App({ name: "A.stand", version: "1.0.0" }, {});

let state = null;
let liveTimer = null;
let ui = {
  tab: "team",
  openDropdownRole: null,
  openFallbackRole: null,
  inspectorDropdownOpen: false,
  expandedHarness: null,
  highlightEngine: null,
  expandedChannels: new Set(),
  modal: null,
  providerDropdownOpen: false,
  providerSearch: "",
  showApiKey: false,
  testing: false,
  testResult: null,
  fetchingModels: false,
  fetchError: "",
  saveError: "",
  fetchedModels: [],
  fetchSearch: "",
  selectedFetchedModels: new Set(),
  toast: "",
  toastTimer: null,
  detailJobId: null,
  detailJob: null,
  detailLoading: false,
  detailError: "",
  // Expanded timeline step ids (persist across the 2s live poll; cleared when the detail closes).
  expandedStepIds: new Set(),
};

function t(key) {
  const lang = state?.settings?.lang === "en" ? "en" : "zh";
  return I18N[lang][key] || key;
}

function showToast(msg) {
  ui.toast = msg;
  if (ui.toastTimer) clearTimeout(ui.toastTimer);
  render();
  ui.toastTimer = setTimeout(() => {
    ui.toast = "";
    render();
  }, 2200);
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return "";
  }
}

function fmtCountdown(ms) {
  if (!ms) return "";
  const diff = ms - Date.now();
  const hhmm = new Date(ms).toTimeString().slice(0, 5);
  if (diff <= 0) return hhmm;
  const mins = Math.ceil(diff / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${hhmm} (${h}h${m}m)` : `${hhmm} (${m}m)`;
}

function copyText(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast(t("copied"))).catch(() => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast(t("copied"));
  }
}

async function openExternal(url) {
  const caps = app.getHostCapabilities?.();
  if (caps?.openLinks) {
    try {
      await app.openLink({ url });
      return;
    } catch {}
  }
  copyText(url);
}

let livePollInFlight = false;
let lastRenderedSig = "";
let visibilityBound = false;

function computeStateSig(st) {
  if (!st) return "";
  const jobsSig = (st.activeJobs || [])
    .map((j) => {
      const acts = j.recentActivities || [];
      const lastAct = acts.length ? acts[acts.length - 1]?.ts || "" : "";
      return `${j.jobId}:${Math.floor(j.elapsedSec || 0)}:${Math.floor(j.silentSec || 0)}:${acts.length}:${lastAct}`;
    })
    .join("|");
  const sessSig = (st.sessions || [])
    .map((s) => `${s.sessionId}:${s.title || ""}:${s.turns}:${s.lastHitRate}:${s.contextPct ?? ""}:${s.updatedAt || ""}`)
    .join("|");
  return [
    st.settings?.enabled ? 1 : 0,
    st.telemetry?.totalTurns || 0,
    st.telemetry?.cumulativeHitRate ?? "",
    st.codexRateLimits?.updatedAt || "",
    (st.channels || st.settings?.channels || []).length,
    jobsSig,
    sessSig,
  ].join("#");
}

function scheduleNextPoll() {
  if (liveTimer) {
    clearTimeout(liveTimer);
    liveTimer = null;
  }
  if (typeof document !== "undefined" && document.hidden) return;
  const detailOpen = Boolean(ui.detailJobId);
  const hasJobs = Boolean(state?.activeJobs?.length) || detailOpen;
  const delayMs = detailOpen || hasJobs ? 2000 : 4000;
  liveTimer = setTimeout(async () => {
    liveTimer = null;
    if (typeof document !== "undefined" && document.hidden) return;
    if (!livePollInFlight) {
      livePollInFlight = true;
      try {
        await callTool("agent_relay_ui_get_state", { forceDetect: false, fetchRateLimits: false });
        if (ui.detailJobId) await refreshJobDetail({ silent: true });
        const sig = computeStateSig(state);
        const uiBusy = Boolean(ui.modal || ui.openMenu || ui.inspectorDropdownOpen);
        if (!uiBusy && sig !== lastRenderedSig) {
          lastRenderedSig = sig;
          render();
        }
      } catch {}
      livePollInFlight = false;
    }
    scheduleNextPoll();
  }, delayMs);
}

// Load (or silently refresh) the in-panel job timeline. Keeps prior data on transient errors.
async function refreshJobDetail({ silent = false } = {}) {
  const jobId = ui.detailJobId;
  if (!jobId) return;
  if (!silent) {
    ui.detailLoading = true;
    render();
  }
  try {
    const res = await app.callServerTool({ name: "agent_relay_ui_get_job_detail", arguments: { jobId } });
    const sc = res?.structuredContent;
    if (ui.detailJobId !== jobId) return;
    if (sc?.ok && sc.job) {
      ui.detailJob = sc.job;
      ui.detailError = "";
    } else if (!silent) {
      ui.detailError = sc?.error || t("jobLoading");
    }
  } catch (err) {
    if (!silent) ui.detailError = err?.message || String(err);
  } finally {
    if (ui.detailJobId === jobId) {
      ui.detailLoading = false;
      render();
    }
  }
}

function syncLivePolling() {
  if (typeof document !== "undefined" && !visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleNextPoll();
      else if (liveTimer) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
    });
  }
  scheduleNextPoll();
}

async function callTool(name, args = {}) {
  const res = await app.callServerTool({ name, arguments: args });
  if (res?.structuredContent) {
    if (res.structuredContent.settings) {
      state = res.structuredContent;
      syncLivePolling();
    }
    return res.structuredContent;
  }
  return res;
}

function applyTheme(ctx) {
  if (!ctx) return;
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.documentElement.setAttribute("data-theme", ctx.theme);
  }
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

function iconSvg(kind) {
  const svgs = {
    brand: `<svg width="20" height="20" viewBox="16 18 96 88" fill="currentColor" aria-hidden="true"><path d="M77 28L108 98H96.5L77 52.5L57.5 98H46.5L77 28Z" opacity=".5"/><path d="M40 72H94C99 72 103 76 105 82H95C93 79 90 78 86 78H38L40 72Z" opacity=".7"/><path d="M51 28L82 98H70L51 53.5L32 98H20.5L51 28Z"/></svg>`,
    oracle: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    hephaestus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.7 6.3 3 3-9.4 9.4-3.8.8.8-3.8 9.4-9.4Z"/><path d="m12.5 8.5 3 3"/></svg>`,
    chevron: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    chevronRight: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
    check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    refresh: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>`,
    plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    close: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    eye: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.2 3.2M6.6 6.6A13.5 13.5 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20"/></svg>`,
    copy: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`,
    file: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/></svg>`,
    search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  };
  return svgs[kind] || "";
}

const HARNESS_ORDER = ["codex", "claude-code", "antigravity", "deepseek-harness"];

function harnessTitle(eid) {
  const map = {
    codex: "Codex",
    "claude-code": "Claude Code",
    antigravity: "Antigravity CLI",
    "deepseek-harness": "DeepSeek Harness",
  };
  return map[eid] || eid;
}

function isHarnessReady(eid) {
  const eng = state?.engines?.[eid];
  if (!eng) return false;
  return eng.status === "ready";
}

function harnessDotColor(eid) {
  const eng = state?.engines?.[eid];
  if (!eng) return "var(--ar-text-3)";
  if (eng.status === "ready") return "var(--ar-emerald)";
  if (eng.status === "unauthenticated" || eng.status === "node_too_old") return "var(--ar-amber)";
  return "var(--ar-text-3)";
}

function harnessSetupTag(eid) {
  const eng = state?.engines?.[eid];
  if (!eng || !eng.installed) return t("gotoInstall");
  if (eng.status === "node_too_old") return t("gotoUpgradeNode");
  return t("gotoLogin");
}

function getApiLibraryModels() {
  const dshList = state?.dshModels || [];
  const customList = (state?.settings?.models || []).filter((m) => m.mode === "api" && !m.builtin);
  return [...dshList, ...customList];
}

function getApiChannels() {
  const custom = state?.channels || state?.settings?.channels;
  let customChannels = Array.isArray(custom) ? custom : [];
  // Graceful fallback if UI loaded ahead of an older resident MCP server without settings.channels
  if (!Array.isArray(custom)) {
    const legacy = (state?.settings?.models || []).filter((m) => m.mode === "api" && !m.builtin);
    const byKey = new Map();
    for (const m of legacy) {
      const k = `${m.providerId || "custom"}::${m.baseUrl || ""}::${m.maskedApiKey || ""}`;
      if (!byKey.has(k)) {
        let host = m.providerId || "custom";
        try {
          host = new URL(m.baseUrl).hostname || host;
        } catch {}
        byKey.set(k, {
          id: `legacy-${byKey.size}`,
          name: host,
          providerId: m.providerId || "custom",
          baseUrl: m.baseUrl || "",
          hasApiKey: Boolean(m.hasApiKey),
          maskedApiKey: m.maskedApiKey || "",
          source: "custom",
          models: [],
        });
      }
      byKey.get(k).models.push({ id: m.id, modelName: m.modelName || m.name || "" });
    }
    customChannels = Array.from(byKey.values());
  }
  return [...customChannels, ...(state?.dshChannels || [])];
}

function renderChannelGroups(models, renderModel) {
  const groups = new Map();
  for (const model of models) {
    const id = model.channelId || model.providerId;
    if (!groups.has(id)) groups.set(id, { name: model.channelName || model.providerId, models: [] });
    groups.get(id).models.push(model);
  }
  return Array.from(groups.values(), (group) => `
    <div class="channel-group">
      <div class="channel-group-title">${esc(group.name)}</div>
      ${group.models.map(renderModel).join("")}
    </div>`).join("");
}

function getModelsForHarness(eid) {
  const langEn = state?.settings?.lang === "en";
  if (eid === "codex") {
    return (state?.codexModels || []).map((m) => ({
      id: m.id,
      engine: "codex",
      mode: "cli",
      modelName: m.modelName,
      isDefault: Boolean(m.isDefault),
      name: m.displayName || m.modelName,
      ready: isHarnessReady("codex"),
    }));
  }
  if (eid === "deepseek-harness") {
    return getApiLibraryModels().map((m) => ({
      ...m,
      ready: isHarnessReady("deepseek-harness") && (m.source === "dsh" || Boolean(m.hasApiKey)),
    }));
  }
  return (state?.cliSubModels?.[eid] || []).map((m) => ({
    id: m.id,
    engine: eid,
    mode: "cli",
    modelName: m.modelName || "",
    isDefault: Boolean(m.isDefault),
    name: !langEn && m.displayNameZh ? m.displayNameZh : m.displayName || m.modelName || eid,
    ready: isHarnessReady(eid),
  }));
}

function resolveModelMeta(modelId) {
  if (!modelId) return null;
  if (modelId === "cli-codex-default") {
    const defCodex = (state?.codexModels || []).find((m) => m.isDefault || m.id === "cli-codex-default");
    const detected = defCodex?.displayName || defCodex?.modelName || state?.engines?.codex?.detectedModel || "gpt-6.2-sol";
    return {
      id: "cli-codex-default",
      name: detected,
      mode: "cli",
      engine: "codex",
      modelName: defCodex?.modelName || detected,
      ready: isHarnessReady("codex"),
    };
  }
  for (const eid of HARNESS_ORDER) {
    const hit = getModelsForHarness(eid).find((m) => m.id === modelId);
    if (hit) return { ...hit, ready: hit.ready !== false && isHarnessReady(eid) };
  }
  const direct = (state?.settings?.models || []).find((m) => m.id === modelId);
  if (direct) return { ...direct, ready: isHarnessReady(direct.engine) };
  if (modelId.startsWith("cli:")) {
    const rest = modelId.slice(4);
    const sep = rest.indexOf(":");
    if (sep > 0) {
      const engine = rest.slice(0, sep);
      const modelName = rest.slice(sep + 1);
      return {
        id: modelId,
        name: modelName,
        mode: "cli",
        engine,
        modelName,
        ready: isHarnessReady(engine),
      };
    }
  }
  if (modelId.startsWith("dsh:")) {
    const rest = modelId.slice(4);
    const sep = rest.indexOf(":");
    const providerId = sep > 0 ? rest.slice(0, sep) : "dsh";
    const modelName = sep > 0 ? rest.slice(sep + 1) : rest;
    return {
      id: modelId,
      name: modelName,
      mode: "api",
      engine: "deepseek-harness",
      providerId,
      modelName,
      source: "dsh",
      hasApiKey: true,
      ready: isHarnessReady("deepseek-harness"),
    };
  }
  return null;
}

function engineBadgeFor(model) {
  const map = {
    codex: "Codex",
    "claude-code": "Claude",
    antigravity: "AGY",
    "deepseek-harness": "DSH",
  };
  return map[model?.engine] || "AI";
}

function modelStatusColor(model) {
  if (!model) return "var(--ar-text-3)";
  if (state?.cooldowns?.[model.id]) return "var(--ar-amber)";
  const eng = state?.engines?.[model.engine];
  if (!eng) return "var(--ar-text-3)";
  if (model.mode === "api") {
    if (!model.hasApiKey && model.source !== "dsh") return "var(--ar-amber)";
    return eng.installed ? "var(--ar-emerald)" : "var(--ar-amber)";
  }
  if (eng.status === "ready") return "var(--ar-emerald)";
  if (eng.status === "unauthenticated") return "var(--ar-amber)";
  return "var(--ar-text-3)";
}

function modelLabel(model) {
  if (!model) return "—";
  return model.name || model.modelName || model.id;
}

// Display-only role naming. Internal ids ("oracle" / "hephaestus") never change; in Chinese the
// team reads 白泽 (Oracle, independent review) and 祝融 (Hephaestus, code execution).
function roleDisplayName(role) {
  const isOracle = role !== "hephaestus";
  const en = state?.settings?.lang === "en";
  if (isOracle) return en ? "Oracle" : "白泽";
  return en ? "Hephaestus" : "祝融";
}

function roleBadgeLabel(role, slot) {
  return `${roleDisplayName(role)}${slot && slot !== "default" ? `:${slot}` : ""}`;
}

function recentSessionsForRole(role, limit = 3) {
  return (state?.sessions || []).filter((s) => s.role === role).slice(0, limit);
}

// Scroll memory for the job detail timeline. Auto-follow stays on unless the user scrolls up;
// a re-render then restores the exact scroll offset so live streaming never yanks the view.
const detailScroll = { atBottom: true, top: 0 };

function bindDetailScroll() {
  const el = document.querySelector('[data-scroll="job-detail"]');
  if (!el || el.dataset.bound === "1") return;
  el.dataset.bound = "1";
  el.addEventListener("scroll", () => {
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    detailScroll.top = el.scrollTop;
    detailScroll.atBottom = gap < 28;
  });
}

function restoreDetailScroll() {
  bindDetailScroll();
  const el = document.querySelector('[data-scroll="job-detail"]');
  if (!el) return;
  if (detailScroll.atBottom) {
    el.scrollTop = el.scrollHeight;
  } else {
    el.scrollTop = detailScroll.top;
  }
}

function jobStatusMeta(status) {
  if (status === "running") {
    return { cls: "running", label: t("jobRunning"), dot: "var(--ar-emerald)" };
  }
  if (status === "failed") {
    return { cls: "failed", label: t("jobFailed"), dot: "var(--ar-rose)" };
  }
  if (status === "interrupted") {
    return { cls: "interrupted", label: t("jobInterrupted"), dot: "var(--ar-amber)" };
  }
  return { cls: "completed", label: t("jobCompleted"), dot: "var(--ar-blue)" };
}

function elapsedLabel(sec) {
  if (sec == null || Number.isNaN(Number(sec))) return "—";
  const s = Number(sec);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function hitClass(v) {
  if (v == null) return "na";
  return v >= 80 ? "high" : v >= 40 ? "mid" : "low";
}

// Markdown emits only these fixed elements, with every model-supplied fragment escaped.
function inlineMarkdown(text) {
  const token = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(token)) {
    result += esc(text.slice(offset, match.index));
    result += match[1] != null ? `<code>${esc(match[1])}</code>` : `<strong>${inlineMarkdown(match[2])}</strong>`;
    offset = match.index + match[0].length;
  }
  return result + esc(text.slice(offset));
}

function renderMarkdown(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let bullets = [];
  let code = null;
  const flush = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(inlineMarkdown).join("\n")}</p>`);
    if (bullets.length) blocks.push(`<ul>${bullets.map((line) => `<li>${inlineMarkdown(line)}</li>`).join("")}</ul>`);
    paragraph = [];
    bullets = [];
  };
  for (const line of lines) {
    if (code) {
      if (/^\s*```\s*$/.test(line)) {
        blocks.push(`<pre class="ar-pre"><code>${esc(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
    } else if (/^\s*```/.test(line)) {
      flush();
      code = [];
    } else {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-+*]\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        const level = Math.min(6, heading[1].length + 2);
        blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      } else if (bullet) {
        if (paragraph.length) flush();
        bullets.push(bullet[1]);
      } else if (line.trim()) {
        if (bullets.length) flush();
        paragraph.push(line);
      } else {
        flush();
      }
    }
  }
  flush();
  if (code) blocks.push(`<pre class="ar-pre"><code>${esc(code.join("\n"))}</code></pre>`);
  return blocks.join("");
}

function splitFinalResponse(text) {
  const match = /(?:^|\r?\n)\s*(\[(?:A\.stand|Agent Relay) · [^\r\n]*\])(?:\r?\n\r?\n(\[Git Worktree\] [\s\S]*))?\s*$/.exec(text);
  return match ? { body: [text.slice(0, match.index).trim(), match[2]?.trim()].filter(Boolean).join("\n\n"), footer: match[1] }
    : { body: text.trim(), footer: "" };
}

const STEP_LABELS = {
  read: "stepAnalyzed", edit: "stepEdited", write: "stepCreated", search: "stepSearched",
  cmd: "stepRan", error: "stepError", stderr: "stepError", steer: "stepSteer", triage: "stepSteer",
  triage_alert: "stepSteer", fallback: "stepFallback", interrupt: "stepStop",
};

function stepDuration(a) {
  let seconds = a.durationSec;
  if (a.kind === "thought" && a.status === "running") {
    const started = Date.parse(a.ts);
    if (Number.isFinite(started)) seconds = Math.max(seconds ?? 0, (Date.now() - started) / 1000);
  }
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return seconds >= 60 ? elapsedLabel(seconds) : `${seconds >= 1 ? Math.round(seconds) : Number(seconds.toFixed(1))}s`;
}

function stepLineHtml(a, { allowDrawer }) {
  const kind = a.kind || a.type;
  if (kind === "output") {
    const prose = String(a.detail || a.title || "").trim();
    if (!prose) return "";
    return allowDrawer
      ? `<div class="ar-step ar-message">${renderMarkdown(prose)}</div>`
      : `<div class="ar-step ar-preview-output"><span class="ar-main">${esc(a.title || prose)}</span></div>`;
  }

  const label = STEP_LABELS[kind];
  if (!label && kind !== "thought") return "";
  const title = String(a.title || a.summary || "").trim();
  const detail = String(a.detail || "");
  const duration = stepDuration(a);
  const thought = kind === "thought";
  const file = ["read", "edit", "write"].includes(kind);
  const command = kind === "cmd";
  const running = a.status === "running";
  const failed = a.status === "error" || (command && Number.isInteger(a.exitCode) && a.exitCode !== 0);
  const target = thought
    ? (duration ? t(running ? "stepThinking" : "stepThoughtFor").replace("%s", duration) : t(running ? "stepThinkingNow" : "stepThought"))
    : command ? title.replace(/^(?:pwsh|powershell|bash|sh):\s*/i, "") : title;
  const meta = a.meta && a.meta !== target ? (kind === "search" ? t("stepInPath").replace("%s", a.meta) : a.meta) : "";
  const canExpand = allowDrawer && Boolean(a.id && detail.trim()) && (thought || command || kind === "edit" || kind === "write");
  const open = canExpand && ui.expandedStepIds.has(a.id);
  const row = `
    ${label ? `<span class="ar-verb">${esc(t(label))}</span>` : ""}
    ${file ? `<span class="ar-file-icon">${iconSvg("file")}</span>` : ""}
    <span class="ar-main">${esc(target)}</span>
    ${meta ? `<span class="ar-meta">${esc(meta)}</span>` : ""}
    ${a.added > 0 ? `<span class="ar-added">+${esc(a.added)}</span>` : ""}
    ${a.removed > 0 ? `<span class="ar-removed">-${esc(a.removed)}</span>` : ""}
    ${command && failed && Number.isInteger(a.exitCode)
      ? `<span class="ar-failed">· ${esc(t("jobExitCode").replace("%s", a.exitCode))}</span>`
      : failed && !["error", "interrupt", "stderr"].includes(kind) ? `<span class="ar-failed">· ${esc(t("jobFailed"))}</span>` : ""}
    ${command && duration ? `<span class="ar-dur">${esc(duration)}</span>` : ""}
    ${canExpand ? `<span class="ar-step-chev" aria-hidden="true">${iconSvg(open ? "chevron" : "chevronRight")}</span>` : ""}
  `;
  return `<div class="ar-step ar-step-${esc(kind)}">
    ${canExpand ? `<button type="button" class="ar-step-line" data-action="toggle-step-detail" data-step-id="${esc(a.id)}" aria-expanded="${open}">${row}</button>`
      : `<div class="ar-step-line">${row}</div>`}
    ${open ? (thought ? `<div class="ar-prose ar-indent">${renderMarkdown(detail)}</div>`
      : `<pre class="ar-pre ar-step-drawer${command ? " ar-terminal" : ""}">${esc(detail.trimEnd())}</pre>`) : ""}
  </div>`;
}

function timelineStepsHtml(rows, { allowDrawer = true, previewLimit = Infinity, finalBody = "", error = "" } = {}) {
  return (rows || []).filter((a) => {
    const kind = a.kind || a.type;
    if (kind !== "output") return Boolean(kind === "thought" || (STEP_LABELS[kind] && !(error && a.summary === error)));
    if (!a.title && !a.detail) return false;
    if (!finalBody) return true;
    const detail = String(a.detail || "").trim();
    return detail ? !finalBody.includes(detail) : !/^writing:|^(?:review|message) \(\d+ chars\)$/i.test(a.summary || "");
  }).slice(-previewLimit).map((a) => stepLineHtml(a, { allowDrawer })).join("");
}

function renderInterruptedJobsBanner() {
  const rows = state?.interruptedJobs || [];
  if (!rows.length) return "";
  return `
    <div class="interrupted-banner">
      <div class="interrupted-head">
        <span class="interrupted-title">⚠ ${esc(t("interruptedTitle"))} · ${rows.length}</span>
        <div class="interrupted-head-actions">
          <button class="btn xs" data-action="dismiss-interrupted-all">${esc(t("dismissAll"))}</button>
        </div>
      </div>
      <div class="interrupted-desc">${esc(t("interruptedDesc"))}</div>
      ${rows
        .map(
          (j) => `
        <div class="interrupted-row" data-job="${esc(j.jobId)}" data-action="open-job-detail" role="button" tabindex="0">
          <div class="interrupted-line">
            <span class="role-badge ${j.role === "hephaestus" ? "write" : "readonly"}">${esc(roleBadgeLabel(j.role, j.slot))}</span>
            <span class="interrupted-title-btn truncate" title="${esc(j.title || j.jobId)}">${esc(j.title || j.jobId)}</span>
          </div>
          <div class="interrupted-line muted truncate" title="${esc(j.lastSummary || j.error || "")}">
            <span>${esc(t("interruptedLast"))}: ${esc(j.lastSummary || j.error || "—")}</span>
          </div>
          <div class="interrupted-line muted">
            <span class="mono truncate">${esc(t("interruptedSession"))}: ${esc(j.sessionId || "—")}</span>
          </div>
          <div class="interrupted-actions">
            <button class="btn xs" data-action="copy-resume-prompt" data-sid="${esc(j.sessionId || "")}">${esc(t("copyResumePrompt"))}</button>
            <button class="btn xs ghost" data-action="dismiss-interrupted" data-job="${esc(j.jobId)}">${esc(t("dismiss"))}</button>
          </div>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderJobDetailView() {
  const j = ui.detailJob;
  const status = j ? jobStatusMeta(j.status) : null;
  const title = j?.title || j?.jobId || ui.detailJobId;
  const final = splitFinalResponse(String(j?.finalText || ""));
  const error = ui.detailError || j?.error || "";
  const steps = timelineStepsHtml(j?.activities, { finalBody: final.body, error });
  const promptOpen = ui.expandedStepIds.has("__lead_prompt");
  const roleLabel = roleDisplayName(j?.role);

  return `
    <section class="job-detail">
      <header class="job-detail-head">
        <div class="job-detail-line">
          <button class="job-back" data-action="close-job-detail" data-src="${esc(ui.detailSrc || "team")}">${esc(t("jobBack"))}</button>
          ${j?.role ? `<span class="role-badge ${j.role === "hephaestus" ? "write" : "readonly"}">${esc(roleLabel)}${j.slot && j.slot !== "default" ? `:${esc(j.slot)}` : ""}</span>` : ""}
          <h1 class="job-detail-title truncate" title="${esc(title)}">${esc(title)}</h1>
          ${j?.logPath ? `<button type="button" class="job-log-copy" data-action="copy-job-log" aria-label="${esc(t("copyLogPath"))}" title="${esc(t("copyLogPath"))}">${iconSvg("copy")}</button>` : ""}
          ${j?.status === "running" ? `<button class="btn xs danger" data-action="stop-job" data-job="${esc(j.jobId)}">${esc(t("stopJob"))}</button>` : ""}
        </div>
        ${j ? `<div class="job-detail-line job-detail-meta">
          ${j.modelDisplayName || j.engine ? `<span>${esc(j.modelDisplayName || j.engine)}</span>` : ""}
          <span class="job-meta-pill ${status.cls}">${esc(status.label)}</span>
          ${j.elapsedSec != null ? `<span class="job-meta-pill">${esc(elapsedLabel(j.elapsedSec))}</span>` : ""}
          ${j.hitRate != null ? `<span class="job-meta-pill">${esc(t("jobCacheHit"))} ${esc(j.hitRate)}%</span>` : ""}
          ${j.status === "interrupted" && j.sessionId ? `<button class="job-back" data-action="copy-resume-prompt" data-sid="${esc(j.sessionId)}">${esc(t("copyResumePrompt"))}</button>` : ""}
        </div>` : ""}
      </header>
      <div class="job-conversation" data-scroll="job-detail">
        ${j?.prompt ? `<div class="job-prompt">
          <button type="button" class="ar-step-line" data-action="toggle-step-detail" data-step-id="__lead_prompt" aria-expanded="${promptOpen}">
            ${esc(t("jobLeadPrompt"))}<span class="ar-step-chev" aria-hidden="true">${iconSvg(promptOpen ? "chevron" : "chevronRight")}</span>
          </button>
          ${promptOpen ? `<div class="ar-prose ar-indent">${renderMarkdown(j.prompt)}</div>` : ""}
        </div>` : ""}
        ${steps ? `<div class="ar-timeline">${steps}</div>`
          : !final.body && !error && j?.status !== "running" ? `<div class="empty-state">${esc(ui.detailLoading ? t("jobLoading") : t("jobNoSteps"))}</div>` : ""}
        ${error ? `<div class="job-detail-error">${esc(error)}</div>` : ""}
        ${final.body || final.footer ? `<section class="job-final">
          <h2>${esc(t("jobFinalResponse"))}</h2>
          <div class="ar-message">${renderMarkdown(final.body)}</div>
          ${final.footer ? `<footer>${esc(final.footer)}</footer>` : ""}
        </section>` : ""}
        ${j?.status === "running" ? `<div class="job-detail-foot"><span class="dot pulse"></span>${esc(t("jobStreaming"))}</div>` : ""}
      </div>
    </section>
  `;
}

function renderRecentJobsStrip() {
  const rows = (state?.recentJobs || []).filter((j) => j.status !== "running").slice(0, 5);
  if (rows.length === 0) return "";
  return `
    <div class="recent-jobs">
      <div class="recent-jobs-head">${esc(t("recentTitle"))}</div>
      ${rows
        .map((j) => {
          const meta = jobStatusMeta(j.status);
          return `
        <button class="recent-job" data-action="open-job-detail" data-job="${esc(j.jobId)}">
          <span class="dot" style="color:${meta.dot}"></span>
          <span class="role-badge ${j.role === "hephaestus" ? "write" : "readonly"}">${esc(roleBadgeLabel(j.role, j.slot))}</span>
          <span class="truncate recent-job-title">${esc(j.title || j.jobId)}</span>
          <span class="mono nums recent-job-meta">${esc(elapsedLabel(j.elapsedSec))}</span>
          ${j.hitRate != null ? `<span class="log-hit ${hitClass(j.hitRate)}">${esc(j.hitRate)}%</span>` : ""}
          <span class="recent-job-cue">${esc(t("inspectCue"))}</span>
        </button>`;
        })
        .join("")}
    </div>
  `;
}

function renderLiveActivityPanel() {
  const jobs = state?.activeJobs || [];
  if (jobs.length === 0) return "";
  return `
    <div class="live-panel">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:12.5px">
          <span class="dot pulse" style="color:var(--ar-emerald)"></span>
          <span>${t("liveTitle")} (${jobs.length})</span>
        </div>
      </div>
      ${jobs
        .map((j) => {
          const preview = timelineStepsHtml(j.recentActivities, { allowDrawer: false, previewLimit: 4 });
          return `
        <div class="live-job" data-action="open-job-detail" data-job="${esc(j.jobId)}" role="button" tabindex="0">
          <div class="live-job-head">
            <div style="display:flex;align-items:center;gap:7px;min-width:0">
              <span class="role-badge ${j.role === "oracle" ? "readonly" : "write"}">${esc(roleBadgeLabel(j.role, j.slot))}</span>
              <span class="truncate" style="font-weight:500">${esc(j.title || j.modelDisplayName || j.engine)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="mono nums" style="font-size:11px;color:var(--ar-text-3)">${t("elapsed")} ${j.elapsedSec}s · ${t("silent")} ${j.silentSec}s</span>
              <button class="btn xs danger" data-action="stop-job" data-job="${esc(j.jobId)}">■ ${t("stopJob")}</button>
            </div>
          </div>
          ${
            preview ? `<div class="live-feed ar-timeline compact">${preview}</div>`
              : ""
          }
          <span class="inspect-cue">${esc(t("inspectCue"))}</span>
        </div>`;
        })
        .join("")}
      ${renderRecentJobsStrip()}
    </div>
  `;
}

function renderQuotaCard() {
  const rl = state?.codexRateLimits;
  if (!rl || (!rl.primary && !rl.secondary)) return "";
  const winBar = (label, w) => {
    if (!w) return "";
    const rem = w.remainingPercent != null ? w.remainingPercent : 0;
    const fillCls = rem <= 10 ? "danger" : rem <= 30 ? "warn" : "";
    return `
      <div class="quota-win">
        <div class="quota-win-head">
          <span style="font-weight:500">${label}</span>
          <span class="nums" style="color:${rem <= 15 ? "var(--ar-amber)" : "var(--ar-text-2)"}">
            ${t("remaining")} ${rem}%${w.resetsAtMs ? ` · ${t("resetsIn")} ${fmtCountdown(w.resetsAtMs)}` : ""}
          </span>
        </div>
        <div class="progress-track"><div class="progress-fill ${fillCls}" style="width:${Math.max(2, rem)}%"></div></div>
      </div>`;
  };
  return `
    <div class="quota-card">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600">
          <span>${t("quotaTitle")}</span>
          ${rl.planType ? `<span class="engine-tag">${esc(String(rl.planType).toUpperCase())}</span>` : ""}
        </div>
        <button class="btn xs" data-action="refresh-quota">${iconSvg("refresh")}<span>${t("refresh")}</span></button>
      </div>
      <div class="quota-grid">
        ${winBar(t("win5h"), rl.primary)}
        ${winBar(t("win7d"), rl.secondary)}
      </div>
    </div>
  `;
}

function canHarnessFlyout(menu) {
  if (!menu) return false;
  const menuRect = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  return vw - menuRect.right - 8 >= 190 || menuRect.left - 8 >= 190;
}

function positionHarnessFlyout(group) {
  if (!group) return;
  const menu = group.closest(".dropdown-menu");
  const row = group.querySelector(".harness-row");
  const sub = group.querySelector(".harness-sublist");
  if (!menu || !row || !sub) return;

  if (!group.classList.contains("expanded")) {
    sub.classList.remove("flyout");
    sub.style.top = "";
    sub.style.left = "";
    sub.style.width = "";
    return;
  }

  const menuRect = menu.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceRight = vw - menuRect.right - 8;
  const spaceLeft = menuRect.left - 8;

  if (spaceRight >= 190 || spaceLeft >= 190) {
    sub.classList.add("flyout");
    let flyWidth;
    let flyLeft;
    if (spaceRight >= 190) {
      flyWidth = Math.min(232, Math.max(190, Math.floor(spaceRight)));
      flyLeft = menuRect.right + 4;
    } else {
      flyWidth = Math.min(232, Math.max(190, Math.floor(spaceLeft)));
      flyLeft = Math.max(8, menuRect.left - flyWidth - 4);
    }
    menu.style.overflowY = "visible";
    sub.style.width = `${flyWidth}px`;
    sub.style.left = `${Math.round(flyLeft)}px`;
    sub.style.top = "8px";
    const subH = Math.min(320, Math.max(44, sub.offsetHeight || sub.scrollHeight || 180));
    const clampedTop = Math.min(Math.max(8, rowRect.top - 4), Math.max(8, vh - subH - 8));
    sub.style.top = `${Math.round(clampedTop)}px`;
  } else {
    sub.classList.remove("flyout");
    sub.style.top = "";
    sub.style.left = "";
    sub.style.width = "";
    menu.style.overflowY = "auto";
  }
}

function positionFloatingMenus() {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  for (const menu of document.querySelectorAll(".dropdown-menu.fixed-pop")) {
    const dd = menu.closest(".dropdown");
    const trigger = dd?.querySelector("[data-pop-trigger]");
    if (!trigger) continue;
    const tr = trigger.getBoundingClientRect();
    const minW = Math.max(tr.width, Number(menu.dataset.minWidth || 210));
    const maxW = Math.min(vw - 16, Math.max(minW, Math.round(tr.width)));
    menu.style.width = `${maxW}px`;
    menu.style.maxHeight = `${Math.max(140, vh - 20)}px`;

    const alignRight = menu.dataset.align === "right";
    let left = alignRight ? tr.right - maxW : tr.left;
    left = Math.max(8, Math.min(left, vw - maxW - 8));
    menu.style.left = `${Math.round(left)}px`;

    menu.style.top = "8px";
    const mh = Math.min(vh - 20, menu.offsetHeight || menu.scrollHeight || 180);
    const spaceBelow = vh - tr.bottom - 10;
    const spaceAbove = tr.top - 10;
    let top = tr.bottom + 5;
    if (spaceBelow < mh && spaceAbove > spaceBelow) {
      top = Math.max(8, tr.top - mh - 5);
    }
    top = Math.max(8, Math.min(top, vh - mh - 8));
    menu.style.top = `${Math.round(top)}px`;

    const expanded = menu.querySelector(".harness-group.expanded");
    if (expanded) positionHarnessFlyout(expanded);
  }
}

function renderHarnessPicker(role, mode, queueIds, activeEngine) {
  const activeExpand = ui.expandedHarness || "";
  const primaryId = queueIds[0];

  return HARNESS_ORDER.map((eid) => {
    const ready = isHarnessReady(eid);
    if (!ready) {
      return `
        <div class="harness-group disabled" data-harness-group="${eid}">
          <button class="harness-row disabled" data-action="goto-engine-setup" data-engine="${eid}">
            <span class="dropdown-main">
              <span class="dot" style="background:${harnessDotColor(eid)}"></span>
              <span class="dropdown-name">${esc(harnessTitle(eid))}</span>
            </span>
            <span class="setup-link-tag">${harnessSetupTag(eid)}</span>
          </button>
        </div>`;
    }

    const rawModels = getModelsForHarness(eid);
    const items = mode === "fallback" ? rawModels.filter((m) => !queueIds.includes(m.id)) : rawModels;
    const isExpanded = activeExpand === eid;

    const renderModel = (m) => {
      const isSel = mode === "primary" && m.id === primaryId;
      const act = mode === "primary" ? "pick-role-model" : "add-fallback";
      return `
        <button class="dropdown-item ${isSel ? "selected" : ""}" data-action="${act}" data-role="${role}" data-model="${esc(m.id)}">
          <span class="dropdown-main">
            <span class="dot" style="background:${modelStatusColor(m)}"></span>
            <span class="dropdown-name">${esc(eid === "deepseek-harness" ? m.modelName : modelLabel(m))}</span>
            ${m.source === "dsh" ? `<span class="source-tag">${t("sourceDsh")}</span>` : ""}
          </span>
          ${isSel ? iconSvg("check") : ""}
        </button>`;
    };

    return `
      <div class="harness-group ready ${isExpanded ? "expanded" : ""}" data-harness-group="${eid}">
        <button class="harness-row ready" data-action="toggle-harness" data-engine="${eid}" data-harness-hover="${eid}">
          <span class="dropdown-main">
            <span class="dot" style="background:${harnessDotColor(eid)}"></span>
            <span class="dropdown-name">${esc(harnessTitle(eid))}</span>
            <span class="engine-tag nums">${items.length}</span>
          </span>
          <span class="harness-chev">${iconSvg("chevronRight")}</span>
        </button>
        <div class="harness-sublist">
          ${eid === "deepseek-harness" ? renderChannelGroups(items, renderModel) : items.map(renderModel).join("")}
          ${
            eid === "deepseek-harness"
              ? `<button class="dropdown-footer-btn" data-action="open-add-modal">
                  ${iconSvg("plus")}
                  <span>${t("addApiModel")}</span>
                </button>`
              : ""
          }
        </div>
      </div>`;
  }).join("");
}

function renderRoleCard(role) {
  const cfg = state.settings.roles[role];
  const queueIds = Array.isArray(cfg.queue) && cfg.queue.length ? cfg.queue : [cfg.modelId];
  const primaryId = queueIds[0];
  const selected = resolveModelMeta(primaryId) || resolveModelMeta("cli-codex-default");
  const fallbackIds = queueIds.slice(1);
  const isOracle = role === "oracle";
  const sessions = recentSessionsForRole(role, 3);
  const open = ui.openDropdownRole === role;
  const openFb = ui.openFallbackRole === role;
  const cooldowns = state.cooldowns || {};

  const activeQueueCooldowns = queueIds
    .map((id) => ({ model: resolveModelMeta(id), cd: cooldowns[id] }))
    .filter((x) => x.model && x.cd);

  return `
    <div class="card">
      <div class="card-head">
        <div class="role-title">
          ${iconSvg(role)}
          <span>${isOracle ? t("oracleTitle") : t("hephTitle")}</span>
          ${t(isOracle ? "oracleSub" : "hephSub") ? `<span class="role-sub">${esc(t(isOracle ? "oracleSub" : "hephSub"))}</span>` : ""}
        </div>
        <span class="role-badge ${isOracle ? "readonly" : "write"}">${isOracle ? t("oracleBadge") : t("hephBadge")}</span>
      </div>
      <div class="role-desc">${isOracle ? t("oracleDesc") : t("hephDesc")}</div>

      <div class="field">
        <div class="field-label">
          <span>${t("primaryAi")}</span>
          <div class="dropdown">
            <button class="btn xs ghost" data-action="toggle-fb-dd" data-role="${role}" data-pop-trigger="1">+ ${t("addFallback")}</button>
            ${
              openFb
                ? `<div class="dropdown-menu harness-menu fixed-pop" data-align="right" data-min-width="235">
                    ${renderHarnessPicker(role, "fallback", queueIds, selected?.engine)}
                  </div>`
                : ""
            }
          </div>
        </div>
        <div class="dropdown">
          <button class="dropdown-trigger" data-action="toggle-role-dd" data-role="${role}" data-pop-trigger="1">
            <span class="dropdown-main">
              <span class="dot" style="background:${modelStatusColor(selected)}"></span>
              <span class="dropdown-name">① ${esc(modelLabel(selected))}</span>
              <span class="engine-tag">${esc(engineBadgeFor(selected))}</span>
              ${!selected?.ready ? `<span class="trigger-warn">${t("unreadyBadge")}</span>` : ""}
            </span>
            ${iconSvg("chevron")}
          </button>
          ${
            open
              ? `<div class="dropdown-menu harness-menu fixed-pop" data-min-width="220">
                  ${renderHarnessPicker(role, "primary", queueIds, selected?.engine)}
                </div>`
              : ""
          }
        </div>

        ${
          fallbackIds.length > 0
            ? `<div class="queue-list">
                ${fallbackIds
                  .map((fid, idx) => {
                    const fm = resolveModelMeta(fid);
                    if (!fm) return "";
                    return `
                    <div class="queue-chip">
                      <div class="queue-chip-left">
                        <span class="queue-rank">②${idx > 0 ? `+${idx}` : ""}</span>
                        <span class="dot" style="background:${modelStatusColor(fm)}"></span>
                        <span class="truncate">${esc(modelLabel(fm))}</span>
                        <span class="engine-tag">${esc(engineBadgeFor(fm))}</span>
                      </div>
                      <div class="queue-chip-actions">
                        <button class="chip-btn" title="${t("promote")}" data-action="promote-fallback" data-role="${role}" data-model="${esc(fid)}">↑</button>
                        <button class="chip-btn danger" title="${t("remove")}" data-action="remove-fallback" data-role="${role}" data-model="${esc(fid)}">×</button>
                      </div>
                    </div>`;
                  })
                  .join("")}
              </div>`
            : ""
        }

        ${activeQueueCooldowns
          .map(
            ({ model, cd }) => `
          <div class="cooldown-row">
            <span class="truncate">⏳ ${esc(model.name)}: ${cd.manualOnly ? t("balanceDepleted") : `${t("cooldownPrefix")} → ${fmtCountdown(cd.untilMs)}`}</span>
            <button class="btn xs" data-action="clear-cooldown" data-model="${esc(model.id)}">${t("restore")}</button>
          </div>`
          )
          .join("")}
      </div>

      <div class="field">
        <div class="field-label"><span>${t("effort")}</span></div>
        <div class="seg" style="width:100%">
          ${["low", "medium", "high"]
            .map(
              (lv) => `
            <button class="seg-btn ${cfg.effort === lv ? "active" : ""}" style="flex:1" data-action="set-effort" data-role="${role}" data-effort="${lv}">
              ${t(lv)}
            </button>`
            )
            .join("")}
        </div>
      </div>

      ${
        sessions.length > 0
          ? `<div class="session-list">
              ${sessions
                .map((sess) => {
                  const ctxPct = sess.contextPct;
                  const ctxClass = ctxPct >= 75 ? "danger" : ctxPct >= 50 ? "warn" : "";
                  const shortId = `#${String(sess.sessionId).slice(0, 8)}`;
                  const displayTitle = sess.title || shortId;
                  const titleTip = sess.title ? `${sess.title} (${sess.sessionId})` : sess.sessionId;
                  const leftInfo = ctxPct != null ? `${t("ctx")} ${ctxPct}%` : sess.resolvedModel || "";
                  return `
                    <div class="session-box">
                      <div class="session-top">
                        <span class="session-title truncate" title="${esc(titleTip)}">${esc(displayTitle)}</span>
                        <span class="session-stats">
                          <span class="session-pill nums">${sess.turns || 0} ${t("turns")}</span>
                          <span class="nums" style="color:${sess.lastHitRate != null && sess.lastHitRate >= 80 ? "var(--ar-emerald)" : "var(--ar-text-2)"}">
                            ${t("hit")} ${sess.lastHitRate != null ? `${sess.lastHitRate}%` : "—"}
                          </span>
                        </span>
                      </div>
                      ${
                        ctxPct != null
                          ? `<div class="progress-track"><div class="progress-fill ${ctxClass}" style="width:${Math.min(100, ctxPct)}%"></div></div>`
                          : ""
                      }
                      <div class="session-actions">
                        <span class="session-meta truncate nums" title="${esc(sess.sessionId)}">
                          ${leftInfo ? `${esc(leftInfo)} · ` : ""}<span class="mono">${esc(shortId)}</span>
                        </span>
                        <div style="display:flex;gap:4px;flex-shrink:0">
                          ${
                            sess.engine === "codex"
                              ? `<button class="btn xs" data-action="session-act" data-act="compact" data-sid="${esc(sess.sessionId)}">${t("compact")}</button>`
                              : ""
                          }
                          <button class="btn xs danger" data-action="session-act" data-act="reset" data-sid="${esc(sess.sessionId)}">${t("reset")}</button>
                        </div>
                      </div>
                    </div>`;
                })
                .join("")}
            </div>`
          : `<div class="session-box" style="color:var(--ar-text-3);font-size:11.5px">${t("noSession")}</div>`
      }
    </div>
  `;
}

function renderTeamTab() {
  const on = state.settings.enabled;
  return `
    <div class="gate-banner ${on ? "active" : ""}">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="dot ${on ? "pulse" : ""}" style="color:${on ? "var(--ar-emerald)" : "var(--ar-text-3)"}"></span>
        <span>${on ? t("gateOn") : t("gateOff")}</span>
      </div>
    </div>

    ${renderInterruptedJobsBanner()}
    ${renderLiveActivityPanel() || renderRecentJobsStrip()}
    ${renderQuotaCard()}

    <div class="card-grid two">
      ${renderRoleCard("oracle")}
      ${renderRoleCard("hephaestus")}
    </div>
  `;
}

function renderChannelCard(channel) {
  const { id, name, models, baseUrl, maskedApiKey } = channel;
  const provider = (state.providers || []).find((p) => p.id === channel.providerId);
  const readOnly = channel.source === "dsh";
  const expanded = ui.expandedChannels.has(id);
  return `
    <div class="model-row channel-card" data-channel-card="${esc(id)}">
      <div class="model-row-top channel-card-head">
        <button class="channel-toggle" data-action="toggle-channel" data-channel="${esc(id)}" aria-expanded="${expanded}">
          <span class="provider-avatar">${esc(provider?.badge || "API")}</span>
          <span class="channel-summary">
            <span class="channel-title">
              <span class="model-name truncate">${esc(name)}</span>
              <span class="source-tag channel-count">${models.length} ${t("modelCountSuffix")}</span>
              ${maskedApiKey ? `<span class="mono channel-key">${esc(maskedApiKey)}</span>` : ""}
            </span>
            <span class="model-sub mono truncate" title="${esc(baseUrl)}">${esc(baseUrl)}</span>
          </span>
          <span class="channel-chevron">${iconSvg("chevron")}</span>
        </button>
        ${readOnly
          ? `<span class="source-tag channel-readonly">${t("readOnlyDsh")}</span>`
          : `<div class="channel-actions">
              <button class="btn xs" data-action="open-manage-channel" data-channel="${esc(id)}">${t("manageChannel")}</button>
              <button class="btn xs danger" data-action="delete-channel" data-channel="${esc(id)}">${t("del")}</button>
            </div>`}
      </div>
      ${expanded ? `<div class="channel-models">
        ${models.map((model) => `
          <span class="channel-model-chip mono">
            <span class="truncate" title="${esc(model.modelName)}">${esc(model.modelName)}</span>
            ${readOnly ? "" : `<button class="chip-btn danger" data-action="remove-channel-model" data-channel="${esc(id)}" data-model-id="${esc(model.id)}" aria-label="${t("remove")} ${esc(model.modelName)}">×</button>`}
          </span>`).join("")}
        ${readOnly ? "" : `<button class="btn xs" data-action="open-manage-channel" data-channel="${esc(id)}">${iconSvg("plus")} ${t("changeModels")}</button>`}
      </div>` : ""}
    </div>`;
}

function renderModelsTab() {
  const engines = state.engines || {};
  const channels = getApiChannels();
  const dshModelCount = state.dshModels?.length || 0;
  const dsh = engines["deepseek-harness"];

  const statusPill = (eng) => {
    if (!eng || !eng.installed) return `<span class="status-pill off"><span class="dot"></span>${t("notInstalled")}</span>`;
    if (eng.status === "ready") {
      return `<span class="status-pill on"><span class="dot"></span>${t("ready")}</span>`;
    }
    if (eng.status === "node_too_old") {
      return `<span class="status-pill warn"><span class="dot"></span>${t("needNode24")}</span>`;
    }
    return `<span class="status-pill warn"><span class="dot"></span>${t("needLogin")}</span>`;
  };

  return `
    ${renderQuotaCard()}

    <div>
      <div class="section-head">
        <span class="section-title">${t("cliSection")}</span>
        <button class="btn xs" data-action="refresh-detect">${iconSvg("refresh")}<span>${t("refresh")}</span></button>
      </div>
      <div class="list">
        ${HARNESS_ORDER.map((eid) => {
          const eng = engines[eid];
          const ready = isHarnessReady(eid);
          const cmdToCopy = !eng?.installed ? eng?.installCmd : eng?.loginCmd;
          const countBadge =
            eid === "codex" && ready
              ? `${(state.codexModels || []).length} ${t("modelCountSuffix")}`
              : eid === "deepseek-harness" && dshModelCount > 0
              ? `${t("syncedSuffix")} ${dshModelCount}`
              : "";
          return `
            <div id="engine-card-${eid}" class="model-row ${ui.highlightEngine === eid ? "highlight" : ""}">
              <div class="model-row-top">
                <div class="model-meta">
                  <div class="provider-avatar">${esc(eng?.shortTag || eid)}</div>
                  <div>
                    <div class="model-name">${esc(state.settings.lang === "en" ? eng?.labelEn : eng?.labelZh)}</div>
                    <div class="model-sub">
                      ${eng?.version ? `<span class="mono">${esc(eng.version)}</span>` : ""}
                      ${eng?.detectedModel ? `<span>· ${esc(eng.detectedModel)}</span>` : ""}
                      ${countBadge ? `<span class="engine-tag">${esc(countBadge)}</span>` : ""}
                    </div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px">
                  ${statusPill(eng, eid)}
                  ${eid !== "deepseek-harness" ? `<button class="btn xs" data-action="quick-test-cli" data-engine="${eid}">${t("testConn")}</button>` : ""}
                </div>
              </div>
              ${
                !ready && eng
                  ? eng.status === "node_too_old"
                    ? `<div class="setup-strip">
                        <span class="code-chip">${esc(t("nodeUpgradeTip"))} ${esc(eng.currentNode || "< 24.9")}</span>
                        <div style="display:flex;gap:5px">
                          <button class="btn xs" data-action="open-link" data-url="https://nodejs.org/">${t("nodeDownloadBtn")}</button>
                        </div>
                      </div>`
                    : `<div class="setup-strip">
                        <span class="code-chip">${esc(cmdToCopy || "")}</span>
                        <div style="display:flex;gap:5px">
                          <button class="btn xs" data-action="copy-text" data-text="${esc(cmdToCopy || "")}">${t("copyCmd")}</button>
                          <button class="btn xs" data-action="open-link" data-url="${esc(eng.downloadUrl || "")}">${t("download")}</button>
                        </div>
                      </div>`
                  : ""
              }
            </div>`;
        }).join("")}
      </div>
    </div>

    <div>
      <div class="section-head">
        <span class="section-title">${t("apiSection")}</span>
        <button class="btn xs primary" data-action="open-add-modal">${iconSvg("plus")}<span>${t("addApiModel")}</span></button>
      </div>
      <div class="setup-strip" style="margin-bottom:8px;border:1px solid var(--ar-border);background:var(--ar-surface)">
        <div style="display:flex;align-items:center;gap:7px">
          <span class="dot" style="color:${isHarnessReady("deepseek-harness") ? "var(--ar-emerald)" : "var(--ar-amber)"}"></span>
          <span>${
            isHarnessReady("deepseek-harness")
              ? t("dshHintOk")
              : dsh?.status === "node_too_old"
              ? t("dshHintNodeTooOld")
              : t("dshHintMissing")
          }</span>
        </div>
      </div>

      <div class="list">
        ${channels.length ? channels.map(renderChannelCard).join("") : `<div class="card empty-state">${t("noApiModels")}</div>`}
      </div>
    </div>
  `;
}

function renderCacheTab() {
  const tel = state.telemetry || {};
  const cumHit = tel.cumulativeHitRate;
  const lastHit = tel.lastHitRate;
  const hitCls = (v) => (v == null ? "" : v >= 80 ? "emerald" : "amber");
  const pts = tel.chartPoints || [];
  const rows = tel.recent || [];

  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">${t("kpiCumHit")}</span>
        <span class="kpi-value ${hitCls(cumHit)}">${cumHit != null ? `${cumHit}%` : "—"}</span>
        <span class="kpi-sub nums">${tel.reportedTurns || 0} / ${tel.totalTurns || 0} ${t("turns")}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${t("kpiSaved")}</span>
        <span class="kpi-value">${fmtNum(tel.totalCachedTokens || 0)}</span>
        <span class="kpi-sub nums">/ ${fmtNum(tel.totalInputTokens || 0)} in</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${t("kpiLast")}</span>
        <span class="kpi-value ${hitCls(lastHit)}">${lastHit != null ? `${lastHit}%` : "—"}</span>
        <span class="kpi-sub nums">${tel.latestContextPct != null ? `${t("ctx")} ${tel.latestContextPct}%` : t("unreported")}</span>
      </div>
    </div>

    <div class="chart-box">
      <div class="field-label">
        <span>${t("trendTitle")}</span>
        <span style="color:var(--ar-text-3)" class="nums">${pts.length} ${t("turns")}</span>
      </div>
      ${
        pts.length === 0
          ? `<div class="empty-state" style="padding:14px 0">${t("logEmpty")}</div>`
          : `<div class="bars">
              ${pts
                .map((p) => {
                  if (!p.cacheReported || p.hitRate == null) {
                    return `<div class="bar-col" title="${esc(roleDisplayName(p.role))} · ${t("unreported")}"><div class="bar na"></div></div>`;
                  }
                  const cls = p.hitRate >= 80 ? "" : p.hitRate >= 40 ? "mid" : "low";
                  return `<div class="bar-col" title="${esc(roleDisplayName(p.role))} · ${p.hitRate}%"><div class="bar ${cls}" style="height:${Math.max(8, p.hitRate)}%"></div></div>`;
                })
                .join("")}
            </div>`
      }
    </div>

    <div class="chart-box">
      <div class="field-label">
        <span>${t("logTitle")}</span>
        <button class="btn xs danger" data-action="clear-logs">${t("clearLogs")}</button>
      </div>
      ${
        rows.length === 0
          ? `<div class="empty-state" style="padding:12px 0">${t("logEmpty")}</div>`
          : `<div class="log-list">
              ${rows
                .map((r) => {
                  const hitLabel = r.cacheReported && r.hitRate != null ? `${r.hitRate}%` : "—";
                  const hitC = !r.cacheReported ? "na" : r.hitRate >= 80 ? "high" : r.hitRate >= 40 ? "mid" : "low";
                  const modeTag = r.resumedFromDisk ? t("resumed") : r.reused ? t("warm") : t("fresh");
                  return `
                  <div class="log-row ${r.jobId ? "clickable" : ""}" ${r.jobId ? `data-action="open-job-detail" data-job="${esc(r.jobId)}" role="button" tabindex="0"` : ""}>
                    <span class="mono" style="color:var(--ar-text-3)">${fmtTime(r.ts)}</span>
                    <span class="engine-tag" style="text-align:center">${esc(roleDisplayName(r.role))}</span>
                    <span class="truncate">${esc(r.modelName || r.engine)} · <span style="color:var(--ar-text-3)">${modeTag} · ${((r.elapsedMs || 0) / 1000).toFixed(1)}s</span></span>
                    <span class="log-hit ${hitC}" title="${r.cachedInputTokens ?? 0} / ${r.totalInputTokens ?? 0}">${hitLabel}</span>
                  </div>`;
                })
                .join("")}
            </div>`
      }
      <div class="log-footer">
        <span class="mono truncate" title="${esc(tel.logPath || "")}">${esc(tel.logPath || "")}</span>
        <button class="btn xs" data-action="copy-inner">${t("copyPath")}</button>
      </div>
    </div>
  `;
}

function renderSettingsTab() {
  const s = state.settings;
  const apiModels = getApiLibraryModels();
  const inspectorActive = Boolean(s.inspectorEnabled && s.inspectorModelId);
  return `
    <div>
      <div class="section-head"><span class="section-title">${t("secConcurrency")}</span></div>
      <div class="settings-group">
        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("maxConcTitle")}</span>
            <span class="setting-desc">${t("maxConcDesc")}</span>
          </div>
          <div class="seg">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (n) => `
              <button class="seg-btn ${s.maxConcurrency === n ? "active" : ""}" data-action="set-num" data-key="maxConcurrency" data-val="${n}">${n}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("silentTitle")}</span>
            <span class="setting-desc">${t("silentDesc")}</span>
          </div>
          <div class="seg">
            ${[1, 3, 5, 10]
              .map(
                (m) => `
              <button class="seg-btn ${s.silentCheckinMin === m ? "active" : ""}" data-action="set-num" data-key="silentCheckinMin" data-val="${m}">${m}${t("minSuffix")}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("longRunTitle")}</span>
            <span class="setting-desc">${t("longRunDesc")}</span>
          </div>
          <div class="seg">
            ${[0, 5, 10, 15, 30]
              .map(
                (m) => `
              <button class="seg-btn ${s.longRunCheckinMin === m ? "active" : ""}" data-action="set-num" data-key="longRunCheckinMin" data-val="${m}">${m === 0 ? t("unlimited") : `${m}${t("minSuffix")}`}</button>`
              )
              .join("")}
          </div>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("retentionTitle")}</span>
            <span class="setting-desc">${t("retentionDesc")}</span>
          </div>
          <div class="seg">
            ${[
              [7, t("days7")],
              [30, t("days30")],
              [0, t("forever")],
            ]
              .map(
                ([d, lbl]) => `
              <button class="seg-btn ${s.retentionDays === d ? "active" : ""}" data-action="set-num" data-key="retentionDays" data-val="${d}">${lbl}</button>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${t("secAutomation")}</span></div>
      <div class="settings-group">
        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("autoFbTitle")}</span>
            <span class="setting-desc">${t("autoFbDesc")}</span>
          </div>
          <button class="switch sm ${s.autoFallbackOnLimit ? "on" : ""}" data-action="toggle-bool" data-key="autoFallbackOnLimit"></button>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("asyncTitle")}</span>
            <span class="setting-desc">${s.asyncBackgroundMode ? t("asyncOnNote") : t("asyncDesc")}</span>
          </div>
          <button class="switch sm ${s.asyncBackgroundMode ? "on" : ""}" data-action="toggle-bool" data-key="asyncBackgroundMode" aria-label="async background mode switch"></button>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("inspectorTitle")}</span>
            <span class="setting-desc">${inspectorActive ? t("inspectorEnabledOn") : t("inspectorEnabledOff")}</span>
          </div>
          <button class="switch sm ${inspectorActive ? "on" : ""}" data-action="toggle-inspector" aria-label="inspector switch"></button>
          ${
            apiModels.length > 0 && inspectorActive
              ? (() => {
                  const curInsp = apiModels.find((m) => m.id === s.inspectorModelId) || apiModels[0];
                  return `<div class="setting-subrow">
                    <div class="dropdown" style="flex:1;min-width:160px">
                      <button class="dropdown-trigger" data-action="toggle-inspector-dd" data-pop-trigger="1">
                        <span class="dropdown-main">
                          <span class="dot" style="background:${curInsp?.hasApiKey || curInsp?.source === "dsh" ? "var(--ar-emerald)" : "var(--ar-amber)"}"></span>
                          <span class="dropdown-name mono">${esc(`${curInsp.modelName} · ${curInsp.channelName || curInsp.providerId}`)}</span>
                          <span class="source-tag ${curInsp?.source === "dsh" ? "" : "custom"}">${curInsp?.source === "dsh" ? t("sourceDsh") : t("sourceCustom")}</span>
                        </span>
                        ${iconSvg("chevron")}
                      </button>
                      ${
                        ui.inspectorDropdownOpen
                          ? `<div class="dropdown-menu fixed-pop" data-min-width="240">
                              ${renderChannelGroups(apiModels, (m) => `
                                <button class="dropdown-item ${m.id === curInsp.id ? "selected" : ""}" data-action="pick-inspector-model" data-model="${esc(m.id)}">
                                  <span class="dropdown-main">
                                    <span class="dot" style="background:${m.hasApiKey || m.source === "dsh" ? "var(--ar-emerald)" : "var(--ar-amber)"}"></span>
                                    <span class="dropdown-name mono">${esc(m.modelName)}</span>
                                  </span>
                                  ${m.id === curInsp.id ? iconSvg("check") : ""}
                                </button>`)}
                            </div>`
                          : ""
                      }
                    </div>
                    <button class="btn xs" data-action="open-add-modal" data-for-inspector="1">+ ${t("addApiModel")}</button>
                  </div>`;
                })()
              : apiModels.length === 0
              ? `<div class="setting-subrow">
                  <span style="font-size:11px;color:var(--ar-text-3);flex:1">${t("inspectorNeedApi")}</span>
                  <button class="btn xs primary" data-action="open-add-modal" data-for-inspector="1">${iconSvg("plus")}<span>${t("inspectorConfigureBtn")}</span></button>
                </div>`
              : ""
          }
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("fullAccessTitle")}</span>
            <span class="setting-desc">${t("fullAccessDesc")}</span>
          </div>
          <button class="switch sm ${s.allowHephaestusFullAccess ? "on" : ""}" data-action="toggle-bool" data-key="allowHephaestusFullAccess"></button>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("worktreeTitle")}</span>
            <span class="setting-desc">${t("worktreeDesc")}</span>
          </div>
          <button class="switch sm ${s.allowWorktreeParallelWrite ? "on" : ""}" data-action="toggle-bool" data-key="allowWorktreeParallelWrite" role="switch" aria-checked="${s.allowWorktreeParallelWrite === true}" aria-label="${esc(t("worktreeTitle"))}"></button>
        </div>

        <div class="setting-item">
          <div class="setting-meta">
            <span class="setting-title">${t("keepOfficeTitle")}</span>
            <span class="setting-desc">${t("keepOfficeDesc")}</span>
          </div>
          <button class="switch sm ${s.codexKeepOfficePlugins ? "on" : ""}" data-action="toggle-bool" data-key="codexKeepOfficePlugins"></button>
        </div>
      </div>
    </div>
  `;
}

function renderModal() {
  const m = ui.modal;
  if (!m) return "";
  const providers = state.providers || [];
  const selectedProv = providers.find((p) => p.id === m.providerId) || null;
  const q = ui.providerSearch.trim().toLowerCase();
  const filtered = providers.filter(
    (p) =>
      p.id !== "custom" &&
      (!q || p.nameZh.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.id.includes(q))
  );
  const customProv = providers.find((p) => p.id === "custom");
  const isEn = state.settings.lang === "en";
  const isEdit = Boolean(m.id);
  const fq = ui.fetchSearch.trim().toLowerCase();
  const fetchedFiltered = (ui.fetchedModels || []).filter((x) => !fq || x.id.toLowerCase().includes(fq));
  const selectedCount = ui.selectedFetchedModels.size;

  return `
    <div class="modal-backdrop" data-action="close-modal-bg">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <div class="modal-title">${isEdit ? t("modalEdit") : t("modalAdd")}</div>
          <button class="icon-btn" data-action="close-modal">${iconSvg("close")}</button>
        </div>

        <div class="field">
          <label class="field-label" for="m-channel-name">${t("channelName")}</label>
          <input class="text-input" id="m-channel-name" value="${esc(m.name)}" placeholder="${t("autoChannelName")}" />
        </div>

        <div class="field">
          <div class="field-label"><span>${t("providerLabel")}</span></div>
          <div class="dropdown">
            <button class="dropdown-trigger" data-action="toggle-prov-dd">
              <span class="dropdown-main">
                ${selectedProv ? `<span class="engine-tag">${esc(selectedProv.badge)}</span>` : ""}
                <span class="dropdown-name" style="color:${selectedProv ? "var(--ar-text)" : "var(--ar-text-3)"}">
                  ${selectedProv ? esc(isEn ? selectedProv.nameEn : selectedProv.nameZh) : t("selectProvider")}
                </span>
              </span>
              ${iconSvg("chevron")}
            </button>
            ${
              ui.providerDropdownOpen
                ? `<div class="dropdown-menu">
                    <div class="search-wrap">
                      <span class="search-icon">${iconSvg("search")}</span>
                      <input class="search-input" id="m-prov-search" value="${esc(ui.providerSearch)}" placeholder="${esc(t("searchPlaceholder"))}" />
                    </div>
                    ${filtered
                      .map(
                        (p) => `
                      <button class="dropdown-item ${p.id === m.providerId ? "selected" : ""}" data-action="pick-provider" data-prov="${p.id}">
                        <span class="dropdown-main">
                          <span class="engine-tag">${esc(p.badge)}</span>
                          <span>${esc(isEn ? p.nameEn : p.nameZh)}</span>
                        </span>
                        ${p.id === m.providerId ? iconSvg("check") : ""}
                      </button>`
                      )
                      .join("")}
                    <div class="dropdown-divider"></div>
                    <div style="font-size:10.5px;color:var(--ar-text-3);padding:3px 9px">${t("otherGroup")}</div>
                    ${
                      customProv
                        ? `<button class="dropdown-item ${m.providerId === "custom" ? "selected" : ""}" data-action="pick-provider" data-prov="custom">
                            <span class="dropdown-main">
                              <span class="engine-tag">API</span>
                              <span>${esc(isEn ? customProv.nameEn : customProv.nameZh)}</span>
                            </span>
                            ${m.providerId === "custom" ? iconSvg("check") : ""}
                          </button>`
                        : ""
                    }
                  </div>`
                : ""
            }
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="m-base-url">${t("baseUrlLabel")}</label>
          <input class="text-input mono" id="m-base-url" value="${esc(m.baseUrl)}" placeholder="https://api.deepseek.com/v1" />
        </div>

        <div class="field">
          <div class="field-label"><span>${t("apiKeyLabel")}</span></div>
          <div class="input-row">
            <div class="input-wrap">
              <input class="text-input with-eye mono" id="m-api-key" type="${ui.showApiKey ? "text" : "password"}" value="${esc(m.apiKey)}" placeholder="${esc(m.hasApiKey ? t("apiKeyKeepPlaceholder") : t("apiKeyPlaceholder"))}" />
              <button class="eye-btn" data-action="toggle-eye">${iconSvg(ui.showApiKey ? "eye" : "eyeOff")}</button>
            </div>
            <button class="btn" data-action="modal-fetch-models" ${ui.fetchingModels ? "disabled" : ""}>${ui.fetchingModels ? t("fetching") : t("fetchModels")}</button>
            <button class="btn" data-action="modal-test" ${ui.testing ? "disabled" : ""}>${ui.testing ? t("testing") : t("testConn")}</button>
          </div>
        </div>

        ${ui.fetchError ? `<div class="test-msg err"><span class="dot"></span><span>${esc(ui.fetchError)}</span></div>` : ""}

        <div class="fetch-box">
          <div class="field-label">
            <span>${t("tabModels")} · ${t("selectedCount")} ${selectedCount}</span>
            ${selectedCount ? `<button class="btn xs ghost" data-action="clear-fetched-sel">${t("clearSel")}</button>` : ""}
          </div>
          ${ui.fetchedModels.length ? `
            <div class="search-wrap">
              <span class="search-icon">${iconSvg("search")}</span>
              <input class="search-input" id="m-fetch-search" aria-label="${t("searchPlaceholder")}" value="${esc(ui.fetchSearch)}" placeholder="${t("searchPlaceholder")}" />
            </div>
            <div class="fetch-list">
              ${fetchedFiltered.map((model) => {
                const checked = ui.selectedFetchedModels.has(model.id);
                return `<button class="fetch-item ${checked ? "selected" : ""}" role="checkbox" aria-checked="${checked}" data-action="toggle-fetched-model" data-model-id="${esc(model.id)}">
                  <span class="fetch-item-name">
                    <span class="check-box" aria-hidden="true">${checked ? "✓" : ""}</span>
                    <span class="mono truncate">${esc(model.id)}</span>
                  </span>
                  ${model.ownedBy ? `<span class="fetch-owner">${esc(model.ownedBy)}</span>` : ""}
                </button>`;
              }).join("") || `<span class="fetch-owner">${t("fetchEmpty")}</span>`}
            </div>` : ""}
          <div class="input-row">
            <input class="text-input mono" id="m-manual-model" aria-label="${t("manualModel")}" value="${esc(m.manualModel)}" placeholder="${t("manualModel")}" />
            <button class="btn xs" data-action="add-manual-model">${iconSvg("plus")} ${t("joinModel")}</button>
          </div>
        </div>

        ${m.forInspector ? `<label class="channel-inspector-option">
          <input type="checkbox" id="m-set-inspector" ${m.setAsInspector ? "checked" : ""} />
          <span>${t("setAsInspector")}</span>
        </label>` : ""}

        ${
          ui.testResult
            ? `<div class="test-msg ${ui.testResult.ok ? "ok" : "err"}">
                <span class="dot"></span>
                <span>${ui.testResult.ok ? `${t("connOk")}${ui.testResult.latencyMs ? ` · ${ui.testResult.latencyMs}ms` : ""}` : `${t("connFail")}: ${esc(ui.testResult.error || "")}`}</span>
              </div>`
            : ""
        }

        ${ui.saveError ? `<div class="test-msg err" role="alert">${esc(ui.saveError)}</div>` : ""}

        <div class="modal-foot">
          <button class="btn" data-action="close-modal">${t("cancel")}</button>
          <button class="btn primary" data-action="modal-save" ${m.saving ? "disabled" : ""}>${t("save")}</button>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById("root");
  if (!state) {
    root.innerHTML = `<div class="app-shell"><div class="card empty-state">Loading A.stand...</div></div>`;
    return;
  }

  const on = state.settings.enabled;
  const lang = state.settings.lang === "en" ? "en" : "zh";
  const hitBadge = state.telemetry?.cumulativeHitRate != null ? `${state.telemetry.cumulativeHitRate}%` : "";
  const liveCount = state.activeJobs?.length || 0;

  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-icon">${iconSvg("brand")}</div>
          <div class="brand-title">
            <span>${t("brand")}</span>
            <span class="status-pill ${on ? "on" : "off"}">
              <span class="dot ${on ? "pulse" : ""}"></span>
              ${on ? t("on") : t("off")}
            </span>
          </div>
        </div>
        <div class="topbar-actions">
          <div class="seg">
            <button class="seg-btn ${lang === "zh" ? "active" : ""}" data-action="set-lang" data-lang="zh">中</button>
            <button class="seg-btn ${lang === "en" ? "active" : ""}" data-action="set-lang" data-lang="en">EN</button>
          </div>
          <button class="switch ${on ? "on" : ""}" data-action="toggle-master" aria-label="master switch"></button>
        </div>
      </header>

      <nav class="nav-tabs">
        <button class="nav-tab ${ui.tab === "team" ? "active" : ""}" data-action="set-tab" data-tab="team">
          <span>${t("tabTeam")}</span>
          ${liveCount > 0 ? `<span class="engine-tag" style="color:var(--ar-emerald)">${liveCount}</span>` : ""}
        </button>
        <button class="nav-tab ${ui.tab === "models" ? "active" : ""}" data-action="set-tab" data-tab="models">${t("tabModels")}</button>
        <button class="nav-tab ${ui.tab === "cache" ? "active" : ""}" data-action="set-tab" data-tab="cache">
          <span>${t("tabCache")}</span>
          ${hitBadge ? `<span class="engine-tag" style="color:var(--ar-emerald)">${hitBadge}</span>` : ""}
        </button>
        <button class="nav-tab ${ui.tab === "settings" ? "active" : ""}" data-action="set-tab" data-tab="settings">${t("tabSettings")}</button>
      </nav>

      ${
        ui.detailJobId
          ? renderJobDetailView()
          : ui.tab === "team"
          ? renderTeamTab()
          : ui.tab === "models"
          ? renderModelsTab()
          : ui.tab === "cache"
          ? renderCacheTab()
          : renderSettingsTab()
      }
    </div>
    ${renderModal()}
    ${ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : ""}
  `;

  restoreDetailScroll();

  const searchEl = document.getElementById("m-prov-search");
  if (searchEl && ui.providerDropdownOpen) {
    searchEl.focus();
    searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
  }
  const fetchSearchEl = document.getElementById("m-fetch-search");
  if (fetchSearchEl && ui.focusFetchSearch) {
    ui.focusFetchSearch = false;
    fetchSearchEl.focus();
    fetchSearchEl.setSelectionRange(fetchSearchEl.value.length, fetchSearchEl.value.length);
  }
  positionFloatingMenus();
}

window.addEventListener("resize", () => positionFloatingMenus());
document.addEventListener(
  "scroll",
  (e) => {
    if (!e.target?.closest?.(".dropdown-menu, .harness-sublist")) {
      positionFloatingMenus();
    }
  },
  true
);

function openChannelModal(channel, forInspector = false) {
  ui.openDropdownRole = null;
  ui.openFallbackRole = null;
  ui.inspectorDropdownOpen = false;
  ui.expandedHarness = null;
  ui.providerDropdownOpen = false;
  ui.providerSearch = "";
  ui.showApiKey = false;
  ui.testing = false;
  ui.testResult = null;
  ui.fetchingModels = false;
  ui.fetchError = "";
  ui.saveError = "";
  ui.fetchSearch = "";
  const names = [...new Set((channel?.models || []).map((model) => model.modelName))];
  ui.fetchedModels = names.map((id) => ({ id }));
  ui.selectedFetchedModels = new Set(names);
  ui.modal = {
    id: channel?.id,
    name: channel?.name || "",
    providerId: channel?.providerId || "",
    baseUrl: channel?.baseUrl || "",
    savedBaseUrl: channel?.baseUrl || "",
    apiKey: "",
    hasApiKey: Boolean(channel?.hasApiKey),
    manualModel: "",
    forInspector,
    setAsInspector: forInspector,
  };
  render();
}

function modalKeyError(modal) {
  const key = modal.apiKey.trim();
  if (/^https?:\/\//i.test(key)) return t("keyLooksLikeUrl");
  if (key || !modal.id || !modal.baseUrl.trim()) return "";
  try {
    const origin = new URL(modal.baseUrl).origin;
    if (origin !== "null" && origin === new URL(modal.savedBaseUrl).origin) return "";
  } catch {}
  return t("newEndpointKeyRequired");
}

function syncModalInputs() {
  if (!ui.modal) return;
  for (const [id, field] of [
    ["m-channel-name", "name"],
    ["m-base-url", "baseUrl"],
    ["m-api-key", "apiKey"],
    ["m-manual-model", "manualModel"],
  ]) {
    const input = document.getElementById(id);
    if (input) ui.modal[field] = input.value;
  }
  const inspector = document.getElementById("m-set-inspector");
  if (inspector) ui.modal.setAsInspector = inspector.checked;
}

document.addEventListener("input", (e) => {
  if (e.target.id === "m-prov-search") {
    ui.providerSearch = e.target.value;
    render();
    return;
  }
  if (e.target.id === "m-fetch-search") {
    ui.fetchSearch = e.target.value;
    ui.focusFetchSearch = true;
    render();
    return;
  }
  syncModalInputs();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "m-manual-model") {
    e.preventDefault();
    document.querySelector('[data-action="add-manual-model"]')?.click();
  }
});

document.addEventListener("mouseover", (e) => {
  const row = e.target?.closest?.("[data-harness-hover]");
  if (row) {
    const eid = row.dataset.harnessHover;
    const group = row.closest(".harness-group");
    const menu = row.closest(".dropdown-menu");
    if (!eid || !group || !menu || !canHarnessFlyout(menu)) return;
    ui.expandedHarness = eid;
    for (const sib of menu.querySelectorAll(".harness-group.expanded")) {
      if (sib !== group) {
        sib.classList.remove("expanded");
        positionHarnessFlyout(sib);
      }
    }
    if (!group.classList.contains("expanded")) {
      group.classList.add("expanded");
    }
    positionHarnessFlyout(group);
    return;
  }
  const disabledRow = e.target?.closest?.(".harness-row.disabled");
  if (disabledRow) {
    const menu = disabledRow.closest(".dropdown-menu");
    if (menu && canHarnessFlyout(menu)) {
      ui.expandedHarness = null;
      for (const sib of menu.querySelectorAll(".harness-group.expanded")) {
        sib.classList.remove("expanded");
        positionHarnessFlyout(sib);
      }
    }
  }
});

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) {
    if ((ui.openDropdownRole || ui.openFallbackRole || ui.inspectorDropdownOpen) && !e.target.closest(".dropdown")) {
      ui.openDropdownRole = null;
      ui.openFallbackRole = null;
      ui.inspectorDropdownOpen = false;
      ui.expandedHarness = null;
      render();
    }
    return;
  }

  const act = el.dataset.action;

  if (act === "close-modal-bg") {
    if (e.target === el) {
      ui.modal = null;
      ui.providerDropdownOpen = false;
      render();
    }
    return;
  }
  if (act === "close-modal") {
    ui.modal = null;
    ui.providerDropdownOpen = false;
    render();
    return;
  }
  if (act === "toggle-step-detail") {
    const sid = el.dataset.stepId || "";
    if (sid) {
      if (ui.expandedStepIds.has(sid)) ui.expandedStepIds.delete(sid);
      else ui.expandedStepIds.add(sid);
    }
    const scroller = document.querySelector('[data-scroll="job-detail"]');
    if (scroller) {
      detailScroll.top = scroller.scrollTop;
      detailScroll.atBottom = false;
    }
    render();
    const buttons = document.querySelectorAll('[data-action="toggle-step-detail"]');
    Array.from(buttons).find((button) => button.dataset.stepId === sid)?.focus({ preventScroll: true });
    return;
  }
  if (act === "set-tab") {
    ui.tab = el.dataset.tab;
    ui.detailJobId = null;
    ui.detailJob = null;
    ui.detailError = "";
    ui.expandedStepIds.clear();
    ui.openDropdownRole = null;
    ui.openFallbackRole = null;
    ui.inspectorDropdownOpen = false;
    ui.expandedHarness = null;
    ui.highlightEngine = null;
    render();
    return;
  }
  if (act === "toggle-inspector-dd") {
    ui.openDropdownRole = null;
    ui.openFallbackRole = null;
    ui.inspectorDropdownOpen = !ui.inspectorDropdownOpen;
    render();
    return;
  }
  if (act === "pick-inspector-model") {
    const mid = el.dataset.model;
    ui.inspectorDropdownOpen = false;
    await callTool("agent_relay_ui_update_settings", { inspectorModelId: mid });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "goto-engine-setup") {
    const eid = el.dataset.engine;
    ui.openDropdownRole = null;
    ui.openFallbackRole = null;
    ui.inspectorDropdownOpen = false;
    ui.expandedHarness = null;
    ui.tab = "models";
    ui.highlightEngine = eid || null;
    render();
    if (eid) {
      document.getElementById(`engine-card-${eid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }
  if (act === "toggle-harness") {
    const eid = el.dataset.engine;
    const group = el.closest(".harness-group");
    const menu = el.closest(".dropdown-menu");
    if (group && menu) {
      const wasOpen = group.classList.contains("expanded");
      for (const sib of menu.querySelectorAll(".harness-group.expanded")) {
        sib.classList.remove("expanded");
        positionHarnessFlyout(sib);
      }
      if (!wasOpen) {
        group.classList.add("expanded");
        ui.expandedHarness = eid;
        positionHarnessFlyout(group);
      } else {
        ui.expandedHarness = null;
      }
    }
    return;
  }
  if (act === "toggle-inspector") {
    const cur = Boolean(state.settings.inspectorEnabled && state.settings.inspectorModelId);
    if (cur) {
      await callTool("agent_relay_ui_update_settings", { inspectorEnabled: false });
      showToast(t("saved"));
      render();
      return;
    }
    const apiModels = getApiLibraryModels();
    if (apiModels.length > 0) {
      const keepExisting = apiModels.some((m) => m.id === state.settings.inspectorModelId);
      await callTool("agent_relay_ui_update_settings", {
        inspectorEnabled: true,
        inspectorModelId: keepExisting ? state.settings.inspectorModelId : apiModels[0].id,
      });
      showToast(t("saved"));
      render();
      return;
    }
    openChannelModal(null, true);
    return;
  }
  if (act === "set-lang") {
    await callTool("agent_relay_ui_update_settings", { lang: el.dataset.lang });
    render();
    return;
  }
  if (act === "toggle-master") {
    await callTool("agent_relay_ui_update_settings", { enabled: !state.settings.enabled });
    render();
    return;
  }
  if (act === "toggle-bool") {
    const key = el.dataset.key;
    await callTool("agent_relay_ui_update_settings", { [key]: !state.settings[key] });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "set-num") {
    const key = el.dataset.key;
    const val = Number(el.dataset.val);
    await callTool("agent_relay_ui_update_settings", { [key]: val });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "toggle-role-dd") {
    const r = el.dataset.role;
    ui.openFallbackRole = null;
    ui.inspectorDropdownOpen = false;
    ui.expandedHarness = null;
    ui.openDropdownRole = ui.openDropdownRole === r ? null : r;
    render();
    return;
  }
  if (act === "toggle-fb-dd") {
    const r = el.dataset.role;
    ui.openDropdownRole = null;
    ui.inspectorDropdownOpen = false;
    ui.expandedHarness = null;
    ui.openFallbackRole = ui.openFallbackRole === r ? null : r;
    render();
    return;
  }
  if (act === "pick-role-model") {
    const r = el.dataset.role;
    const mid = el.dataset.model;
    ui.openDropdownRole = null;
    ui.expandedHarness = null;
    await callTool("agent_relay_ui_update_settings", { roles: { [r]: { modelId: mid } } });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "add-fallback") {
    const r = el.dataset.role;
    const mid = el.dataset.model;
    ui.openFallbackRole = null;
    ui.expandedHarness = null;
    const cur = state.settings.roles[r]?.queue || [state.settings.roles[r]?.modelId];
    const next = [...new Set([...cur, mid])];
    await callTool("agent_relay_ui_update_settings", { roles: { [r]: { queue: next } } });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "promote-fallback") {
    const r = el.dataset.role;
    const mid = el.dataset.model;
    await callTool("agent_relay_ui_update_settings", { roles: { [r]: { modelId: mid } } });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "remove-fallback") {
    const r = el.dataset.role;
    const mid = el.dataset.model;
    const cur = state.settings.roles[r]?.queue || [];
    const next = cur.filter((id) => id !== mid);
    if (next.length > 0) {
      await callTool("agent_relay_ui_update_settings", { roles: { [r]: { queue: next } } });
      showToast(t("saved"));
      render();
    }
    return;
  }
  if (act === "clear-cooldown") {
    await callTool("agent_relay_ui_session_action", {
      action: "clear_cooldown",
      modelId: el.dataset.model,
    });
    showToast(t("refreshed"));
    render();
    return;
  }
  if (act === "stop-job") {
    const jobId = el.dataset.job;
    if (e?.stopPropagation) e.stopPropagation();
    await callTool("agent_relay_ui_session_action", {
      action: "interrupt",
      jobId,
    });
    showToast(t("stopJob"));
    // When stopped from the job detail view, keep it open and pull the final timeline.
    if (ui.detailJobId === jobId) await refreshJobDetail({ silent: true });
    else render();
    return;
  }
  if (act === "open-job-detail") {
    if (e?.stopPropagation) e.stopPropagation();
    ui.detailSrc = el.dataset.src || ui.tab || "team";
    ui.detailJobId = el.dataset.job;
    ui.detailJob = null;
    ui.detailError = "";
    ui.expandedStepIds.clear();
    ui.openDropdownRole = null;
    ui.openFallbackRole = null;
    ui.inspectorDropdownOpen = false;
    detailScroll.atBottom = false;
    detailScroll.top = 0;
    await refreshJobDetail();
    scheduleNextPoll();
    return;
  }
  if (act === "close-job-detail") {
    ui.detailJobId = null;
    ui.detailJob = null;
    ui.detailError = "";
    ui.detailLoading = false;
    ui.expandedStepIds.clear();
    if (el.dataset.src) ui.tab = el.dataset.src;
    render();
    return;
  }
  if (act === "copy-job-log") {
    copyText(ui.detailJob?.logPath || "");
    return;
  }
  if (act === "copy-resume-prompt") {
    copyText(t("resumePrompt").replace("%s", el.dataset.sid || ""));
    return;
  }
  if (act === "dismiss-interrupted" || act === "dismiss-interrupted-all") {
    const jobId = act === "dismiss-interrupted-all" ? undefined : el.dataset.job;
    if (e?.stopPropagation) e.stopPropagation();
    await callTool("agent_relay_ui_dismiss_interrupted", jobId ? { jobId } : {});
    render();
    return;
  }
  if (act === "refresh-quota") {
    await callTool("agent_relay_ui_get_state", { forceDetect: false, fetchRateLimits: true });
    showToast(t("refreshed"));
    render();
    return;
  }
  if (act === "set-effort") {
    const r = el.dataset.role;
    const ef = el.dataset.effort;
    await callTool("agent_relay_ui_update_settings", { roles: { [r]: { effort: ef } } });
    render();
    return;
  }
  if (act === "toggle-channel") {
    const id = el.dataset.channel;
    if (ui.expandedChannels.has(id)) ui.expandedChannels.delete(id);
    else ui.expandedChannels.add(id);
    render();
    const toggle = [...document.querySelectorAll('[data-action="toggle-channel"]')].find((button) => button.dataset.channel === id);
    toggle?.focus({ preventScroll: true });
    return;
  }
  if (act === "open-add-modal") {
    openChannelModal(null, el.dataset.forInspector === "1");
    return;
  }
  if (act === "open-manage-channel") {
    const channel = getApiChannels().find((c) => c.id === el.dataset.channel && c.source === "custom");
    if (channel) openChannelModal(channel);
    return;
  }
  if (act === "toggle-prov-dd") {
    syncModalInputs();
    ui.providerDropdownOpen = !ui.providerDropdownOpen;
    render();
    return;
  }
  if (act === "pick-provider") {
    syncModalInputs();
    const pid = el.dataset.prov;
    const p = (state.providers || []).find((x) => x.id === pid);
    ui.modal.providerId = pid;
    if (p?.baseUrl) ui.modal.baseUrl = p.baseUrl;
    ui.providerDropdownOpen = false;
    ui.testResult = null;
    ui.fetchError = "";
    render();
    return;
  }
  if (act === "toggle-eye") {
    syncModalInputs();
    ui.showApiKey = !ui.showApiKey;
    render();
    return;
  }
  if (act === "modal-fetch-models" || act === "modal-test") {
    syncModalInputs();
    const m = ui.modal;
    const fetching = act === "modal-fetch-models";
    const invalid = modalKeyError(m)
      || (!m.baseUrl.trim() || (!m.apiKey.trim() && !m.hasApiKey) ? t("missingBaseOrKey") : "");
    ui.fetchError = "";
    ui.testResult = null;
    if (invalid) {
      if (fetching) ui.fetchError = invalid;
      else ui.testResult = { ok: false, error: invalid };
      render();
      return;
    }
    const busy = fetching ? "fetchingModels" : "testing";
    ui[busy] = true;
    render();
    try {
      const connection = { baseUrl: m.baseUrl, apiKey: m.apiKey, channelId: m.id };
      if (fetching) {
        const res = await callTool("agent_relay_ui_fetch_models", connection);
        if (ui.modal !== m) return;
        if (res?.ok && Array.isArray(res.models)) {
          const merged = new Map(ui.fetchedModels.map((model) => [model.id, model]));
          for (const model of res.models) merged.set(model.id, model);
          ui.fetchedModels = [...merged.values()];
          ui.fetchSearch = "";
        } else {
          ui.fetchError = `${t("connFail")}: ${res?.error || "unknown"}`;
        }
      } else {
        const res = await callTool("agent_relay_ui_test_connection", {
          ...connection,
          mode: "api",
          modelName: ui.selectedFetchedModels.values().next().value,
        });
        if (ui.modal === m) ui.testResult = res;
      }
    } catch (err) {
      if (ui.modal === m) {
        if (fetching) ui.fetchError = `${t("connFail")}: ${err.message}`;
        else ui.testResult = { ok: false, error: err.message };
      }
    } finally {
      if (ui.modal === m) {
        ui[busy] = false;
        render();
      }
    }
    return;
  }
  if (act === "toggle-fetched-model") {
    const modelName = el.dataset.modelId;
    const scrollTop = el.closest(".fetch-list")?.scrollTop || 0;
    if (ui.selectedFetchedModels.has(modelName)) ui.selectedFetchedModels.delete(modelName);
    else ui.selectedFetchedModels.add(modelName);
    render();
    const list = document.querySelector(".modal .fetch-list");
    if (list) list.scrollTop = scrollTop;
    const checkbox = [...document.querySelectorAll('[data-action="toggle-fetched-model"]')].find((button) => button.dataset.modelId === modelName);
    checkbox?.focus({ preventScroll: true });
    return;
  }
  if (act === "clear-fetched-sel") {
    ui.selectedFetchedModels.clear();
    render();
    return;
  }
  if (act === "add-manual-model") {
    syncModalInputs();
    const id = ui.modal.manualModel.trim();
    if (!id) return;
    if (!ui.fetchedModels.some((model) => model.id === id)) ui.fetchedModels.unshift({ id });
    ui.selectedFetchedModels.add(id);
    ui.modal.manualModel = "";
    ui.fetchSearch = "";
    render();
    document.getElementById("m-manual-model")?.focus();
    return;
  }
  if (act === "modal-save") {
    syncModalInputs();
    const m = ui.modal;
    const modelNames = [...ui.selectedFetchedModels];
    const invalid = modalKeyError(m) || (
      !m.baseUrl.trim() ? t("missingBaseUrl")
        : !m.id && !modelNames.length ? t("missingBaseOrModel") : ""
    );
    if (invalid) {
      ui.testResult = { ok: false, error: invalid };
      render();
      return;
    }
    m.saving = true;
    ui.saveError = "";
    render();
    try {
      const result = await callTool("agent_relay_ui_upsert_channel", {
        id: m.id,
        name: m.name,
        providerId: m.providerId,
        baseUrl: m.baseUrl,
        apiKey: m.apiKey,
        modelNames,
        setAsInspector: m.setAsInspector,
      });
      if (!result?.lastSavedChannelId) throw new Error(result?.content?.[0]?.text || t("saveFailed"));
      if (ui.modal === m) ui.modal = null;
      showToast(t("saved"));
    } catch (err) {
      if (ui.modal === m) {
        m.saving = false;
        ui.saveError = `${t("saveFailed")}: ${err.message}`;
        render();
      }
    }
    return;
  }
  if (act === "delete-channel" || act === "remove-channel-model") {
    const channelId = el.dataset.channel;
    if (act === "delete-channel") {
      await callTool("agent_relay_ui_delete_channel", { channelId });
      ui.expandedChannels.delete(channelId);
    } else {
      await callTool("agent_relay_ui_remove_channel_model", { channelId, modelId: el.dataset.modelId });
    }
    showToast(t("deleted"));
    return;
  }
  if (act === "refresh-detect") {
    await callTool("agent_relay_ui_get_state", { forceDetect: true, fetchRateLimits: true });
    showToast(t("refreshed"));
    render();
    return;
  }
  if (act === "quick-test-cli") {
    const eid = el.dataset.engine;
    const res = await callTool("agent_relay_ui_test_connection", { mode: "cli", engine: eid });
    showToast(
      res?.ok
        ? `${t("connOk")}${res.latencyMs ? ` · ${res.latencyMs}ms` : ""}`
        : `${t("connFail")}: ${res?.error || ""}`
    );
    await callTool("agent_relay_ui_get_state", { forceDetect: true, fetchRateLimits: true });
    render();
    return;
  }
  if (act === "session-act") {
    await callTool("agent_relay_ui_session_action", {
      action: el.dataset.act,
      sessionId: el.dataset.sid,
    });
    showToast(t("saved"));
    render();
    return;
  }
  if (act === "clear-logs") {
    await callTool("agent_relay_ui_clear_logs", {});
    showToast(t("deleted"));
    render();
    return;
  }
  if (act === "copy-text") {
    copyText(el.dataset.text || "");
    return;
  }
  if (act === "copy-inner") {
    copyText(el.textContent || "");
    return;
  }
  if (act === "open-link") {
    openExternal(el.dataset.url || "");
  }
});

app.ontoolinput = () => {
  if (!state) render();
};

app.ontoolresult = (result) => {
  if (result?.structuredContent?.settings) {
    state = result.structuredContent;
    syncLivePolling();
    render();
  }
};

app.onhostcontextchanged = (ctx) => {
  applyTheme(ctx);
};

async function boot() {
  render();
  try {
    await app.connect(createCompatibleTransport());
    if (rawHostContext) applyTheme(rawHostContext);
    applyTheme(app.getHostContext?.());

    // Give the host a brief moment to push initial ontoolresult before fetching explicitly
    await new Promise((r) => setTimeout(r, 120));
    if (!state) {
      reportedDiag = true;
      await callTool("agent_relay_ui_get_state", {
        forceDetect: false,
        fetchRateLimits: false,
        clientDiag: handshakeDiag,
      });
      render();
    }

    const needBgSync = Boolean(
      state?.engines?.codex?.status === "ready" &&
        (!state?.codexRateLimits || (state?.codexModels?.length || 0) <= 1)
    );
    if (needBgSync || !reportedDiag) {
      reportedDiag = true;
      callTool("agent_relay_ui_get_state", {
        forceDetect: false,
        fetchRateLimits: needBgSync,
        clientDiag: handshakeDiag,
      })
        .then(() => render())
        .catch(() => {});
    }
  } catch (err) {
    showFatalError(err);
  }
}

boot();
