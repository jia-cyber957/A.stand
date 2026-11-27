import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { maskSecret } from "./store.mjs";

/**
 * Built-in upstream MCP client presets.
 * `patterns` are matched case-insensitively as substrings of the MCP `clientInfo.name`
 * reported during the `initialize` handshake, so an upstream AI can be identified on Turn 1.
 */
export const CLIENT_PRESETS = [
  {
    key: "antigravity",
    label: "Antigravity",
    color: "#4f46e5",
    patterns: ["antigravity", "agy", "google-antigravity"],
    antiRecursionEngines: ["antigravity"],
  },
  {
    key: "codex",
    label: "Codex CLI",
    color: "#10a37f",
    patterns: ["codex", "openai-codex"],
    antiRecursionEngines: ["codex"],
  },
  {
    key: "claude-code",
    label: "Claude Code",
    color: "#d97757",
    patterns: ["claude", "claude-code", "anthropic"],
    antiRecursionEngines: ["claude-code"],
  },
  {
    key: "cursor",
    label: "Cursor",
    color: "#111827",
    patterns: ["cursor"],
    antiRecursionEngines: [],
  },
  {
    key: "workbuddy",
    label: "WorkBuddy",
    color: "#0ea5e9",
    patterns: ["workbuddy", "codebuddy", "tencent"],
    antiRecursionEngines: [],
  },
  {
    key: "windsurf",
    label: "Windsurf",
    color: "#06b6d4",
    patterns: ["windsurf", "codeium"],
    antiRecursionEngines: [],
  },
  {
    key: "vscode",
    label: "VS Code / Cline",
    color: "#007acc",
    patterns: ["vscode", "visual studio code", "cline", "roo"],
    antiRecursionEngines: [],
  },
  {
    key: "generic",
    label: "MCP Client",
    color: "#64748b",
    patterns: [],
    antiRecursionEngines: [],
  },
];

const GENERIC_PRESET = CLIENT_PRESETS[CLIENT_PRESETS.length - 1];
const TOKEN_PREFIX = "ast_";

export function newClientToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(16).toString("hex")}`;
}

export function newClientId() {
  return `cli_${crypto.randomBytes(6).toString("hex")}`;
}

export function matchClientPreset(name) {
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return null;
  for (const preset of CLIENT_PRESETS) {
    if (preset.key === "generic") continue;
    if (preset.patterns.some((pattern) => needle.includes(pattern))) return preset;
  }
  return null;
}

export function presetByKey(key) {
  return CLIENT_PRESETS.find((preset) => preset.key === key) || null;
}

function atomicWriteJson(filePath, data, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", {
    encoding: "utf8",
    ...(mode ? { mode } : {}),
  });
  fs.renameSync(tmp, filePath);
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

// Constant-time string comparison via fixed-length digests (length-independent).
function timingSafeEqualString(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export class ClientRegistry {
  constructor(store, dataDir) {
    if (!store) throw new Error("ClientRegistry requires a RelayStore");
    this.store = store;
    this.dataDir = path.resolve(dataDir || store.dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.clientsPath = path.join(this.dataDir, "clients.json");
    this.listeners = new Set();
    if (!store.secrets.clientTokens || typeof store.secrets.clientTokens !== "object") {
      store.secrets.clientTokens = {};
    }
    this.clients = this.#loadClients();
  }

  #loadClients() {
    const raw = safeReadJson(this.clientsPath, { clients: [] });
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.clients) ? raw.clients : [];
    const tokens = this.store.secrets.clientTokens;
    const out = [];
    const seen = new Set();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || seen.has(id) || !/^[A-Za-z0-9_-]{3,64}$/.test(id)) continue;
      seen.add(id);
      const preset = presetByKey(item.iconKey);
      out.push({
        id,
        label: cleanText(item.label, 80) || preset?.label || GENERIC_PRESET.label,
        customName: cleanText(item.customName, 80),
        iconKey: preset ? preset.key : "generic",
        customIconKey: cleanText(item.customIconKey, 40),
        enabled: item.enabled !== false,
        status: ["waiting", "connected", "paused"].includes(item.status) ? item.status : "waiting",
        transport: item.transport === "http" || item.transport === "stdio-bridge" ? item.transport : null,
        detectedClientName: cleanText(item.detectedClientName, 120),
        detectedClientVersion: cleanText(item.detectedClientVersion, 80),
        antiRecursionEngines: Array.isArray(item.antiRecursionEngines)
          ? item.antiRecursionEngines.map((x) => String(x)).filter(Boolean)
          : [],
        note: cleanText(item.note, 400),
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        firstSeenAt: typeof item.firstSeenAt === "string" ? item.firstSeenAt : "",
        lastSeenAt: typeof item.lastSeenAt === "string" ? item.lastSeenAt : "",
        totalCalls: Number.isFinite(Number(item.totalCalls)) ? Math.max(0, Math.trunc(Number(item.totalCalls))) : 0,
      });
    }
    // Heal token/client drift: tokens without a client slot are unreachable, drop them.
    let secretsDirty = false;
    const validIds = new Set(out.map((c) => c.id));
    for (const id of Object.keys(tokens)) {
      if (!validIds.has(id)) {
        delete tokens[id];
        secretsDirty = true;
      }
    }
    for (const client of out) {
      if (typeof tokens[client.id] !== "string" || !tokens[client.id]) {
        tokens[client.id] = newClientToken();
        secretsDirty = true;
      }
    }
    if (secretsDirty) this.store.saveSecrets();
    return out;
  }

  #persist() {
    atomicWriteJson(this.clientsPath, { version: 1, clients: this.clients });
  }

  #notify(reason, clientId) {
    for (const fn of this.listeners) {
      try {
        fn({ reason, clientId, ts: Date.now() });
      } catch {}
    }
  }

  subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #record(clientId) {
    return this.clients.find((c) => c.id === clientId) || null;
  }

  #token(clientId) {
    const tokens = this.store.secrets.clientTokens || {};
    return typeof tokens[clientId] === "string" ? tokens[clientId] : "";
  }

  #public(client) {
    if (!client) return null;
    return {
      id: client.id,
      label: client.label,
      customName: client.customName,
      iconKey: client.iconKey,
      customIconKey: client.customIconKey,
      enabled: client.enabled,
      status: client.status,
      transport: client.transport,
      detectedClientName: client.detectedClientName,
      detectedClientVersion: client.detectedClientVersion,
      antiRecursionEngines: [...client.antiRecursionEngines],
      maskedToken: maskSecret(this.#token(client.id)),
      createdAt: client.createdAt,
      firstSeenAt: client.firstSeenAt,
      lastSeenAt: client.lastSeenAt,
      totalCalls: client.totalCalls,
    };
  }

  listPublic() {
    return [...this.clients]
      .sort((a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id)
      )
      .map((client) => this.#public(client));
  }

  getPublic(clientId) {
    return this.#public(this.#record(clientId));
  }

  create({ label, iconKey, note } = {}) {
    const preset = presetByKey(iconKey);
    const now = new Date().toISOString();
    const client = {
      id: newClientId(),
      label: cleanText(label, 80) || preset?.label || GENERIC_PRESET.label,
      customName: "",
      iconKey: preset ? preset.key : "generic",
      customIconKey: "",
      enabled: true,
      status: "waiting",
      transport: null,
      detectedClientName: "",
      detectedClientVersion: "",
      antiRecursionEngines: [...(preset?.antiRecursionEngines || [])],
      note: cleanText(note, 400),
      createdAt: now,
      firstSeenAt: "",
      lastSeenAt: "",
      totalCalls: 0,
    };
    const token = newClientToken();
    this.clients.push(client);
    this.store.secrets.clientTokens[client.id] = token;
    this.#persist();
    this.store.saveSecrets();
    this.#notify("client_created", client.id);
    return { client: this.#public(client), token };
  }

  authenticate(token) {
    const provided = typeof token === "string" ? token.trim() : "";
    if (!provided) return { ok: false, status: 401, error: "Missing A.stand client token" };
    const tokens = this.store.secrets.clientTokens || {};
    let matchedId = "";
    for (const [clientId, stored] of Object.entries(tokens)) {
      if (typeof stored !== "string" || !stored) continue;
      if (timingSafeEqualString(provided, stored) && !matchedId) matchedId = clientId;
    }
    if (!matchedId) return { ok: false, status: 401, error: "Invalid A.stand client token" };
    const client = this.#record(matchedId);
    if (!client) return { ok: false, status: 401, error: "Unknown A.stand client" };
    if (client.enabled === false) {
      return { ok: false, status: 403, error: "This A.stand client slot is paused" };
    }
    return { ok: true, client: this.#public(client) };
  }

  recordHandshake(clientId, { name, version, transport } = {}) {
    const client = this.#record(clientId);
    if (!client) return null;
    const now = new Date().toISOString();
    const detectedName = cleanText(name, 120);
    const preset = matchClientPreset(detectedName);
    if (preset) {
      client.iconKey = preset.key;
      client.label = preset.label;
      client.antiRecursionEngines = [...preset.antiRecursionEngines];
    }
    // Never clobber a richer earlier handshake (e.g. the initialize-body fallback) with empty info:
    // some clients send `initialized` without the SDK retaining getClientVersion().
    if (detectedName) client.detectedClientName = detectedName;
    const detectedVersion = cleanText(version, 80);
    if (detectedVersion) client.detectedClientVersion = detectedVersion;
    if (transport === "http" || transport === "stdio-bridge") client.transport = transport;
    client.status = client.enabled === false ? "paused" : "connected";
    if (!client.firstSeenAt) client.firstSeenAt = now;
    client.lastSeenAt = now;
    this.#persist();
    this.#notify("client_connected", client.id);
    return this.#public(client);
  }

  recordCall(clientId, transport) {
    const client = this.#record(clientId);
    if (!client) return null;
    client.totalCalls += 1;
    client.lastSeenAt = new Date().toISOString();
    if (transport === "http" || transport === "stdio-bridge") client.transport = transport;
    this.#persist();
    this.#notify("client_call", client.id);
    return this.#public(client);
  }

  update(clientId, { customName, customIconKey, enabled, regenerateToken } = {}) {
    const client = this.#record(clientId);
    if (!client) return null;
    if (customName !== undefined) client.customName = cleanText(customName, 80);
    if (customIconKey !== undefined) client.customIconKey = cleanText(customIconKey, 40);
    if (typeof enabled === "boolean") {
      client.enabled = enabled;
      client.status = enabled ? (client.firstSeenAt ? "connected" : "waiting") : "paused";
    }
    let token = "";
    if (regenerateToken) {
      token = newClientToken();
      this.store.secrets.clientTokens[client.id] = token;
      this.store.saveSecrets();
    }
    this.#persist();
    this.#notify("client_updated", client.id);
    return { client: this.#public(client), ...(token ? { token } : {}) };
  }

  delete(clientId) {
    const idx = this.clients.findIndex((c) => c.id === clientId);
    if (idx < 0) return false;
    this.clients.splice(idx, 1);
    if (this.store.secrets.clientTokens && Object.hasOwn(this.store.secrets.clientTokens, clientId)) {
      delete this.store.secrets.clientTokens[clientId];
      this.store.saveSecrets();
    }
    this.#persist();
    this.#notify("client_deleted", clientId);
    return true;
  }

  buildSetupBundle(clientId, { httpUrl, bridgeScript, rulesFile } = {}) {
    const client = this.#record(clientId);
    if (!client) return null;
    const token = this.#token(clientId);
    const url = cleanText(httpUrl, 400) || "http://127.0.0.1:3426/mcp";
    const bridge = bridgeScript || path.join(process.cwd(), "dist", "stdio-bridge.mjs");
    const rules = rulesFile || path.join(process.cwd(), "plugin", "rules", "AGENTS.md");
    const customSlot = client.customName;
    const stdioCommand = `node "${bridge}" --url "${url}" --token "${token}"`;

    const httpConfig = {
      mcpServers: {
        "a-stand": {
          type: "streamableHttp",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-Astand-Token": token,
          },
        },
      },
    };
    const stdioConfig = {
      mcpServers: {
        "a-stand": {
          command: "node",
          args: [bridge, "--url", url, "--token", token],
        },
      },
    };
    const httpConfigJson = JSON.stringify(httpConfig, null, 2);
    const stdioBridgeConfigJson = JSON.stringify(stdioConfig, null, 2);

    const promptZh = [
      `请把 A.stand 常驻代理接入当前 MCP 客户端${customSlot ? `（客户端槽位：${customSlot}）` : ""}。按下面 4 步操作，不要跳过。`,
      "",
      "【1. 添加 MCP 服务器（Streamable HTTP）】",
      "服务器名称：a-stand",
      `URL：${url}`,
      "请求头：",
      `  Authorization: Bearer ${token}`,
      `  X-Astand-Token: ${token}`,
      "",
      "可直接粘贴的 MCP 配置：",
      httpConfigJson,
      "",
      "【2. 如果客户端不支持本地 HTTP MCP，或在 localhost 上弹出 OAuth 授权】",
      "改用随附的 stdio 桥接命令（保持 A.stand 后台守护进程运行，不要停止它）：",
      stdioCommand,
      "",
      "对应的 stdio 配置：",
      stdioBridgeConfigJson,
      "",
      "【3. 委托规则（4 行摘要）】",
      `如果本机可读取 ${rules}，请先完整阅读；不可读取时按下面 4 条执行：`,
      "- oracle：严格只读的顾问/审查者，负责方案评审、代码审查与调研，绝不修改任何文件。",
      "- hephaestus：工作区可写的工程师，负责多文件实现、重构与调试，并在交卷前跑测试。",
      "- 委托时写清目标、约束与文件路径；同一任务续写才复用 sessionId。",
      "- 新任务一律省略 sessionId，让子代理获得干净的上下文与缓存。",
      "",
      "【4. 握手校验】",
      "写入 MCP 配置后，大多数宿主需要用户手动刷新 MCP 或再发送一条消息，才会加载新工具。",
      '如果此时还看不到 a-stand 的工具，请明确提示用户刷新 MCP 或再发一条消息；工具加载后再调用一次 agent_relay_session(action="status") 完成握手并自动回填客户端代号。',
      "返回 enabled/limits 即表示接入成功。",
    ].join("\n");

    const promptEn = [
      `Connect this MCP client to the A.stand resident daemon${customSlot ? ` (client slot: ${customSlot})` : ""}. Follow these 4 steps exactly.`,
      "",
      "[1. Add the MCP server (Streamable HTTP)]",
      "Server name: a-stand",
      `URL: ${url}`,
      "Headers:",
      `  Authorization: Bearer ${token}`,
      `  X-Astand-Token: ${token}`,
      "",
      "Ready-to-paste MCP config:",
      httpConfigJson,
      "",
      "[2. If this client cannot use a local HTTP MCP server, or prompts for OAuth on localhost]",
      "Use the bundled stdio bridge command instead (keep the A.stand background daemon running; never stop it):",
      stdioCommand,
      "",
      "Equivalent stdio config:",
      stdioBridgeConfigJson,
      "",
      "[3. Delegation rules (4-line summary)]",
      `If ${rules} is readable on this machine, read it first; otherwise follow these 4 lines:`,
      "- oracle: strictly read-only advisor/reviewer for design reviews, code review and research; never modifies files.",
      "- hephaestus: workspace-write engineer for multi-file implementation, refactors and debugging; runs tests before handing off.",
      "- State goal, constraints and file paths in each delegation; reuse sessionId only when continuing the exact same task.",
      "- Omit sessionId for every new task so the subagent starts with a clean context and cache.",
      "",
      "[4. Handshake check]",
      "After writing the MCP config, most hosts require the user to manually refresh MCP or send another message before new tools load.",
      'If the a-stand tools are not visible yet, explicitly tell the user to refresh MCP or send another message; once the tools load, call agent_relay_session(action="status") once to complete the handshake and auto-fill the client name.',
      "A reply with enabled/limits means you are connected.",
    ].join("\n");

    return {
      httpUrl: url,
      token,
      stdioCommand,
      httpConfigJson,
      stdioBridgeConfigJson,
      promptZh,
      promptEn,
    };
  }
}
