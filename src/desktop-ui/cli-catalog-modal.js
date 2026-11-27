/**
 * A.stand v2 — Multi-CLI Engine Catalog & Custom ACP/Headless Engine Modal.
 *
 * Keeps the main "模型供应商" page crisp by showing only installed / custom
 * CLI engines by default, while tucking official presets (OpenCode, Doubao,
 * Qoder, MiniMax, Kimi, CodeBuddy, Qwen, Gemini, Cursor, Claude, Antigravity)
 * and the Custom CLI editor into this focused modal.
 */

const CORE_PRESETS_FALLBACK = ["claude-code", "antigravity"];

function parseArgsText(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const out = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function createCliCatalogModal(host) {
  const {
    esc,
    api,
    iconSvg,
    scheduleRender,
    openModal,
    closeModal,
    showToast,
    showError,
    copyText,
    isEn,
    getState,
    applyPayload,
    refreshState,
    engineLabel,
    engineTag,
  } = host;

  const L = (zh, enText) => (isEn() ? enText : zh);

  const view = {
    tab: "presets", // "presets" | "custom"
    search: "",
    saving: false,
    error: "",
    form: null,
  };

  function resetForm(existing = null) {
    const isEdit = Boolean(existing?.id);
    view.error = "";
    view.form = {
      editingId: isEdit ? existing.id : "",
      id: existing?.id || "",
      name: existing?.labelZh || existing?.name || "",
      shortTag: existing?.shortTag || "",
      protocol: existing?.protocol === "headless" ? "headless" : "acp",
      command: existing?.command || "",
      argsText: Array.isArray(existing?.args) ? existing.args.join(" ") : "acp",
      loginCmd: existing?.loginCmd || "",
      installCmd: existing?.installCmd || "",
    };
  }

  function openCatalog(tab = "presets", existingCustom = null) {
    view.tab = tab === "custom" ? "custom" : "presets";
    view.search = "";
    view.error = "";
    if (tab === "custom") resetForm(existingCustom);
    else if (!view.form) resetForm(null);
    openModal({ type: "cli-catalog" });
  }

  function allPresets() {
    const st = getState() || {};
    const engines = st.engines || {};
    const extensible = Array.isArray(st.cliEnginePresets) ? st.cliEnginePresets : [];
    const out = [];
    const seen = new Set();

    for (const p of extensible) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({ ...p, detected: engines[p.id] || {} });
    }
    for (const cid of CORE_PRESETS_FALLBACK) {
      if (seen.has(cid)) continue;
      const meta = st.cliEnginesMeta?.[cid] || engines[cid];
      if (!meta) continue;
      seen.add(cid);
      out.push({
        id: cid,
        labelZh: meta.labelZh || cid,
        labelEn: meta.labelEn || cid,
        shortTag: meta.shortTag || engineTag(cid),
        protocol: cid === "claude-code" ? "stream-json" : "headless",
        installCmd: meta.installCmd || "",
        loginCmd: meta.loginCmd || "",
        downloadUrl: meta.downloadUrl || "",
        detected: engines[cid] || {},
      });
    }
    // Installed first, then priority order
    return out.sort((a, b) => Number(Boolean(b.detected?.installed)) - Number(Boolean(a.detected?.installed)));
  }

  function protocolTag(proto) {
    if (proto === "acp") {
      return `<span class="tag blue" title="${esc(L("标准 ACP 协议：支持流式步骤、多模型与白泽协议级只读保护", "Standard ACP: streaming steps, dynamic models & protocol read-only guard"))}">ACP</span>`;
    }
    if (proto === "stream-json") {
      return `<span class="tag violet">Stream JSON</span>`;
    }
    return `<span class="tag plain" title="${esc(L("命令行无头调用：支持直接使用官方账号积分", "Headless CLI execution using your native CLI account"))}">Headless</span>`;
  }

  function renderPresetsTab() {
    const query = view.search.trim().toLowerCase();
    const list = allPresets().filter((p) => {
      if (!query) return true;
      return [p.id, p.labelZh, p.labelEn, p.command, p.installCmd, p.protocol]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query));
    });

    return `<div class="stack" style="gap:10px">
      <div class="field-hint">${esc(L("直接复用各家官方 CLI 与你的账号积分，无需反代。安装并登录后点「刷新检测」即可自动出现在供应商与角色队列中。", "Reuse native official CLIs and your own account credits directly—no reverse proxy required. After installing and signing in, click Refresh detection."))}</div>
      <div class="search-field" style="max-width:none">
        ${iconSvg("search")}
        <input class="input" type="search" data-cli-field="search" data-focus-key="cli-preset-search" placeholder="${esc(L("搜索 OpenCode、豆包、Qoder、MiniMax、Kimi、Qwen…", "Search OpenCode, Doubao, Qoder, MiniMax, Kimi, Qwen…"))}" value="${esc(view.search)}" />
      </div>
      <div class="cli-preset-list">
        ${list.length
          ? list
              .map((p) => {
                const eng = p.detected || {};
                const installed = Boolean(eng.installed);
                const label = isEn() ? p.labelEn || p.labelZh || p.id : p.labelZh || p.labelEn || p.id;
                const modelCount = (getState()?.cliSubModels?.[p.id] || []).filter((m) => !m.isDefault).length;
                return `<div class="cli-preset-row ${installed ? "installed" : ""}">
                  <div class="engine-avatar">${esc(p.shortTag || engineTag(p.id))}</div>
                  <div class="cli-preset-main">
                    <div class="cli-preset-title">
                      <span class="truncate">${esc(label)}</span>
                      ${protocolTag(p.protocol)}
                      ${installed
                        ? `<span class="status-pill on"><span class="dot"></span>${esc(L("已安装", "Installed"))}</span>`
                        : `<span class="status-pill off"><span class="dot"></span>${esc(L("未安装", "Not installed"))}</span>`}
                      ${modelCount > 0 ? `<span class="tag plain nums">${esc(L(`${modelCount} 模型`, `${modelCount} models`))}</span>` : ""}
                    </div>
                    <div class="cli-preset-sub mono truncate">
                      ${installed
                        ? esc(eng.version || eng.binaryPath || p.command || "")
                        : esc(p.installCmd || p.command || "")}
                    </div>
                  </div>
                  <div class="cli-preset-actions">
                    ${p.installCmd
                      ? `<button class="btn xs" data-action="cli-copy" data-text="${esc(p.installCmd)}" title="${esc(p.installCmd)}">${iconSvg("copy")} ${esc(L("安装命令", "Install"))}</button>`
                      : ""}
                    ${p.loginCmd
                      ? `<button class="btn xs" data-action="cli-copy" data-text="${esc(p.loginCmd)}" title="${esc(p.loginCmd)}">${iconSvg("key")} ${esc(L("登录命令", "Login"))}</button>`
                      : ""}
                  </div>
                </div>`;
              })
              .join("")
          : `<div class="empty-state">${esc(L("没有匹配的 CLI 预设", "No matching CLI presets"))}</div>`}
      </div>
    </div>`;
  }

  function renderCustomTab() {
    const f = view.form || {};
    const isEdit = Boolean(f.editingId);
    const isAcp = f.protocol !== "headless";

    return `<div class="stack" style="gap:11px">
      <div class="field-hint">${esc(L("接入任何支持标准 ACP（推荐）或命令行 -p 无头调用的本地 CLI 工具。参数按空格拆分并安全直传，不经过 shell 拼接。", "Connect any local CLI supporting standard ACP (recommended) or headless -p execution. Arguments are split safely without shell interpolation."))}</div>
      <div class="field-grid">
        <div class="field">
          <label class="field-label">${esc(L("引擎标识 (ID)", "Engine ID"))}</label>
          <input class="input mono" data-cli-field="id" data-focus-key="cli-id" placeholder="my-cli" value="${esc(f.id || "")}" ${isEdit ? "disabled" : ""} maxlength="32" spellcheck="false" />
          <span class="field-hint">${esc(L("小写字母、数字、连字符，如 my-agent", "Lowercase letters, digits, hyphens (e.g. my-agent)"))}</span>
        </div>
        <div class="field">
          <label class="field-label">${esc(L("显示名称", "Display name"))}</label>
          <input class="input" data-cli-field="name" data-focus-key="cli-name" placeholder="${esc(L("例如：我的自定义 CLI", "e.g. My Custom CLI"))}" value="${esc(f.name || "")}" maxlength="60" />
        </div>
      </div>

      <div class="field">
        <label class="field-label">${esc(L("通信协议", "Protocol"))}</label>
        <div class="seg block">
          <button class="seg-btn ${isAcp ? "active" : ""}" data-action="cli-set-proto" data-proto="acp">${esc(L("ACP 协议（推荐 · 支持流式与只读护栏）", "ACP (Recommended · streaming & read-only guard)"))}</button>
          <button class="seg-btn ${!isAcp ? "active" : ""}" data-action="cli-set-proto" data-proto="headless">${esc(L("Headless（-p 无头命令）", "Headless (-p CLI)"))}</button>
        </div>
      </div>

      <div class="field-grid">
        <div class="field">
          <label class="field-label">${esc(L("可执行命令或路径", "Command or executable path"))}</label>
          <input class="input mono" data-cli-field="command" data-focus-key="cli-cmd" placeholder="${esc(isAcp ? "mycli" : "doubao")}" value="${esc(f.command || "")}" spellcheck="false" />
        </div>
        <div class="field">
          <label class="field-label">${esc(L("启动参数", "Arguments"))}</label>
          <input class="input mono" data-cli-field="argsText" data-focus-key="cli-args" placeholder="${esc(isAcp ? "acp 或 --acp" : "-p {prompt}")}" value="${esc(f.argsText || "")}" spellcheck="false" />
        </div>
      </div>

      <div class="field-grid">
        <div class="field">
          <label class="field-label">${esc(L("简称徽标（可选）", "Short badge (optional)"))}</label>
          <input class="input mono" data-cli-field="shortTag" placeholder="CLI" value="${esc(f.shortTag || "")}" maxlength="6" />
        </div>
        <div class="field">
          <label class="field-label">${esc(L("登录命令提示（可选）", "Login command hint (optional)"))}</label>
          <input class="input mono" data-cli-field="loginCmd" placeholder="mycli login" value="${esc(f.loginCmd || "")}" spellcheck="false" />
        </div>
      </div>

      ${view.error ? `<div class="field-hint" style="color:var(--red)">${esc(view.error)}</div>` : ""}
    </div>`;
  }

  function renderModal(overlayShell, modalHeader) {
    const isCustom = view.tab === "custom";
    const isEdit = Boolean(view.form?.editingId);
    return overlayShell(`<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(L("CLI 引擎目录", "CLI engine catalog"))}">
      ${modalHeader(
        L("发现与添加 CLI 引擎", "Discover & add CLI engines"),
        L("直接把各家官方 CLI 作为白泽 / 祝融的子 Agent 容器，用自带账号积分零反代运行", "Use native official CLIs as Oracle / Hephaestus containers with your own account credits")
      )}
      <div class="modal-body">
        <div class="seg" role="tablist" style="align-self:flex-start">
          <button class="seg-btn ${!isCustom ? "active" : ""}" data-action="cli-tab" data-tab="presets">${esc(L("官方 CLI 预设", "Official presets"))}</button>
          <button class="seg-btn ${isCustom ? "active" : ""}" data-action="cli-tab" data-tab="custom">${esc(isEdit ? L("编辑自定义 CLI", "Edit custom CLI") : L("自定义 ACP / Headless CLI", "Custom ACP / Headless CLI"))}</button>
        </div>
        ${isCustom ? renderCustomTab() : renderPresetsTab()}
      </div>
      <div class="modal-foot">
        ${!isCustom
          ? `<button class="btn" data-action="cli-refresh-detect">${iconSvg("refresh")} ${esc(L("重新检测本机 CLI", "Re-scan local CLIs"))}</button>`
          : ""}
        <div class="spacer"></div>
        <button class="btn" data-action="close-modal">${esc(L("关闭", "Close"))}</button>
        ${isCustom
          ? `<button class="btn primary" data-action="cli-save-custom" ${view.saving ? "disabled" : ""}>${esc(view.saving ? L("保存中…", "Saving…") : L("保存引擎", "Save engine"))}</button>`
          : ""}
      </div>
    </div>`);
  }

  function handleInput(el) {
    const field = el.dataset.cliField;
    if (!field) return false;
    if (field === "search") {
      view.search = el.value;
      scheduleRender();
      return true;
    }
    if (!view.form) resetForm(null);
    view.form[field] = el.value;
    return true;
  }

  async function handleAction(action, target) {
    if (action === "cli-open-catalog") {
      openCatalog("presets");
      return true;
    }
    if (action === "cli-open-custom") {
      const id = target.dataset.engine || "";
      const existing = id ? (getState()?.customCliEngines || []).find((c) => c.id === id) || null : null;
      openCatalog("custom", existing);
      return true;
    }
    if (action === "cli-tab") {
      const next = target.dataset.tab === "custom" ? "custom" : "presets";
      view.tab = next;
      if (next === "custom" && !view.form) resetForm(null);
      view.error = "";
      scheduleRender();
      return true;
    }
    if (action === "cli-set-proto") {
      if (!view.form) resetForm(null);
      const proto = target.dataset.proto === "headless" ? "headless" : "acp";
      view.form.protocol = proto;
      if (!view.form.argsText || view.form.argsText === "acp" || view.form.argsText === "-p {prompt}") {
        view.form.argsText = proto === "acp" ? "acp" : "-p {prompt}";
      }
      scheduleRender();
      return true;
    }
    if (action === "cli-copy") {
      const text = target.dataset.text || "";
      if (text) void copyText(text, L("命令已复制，粘贴到终端执行即可", "Command copied — run it in your terminal"));
      return true;
    }
    if (action === "cli-refresh-detect") {
      try {
        await refreshState({ forceDetect: true, fetchRateLimits: false, silent: true });
        showToast(L("已重新检测本机 CLI", "Local CLIs re-scanned"));
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    if (action === "cli-save-custom") {
      if (!view.form || view.saving) return true;
      const f = view.form;
      const id = (f.editingId || f.id || "").trim().toLowerCase();
      const name = (f.name || "").trim();
      const command = (f.command || "").trim();
      if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(id)) {
        view.error = L("引擎 ID 需为 2-32 位小写字母、数字或连字符", "Engine ID must be 2-32 lowercase letters, digits or hyphens");
        scheduleRender();
        return true;
      }
      if (!name || !command) {
        view.error = L("请填写显示名称与可执行命令", "Display name and command are required");
        scheduleRender();
        return true;
      }
      view.saving = true;
      view.error = "";
      scheduleRender();
      try {
        const res = await api("/api/cli-engines", {
          method: "POST",
          body: {
            id,
            name,
            labelZh: name,
            labelEn: name,
            shortTag: (f.shortTag || "").trim() || name.slice(0, 3).toUpperCase(),
            protocol: f.protocol === "headless" ? "headless" : "acp",
            command,
            args: parseArgsText(f.argsText),
            loginCmd: (f.loginCmd || "").trim(),
            installCmd: (f.installCmd || "").trim(),
          },
        });
        applyPayload(res);
        if (!res?.state) await refreshState({ forceDetect: true, silent: true });
        view.saving = false;
        closeModal();
        showToast(L("自定义 CLI 引擎已保存", "Custom CLI engine saved"));
      } catch (err) {
        view.saving = false;
        view.error = err?.message || L("保存失败", "Failed to save");
        scheduleRender();
      }
      return true;
    }
    if (action === "cli-delete-custom") {
      const id = target.dataset.engine;
      if (!id) return true;
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(id)}`, { method: "DELETE" });
        applyPayload(res);
        if (!res?.state) await refreshState({ forceDetect: true, silent: true });
        showToast(L("已删除自定义 CLI 引擎", "Custom CLI engine removed"));
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    return false;
  }

  return {
    openCatalog,
    renderModal,
    handleInput,
    handleAction,
    reset: () => {
      view.error = "";
    },
  };
}
