import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { API_PROVIDERS, DEFAULT_MODELS } from "./constants.mjs";
import { normalizeWorkspaceKey, readDshConfigModels } from "./paths.mjs";

export function isDynamicModelId(id) {
  return typeof id === "string" && (id.startsWith("cli:") || id.startsWith("dsh:"));
}

export function assertCanReuseApiKey(baseUrl, savedBaseUrl) {
  try {
    const origin = new URL(baseUrl).origin;
    if (origin !== "null" && origin === new URL(savedBaseUrl).origin) return;
  } catch {}
  throw new Error("Enter an explicit API key for the new endpoint. / 请为新接口地址输入 API Key。");
}

function assertCustomId(id) {
  if (isDynamicModelId(id)) throw new Error("Reserved model or channel ID");
}

function isValidModelRef(id, validIds) {
  return validIds.has(id) || isDynamicModelId(id);
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

function isRunningStatusFile(filePath) {
  try {
    const snap = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return snap?.status === "running";
  } catch {
    return false;
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function maskSecret(secret) {
  if (!secret || typeof secret !== "string") return "";
  if (secret.length <= 8) return "••••••••";
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

function channelAddress(providerId, baseUrl) {
  const provider = (providerId || "").trim().toLowerCase() || "custom";
  let url = (baseUrl || "").trim().replace(/\/+$/, "");
  try {
    url = new URL(url).href.replace(/\/+$/, "");
  } catch {}
  return { providerId: provider, baseUrl: url };
}

function channelName(providerId, baseUrl) {
  const preset = API_PROVIDERS.find((p) => p.id === providerId && p.id !== "custom");
  if (preset) return preset.nameEn;
  try {
    return new URL(baseUrl).hostname || providerId;
  } catch {
    return providerId;
  }
}

function cleanModelNames(names = []) {
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
}

function newModelId() {
  return `custom-${crypto.randomUUID()}`;
}

export class RelayStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.settingsPath = path.join(this.dataDir, "settings.json");
    this.secretsPath = path.join(this.dataDir, "secrets.json");
    this.sessionsPath = path.join(this.dataDir, "sessions.json");
    this.cooldownsPath = path.join(this.dataDir, "cooldowns.json");
    this.secrets = this.#loadSecrets();
    this.settings = this.#loadSettings();
    this.sessions = this.#loadSessions();
    this.cooldowns = this.#loadCooldowns();
    this.pruneExpiredSessions();
  }

  #defaultSettings() {
    return {
      version: 3,
      enabled: false,
      lang: "zh",
      codexKeepOfficePlugins: false,
      allowHephaestusFullAccess: false,
      maxConcurrency: 3,
      silentCheckinMin: 3,
      longRunCheckinMin: 10,
      retentionDays: 30,
      autoFallbackOnLimit: true,
      asyncBackgroundMode: false,
      inspectorEnabled: false,
      inspectorModelId: "",
      roles: {
        oracle: {
          modelId: "cli-codex-default",
          queue: ["cli-codex-default"],
          effort: "medium",
        },
        hephaestus: {
          modelId: "cli-codex-default",
          queue: ["cli-codex-default"],
          effort: "medium",
        },
      },
      models: structuredClone(DEFAULT_MODELS),
      channels: [],
    };
  }

  #normalizeRole(rawRole, defRole, validIds) {
    const merged = { ...defRole, ...(rawRole || {}) };
    let queue = Array.isArray(merged.queue) ? merged.queue.filter((id) => isValidModelRef(id, validIds)) : [];
    if (queue.length === 0) {
      const primary = isValidModelRef(merged.modelId, validIds) ? merged.modelId : defRole.modelId;
      queue = [primary];
    }
    // Deduplicate preserving order
    queue = [...new Set(queue)];
    return {
      modelId: queue[0],
      queue,
      effort: ["low", "medium", "high"].includes(merged.effort) ? merged.effort : "medium",
    };
  }

  #loadSettings() {
    const raw = safeReadJson(this.settingsPath, null);
    const def = this.#defaultSettings();
    if (!raw) {
      atomicWriteJson(this.settingsPath, def);
      return def;
    }
    const currentModels = raw.models || [];
    const mergedModels = currentModels
      .filter((m) => m.builtin || m.mode !== "api")
      .map(({ apiKey, ...model }) => model);
    const originalChannels = raw.channels || [];
    const channels = originalChannels.map(({ id, name, providerId, baseUrl, models, createdAt, updatedAt }) => ({
      id, name, providerId, baseUrl, models: models.map(({ id, modelName }) => ({ id, modelName })), createdAt, updatedAt,
    }));
    const legacy = currentModels.filter((m) => !m.builtin && m.mode === "api");
    const legacyKeys = new Set(channels.flatMap((c) => c.models.map((m) => m.id)));
    const migratedKeys = { ...this.secrets.apiKeys };
    const now = new Date().toISOString();
    for (const model of legacy) {
      if (legacyKeys.has(model.id)) continue;
      const address = channelAddress(model.providerId, model.baseUrl);
      const apiKey = (migratedKeys[model.id] || model.apiKey || "").trim();
      let channel = this.#matchingChannel(channels, address, apiKey, migratedKeys);
      if (!channel) {
        channel = {
          id: `channel-${crypto.randomUUID()}`,
          name: channelName(address.providerId, address.baseUrl),
          ...address,
          models: [],
          createdAt: now,
          updatedAt: now,
        };
        channels.push(channel);
        if (apiKey) migratedKeys[channel.id] = apiKey;
      }
      channel.models.push({ id: model.id, modelName: (model.modelName || model.name || "").trim() });
      legacyKeys.add(model.id);
    }
    const existingIds = new Set(mergedModels.map((m) => m.id));
    for (const dm of DEFAULT_MODELS) {
      if (!existingIds.has(dm.id)) mergedModels.push(structuredClone(dm));
    }
    const validIds = this.#validIds({ models: mergedModels, channels });
    const settings = {
      ...def,
      ...raw,
      version: 3,
      maxConcurrency: clampInt(raw.maxConcurrency, 1, 6, def.maxConcurrency),
      silentCheckinMin: clampInt(raw.silentCheckinMin, 1, 30, def.silentCheckinMin),
      longRunCheckinMin: clampInt(raw.longRunCheckinMin, 0, 120, def.longRunCheckinMin),
      retentionDays: [0, 7, 30, 90, 365].includes(raw.retentionDays)
        ? raw.retentionDays
        : clampInt(raw.retentionDays, 0, 3650, def.retentionDays),
      autoFallbackOnLimit: typeof raw.autoFallbackOnLimit === "boolean" ? raw.autoFallbackOnLimit : def.autoFallbackOnLimit,
      allowHephaestusFullAccess:
        typeof raw.allowHephaestusFullAccess === "boolean"
          ? raw.allowHephaestusFullAccess
          : def.allowHephaestusFullAccess,
      // Backward compatible: older settings.json files omit both flags -> default OFF.
      asyncBackgroundMode:
        typeof raw.asyncBackgroundMode === "boolean" ? raw.asyncBackgroundMode : def.asyncBackgroundMode,
      inspectorEnabled: typeof raw.inspectorEnabled === "boolean" ? raw.inspectorEnabled : def.inspectorEnabled,
      inspectorModelId:
        typeof raw.inspectorModelId === "string" && isValidModelRef(raw.inspectorModelId, validIds)
          ? raw.inspectorModelId
          : "",
      roles: {
        oracle: this.#normalizeRole(raw.roles?.oracle, def.roles.oracle, validIds),
        hephaestus: this.#normalizeRole(raw.roles?.hephaestus, def.roles.hephaestus, validIds),
      },
      models: mergedModels,
      channels,
    };
    if (legacy.length && JSON.stringify(migratedKeys) !== JSON.stringify(this.secrets.apiKeys)) {
      this.secrets.apiKeys = migratedKeys;
      this.saveSecrets();
    }
    if (raw.version !== 3 || legacy.length || JSON.stringify(channels) !== JSON.stringify(originalChannels)
        || currentModels.some((m) => Object.hasOwn(m, "apiKey"))) {
      atomicWriteJson(this.settingsPath, settings);
    }
    // Retire per-model keys only after channel settings and keys are durable.
    const activeKeyIds = new Set([...mergedModels.map((m) => m.id), ...channels.map((c) => c.id)]);
    const staleKeys = Object.keys(this.secrets.apiKeys).filter((id) =>
      !activeKeyIds.has(id) && (legacyKeys.has(id) || id.startsWith("channel-")));
    if (staleKeys.length) {
      for (const id of staleKeys) delete this.secrets.apiKeys[id];
      this.saveSecrets();
    }
    return settings;
  }

  #loadSecrets() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.secretsPath, "utf8"));
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid secrets format");
      const apiKeys = raw.apiKeys === undefined ? {} : raw.apiKeys;
      if (!apiKeys || typeof apiKeys !== "object" || Array.isArray(apiKeys)
          || Object.values(apiKeys).some((key) => typeof key !== "string")) {
        throw new Error("Invalid API keys format");
      }
      return { ...raw, apiKeys };
    } catch (error) {
      if (error.code === "ENOENT") return { apiKeys: {} };
      throw new Error("Cannot read secrets.json. Restore a readable secrets file before starting Agent Relay.");
    }
  }

  #loadSessions() {
    return safeReadJson(this.sessionsPath, { records: {} });
  }

  #loadCooldowns() {
    return safeReadJson(this.cooldownsPath, { items: {} });
  }

  saveSettings() {
    atomicWriteJson(this.settingsPath, this.settings);
  }

  saveSecrets() {
    atomicWriteJson(this.secretsPath, this.secrets, 0o600);
  }

  saveSessions() {
    atomicWriteJson(this.sessionsPath, this.sessions);
  }

  saveCooldowns() {
    atomicWriteJson(this.cooldownsPath, this.cooldowns);
  }

  pruneExpiredSessions() {
    const days = this.settings.retentionDays;
    if (!days || days <= 0) return 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [k, rec] of Object.entries(this.sessions.records)) {
      const ts = Date.parse(rec.updatedAt || rec.createdAt || "");
      if (Number.isFinite(ts) && ts < cutoff) {
        delete this.sessions.records[k];
        removed++;
      }
    }
    if (removed > 0) this.saveSessions();
    // Also prune expired job logs, structured events, status snapshots & outputs under <dataDir>/jobs/ and <dataDir>/outputs/
    for (const sub of ["jobs", "outputs"]) {
      try {
        const dir = path.join(this.dataDir, sub);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
          // Running jobs still own their snapshot; never prune a live status file by mtime alone.
          const isStatus = name.endsWith(".status.json");
          if (!isStatus && !(sub === "jobs" && name.endsWith(".events.json")) && !name.endsWith(".log") && !name.endsWith(".txt") && !name.endsWith(".md")) continue;
          if (isStatus && isRunningStatusFile(path.join(dir, name))) continue;
          const fp = path.join(dir, name);
          try {
            const st = fs.statSync(fp);
            if (st.isFile() && st.mtimeMs < cutoff) {
              fs.unlinkSync(fp);
            }
          } catch {}
        }
      } catch {}
    }
    return removed;
  }

  // Cooldown tracking for rate-limited / quota-depleted models
  setCooldown(modelId, { untilMs, reason, manualOnly = false }) {
    this.cooldowns.items[modelId] = {
      modelId,
      untilMs: untilMs || null,
      untilIso: untilMs ? new Date(untilMs).toISOString() : null,
      reason: reason || "rate_limit_reached",
      manualOnly: Boolean(manualOnly),
      updatedAt: new Date().toISOString(),
    };
    this.saveCooldowns();
    return this.cooldowns.items[modelId];
  }

  clearCooldown(modelId) {
    if (this.cooldowns.items[modelId]) {
      delete this.cooldowns.items[modelId];
      this.saveCooldowns();
      return true;
    }
    return false;
  }

  getActiveCooldown(modelId) {
    const c = this.cooldowns.items[modelId];
    if (!c) return null;
    if (!c.manualOnly && c.untilMs && Date.now() >= c.untilMs) {
      delete this.cooldowns.items[modelId];
      this.saveCooldowns();
      return null;
    }
    return c;
  }

  getAllActiveCooldowns() {
    const out = {};
    let dirty = false;
    for (const [id, c] of Object.entries(this.cooldowns.items)) {
      if (!c.manualOnly && c.untilMs && Date.now() >= c.untilMs) {
        delete this.cooldowns.items[id];
        dirty = true;
      } else {
        out[id] = c;
      }
    }
    if (dirty) this.saveCooldowns();
    return out;
  }

  #validIds({ models, channels } = this.settings) {
    return new Set([...models.map((m) => m.id), ...channels.flatMap((c) => c.models.map((m) => m.id))]);
  }

  #matchingChannel(channels, address, apiKey, keys = this.secrets.apiKeys) {
    return channels.find((channel) => {
      const normalized = channelAddress(channel.providerId, channel.baseUrl);
      return normalized.providerId === address.providerId && normalized.baseUrl === address.baseUrl
        && (keys[channel.id] || "") === apiKey;
    });
  }

  getChannelById(id) {
    const channel = this.settings.channels.find((c) => c.id === id);
    return channel && { ...channel, apiKey: this.secrets.apiKeys[id] || "" };
  }

  #resolveChannelModel(channel, model) {
    const apiKey = this.secrets.apiKeys[channel.id] || "";
    return {
      ...model,
      name: model.modelName,
      mode: "api",
      engine: "deepseek-harness",
      channelId: channel.id,
      channelName: channel.name,
      providerId: channel.providerId,
      baseUrl: channel.baseUrl,
      apiKey,
      source: "custom",
      builtin: false,
      hasApiKey: Boolean(apiKey),
      maskedApiKey: maskSecret(apiKey),
    };
  }

  getPublicState() {
    const models = this.settings.models.map((m) => {
      const key = this.secrets.apiKeys[m.id] || "";
      return { ...m, hasApiKey: Boolean(key), maskedApiKey: maskSecret(key) };
    });
    const channels = this.settings.channels.map((channel) => {
      for (const model of channel.models) {
        const { apiKey, ...publicModel } = this.#resolveChannelModel(channel, model);
        models.push(publicModel);
      }
      const key = this.secrets.apiKeys[channel.id] || "";
      return { ...channel, source: "custom", hasApiKey: Boolean(key), maskedApiKey: maskSecret(key) };
    });
    return { ...this.settings, models, channels };
  }

  getSettingsForUi() {
    return this.getPublicState();
  }

  getModelById(modelId) {
    const direct = this.settings.models.find((x) => x.id === modelId);
    if (direct) {
      return {
        ...direct,
        apiKey: this.secrets.apiKeys?.[direct.id] || "",
      };
    }
    for (const channel of this.settings.channels) {
      const model = channel.models.find((m) => m.id === modelId);
      if (model) return this.#resolveChannelModel(channel, model);
    }
    if (typeof modelId === "string" && modelId.startsWith("cli:")) {
      const parts = modelId.slice(4);
      const sep = parts.indexOf(":");
      if (sep > 0) {
        const engine = parts.slice(0, sep);
        const modelName = parts.slice(sep + 1);
        if (engine && modelName) {
          return {
            id: modelId,
            name: modelName,
            mode: "cli",
            engine,
            modelName,
            providerId: engine,
            baseUrl: "",
            builtin: true,
            dynamic: true,
            apiKey: "",
          };
        }
      }
    }
    if (typeof modelId === "string" && modelId.startsWith("dsh:")) {
      const dshMatch = readDshConfigModels().find((m) => m.id === modelId);
      if (dshMatch) return dshMatch;
    }
    const fallback = this.settings.models[0];
    if (!fallback) return null;
    return {
      ...fallback,
      apiKey: this.secrets.apiKeys?.[fallback.id] || "",
    };
  }

  getRoleConfig(role) {
    const r = this.settings.roles[role] || this.settings.roles.oracle;
    const queueIds = Array.isArray(r.queue) && r.queue.length ? r.queue : [r.modelId];
    const queue = queueIds.map((id) => this.getModelById(id)).filter(Boolean);
    return {
      role,
      effort: r.effort || "medium",
      model: queue[0] || this.getModelById(r.modelId),
      queue,
    };
  }

  updateTopSettings(patch = {}) {
    if (typeof patch.enabled === "boolean") this.settings.enabled = patch.enabled;
    if (patch.lang === "zh" || patch.lang === "en") this.settings.lang = patch.lang;
    if (typeof patch.codexKeepOfficePlugins === "boolean") {
      this.settings.codexKeepOfficePlugins = patch.codexKeepOfficePlugins;
    }
    if (typeof patch.allowHephaestusFullAccess === "boolean") {
      this.settings.allowHephaestusFullAccess = patch.allowHephaestusFullAccess;
    }
    if (patch.maxConcurrency !== undefined) {
      this.settings.maxConcurrency = clampInt(patch.maxConcurrency, 1, 6, this.settings.maxConcurrency);
    }
    if (patch.silentCheckinMin !== undefined) {
      this.settings.silentCheckinMin = clampInt(patch.silentCheckinMin, 1, 30, this.settings.silentCheckinMin);
    }
    if (patch.longRunCheckinMin !== undefined) {
      this.settings.longRunCheckinMin = clampInt(patch.longRunCheckinMin, 0, 120, this.settings.longRunCheckinMin);
    }
    if (patch.retentionDays !== undefined) {
      this.settings.retentionDays = clampInt(patch.retentionDays, 0, 3650, this.settings.retentionDays);
      this.pruneExpiredSessions();
    }
    if (typeof patch.autoFallbackOnLimit === "boolean") {
      this.settings.autoFallbackOnLimit = patch.autoFallbackOnLimit;
    }
    if (typeof patch.asyncBackgroundMode === "boolean") {
      this.settings.asyncBackgroundMode = patch.asyncBackgroundMode;
    }
    if (typeof patch.inspectorEnabled === "boolean") {
      this.settings.inspectorEnabled = patch.inspectorEnabled;
    }
    if (typeof patch.inspectorModelId === "string") {
      const validIds = this.#validIds();
      this.settings.inspectorModelId =
        patch.inspectorModelId === "" || isValidModelRef(patch.inspectorModelId, validIds)
          ? patch.inspectorModelId
          : this.settings.inspectorModelId;
    }
    if (patch.roles) {
      const validIds = this.#validIds();
      for (const role of ["oracle", "hephaestus"]) {
        const rp = patch.roles[role];
        if (!rp) continue;
        if (Array.isArray(rp.queue)) {
          const clean = [...new Set(rp.queue.filter((id) => isValidModelRef(id, validIds)))];
          if (clean.length > 0) {
            this.settings.roles[role].queue = clean;
            this.settings.roles[role].modelId = clean[0];
          }
        } else if (rp.modelId && isValidModelRef(rp.modelId, validIds)) {
          const rest = (this.settings.roles[role].queue || []).filter((id) => id !== rp.modelId);
          this.settings.roles[role].queue = [rp.modelId, ...rest];
          this.settings.roles[role].modelId = rp.modelId;
        }
        if (["low", "medium", "high"].includes(rp.effort)) {
          this.settings.roles[role].effort = rp.effort;
        }
      }
    }
    this.saveSettings();
    return this.getSettingsForUi();
  }

  #newChannel(address, name) {
    const now = new Date().toISOString();
    return {
      id: `channel-${crypto.randomUUID()}`,
      name: name?.trim() || channelName(address.providerId, address.baseUrl),
      ...address,
      models: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  #commitLibrary(settings, { removedIds = [], inspectorId = "", keyUpdates = {}, keyRemovals = [], refreshedIds = [] } = {}) {
    const removed = new Set(removedIds);
    if (removed.size) {
      settings.roles = Object.fromEntries(Object.entries(settings.roles).map(([role, config]) => {
        const queue = config.queue.filter((id) => !removed.has(id));
        if (!queue.length) queue.push("cli-codex-default");
        return [role, { ...config, queue, modelId: queue[0] }];
      }));
      if (removed.has(settings.inspectorModelId)) settings.inspectorModelId = "";
    }
    if (inspectorId) settings.inspectorModelId = inspectorId;

    // Publish new keys before settings reference them, and retire old keys after settings commit.
    const previousSecrets = this.secrets;
    const nextKeys = { ...previousSecrets.apiKeys, ...keyUpdates };
    if (Object.keys(keyUpdates).length) {
      atomicWriteJson(this.secretsPath, { ...previousSecrets, apiKeys: nextKeys }, 0o600);
    }
    try {
      atomicWriteJson(this.settingsPath, settings);
    } catch (err) {
      if (Object.keys(keyUpdates).length) {
        atomicWriteJson(this.secretsPath, previousSecrets, 0o600);
      }
      throw err;
    }
    this.settings = settings;
    this.secrets = { ...previousSecrets, apiKeys: nextKeys };
    if (keyRemovals.some((id) => Object.hasOwn(nextKeys, id))) {
      const remainingKeys = { ...nextKeys };
      for (const id of keyRemovals) delete remainingKeys[id];
      atomicWriteJson(this.secretsPath, { ...this.secrets, apiKeys: remainingKeys }, 0o600);
      this.secrets.apiKeys = remainingKeys;
    }
    for (const id of new Set([...removed, ...refreshedIds])) this.clearCooldown(id);
  }

  #saveChannel(channel, existing, apiKey, removedIds, inspectorId) {
    const channels = existing
      ? this.settings.channels.map((c) => c.id === channel.id ? channel : c)
      : [...this.settings.channels, channel];
    this.#commitLibrary({ ...this.settings, channels }, {
      removedIds,
      inspectorId,
      keyUpdates: apiKey ? { [channel.id]: apiKey } : {},
      refreshedIds: apiKey ? channel.models.map((m) => m.id) : [],
    });
  }

  upsertChannel({ id, name, providerId, baseUrl, apiKey, modelNames, setAsInspector }) {
    assertCustomId(id);
    const existing = id ? this.settings.channels.find((c) => c.id === id) : null;
    if (id && !existing) throw new Error("API channel not found");
    const address = channelAddress(providerId ?? existing?.providerId, baseUrl ?? existing?.baseUrl);
    const explicitKey = apiKey?.trim() || "";
    if (existing && !explicitKey) assertCanReuseApiKey(address.baseUrl, existing.baseUrl);
    const selected = cleanModelNames(modelNames);
    const previous = existing?.models || [];
    const models = previous.filter((m) => selected.includes(m.modelName));
    const existingNames = new Set(models.map((m) => m.modelName));
    for (const modelName of selected) {
      if (!existingNames.has(modelName)) models.push({ id: newModelId(), modelName });
    }
    const retained = new Set(models.map((m) => m.id));
    const removedIds = previous.filter((m) => !retained.has(m.id)).map((m) => m.id);
    const channel = {
      ...(existing || this.#newChannel(address, name)),
      ...address,
      name: name === undefined && existing ? existing.name : name?.trim() || channelName(address.providerId, address.baseUrl),
      models,
      updatedAt: new Date().toISOString(),
    };
    const inspectorId = setAsInspector
      ? models.find((m) => m.id === this.settings.inspectorModelId)?.id || models[0]?.id
      : "";
    this.#saveChannel(channel, existing, explicitKey, removedIds, inspectorId);
    return channel;
  }

  deleteChannel(channelId) {
    const target = this.settings.channels.find((c) => c.id === channelId);
    if (!target) return false;
    const channels = this.settings.channels.filter((c) => c.id !== channelId);
    this.#commitLibrary({ ...this.settings, channels }, {
      removedIds: target.models.map((m) => m.id),
      keyRemovals: [channelId],
    });
    return true;
  }

  #removeChannelModels(channel, removedIds) {
    if (!removedIds.length) return false;
    this.#saveChannel({
      ...channel,
      models: channel.models.filter((m) => !removedIds.includes(m.id)),
      updatedAt: new Date().toISOString(),
    }, channel, "", removedIds);
    return true;
  }

  removeChannelModel(channelId, modelName, modelId) {
    const channel = this.settings.channels.find((c) => c.id === channelId);
    if (!channel) return false;
    const model = channel.models.find((m) => modelId ? m.id === modelId : m.modelName === modelName?.trim());
    return model ? this.#removeChannelModels(channel, [model.id]) : false;
  }

  upsertModel(input) {
    const id = input.id || newModelId();
    assertCustomId(id);
    const direct = this.settings.models.find((m) => m.id === id);
    const existing = this.settings.channels.find((c) => c.models.some((m) => m.id === id));
    const saved = existing || (direct?.mode === "api" ? direct : null);
    const explicitKey = input.apiKey?.trim() || "";
    const baseUrl = input.baseUrl ?? saved?.baseUrl;
    if (input.mode === "api" && saved && !explicitKey) {
      assertCanReuseApiKey(baseUrl?.trim(), saved.baseUrl);
    }
    if (input.mode === "api" && !direct?.builtin) {
      const address = channelAddress(input.providerId ?? existing?.providerId, baseUrl);
      const key = explicitKey || (existing ? this.secrets.apiKeys[existing.id] : this.secrets.apiKeys[id]) || "";
      const matchesExisting = existing && this.#matchingChannel([existing], address, key);
      const target = matchesExisting || this.#matchingChannel(this.settings.channels, address, key);
      const channel = { ...(target || this.#newChannel(address, input.name)), updatedAt: new Date().toISOString() };
      const model = { id, modelName: (input.modelName || "").trim() };
      channel.models = [...channel.models.filter((m) => m.id !== id), model];
      const channels = this.settings.channels.map((c) => {
        if (c.id === channel.id) return channel;
        if (c !== existing) return c;
        return { ...c, models: c.models.filter((m) => m.id !== id), updatedAt: channel.updatedAt };
      });
      if (!target) channels.push(channel);
      const emptied = existing && existing.id !== channel.id && existing.models.length === 1;
      const models = this.settings.models.filter((m) => m.id !== id);
      this.#commitLibrary({ ...this.settings, models, channels: channels.filter((c) => !emptied || c.id !== existing.id) }, {
        keyUpdates: !target && key ? { [channel.id]: key } : {},
        keyRemovals: [...(emptied ? [existing.id] : []), ...(direct ? [id] : [])],
        refreshedIds: explicitKey ? [id] : [],
      });
      const { apiKey, ...publicModel } = this.#resolveChannelModel(channel, model);
      return publicModel;
    }

    const mode = input.mode === "api" ? "api" : "cli";
    const engine = mode === "api" ? "deepseek-harness" : input.engine || "codex";
    const record = {
      id,
      name: (input.name || input.modelName || engine).trim(),
      mode,
      engine,
      modelName: (input.modelName || "").trim(),
      providerId: (input.providerId || (mode === "api" ? "custom" : engine)).trim(),
      baseUrl: (baseUrl || "").trim(),
      builtin: Boolean(direct?.builtin),
    };
    const models = direct ? this.settings.models.map((m) => m.id === id ? record : m) : [...this.settings.models, record];
    const channels = this.settings.channels.map((c) => c === existing
      ? { ...c, models: c.models.filter((m) => m.id !== id), updatedAt: new Date().toISOString() }
      : c);
    const key = mode === "api" ? explicitKey : "";
    this.#commitLibrary({ ...this.settings, models, channels }, {
      keyUpdates: key ? { [id]: key } : {},
      refreshedIds: key ? [id] : [],
    });
    return record;
  }

  upsertModelsBatch(input) {
    assertCustomId(input.id);
    const names = cleanModelNames(input.modelNames);
    if (!names.length) return { savedIds: [], firstId: "" };
    const address = channelAddress(input.providerId, input.baseUrl);
    const apiKey = input.apiKey?.trim() || "";
    const matching = this.#matchingChannel(this.settings.channels, address, apiKey);
    const sameAddress = this.settings.channels.filter((c) => {
      const normalized = channelAddress(c.providerId, c.baseUrl);
      return normalized.providerId === address.providerId && normalized.baseUrl === address.baseUrl;
    });
    const existing = matching || (!apiKey && sameAddress.length === 1 ? sameAddress[0] : null);
    const channel = this.upsertChannel({
      id: existing?.id,
      ...address,
      apiKey,
      modelNames: [...(existing?.models.map((m) => m.modelName) || []), ...names],
    });
    const savedIds = names.map((name) => channel.models.find((m) => m.modelName === name).id);
    return { savedIds, firstId: savedIds[0] };
  }

  deleteModel(modelId) {
    const channel = this.settings.channels.find((c) => c.models.some((m) => m.id === modelId));
    if (channel) return this.#removeChannelModels(channel, [modelId]);
    const target = this.settings.models.find((m) => m.id === modelId);
    if (!target || target.builtin) return false;
    const models = this.settings.models.filter((m) => m.id !== modelId);
    this.#commitLibrary({ ...this.settings, models }, { removedIds: [modelId], keyRemovals: [modelId] });
    return true;
  }

  sessionKey(cwd, role, slot = "default", modelId = "") {
    const cleanSlot = (slot || "default").trim() || "default";
    const base = `${normalizeWorkspaceKey(cwd)}::${role}::${cleanSlot}`;
    return modelId ? `${base}::${modelId}` : base;
  }

  getSession(cwd, role, slot = "default", modelId = "") {
    return (
      this.sessions.records[this.sessionKey(cwd, role, slot, modelId)] ||
      // Backward compatibility with v1 key format
      (slot === "default" ? this.sessions.records[`${normalizeWorkspaceKey(cwd)}::${role}`] : null) ||
      null
    );
  }

  setSession(cwd, role, info, slot = "default", modelId = "") {
    const key = this.sessionKey(cwd, role, slot, modelId || info.modelId || "");
    const prev = this.sessions.records[key];
    this.sessions.records[key] = {
      ...(prev || { createdAt: new Date().toISOString() }),
      ...info,
      cwd: path.resolve(cwd),
      role,
      slot: (slot || "default").trim() || "default",
      updatedAt: new Date().toISOString(),
    };
    this.saveSessions();
    return this.sessions.records[key];
  }

  getSessionById(sessionId) {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    return (
      this.sessions.records[id] ||
      Object.values(this.sessions.records).find((r) => r?.sessionId === id) ||
      null
    );
  }

  setSessionById(sessionId, info = {}) {
    const id = String(sessionId || "").trim();
    if (!id) return null;
    let prev = this.sessions.records[id] || null;
    for (const [k, v] of Object.entries(this.sessions.records)) {
      if (k !== id && v?.sessionId === id) {
        if (!prev) prev = v;
        delete this.sessions.records[k];
      }
    }
    const rawTitle = typeof info.title === "string" && info.title.trim() ? info.title : prev?.title || "";
    const cleanTitle = String(rawTitle).trim().slice(0, 80);
    const resolvedCwd = info.cwd ? path.resolve(info.cwd) : prev?.cwd || "";
    const record = {
      ...(prev || { createdAt: new Date().toISOString() }),
      ...info,
      sessionId: id,
      cwd: resolvedCwd,
      role: info.role || prev?.role || "oracle",
      slot: (info.slot || prev?.slot || "default").trim() || "default",
      title: cleanTitle,
      createdAt: prev?.createdAt || info.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.records[id] = record;
    this.saveSessions();
    return record;
  }

  deleteSessionById(sessionId) {
    for (const [k, v] of Object.entries(this.sessions.records)) {
      if (k === sessionId || v?.sessionId === sessionId) {
        delete this.sessions.records[k];
        this.saveSessions();
        return v;
      }
    }
    return null;
  }

  listSessions() {
    return Object.values(this.sessions.records).sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
  }
}

function clampInt(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
