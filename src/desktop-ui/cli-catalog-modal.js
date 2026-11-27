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
    engineIconSvg,
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

  const DUAL_REGION_CLI_META = {
    codebuddy: {
      cn: ["国内版（微信 · codebuddy.cn）", "China (WeChat · codebuddy.cn)"],
      global: ["国际版（Google/GitHub · codebuddy.ai）", "Global (Google/GitHub · codebuddy.ai)"],
    },
    minimax: {
      cn: ["国内版（中国站 · CN）", "China (CN)"],
      global: ["国际版（海外站 · Global）", "Global"],
    },
  };

  const view = {
    tab: "presets", // "presets" | "custom"
    search: "",
    saving: false,
    error: "",
    form: null,
    regionPicker: null, // { engineId, profileId }
    loginBusyId: "",
    installBusyId: "",
    dismissedLogins: {}, // engineId -> finishedAt
    dismissedInstalls: {}, // engineId -> finishedAt
  };

  const IN_APP_INSTALLABLE = new Set([
    "codex",
    "doubao",
    "minimax",
    "qoder",
    "qoder-cn",
    "opencode",
    "codebuddy",
    "qwen",
    "gemini",
    "claude-code",
    "deepseek-harness",
  ]);

  function getInstallSession(eid) {
    const map = getState()?.cliInstalls || {};
    const s = map[eid] || null;
    if (!s || s.status === "cancelled") return null;
    if ((s.status === "succeeded" || s.status === "failed") && s.finishedAt && view.dismissedInstalls[eid] === s.finishedAt) {
      return null;
    }
    return s;
  }

  function renderInstallBar(eid) {
    const busy = view.installBusyId === eid;
    const s = getInstallSession(eid);
    if (!busy && !s) return "";
    const status = busy && !s ? "running" : s?.status || "running";
    const pct = Math.max(0, Math.min(100, Number(s?.percent ?? (busy ? 10 : 0))));
    const label = engineLabel(eid);
    const verb = s?.mode === "update" ? L("升级", "Updating") : L("安装", "Installing");

    if (status === "running" || status === "starting") {
      return `<div class="cli-login-bar">
        <div class="cli-login-head">
          <span class="cli-spinner" aria-hidden="true"></span>
          <span class="cli-login-title">${esc(L(`正在软件内${verb} ${label}…`, `${verb} ${label}…`))}</span>
          <span class="mono nums" style="font-size:11.5px;font-weight:600;color:var(--brand)">${pct}%</span>
          <button class="btn xs ghost" data-action="cli-install-cancel" data-engine="${esc(eid)}">${esc(L("取消", "Cancel"))}</button>
        </div>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <div class="cli-login-hint">${esc(s?.message || L("正在校验环境与下载官方组件…", "Checking environment and downloading package…"))}</div>
      </div>`;
    }

    if (status === "succeeded") {
      return `<div class="cli-login-bar ok">
        <div class="cli-login-head">
          <span class="cli-login-ok-icon">${iconSvg("checkCircle", 16)}</span>
          <span class="cli-login-title">${esc(L(`${label} ${s?.mode === "update" ? "升级" : "安装"}完成！`, `${label} ready!`))}</span>
          <div class="cli-login-actions">
            <button class="btn xs primary" data-action="cli-login-start" data-engine="${esc(eid)}">${iconSvg("key")} ${esc(L("立即登录", "Sign in now"))}</button>
            <button class="btn xs ghost" data-action="cli-install-dismiss" data-engine="${esc(eid)}">${esc(L("收起", "Dismiss"))}</button>
          </div>
        </div>
      </div>`;
    }

    return `<div class="cli-login-bar err">
      <div class="cli-login-head">
        <span class="cli-login-title" style="color:var(--red)">${esc(s?.error || L("安装失败，请重试", "Install failed, please retry"))}</span>
        <div class="cli-login-actions">
          <button class="btn xs" data-action="cli-install-start" data-engine="${esc(eid)}" data-mode="${esc(s?.mode || "install")}">${esc(L("重试", "Retry"))}</button>
          <button class="btn xs ghost" data-action="cli-install-dismiss" data-engine="${esc(eid)}">${esc(L("关闭", "Close"))}</button>
        </div>
      </div>
    </div>`;
  }

  function getLoginSession(eid) {
    const map = getState()?.cliLogins || {};
    const s = map[eid] || null;
    if (!s) return null;
    if (s.status === "cancelled") return null;
    if ((s.status === "succeeded" || s.status === "failed") && s.finishedAt && view.dismissedLogins[eid] === s.finishedAt) {
      return null;
    }
    return s;
  }

  function renderLoginBar(eid) {
    const label = engineLabel(eid);
    const dualMeta = DUAL_REGION_CLI_META[eid] || null;
    if (dualMeta && view.regionPicker?.engineId === eid) {
      const pid = view.regionPicker.profileId || "";
      return `<div class="cli-login-bar">
        <div class="cli-login-head">
          <div class="cli-login-head-text">
            <div class="cli-login-title">${esc(L(`选择 ${label} 登录版本`, `Choose ${label} login region`))}</div>
            <div class="cli-login-hint">${esc(L("同一 CLI 支持国内版与国际版账号，也可通过多账号同时保留两套登录态。", "Supports both China & Global accounts; you can also keep both via multi-account."))}</div>
          </div>
          <button class="btn xs ghost" data-action="cli-login-region-cancel">${esc(L("取消", "Cancel"))}</button>
        </div>
        <div class="cli-login-actions" style="flex-wrap:wrap">
          <button class="btn xs primary" data-action="cli-login-start" data-engine="${esc(eid)}" data-region="cn" data-profile="${esc(pid)}">${iconSvg("key")} ${esc(L(dualMeta.cn[0], dualMeta.cn[1]))}</button>
          <button class="btn xs" data-action="cli-login-start" data-engine="${esc(eid)}" data-region="global" data-profile="${esc(pid)}">${iconSvg("globe")} ${esc(L(dualMeta.global[0], dualMeta.global[1]))}</button>
        </div>
      </div>`;
    }

    const busy = view.loginBusyId === eid;
    const session = getLoginSession(eid);
    if (!busy && !session) return "";
    const status = busy && !session ? "starting" : session?.status || "starting";

    if (status === "starting") {
      return `<div class="cli-login-bar">
        <div class="cli-login-head">
          <span class="cli-spinner" aria-hidden="true"></span>
          <span class="cli-login-title">${esc(L(`正在启动 ${label} 登录…`, `Starting ${label} sign-in…`))}</span>
          <button class="btn xs ghost" data-action="cli-login-cancel" data-engine="${esc(eid)}">${esc(L("取消", "Cancel"))}</button>
        </div>
      </div>`;
    }

    if (status === "waiting_qr" && session?.qrDataUrl) {
      return `<div class="cli-login-bar qr">
        <img class="cli-login-qr" src="${esc(session.qrDataUrl)}" alt="${esc(L(`${label} 登录二维码`, `${label} login QR code`))}" />
        <div class="cli-login-qr-body">
          <div class="cli-login-head">
            <span class="cli-spinner" aria-hidden="true"></span>
            <span class="cli-login-title">${esc(session.message || L(`请使用手机 App 扫码完成 ${label} 登录`, `Scan the QR code to sign in to ${label}`))}</span>
          </div>
          <div class="cli-login-hint">${esc(L("手机确认后会自动完成登录并刷新模型，无需打开终端。", "Login completes automatically once confirmed on your phone."))}</div>
          <div class="cli-login-actions">
            <button class="btn xs" data-action="cli-login-start" data-engine="${esc(eid)}">${iconSvg("refresh")} ${esc(L("刷新二维码", "Refresh QR"))}</button>
            <button class="btn xs ghost" data-action="cli-login-cancel" data-engine="${esc(eid)}">${esc(L("取消", "Cancel"))}</button>
          </div>
        </div>
      </div>`;
    }

    if (status === "waiting_browser") {
      const pidAttr = session?.profileId ? ` data-profile="${esc(session.profileId)}"` : "";
      const regionToggle = dualMeta
        ? `<div class="cli-login-regions">
            <button class="btn xs ${session?.region !== "global" ? "primary" : ""}" data-action="cli-login-start" data-engine="${esc(eid)}" data-region="cn"${pidAttr}>${esc(L("国内版", "CN"))}</button>
            <button class="btn xs ${session?.region === "global" ? "primary" : ""}" data-action="cli-login-start" data-engine="${esc(eid)}" data-region="global"${pidAttr}>${esc(L("国际版", "Global"))}</button>
          </div>`
        : "";
      return `<div class="cli-login-bar">
        <div class="cli-login-head">
          <span class="cli-spinner" aria-hidden="true"></span>
          <div class="cli-login-head-text">
            <div class="cli-login-title">${esc(L(`请在浏览器中完成 ${label} 登录`, `Finish signing in to ${label} in your browser`))}</div>
            <div class="cli-login-hint">${esc(L("已自动打开系统默认浏览器，完成授权后这里会自动同步。", "Default browser opened automatically; status updates here once authorized."))}</div>
          </div>
          ${regionToggle}
          <button class="btn xs ghost" data-action="cli-login-cancel" data-engine="${esc(eid)}">${esc(L("取消", "Cancel"))}</button>
        </div>
        ${session?.userCode ? `<div class="cli-login-code-row"><span>${esc(L("授权码：", "Code: "))}</span><code class="cli-login-code mono">${esc(session.userCode)}</code></div>` : ""}
        ${session?.authUrl
          ? `<div class="cli-login-url-row">
              <div class="cli-login-url mono truncate" title="${esc(session.authUrl)}">${esc(session.authUrl)}</div>
              <button class="btn xs" data-action="cli-copy" data-text="${esc(session.authUrl)}">${iconSvg("copy")} ${esc(L("复制链接", "Copy"))}</button>
              <button class="btn xs primary" data-action="cli-login-reopen" data-engine="${esc(eid)}">${iconSvg("external")} ${esc(L("重新打开", "Reopen"))}</button>
            </div>`
          : ""}
      </div>`;
    }

    if (status === "succeeded") {
      return `<div class="cli-login-bar ok">
        <div class="cli-login-head">
          <span class="cli-login-ok-icon">${iconSvg("checkCircle", 16)}</span>
          <span class="cli-login-title">${esc(L(`${label} 登录成功！已刷新连接与模型列表`, `${label} signed in! Refreshed models.`))}</span>
          <button class="btn xs ghost" data-action="cli-login-dismiss" data-engine="${esc(eid)}">${esc(L("收起", "Dismiss"))}</button>
        </div>
      </div>`;
    }

    return `<div class="cli-login-bar err">
      <div class="cli-login-head">
        <span class="cli-login-title" style="color:var(--red)">${esc(session?.error || L("登录失败，请重试", "Login failed, please retry"))}</span>
        <div class="cli-login-actions">
          <button class="btn xs" data-action="cli-login-start" data-engine="${esc(eid)}">${esc(L("重试", "Retry"))}</button>
          <button class="btn xs ghost" data-action="cli-login-dismiss" data-engine="${esc(eid)}">${esc(L("关闭", "Close"))}</button>
        </div>
      </div>
    </div>`;
  }

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
                  <div class="engine-avatar brand">${engineIconSvg(p.id, 24)}</div>
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
                    ${!installed && IN_APP_INSTALLABLE.has(p.id)
                      ? `<button class="btn xs primary" data-action="cli-install-start" data-engine="${esc(p.id)}" data-mode="install" ${view.installBusyId === p.id ? "disabled" : ""}>${iconSvg("download")} ${esc(L("一键安装", "Install"))}</button>`
                      : !installed && p.installCmd
                      ? `<button class="btn xs" data-action="cli-copy" data-text="${esc(p.installCmd)}" title="${esc(p.installCmd)}">${iconSvg("copy")} ${esc(L("安装命令", "Install"))}</button>`
                      : ""}
                    ${installed
                      ? `<button class="btn xs primary" data-action="cli-login-start" data-engine="${esc(p.id)}" ${view.loginBusyId === p.id ? "disabled" : ""}>${iconSvg("key")} ${esc(L("登录", "Sign in"))}</button>`
                      : ""}
                  </div>
                </div>
                ${renderInstallBar(p.id)}
                ${renderLoginBar(p.id)}`;
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
      if (text) void copyText(text, L("已复制到剪贴板", "Copied to clipboard"));
      return true;
    }
    if (action === "cli-install-start") {
      const eid = target.dataset.engine || "";
      const mode = target.dataset.mode === "update" ? "update" : "install";
      if (!eid) return true;
      delete view.dismissedInstalls[eid];
      view.installBusyId = eid;
      scheduleRender();
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(eid)}/install`, {
          method: "POST",
          body: { mode },
        });
        view.installBusyId = "";
        applyPayload(res);
        await refreshState({ forceDetect: true, silent: true });
        if (res?.ok) {
          showToast(L("CLI 安装任务已启动，进度将实时更新", "CLI install started — live progress below"));
        }
      } catch (err) {
        view.installBusyId = "";
        await refreshState({ silent: true });
        showError("", err);
      }
      scheduleRender();
      return true;
    }
    if (action === "cli-install-cancel") {
      const eid = target.dataset.engine || "";
      if (!eid) return true;
      view.installBusyId = "";
      try {
        await api(`/api/cli-engines/${encodeURIComponent(eid)}/install/cancel`, { method: "POST", body: {} });
        await refreshState({ silent: true });
      } catch (err) {
        showError("", err);
      }
      scheduleRender();
      return true;
    }
    if (action === "cli-install-dismiss") {
      const eid = target.dataset.engine || "";
      const s = getState()?.cliInstalls?.[eid];
      if (eid && s?.finishedAt) view.dismissedInstalls[eid] = s.finishedAt;
      scheduleRender();
      return true;
    }
    if (action === "cli-login-region-cancel") {
      view.regionPicker = null;
      scheduleRender();
      return true;
    }
    if (action === "cli-login-start") {
      const eid = target.dataset.engine || "";
      const rawRegion = target.dataset.region || "";
      const profileId = target.dataset.profile || "";
      if (!eid) return true;
      if (DUAL_REGION_CLI_META[eid] && !rawRegion) {
        view.regionPicker = { engineId: eid, profileId };
        delete view.dismissedLogins[eid];
        scheduleRender();
        return true;
      }
      const region = rawRegion === "global" ? "global" : "cn";
      if (view.regionPicker?.engineId === eid) view.regionPicker = null;
      delete view.dismissedLogins[eid];
      view.loginBusyId = eid;
      scheduleRender();
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(eid)}/login`, {
          method: "POST",
          body: { region, profileId: profileId || undefined, autoOpen: true },
        });
        view.loginBusyId = "";
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
        if (res?.login?.mode === "browser" && res?.login?.authUrl) {
          showToast(L("请在浏览器中完成授权", "Finish sign-in in your browser"));
        } else if (res?.login?.mode === "qr" && res?.login?.qrDataUrl) {
          showToast(L("二维码已生成，请使用豆包 App 扫码确认", "QR code ready — scan with Doubao app"));
        }
      } catch (err) {
        view.loginBusyId = "";
        await refreshState({ silent: true });
        showError("", err);
      }
      scheduleRender();
      return true;
    }
    if (action === "cli-login-reopen") {
      const eid = target.dataset.engine || "";
      if (!eid) return true;
      try {
        await api(`/api/cli-engines/${encodeURIComponent(eid)}/login/reopen`, { method: "POST", body: {} });
        showToast(L("已重新打开浏览器授权页", "Reopened login page in browser"));
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    if (action === "cli-login-cancel") {
      const eid = target.dataset.engine || "";
      if (!eid) return true;
      view.loginBusyId = "";
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(eid)}/login/cancel`, { method: "POST", body: {} });
        applyPayload(res);
        if (!res?.state) await refreshState({ silent: true });
      } catch (err) {
        showError("", err);
      }
      scheduleRender();
      return true;
    }
    if (action === "cli-login-dismiss") {
      const eid = target.dataset.engine || "";
      const s = getState()?.cliLogins?.[eid];
      if (eid && s?.finishedAt) view.dismissedLogins[eid] = s.finishedAt;
      scheduleRender();
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
    renderLoginBar,
    renderInstallBar,
    handleInput,
    handleAction,
    reset: () => {
      view.error = "";
    },
  };
}
