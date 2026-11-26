import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A.stand v2 — Skills / Subagent MCP / Templates registry.
 *
 * Persists `<dataDir>/extensions.json` atomically as `{ version: 1, items: [] }`.
 * Three kinds share one shape so the console can render a single Magpie list:
 *   skill    · { mountMode, sourcePath, content }
 *   mcp      · { transport, url, command, args, envKeys }  (metadata only, never secrets)
 *   template · { mountMode, sourcePath, content }
 *
 * Built-in guardrails are seeded exactly once (fresh store). Deleting one is
 * permanent: the store file still exists, so it is never re-seeded.
 */

export const EXTENSION_KINDS = ["skill", "mcp", "template"];
export const EXTENSION_ROLES = ["oracle", "hephaestus"];
export const INJECT_ITEM_MAX = 2_000;
export const INJECT_TOTAL_MAX = 6_000;
export const STORE_VERSION = 1;

const CONTENT_STORE_MAX = 120_000;
const MCP_SECRET_FIELDS = /^(?:apiKey|token|secret|password|authorization|headers)$/i;

const BUILTIN_SEED = [
  {
    id: "builtin-modular-files",
    kind: "skill",
    name: "单文件红线与模块化",
    description: "限制单文件体积，强制按模块/页面拆文件，防止堆出几千行巨型文件",
    enabled: true,
    roles: ["hephaestus"],
    builtin: true,
    mountMode: "inject",
    sourcePath: "",
    content:
      "单文件体积红线：新功能按模块/页面拆分为独立小文件，单个源码文件尽量控制在 500 行以内，严禁把所有视图或样式硬塞进单个巨型文件（除非工单明确指定单文件）。",
  },
  {
    id: "builtin-test-integrity",
    kind: "skill",
    name: "测试防作弊护栏",
    description: "严禁删减或放宽已有断言凑全绿，验证必须带明确超时",
    enabled: true,
    roles: ["oracle", "hephaestus"],
    builtin: true,
    mountMode: "inject",
    sourcePath: "",
    content:
      "测试防作弊：严禁删除、跳过或放宽已有断言来凑测试通过；运行命令和测试必须附带超时上限，不留常驻前台进程。",
  },
];

function nowIso() {
  return new Date().toISOString();
}

function newExtensionId() {
  return `ext_${crypto.randomBytes(6).toString("hex")}`;
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function clipText(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, Math.max(0, max));
}

function cleanLine(value, max) {
  return clipText(value, max).replace(/\s+/g, " ").trim();
}

function cleanContent(value) {
  return clipText(value, CONTENT_STORE_MAX).replace(/\r\n/g, "\n").trim();
}

function normalizeKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  if (!EXTENSION_KINDS.includes(kind)) throw fail(`Unknown extension kind: ${value}`);
  return kind;
}

function normalizeRoles(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const roles = [...new Set(list.map((r) => String(r || "").trim().toLowerCase()).filter((r) => EXTENSION_ROLES.includes(r)))];
  return roles.length ? roles : [...EXTENSION_ROLES];
}

function normalizeMountMode(value) {
  return String(value || "").trim() === "path_index" ? "path_index" : "inject";
}

function normalizeStringArray(value, maxItems = 60, maxLen = 300) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/) : [];
  return list.map((v) => clipText(v, maxLen).trim()).filter(Boolean).slice(0, maxItems);
}

function normalizeEnvKeys(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  const keys = list
    .map((v) => String(v || "").trim())
    .filter((v) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v));
  return [...new Set(keys)].slice(0, 40);
}

function readStoreFile(filePath) {
  if (!fs.existsSync(filePath)) return { fresh: true, items: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { fresh: false, items: Array.isArray(raw?.items) ? raw.items : [] };
  } catch {
    // A corrupt store must never resurrect deleted built-ins.
    return { fresh: false, items: [] };
  }
}

function writeAtomicJson(target, value) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, target);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
  }
}

function seedItem(raw) {
  return {
    ...raw,
    roles: [...raw.roles],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function buildItem(raw, existing) {
  const kind = normalizeKind(raw.kind ?? existing?.kind);
  const name = cleanLine(raw.name ?? existing?.name, 120);
  if (!name) throw fail("扩展名称不能为空 (name is required)");

  const item = {
    id: existing?.id || "",
    kind,
    name,
    description: cleanLine(raw.description ?? existing?.description, 400),
    enabled: raw.enabled === undefined ? (existing?.enabled ?? true) : Boolean(raw.enabled),
    roles: normalizeRoles(raw.roles ?? existing?.roles),
    builtin: Boolean(existing?.builtin || raw.builtin === true),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };

  if (kind === "skill" || kind === "template") {
    item.mountMode = normalizeMountMode(raw.mountMode ?? existing?.mountMode);
    item.sourcePath = clipText(raw.sourcePath ?? existing?.sourcePath, 1_000).trim();
    item.content = cleanContent(raw.content ?? existing?.content);
    if (!item.content && !item.sourcePath) {
      throw fail(`${kind} 需要内容或 sourcePath (content or sourcePath is required)`);
    }
    return item;
  }

  // MCP is a metadata registry: only whitelisted fields survive, so raw secrets
  // (apiKey / token / headers) can never be written to extensions.json.
  item.transport = raw.transport === "stdio" || existing?.transport === "stdio" ? "stdio" : "http";
  item.url = clipText(raw.url ?? existing?.url, 2_000).trim();
  item.command = clipText(raw.command ?? existing?.command, 500).trim();
  item.args = normalizeStringArray(raw.args ?? existing?.args);
  item.envKeys = normalizeEnvKeys(raw.envKeys ?? existing?.envKeys);
  if (!item.url && !item.command) throw fail("MCP 需要 url 或 command (url or command is required)");
  return item;
}

function normalizeStoredItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  try {
    const item = buildItem(raw, raw);
    item.id = cleanLine(raw.id, 80) || newExtensionId();
    item.builtin = Boolean(raw.builtin || item.id.startsWith("builtin-"));
    item.createdAt = typeof raw.createdAt === "string" ? raw.createdAt : nowIso();
    item.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : item.createdAt;
    return item;
  } catch {
    return null;
  }
}

function indexLineFor(item) {
  const description = item.description || item.name;
  if (item.kind === "template") {
    return `- [${item.name}]: ${description} (template — apply when relevant)`;
  }
  const target = item.sourcePath ? `read ${item.sourcePath} when relevant` : "read on demand";
  return `- [${item.name}]: ${description} (${target})`;
}

function parseFrontmatter(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!entry) continue;
    let value = entry[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[entry[1].toLowerCase()] = value;
  }
  return { meta, body: text.slice(match[0].length) };
}

function firstBodyLine(body) {
  for (const line of String(body || "").split(/\r?\n/)) {
    const text = line.replace(/^#+\s*/, "").replace(/[*_`>]/g, "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * Reads a local `.md` skill file or a folder containing `SKILL.md`.
 * Returns a preview (never persists) with a recommended mount mode:
 * short content → inject, long content → path_index (keeps Turn-1 context small).
 */
export function importLocalSkill(inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw fail("请提供 SKILL.md 或所在文件夹路径 (path is required)");
  const resolved = path.resolve(raw);
  if (!fs.existsSync(resolved)) throw fail(`路径不存在 (path not found): ${raw}`);

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw fail(`无法读取路径 (path is not readable): ${raw}`);
  }

  let filePath = resolved;
  if (stat.isDirectory()) {
    filePath = path.join(resolved, "SKILL.md");
    if (!fs.existsSync(filePath)) throw fail(`文件夹内未找到 SKILL.md: ${raw}`);
    if (!fs.statSync(filePath).isFile()) throw fail(`SKILL.md 不是文件: ${filePath}`);
  } else if (!stat.isFile()) {
    throw fail(`路径不是文件或文件夹 (not a file or directory): ${raw}`);
  }

  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    throw fail(`无法读取文件 (file is not readable): ${filePath}`);
  }
  if (!content.trim()) throw fail(`文件为空 (file is empty): ${filePath}`);
  if (content.includes("\u0000")) throw fail(`文件看起来是二进制 (binary file): ${filePath}`);

  const { meta, body } = parseFrontmatter(content);
  const fallbackName = stat.isDirectory() ? path.basename(resolved) : path.basename(filePath, path.extname(filePath));
  const name = cleanLine(meta.name || fallbackName, 120) || "Imported Skill";
  const description = cleanLine(meta.description || firstBodyLine(body) || name, 400);
  const contentLength = content.length;
  // Frontmatter is metadata; storing the body keeps Turn-1 injections clean.
  const stored = body.trim() ? body : content;

  return {
    name,
    description,
    content: cleanContent(stored),
    sourcePath: filePath,
    contentLength,
    mountMode: contentLength <= 1_200 ? "inject" : "path_index",
  };
}

/**
 * Compiles the Turn-1 extension rules for one role. Injected skills/templates are
 * clamped per item and in total; long ones become one-line path index entries.
 */
export function compileRoleExtensionsPrompt(extensionRegistry, role) {
  if (!extensionRegistry || typeof extensionRegistry.compileForRole !== "function") return "";
  try {
    return extensionRegistry.compileForRole(role)?.promptText || "";
  } catch {
    return "";
  }
}

export class ExtensionRegistry {
  constructor(dataDir) {
    this.dataDir = path.resolve(String(dataDir || "."));
    this.storePath = path.join(this.dataDir, "extensions.json");
    this.items = [];
    this.#load();
  }

  #load() {
    const { fresh, items } = readStoreFile(this.storePath);
    if (fresh) {
      this.items = BUILTIN_SEED.map(seedItem);
      this.#persist();
      return;
    }
    this.items = items.map(normalizeStoredItem).filter(Boolean);
  }

  #persist() {
    writeAtomicJson(this.storePath, { version: STORE_VERSION, items: this.items });
  }

  list() {
    return this.items.map((item) => ({
      ...item,
      roles: [...item.roles],
      ...(Array.isArray(item.args) ? { args: [...item.args] } : {}),
      ...(Array.isArray(item.envKeys) ? { envKeys: [...item.envKeys] } : {}),
    }));
  }

  get(id) {
    return this.list().find((item) => item.id === id) || null;
  }

  upsert(input = {}) {
    const id = String(input.id || "").trim();
    const existing = id ? this.items.find((item) => item.id === id) : null;
    if (id && !existing) throw fail(`扩展不存在 (extension not found): ${id}`, 404);

    const sanitized = { ...input };
    for (const key of Object.keys(sanitized)) {
      if (MCP_SECRET_FIELDS.test(key)) delete sanitized[key];
    }
    const item = buildItem({ ...existing, ...sanitized }, existing || null);
    item.id = existing?.id || newExtensionId();
    item.createdAt = existing?.createdAt || nowIso();
    item.updatedAt = nowIso();
    item.builtin = Boolean(existing?.builtin || input.builtin === true);

    const index = existing ? this.items.indexOf(existing) : -1;
    if (index >= 0) this.items[index] = item;
    else this.items.push(item);
    this.#persist();
    return this.get(item.id);
  }

  update(id, patch = {}) {
    return this.upsert({ ...patch, id });
  }

  delete(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.#persist();
    return true;
  }

  importSkill(inputPath, { roles, mountMode } = {}) {
    const parsed = importLocalSkill(inputPath);
    return this.upsert({
      kind: "skill",
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      sourcePath: parsed.sourcePath,
      mountMode: mountMode === "inject" || mountMode === "path_index" ? mountMode : parsed.mountMode,
      roles: roles ?? EXTENSION_ROLES,
      enabled: true,
    });
  }

  compileForRole(role) {
    const target = role === "hephaestus" ? "hephaestus" : "oracle";
    const active = this.items.filter((item) => item.enabled && item.roles.includes(target));
    const mounted = active.filter((item) => item.kind === "skill" || item.kind === "template");
    const mcpNames = active.filter((item) => item.kind === "mcp").map((item) => item.name);

    const injectedBlocks = [];
    const indexLines = [];
    let injectedChars = 0;

    for (const item of mounted) {
      if (item.mountMode === "path_index") {
        indexLines.push(indexLineFor(item));
        continue;
      }
      const content = String(item.content || "").trim();
      if (!content) continue;
      const header = `### ${item.name}\n`;
      const remaining = INJECT_TOTAL_MAX - injectedChars - header.length - 2;
      if (remaining < 40) {
        // Budget exhausted: keep the rule discoverable instead of silently dropping it.
        indexLines.push(indexLineFor(item));
        continue;
      }
      const budget = Math.min(INJECT_ITEM_MAX, remaining);
      const clipped =
        content.length > budget ? `${content.slice(0, Math.max(0, budget - 1)).trimEnd()}…` : content;
      injectedBlocks.push(`${header}${clipped}`);
      injectedChars += header.length + clipped.length + 2;
    }

    const sections = [];
    if (injectedBlocks.length) {
      sections.push(`[A.stand · Skills & Templates (Turn 1)]\n${injectedBlocks.join("\n\n")}`);
    }
    if (indexLines.length) {
      sections.push(`[A.stand · On-demand Skills & Templates]\n${indexLines.join("\n")}`);
    }
    if (mcpNames.length) {
      sections.push(`[A.stand · Subagent MCP (metadata only)]\n${mcpNames.map((name) => `- ${name}`).join("\n")}`);
    }

    return {
      injectedText: injectedBlocks.join("\n\n"),
      indexLines,
      activeCount: mounted.length,
      mcpNames,
      injectedChars,
      promptText: sections.join("\n\n"),
    };
  }

  getPublicState() {
    const items = this.list();
    return {
      version: STORE_VERSION,
      items,
      counts: {
        total: items.length,
        active: items.filter((item) => item.enabled).length,
        skill: items.filter((item) => item.kind === "skill").length,
        mcp: items.filter((item) => item.kind === "mcp").length,
        template: items.filter((item) => item.kind === "template").length,
      },
    };
  }
}
