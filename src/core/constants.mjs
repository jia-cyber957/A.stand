export const PLUGIN_VERSION = "1.0.0";

export const CODEX_BROKEN_GUI_PLUGINS = [
  "browser@openai-bundled",
  "chrome@openai-bundled",
  "computer-use@openai-bundled",
  "unified-computer-use@openai-bundled",
  "codex-app-tools@openai-bundled",
];

export const CODEX_OFFICE_PLUGINS = [
  "visualize@openai-bundled",
  "documents@openai-primary-runtime",
  "pdf@openai-primary-runtime",
  "spreadsheets@openai-primary-runtime",
  "presentations@openai-primary-runtime",
  "template-creator@openai-primary-runtime",
];

export const API_PROVIDERS = [
  {
    id: "deepseek",
    nameZh: "深度求索 DeepSeek",
    nameEn: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    placeholderModel: "deepseek-reasoner",
    badge: "DS",
  },
  {
    id: "openai",
    nameZh: "OpenAI API",
    nameEn: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    placeholderModel: "gpt-5.4",
    badge: "OA",
  },
  {
    id: "gemini",
    nameZh: "谷歌 Gemini",
    nameEn: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    placeholderModel: "gemini-4-pro",
    badge: "GM",
  },
  {
    id: "minimax",
    nameZh: "MiniMax",
    nameEn: "MiniMax",
    baseUrl: "https://api.minimax.io/v1",
    placeholderModel: "MiniMax-M2.5",
    badge: "MM",
  },
  {
    id: "moonshot",
    nameZh: "Moonshot Kimi",
    nameEn: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    placeholderModel: "kimi-k2.5",
    badge: "KM",
  },
  {
    id: "zhipu",
    nameZh: "智谱 GLM",
    nameEn: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    placeholderModel: "glm-5",
    badge: "ZP",
  },
  {
    id: "openrouter",
    nameZh: "OpenRouter 聚合",
    nameEn: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    placeholderModel: "deepseek/deepseek-r1",
    badge: "OR",
  },
  {
    id: "together",
    nameZh: "Together AI",
    nameEn: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    placeholderModel: "deepseek-ai/DeepSeek-R1",
    badge: "TG",
  },
  {
    id: "custom",
    nameZh: "自定义 (OpenAI 兼容)",
    nameEn: "Custom (OpenAI Compatible)",
    baseUrl: "",
    placeholderModel: "model-name",
    badge: "API",
  },
];

export const CLI_ENGINES_META = {
  codex: {
    id: "codex",
    labelZh: "OpenAI · Codex CLI",
    labelEn: "OpenAI · Codex CLI",
    shortTag: "Codex",
    downloadUrl: "https://github.com/openai/codex",
    installCmd: "npm install -g @openai/codex",
    loginCmd: "codex login",
    // Neutral mainstream fallback only; live Codex auto-discovers real models via `model/list`.
    placeholderModel: "gpt-5-codex",
  },
  "claude-code": {
    id: "claude-code",
    labelZh: "Anthropic · Claude Code",
    labelEn: "Anthropic · Claude Code",
    shortTag: "Claude",
    downloadUrl: "https://docs.anthropic.com/en/docs/claude-code",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    loginCmd: "claude",
    placeholderModel: "claude-opus-4-6",
  },
  antigravity: {
    id: "antigravity",
    labelZh: "Google · Antigravity CLI",
    labelEn: "Google · Antigravity CLI",
    shortTag: "AGY",
    downloadUrl: "https://antigravity.google/docs/getting-started",
    installCmd: "agy --version",
    loginCmd: "agy",
    placeholderModel: "",
  },
  "deepseek-harness": {
    id: "deepseek-harness",
    labelZh: "DeepSeek Harness (dsh)",
    labelEn: "DeepSeek Harness (dsh)",
    shortTag: "DSH",
    downloadUrl: "https://github.com/deepseek-ai/deepseek-harness",
    installCmd: "npm install -g @deepseek-ai/dsh@latest",
    loginCmd: "dsh --profile acp",
    placeholderModel: "deepseek-reasoner",
  },
};

export const CLI_DEFAULT_MODELS_MAP = {
  "claude-code": [
    {
      id: "cli-claude-default",
      modelName: "",
      displayName: "Claude (CLI Default)",
      displayNameZh: "Claude（CLI 默认）",
      isDefault: true,
      engine: "claude-code",
    },
    {
      id: "cli:claude-code:claude-opus-4-6",
      modelName: "claude-opus-4-6",
      displayName: "claude-opus-4-6",
      isDefault: false,
      engine: "claude-code",
    },
    {
      id: "cli:claude-code:claude-sonnet-4-6",
      modelName: "claude-sonnet-4-6",
      displayName: "claude-sonnet-4-6",
      isDefault: false,
      engine: "claude-code",
    },
    {
      id: "cli:claude-code:claude-haiku-4-5",
      modelName: "claude-haiku-4-5",
      displayName: "claude-haiku-4-5",
      isDefault: false,
      engine: "claude-code",
    },
  ],
  antigravity: [
    {
      id: "cli-agy-default",
      modelName: "",
      displayName: "Gemini (CLI Default)",
      displayNameZh: "Gemini（CLI 默认）",
      isDefault: true,
      engine: "antigravity",
    },
    {
      id: "cli:antigravity:gemini-4-pro",
      modelName: "gemini-4-pro",
      displayName: "gemini-4-pro",
      isDefault: false,
      engine: "antigravity",
    },
    {
      id: "cli:antigravity:gemini-4-flash",
      modelName: "gemini-4-flash",
      displayName: "gemini-4-flash",
      isDefault: false,
      engine: "antigravity",
    },
  ],
};

export const DEFAULT_MODELS = [
  {
    id: "cli-codex-default",
    name: "GPT (Codex)",
    mode: "cli",
    engine: "codex",
    modelName: "",
    providerId: "openai",
    baseUrl: "",
    builtin: true,
  },
  {
    id: "cli-claude-default",
    name: "Claude (Claude Code)",
    mode: "cli",
    engine: "claude-code",
    modelName: "",
    providerId: "anthropic",
    baseUrl: "",
    builtin: true,
  },
  {
    id: "cli-agy-default",
    name: "Gemini (Antigravity CLI)",
    mode: "cli",
    engine: "antigravity",
    modelName: "",
    providerId: "google",
    baseUrl: "",
    builtin: true,
  },
];

export const ROLE_SPECS = {
  oracle: {
    id: "oracle",
    sandbox: "read-only",
    developerInstructions: [
      "You are Oracle, a persistent read-only senior architectural advisor and independent code reviewer working under a lead agent.",
      "Rules:",
      "1. Never attempt to modify files or make destructive changes; focus strictly on diagnosis, root-cause analysis, tradeoffs, and rigorous code review.",
      "2. Keep every reply concise, high-signal, and structured: Verdict -> Key Findings / Root Cause (with file:line) -> Actionable Recommendations -> Open Risks.",
      "3. On follow-up turns, leverage your existing conversation history directly instead of re-reading unchanged files unnecessarily.",
    ].join("\n"),
  },
  hephaestus: {
    id: "hephaestus",
    sandbox: "workspace-write",
    developerInstructions: [
      "You are Hephaestus, a persistent autonomous senior software engineer working under a lead agent.",
      "Rules:",
      "1. Implement complex multi-file changes, refactors, algorithms, and debugging loops end-to-end inside the assigned workspace.",
      "2. Verify your changes by running targeted tests/checks before returning.",
      "3. Return a compact handoff summary: Summary -> Files Modified -> Verification Results -> Remaining Risks. Avoid dumping huge raw logs back to the lead agent.",
      "4. On follow-up turns, build directly on your existing thread context without redundantly re-reading untouched files.",
      "5. When the lead agent provides a concrete plan or specification, implement directly without re-running brainstorming or redundant planning ceremonies.",
    ].join("\n"),
  },
};
