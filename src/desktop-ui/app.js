/**
 * A.stand v2 — Magpie-style standalone desktop console.
 *
 * Runs entirely offline inside the Tauri/WebView2 shell (or any modern browser)
 * against the local daemon's frozen HTTP + SSE contract:
 *
 *   GET  /api/state   ·  GET /api/jobs/:id   ·  GET /api/events (SSE)
 *   POST /api/clients ·  PATCH/DELETE /api/clients/:id · GET /api/clients/:id/setup
 *   POST /api/settings · /api/models · /api/channels · /api/fetch-models
 *   POST /api/test-connection · /api/session-action · /api/dismiss-interrupted · /api/clear-logs
 *
 * No eval, no inline handlers, no external resources. Every dynamic string is
 * escaped through `esc()` before it reaches innerHTML.
 */

import { iconSvg, clientIconSvg, CLIENT_ICON_KEYS, normalizeClientIconKey } from "./icons.js";
import { createExtensionsView } from "./extensions-view.js";

/* ==========================================================================
   Constants
   ========================================================================== */
const TOKEN_STORAGE_KEY = "astand_ui_token";
const THEME_STORAGE_KEY = "astand_theme";
const SIDEBAR_STORAGE_KEY = "astand_sidebar_collapsed";
const REFRESH_DEBOUNCE_MS = 250;
const POLL_INTERVAL_MS = 8000;
const SSE_STALE_MS = 25000;
const MAX_RECONNECT_MS = 30000;

const DEFAULT_GATEWAY = "127.0.0.1:3426";

/**
 * The daemon serves this document, so relative `/api/...` URLs are the contract.
 * Two hosting modes still need an absolute origin:
 *   - `file://` documents (opening dist/desktop.html directly)
 *   - Tauri's asset host (`tauri.localhost`), which is not the daemon
 */
const API_BASE = (() => {
  try {
    const { protocol, hostname } = location;
    if (protocol === "http:" || protocol === "https:") {
      if (/^tauri\.localhost$/i.test(hostname)) return `http://${DEFAULT_GATEWAY}`;
      return "";
    }
  } catch {
    /* ignore */
  }
  return `http://${DEFAULT_GATEWAY}`;
})();

const PAGES = ["clients", "activity", "roles", "extensions", "providers", "observability", "settings"];

const ENGINE_ORDER = ["codex", "deepseek-harness", "claude-code", "antigravity"];

const ENGINE_FALLBACK_LABELS = {
  codex: { zh: "OpenAI · Codex CLI", en: "OpenAI · Codex CLI", tag: "Codex" },
  "claude-code": { zh: "Anthropic · Claude Code", en: "Anthropic · Claude Code", tag: "Claude" },
  antigravity: { zh: "Google · Antigravity CLI", en: "Google · Antigravity CLI", tag: "AGY" },
  "deepseek-harness": { zh: "DeepSeek Harness (dsh)", en: "DeepSeek Harness (dsh)", tag: "DSH" },
};

/* ==========================================================================
   i18n — each entry is [中文, English]
   ========================================================================== */
const STRINGS = {
  brand: ["A.stand", "A.stand"],
  versionPill: ["v2", "v2"],

  groupConnect: ["接入", "CONNECT"],
  groupDispatch: ["调度", "DISPATCH"],
  groupModels: ["模型", "MODELS"],
  groupObserve: ["观测", "OBSERVE"],
  groupSystem: ["系统", "SYSTEM"],

  navClients: ["已接上游", "Upstream Clients"],
  navActivity: ["实时任务", "Live Activity"],
  navRoles: ["角色与队列", "Roles & Queues"],
  navExtensions: ["技能与扩展", "Skills & Extensions"],
  navProviders: ["模型供应商", "Model Providers"],
  navObservability: ["缓存与耗时", "Cache & Latency"],
  navSettings: ["全局设置", "Settings"],

  titleClients: ["已接上游", "Upstream Clients"],
  subClients: ["管理已接入的 AI 客户端、注册码与接入 Prompt", "Manage connected AI clients, tokens and setup prompts"],
  titleActivity: ["实时任务", "Live Activity"],
  subActivity: ["运行中子 Agent、最近任务与崩溃恢复", "Running subagents, recent jobs and crash recovery"],
  titleRoles: ["角色与队列", "Roles & Queues"],
  subRoles: ["白泽（审查）与祝融（执行）的模型优先级队列", "Model priority queues for Oracle (review) and Hephaestus (build)"],
  titleExtensions: ["技能与扩展", "Skills & Extensions"],
  subExtensions: ["Skill 技能、子 Agent MCP 与可复用模板", "Skills, subagent MCP attachments and reusable templates"],
  titleProviders: ["模型供应商", "Model Providers"],
  subProviders: ["CLI 引擎、Codex 配额与 API 渠道", "CLI engines, Codex quota and API channels"],
  titleObservability: ["缓存与耗时", "Cache & Latency"],
  subObservability: ["Prompt Cache 命中率与任务耗时统计", "Prompt cache hit rates and job latency stats"],
  titleSettings: ["全局设置", "Settings"],
  subSettings: ["调度、自动化、外观与网关信息", "Dispatch, automation, appearance and gateway info"],

  collapseSidebar: ["收起侧边栏", "Collapse sidebar"],
  expandSidebar: ["展开侧边栏", "Expand sidebar"],
  copyGateway: ["复制 MCP 地址", "Copy MCP URL"],
  gatewayCopied: ["MCP 地址已复制", "MCP URL copied"],
  themeLight: ["浅色", "Light"],
  themeDark: ["深色", "Dark"],
  themeSystem: ["跟随系统", "System"],
  themeToggle: ["切换主题", "Toggle theme"],
  langZh: ["中文", "中文"],
  langEn: ["English", "English"],

  copy: ["复制", "Copy"],
  copied: ["已复制", "Copied"],
  save: ["保存", "Save"],
  saved: ["已保存", "Saved"],
  cancel: ["取消", "Cancel"],
  close: ["关闭", "Close"],
  delete: ["删除", "Delete"],
  confirm: ["确认", "Confirm"],
  retry: ["重试", "Retry"],
  refresh: ["刷新", "Refresh"],
  loading: ["加载中…", "Loading…"],
  none: ["—", "—"],
  on: ["已开启", "On"],
  off: ["已关闭", "Off"],
  add: ["添加", "Add"],
  remove: ["移除", "Remove"],
  edit: ["编辑", "Edit"],
  search: ["搜索", "Search"],
  back: ["返回", "Back"],

  searchClients: ["查找已接上游…", "Search clients…"],
  maskTokens: ["密码打码", "Mask tokens"],
  showTokens: ["显示注册码", "Show tokens"],
  addClient: ["接入新上游", "Connect upstream"],
  connected: ["已连接", "Connected"],
  awaitingFirst: ["等待首次连接", "Awaiting first connection"],
  paused: ["已停用", "Paused"],
  disabledClients: ["已停用的上游", "Disabled upstreams"],
  noClients: ["还没有接入任何上游", "No upstream clients yet"],
  noClientsDesc: [
    "点击「接入新上游」生成注册码与 AI 接入 Prompt，直接粘贴给你的 AI 客户端即可自动完成配置。",
    "Click “Connect upstream” to generate a token and a ready-to-paste AI setup prompt for your client.",
  ],
  noSearchResult: ["没有匹配的上游", "No matching upstreams"],
  lastActive: ["最近活跃", "Last active"],
  calls: ["调用", "Calls"],
  times: ["次", "calls"],
  never: ["从未", "Never"],
  copyPrompt: ["复制 Prompt", "Copy prompt"],
  justNow: ["刚刚", "just now"],
  minutesAgo: ["%s 分钟前", "%s min ago"],
  hoursAgo: ["%s 小时前", "%s h ago"],
  daysAgo: ["%s 天前", "%s d ago"],
  transportHttp: ["HTTP", "HTTP"],
  transportStdio: ["stdio 桥", "stdio bridge"],

  registerTitle: ["接入新上游", "Connect a new upstream"],
  registerSub: [
    "生成注册码后，把接入 Prompt 直接粘贴给你的 AI 客户端。",
    "Generate a token, then paste the setup prompt into your AI client.",
  ],
  nicknameLabel: ["上游昵称（可选）", "Upstream nickname (optional)"],
  nicknamePlaceholder: ["留空则首次连接时自动识别软件名称", "Leave empty to auto-detect on first connection"],
  generateToken: ["生成注册码与接入 Prompt", "Generate token & setup prompt"],
  generating: ["正在生成…", "Generating…"],
  registerHint: [
    "支持 Antigravity / Codex / Claude Code / Cursor / WorkBuddy / Windsurf / VS Code 等所有 MCP 客户端。",
    "Works with Antigravity, Codex, Claude Code, Cursor, WorkBuddy, Windsurf, VS Code and any MCP client.",
  ],

  setupTitle: ["接入 Prompt", "Setup prompt"],
  setupSub: ["把下面的内容直接粘贴给你的 AI 客户端", "Paste the following into your AI client"],
  promptHeroTitle: ["一键复制 AI 接入 Prompt", "One-click AI setup prompt"],
  promptHeroDesc: [
    "直接粘贴发给 Antigravity / Codex / Claude Code / Cursor / WorkBuddy，让 AI 自己完成连接和规则配置。",
    "Paste it into Antigravity / Codex / Claude Code / Cursor / WorkBuddy and let the AI configure the connection and rules itself.",
  ],
  tabPrompt: ["AI 接入 Prompt", "AI setup prompt"],
  tabHttp: ["HTTP 配置 JSON", "HTTP config JSON"],
  tabStdio: ["stdio 传话桥兜底", "stdio bridge fallback"],
  stdioHint: [
    "适用于 Cursor OAuth 或较老的客户端：通过本地 stdio 传话桥连接。",
    "For Cursor OAuth or older clients: connect through the local stdio bridge.",
  ],
  copyPromptBig: ["一键复制 AI 接入 Prompt", "Copy AI setup prompt"],
  waitingHandshake: ["等待上游首次握手…", "Waiting for the first upstream handshake…"],
  connectedAs: ["已识别并连接：%s", "Connected: %s"],
  waitingHint: [
    "发给 AI 写入配置后，如未立刻变绿，请在该 AI 里刷新 MCP 或再发一条消息",
    "After sending it to your AI, if this does not turn green, refresh MCP or send one more message in that client",
  ],
  promptMissing: ["服务端未返回接入 Prompt，请改用 HTTP 配置 JSON。", "The server did not return a setup prompt; use the HTTP config JSON instead."],
  viewPrompt: ["查看接入 Prompt", "View setup prompt"],

  detailTitle: ["上游详情", "Upstream details"],
  renameLabel: ["显示名称", "Display name"],
  renamePlaceholder: ["留空使用自动识别的名称", "Leave empty to use the detected name"],
  iconLabel: ["图标", "Icon"],
  enabledLabel: ["启用该上游", "Enable this upstream"],
  enabledDesc: ["停用后该上游无法调用 A.stand，但配置会保留。", "When disabled the client cannot call A.stand, but its config is kept."],
  tokenLabel: ["注册码", "Token"],
  tokenDesc: ["注册码等同于访问凭证，请勿泄露给他人。", "The token is a credential — never share it."],
  resetToken: ["重置注册码", "Reset token"],
  resetTokenDesc: ["旧注册码会立即失效，需要重新接入。", "The old token stops working immediately; the client must reconnect."],
  deleteClient: ["删除上游", "Delete upstream"],
  deleteClientDesc: ["删除后需要重新生成注册码才能接入。", "You must generate a new token to reconnect after deleting."],
  saveName: ["保存名称", "Save name"],
  confirmResetToken: ["确认重置注册码？", "Reset this token?"],
  confirmResetTokenMsg: [
    "旧注册码会立即失效，已连接的客户端需要重新接入。",
    "The old token stops working immediately and connected clients must reconnect.",
  ],
  confirmDeleteClient: ["确认删除该上游？", "Delete this upstream?"],
  confirmDeleteClientMsg: [
    "该操作不可撤销，删除后需要重新生成注册码。",
    "This cannot be undone. You will need a new token to reconnect.",
  ],
  clientNotFound: ["未找到该上游", "Upstream not found"],

  crashTitle: ["检测到崩溃恢复任务", "Crash recovery detected"],
  crashDesc: [
    "以下任务在宿主重启前被中断，可查看过程后重新委派。",
    "These jobs were interrupted by a host restart. Inspect them before delegating again.",
  ],
  dismiss: ["忽略", "Dismiss"],
  dismissAll: ["全部忽略", "Dismiss all"],
  runningJobs: ["运行中", "Running"],
  recentJobs: ["最近任务", "Recent jobs"],
  noRunning: ["当前没有运行中的任务", "No jobs are running"],
  noRecent: ["暂无历史任务", "No recent jobs"],
  noActivityDesc: ["主 Agent 委派任务后，这里会实时显示进度与耗时。", "Jobs delegated by the lead agent appear here in real time."],
  elapsed: ["耗时", "Elapsed"],
  silent: ["静默", "Silent"],
  stopJob: ["停止", "Stop"],
  jobStopped: ["已请求停止", "Stop requested"],
  jobDetail: ["任务详情", "Job details"],
  jobTimeline: ["执行时间线", "Timeline"],
  jobPrompt: ["主 Agent 指令", "Lead prompt"],
  jobFinal: ["最终回复", "Final response"],
  jobError: ["错误", "Error"],
  jobNoSteps: ["暂无步骤记录", "No steps recorded"],
  jobLoading: ["正在加载任务…", "Loading job…"],
  jobLoadFailed: ["任务日志加载失败", "Failed to load the job log"],
  jobStatusRunning: ["运行中", "Running"],
  jobStatusCompleted: ["已完成", "Completed"],
  jobStatusFailed: ["失败", "Failed"],
  jobStatusInterrupted: ["已中断", "Interrupted"],
  roleOracle: ["白泽", "Oracle"],
  roleHephaestus: ["祝融", "Hephaestus"],
  roleOracleSub: ["独立审查 · Oracle", "Independent review · Oracle"],
  roleHephaestusSub: ["代码执行 · Hephaestus", "Code execution · Hephaestus"],
  roleOracleBadge: ["只读 · 可并行", "Read-only · parallel"],
  roleHephaestusBadge: ["可写 · 写互斥", "Writable · write-mutex"],
  roleOracleDesc: ["架构权衡、卡壳诊断、独立 Code Review（严禁改文件）", "Architecture tradeoffs, diagnosis and independent code review (never edits files)"],
  roleHephaestusDesc: ["复杂重构、核心逻辑、长循环单测排错（同目录互斥写）", "Refactors, core logic and long debug loops (write-mutex per directory)"],

  masterTitle: ["全局总开关", "Master switch"],
  masterOn: ["已开启 · 主 Agent 可自主委派外部子 Agent", "On · the lead agent may delegate to external subagents"],
  masterOff: ["已关闭 · 主 Agent 独立完成任务，绝不触发外部子 Agent", "Off · the lead agent works alone and never spawns subagents"],
  priorityQueue: ["模型优先级队列", "Priority queue"],
  primary: ["首选", "Primary"],
  fallback: ["备选", "Fallback"],
  addFallback: ["添加备选", "Add fallback"],
  pickModel: ["选择模型", "Pick a model"],
  pickModelSearch: ["搜索模型…", "Search models…"],
  promote: ["设为首选", "Promote to primary"],
  noModel: ["未配置模型", "No model configured"],
  smartSelection: ["智能选型", "Smart selection"],
  smartSelectionDesc: ["主 Agent 可按任务难度从队列中选择模型。", "The lead agent may pick any queued model by task difficulty."],
  reasoningEffort: ["推理档位", "Reasoning effort"],
  effortOff: ["关闭", "Off"],
  effortLow: ["低", "Low"],
  effortMedium: ["中", "Medium"],
  effortHigh: ["高", "High"],
  customRules: ["角色常驻守则", "Custom role rules"],
  customRulesDesc: ["仅在新会话首轮注入；清空并保存即可停用。", "Injected only on the first turn of a new session. Clear and save to disable."],
  customRulesConfigured: ["已配置", "Configured"],
  saveRules: ["保存守则", "Save rules"],
  sessions: ["活跃持久化会话", "Persistent sessions"],
  noSession: ["暂无活跃持久化会话（首次调用自动建立）", "No persistent sessions yet (created on first call)"],
  turns: ["轮", "turns"],
  hit: ["命中", "hit"],
  ctx: ["上下文", "ctx"],
  compact: ["压缩", "Compact"],
  reset: ["重置", "Reset"],
  sessionReset: ["会话已重置", "Session reset"],
  cooldown: ["冷却中", "Cooling down"],
  balanceDepleted: ["余额不足", "Balance depleted"],
  restore: ["恢复", "Restore"],
  cooldownCleared: ["冷却已清除", "Cooldown cleared"],
  unready: ["未就绪", "Not ready"],

  refreshDetect: ["刷新检测", "Refresh detection"],
  refreshQuota: ["刷新配额", "Refresh quota"],
  codexQuota: ["Codex (GPT) 配额窗口", "Codex (GPT) quota windows"],
  window5h: ["5 小时窗口", "5-hour window"],
  window7d: ["7 天窗口", "7-day window"],
  windowMinutes: ["%s 分钟窗口", "%s-minute window"],
  windowHours: ["%s 小时窗口", "%s-hour window"],
  windowDays: ["%s 天窗口", "%s-day window"],
  remaining: ["剩余", "remaining"],
  resetsIn: ["重置", "resets"],
  quotaUnavailable: ["暂未读取到 Codex 额度。", "Codex quota is not available yet."],
  cliEngines: ["CLI 引擎", "CLI engines"],
  statusReady: ["已就绪", "Ready"],
  statusLogin: ["待登录", "Needs login"],
  statusMissing: ["未安装", "Not installed"],
  statusNodeOld: ["需 Node ≥ 24.9", "Needs Node ≥ 24.9"],
  detectedVersion: ["版本", "version"],
  testConnection: ["测试连接", "Test connection"],
  testing: ["测试中…", "Testing…"],
  connOk: ["连接正常", "Connection OK"],
  connFail: ["连接失败", "Connection failed"],
  installCmd: ["安装命令", "Install"],
  loginCmd: ["登录命令", "Login"],
  apiChannels: ["API 渠道", "API channels"],
  noChannels: ["暂无 API 渠道", "No API channels yet"],
  noChannelsDesc: ["添加一个 OpenAI 兼容渠道，即可为 DeepSeek Harness 与巡检 AI 提供模型。", "Add an OpenAI-compatible channel to supply models for DeepSeek Harness and the inspector AI."],
  addChannel: ["添加 API 渠道", "Add API channel"],
  editChannel: ["编辑 API 渠道", "Edit API channel"],
  channelName: ["渠道名称（可选）", "Channel name (optional)"],
  channelNamePlaceholder: ["留空则根据供应商或接口地址自动命名", "Leave empty to auto-name from provider or URL"],
  providerLabel: ["供应商", "Provider"],
  baseUrl: ["接口地址 (Base URL)", "Base URL"],
  apiKey: ["API Key", "API Key"],
  apiKeyPlaceholder: ["输入你的 API Key", "Enter your API key"],
  apiKeyKeep: ["已保存（留空保持不变）", "Saved (leave empty to keep)"],
  autoFetchModels: ["自动拉取模型", "Fetch models"],
  fetching: ["拉取中…", "Fetching…"],
  fetchedModels: ["可用模型", "Available models"],
  manualModel: ["手动输入模型名", "Manual model name"],
  addModel: ["加入", "Add"],
  selectedCount: ["已选 %s", "%s selected"],
  clearSelection: ["清空已选", "Clear selection"],
  saveChannel: ["保存渠道", "Save channel"],
  channelSaved: ["渠道已保存", "Channel saved"],
  channelDeleted: ["渠道已删除", "Channel deleted"],
  modelRemoved: ["模型已移除", "Model removed"],
  deleteChannel: ["删除渠道", "Delete channel"],
  confirmDeleteChannel: ["确认删除该渠道？", "Delete this channel?"],
  confirmDeleteChannelMsg: ["渠道及其模型会一并删除，使用这些模型的队列会自动顺延。", "The channel and its models are removed; queues fall back automatically."],
  missingBaseUrl: ["请填写接口地址", "Base URL is required"],
  missingKey: ["请先填写接口地址和 API Key", "Base URL and API key are required"],
  keyLooksLikeUrl: ["API Key 栏误填了网址，请粘贴实际密钥。", "That looks like a URL — paste the actual API key."],
  fetchFailed: ["拉取模型失败", "Failed to fetch models"],
  noModelsFetched: ["没有匹配的模型", "No models found"],
  readOnly: ["只读", "Read-only"],
  accountChannel: ["官方账号登录态", "Account login"],
  keyMasked: ["已配置", "Configured"],

  kpiCumHit: ["累计缓存命中率", "Cumulative cache hit rate"],
  kpiCached: ["累计命中输入 Token", "Total cached tokens"],
  kpiTurns: ["累计轮次", "Total turns"],
  kpiAvgDuration: ["平均任务耗时", "Avg job duration"],
  kpiAvgFirst: ["平均首字延迟", "Avg first output"],
  chartTitle: ["最近 20 轮缓存命中趋势", "Cache hit rate · last 20 turns"],
  chartReported: ["已上报", "reported"],
  chartUnreported: ["未上报", "unreported"],
  perfTitle: ["最近任务性能明细", "Recent job performance"],
  clearLogs: ["清空日志", "Clear logs"],
  confirmClearLogs: ["确认清空日志？", "Clear all logs?"],
  confirmClearLogsMsg: ["将清空本插件的调用明细与耗时日志，不影响外部 CLI 记录。", "Clears this plugin's telemetry and perf logs. External CLI records are untouched."],
  logsCleared: ["日志已清空", "Logs cleared"],
  noLogs: ["暂无调用记录，完成一次协作后实时显示。", "No records yet — they appear after the first collaboration."],
  noPerf: ["暂无任务耗时记录", "No job performance records yet"],
  colRole: ["角色", "Role"],
  colModel: ["模型", "Model"],
  colEngine: ["引擎", "Engine"],
  colEffort: ["档位", "Effort"],
  colDuration: ["总耗时", "Duration"],
  colFirst: ["首字", "First output"],
  colStatus: ["状态", "Status"],
  unreported: ["未上报", "unreported"],

  secDispatch: ["调度", "Dispatch"],
  secAutomation: ["自动化与安全", "Automation & safety"],
  secData: ["数据与记忆", "Data & memory"],
  secAppearance: ["外观与语言", "Appearance & language"],
  secGateway: ["网关信息", "Gateway"],
  secDiagnostics: ["诊断与日志", "Diagnostics & Logs"],
  diagExportTitle: ["一键导出脱敏诊断包", "Export sanitized diagnostics"],
  diagExportDesc: ["打包最近日志、设置、遥测与耗时数据；自动排除 secrets.json 与所有密钥。", "Bundles recent logs, settings, telemetry and perf; excludes secrets.json and all keys."],
  diagExportBtn: ["一键导出脱敏诊断包", "Export diagnostic bundle"],
  diagExporting: ["正在打包…", "Packing…"],
  diagExportDone: ["已导出", "Exported"],
  diagRevealHint: ["打包完成后会自动在文件管理器中定位 zip。", "The finished zip is revealed in your file manager."],
  diagEmpty: ["尚未导出诊断包。", "No diagnostic bundle exported yet."],
  diagOpenTitle: ["打开数据与日志目录", "Open data & logs folder"],
  diagOpenDesc: ["在系统文件管理器中打开本插件的本地数据目录。", "Reveal this plugin's local data directory in your file manager."],
  diagOpenBtn: ["打开日志目录", "Open logs folder"],
  diagOpenOk: ["已打开日志目录", "Opened logs folder"],
  diagFailed: ["导出诊断包失败", "Failed to export diagnostics"],
  recentTurnsTitle: ["最近调用轮次", "Recent turns"],
  colTime: ["时间", "Time"],
  colCache: ["缓存", "Cache"],
  cacheReasonNoProjection: ["首轮未落盘 / 未启用缓存插件", "No projection record / cache plugin disabled"],
  cacheReasonCwdMismatch: ["路径不一致", "Working directory mismatch"],
  cacheReasonUpstream: ["上游未返回缓存字段", "Upstream returned no cache fields"],
  cacheReasonScope: ["仅统计部分步骤", "Partial-step usage only"],
  cacheReasonFallback: ["上游未上报缓存用量", "Cache usage unreported by upstream"],
  maxConcurrency: ["最大并发数", "Max concurrency"],
  maxConcurrencyDesc: ["全局并行上限；仅只读白泽支持多开，祝融同目录严格互斥写。", "Global parallelism cap. Oracle may run in parallel; Hephaestus is write-mutex per directory."],
  silentCheckin: ["静默巡检间隔", "Silent check-in interval"],
  silentCheckinDesc: ["子 Agent 连续没有新进展时触发。", "Triggers when a subagent shows no new progress."],
  longRunCheckin: ["持续运行巡检", "Long-run check-in"],
  longRunCheckinDesc: ["持续运行达到间隔时唤醒主 Agent 查看进展。", "Wakes the lead agent to review progress at this interval."],
  retention: ["记忆保留天数", "Memory retention"],
  retentionDesc: ["仅清理本插件索引；绝不删除外部 CLI 原生记录。", "Only prunes this plugin's index — external CLI records are never deleted."],
  autoFallback: ["限额自动无缝顺延", "Auto fallback on limit"],
  autoFallbackDesc: ["主模型撞限额时自动切换备选，到点自动切回。", "Switch to the next model on rate limits and return automatically."],
  asyncMode: ["异步后台模式", "Async background mode"],
  asyncModeDesc: ["委派后立即返回 jobId，用 wait-job 门铃零 Token 唤醒。", "Return a jobId immediately and wake via the zero-token wait-job doorbell."],
  worktree: ["Git Worktree 并行写", "Git worktree parallel writes"],
  worktreeDesc: ["同一 Git 仓库可并行运行多个祝融，各自独立分支目录。", "Run multiple Hephaestus writers in isolated branches of the same repo."],
  fullAccess: ["祝融完全访问权限", "Hephaestus full access"],
  fullAccessDesc: ["默认关闭（严格限制在项目目录沙箱内），仅信任项目开启。", "Off by default (sandboxed to the project). Enable only for trusted projects."],
  keepOffice: ["Codex 保留办公插件", "Keep Codex office plugins"],
  keepOfficeDesc: ["开启保留 PDF / Excel / Word / PPT 插件；关闭则前缀最轻。", "Keep PDF/Excel/Word/PPT plugins; off keeps the prefix lightest."],
  inspector: ["卡顿守门员 AI", "Stall gatekeeper AI"],
  inspectorDesc: ["静默超时时只读判定「继续等」或「叫醒主 Agent」，绝不越权改代码。", "On stall, decides read-only whether to keep waiting or wake the lead agent."],
  inspectorOff: ["关闭（0 费用纯代码结构化提取）", "Off (zero-cost structured extraction)"],
  inspectorOn: ["已开启", "Enabled"],
  inspectorModel: ["守门员模型", "Gatekeeper model"],
  inspectorNeedModel: ["请先添加 API 渠道，再选择守门员模型。", "Add an API channel before selecting a gatekeeper model."],
  language: ["界面语言", "Language"],
  languageDesc: ["与 settings.lang 同步，切换后立即生效。", "Synced with settings.lang and applied immediately."],
  theme: ["主题", "Theme"],
  themeDesc: ["浅色为默认，可切换深色或跟随系统。", "Light by default; switch to dark or follow the system."],
  gatewayAddress: ["网关地址", "Gateway address"],
  dataDir: ["数据目录", "Data directory"],
  pluginVersion: ["插件版本", "Plugin version"],
  daemonStarted: ["守护进程启动于", "Daemon started"],
  copyPath: ["复制路径", "Copy path"],
  minuteUnit: ["分", "min"],
  unlimited: ["关闭", "Off"],
  days7: ["7 天", "7 days"],
  days30: ["30 天", "30 days"],
  forever: ["永久", "Forever"],
  customNumber: ["自定义", "Custom"],

  offlineTitle: ["无法连接 A.stand 守护进程", "Cannot reach the A.stand daemon"],
  offlineDesc: ["请确认守护进程已启动，或使用带 uiToken 的地址打开控制台。", "Make sure the daemon is running, or open the console with a valid uiToken."],
  authTitle: ["访问凭证无效", "Invalid access token"],
  authDesc: ["请从 A.stand 桌面端重新打开控制台以获取新的 uiToken。", "Reopen the console from the A.stand desktop app to get a fresh uiToken."],
  fatalTitle: ["控制台渲染出错", "Console rendering error"],
  reload: ["重新加载", "Reload"],
  toastError: ["操作失败：%s", "Failed: %s"],
  saveFailed: ["保存失败", "Save failed"],
  deleteFailed: ["删除失败", "Delete failed"],
  nameRequired: ["请输入名称", "Name is required"],
  noModelsSelected: ["请至少选择或添加一个模型", "Select or add at least one model"],
};

function currentLang() {
  if (state?.settings?.lang === "en") return "en";
  if (state?.settings?.lang === "zh") return "zh";
  return "zh";
}

function t(key, ...args) {
  const row = STRINGS[key];
  let text = row ? (currentLang() === "en" ? row[1] : row[0]) : key;
  for (const arg of args) text = text.replace("%s", String(arg));
  return text;
}

function isEn() {
  return currentLang() === "en";
}

/* ==========================================================================
   Runtime state
   ========================================================================== */
let state = null;
let uiToken = "";
let es = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let pollTimer = null;
let refreshTimer = null;
let refreshInFlight = false;
let pendingRefresh = false;
let lastEventAt = 0;
let booted = false;
let renderQueued = false;

const ui = {
  page: "clients",
  sidebarCollapsed: false,
  theme: "light",
  maskTokens: true,
  fatal: null,
  authError: false,
  offline: false,

  clientSearch: "",
  showDisabled: true,
  modal: null,
  setupTab: "prompt",
  setup: null,

  jobDetail: null,
  jobLoading: false,
  jobError: "",

  picker: null,
  rulesDraft: {},
  rulesOpen: {},
  rulesSaving: false,

  channelForm: null,
  channelTest: null,
  channelFetchError: "",
  channelSaving: false,

  toast: "",
  toastKind: "ok",
  toastTimer: null,
  tokenCache: {},
  scrollTop: 0,

  detecting: false,
  creatingClient: false,
  registerError: "",
  registerName: "",
  diagExporting: false,
  diagExportResult: null,
  diagExportError: "",
  resetScroll: false,
};

/* ==========================================================================
   Utilities
   ========================================================================== */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtInt(value) {
  const n = num(value);
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function fmtCompact(value) {
  const n = num(value);
  if (n == null) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function fmtBytes(value) {
  const n = num(value);
  if (n == null || n < 0) return "—";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtPct(value, digits = 1) {
  const n = num(value);
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

function fmtDuration(ms) {
  const n = num(ms);
  if (n == null || n < 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  const totalSec = Math.round(n / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtElapsedSec(sec) {
  const n = num(sec);
  if (n == null) return "—";
  return fmtDuration(n * 1000);
}

function fmtClock(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toTimeString().slice(0, 8);
  } catch {
    return "";
  }
}

function fmtRelative(iso) {
  if (!iso) return t("never");
  const ts = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ts)) return t("never");
  const diff = Date.now() - ts;
  if (diff < 45_000) return t("justNow");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("minutesAgo", mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("hoursAgo", hours);
  return t("daysAgo", Math.floor(hours / 24));
}

function fmtCountdown(msUntil) {
  const n = num(msUntil);
  if (n == null) return "";
  const diff = n - Date.now();
  if (diff <= 0) return "";
  const mins = Math.ceil(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  return `${Math.floor(hours / 24)}d`;
}

function maskToken(token) {
  const value = String(token || "");
  if (!value) return "—";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function roleName(role) {
  return role === "hephaestus" ? t("roleHephaestus") : t("roleOracle");
}

function statusTag(status) {
  if (status === "running") return { cls: "green", label: t("jobStatusRunning") };
  if (status === "failed") return { cls: "red", label: t("jobStatusFailed") };
  if (status === "interrupted") return { cls: "amber", label: t("jobStatusInterrupted") };
  return { cls: "blue", label: t("jobStatusCompleted") };
}

function effortLabel(effort) {
  if (effort === "off") return t("effortOff");
  if (effort === "low") return t("effortLow");
  if (effort === "high") return t("effortHigh");
  return t("effortMedium");
}

/* ==========================================================================
   Token + HTTP
   ========================================================================== */
function readUiToken() {
  let token = "";
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("uiToken");
    if (fromQuery) {
      token = fromQuery;
      try {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        /* ignore */
      }
      url.searchParams.delete("uiToken");
      const qs = url.searchParams.toString();
      const next = `${url.pathname}${qs ? `?${qs}` : ""}${url.hash || ""}`;
      try {
        history.replaceState(null, "", next);
      } catch {
        /* file:// origins may reject this */
      }
    }
  } catch {
    /* ignore */
  }
  if (!token) {
    try {
      token = sessionStorage.getItem(TOKEN_STORAGE_KEY) || "";
    } catch {
      /* ignore */
    }
  }
  return token;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json" };
  if (uiToken) headers["X-Astand-UI-Token"] = uiToken;
  let body;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body,
    cache: "no-store",
    credentials: "same-origin",
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 || res.status === 403) {
    ui.authError = true;
    throw Object.assign(new Error(data?.error || "unauthorized"), { status: res.status });
  }
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { status: res.status, data });
  }
  return data;
}

function applyPayload(payload) {
  if (!payload) return null;
  const next = payload.state && payload.state.settings ? payload.state : payload.settings ? payload : null;
  if (!next) return null;
  applyState(next);
  return next;
}

/* ==========================================================================
   State
   ========================================================================== */
function applyState(next) {
  if (!next || typeof next !== "object") return;
  state = next;
  ui.offline = false;
  ui.authError = false;
  ui.fatal = null;
  if (!PAGES.includes(ui.page)) ui.page = "clients";
  if (ui.modal?.type === "job" && ui.modal.jobId) refreshJobDetail({ silent: true });
  scheduleRender();
}

function activeClients() {
  return (state?.clients || []).map(normalizeClient);
}

function normalizeClient(raw) {
  const c = raw || {};
  const detected = c.detectedClientName || c.detectedName || c.clientName || "";
  // Explicit flags from the daemon always win; only fall back to a timestamp
  // heuristic when the payload says nothing at all about connection state.
  let connected;
  if (typeof c.connected === "boolean") connected = c.connected;
  else if (typeof c.isConnected === "boolean") connected = c.isConnected;
  else if (typeof c.status === "string") connected = c.status === "connected";
  else connected = Boolean(c.lastSeenAt || c.lastHandshakeAt || c.lastActiveAt);
  const transportRaw = String(c.transport || c.mode || c.connectionType || "").toLowerCase();
  const transport = transportRaw.includes("stdio") || transportRaw.includes("bridge") ? "stdio" : "http";
  return {
    id: String(c.id || c.clientId || ""),
    label: c.label || c.name || "",
    customName: c.customName || "",
    name: c.customName || c.label || c.name || detected || "Upstream",
    iconKey: normalizeClientIconKey(c.customIconKey || c.iconKey || c.icon || detected || c.label),
    customIconKey: c.customIconKey || c.iconKey || "",
    enabled: c.enabled !== false && c.disabled !== true,
    connected,
    transport,
    lastSeenAt: c.lastSeenAt || c.lastHandshakeAt || c.lastActiveAt || null,
    callCount: num(c.totalCalls ?? c.callCount ?? c.calls ?? c.requestCount ?? 0) || 0,
    maskedToken: c.maskedToken || c.tokenMasked || c.tokenPreview || "",
    detectedClientName: detected,
    detectedVersion: c.detectedClientVersion || c.detectedVersion || c.clientVersion || c.version || "",
    createdAt: c.createdAt || "",
    raw: c,
  };
}

function findClient(id) {
  return activeClients().find((c) => c.id === id) || null;
}

function clientTokenPreview(client) {
  if (!client) return "—";
  const full = ui.tokenCache[client.id] || "";
  if (!ui.maskTokens && full) return full;
  if (client.maskedToken) return client.maskedToken;
  if (full) return maskToken(full);
  return "—";
}

/* ==========================================================================
   Model catalog
   ========================================================================== */
function engineLabel(eid) {
  const meta = state?.cliEnginesMeta?.[eid];
  if (meta) return isEn() ? meta.labelEn || meta.labelZh || eid : meta.labelZh || meta.labelEn || eid;
  const fb = ENGINE_FALLBACK_LABELS[eid];
  return fb ? (isEn() ? fb.en : fb.zh) : eid;
}

function engineTag(eid) {
  const meta = state?.cliEnginesMeta?.[eid];
  if (meta?.shortTag) return meta.shortTag;
  return ENGINE_FALLBACK_LABELS[eid]?.tag || String(eid || "").slice(0, 4).toUpperCase();
}

function engineReady(eid) {
  const eng = state?.engines?.[eid];
  return Boolean(eng && (eng.status === "ready" || (eng.installed && eng.loggedIn)));
}

function modelCatalog() {
  const out = [];
  const seen = new Set();
  const add = (model) => {
    if (!model || !model.id || seen.has(model.id)) return;
    seen.add(model.id);
    out.push(model);
  };

  const settings = state?.settings || {};
  const engines = state?.engines || {};

  const codexModels = Array.isArray(state?.codexModels) ? state.codexModels : [];
  if (codexModels.length) {
    for (const m of codexModels) {
      add({
        id: m.id,
        name: m.displayName || m.modelName || m.id,
        engine: "codex",
        mode: "cli",
        modelName: m.modelName || "",
        isDefault: Boolean(m.isDefault),
      });
    }
  } else {
    add({
      id: "cli-codex-default",
      name: engines.codex?.detectedModel || "GPT (Codex)",
      engine: "codex",
      mode: "cli",
      modelName: engines.codex?.detectedModel || "",
      isDefault: true,
    });
  }

  for (const m of settings.models || []) {
    if (m.mode !== "cli") continue;
    add({
      id: m.id,
      name: m.name || m.modelName || m.id,
      engine: m.engine || "",
      mode: "cli",
      modelName: m.modelName || "",
      builtin: Boolean(m.builtin),
    });
  }

  add({ id: "cli-claude-default", name: "Claude（CLI 默认）", engine: "claude-code", mode: "cli", isDefault: true });
  add({ id: "cli-agy-default", name: "Gemini（CLI 默认）", engine: "antigravity", mode: "cli", isDefault: true });

  const cliSub = state?.cliSubModels || {};
  for (const eid of Object.keys(cliSub)) {
    if (eid === "codex") continue;
    for (const m of cliSub[eid] || []) {
      add({
        id: m.id,
        name: (!isEn() && m.displayNameZh) || m.displayName || m.modelName || m.id,
        engine: m.engine || eid,
        mode: "cli",
        modelName: m.modelName || "",
        isDefault: Boolean(m.isDefault),
      });
    }
  }

  for (const m of settings.models || []) {
    if (m.mode === "cli") continue;
    add({
      id: m.id,
      name: m.name || m.modelName || m.id,
      engine: m.engine || "deepseek-harness",
      mode: "api",
      modelName: m.modelName || "",
      providerId: m.providerId || "",
      source: m.source || "custom",
    });
  }

  for (const channel of settings.channels || []) {
    for (const m of channel.models || []) {
      add({
        id: m.id,
        name: m.name || m.modelName || m.id,
        engine: "deepseek-harness",
        mode: "api",
        modelName: m.modelName || m.name || "",
        providerId: channel.providerId || "",
        channelId: channel.id,
        channelName: channel.name || "",
        source: channel.source || "custom",
      });
    }
  }

  for (const m of state?.dshModels || []) {
    add({
      id: m.id,
      name: m.displayName || m.name || m.modelName || m.id,
      engine: "deepseek-harness",
      mode: "api",
      modelName: m.modelName || "",
      providerId: m.providerId || "dsh",
      channelId: m.channelId || "",
      channelName: m.channelName || "",
      source: "dsh",
    });
  }

  return out;
}

function modelById(id) {
  if (!id) return null;
  const catalog = modelCatalog();
  const hit = catalog.find((m) => m.id === id);
  if (hit) return hit;
  if (id === "cli-codex-default") {
    return { id, name: "GPT (Codex)", engine: "codex", mode: "cli" };
  }
  if (String(id).startsWith("cli:")) {
    const rest = String(id).slice(4);
    const sep = rest.indexOf(":");
    if (sep > 0) {
      return { id, name: rest.slice(sep + 1), engine: rest.slice(0, sep), mode: "cli" };
    }
  }
  if (String(id).startsWith("dsh:")) {
    const rest = String(id).slice(4);
    const sep = rest.indexOf(":");
    return {
      id,
      name: sep > 0 ? rest.slice(sep + 1) : rest,
      engine: "deepseek-harness",
      mode: "api",
    };
  }
  return { id, name: id, engine: "", mode: "api" };
}

function modelReady(model) {
  if (!model) return false;
  if (!model.engine) return true;
  return engineReady(model.engine);
}

function apiModels() {
  return modelCatalog().filter((m) => m.mode === "api");
}

function roleQueue(role) {
  const cfg = state?.settings?.roles?.[role];
  if (!cfg) return [];
  const queue = Array.isArray(cfg.queue) ? cfg.queue.filter(Boolean) : [];
  if (queue.length) return [...new Set(queue)];
  return cfg.modelId ? [cfg.modelId] : [];
}

function sessionsForRole(role) {
  return (state?.sessions || []).filter((s) => s.role === role).slice(0, 4);
}

function cooldowns() {
  return state?.cooldowns || {};
}

/* ==========================================================================
   Theme
   ========================================================================== */
function applyTheme() {
  const mode = ui.theme === "dark" || ui.theme === "system" ? ui.theme : "light";
  let dark = mode === "dark";
  if (mode === "system") {
    try {
      dark = Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch {
      dark = false;
    }
  }
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function cycleTheme() {
  ui.theme = ui.theme === "light" ? "dark" : ui.theme === "dark" ? "system" : "light";
  applyTheme();
  scheduleRender();
}

function themeIcon() {
  return ui.theme === "dark" ? "moon" : ui.theme === "system" ? "monitor" : "sun";
}

function themeLabel() {
  return ui.theme === "dark" ? t("themeDark") : ui.theme === "system" ? t("themeSystem") : t("themeLight");
}

/* ==========================================================================
   Toasts
   ========================================================================== */
function showToast(message, kind = "ok") {
  ui.toast = String(message || "");
  ui.toastKind = kind;
  if (ui.toastTimer) clearTimeout(ui.toastTimer);
  scheduleRender();
  ui.toastTimer = setTimeout(() => {
    ui.toast = "";
    ui.toastTimer = null;
    scheduleRender();
  }, 2600);
}

function showError(prefix, err) {
  const detail = err?.message || String(err || "");
  showToast(prefix ? t("toastError", detail) : detail, "error");
}

async function copyText(text, okMessage) {
  const value = String(text || "");
  if (!value) return;
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch {
      ok = false;
    }
  }
  showToast(ok ? okMessage || t("copied") : t("saveFailed"), ok ? "ok" : "error");
}

/* ==========================================================================
   Refresh + SSE
   ========================================================================== */
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

async function refreshState(options = {}) {
  if (refreshInFlight) {
    pendingRefresh = true;
    return;
  }
  refreshInFlight = true;
  const params = new URLSearchParams();
  params.set("forceDetect", options.forceDetect ? "1" : "0");
  params.set("fetchRateLimits", options.fetchRateLimits ? "1" : "0");
  try {
    const data = await api(`/api/state?${params.toString()}`);
    if (data && data.settings) {
      applyState(data);
    } else if (data && data.state && data.state.settings) {
      applyState(data.state);
    } else {
      ui.offline = true;
      scheduleRender();
    }
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      ui.authError = true;
    } else {
      ui.offline = true;
    }
    if (!options.silent) scheduleRender();
  } finally {
    refreshInFlight = false;
    if (pendingRefresh) {
      pendingRefresh = false;
      scheduleRefresh(0);
    }
  }
}

function scheduleRefresh(delay = REFRESH_DEBOUNCE_MS) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshState({ silent: true });
  }, delay);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.hidden) return;
    if (es && es.readyState === 1 && Date.now() - lastEventAt < SSE_STALE_MS) return;
    refreshState({ silent: true });
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(MAX_RECONNECT_MS, 1000 * Math.pow(2, Math.min(reconnectAttempt, 5)));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectEvents();
  }, delay);
}

function connectEvents() {
  if (!uiToken) {
    startPolling();
    return;
  }
  try {
    if (es) es.close();
  } catch {
    /* ignore */
  }
  let source;
  try {
    source = new EventSource(`${API_BASE}/api/events?uiToken=${encodeURIComponent(uiToken)}`);
  } catch {
    startPolling();
    scheduleReconnect();
    return;
  }
  es = source;

  const onEvent = () => {
    lastEventAt = Date.now();
    scheduleRefresh();
  };

  source.addEventListener("open", () => {
    reconnectAttempt = 0;
    lastEventAt = Date.now();
    stopPolling();
  });
  source.addEventListener("state_changed", onEvent);
  source.addEventListener("state", onEvent);
  source.addEventListener("clients_changed", onEvent);
  source.addEventListener("message", onEvent);
  source.addEventListener("ping", () => {
    lastEventAt = Date.now();
  });
  source.addEventListener("error", () => {
    try {
      source.close();
    } catch {
      /* ignore */
    }
    if (es === source) es = null;
    startPolling();
    scheduleReconnect();
  });
}

function watchSseStaleness() {
  setInterval(() => {
    if (!es) return;
    if (es.readyState !== 1) return;
    if (Date.now() - lastEventAt > SSE_STALE_MS) {
      scheduleRefresh(0);
      lastEventAt = Date.now();
    }
  }, SSE_STALE_MS);
}

/* ==========================================================================
   Render — shell
   ========================================================================== */
let extensionsView = null;

// The extensions page owns its own rendering; app.js only supplies the host bridge.
function getExtensionsView() {
  if (!extensionsView) {
    extensionsView = createExtensionsView({
      esc,
      api,
      iconSvg,
      scheduleRender,
      openModal,
      closeModal,
      showToast,
      isEn,
      getState: () => state,
      refresh: () => refreshState({ silent: true }),
    });
  }
  return extensionsView;
}

function navItem(page, icon, label, badge) {
  return `<button class="nav-item ${ui.page === page ? "active" : ""}" data-action="nav" data-page="${page}" title="${esc(label)}">
    <span class="nav-icon">${iconSvg(icon)}</span>
    <span class="nav-label">${esc(label)}</span>
    ${badge || ""}
  </button>`;
}

function navGroup(zh, en, items) {
  return `<div class="nav-group">
    <div class="nav-group-label"><span>${esc(zh)}</span><span class="nav-group-en">${esc(en)}</span></div>
    ${items.join("")}
  </div>`;
}

function renderSidebar() {
  const clients = activeClients();
  const activeCount = clients.filter((c) => c.enabled).length;
  const running = (state?.activeJobs || []).length;
  const daemon = state?.daemon || {};
  const host = daemon.host || "127.0.0.1";
  const port = daemon.port || 3426;
  const gateway = `${host}:${port}`;

  const clientBadge = activeCount > 0 ? `<span class="nav-badge">${activeCount}</span>` : "";
  const activityBadge = running > 0
    ? `<span class="nav-badge live"><span class="nav-dot"></span>${running}</span>`
    : "";
  const extActive = Number(state?.extensions?.counts?.active) || 0;
  const extensionsBadge = extActive > 0 ? `<span class="nav-badge">${extActive}</span>` : "";

  return `<aside class="sidebar">
    <div class="sidebar-head">
      <div class="brand-mark">${iconSvg("brand")}</div>
      <div class="brand-text">
        <span class="brand-name">A.stand</span>
        <span class="version-pill">v2</span>
      </div>
      <button class="sidebar-collapse" data-action="toggle-sidebar" title="${esc(ui.sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar"))}" aria-label="${esc(ui.sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar"))}">
        ${iconSvg(ui.sidebarCollapsed ? "expand" : "collapse")}
      </button>
    </div>
    <nav class="nav">
      ${navGroup(t("groupConnect"), "CONNECT", [navItem("clients", "clients", t("navClients"), clientBadge)])}
      ${navGroup(t("groupDispatch"), "DISPATCH", [
        navItem("activity", "activity", t("navActivity"), activityBadge),
        navItem("roles", "roles", t("navRoles")),
        navItem("extensions", "extensions", t("navExtensions"), extensionsBadge),
      ])}
      ${navGroup(t("groupModels"), "MODELS", [navItem("providers", "providers", t("navProviders"))])}
      ${navGroup(t("groupObserve"), "OBSERVE", [navItem("observability", "observability", t("navObservability"))])}
      ${navGroup(t("groupSystem"), "SYSTEM", [navItem("settings", "settings", t("navSettings"))])}
    </nav>
    <div class="sidebar-foot">
      <button class="gateway-chip" data-action="copy-gateway" title="${esc(t("copyGateway"))}">
        <span class="status-dot ${ui.offline ? "off" : ""}"></span>
        <span class="mono">${esc(gateway)}</span>
      </button>
    </div>
  </aside>`;
}

function renderTopbar() {
  const titles = {
    clients: [t("titleClients"), t("subClients")],
    activity: [t("titleActivity"), t("subActivity")],
    roles: [t("titleRoles"), t("subRoles")],
    extensions: [t("titleExtensions"), t("subExtensions")],
    providers: [t("titleProviders"), t("subProviders")],
    observability: [t("titleObservability"), t("subObservability")],
    settings: [t("titleSettings"), t("subSettings")],
  };
  const [title, sub] = titles[ui.page] || titles.clients;
  return `<header class="topbar">
    <div class="page-title-wrap">
      <h1 class="page-title">${esc(title)}</h1>
      <span class="page-sub">${esc(sub)}</span>
    </div>
    <div class="topbar-spacer"></div>
    <div class="topbar-actions">
      <div class="seg" role="group" aria-label="${esc(t("language"))}">
        <button class="seg-btn ${!isEn() ? "active" : ""}" data-action="set-lang" data-lang="zh">中文</button>
        <button class="seg-btn ${isEn() ? "active" : ""}" data-action="set-lang" data-lang="en">EN</button>
      </div>
      <button class="icon-btn" data-action="cycle-theme" title="${esc(`${t("themeToggle")} · ${themeLabel()}`)}" aria-label="${esc(t("themeToggle"))}">
        ${iconSvg(themeIcon())}
      </button>
    </div>
  </header>`;
}

function renderMain() {
  let body;
  if (ui.authError) {
    body = renderBlockedState("lock", t("authTitle"), t("authDesc"), false);
  } else if (!state) {
    body = renderBlockedState("wave", t("offlineTitle"), t("offlineDesc"), true);
  } else if (ui.page === "clients") {
    body = renderClientsPage();
  } else if (ui.page === "activity") {
    body = renderActivityPage();
  } else if (ui.page === "roles") {
    body = renderRolesPage();
  } else if (ui.page === "extensions") {
    body = getExtensionsView().renderPage();
  } else if (ui.page === "providers") {
    body = renderProvidersPage();
  } else if (ui.page === "observability") {
    body = renderObservabilityPage();
  } else {
    body = renderSettingsPage();
  }
  return `<main class="main">
    ${renderTopbar()}
    <div class="content" data-scroll-root="1">
      ${body}
    </div>
  </main>`;
}

function renderBlockedState(icon, title, desc, allowRetry) {
  return `<div class="content-inner">
    <div class="card pad" style="text-align:center;padding:44px 24px">
      <div class="empty-icon" style="margin:0 auto 14px;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--bg-subtle);border:1px solid var(--border);color:var(--ink-3)">${iconSvg(icon, 20)}</div>
      <h2 style="font-size:14px;font-weight:650;margin-bottom:6px">${esc(title)}</h2>
      <p style="font-size:12px;color:var(--ink-2);line-height:1.6;max-width:420px;margin:0 auto 16px">${esc(desc)}</p>
      ${allowRetry ? `<button class="btn primary" data-action="retry-state">${iconSvg("refresh")} ${esc(t("retry"))}</button>` : ""}
    </div>
  </div>`;
}

function render() {
  const root = document.getElementById("root");
  if (!root) return;

  // Page switches reset the scroll to the top; every other render preserves it.
  const scrollEl = document.querySelector('[data-scroll-root="1"]');
  if (scrollEl && !ui.resetScroll) ui.scrollTop = scrollEl.scrollTop;
  if (ui.resetScroll) ui.resetScroll = false;

  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.focusKey : "";
  let caret = null;
  try {
    if (focusKey && typeof active.selectionStart === "number") caret = active.selectionStart;
  } catch {
    caret = null;
  }

  let html;
  if (ui.fatal) {
    html = `<div class="fatal">${esc(ui.fatal)}</div>`;
  } else {
    html = `<div class="app ${ui.sidebarCollapsed ? "sidebar-collapsed" : ""}">
      ${renderSidebar()}
      ${renderMain()}
    </div>
    ${renderOverlay()}
    ${ui.toast ? `<div class="toast ${ui.toastKind === "error" ? "error" : ""}" role="status">${ui.toastKind === "error" ? iconSvg("alert") : iconSvg("checkCircle")}<span>${esc(ui.toast)}</span></div>` : ""}`;
  }
  root.innerHTML = html;

  const nextScroll = document.querySelector('[data-scroll-root="1"]');
  if (nextScroll) nextScroll.scrollTop = ui.scrollTop;

  if (focusKey) {
    const el = root.querySelector(`[data-focus-key="${cssEscape(focusKey)}"]`);
    if (el && typeof el.focus === "function") {
      el.focus({ preventScroll: true });
      if (caret != null && typeof el.setSelectionRange === "function") {
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

/* ==========================================================================
   Page — Clients
   ========================================================================== */
function clientRow(client) {
  const paused = !client.enabled;
  const statusTagHtml = client.connected
    ? `<span class="tag green"><span class="tag-dot"></span>${esc(t("connected"))}</span>`
    : `<span class="tag amber"><span class="tag-dot"></span>${esc(t("awaitingFirst"))}</span>`;
  const transport = client.transport === "stdio"
    ? `<span class="transport stdio">${esc(t("transportStdio"))}</span>`
    : `<span class="transport">${esc(t("transportHttp"))}</span>`;
  const detected = [client.detectedClientName, client.detectedVersion].filter(Boolean).join(" ");
  const metaParts = [];
  if (detected) metaParts.push(esc(detected));
  metaParts.push(`${esc(t("lastActive"))} ${esc(fmtRelative(client.lastSeenAt))}`);
  metaParts.push(`${esc(t("calls"))} ${esc(fmtInt(client.callCount))}`);

  return `<div class="client-row ${paused ? "paused" : ""}" data-action="open-client" data-client="${esc(client.id)}" role="button" tabindex="0" aria-label="${esc(client.name)}">
    <span class="client-avatar">${clientIconSvg(client.iconKey)}</span>
    <span class="client-main">
      <span class="client-title-line">
        <span class="client-name">${esc(client.name)}</span>
        ${paused ? `<span class="tag plain">${esc(t("paused"))}</span>` : statusTagHtml}
        ${transport}
      </span>
      <span class="client-sub">${metaParts.join('<span class="sep">·</span>')}</span>
    </span>
    <span class="client-side">
      <span class="client-token" title="${esc(t("tokenLabel"))}">${esc(clientTokenPreview(client))}</span>
      <button class="btn xs copy-prompt" data-action="copy-client-prompt" data-client="${esc(client.id)}">${iconSvg("copy")} ${esc(t("copyPrompt"))}</button>
      <button class="switch ${client.enabled ? "on" : ""}" data-action="toggle-client" data-client="${esc(client.id)}" role="switch" aria-checked="${client.enabled}" aria-label="${esc(t("enabledLabel"))}"></button>
      <span class="client-chevron">${iconSvg("chevronRight")}</span>
    </span>
  </div>`;
}

function renderClientsPage() {
  const all = activeClients();
  const query = ui.clientSearch.trim().toLowerCase();
  const matches = (c) => {
    if (!query) return true;
    return [c.name, c.label, c.customName, c.detectedClientName, c.iconKey]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  };
  const active = all.filter((c) => c.enabled && matches(c));
  const disabled = all.filter((c) => !c.enabled && matches(c));

  const toolbar = `<div class="clients-toolbar">
    <div class="search-field">
      ${iconSvg("search")}
      <input class="input" type="search" data-ui="client-search" data-focus-key="client-search" placeholder="${esc(t("searchClients"))}" value="${esc(ui.clientSearch)}" aria-label="${esc(t("searchClients"))}" />
    </div>
    <button class="btn ${ui.maskTokens ? "active" : ""}" data-action="toggle-mask" aria-pressed="${ui.maskTokens}" title="${esc(t("maskTokens"))}">
      ${iconSvg(ui.maskTokens ? "eyeOff" : "eye")} ${esc(t("maskTokens"))}
    </button>
    <div class="topbar-spacer"></div>
    <button class="btn primary" data-action="open-register" ${ui.creatingClient ? "disabled" : ""}>${iconSvg("plus")} ${esc(ui.creatingClient ? t("generating") : t("addClient"))}</button>
  </div>`;

  let list = "";
  if (!all.length) {
    list = `<div class="card">
      <div class="empty-state">
        <div class="empty-icon">${iconSvg("inbox", 18)}</div>
        <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px">${esc(t("noClients"))}</div>
        <div style="max-width:400px;margin:0 auto 14px">${esc(t("noClientsDesc"))}</div>
        <button class="btn primary" data-action="open-register" ${ui.creatingClient ? "disabled" : ""}>${iconSvg("plus")} ${esc(ui.creatingClient ? t("generating") : t("addClient"))}</button>
      </div>
    </div>`;
  } else if (!active.length && !disabled.length) {
    list = `<div class="card"><div class="empty-state">${iconSvg("search")}<div style="margin-top:8px">${esc(t("noSearchResult"))}</div></div></div>`;
  } else {
    list = `<div class="card-list">${active.map(clientRow).join("")}</div>`;
    if (disabled.length) {
      list += `<div class="clients-disabled">
        <button class="disclosure ${ui.showDisabled ? "open" : ""}" data-action="toggle-disabled" aria-expanded="${ui.showDisabled}">
          ${iconSvg("chevronRight")}
          <span>${esc(t("disabledClients"))} (${disabled.length})</span>
        </button>
        ${ui.showDisabled ? `<div class="card-list" style="margin-top:8px">${disabled.map(clientRow).join("")}</div>` : ""}
      </div>`;
    }
  }

  return `<div class="content-inner wide">
    ${toolbar}
    ${list}
  </div>`;
}

/* ==========================================================================
   Page — Activity
   ========================================================================== */
function jobRow(job, running) {
  const role = job.role === "hephaestus" ? "hephaestus" : "oracle";
  const status = statusTag(job.status);
  const upstream = job.upstreamClientLabel
    ? `<span class="tag plain mono">${esc(job.upstreamClientLabel)}</span>`
    : "";
  const model = job.modelDisplayName || job.modelId || job.engine || "";
  return `<div class="job-row ${running ? "running" : ""}" data-action="open-job" data-job="${esc(job.jobId)}" role="button" tabindex="0">
    <span class="job-role ${role}">${esc(roleName(role))}</span>
    <span class="job-main">
      <span class="job-title">${esc(job.title || job.jobId)}</span>
      <span class="job-meta">
        ${upstream}
        <span>${esc(model)}</span>
        <span class="sep">·</span>
        <span class="mono">${esc(fmtElapsedSec(job.elapsedSec))}</span>
        ${running && job.silentSec != null ? `<span class="sep">·</span><span>${esc(t("silent"))} ${esc(fmtElapsedSec(job.silentSec))}</span>` : ""}
      </span>
    </span>
    <span class="job-side">
      <span class="tag ${status.cls}">${esc(status.label)}</span>
      ${running
        ? `<button class="btn xs danger" data-action="stop-job" data-job="${esc(job.jobId)}">${iconSvg("stop")} ${esc(t("stopJob"))}</button>`
        : `<span class="client-chevron">${iconSvg("chevronRight")}</span>`}
    </span>
  </div>`;
}

function renderCrashBanner() {
  const jobs = state?.interruptedJobs || [];
  if (!jobs.length) return "";
  const rows = jobs
    .map(
      (job) => `<div class="crash-item">
        <span class="job-role ${job.role === "hephaestus" ? "hephaestus" : "oracle"}">${esc(roleName(job.role))}</span>
        <span class="crash-title" title="${esc(job.title || job.jobId)}">${esc(job.title || job.jobId)}</span>
        <button class="btn xs" data-action="open-job" data-job="${esc(job.jobId)}">${esc(t("jobDetail"))}</button>
        <button class="btn xs ghost" data-action="dismiss-interrupted" data-job="${esc(job.jobId)}">${esc(t("dismiss"))}</button>
      </div>`
    )
    .join("");
  return `<div class="crash-banner">
    <div class="crash-head">
      ${iconSvg("alert")}
      <span>${esc(t("crashTitle"))} · ${jobs.length}</span>
      <span style="flex:1"></span>
      <button class="btn xs ghost" data-action="dismiss-interrupted">${esc(t("dismissAll"))}</button>
    </div>
    <div class="setting-desc" style="color:var(--ink-2)">${esc(t("crashDesc"))}</div>
    <div class="crash-list">${rows}</div>
  </div>`;
}

function renderActivityPage() {
  const running = state?.activeJobs || [];
  const recent = (state?.recentJobs || []).filter((j) => j.status !== "running");
  return `<div class="content-inner">
    ${renderCrashBanner()}
    <div>
      <div class="section-head">
        <span class="section-title">${esc(t("runningJobs"))}</span>
        <span class="section-sub">${running.length}</span>
      </div>
      <div class="card-list" style="margin-top:9px">
        ${running.length ? running.map((j) => jobRow(j, true)).join("") : `<div class="card"><div class="empty-state">${esc(t("noRunning"))}</div></div>`}
      </div>
    </div>
    <div>
      <div class="section-head">
        <span class="section-title">${esc(t("recentJobs"))}</span>
        <span class="section-sub">${recent.length}</span>
      </div>
      <div class="card-list" style="margin-top:9px">
        ${recent.length
          ? recent.slice(0, 30).map((j) => jobRow(j, false)).join("")
          : `<div class="card"><div class="empty-state"><div class="empty-icon">${iconSvg("history", 18)}</div>${esc(t("noRecent"))}<div class="setting-desc" style="margin-top:4px">${esc(t("noActivityDesc"))}</div></div></div>`}
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   Page — Roles
   ========================================================================== */
function renderMasterCard() {
  const on = Boolean(state?.settings?.enabled);
  return `<div class="master-card ${on ? "on" : ""}">
    <div class="master-icon">${iconSvg("power", 18)}</div>
    <div class="master-main">
      <div class="master-title">${esc(t("masterTitle"))}</div>
      <div class="master-desc">${esc(on ? t("masterOn") : t("masterOff"))}</div>
    </div>
    <button class="switch ${on ? "on" : ""}" data-action="toggle-master" role="switch" aria-checked="${on}" aria-label="${esc(t("masterTitle"))}"></button>
  </div>`;
}

function renderModelPicker(role, index, currentId) {
  const query = (ui.picker?.search || "").trim().toLowerCase();
  const catalog = modelCatalog().filter((m) => {
    if (!query) return true;
    return [m.name, m.modelName, m.id, m.channelName, engineLabel(m.engine)]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(query));
  });
  const groups = new Map();
  for (const model of catalog) {
    const key = model.engine || "api";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(model);
  }
  const ordered = ENGINE_ORDER.filter((e) => groups.has(e)).concat(
    [...groups.keys()].filter((e) => !ENGINE_ORDER.includes(e))
  );

  const body = ordered.length
    ? ordered
        .map((eid) => {
          const items = groups.get(eid);
          return `<div class="picker-group">
            <div class="picker-group-label">${esc(engineLabel(eid))}<span class="tag plain">${items.length}</span></div>
            ${items
              .map(
                (m) => `<button class="picker-item ${m.id === currentId ? "selected" : ""}" data-action="pick-model" data-role="${esc(role)}" data-index="${index}" data-model="${esc(m.id)}">
                  <span class="dot ${modelReady(m) ? "ok" : "warn"}"></span>
                  <span class="truncate">${esc(m.name)}</span>
                  ${m.channelName ? `<span class="picker-channel truncate">${esc(m.channelName)}</span>` : ""}
                  ${m.id === currentId ? iconSvg("check") : ""}
                </button>`
              )
              .join("")}
          </div>`;
        })
        .join("")
    : `<div class="empty-state" style="padding:18px">${esc(t("noSearchResult"))}</div>`;

  return `<div class="model-picker">
    <div class="search-field" style="max-width:none">
      ${iconSvg("search")}
      <input class="input" type="search" data-ui="picker-search" data-focus-key="picker-search" placeholder="${esc(t("pickModelSearch"))}" value="${esc(ui.picker?.search || "")}" aria-label="${esc(t("pickModelSearch"))}" />
    </div>
    <div class="picker-list">${body}</div>
  </div>`;
}

function renderQueueItem(role, modelId, index, total) {
  const model = modelById(modelId);
  const cooldown = cooldowns()[modelId];
  const rank = index === 0 ? "①" : index === 1 ? "②" : index === 2 ? "③" : String(index + 1);
  const pickerOpen = ui.picker && ui.picker.role === role && ui.picker.index === index;
  const ready = modelReady(model);
  return `<div class="queue-item-wrap">
    <div class="queue-item ${index === 0 ? "primary" : ""}">
      <span class="queue-rank">${rank}</span>
      <button class="queue-model" data-action="open-picker" data-role="${esc(role)}" data-index="${index}" aria-expanded="${pickerOpen}" title="${esc(t("pickModel"))}">
        <span class="queue-model-name">${esc(model?.name || t("noModel"))}</span>
        <span class="queue-model-meta">
          ${esc(engineLabel(model?.engine || ""))}
          ${!ready ? ` · <span style="color:var(--amber)">${esc(t("unready"))}</span>` : ""}
          ${cooldown ? ` · <span style="color:var(--amber)">${esc(t("cooldown"))}</span>` : ""}
        </span>
      </button>
      <span class="queue-actions">
        ${index > 0
          ? `<button class="chip-btn" data-action="promote-model" data-role="${esc(role)}" data-model="${esc(modelId)}" title="${esc(t("promote"))}" aria-label="${esc(t("promote"))}">↑</button>
             <button class="chip-btn danger" data-action="remove-model" data-role="${esc(role)}" data-model="${esc(modelId)}" title="${esc(t("remove"))}" aria-label="${esc(t("remove"))}">×</button>`
          : `<span class="tag plain" style="font-size:10px">${esc(t("primary"))}</span>`}
      </span>
    </div>
    ${pickerOpen ? renderModelPicker(role, index, modelId) : ""}
  </div>`;
}

function renderSessions(role) {
  const sessions = sessionsForRole(role);
  if (!sessions.length) {
    return `<div class="session-box" style="color:var(--ink-3);font-size:11px">${esc(t("noSession"))}</div>`;
  }
  return `<div class="session-list">
    ${sessions
      .map((sess) => {
        const ctxPct = num(sess.contextPct);
        const hit = num(sess.lastHitRate);
        const cls = ctxPct == null ? "" : ctxPct >= 75 ? "danger" : ctxPct >= 50 ? "warn" : "";
        const shortId = `#${String(sess.sessionId || "").slice(0, 8)}`;
        return `<div class="session-box">
          <div class="session-top">
            <span class="session-title truncate" title="${esc(sess.title || sess.sessionId || "")}">${esc(sess.title || shortId)}</span>
            <span class="session-stats">
              <span class="session-pill nums">${esc(sess.turns || 0)} ${esc(t("turns"))}</span>
              <span class="nums" style="color:${hit != null && hit >= 80 ? "var(--green)" : "var(--ink-2)"}">${esc(t("hit"))} ${hit != null ? `${esc(fmtPct(hit, 0))}` : "—"}</span>
            </span>
          </div>
          ${ctxPct != null
            ? `<div class="progress ${cls}"><span style="width:${Math.max(0, Math.min(100, ctxPct))}%"></span></div>`
            : ""}
          <div class="session-actions">
            <span class="session-meta truncate mono" title="${esc(sess.sessionId || "")}">
              ${ctxPct != null ? `${esc(t("ctx"))} ${esc(fmtPct(ctxPct, 0))} · ` : ""}${esc(shortId)}
            </span>
            <div class="row" style="gap:4px">
              <button class="btn xs" data-action="session-action" data-act="compact" data-session="${esc(sess.sessionId || "")}">${esc(t("compact"))}</button>
              <button class="btn xs danger" data-action="session-action" data-act="reset" data-session="${esc(sess.sessionId || "")}">${esc(t("reset"))}</button>
            </div>
          </div>
        </div>`;
      })
      .join("")}
  </div>`;
}

function renderRoleCard(role) {
  const isOracle = role === "oracle";
  const cfg = state?.settings?.roles?.[role] || {};
  const queue = roleQueue(role);
  const smart = cfg.selectionMode === "smart";
  const effort = cfg.effort || "medium";
  const rules = ui.rulesDraft[role] ?? cfg.customRules ?? "";
  const rulesOpen = Boolean(ui.rulesOpen[role]);
  const activeCooldowns = queue
    .map((id) => ({ model: modelById(id), cd: cooldowns()[id] }))
    .filter((x) => x.model && x.cd);

  return `<div class="card role-card ${isOracle ? "oracle" : "hephaestus"}">
    <div class="role-head">
      <div class="role-avatar">${iconSvg(isOracle ? "oracle" : "hephaestus")}</div>
      <div class="role-head-main">
        <div class="role-name">${esc(roleName(role))}</div>
        <div class="role-sub">${esc(isOracle ? t("roleOracleSub") : t("roleHephaestusSub"))}</div>
      </div>
      <span class="tag ${isOracle ? "blue" : "violet"}">${esc(isOracle ? t("roleOracleBadge") : t("roleHephaestusBadge"))}</span>
    </div>
    <div class="role-desc">${esc(isOracle ? t("roleOracleDesc") : t("roleHephaestusDesc"))}</div>
    <div class="role-body">
      <div class="field">
        <div class="field-label">${esc(t("priorityQueue"))}</div>
        <div class="queue-list">
          ${queue.length ? queue.map((id, index) => renderQueueItem(role, id, index, queue.length)).join("") : `<div class="queue-item"><span class="queue-model-meta">${esc(t("noModel"))}</span></div>`}
          <button class="add-slot-btn" data-action="open-picker" data-role="${esc(role)}" data-index="${queue.length}">
            ${iconSvg("plus")} ${esc(t("addFallback"))}
          </button>
        </div>
      </div>

      ${activeCooldowns
        .map(
          ({ model, cd }) => `<div class="cooldown-row">
            <span class="truncate">⏳ ${esc(model.name)}: ${esc(cd.manualOnly ? t("balanceDepleted") : `${t("cooldown")} → ${fmtCountdown(cd.untilMs)}`)}</span>
            <button class="btn xs" data-action="clear-cooldown" data-model="${esc(model.id)}">${esc(t("restore"))}</button>
          </div>`
        )
        .join("")}

      <div class="setting-inline">
        <div class="setting-meta">
          <div class="setting-title">${esc(t("smartSelection"))}</div>
          <div class="setting-desc">${esc(t("smartSelectionDesc"))}</div>
        </div>
        <button class="switch sm ${smart ? "on" : ""}" data-action="toggle-smart" data-role="${esc(role)}" role="switch" aria-checked="${smart}" aria-label="${esc(t("smartSelection"))}"></button>
      </div>

      <div class="field">
        <div class="field-label">${esc(t("reasoningEffort"))}</div>
        <div class="seg block">
          ${[
            ["off", t("effortOff")],
            ["low", t("effortLow")],
            ["medium", t("effortMedium")],
            ["high", t("effortHigh")],
          ]
            .map(
              ([value, label]) =>
                `<button class="seg-btn ${effort === value ? "active" : ""}" data-action="set-effort" data-role="${esc(role)}" data-effort="${value}" aria-pressed="${effort === value}">${esc(label)}</button>`
            )
            .join("")}
        </div>
      </div>

      <div class="field">
        <button class="disclosure ${rulesOpen ? "open" : ""}" data-action="toggle-rules" data-role="${esc(role)}" aria-expanded="${rulesOpen}">
          ${iconSvg("chevronRight")}
          <span>${esc(t("customRules"))}</span>
          ${rules.trim() ? `<span class="tag plain">${esc(t("customRulesConfigured"))}</span>` : ""}
        </button>
        ${rulesOpen
          ? `<div class="stack" style="gap:7px">
              <textarea class="textarea" rows="4" maxlength="4000" data-rules-role="${esc(role)}" data-focus-key="rules-${esc(role)}" placeholder="${esc(t("customRulesDesc"))}">${esc(rules)}</textarea>
              <div class="row">
                <span class="field-hint" style="flex:1">${esc(t("customRulesDesc"))}</span>
                <button class="btn xs primary" data-action="save-rules" data-role="${esc(role)}" ${ui.rulesSaving ? "disabled" : ""}>${esc(t("saveRules"))}</button>
              </div>
            </div>`
          : ""}
      </div>

      <div class="field">
        <div class="field-label">${esc(t("sessions"))}</div>
        ${renderSessions(role)}
      </div>
    </div>
  </div>`;
}

function renderRolesPage() {
  return `<div class="content-inner">
    ${renderMasterCard()}
    <div class="card-grid two">
      ${renderRoleCard("oracle")}
      ${renderRoleCard("hephaestus")}
    </div>
  </div>`;
}

/* ==========================================================================
   Page — Providers
   ========================================================================== */
function quotaWindowLabel(win, fallbackKey) {
  const minutes = num(win?.windowDurationMins);
  if (minutes && minutes > 0) {
    if (minutes % 1440 === 0) return t("windowDays", minutes / 1440);
    if (minutes % 60 === 0) return t("windowHours", minutes / 60);
    return t("windowMinutes", minutes);
  }
  return t(fallbackKey);
}

function renderQuotaBars() {
  const rl = state?.codexRateLimits;
  if (!rl) return `<div class="field-hint">${esc(t("quotaUnavailable"))}</div>`;
  const win = (w, fallbackKey) => {
    const rem = num(w?.remainingPercent);
    if (rem == null) return "";
    const pct = Math.max(0, Math.min(100, rem));
    const cls = pct <= 10 ? "danger" : pct <= 30 ? "warn" : "";
    return `<div class="quota-win">
      <div class="quota-win-head">
        <span>${esc(quotaWindowLabel(w, fallbackKey))}</span>
        <span class="quota-val">${esc(t("remaining"))} ${esc(fmtPct(pct, 0))}${w?.resetsAtMs ? ` · ${esc(t("resetsIn"))} ${esc(fmtCountdown(w.resetsAtMs))}` : ""}</span>
      </div>
      <div class="progress ${cls}"><span style="width:${pct}%"></span></div>
    </div>`;
  };
  const bars = win(rl.primary, "window5h") + win(rl.secondary, "window7d");
  return bars ? `<div class="quota-grid">${bars}</div>` : `<div class="field-hint">${esc(t("quotaUnavailable"))}</div>`;
}

function engineStatusPill(eng) {
  if (!eng || !eng.installed) return `<span class="status-pill off"><span class="dot"></span>${esc(t("statusMissing"))}</span>`;
  if (eng.status === "ready") return `<span class="status-pill on"><span class="dot"></span>${esc(t("statusReady"))}</span>`;
  if (eng.status === "node_too_old") return `<span class="status-pill warn"><span class="dot"></span>${esc(t("statusNodeOld"))}</span>`;
  return `<span class="status-pill warn"><span class="dot"></span>${esc(t("statusLogin"))}</span>`;
}

function engineCooldownModels(eid) {
  const cd = cooldowns();
  return Object.keys(cd)
    .map((id) => ({ model: modelById(id), cd: cd[id] }))
    .filter((x) => x.model && x.model.engine === eid);
}

function renderEngineRow(eid) {
  const eng = state?.engines?.[eid] || {};
  const meta = state?.cliEnginesMeta?.[eid] || {};
  const label = engineLabel(eid);
  const version = eng.version ? `${t("detectedVersion")} ${eng.version}` : "";
  const cooled = engineCooldownModels(eid);
  const test = ui.channelTest && ui.channelTest.key === `cli:${eid}` ? ui.channelTest : null;
  const rl = state?.codexRateLimits;
  const showQuota = eid === "codex" && rl;
  return `<div class="engine-row ${showQuota ? "has-quota" : ""}">
    <div class="engine-avatar">${esc(engineTag(eid))}</div>
    <div class="engine-main">
      <div class="engine-name">
        <span class="truncate">${esc(label)}</span>
        ${engineStatusPill(eng)}
        ${eid === "codex" && eng.detectedModel ? `<span class="tag plain mono">${esc(eng.detectedModel)}</span>` : ""}
        ${eid === "codex" && rl?.planType ? `<span class="tag plain mono">${esc(String(rl.planType).toUpperCase())}</span>` : ""}
      </div>
      <div class="engine-meta">
        ${version ? `<span class="mono">${esc(version)}</span>` : ""}
        ${eng.installed ? "" : meta.installCmd ? `<span class="mono truncate" style="max-width:320px">${esc(meta.installCmd)}</span>` : ""}
        ${test ? `<span style="color:${test.ok ? "var(--green)" : "var(--red)"}">${esc(test.ok ? t("connOk") : `${t("connFail")}${test.error ? `: ${test.error}` : ""}`)}</span>` : ""}
      </div>
      ${showQuota ? `<div class="engine-quota">${renderQuotaBars()}</div>` : ""}
      ${cooled.length
        ? `<div class="row wrap" style="gap:6px">${cooled
            .map(
              (x) => `<span class="tag amber">⏳ ${esc(x.model.name)} · ${esc(x.cd.manualOnly ? t("balanceDepleted") : fmtCountdown(x.cd.untilMs))}
                <button class="chip-btn" data-action="clear-cooldown" data-model="${esc(x.model.id)}" title="${esc(t("restore"))}">${esc(t("restore"))}</button>
              </span>`
            )
            .join("")}</div>`
        : ""}
    </div>
    <div class="engine-actions">
      ${eid === "codex" ? `<button class="btn xs" data-action="refresh-quota" title="${esc(t("refreshQuota"))}">${iconSvg("refresh")}</button>` : ""}
      <button class="btn xs" data-action="test-cli" data-engine="${esc(eid)}" ${test && test.loading ? "disabled" : ""}>
        ${iconSvg("zap")} ${esc(test && test.loading ? t("testing") : t("testConnection"))}
      </button>
    </div>
  </div>`;
}

function providerBadge(providerId) {
  const provider = (state?.providers || []).find((p) => p.id === providerId);
  return provider?.badge || String(providerId || "API").slice(0, 3).toUpperCase();
}

function providerName(providerId) {
  const provider = (state?.providers || []).find((p) => p.id === providerId);
  if (!provider) return providerId || "API";
  return isEn() ? provider.nameEn || provider.nameZh : provider.nameZh || provider.nameEn;
}

function renderChannelCard(channel) {
  const readOnly = channel.source === "dsh" || channel.readOnly;
  const models = channel.models || [];
  const key = channel.maskedApiKey || (channel.hasApiKey ? t("keyMasked") : "");
  return `<div class="channel-card">
    <div class="channel-head">
      <div class="provider-badge">${esc(providerBadge(channel.providerId))}</div>
      <div class="channel-main">
        <div class="channel-title">
          <span class="truncate">${esc(channel.name || providerName(channel.providerId))}</span>
          ${readOnly ? `<span class="tag plain">${esc(t("readOnly"))}</span>` : ""}
          ${key ? `<span class="tag plain mono">${esc(key)}</span>` : ""}
        </div>
        <div class="channel-url" title="${esc(channel.baseUrl || "")}">${esc(channel.baseUrl || (channel.authType === "account" ? t("accountChannel") : ""))}</div>
      </div>
      ${readOnly
        ? ""
        : `<div class="row" style="gap:6px">
            <button class="btn xs" data-action="test-channel" data-channel="${esc(channel.id)}">${iconSvg("zap")} ${esc(t("testConnection"))}</button>
            <button class="btn xs" data-action="edit-channel" data-channel="${esc(channel.id)}">${iconSvg("edit")} ${esc(t("edit"))}</button>
            <button class="btn xs danger" data-action="delete-channel" data-channel="${esc(channel.id)}">${iconSvg("trash")}</button>
          </div>`}
    </div>
    <div class="channel-body">
      <div class="chip-row">
        ${models.length
          ? models
              .map(
                (m) => `<span class="model-chip"><span title="${esc(m.modelName || m.name || "")}">${esc(m.modelName || m.name || m.id)}</span>
                  ${readOnly ? "" : `<button class="chip-x" data-action="remove-channel-model" data-channel="${esc(channel.id)}" data-model="${esc(m.id)}" title="${esc(t("remove"))}" aria-label="${esc(t("remove"))}">×</button>`}
                </span>`
              )
              .join("")
          : `<span class="field-hint">${esc(t("noModelsFetched"))}</span>`}
      </div>
      ${ui.channelTest && ui.channelTest.key === `channel:${channel.id}`
        ? `<div class="field-hint" style="color:${ui.channelTest.ok ? "var(--green)" : "var(--red)"}">${esc(ui.channelTest.loading ? t("testing") : ui.channelTest.ok ? t("connOk") : `${t("connFail")}${ui.channelTest.error ? `: ${ui.channelTest.error}` : ""}`)}</div>`
        : ""}
    </div>
  </div>`;
}

function renderProvidersPage() {
  const engines = state?.engines || {};
  const customChannels = state?.settings?.channels || [];
  const extraChannels = (state?.dshChannels || []).filter((c) => !customChannels.some((x) => x.id === c.id));
  const channels = [...customChannels.map((c) => ({ ...c, source: c.source || "custom" })), ...extraChannels];

  return `<div class="content-inner">
    <div class="section-head">
      <span class="section-title">${esc(t("cliEngines"))}</span>
      <div class="spacer"></div>
      <button class="btn xs" data-action="refresh-detect" ${ui.detecting ? "disabled" : ""}>${iconSvg("refresh")} ${esc(ui.detecting ? t("loading") : t("refreshDetect"))}</button>
    </div>
    <div class="card-list">
      ${ENGINE_ORDER.map(renderEngineRow).join("")}
    </div>
    <div class="section-head" style="margin-top:6px">
      <span class="section-title">${esc(t("apiChannels"))}</span>
      <div class="spacer"></div>
      <button class="btn xs primary" data-action="open-channel">${iconSvg("plus")} ${esc(t("addChannel"))}</button>
    </div>
    ${channels.length
      ? `<div class="card-list">${channels.map(renderChannelCard).join("")}</div>`
      : `<div class="card"><div class="empty-state">
          <div class="empty-icon">${iconSvg("database", 18)}</div>
          <div style="font-weight:600;color:var(--ink);margin-bottom:4px">${esc(t("noChannels"))}</div>
          <div style="max-width:420px;margin:0 auto 14px">${esc(t("noChannelsDesc"))}</div>
          <button class="btn primary" data-action="open-channel">${iconSvg("plus")} ${esc(t("addChannel"))}</button>
        </div></div>`}
  </div>`;
}

/* ==========================================================================
   Page — Observability
   ========================================================================== */
function renderChart(points) {
  const rows = Array.isArray(points) ? points.slice(-20) : [];
  if (!rows.length) {
    return `<div class="empty-state" style="padding:22px 0">${esc(t("noLogs"))}</div>`;
  }
  const width = 640;
  const height = 132;
  const pad = { left: 34, right: 10, top: 10, bottom: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const stepX = rows.length > 1 ? plotW / (rows.length - 1) : plotW;
  const x = (i) => pad.left + (rows.length > 1 ? i * stepX : plotW / 2);
  const y = (v) => pad.top + plotH - (Math.max(0, Math.min(100, v)) / 100) * plotH;

  const grid = [0, 25, 50, 75, 100]
    .map((v) => {
      const gy = y(v);
      return `<line x1="${pad.left}" y1="${gy.toFixed(1)}" x2="${width - pad.right}" y2="${gy.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="${v === 0 ? "0" : "3 4"}" />
        <text x="${pad.left - 7}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" font-size="9" fill="var(--ink-3)" font-family="ui-monospace, monospace">${v}</text>`;
    })
    .join("");

  const segments = [];
  let current = [];
  rows.forEach((p, i) => {
    const value = p && p.cacheReported !== false ? num(p.hitRate) : null;
    if (value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push([x(i), y(value), value]);
    }
  });
  if (current.length) segments.push(current);

  const lines = segments
    .map((seg) => {
      if (seg.length === 1) return "";
      const d = seg.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
      return `<path d="${d}" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" />`;
    })
    .join("");

  const dots = segments
    .flat()
    .map(
      ([px, py]) =>
        `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.4" fill="var(--bg-elevated)" stroke="var(--brand)" stroke-width="1.4" />`
    )
    .join("");

  const areaSeg = segments.filter((s) => s.length > 1)[0];
  let area = "";
  if (areaSeg) {
    const d = `${areaSeg.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")} L${areaSeg[areaSeg.length - 1][0].toFixed(1)} ${y(0).toFixed(1)} L${areaSeg[0][0].toFixed(1)} ${y(0).toFixed(1)} Z`;
    area = `<path d="${d}" fill="url(#chartFill)" stroke="none" />`;
  }

  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(t("chartTitle"))}">
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--brand)" stop-opacity="0.16" />
        <stop offset="100%" stop-color="var(--brand)" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${grid}
    ${area}
    ${lines}
    ${dots}
  </svg>`;
}

function perfRow(row) {
  const status = statusTag(row.status);
  const first = num(row.firstActivityMs) ?? num(row.firstToolMs) ?? num(row.firstEditMs);
  return `<tr>
    <td class="strong">${esc(roleName(row.role))}</td>
    <td class="mono">${esc(row.modelName || row.modelId || "—")}</td>
    <td class="mono">${esc(row.engine || "—")}</td>
    <td>${esc(row.appliedEffort || row.requestedEffort ? effortLabel(row.appliedEffort || row.requestedEffort) : "—")}</td>
    <td class="num">${esc(fmtDuration(row.elapsedMs))}</td>
    <td class="num">${esc(fmtDuration(first))}</td>
    <td><span class="tag ${status.cls}">${esc(status.label)}</span></td>
  </tr>`;
}

const CACHE_SKIP_REASON_KEYS = {
  "no-projection-record": "cacheReasonNoProjection",
  "cwd-mismatch": "cacheReasonCwdMismatch",
  unreported: "cacheReasonUpstream",
};

function cacheReasonText(row) {
  const code = String(row?.usageSkipReason || "").trim();
  const known = CACHE_SKIP_REASON_KEYS[code.toLowerCase()];
  if (known) return t(known);
  if (code) return code;
  const scope = String(row?.usageScope || "").trim();
  if (scope) return `${t("cacheReasonScope")} · ${scope}`;
  return t("cacheReasonFallback");
}

function cacheCell(row) {
  if (row?.cacheReported !== false && num(row?.hitRate) != null) {
    return `<span class="tag green nums">${esc(fmtPct(row.hitRate))}</span>`;
  }
  const reason = cacheReasonText(row);
  return `<span class="tag plain diag-reason" title="${esc(reason)}">${esc(t("unreported"))} · ${esc(reason)}</span>`;
}

function turnRow(row) {
  return `<tr>
    <td class="mono">${esc(fmtClock(row.ts) || "—")}</td>
    <td class="strong">${esc(roleName(row.role))}</td>
    <td class="mono">${esc(row.modelName || row.modelId || "—")}</td>
    <td class="mono">${esc(row.engine || "—")}</td>
    <td>${cacheCell(row)}</td>
  </tr>`;
}

function renderObservabilityPage() {
  const tel = state?.telemetry || {};
  const perf = state?.perf || {};
  const cumHit = num(tel.cumulativeHitRate);
  const perfRows = Array.isArray(perf.recent) ? [...perf.recent].reverse() : [];
  const turnRows = Array.isArray(tel.recent) ? tel.recent.slice(0, 20) : [];

  return `<div class="content-inner">
    <div class="kpi-grid">
      <div class="kpi-card">
        <span class="kpi-label">${esc(t("kpiCumHit"))}</span>
        <span class="kpi-value ${cumHit == null ? "" : cumHit >= 80 ? "green" : "amber"}">${esc(cumHit != null ? fmtPct(cumHit) : "—")}</span>
        <span class="kpi-sub nums">${esc(tel.reportedTurns || 0)} / ${esc(tel.totalTurns || 0)} ${esc(t("chartReported"))}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${esc(t("kpiCached"))}</span>
        <span class="kpi-value">${esc(tel.reportedTurns ? fmtCompact(tel.totalCachedTokens) : "—")}</span>
        <span class="kpi-sub nums">${esc(tel.reportedTurns ? `/ ${fmtCompact(tel.totalInputTokens)} in` : t("unreported"))}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${esc(t("kpiTurns"))}</span>
        <span class="kpi-value">${esc(fmtInt(tel.totalTurns))}</span>
        <span class="kpi-sub nums">${esc(perf.totalJobs || 0)} ${esc(t("recentJobs"))}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${esc(t("kpiAvgDuration"))}</span>
        <span class="kpi-value">${esc(fmtDuration(perf.avgDurationMs))}</span>
        <span class="kpi-sub nums">${esc(perf.totalJobs || 0)} ${esc(t("recentJobs"))}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">${esc(t("kpiAvgFirst"))}</span>
        <span class="kpi-value">${esc(fmtDuration(perf.avgFirstOutputMs))}</span>
        <span class="kpi-sub nums">${esc(t("colFirst"))} · ${esc(t("colDuration"))}</span>
      </div>
    </div>

    <div class="chart-box">
      <div class="section-head">
        <span class="section-title">${esc(t("chartTitle"))}</span>
        <div class="spacer"></div>
        <span class="field-hint nums">${(tel.chartPoints || []).length} ${esc(t("turns"))}</span>
      </div>
      ${renderChart(tel.chartPoints)}
      <div class="chart-legend">
        <span class="legend-key"><span class="legend-swatch"></span>${esc(t("hit"))} %</span>
        <span>${esc(t("chartUnreported"))}: ${(tel.chartPoints || []).filter((p) => p && p.cacheReported === false).length}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">${esc(t("recentTurnsTitle"))}</span>
        <span class="tag plain nums">${esc(turnRows.length)}</span>
      </div>
      ${turnRows.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr>
              <th>${esc(t("colTime"))}</th>
              <th>${esc(t("colRole"))}</th>
              <th>${esc(t("colModel"))}</th>
              <th>${esc(t("colEngine"))}</th>
              <th>${esc(t("colCache"))}</th>
            </tr></thead>
            <tbody>${turnRows.map(turnRow).join("")}</tbody>
          </table></div>`
        : `<div class="empty-state">${esc(t("noLogs"))}</div>`}
    </div>

    <div class="card">
      <div class="card-head">
        <span class="card-title">${esc(t("perfTitle"))}</span>
        <span class="tag plain nums">${esc(perf.totalJobs || perfRows.length || 0)}</span>
        <div class="spacer"></div>
        <button class="btn xs danger" data-action="clear-logs">${iconSvg("trash")} ${esc(t("clearLogs"))}</button>
      </div>
      ${perfRows.length
        ? `<div class="table-wrap"><table class="data-table">
            <thead><tr>
              <th>${esc(t("colRole"))}</th>
              <th>${esc(t("colModel"))}</th>
              <th>${esc(t("colEngine"))}</th>
              <th>${esc(t("colEffort"))}</th>
              <th>${esc(t("colDuration"))}</th>
              <th>${esc(t("colFirst"))}</th>
              <th>${esc(t("colStatus"))}</th>
            </tr></thead>
            <tbody>${perfRows.slice(0, 40).map(perfRow).join("")}</tbody>
          </table></div>`
        : `<div class="empty-state">${esc(t("noPerf"))}</div>`}
    </div>
  </div>`;
}

/* ==========================================================================
   Page — Settings
   ========================================================================== */
function numberSetting(key, { title, desc, min, max, presets, unit, zero, labels }) {
  const value = num(state?.settings?.[key]);
  const label = (n) => {
    if (n === 0 && zero) return t(zero);
    if (labels && labels[n]) return t(labels[n]);
    return `${n}${unit ? t(unit) : ""}`;
  };
  return `<div class="setting-item">
    <div class="setting-meta">
      <div class="setting-title">${esc(t(title))}</div>
      <div class="setting-desc">${esc(t(desc))}</div>
    </div>
    <div class="setting-number-controls">
      <div class="seg">
        ${presets
          .map(
            (n) =>
              `<button class="seg-btn ${value === n ? "active" : ""}" data-action="set-number" data-key="${esc(key)}" data-value="${n}" aria-pressed="${value === n}">${esc(label(n))}</button>`
          )
          .join("")}
      </div>
      <input class="setting-number" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" value="${value == null ? "" : value}" data-number-key="${esc(key)}" aria-label="${esc(`${t(title)} · ${t("customNumber")}`)}" />
    </div>
  </div>`;
}

function boolSetting(key, title, desc) {
  const on = Boolean(state?.settings?.[key]);
  return `<div class="setting-item">
    <div class="setting-meta">
      <div class="setting-title">${esc(t(title))}</div>
      <div class="setting-desc">${esc(t(desc))}</div>
    </div>
    <button class="switch sm ${on ? "on" : ""}" data-action="toggle-bool" data-key="${esc(key)}" role="switch" aria-checked="${on}" aria-label="${esc(t(title))}"></button>
  </div>`;
}

function renderInspectorSetting() {
  const s = state?.settings || {};
  const models = apiModels();
  const enabled = Boolean(s.inspectorEnabled && s.inspectorModelId);
  const current = models.find((m) => m.id === s.inspectorModelId);
  return `<div class="setting-item column">
    <div class="row" style="width:100%">
      <div class="setting-meta">
        <div class="setting-title">${esc(t("inspector"))}</div>
        <div class="setting-desc">${esc(t("inspectorDesc"))}</div>
      </div>
      <button class="switch sm ${enabled ? "on" : ""}" data-action="toggle-inspector" role="switch" aria-checked="${enabled}" aria-label="${esc(t("inspector"))}" ${!models.length && !enabled ? "disabled" : ""}></button>
    </div>
    ${models.length
      ? `<div class="field">
          <div class="field-label">${esc(t("inspectorModel"))}</div>
          <select class="select" data-inspector-model="1">
            ${models
              .map((m) => `<option value="${esc(m.id)}" ${m.id === s.inspectorModelId ? "selected" : ""}>${esc(`${m.name}${m.channelName ? ` · ${m.channelName}` : ""}`)}</option>`)
              .join("")}
          </select>
        </div>`
      : `<div class="field-hint">${esc(t("inspectorNeedModel"))}</div>`}
    <div class="field-hint">${esc(enabled ? (current ? `${t("inspectorOn")} · ${current.name}` : t("inspectorOn")) : t("inspectorOff"))}</div>
  </div>`;
}

function renderSettingsPage() {
  const s = state?.settings || {};
  const daemon = state?.daemon || {};
  const host = daemon.host || "127.0.0.1";
  const port = daemon.port || 3426;
  const mcpUrl = daemon.mcpUrl || `http://${host}:${port}/mcp`;
  const dataDir = state?.dataDir || daemon.dataDir || "—";

  return `<div class="content-inner">
    <div>
      <div class="section-head"><span class="section-title">${esc(t("secDispatch"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        ${numberSetting("maxConcurrency", {
          title: "maxConcurrency",
          desc: "maxConcurrencyDesc",
          min: 1,
          max: 6,
          presets: [1, 2, 3, 4, 5, 6],
        })}
        ${numberSetting("silentCheckinMin", {
          title: "silentCheckin",
          desc: "silentCheckinDesc",
          min: 1,
          max: 30,
          presets: [1, 3, 5, 10],
          unit: "minuteUnit",
        })}
        ${numberSetting("longRunCheckinMin", {
          title: "longRunCheckin",
          desc: "longRunCheckinDesc",
          min: 0,
          max: 120,
          presets: [0, 15, 30, 60],
          unit: "minuteUnit",
          zero: "unlimited",
        })}
        ${boolSetting("autoFallbackOnLimit", "autoFallback", "autoFallbackDesc")}
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${esc(t("secAutomation"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        ${renderInspectorSetting()}
        ${boolSetting("allowWorktreeParallelWrite", "worktree", "worktreeDesc")}
        ${boolSetting("allowHephaestusFullAccess", "fullAccess", "fullAccessDesc")}
        ${boolSetting("asyncBackgroundMode", "asyncMode", "asyncModeDesc")}
        ${boolSetting("codexKeepOfficePlugins", "keepOffice", "keepOfficeDesc")}
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${esc(t("secData"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        ${numberSetting("retentionDays", {
          title: "retention",
          desc: "retentionDesc",
          min: 0,
          max: 3650,
          presets: [7, 30, 0],
          labels: { 7: "days7", 30: "days30" },
          zero: "forever",
        })}
        <div class="setting-item">
          <div class="setting-meta">
            <div class="setting-title">${esc(t("clearLogs"))}</div>
            <div class="setting-desc">${esc(t("confirmClearLogsMsg"))}</div>
          </div>
          <button class="btn sm danger" data-action="clear-logs">${iconSvg("trash")} ${esc(t("clearLogs"))}</button>
        </div>
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${esc(t("secAppearance"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        <div class="setting-item">
          <div class="setting-meta">
            <div class="setting-title">${esc(t("language"))}</div>
            <div class="setting-desc">${esc(t("languageDesc"))}</div>
          </div>
          <div class="seg">
            <button class="seg-btn ${!isEn() ? "active" : ""}" data-action="set-lang" data-lang="zh">中文</button>
            <button class="seg-btn ${isEn() ? "active" : ""}" data-action="set-lang" data-lang="en">English</button>
          </div>
        </div>
        <div class="setting-item">
          <div class="setting-meta">
            <div class="setting-title">${esc(t("theme"))}</div>
            <div class="setting-desc">${esc(t("themeDesc"))}</div>
          </div>
          <div class="seg">
            <button class="seg-btn ${ui.theme === "light" ? "active" : ""}" data-action="set-theme" data-theme="light">${esc(t("themeLight"))}</button>
            <button class="seg-btn ${ui.theme === "dark" ? "active" : ""}" data-action="set-theme" data-theme="dark">${esc(t("themeDark"))}</button>
            <button class="seg-btn ${ui.theme === "system" ? "active" : ""}" data-action="set-theme" data-theme="system">${esc(t("themeSystem"))}</button>
          </div>
        </div>
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${esc(t("secDiagnostics"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        <div class="setting-item">
          <div class="setting-meta">
            <div class="setting-title">${esc(t("diagExportTitle"))}</div>
            <div class="setting-desc">${esc(t("diagExportDesc"))}</div>
            ${ui.diagExportResult
              ? `<div class="diag-result">${esc(t("diagExportDone"))} · <span class="mono">${esc(ui.diagExportResult.fileName || "—")}</span> · ${esc(fmtBytes(ui.diagExportResult.sizeBytes))}</div>`
              : `<div class="field-hint">${esc(t("diagRevealHint"))}</div>`}
            ${ui.diagExportError ? `<div class="field-hint" style="color:var(--red)">${esc(ui.diagExportError)}</div>` : ""}
          </div>
          <button class="btn sm primary" data-action="diag-export" ${ui.diagExporting ? "disabled" : ""}>
            ${iconSvg("download")} ${esc(ui.diagExporting ? t("diagExporting") : t("diagExportBtn"))}
          </button>
        </div>
        <div class="setting-item">
          <div class="setting-meta">
            <div class="setting-title">${esc(t("diagOpenTitle"))}</div>
            <div class="setting-desc">${esc(t("diagOpenDesc"))}</div>
          </div>
          <button class="btn sm" data-action="diag-open-logs">${iconSvg("external")} ${esc(t("diagOpenBtn"))}</button>
        </div>
      </div>
    </div>

    <div>
      <div class="section-head"><span class="section-title">${esc(t("secGateway"))}</span></div>
      <div class="settings-group" style="margin-top:9px">
        <div class="info-row">
          <span class="info-key">${esc(t("gatewayAddress"))}</span>
          <span class="info-val" title="${esc(mcpUrl)}">${esc(mcpUrl)}</span>
          <button class="btn xs" data-action="copy-gateway">${iconSvg("copy")} ${esc(t("copy"))}</button>
        </div>
        <div class="info-row">
          <span class="info-key">${esc(t("dataDir"))}</span>
          <span class="info-val" title="${esc(dataDir)}">${esc(dataDir)}</span>
          <button class="btn xs" data-action="copy-datadir">${iconSvg("copy")} ${esc(t("copy"))}</button>
        </div>
        <div class="info-row">
          <span class="info-key">${esc(t("pluginVersion"))}</span>
          <span class="info-val">${esc(state?.version || "2.0.0")}</span>
        </div>
        <div class="info-row">
          <span class="info-key">${esc(t("daemonStarted"))}</span>
          <span class="info-val">${esc(fmtClock(daemon.startedAt) || "—")}</span>
        </div>
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   Overlay — modals & drawer
   ========================================================================== */
function renderOverlay() {
  const modal = ui.modal;
  if (!modal) return "";
  if (modal.type === "client") return renderClientDrawer(modal);
  if (modal.type === "setup") return renderSetupModal();
  if (modal.type === "channel") return renderChannelModal();
  if (modal.type === "job") return renderJobModal();
  if (modal.type === "extension") return getExtensionsView().renderModal(modal);
  if (modal.type === "confirm") return renderConfirmModal();
  return "";
}

function overlayShell(inner, extraClass = "") {
  return `<div class="overlay ${extraClass}" data-action="overlay-bg">
    ${inner}
  </div>`;
}

function modalHeader(title, sub, closeAction = "close-modal") {
  return `<div class="modal-head">
    <div class="modal-head-main">
      <div class="modal-title">${esc(title)}</div>
      ${sub ? `<div class="modal-sub">${esc(sub)}</div>` : ""}
    </div>
    <button class="icon-btn sm plain" data-action="${closeAction}" aria-label="${esc(t("close"))}">${iconSvg("close")}</button>
  </div>`;
}

function setupPromptText(setup) {
  if (!setup) return "";
  if (isEn()) return setup.promptEn || setup.promptZh || "";
  return setup.promptZh || setup.promptEn || "";
}

function renderSetupModal() {
  const setup = ui.setup || {};
  const client = setup.clientId ? findClient(setup.clientId) : null;
  const connected = Boolean(client && client.connected);
  const clientName = client?.name || setup.clientName || "";
  const promptText = setupPromptText(setup) || fallbackPrompt(setup);
  const tab = ui.setupTab;

  const tabs = `<div class="tabs">
    <button class="tab ${tab === "prompt" ? "active" : ""}" data-action="setup-tab" data-tab="prompt">${esc(t("tabPrompt"))}</button>
    <button class="tab ${tab === "http" ? "active" : ""}" data-action="setup-tab" data-tab="http">${esc(t("tabHttp"))}</button>
    <button class="tab ${tab === "stdio" ? "active" : ""}" data-action="setup-tab" data-tab="stdio">${esc(t("tabStdio"))}</button>
  </div>`;

  let panel = "";
  if (tab === "http") {
    const json = setup.httpConfigJson || "";
    panel = `<div class="field">
      <div class="row">
        <span class="field-label" style="flex:1">${esc(t("tabHttp"))}</span>
        <button class="btn xs" data-action="copy-http">${iconSvg("copy")} ${esc(t("copy"))}</button>
      </div>
      <div class="prompt-box">${esc(json || "—")}</div>
    </div>`;
  } else if (tab === "stdio") {
    panel = `<div class="field">
      <div class="field-hint">${esc(t("stdioHint"))}</div>
      <div class="row">
        <span class="field-label" style="flex:1">${esc(t("tabStdio"))}</span>
        <button class="btn xs" data-action="copy-stdio">${iconSvg("copy")} ${esc(t("copy"))}</button>
      </div>
      <div class="prompt-box">${esc(setup.stdioBridgeConfigJson || setup.stdioCommand || "—")}</div>
      ${setup.stdioCommand ? `<div class="field-hint mono" style="word-break:break-all">${esc(setup.stdioCommand)}</div>` : ""}
    </div>`;
  } else {
    panel = `<div class="field">
      <div class="prompt-box">${esc(promptText || t("promptMissing"))}</div>
    </div>`;
  }

  return overlayShell(`<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(t("setupTitle"))}">
    ${modalHeader(t("setupTitle"), t("setupSub"))}
    <div class="modal-body">
      <div class="prompt-hero">
        <div class="prompt-hero-head">
          <div class="prompt-hero-icon">${iconSvg("spark")}</div>
          <div style="flex:1;min-width:0">
            <div class="prompt-hero-title">${esc(t("promptHeroTitle"))}</div>
            <div class="prompt-hero-desc">${esc(t("promptHeroDesc"))}</div>
          </div>
        </div>
        <div class="prompt-actions">
          <button class="btn primary" data-action="copy-prompt">${iconSvg("copy")} ${esc(t("copyPromptBig"))}</button>
          <button class="btn" data-action="copy-token" title="${esc(setup.token || "")}">${iconSvg("key")} ${esc(t("tokenLabel"))}</button>
        </div>
      </div>
      ${tabs}
      ${panel}
      <div class="conn-banner ${connected ? "connected" : "waiting"}">
        <span class="conn-pulse"></span>
        <span style="flex:1">${esc(connected ? t("connectedAs", clientName || client?.name || "") : t("waitingHandshake"))}</span>
        ${connected ? "" : `<span class="conn-hint">${esc(t("waitingHint"))}</span>`}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" data-action="open-client" data-client="${esc(setup.clientId || "")}">${esc(t("detailTitle"))}</button>
      <div class="spacer"></div>
      <button class="btn primary" data-action="close-modal">${esc(t("close"))}</button>
    </div>
  </div>`);
}

function fallbackPrompt(setup) {
  if (!setup) return "";
  if (!setup.httpUrl && !setup.token) return "";
  const header = isEn()
    ? "Configure A.stand as an MCP server for me. Add this HTTP MCP endpoint to your MCP config and reload:"
    : "请帮我接入 A.stand：把下面这个 HTTP MCP 服务加入你的 MCP 配置并重新加载：";
  return `${header}\n\nURL: ${setup.httpUrl || ""}\nHeader: X-Astand-UI-Token: ${setup.token || ""}\n\n${
    isEn()
      ? "After connecting, call agent_relay_console once to verify, then follow the rules returned by the server."
      : "连接成功后先调用一次 agent_relay_console 验证，然后按服务端返回的规则执行。"
  }`;
}

function renderClientDrawer(modal) {
  const client = findClient(modal.clientId);
  if (!client) {
    return overlayShell(`<div class="drawer-panel">${modalHeader(t("detailTitle"))}<div class="modal-body"><div class="empty-state">${esc(t("clientNotFound"))}</div></div></div>`, "drawer");
  }
  const draftName = modal.nameDraft != null ? modal.nameDraft : client.customName || "";
  const draftIcon = modal.iconDraft || client.customIconKey || client.iconKey;
  const fullToken = ui.tokenCache[client.id] || "";
  const tokenText = fullToken ? (ui.maskTokens ? maskToken(fullToken) : fullToken) : clientTokenPreview(client);

  return overlayShell(`<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="${esc(t("detailTitle"))}">
    ${modalHeader(client.name, `${t("detailTitle")} · ${client.transport === "stdio" ? t("transportStdio") : t("transportHttp")}`, "close-modal")}
    <div class="modal-body">
      <div class="detail-section">
        <div class="row">
          <span class="client-avatar">${clientIconSvg(draftIcon, 22)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:650;font-size:13px" class="truncate">${esc(client.name)}</div>
            <div class="field-hint">${esc(client.connected ? t("connected") : t("awaitingFirst"))} · ${esc(t("lastActive"))} ${esc(fmtRelative(client.lastSeenAt))}</div>
          </div>
          <button class="switch ${client.enabled ? "on" : ""}" data-action="toggle-client" data-client="${esc(client.id)}" role="switch" aria-checked="${client.enabled}" aria-label="${esc(t("enabledLabel"))}"></button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-label">${esc(t("renameLabel"))}</div>
        <div class="field-row">
          <input class="input" data-client-name="${esc(client.id)}" data-focus-key="client-name" placeholder="${esc(t("renamePlaceholder"))}" value="${esc(draftName)}" maxlength="60" />
          <button class="btn sm" data-action="save-client-name" data-client="${esc(client.id)}">${esc(t("saveName"))}</button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-label">${esc(t("iconLabel"))}</div>
        <div class="icon-grid">
          ${CLIENT_ICON_KEYS.map(
            (key) => `<button class="icon-choice ${key === draftIcon ? "selected" : ""}" data-action="pick-client-icon" data-client="${esc(client.id)}" data-icon="${key}" title="${esc(key)}" aria-label="${esc(key)}" aria-pressed="${key === draftIcon}">${clientIconSvg(key, 20)}</button>`
          ).join("")}
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-label">${esc(t("tokenLabel"))}</div>
        <div class="row">
          <span class="client-token mono" style="flex:1;max-width:none" title="${esc(tokenText)}">${esc(tokenText)}</span>
          <button class="btn xs" data-action="copy-token" data-client="${esc(client.id)}">${iconSvg("copy")} ${esc(t("copy"))}</button>
        </div>
        <div class="field-hint">${esc(t("tokenDesc"))}</div>
        <div class="row" style="margin-top:4px">
          <button class="btn sm" data-action="view-prompt" data-client="${esc(client.id)}">${iconSvg("spark")} ${esc(t("viewPrompt"))}</button>
          <button class="btn sm" data-action="reset-token" data-client="${esc(client.id)}">${iconSvg("refresh")} ${esc(t("resetToken"))}</button>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-label">${esc(t("enabledLabel"))}</div>
        <div class="setting-desc">${esc(t("enabledDesc"))}</div>
      </div>

      <div class="danger-zone">
        <div class="setting-meta">
          <div class="setting-title">${esc(t("deleteClient"))}</div>
          <div class="setting-desc">${esc(t("deleteClientDesc"))}</div>
        </div>
        <button class="btn sm danger" data-action="delete-client" data-client="${esc(client.id)}">${iconSvg("trash")} ${esc(t("delete"))}</button>
      </div>
    </div>
  </div>`, "drawer");
}

function renderChannelModal() {
  const form = ui.channelForm || {};
  const providers = state?.providers || [];
  const selectedProvider = providers.find((p) => p.id === form.providerId) || providers[0];
  const models = form.availableModels || [];
  const selected = new Set(form.selectedModels || []);
  const query = (form.search || "").trim().toLowerCase();
  const filtered = models.filter((m) => !query || String(m.id || "").toLowerCase().includes(query));
  const isEdit = Boolean(form.id);

  return overlayShell(`<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(isEdit ? t("editChannel") : t("addChannel"))}">
    ${modalHeader(isEdit ? t("editChannel") : t("addChannel"), t("apiChannels"))}
    <div class="modal-body">
      <div class="field-grid">
        <div class="field">
          <label class="field-label">${esc(t("providerLabel"))}</label>
          <select class="select" data-channel-field="providerId">
            ${providers
              .map((p) => `<option value="${esc(p.id)}" ${p.id === form.providerId ? "selected" : ""}>${esc(isEn() ? p.nameEn || p.nameZh : p.nameZh || p.nameEn)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="field">
          <label class="field-label">${esc(t("channelName"))}</label>
          <input class="input" data-channel-field="name" placeholder="${esc(t("channelNamePlaceholder"))}" value="${esc(form.name || "")}" maxlength="60" />
        </div>
      </div>

      <div class="field">
        <label class="field-label">${esc(t("baseUrl"))}</label>
        <input class="input mono" data-channel-field="baseUrl" placeholder="${esc(selectedProvider?.baseUrl || "https://api.example.com/v1")}" value="${esc(form.baseUrl || "")}" spellcheck="false" autocomplete="off" />
      </div>

      <div class="field">
        <label class="field-label">${esc(t("apiKey"))}</label>
        <input class="input mono" type="password" data-channel-field="apiKey" placeholder="${esc(form.hasApiKey ? t("apiKeyKeep") : t("apiKeyPlaceholder"))}" value="${esc(form.apiKey || "")}" spellcheck="false" autocomplete="new-password" />
      </div>

      <div class="field">
        <div class="row">
          <span class="field-label" style="flex:1">${esc(t("fetchedModels"))}${selected.size ? ` · ${esc(t("selectedCount", selected.size))}` : ""}</span>
          <button class="btn xs" data-action="fetch-channel-models" ${form.fetching ? "disabled" : ""}>${iconSvg("refresh")} ${esc(form.fetching ? t("fetching") : t("autoFetchModels"))}</button>
        </div>
        ${ui.channelFetchError ? `<div class="field-hint" style="color:var(--red)">${esc(ui.channelFetchError)}</div>` : ""}
        ${models.length
          ? `<div class="search-field" style="max-width:none">
              ${iconSvg("search")}
              <input class="input" type="search" data-channel-search="1" data-focus-key="channel-search" placeholder="${esc(t("search"))}" value="${esc(form.search || "")}" />
            </div>
            <div class="model-select-grid">
              ${filtered
                .map(
                  (m) => `<button class="model-option ${selected.has(m.id) ? "selected" : ""}" data-action="toggle-channel-model" data-model="${esc(m.id)}" aria-pressed="${selected.has(m.id)}">
                    ${selected.has(m.id) ? iconSvg("check") : ""}<span>${esc(m.id)}</span>
                  </button>`
                )
                .join("")}
            </div>
            <div class="row">
              <button class="btn xs ghost" data-action="clear-channel-models">${esc(t("clearSelection"))}</button>
            </div>`
          : `<div class="field-hint">${esc(t("noModelsFetched"))}</div>`}
      </div>

      <div class="field">
        <label class="field-label">${esc(t("manualModel"))}</label>
        <div class="field-row">
          <input class="input mono" data-channel-field="manualModel" data-focus-key="channel-manual" placeholder="${esc(selectedProvider?.placeholderModel || "model-name")}" value="${esc(form.manualModel || "")}" spellcheck="false" />
          <button class="btn sm" data-action="add-manual-model">${esc(t("addModel"))}</button>
        </div>
      </div>

      ${form.testResult ? `<div class="field-hint" style="color:${form.testResult.ok ? "var(--green)" : "var(--red)"}">${esc(form.testResult.ok ? t("connOk") : `${t("connFail")}${form.testResult.error ? `: ${form.testResult.error}` : ""}`)}</div>` : ""}
      ${form.error ? `<div class="field-hint" style="color:var(--red)">${esc(form.error)}</div>` : ""}
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="test-channel-form">${iconSvg("zap")} ${esc(t("testConnection"))}</button>
      <div class="spacer"></div>
      <button class="btn" data-action="close-modal">${esc(t("cancel"))}</button>
      <button class="btn primary" data-action="save-channel" ${ui.channelSaving ? "disabled" : ""}>${esc(t("saveChannel"))}</button>
    </div>
  </div>`);
}

function renderJobModal() {
  const job = ui.jobDetail;
  const jobId = ui.modal.jobId;
  const status = job ? statusTag(job.status) : { cls: "blue", label: "" };
  let body;
  if (ui.jobLoading && !job) {
    body = `<div class="empty-state">${esc(t("jobLoading"))}</div>`;
  } else if (ui.jobError) {
    body = `<div class="empty-state" style="color:var(--red)">${esc(ui.jobError)}</div>`;
  } else if (!job) {
    body = `<div class="empty-state">${esc(t("jobNoSteps"))}</div>`;
  } else {
    const activities = Array.isArray(job.activities) ? job.activities : [];
    body = `
      ${job.prompt ? `<div class="field"><div class="detail-label">${esc(t("jobPrompt"))}</div><div class="job-prompt-box">${esc(job.prompt)}</div></div>` : ""}
      <div class="field">
        <div class="detail-label">${esc(t("jobTimeline"))}</div>
        ${activities.length
          ? `<div class="timeline">${activities
              .map((a) => {
                const kind = a.kind || a.type || "log";
                const dotCls = ["cmd", "edit", "write", "output", "error"].includes(kind) ? kind : "";
                const title = a.title || a.summary || kind;
                const meta = [kind, a.durationSec != null ? fmtDuration(Number(a.durationSec) * 1000) : "", a.exitCode != null ? `exit ${a.exitCode}` : ""]
                  .filter(Boolean)
                  .join(" · ");
                return `<div class="timeline-item">
                  <span class="timeline-dot ${dotCls}"></span>
                  <div class="timeline-main">
                    <div class="timeline-title">${esc(title)}</div>
                    ${meta ? `<div class="timeline-meta">${esc(meta)}</div>` : ""}
                  </div>
                </div>`;
              })
              .join("")}</div>`
          : `<div class="empty-state">${esc(t("jobNoSteps"))}</div>`}
      </div>
      ${job.error ? `<div class="field"><div class="detail-label" style="color:var(--red)">${esc(t("jobError"))}</div><div class="job-prompt-box" style="color:var(--red)">${esc(job.error)}</div></div>` : ""}
      ${job.finalText ? `<div class="field"><div class="detail-label">${esc(t("jobFinal"))}</div><div class="job-final-box">${esc(job.finalText)}</div></div>` : ""}
    `;
  }

  return overlayShell(`<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(t("jobDetail"))}">
    <div class="modal-head">
      <span class="job-role ${job?.role === "hephaestus" ? "hephaestus" : "oracle"}">${esc(roleName(job?.role))}</span>
      <div class="modal-head-main">
        <div class="modal-title truncate">${esc(job?.title || jobId)}</div>
        <div class="modal-sub">${esc(job?.modelDisplayName || job?.modelId || job?.engine || jobId)}</div>
      </div>
      ${job ? `<span class="tag ${status.cls}">${esc(status.label)}</span>` : ""}
      ${job?.status === "running" ? `<button class="btn xs danger" data-action="stop-job" data-job="${esc(jobId)}">${iconSvg("stop")} ${esc(t("stopJob"))}</button>` : ""}
      <button class="icon-btn sm plain" data-action="close-modal" aria-label="${esc(t("close"))}">${iconSvg("close")}</button>
    </div>
    <div class="modal-body">${body}</div>
  </div>`);
}

function renderConfirmModal() {
  const modal = ui.modal;
  return overlayShell(`<div class="modal narrow" role="dialog" aria-modal="true" aria-label="${esc(modal.title)}">
    ${modalHeader(modal.title)}
    <div class="modal-body">
      <p style="font-size:12px;color:var(--ink-2);line-height:1.6">${esc(modal.message)}</p>
    </div>
    <div class="modal-foot">
      <div class="spacer"></div>
      <button class="btn" data-action="close-modal">${esc(t("cancel"))}</button>
      <button class="btn ${modal.danger ? "danger" : "primary"}" data-action="confirm-run">${esc(modal.confirmLabel || t("confirm"))}</button>
    </div>
  </div>`);
}

/* ==========================================================================
   Actions
   ========================================================================== */
function openModal(modal) {
  ui.modal = modal;
  scheduleRender();
}

function closeModal() {
  ui.modal = null;
  ui.setupTab = "prompt";
  ui.jobDetail = null;
  ui.jobError = "";
  getExtensionsView().reset();
  scheduleRender();
}

function askConfirm({ title, message, confirmLabel, danger, run }) {
  openModal({ type: "confirm", title, message, confirmLabel, danger, run });
}

async function loadClientSetup(clientId, { open = true } = {}) {
  const res = await api(`/api/clients/${encodeURIComponent(clientId)}/setup`);
  const setup = normalizeSetup(res?.setup, res?.token);
  if (res?.token) ui.tokenCache[clientId] = res.token;
  const client = res?.client ? normalizeClient(res.client) : findClient(clientId);
  if (open) {
    ui.setup = { clientId, token: res?.token || "", ...setup, clientName: client?.name || "" };
    ui.setupTab = "prompt";
    openModal({ type: "setup" });
  }
  return { setup, token: res?.token || "", client };
}

async function createClientAndOpenSetup() {
  if (ui.creatingClient) return;
  ui.creatingClient = true;
  ui.registerError = "";
  scheduleRender();
  try {
    const res = await api("/api/clients", { method: "POST", body: {} });
    if (res?.token) ui.tokenCache[res.client?.id || ""] = res.token;
    applyPayload(res);
    if (!res?.state) await refreshState({ silent: true });
    const client = res?.client ? normalizeClient(res.client) : null;
    ui.setup = {
      clientId: client?.id || res?.client?.id || "",
      token: res?.token || "",
      ...normalizeSetup(res?.setup, res?.token),
      clientName: client?.name || "",
    };
    ui.setupTab = "prompt";
    openModal({ type: "setup" });
  } catch (err) {
    ui.registerError = err?.message || t("saveFailed");
    showError("", err);
  } finally {
    ui.creatingClient = false;
    scheduleRender();
  }
}

function normalizeSetup(raw, token) {
  const setup = raw || {};
  return {
    httpUrl: setup.httpUrl || "",
    token: setup.token || token || "",
    promptZh: setup.promptZh || "",
    promptEn: setup.promptEn || "",
    httpConfigJson: setup.httpConfigJson || "",
    stdioBridgeConfigJson: setup.stdioBridgeConfigJson || "",
    stdioCommand: setup.stdioCommand || "",
  };
}

async function refreshJobDetail({ silent = false } = {}) {
  const modal = ui.modal;
  if (!modal || modal.type !== "job") return;
  const jobId = modal.jobId;
  if (!silent) {
    ui.jobLoading = true;
    ui.jobError = "";
    scheduleRender();
  }
  try {
    const res = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (ui.modal?.type !== "job" || ui.modal.jobId !== jobId) return;
    if (res?.ok && res.job) {
      ui.jobDetail = res.job;
      ui.jobError = "";
    } else {
      ui.jobError = res?.error || t("jobLoadFailed");
    }
  } catch (err) {
    ui.jobError = err?.message || t("jobLoadFailed");
  } finally {
    ui.jobLoading = false;
    scheduleRender();
  }
}

async function saveSettings(patch) {
  try {
    const res = await api("/api/settings", { method: "POST", body: patch });
    const next = applyPayload(res);
    if (!next) await refreshState({ silent: true });
    return true;
  } catch (err) {
    showError("", err);
    await refreshState({ silent: true });
    return false;
  }
}

async function setLanguage(lang) {
  if (!state) return;
  const previous = state.settings.lang;
  state.settings.lang = lang;
  scheduleRender();
  const ok = await saveSettings({ lang });
  if (!ok) {
    if (state?.settings) state.settings.lang = previous;
    scheduleRender();
  }
}

async function toggleClientEnabled(clientId, enabled) {
  try {
    const res = await api(`/api/clients/${encodeURIComponent(clientId)}`, {
      method: "PATCH",
      body: { enabled },
    });
    applyPayload(res);
    if (!res?.state) await refreshState({ silent: true });
  } catch (err) {
    showError("", err);
  }
}

async function copyClientPrompt(clientId) {
  try {
    const { setup } = await loadClientSetup(clientId, { open: false });
    const text = isEn() ? setup.promptEn || setup.promptZh : setup.promptZh || setup.promptEn;
    await copyText(text || fallbackPrompt(setup), t("copied"));
  } catch (err) {
    showError("", err);
  }
}

/* ==========================================================================
   Events
   ========================================================================== */
async function onActionClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;

  // Skills & Extensions owns its own page + modal actions; it returns false for anything else.
  if (action.startsWith("ext-")) {
    if (await getExtensionsView().handleAction(action, target)) return;
  }

  switch (action) {
    case "overlay-bg":
      if (event.target === target) closeModal();
      return;
    case "close-modal":
      closeModal();
      return;
    case "nav":
      ui.page = target.dataset.page;
      ui.modal = null;
      ui.picker = null;
      ui.jobDetail = null;
      getExtensionsView().reset();
      ui.scrollTop = 0;
      ui.resetScroll = true;
      scheduleRender();
      return;
    case "toggle-sidebar":
      ui.sidebarCollapsed = !ui.sidebarCollapsed;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, ui.sidebarCollapsed ? "1" : "0");
      } catch {
        /* ignore */
      }
      scheduleRender();
      return;
    case "copy-gateway": {
      const daemon = state?.daemon || {};
      const url = daemon.mcpUrl || `http://${daemon.host || "127.0.0.1"}:${daemon.port || 3426}/mcp`;
      void copyText(url, t("gatewayCopied"));
      return;
    }
    case "copy-datadir":
      void copyText(state?.dataDir || "", t("copied"));
      return;
    case "cycle-theme":
      cycleTheme();
      return;
    case "set-theme":
      ui.theme = target.dataset.theme || "light";
      applyTheme();
      scheduleRender();
      return;
    case "set-lang":
      void setLanguage(target.dataset.lang === "en" ? "en" : "zh");
      return;
    case "retry-state":
      ui.authError = false;
      ui.offline = false;
      void refreshState();
      return;

    /* ---------- Clients ---------- */
    case "toggle-mask":
      ui.maskTokens = !ui.maskTokens;
      scheduleRender();
      return;
    case "toggle-disabled":
      ui.showDisabled = !ui.showDisabled;
      scheduleRender();
      return;
    case "open-register":
      await createClientAndOpenSetup();
      return;
    case "setup-tab":
      ui.setupTab = target.dataset.tab || "prompt";
      scheduleRender();
      return;
    case "copy-prompt": {
      const setup = ui.setup || {};
      void copyText(setupPromptText(setup) || fallbackPrompt(setup), t("copied"));
      return;
    }
    case "copy-http":
      void copyText(ui.setup?.httpConfigJson || "", t("copied"));
      return;
    case "copy-stdio":
      void copyText(ui.setup?.stdioBridgeConfigJson || ui.setup?.stdioCommand || "", t("copied"));
      return;
    case "copy-token": {
      const clientId = target.dataset.client || ui.setup?.clientId || "";
      const token = ui.tokenCache[clientId] || ui.setup?.token || "";
      void copyText(token, t("copied"));
      return;
    }
    case "open-client": {
      const clientId = target.dataset.client;
      if (!clientId) return;
      const client = findClient(clientId);
      if (!client) {
        showToast(t("clientNotFound"), "error");
        return;
      }
      openModal({ type: "client", clientId, nameDraft: client.customName || "", iconDraft: client.customIconKey || client.iconKey });
      if (!ui.tokenCache[clientId]) {
        api(`/api/clients/${encodeURIComponent(clientId)}/setup`)
          .then((res) => {
            if (res?.token) {
              ui.tokenCache[clientId] = res.token;
              scheduleRender();
            }
          })
          .catch(() => {});
      }
      return;
    }
    case "save-client-name": {
      const clientId = target.dataset.client;
      const input = document.querySelector(`[data-client-name="${cssEscape(clientId)}"]`);
      const customName = input ? input.value.trim() : "";
      try {
        const res = await api(`/api/clients/${encodeURIComponent(clientId)}`, {
          method: "PATCH",
          body: { customName },
        });
        applyPayload(res);
        if (ui.modal?.type === "client") ui.modal.nameDraft = customName;
        if (!res?.state) await refreshState({ silent: true });
        showToast(t("saved"));
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "pick-client-icon": {
      const clientId = target.dataset.client;
      const iconKey = target.dataset.icon || "generic";
      try {
        const res = await api(`/api/clients/${encodeURIComponent(clientId)}`, {
          method: "PATCH",
          body: { customIconKey: iconKey },
        });
        applyPayload(res);
        if (ui.modal?.type === "client") ui.modal.iconDraft = iconKey;
        if (!res?.state) await refreshState({ silent: true });
        scheduleRender();
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "toggle-client": {
      const clientId = target.dataset.client;
      const client = findClient(clientId);
      if (!client) return;
      void toggleClientEnabled(clientId, !client.enabled);
      return;
    }
    case "copy-client-prompt":
      void copyClientPrompt(target.dataset.client);
      return;
    case "view-prompt": {
      const clientId = target.dataset.client;
      loadClientSetup(clientId, { open: true }).catch((err) => showError("", err));
      return;
    }
    case "reset-token": {
      const clientId = target.dataset.client;
      askConfirm({
        title: t("confirmResetToken"),
        message: t("confirmResetTokenMsg"),
        confirmLabel: t("resetToken"),
        danger: true,
        run: async () => {
          try {
            const res = await api(`/api/clients/${encodeURIComponent(clientId)}`, {
              method: "PATCH",
              body: { regenerateToken: true },
            });
            applyPayload(res);
            if (res?.token) ui.tokenCache[clientId] = res.token;
            if (!res?.state) await refreshState({ silent: true });
            if (res?.setup) {
              ui.setup = {
                clientId,
                token: res.token || "",
                ...normalizeSetup(res.setup, res.token),
                clientName: findClient(clientId)?.name || "",
              };
              ui.setupTab = "prompt";
              openModal({ type: "setup" });
            } else {
              closeModal();
              showToast(t("saved"));
            }
          } catch (err) {
            showError("", err);
          }
        },
      });
      return;
    }
    case "delete-client": {
      const clientId = target.dataset.client;
      askConfirm({
        title: t("confirmDeleteClient"),
        message: t("confirmDeleteClientMsg"),
        confirmLabel: t("delete"),
        danger: true,
        run: async () => {
          try {
            const res = await api(`/api/clients/${encodeURIComponent(clientId)}`, { method: "DELETE" });
            applyPayload(res);
            if (!res?.state) await refreshState({ silent: true });
            closeModal();
            showToast(t("saved"));
          } catch (err) {
            showError("", err);
          }
        },
      });
      return;
    }

    /* ---------- Activity ---------- */
    case "open-job": {
      const jobId = target.dataset.job;
      if (!jobId) return;
      ui.jobDetail = null;
      ui.jobError = "";
      openModal({ type: "job", jobId });
      void refreshJobDetail();
      return;
    }
    case "stop-job": {
      event.stopPropagation();
      const jobId = target.dataset.job;
      try {
        await api("/api/session-action", { method: "POST", body: { action: "interrupt", jobId } });
        showToast(t("jobStopped"));
        await refreshState({ silent: true });
        if (ui.modal?.type === "job") void refreshJobDetail({ silent: true });
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "dismiss-interrupted": {
      const jobId = target.dataset.job;
      try {
        const res = await api("/api/dismiss-interrupted", { method: "POST", body: jobId ? { jobId } : {} });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
      } catch (err) {
        showError("", err);
      }
      return;
    }

    /* ---------- Roles ---------- */
    case "toggle-master":
      void saveSettings({ enabled: !state?.settings?.enabled });
      return;
    case "open-picker": {
      const role = target.dataset.role;
      const index = Number(target.dataset.index);
      const same = ui.picker && ui.picker.role === role && ui.picker.index === index;
      ui.picker = same ? null : { role, index, search: "" };
      scheduleRender();
      return;
    }
    case "pick-model": {
      const role = target.dataset.role;
      const index = Number(target.dataset.index);
      const modelId = target.dataset.model;
      const queue = roleQueue(role);
      ui.picker = null;
      if (index === 0) {
        void saveSettings({ roles: { [role]: { modelId } } });
        return;
      }
      const next = [...queue];
      if (index < next.length) next[index] = modelId;
      else next.push(modelId);
      const deduped = [...new Set(next)];
      void saveSettings({ roles: { [role]: { queue: deduped } } });
      return;
    }
    case "promote-model": {
      const role = target.dataset.role;
      const modelId = target.dataset.model;
      ui.picker = null;
      void saveSettings({ roles: { [role]: { modelId } } });
      return;
    }
    case "remove-model": {
      const role = target.dataset.role;
      const modelId = target.dataset.model;
      const next = roleQueue(role).filter((id) => id !== modelId);
      if (!next.length) return;
      void saveSettings({ roles: { [role]: { queue: next } } });
      return;
    }
    case "toggle-smart": {
      const role = target.dataset.role;
      const current = state?.settings?.roles?.[role]?.selectionMode === "smart";
      void saveSettings({ roles: { [role]: { selectionMode: current ? "ordered" : "smart" } } });
      return;
    }
    case "set-effort": {
      const role = target.dataset.role;
      const effort = target.dataset.effort;
      void saveSettings({ roles: { [role]: { effort } } });
      return;
    }
    case "toggle-rules": {
      const role = target.dataset.role;
      ui.rulesOpen[role] = !ui.rulesOpen[role];
      scheduleRender();
      return;
    }
    case "save-rules": {
      const role = target.dataset.role;
      const draft = ui.rulesDraft[role] ?? state?.settings?.roles?.[role]?.customRules ?? "";
      ui.rulesSaving = true;
      saveSettings({ roles: { [role]: { customRules: draft } } }).then((ok) => {
        ui.rulesSaving = false;
        if (ok) {
          delete ui.rulesDraft[role];
          showToast(t("saved"));
        }
        scheduleRender();
      });
      return;
    }
    case "session-action": {
      const act = target.dataset.act;
      const sessionId = target.dataset.session;
      try {
        const res = await api("/api/session-action", { method: "POST", body: { action: act, sessionId } });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
        showToast(act === "reset" ? t("sessionReset") : t("saved"));
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "clear-cooldown": {
      const modelId = target.dataset.model;
      try {
        const res = await api("/api/session-action", { method: "POST", body: { action: "clear_cooldown", modelId } });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
        showToast(t("cooldownCleared"));
      } catch (err) {
        showError("", err);
      }
      return;
    }

    /* ---------- Providers ---------- */
    case "refresh-detect": {
      ui.detecting = true;
      scheduleRender();
      try {
        await refreshState({ forceDetect: true, fetchRateLimits: true, silent: true });
        showToast(t("saved"));
      } finally {
        ui.detecting = false;
        scheduleRender();
      }
      return;
    }
    case "refresh-quota": {
      try {
        await refreshState({ forceDetect: false, fetchRateLimits: true, silent: true });
        showToast(t("saved"));
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "test-cli": {
      const eid = target.dataset.engine;
      ui.channelTest = { key: `cli:${eid}`, loading: true, ok: false, error: "" };
      scheduleRender();
      try {
        const res = await api("/api/test-connection", { method: "POST", body: { mode: "cli", engine: eid } });
        ui.channelTest = { key: `cli:${eid}`, loading: false, ok: Boolean(res?.ok), error: res?.error || "" };
      } catch (err) {
        ui.channelTest = { key: `cli:${eid}`, loading: false, ok: false, error: err?.message || "" };
      }
      scheduleRender();
      return;
    }
    case "test-channel": {
      const channelId = target.dataset.channel;
      const channel = (state?.settings?.channels || []).find((c) => c.id === channelId);
      if (!channel) return;
      ui.channelTest = { key: `channel:${channelId}`, loading: true, ok: false, error: "" };
      scheduleRender();
      try {
        const res = await api("/api/test-connection", {
          method: "POST",
          body: { mode: "api", baseUrl: channel.baseUrl, channelId, modelId: channel.models?.[0]?.id },
        });
        ui.channelTest = { key: `channel:${channelId}`, loading: false, ok: Boolean(res?.ok), error: res?.error || "" };
      } catch (err) {
        ui.channelTest = { key: `channel:${channelId}`, loading: false, ok: false, error: err?.message || "" };
      }
      scheduleRender();
      return;
    }
    case "open-channel":
      openChannelForm(null);
      return;
    case "edit-channel": {
      const channel = (state?.settings?.channels || []).find((c) => c.id === target.dataset.channel);
      if (channel) openChannelForm(channel);
      return;
    }
    case "delete-channel": {
      const channelId = target.dataset.channel;
      askConfirm({
        title: t("confirmDeleteChannel"),
        message: t("confirmDeleteChannelMsg"),
        confirmLabel: t("delete"),
        danger: true,
        run: async () => {
          try {
            const res = await api(`/api/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
            applyPayload(res);
            if (!res?.state) await refreshState({ silent: true });
            closeModal();
            showToast(t("channelDeleted"));
          } catch (err) {
            showError("", err);
          }
        },
      });
      return;
    }
    case "remove-channel-model": {
      const channelId = target.dataset.channel;
      const modelId = target.dataset.model;
      try {
        const res = await api(`/api/channels/${encodeURIComponent(channelId)}/remove-model`, {
          method: "POST",
          body: { modelId },
        });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
        showToast(t("modelRemoved"));
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "toggle-channel-model": {
      const modelId = target.dataset.model;
      const form = ui.channelForm;
      if (!form) return;
      const selected = new Set(form.selectedModels || []);
      if (selected.has(modelId)) selected.delete(modelId);
      else selected.add(modelId);
      form.selectedModels = [...selected];
      scheduleRender();
      return;
    }
    case "clear-channel-models":
      if (ui.channelForm) ui.channelForm.selectedModels = [];
      scheduleRender();
      return;
    case "add-manual-model": {
      const form = ui.channelForm;
      if (!form) return;
      const input = document.querySelector('[data-channel-field="manualModel"]');
      const name = input ? input.value.trim() : "";
      if (!name) return;
      const available = [...(form.availableModels || [])];
      if (!available.some((m) => m.id === name)) available.push({ id: name });
      form.availableModels = available;
      form.selectedModels = [...new Set([...(form.selectedModels || []), name])];
      form.manualModel = "";
      if (input) input.value = "";
      scheduleRender();
      return;
    }
    case "fetch-channel-models": {
      const form = ui.channelForm;
      if (!form) return;
      syncChannelForm();
      ui.channelFetchError = "";
      const baseUrl = String(form.baseUrl || "").trim();
      if (!baseUrl) {
        ui.channelFetchError = t("missingBaseUrl");
        scheduleRender();
        return;
      }
      form.fetching = true;
      scheduleRender();
      try {
        const res = await api("/api/fetch-models", {
          method: "POST",
          body: { baseUrl, apiKey: form.apiKey || "", channelId: form.id || undefined },
        });
        if (res?.ok && Array.isArray(res.models)) {
          const merged = new Map((form.availableModels || []).map((m) => [m.id, m]));
          for (const m of res.models) {
            const id = typeof m === "string" ? m : m.id || m.modelName || m.name;
            if (id) merged.set(id, { id });
          }
          form.availableModels = [...merged.values()];
          form.selectedModels = [...new Set([...(form.selectedModels || []), ...res.models.map((m) => (typeof m === "string" ? m : m.id || m.modelName || m.name)).filter(Boolean)])];
        } else {
          ui.channelFetchError = `${t("fetchFailed")}${res?.error ? `: ${res.error}` : ""}`;
        }
      } catch (err) {
        ui.channelFetchError = `${t("fetchFailed")}: ${err?.message || ""}`;
      } finally {
        form.fetching = false;
        scheduleRender();
      }
      return;
    }
    case "test-channel-form": {
      const form = ui.channelForm;
      if (!form) return;
      syncChannelForm();
      const baseUrl = String(form.baseUrl || "").trim();
      const apiKey = String(form.apiKey || "").trim();
      if (!baseUrl) {
        form.error = t("missingBaseUrl");
        scheduleRender();
        return;
      }
      if (/^https?:\/\//i.test(apiKey)) {
        form.error = t("keyLooksLikeUrl");
        scheduleRender();
        return;
      }
      form.error = "";
      form.testResult = null;
      form.testing = true;
      scheduleRender();
      try {
        const res = await api("/api/test-connection", {
          method: "POST",
          body: { mode: "api", baseUrl, apiKey, channelId: form.id || undefined, modelId: form.selectedModels?.[0] },
        });
        form.testResult = { ok: Boolean(res?.ok), error: res?.error || "" };
      } catch (err) {
        form.testResult = { ok: false, error: err?.message || "" };
      } finally {
        form.testing = false;
        scheduleRender();
      }
      return;
    }
    case "save-channel": {
      const form = ui.channelForm;
      if (!form) return;
      syncChannelForm();
      const baseUrl = String(form.baseUrl || "").trim();
      const apiKey = String(form.apiKey || "").trim();
      const modelNames = [...new Set(form.selectedModels || [])];
      if (!baseUrl) {
        form.error = t("missingBaseUrl");
        scheduleRender();
        return;
      }
      if (!form.id && !apiKey) {
        form.error = t("missingKey");
        scheduleRender();
        return;
      }
      if (!modelNames.length) {
        form.error = t("noModelsSelected");
        scheduleRender();
        return;
      }
      form.error = "";
      ui.channelSaving = true;
      scheduleRender();
      try {
        const res = await api("/api/channels", {
          method: "POST",
          body: {
            id: form.id || undefined,
            name: form.name || "",
            providerId: form.providerId || "custom",
            baseUrl,
            apiKey: apiKey || undefined,
            modelNames,
          },
        });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
        ui.channelSaving = false;
        closeModal();
        showToast(t("channelSaved"));
      } catch (err) {
        ui.channelSaving = false;
        form.error = err?.message || t("saveFailed");
        scheduleRender();
      }
      return;
    }

    /* ---------- Observability / Settings ---------- */
    case "diag-export": {
      if (ui.diagExporting) return;
      ui.diagExporting = true;
      ui.diagExportError = "";
      scheduleRender();
      try {
        const res = await api("/api/diagnostics/export", { method: "POST", body: { reveal: true } });
        ui.diagExportResult = res;
        showToast(`${t("diagExportDone")} · ${res.fileName || "—"}`);
      } catch (err) {
        ui.diagExportResult = null;
        ui.diagExportError = err?.message || String(err);
        showError(t("diagFailed"), err);
      } finally {
        ui.diagExporting = false;
        scheduleRender();
      }
      return;
    }
    case "diag-open-logs": {
      try {
        await api("/api/diagnostics/open-logs", { method: "POST", body: { subdir: "root" } });
        showToast(t("diagOpenOk"));
      } catch (err) {
        showError("", err);
      }
      return;
    }
    case "clear-logs": {
      askConfirm({
        title: t("confirmClearLogs"),
        message: t("confirmClearLogsMsg"),
        confirmLabel: t("clearLogs"),
        danger: true,
        run: async () => {
          try {
            const res = await api("/api/clear-logs", { method: "POST", body: {} });
            applyPayload(res);
            if (!res?.state) await refreshState({ silent: true });
            closeModal();
            showToast(t("logsCleared"));
          } catch (err) {
            showError("", err);
          }
        },
      });
      return;
    }
    case "toggle-bool": {
      const key = target.dataset.key;
      if (!key) return;
      void saveSettings({ [key]: !state?.settings?.[key] });
      return;
    }
    case "set-number": {
      const key = target.dataset.key;
      const value = Number(target.dataset.value);
      if (!key || !Number.isFinite(value)) return;
      void saveSettings({ [key]: value });
      return;
    }
    case "toggle-inspector": {
      const models = apiModels();
      const enabled = Boolean(state?.settings?.inspectorEnabled && state?.settings?.inspectorModelId);
      if (enabled) {
        void saveSettings({ inspectorEnabled: false });
        return;
      }
      if (!models.length) {
        showToast(t("inspectorNeedModel"), "error");
        return;
      }
      const keep = models.some((m) => m.id === state?.settings?.inspectorModelId);
      void saveSettings({
        inspectorEnabled: true,
        inspectorModelId: keep ? state.settings.inspectorModelId : models[0].id,
      });
      return;
    }
    case "confirm-run": {
      const modal = ui.modal;
      const run = modal?.run;
      closeModal();
      if (typeof run === "function") {
        Promise.resolve()
          .then(run)
          .catch((err) => showError("", err));
      }
      return;
    }
    default:
      return;
  }
}

function syncChannelForm() {
  const form = ui.channelForm;
  if (!form) return;
  for (const field of ["name", "baseUrl", "apiKey", "manualModel"]) {
    const el = document.querySelector(`[data-channel-field="${field}"]`);
    if (el) form[field] = el.value;
  }
}

function openChannelForm(channel) {
  const names = channel ? [...new Set((channel.models || []).map((m) => m.modelName).filter(Boolean))] : [];
  const preset = (state?.providers || []).find((p) => p.id === "deepseek") || (state?.providers || [])[0];
  ui.channelFetchError = "";
  ui.channelForm = {
    id: channel?.id || "",
    name: channel?.name || "",
    providerId: channel?.providerId || preset?.id || "custom",
    baseUrl: channel?.baseUrl || preset?.baseUrl || "",
    apiKey: "",
    hasApiKey: Boolean(channel?.hasApiKey),
    availableModels: names.map((id) => ({ id })),
    selectedModels: names,
    manualModel: "",
    search: "",
    fetching: false,
    testing: false,
    testResult: null,
    error: "",
  };
  openModal({ type: "channel" });
}

function onInput(event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  if (el.dataset.extField) {
    getExtensionsView().handleInput(el);
    return;
  }
  if (el.dataset.ui === "client-search") {
    ui.clientSearch = el.value;
    scheduleRender();
    return;
  }
  if (el.dataset.ui === "register-name") {
    // Tracked in ui (not just the DOM) so an SSE-driven re-render never drops it.
    ui.registerName = el.value;
    return;
  }
  if (el.dataset.ui === "picker-search" && ui.picker) {
    ui.picker.search = el.value;
    scheduleRender();
    return;
  }
  if (el.dataset.channelSearch) {
    if (ui.channelForm) ui.channelForm.search = el.value;
    scheduleRender();
    return;
  }
  if (el.dataset.rulesRole) {
    ui.rulesDraft[el.dataset.rulesRole] = el.value;
    return;
  }
  if (el.dataset.clientName) {
    if (ui.modal?.type === "client") ui.modal.nameDraft = el.value;
    return;
  }
  if (el.dataset.channelField) {
    if (ui.channelForm) ui.channelForm[el.dataset.channelField] = el.value;
    return;
  }
}

function onChange(event) {
  const el = event.target;
  if (!el || !el.dataset) return;
  if (el.dataset.numberKey) {
    const key = el.dataset.numberKey;
    const min = Number(el.min);
    const max = Number(el.max);
    let value = el.valueAsNumber;
    if (!Number.isFinite(value)) {
      el.value = state?.settings?.[key] ?? "";
      return;
    }
    value = Math.max(min, Math.min(max, Math.round(value)));
    el.value = value;
    void saveSettings({ [key]: value });
    return;
  }
  if (el.dataset.inspectorModel) {
    void saveSettings({ inspectorModelId: el.value, inspectorEnabled: true });
    return;
  }
  if (el.dataset.channelField === "providerId" && ui.channelForm) {
    const provider = (state?.providers || []).find((p) => p.id === el.value);
    ui.channelForm.providerId = el.value;
    if (provider?.baseUrl) ui.channelForm.baseUrl = provider.baseUrl;
    scheduleRender();
  }
}

function onKeydown(event) {
  if (event.key === "Escape") {
    if (ui.modal) {
      closeModal();
      return;
    }
    if (ui.picker) {
      ui.picker = null;
      scheduleRender();
      return;
    }
  }
  if (event.key === "Enter" && event.target?.dataset?.numberKey) {
    event.preventDefault();
    event.target.blur();
    return;
  }
  if (event.key === "Enter" && event.target?.dataset?.channelField === "manualModel") {
    event.preventDefault();
    document.querySelector('[data-action="add-manual-model"]')?.click();
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target?.dataset?.action === "open-client") {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (event.key === "Enter" && event.target?.dataset?.action === "open-job") {
    event.preventDefault();
    event.target.click();
  }
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    onActionClick(event).catch((err) => showError("", err));
  });
  document.addEventListener("input", onInput);
  document.addEventListener("change", onChange);
  document.addEventListener("keydown", onKeydown);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    refreshState({ silent: true });
  });

  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq && typeof mq.addEventListener === "function") {
      mq.addEventListener("change", () => {
        if (ui.theme === "system") applyTheme();
      });
    }
  } catch {
    /* ignore */
  }

  window.addEventListener("error", (event) => {
    if (event?.error?.message) ui.fatal = `${t("fatalTitle")}: ${event.error.message}`;
  });
  window.addEventListener("unhandledrejection", (event) => {
    const message = event?.reason?.message || String(event?.reason || "");
    if (message) showToast(message, "error");
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */
function loadPreferences() {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme === "light" || theme === "dark" || theme === "system") ui.theme = theme;
  } catch {
    /* ignore */
  }
  try {
    ui.sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    /* ignore */
  }
}

async function boot() {
  if (booted) return;
  booted = true;
  loadPreferences();
  applyTheme();
  uiToken = readUiToken();
  bindEvents();

  // Paint the shell immediately so the window never shows a blank canvas.
  scheduleRender();

  if (!uiToken) {
    // No token: still try /api/state — the daemon may allow loopback requests
    // without auth in local development.
    await refreshState({ silent: true });
    connectEvents();
    return;
  }

  await refreshState({ silent: true });
  connectEvents();
  startPolling();
  watchSseStaleness();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    boot().catch((err) => {
      ui.fatal = `${t("fatalTitle")}: ${err?.message || String(err)}`;
      scheduleRender();
    });
  });
} else {
  boot().catch((err) => {
    ui.fatal = `${t("fatalTitle")}: ${err?.message || String(err)}`;
    scheduleRender();
  });
}
