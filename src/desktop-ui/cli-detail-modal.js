/**
 * A.stand v2 — Ultra-clean 3-Section CLI Engine Detail Modal.
 *
 * Strictly scoped to what belongs to a single CLI engine (zero overlap with API Channels or Roles):
 *   1. Account & real quota (Codex 5h/7d bars; honest clean display for others, ZERO fake usage bars)
 *      + 429 cooldown retry + multi-account isolation pool (for codex/qoder/qoder-cn/opencode).
 *   2. Enabled model whitelist ("全部发现" first by default, "已启用" second; NO manual add model ID).
 *   3. Read-only queue membership summary with one-click jump to "角色与队列".
 */

export function createCliDetailModal(host) {
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
    isEn,
    isMasked,
    maskText,
    getState,
    applyPayload,
    refreshState,
    engineLabel,
    renderQuotaBars,
    renderLoginBar,
    renderInstallBar,
    roleQueue,
    engineCooldownModels,
    fmtCountdown,
    goToRoles,
    getUpdates,
  } = host;

  const L = (zh, enText) => (isEn() ? enText : zh);

  const DUAL_REGION_ENGINES = new Set(["codebuddy", "minimax"]);

  const view = {
    engineId: "",
    modelTab: "all", // "all" FIRST by default, "selected" second
    accountsData: null,
    loadingAccounts: false,
    addingProfile: false,
    profileLabelDraft: "",
    profileRegionDraft: "cn",
    savingWhitelist: false,
    testing: false,
    testResult: null,
    selectedSet: null, // Set<string> working copy of whitelisted model IDs
  };

  function allDiscoveredModels(eid) {
    const st = getState() || {};
    if (eid === "deepseek-harness") {
      const fromDsh = (st.dshModels || []).filter(
        (m) => m && (m.authType === "account" || m.providerId === "deepseek-account")
      );
      if (fromDsh.length) {
        return fromDsh.map((x) => ({
          id: x.id,
          modelName: x.modelName || x.name,
          displayName: x.displayName || x.name || x.modelName || x.id,
          displayNameZh: x.displayName || x.name || x.modelName || x.id,
        }));
      }
      const acctCh = (st.dshChannels || []).find((c) => c.authType === "account" || c.providerId === "deepseek-account");
      if (acctCh?.models?.length) {
        return acctCh.models.map((x) => ({
          id: x.id,
          modelName: x.modelName || x.name,
          displayName: x.name || x.modelName || x.id,
          displayNameZh: x.name || x.modelName || x.id,
        }));
      }
      return [];
    }
    const sub = Array.isArray(st.cliSubModels?.[eid]) ? st.cliSubModels[eid] : [];
    const concrete = sub.filter((m) => m && !m.isDefault);
    if (concrete.length) return concrete;
    if (eid === "codex") {
      const cm = Array.isArray(st.codexModels) && st.codexModels.length ? st.codexModels : (st.models || []).filter((x) => x.engine === "codex");
      return cm.map((x) => ({
        id: x.id,
        modelName: x.modelName || x.name,
        displayName: x.displayName || x.name || x.modelName || x.id,
        displayNameZh: x.displayName || x.name || x.modelName || x.id,
      }));
    }
    return sub;
  }

  function initWhitelistSet(eid) {
    const st = getState() || {};
    const saved = st.cliModelWhitelist?.[eid];
    const discovered = allDiscoveredModels(eid);
    if (Array.isArray(saved) && saved.length > 0) {
      view.selectedSet = new Set(saved);
    } else {
      view.selectedSet = new Set(discovered.map((m) => m.id));
    }
  }

  async function fetchAccounts(eid, force = false) {
    view.loadingAccounts = true;
    scheduleRender();
    try {
      const qs = force ? "?force=1" : "";
      const res = await api(`/api/cli-engines/${encodeURIComponent(eid)}/accounts${qs}`);
      if (view.engineId === eid && res?.ok) {
        view.accountsData = res;
      }
    } catch {
      /* non-fatal */
    } finally {
      if (view.engineId === eid) {
        view.loadingAccounts = false;
        scheduleRender();
      }
    }
  }

  function openDetail(eid) {
    if (!eid) return;
    view.engineId = eid;
    view.modelTab = "all";
    view.accountsData = null;
    view.addingProfile = false;
    view.profileLabelDraft = "";
    view.testResult = null;
    view.testing = false;
    initWhitelistSet(eid);
    openModal({ type: "cli-detail", engineId: eid });
    void fetchAccounts(eid);
  }

  function formatAccountDisplay(eid, acc, forceLoggedIn = false) {
    if (!acc) return "";
    const effectiveLoggedIn = Boolean(acc.loggedIn || forceLoggedIn);
    const parts = [];
    if (acc.username && acc.email && acc.username !== acc.email) {
      parts.push(`${acc.username} (${acc.email})`);
    } else if (acc.email) {
      parts.push(acc.email);
    } else if (acc.username) {
      parts.push(acc.username);
    } else if (acc.userId) {
      parts.push(eid === "doubao" ? `${L("豆包 ID", "Doubao ID")} ${acc.userId}` : acc.userId);
    } else if (effectiveLoggedIn) {
      if (eid === "minimax") parts.push(L("MiniMax OAuth 账号", "MiniMax OAuth account"));
      else if (eid === "deepseek-harness") parts.push(L("DeepSeek 官方账号", "DeepSeek Official Account"));
      else if (eid === "opencode") parts.push(L("本机桌面版配置", "Local Desktop Config"));
      else if (eid === "codebuddy") parts.push(L("CodeBuddy 本地登录态", "CodeBuddy local session"));
      else if (eid === "junie") parts.push(L("JetBrains 账号", "JetBrains account"));
      else if (eid === "kiro") parts.push(L("AWS Kiro 账号", "AWS Kiro account"));
      else if (eid === "codearts") parts.push(L("华为云 AK/SK", "Huawei Cloud AK/SK"));
      else if (acc.accountLabel && acc.accountLabel !== "未登录") parts.push(acc.accountLabel);
    } else if (acc.accountLabel) {
      parts.push(acc.accountLabel);
    }
    const raw = parts[0] || "";
    if (!raw) return "";
    return isMasked() ? maskText(raw) : raw;
  }

  function queueMembershipSummary(eid) {
    const st = getState() || {};
    const modelIdsForEngine = new Set([
      ...(st.models || []).filter((m) => m.engine === eid).map((m) => m.id),
      ...(st.cliSubModels?.[eid] || []).map((m) => m.id),
    ]);
    const matchPos = (role) => {
      const q = roleQueue(role) || [];
      const idx = q.findIndex((id) => modelIdsForEngine.has(id) || id.startsWith(`cli:${eid}:`));
      return idx >= 0 ? idx + 1 : 0;
    };
    const parts = [];
    const oPos = matchPos("oracle");
    const hPos = matchPos("hephaestus");
    if (oPos) parts.push(L(`白泽 #${oPos}`, `Oracle #${oPos}`));
    if (hPos) parts.push(L(`祝融 #${hPos}`, `Hephaestus #${hPos}`));
    return parts;
  }

  function renderAccountsSection(eid, eng) {
    const st = getState() || {};
    const liveAcc = view.accountsData?.account || st.cliAccounts?.[eid] || null;
    const loginSess = st.cliLogins?.[eid] || null;
    const loggingIn = Boolean(
      loginSess && (loginSess.status === "starting" || loginSess.status === "waiting_browser" || loginSess.status === "waiting_qr")
    );
    const rawProfiles =
      Array.isArray(view.accountsData?.profiles) && view.accountsData.profiles.length > 0
        ? view.accountsData.profiles
        : Array.isArray(st.cliAccountProfiles?.[eid]) && st.cliAccountProfiles[eid].length > 0
        ? st.cliAccountProfiles[eid]
        : [{ id: "default", label: L("默认账号", "Default account"), enabled: true, isDefault: true }];
    const profiles = rawProfiles;
    const supportsMulti =
      view.accountsData?.supportsMultiAccountIsolation ??
      ["codex", "deepseek-harness", "qoder", "qoder-cn", "opencode", "codebuddy", "minimax", "doubao", "junie", "kiro", "codearts"].includes(eid);
    const canInAppLogin = Boolean(
      eng.extensible || ["doubao", "qoder", "qoder-cn", "minimax", "opencode", "codebuddy", "junie", "kiro", "codearts"].includes(eid)
    );
    const cooled = engineCooldownModels(eid);
    const showCodexQuota = eid === "codex" && Boolean(st.codexRateLimits);
    const enabledMultiCount = profiles.filter((p) => p.enabled).length;

    const rowsHtml = profiles
      .map((prof) => {
        const isDef = prof.id === "default" || prof.isDefault;
        const discoveredCount = allDiscoveredModels(eid).filter((m) => m && !m.isDefault).length;
        const loggedIn = isDef
          ? liveAcc?.status === "ready"
            ? true
            : liveAcc?.status === "logged_out"
            ? discoveredCount > 0 && (eid === "opencode" || eid === "codebuddy")
            : Boolean(liveAcc?.loggedIn ?? (eng.loggedIn || eng.status === "ready"))
          : true;
        const accLabel = isDef
          ? formatAccountDisplay(eid, liveAcc, loggedIn) || prof.label || L("本机默认登录态", "Local default session")
          : prof.label || prof.id;
        const isLoggingThis = isDef && loggingIn;
        const showLoginBtn = !isLoggingThis && (canInAppLogin || (eid === "codex" && !isDef));
        const isLocalConfigOnly = isDef && eid === "opencode" && liveAcc?.loginMethod === "local config";
        const statusText = isLoggingThis
          ? L("登录中…", "Signing in…")
          : isLocalConfigOnly
          ? L("本地配置可用", "Local config ready")
          : loggedIn
          ? L("已登录", "Signed in")
          : L("待登录", "Sign in needed");
        const planTag = isDef && eid === "codex" ? (st.codexRateLimits?.planType || liveAcc?.planType || "") : "";
        return `<div class="cli-detail-acc-row">
          <div class="cli-detail-acc-top">
            <button class="cli-acc-check ${prof.enabled ? "on" : ""}" data-action="cd-toggle-profile" data-profile="${esc(prof.id)}" ${isDef && enabledMultiCount <= 1 ? "disabled" : ""} title="${esc(L("启用/停用该账号参与轮换", "Toggle account in rotation"))}">
              ${prof.enabled ? iconSvg("check", 11) : ""}
            </button>
            <span class="cli-detail-acc-name truncate">${esc(isLoggingThis && accLabel === "未登录" ? L("等待授权中…", "Waiting for auth…") : accLabel)}</span>
            ${isDef && liveAcc?.loginMethod ? `<span class="tag plain">${esc(liveAcc.loginMethod)}</span>` : ""}
            ${planTag ? `<span class="tag plain mono">${esc(String(planTag).toUpperCase())}</span>` : ""}
            ${!isDef ? `<span class="tag plain">${esc(L("隔离目录", "Isolated"))}</span>` : ""}
            <span class="spacer"></span>
            <span class="status-pill ${isLoggingThis ? "warn" : loggedIn ? "on" : "warn"}"><span class="dot"></span>${esc(statusText)}</span>
            ${showLoginBtn
              ? `<button class="btn xs ${loggedIn && !isLocalConfigOnly ? "" : "primary"}" data-action="cli-login-start" data-engine="${esc(eid)}" data-profile="${esc(prof.id)}">${iconSvg("key")} ${esc(loggedIn && !isLocalConfigOnly ? L("切换/重登", "Re-sign in") : L("登录", "Sign in"))}</button>`
              : ""}
            ${!isDef
              ? `<button class="btn xs danger" data-action="cd-del-profile" data-profile="${esc(prof.id)}" title="${esc(L("删除该隔离账号", "Delete isolated account"))}">${iconSvg("trash")}</button>`
              : ""}
          </div>
          ${isDef && showCodexQuota ? `<div class="cli-detail-quota">${renderQuotaBars()}</div>` : ""}
        </div>`;
      })
      .join("");

    const cooldownHtml = cooled.length
      ? cooled
          .map(
            (x) => `<div class="cli-detail-cooldown">
              <span class="truncate">⏳ ${esc(x.model.name)} · ${esc(x.cd.manualOnly ? L("额度耗尽", "Quota depleted") : `${L("冷却中", "Cooldown")} · ${fmtCountdown(x.cd.untilMs)}`)}</span>
              <button class="link-btn" data-action="clear-cooldown" data-model="${esc(x.model.id)}">${esc(L("立即重试", "Retry now"))}</button>
            </div>`
          )
          .join("")
      : "";

    const multiTip =
      supportsMulti && enabledMultiCount > 1
        ? `<div class="cli-detail-multi-tip">${esc(L(`已启用 ${enabledMultiCount} 个隔离账号：遇 429 限流、5xx 异常或 401 失效时自动轮换下一个。`, `${enabledMultiCount} isolated accounts active: auto-rotates on 429/5xx/401.`))}</div>`
        : "";

    const addProfileHtml = supportsMulti
      ? view.addingProfile
        ? `<div class="stack" style="gap:6px">
            <div class="cli-detail-add-form">
              <input class="input" data-cd-field="profileLabel" data-focus-key="cd-prof-label" placeholder="${esc(L("输入账号备注（如：国际版 / 备用号 2）", "Account label (e.g. Global / Backup #2)"))}" value="${esc(view.profileLabelDraft)}" maxlength="40" />
              ${DUAL_REGION_ENGINES.has(eid)
                ? `<div class="seg" role="tablist" style="flex-shrink:0">
                    <button class="seg-btn ${view.profileRegionDraft !== "global" ? "active" : ""}" data-action="cd-profile-region" data-region="cn">${esc(L("标准版", "Standard"))}</button>
                    <button class="seg-btn ${view.profileRegionDraft === "global" ? "active" : ""}" data-action="cd-profile-region" data-region="global">${esc(L("国际版", "Global"))}</button>
                  </div>`
                : ""}
              <button class="btn xs primary" data-action="cd-save-profile">${esc(L("创建并登录", "Create & sign in"))}</button>
              <button class="btn xs ghost" data-action="cd-cancel-add-profile">${esc(L("取消", "Cancel"))}</button>
            </div>
            ${eid === "doubao"
              ? `<div class="cli-detail-multi-tip" style="color:var(--amber)">${esc(L("提示：豆包切号时会短暂切换本机豆包登录态（若外部终端同时在使用豆包也会同步切换），后台会自动备份原号并仅在额度不足或手动切号时执行。", "Note: switching Doubao accounts swaps the local Doubao login session (affecting external Doubao CLI sessions); your original account is backed up automatically."))}</div>`
              : ""}
          </div>`
        : `<button class="cli-detail-add-btn" data-action="cd-open-add-profile">
            ${iconSvg("plus", 13)}
            <span>${esc(L(`添加另一个 ${engineLabel(eid)} 账号（多账号轮换）`, `Add another ${engineLabel(eid)} account (multi-account rotation)`))}</span>
          </button>`
      : "";

    return `<div class="cli-detail-card">
      ${rowsHtml}
      ${cooldownHtml}
      ${multiTip}
      ${addProfileHtml}
    </div>
    ${renderLoginBar(eid)}
    ${renderInstallBar(eid)}`;
  }

  function renderModelsSection(eid) {
    const st = getState() || {};
    const eng = st.engines?.[eid] || {};
    const liveAcc = view.accountsData?.account || st.cliAccounts?.[eid] || null;
    const loginSess = st.cliLogins?.[eid] || null;
    const loggingIn = Boolean(
      loginSess && (loginSess.status === "starting" || loginSess.status === "waiting_browser" || loginSess.status === "waiting_qr")
    );
    const isLoggedOut = !loggingIn && liveAcc?.status === "logged_out" && eid !== "opencode";
    const discovered = allDiscoveredModels(eid);
    const selSet = view.selectedSet || new Set(discovered.map((m) => m.id));
    const list = view.modelTab === "selected" ? discovered.filter((m) => selSet.has(m.id)) : discovered;

    const loggedOutNotice =
      isLoggedOut && discovered.length > 0
        ? `<div class="field-hint" style="color:var(--amber)">${esc(L("当前尚未登录：下方为该 CLI 预置/缓存模型清单，完成登录后即可正常调用。", "Not signed in yet: these discovered/cached models will work once signed in."))}</div>`
        : "";

    const pillsHtml = list.length
      ? `<div class="cli-model-pills">
          ${list
            .map((m) => {
              const checked = selSet.has(m.id);
              const name = isEn() ? m.displayName || m.modelName || m.id : m.displayNameZh || m.displayName || m.modelName || m.id;
              return `<button class="cli-model-pill ${checked ? "selected" : ""}" data-action="cd-toggle-model" data-model="${esc(m.id)}">
                <span>${checked ? "✓" : "+"}</span>
                <span>${esc(name)}</span>
              </button>`;
            })
            .join("")}
        </div>`
      : `<div class="field-hint" style="padding:4px 0">${esc(
          discovered.length
            ? L("尚未勾选任何模型，切回「全部发现」点击即可启用。", "No models enabled yet — switch to All discovered.")
            : L("暂未发现子模型（使用 CLI 默认模型运行，或先完成登录后点「重新获取模型」）。", "No sub-models discovered yet (uses CLI default, or sign in and refresh).")
        )}</div>`;

    return `<div class="stack" style="gap:9px">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <div class="seg" role="tablist">
          <button class="seg-btn ${view.modelTab === "all" ? "active" : ""}" data-action="cd-model-tab" data-tab="all">${esc(L("全部发现", "All discovered"))} (${discovered.length})</button>
          <button class="seg-btn ${view.modelTab === "selected" ? "active" : ""}" data-action="cd-model-tab" data-tab="selected">${esc(L("已启用", "Enabled"))} (${discovered.filter((m) => selSet.has(m.id)).length})</button>
        </div>
        <div class="spacer"></div>
        ${discovered.length
          ? `<button class="btn xs" data-action="cd-bulk-models" data-val="all">${esc(L("全选", "Select all"))}</button>
             <button class="btn xs" data-action="cd-bulk-models" data-val="none">${esc(L("全不选", "Clear"))}</button>`
          : ""}
      </div>
      ${loggedOutNotice}
      ${pillsHtml}
      <div class="row" style="gap:8px;flex-wrap:wrap;padding-top:2px">
        <button class="btn xs" data-action="cd-refresh-models">${iconSvg("refresh")} ${esc(L("重新获取模型", "Refresh models"))}</button>
        <button class="btn xs" data-action="cd-test-cli" ${view.testing ? "disabled" : ""}>${iconSvg("zap")} ${esc(view.testing ? L("测试中…", "Testing…") : L("测试连通", "Test connection"))}</button>
        ${view.testResult
          ? `<span class="field-hint" style="color:${view.testResult.ok ? "var(--green)" : "var(--red)"}">${esc(
              view.testResult.ok
                ? L(`连接正常${view.testResult.latencyMs ? ` (${view.testResult.latencyMs}ms)` : ""}`, `Connected${view.testResult.latencyMs ? ` (${view.testResult.latencyMs}ms)` : ""}`)
                : view.testResult.error || L("连接失败", "Connection failed")
            )}</span>`
          : ""}
      </div>
    </div>`;
  }

  function renderModal(overlayShell) {
    const eid = view.engineId;
    const st = getState() || {};
    const eng = st.engines?.[eid] || {};
    const preset = (st.cliEnginePresets || []).find((p) => p.id === eid) || {};
    const meta = st.cliEnginesMeta?.[eid] || {};
    const label = engineLabel(eid);
    const proto =
      eng.protocol ||
      preset.protocol ||
      meta.protocol ||
      (eid === "deepseek-harness" ? "acp" : eid === "codex" ? "native" : "");
    const downloadUrl = preset.downloadUrl || meta.downloadUrl || "";
    const updates = getUpdates?.();
    const cliUpd = (updates?.clis || []).find((c) => c.id === eid && c.hasUpdate);
    const queueParts = queueMembershipSummary(eid);

    return overlayShell(`<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <div class="modal-head">
        <div class="cli-detail-head-left">
          <div class="cli-detail-logo">${engineIconSvg(eid, 28)}</div>
          <div class="min-w-0">
            <div class="cli-detail-title-row">
              <span class="modal-title truncate">${esc(label)}</span>
              ${proto ? `<span class="tag ${proto === "acp" ? "blue" : "plain"}">${esc(proto.toUpperCase())}</span>` : ""}
              ${eng.version ? `<span class="tag plain mono">${esc(eng.version)}</span>` : ""}
              ${cliUpd
                ? `<button class="btn xs primary" data-action="cli-install-start" data-engine="${esc(eid)}" data-mode="update">↑ ${esc(L(`升级至 v${cliUpd.latestVersion}`, `Update to v${cliUpd.latestVersion}`))}</button>`
                : ""}
            </div>
          </div>
        </div>
        <div class="row" style="gap:8px;flex-shrink:0">
          ${downloadUrl
            ? `<a class="link-btn" href="${esc(downloadUrl)}" target="_blank" rel="noreferrer">${esc(downloadUrl.replace(/^https?:\/\//, ""))} ↗</a>`
            : ""}
          <button class="icon-btn" data-action="close-modal" aria-label="${esc(L("关闭", "Close"))}">${iconSvg("close")}</button>
        </div>
      </div>

      <div class="modal-body" style="gap:16px">
        <div class="cli-detail-sec">
          <div class="cli-detail-label">${esc(eid === "codex" ? L("账号与额度", "Account & quota") : L("账号与状态", "Account"))}</div>
          <div class="cli-detail-content">${renderAccountsSection(eid, eng)}</div>
        </div>

        <div class="cli-detail-sec">
          <div class="cli-detail-label">${esc(L("启用模型", "Models"))}</div>
          <div class="cli-detail-content">${renderModelsSection(eid)}</div>
        </div>

        <div class="cli-detail-sec">
          <div class="cli-detail-label">${esc(L("调度队列", "Queues"))}</div>
          <div class="cli-detail-content">
            <div class="cli-detail-queue-bar">
              <span>${queueParts.length
                ? esc(L(`当前已加入：${queueParts.join(" · ")}`, `In queues: ${queueParts.join(" · ")}`))
                : `<span style="color:var(--ink-3)">${esc(L("尚未加入任何角色队列", "Not in any role queue yet"))}</span>`}</span>
              <button class="link-btn" data-action="cd-goto-roles">${esc(L("去「角色与队列」调整顺序 →", "Adjust in Roles & Queues →"))}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <span class="field-hint">${esc(L("点击空白处或按 Esc 返回", "Click outside or press Esc to close"))}</span>
        <div class="spacer"></div>
        <button class="btn" data-action="close-modal">${esc(L("关闭", "Close"))}</button>
        <button class="btn primary" data-action="cd-save-whitelist" ${view.savingWhitelist ? "disabled" : ""}>${esc(view.savingWhitelist ? L("保存中…", "Saving…") : L("保存", "Save"))}</button>
      </div>
    </div>`);
  }

  function handleInput(el) {
    if (el.dataset.cdField === "profileLabel") {
      view.profileLabelDraft = el.value;
      return true;
    }
    return false;
  }

  async function handleAction(action, target) {
    if (action === "cd-open") {
      openDetail(target.dataset.engine || "");
      return true;
    }
    if (action === "cd-model-tab") {
      view.modelTab = target.dataset.tab === "selected" ? "selected" : "all";
      scheduleRender();
      return true;
    }
    if (action === "cd-toggle-model") {
      const mid = target.dataset.model;
      if (!mid) return true;
      if (!view.selectedSet) initWhitelistSet(view.engineId);
      if (view.selectedSet.has(mid)) view.selectedSet.delete(mid);
      else view.selectedSet.add(mid);
      scheduleRender();
      return true;
    }
    if (action === "cd-bulk-models") {
      const discovered = allDiscoveredModels(view.engineId);
      view.selectedSet = target.dataset.val === "all" ? new Set(discovered.map((m) => m.id)) : new Set();
      if (target.dataset.val !== "all") view.modelTab = "all";
      scheduleRender();
      return true;
    }
    if (action === "cd-save-whitelist") {
      if (view.savingWhitelist) return true;
      const eid = view.engineId;
      const discovered = allDiscoveredModels(eid);
      const picked = [...(view.selectedSet || [])];
      // Empty array means "no filter (all models)" when user selected everything
      const modelIds = discovered.length > 0 && picked.length === discovered.length ? [] : picked;
      view.savingWhitelist = true;
      scheduleRender();
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(eid)}/whitelist`, {
          method: "POST",
          body: { modelIds },
        });
        applyPayload(res);
        showToast(L("模型白名单已保存", "Model whitelist saved"));
        closeModal();
      } catch (err) {
        showError("", err);
      } finally {
        view.savingWhitelist = false;
        scheduleRender();
      }
      return true;
    }
    if (action === "cd-refresh-models") {
      try {
        await refreshState({ forceDetect: true, fetchRateLimits: view.engineId === "codex", silent: true });
        initWhitelistSet(view.engineId);
        await fetchAccounts(view.engineId, true);
        showToast(L("已重新拉取模型与账号状态", "Refreshed models & account status"));
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    if (action === "cd-test-cli") {
      view.testing = true;
      view.testResult = null;
      scheduleRender();
      try {
        const res = await api("/api/test-connection", { method: "POST", body: { mode: "cli", engine: view.engineId } });
        view.testResult = { ok: Boolean(res?.ok), latencyMs: res?.latencyMs || 0, error: res?.error || "" };
      } catch (err) {
        view.testResult = { ok: false, error: err?.message || String(err) };
      } finally {
        view.testing = false;
        scheduleRender();
      }
      return true;
    }
    if (action === "cd-goto-roles") {
      closeModal();
      goToRoles();
      return true;
    }
    if (action === "cd-open-add-profile") {
      view.addingProfile = true;
      view.profileLabelDraft = "";
      view.profileRegionDraft = "cn";
      scheduleRender();
      return true;
    }
    if (action === "cd-profile-region") {
      view.profileRegionDraft = target.dataset.region === "global" ? "global" : "cn";
      scheduleRender();
      return true;
    }
    if (action === "cd-cancel-add-profile") {
      view.addingProfile = false;
      scheduleRender();
      return true;
    }
    if (action === "cd-save-profile") {
      const region = DUAL_REGION_ENGINES.has(view.engineId) && view.profileRegionDraft === "global" ? "global" : "cn";
      const label =
        view.profileLabelDraft.trim() ||
        (DUAL_REGION_ENGINES.has(view.engineId) && region === "global"
          ? L("国际版账号", "Global account")
          : L("备用账号", "Backup account"));
      try {
        const res = await api(`/api/cli-engines/${encodeURIComponent(view.engineId)}/accounts`, {
          method: "POST",
          body: { label },
        });
        view.addingProfile = false;
        view.profileLabelDraft = "";
        await fetchAccounts(view.engineId);
        if (res?.profile?.id) {
          showToast(L("隔离账号已创建，正在发起登录…", "Isolated account created — starting sign-in…"));
          await api(`/api/cli-engines/${encodeURIComponent(view.engineId)}/login`, {
            method: "POST",
            body: { region, profileId: res.profile.id, autoOpen: true },
          });
          await refreshState({ silent: true });
        }
      } catch (err) {
        showError("", err);
      }
      scheduleRender();
      return true;
    }
    if (action === "cd-toggle-profile") {
      const pid = target.dataset.profile;
      const profiles = view.accountsData?.profiles || [];
      const cur = profiles.find((p) => p.id === pid);
      if (!cur) return true;
      try {
        await api(`/api/cli-engines/${encodeURIComponent(view.engineId)}/accounts/${encodeURIComponent(pid)}`, {
          method: "PATCH",
          body: { enabled: !cur.enabled },
        });
        await fetchAccounts(view.engineId);
        await refreshState({ silent: true });
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    if (action === "cd-del-profile") {
      const pid = target.dataset.profile;
      if (!pid || pid === "default") return true;
      try {
        await api(`/api/cli-engines/${encodeURIComponent(view.engineId)}/accounts/${encodeURIComponent(pid)}`, {
          method: "DELETE",
        });
        await fetchAccounts(view.engineId);
        await refreshState({ silent: true });
        showToast(L("已移除隔离账号", "Isolated account removed"));
      } catch (err) {
        showError("", err);
      }
      return true;
    }
    return false;
  }

  return {
    openDetail,
    renderModal,
    handleInput,
    handleAction,
    reset: () => {
      view.addingProfile = false;
      view.testResult = null;
    },
  };
}
