/**
 * A.stand v2 — "技能与扩展" (Skills, Subagent MCP & Templates) page + modal.
 *
 * Self-contained Magpie view: it owns tab/search/collapse/draft state and renders
 * through a small host bridge (esc / api / iconSvg / scheduleRender / modals), so
 * app.js only wires routing + event delegation. All dynamic text goes through
 * `esc()`; there are zero inline handlers (everything is data-action driven).
 */

const KIND_TABS = ["skill", "mcp", "template"];

const KIND_META = {
  skill: { icon: "spark", zh: "Skill 技能", en: "Skills" },
  mcp: { icon: "link", zh: "子 Agent MCP", en: "Subagent MCP" },
  template: { icon: "layers", zh: "模板与产物", en: "Templates" },
};

const ROLE_LABELS = { oracle: { zh: "白泽", en: "Oracle" }, hephaestus: { zh: "祝融", en: "Hephaestus" } };

export function createExtensionsView(host) {
  const { esc, api, iconSvg, scheduleRender, openModal, closeModal, showToast } = host;
  const view = { tab: "skill", search: "", showDisabled: false, saving: false, error: "" };
  let draft = null;

  const en = () => host.isEn();
  const L = (zh, text) => (en() ? text : zh);
  const lang = () => (en() ? "en" : "zh");
  const state = () => host.getState() || {};
  const payload = () => state().extensions || { items: [], counts: {} };
  const items = () => (Array.isArray(payload().items) ? payload().items : []);
  const kindLabel = (kind) => L((KIND_META[kind] || KIND_META.skill).zh, (KIND_META[kind] || KIND_META.skill).en);

  function roleBadges(item) {
    const roles = Array.isArray(item.roles) ? item.roles : [];
    if (!roles.length || (roles.includes("oracle") && roles.includes("hephaestus"))) {
      return `<span class="tag plain ext-role">${esc(L("通用", "General"))}</span>`;
    }
    return roles
      .map((role) => {
        const label = ROLE_LABELS[role]?.[lang()] || role;
        return `<span class="tag ${role === "oracle" ? "blue" : "violet"} ext-role">${esc(label)}</span>`;
      })
      .join("");
  }

  function mountBadge(item) {
    if (item.kind === "mcp") {
      return `<span class="tag plain mono ext-mount">${esc(item.transport === "stdio" ? "stdio" : "HTTP")}</span>`;
    }
    const inject = item.mountMode !== "path_index";
    const hint = inject ? L("Turn 1 常驻注入", "Injected on Turn 1") : L("按需读取 sourcePath", "Read sourcePath on demand");
    return `<span class="tag plain ext-mount" title="${esc(hint)}">${esc(inject ? L("常驻注入", "Inject") : L("按需读路径", "Path index"))}</span>`;
  }

  const metaLine = (item) =>
    item.kind === "mcp"
      ? item.transport === "stdio"
        ? [item.command, ...(item.args || [])].filter(Boolean).join(" ")
        : item.url || ""
      : item.sourcePath || "";

  function card(item) {
    const meta = KIND_META[item.kind] || KIND_META.skill;
    const detail = metaLine(item);
    return `<div class="ext-card">
      <button class="ext-open" data-action="ext-edit" data-id="${esc(item.id)}" aria-label="${esc(L("编辑", "Edit"))} ${esc(item.name)}">
        <span class="ext-icon">${iconSvg(meta.icon, 16)}</span>
        <span class="ext-main">
          <span class="ext-title-row">
            <span class="ext-name truncate">${esc(item.name)}</span>
            ${item.builtin ? `<span class="tag plain ext-builtin">${esc(L("内置", "Built-in"))}</span>` : ""}
            ${roleBadges(item)}${mountBadge(item)}
          </span>
          <span class="ext-desc truncate">${esc(item.description || detail || L("（无描述）", "(no description)"))}</span>
        </span>
      </button>
      <span class="ext-actions">
        <button class="switch sm ${item.enabled ? "on" : ""}" data-action="ext-toggle" data-id="${esc(item.id)}"
          role="switch" aria-checked="${item.enabled ? "true" : "false"}"
          aria-label="${esc(L("启用", "Enable"))} ${esc(item.name)}" title="${esc(L("启用 / 停用", "Enable / disable"))}"></button>
      </span>
    </div>`;
  }

  function emptyState(kind) {
    const desc =
      kind === "mcp"
        ? L("登记子 Agent 可挂载的 MCP 服务（只存元数据，不存密钥）。", "Register MCP servers for subagents (metadata only, never secrets).")
        : L("新建一条，或导入本地 SKILL.md 文件夹。", "Create one, or import a local SKILL.md folder.");
    return `<div class="card"><div class="empty-state">
      <div class="empty-icon">${iconSvg((KIND_META[kind] || KIND_META.skill).icon, 18)}</div>
      <div style="font-weight:600;color:var(--ink);margin-bottom:4px">${esc(L("还没有内容", "Nothing here yet"))}</div>
      <div style="max-width:440px;margin:0 auto 14px">${esc(desc)}</div>
      <button class="btn primary" data-action="ext-new">${iconSvg("plus")} ${esc(L("新建", "New"))}</button>
    </div></div>`;
  }

  function renderPage() {
    const counts = payload().counts || {};
    const search = view.search.trim().toLowerCase();
    const inTab = items().filter((item) => item.kind === view.tab);
    const matches = (item) =>
      !search ||
      [item.name, item.description, item.sourcePath, item.url, item.command]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    const active = inTab.filter((item) => item.enabled && matches(item));
    const disabled = inTab.filter((item) => !item.enabled && matches(item));

    const tabs = `<div class="seg ext-tabs" role="tablist">${KIND_TABS.map(
      (kind) => `<button class="seg-btn ${view.tab === kind ? "active" : ""}" role="tab"
        aria-selected="${view.tab === kind ? "true" : "false"}"
        data-action="ext-tab" data-ext-tab="${kind}">${esc(kindLabel(kind))}<span class="ext-tab-count">${counts[kind] || 0}</span></button>`
    ).join("")}</div>`;

    const toolbar = `<div class="ext-toolbar">
      <div class="search-field ext-search">
        ${iconSvg("search")}
        <input class="input" type="search" data-ext-field="search" data-focus-key="ext-search"
          placeholder="${esc(L("搜索名称、描述或路径", "Search name, description or path"))}"
          aria-label="${esc(L("搜索扩展", "Search extensions"))}" value="${esc(view.search)}" />
      </div>
      <div class="spacer"></div>
      ${view.tab === "skill" ? `<button class="btn" data-action="ext-import">${iconSvg("upload")} ${esc(L("导入本地 Skill", "Import local Skill"))}</button>` : ""}
      <button class="btn primary" data-action="ext-new">${iconSvg("plus")} ${esc(L("新建", "New"))}</button>
    </div>`;

    const disabledSection = disabled.length
      ? `<div class="ext-disabled-head">
          <button class="ext-collapse" data-action="ext-toggle-disabled" aria-expanded="${view.showDisabled ? "true" : "false"}">
            ${iconSvg(view.showDisabled ? "chevron" : "chevronRight", 14)}
            <span>${esc(L("已停用", "Disabled"))} (${disabled.length})</span>
          </button>
        </div>
        ${view.showDisabled ? `<div class="card-list ext-list muted">${disabled.map(card).join("")}</div>` : ""}`
      : "";

    const foot = L(
      "常驻注入的 Skill 只出现在每个角色的第 1 轮规则里（单条 ≤2000 字符、总计 ≤6000 字符），第 2 轮起复用会话以保住 Prompt Cache。",
      "Injected skills only ride the role's Turn-1 rules (≤2000 chars each, ≤6000 total); Turn 2+ reuses the session to preserve Prompt Cache."
    );

    return `<div class="content-inner ext-page">
      ${tabs}${toolbar}
      ${active.length ? `<div class="card-list ext-list">${active.map(card).join("")}</div>` : emptyState(view.tab)}
      ${disabledSection}
      <div class="field-hint ext-foot">${esc(foot)}</div>
    </div>`;
  }

  function roleChips() {
    const roles = Array.isArray(draft.roles) ? draft.roles : [];
    const chip = (role, zh, text) =>
      `<button class="ext-chip ${roles.includes(role) ? "on" : ""}" data-action="ext-role" data-role="${role}" aria-pressed="${roles.includes(role) ? "true" : "false"}">${esc(L(zh, text))}</button>`;
    return `<div class="ext-chip-row">${chip("oracle", "白泽", "Oracle")}${chip("hephaestus", "祝融", "Hephaestus")}</div>`;
  }

  const segmented = (options, current, action, dataKey) =>
    `<div class="seg ext-seg">${options
      .map(
        ([value, zh, text]) =>
          `<button class="seg-btn ${current === value ? "active" : ""}" data-action="${action}" data-${dataKey}="${value}">${esc(L(zh, text))}</button>`
      )
      .join("")}</div>`;

  const field = (label, inputHtml, hint) =>
    `<div class="field"><label class="field-label">${esc(label)}</label>${inputHtml}${hint ? `<div class="field-hint">${esc(hint)}</div>` : ""}</div>`;

  function textInput(key, value, placeholder, multiline = false) {
    const common = `data-ext-field="${key}" data-focus-key="ext-${key}" placeholder="${esc(placeholder || "")}"`;
    return multiline
      ? `<textarea class="input ext-textarea" ${common} rows="8">${esc(value || "")}</textarea>`
      : `<input class="input" ${common} value="${esc(value || "")}" maxlength="2000" />`;
  }

  const MOUNT_OPTIONS = [["inject", "常驻注入", "Inject"], ["path_index", "按需读路径", "Path index"]];

  function kindSpecificFields() {
    if (draft.kind === "mcp") {
      return `${field(L("传输方式", "Transport"), segmented([["http", "HTTP", "HTTP"], ["stdio", "stdio", "stdio"]], draft.transport, "ext-transport", "transport"))}
      ${field(L("URL（HTTP）", "URL (HTTP)"), textInput("url", draft.url, "https://example.com/mcp"))}
      ${field(L("命令（stdio）", "Command (stdio)"), textInput("command", draft.command, "npx -y @scope/mcp-server"))}
      ${field(L("参数（空格分隔）", "Args (space separated)"), textInput("args", (draft.args || []).join(" "), "--port 0 --verbose"))}
      ${field(L("环境变量名（只存名字，不存密钥）", "Env var names (names only, never secrets)"), textInput("envKeys", (draft.envKeys || []).join(" "), "GITHUB_TOKEN API_BASE_URL"))}`;
    }
    return `${field(
      L("挂载模式", "Mount mode"),
      segmented(MOUNT_OPTIONS, draft.mountMode, "ext-mount", "mountMode"),
      L("常驻注入适合短规则；长文档用按需读路径，第 1 轮只追加一行索引。", "Inject short rules; use path index for long docs (Turn 1 gets a one-line entry).")
    )}
    ${field(L("源路径（可选）", "Source path (optional)"), textInput("sourcePath", draft.sourcePath, "C:\\\\skills\\\\my-skill\\\\SKILL.md"))}
    ${field(
      draft.kind === "template" ? L("模板内容", "Template content") : L("规则内容", "Rule content"),
      textInput("content", draft.content, L("写清约束、检查清单或输出格式…", "Constraints, checklist or output format…"), true)
    )}`;
  }

  function renderModal(modal) {
    const creating = modal.mode !== "edit";
    const importing = modal.mode === "import";
    const title = importing ? L("导入本地 Skill", "Import local Skill") : creating ? L("新建扩展", "New extension") : L("编辑扩展", "Edit extension");
    const sub = importing
      ? L("读取本地文件并生成 skill 条目", "Reads a local file into a skill item")
      : L("启用的 Skill / 模板会在角色第 1 轮规则中生效", "Enabled skills/templates apply to the role's Turn-1 rules");

    const body = importing
      ? `${field(L("SKILL.md 或所在文件夹路径", "SKILL.md or containing folder path"), textInput("importPath", draft.importPath, "C:\\\\skills\\\\my-skill"))}
        ${field(L("作用角色", "Roles"), roleChips())}
        ${field(
          L("挂载模式", "Mount mode"),
          segmented([["auto", "自动推荐", "Auto"], ...MOUNT_OPTIONS], draft.mountMode || "auto", "ext-mount", "mountMode"),
          L("自动推荐：≤1200 字符常驻注入，超出则按需读路径。", "Auto: inject when ≤1200 chars, otherwise path index.")
        )}`
      : `${field(
          L("类型", "Kind"),
          segmented(KIND_TABS.map((kind) => [kind, KIND_META[kind].zh, KIND_META[kind].en]), draft.kind, "ext-kind", "kind")
        )}
        ${field(L("名称", "Name"), textInput("name", draft.name, L("例如：测试防作弊护栏", "e.g. Test integrity guardrail")))}
        ${field(L("描述", "Description"), textInput("description", draft.description, L("一句话说明用途", "One-line purpose")))}
        ${field(L("作用角色", "Roles"), roleChips())}
        ${kindSpecificFields()}`;

    return `<div class="overlay" data-action="overlay-bg">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div class="modal-head-main">
            <div class="modal-title">${esc(title)}</div>
            <div class="modal-sub">${esc(sub)}</div>
          </div>
          <button class="icon-btn sm plain" data-action="close-modal" aria-label="${esc(L("关闭", "Close"))}">${iconSvg("close")}</button>
        </div>
        <div class="modal-body">
          ${body}
          ${view.error ? `<div class="field-hint" style="color:var(--red)">${esc(view.error)}</div>` : ""}
        </div>
        <div class="modal-foot">
          ${!creating && !importing ? `<button class="btn danger" data-action="ext-delete" data-id="${esc(draft.id)}">${iconSvg("trash")} ${esc(L("删除", "Delete"))}</button>` : ""}
          <div class="spacer"></div>
          <button class="btn" data-action="close-modal">${esc(L("取消", "Cancel"))}</button>
          <button class="btn primary" data-action="${importing ? "ext-run-import" : "ext-save"}" ${view.saving ? "disabled" : ""}>
            ${esc(view.saving ? L("保存中…", "Saving…") : importing ? L("导入", "Import") : L("保存", "Save"))}
          </button>
        </div>
      </div>
    </div>`;
  }

  function openEditor(item) {
    view.error = "";
    draft = item
      ? { ...item, roles: [...(item.roles || [])], args: [...(item.args || [])], envKeys: [...(item.envKeys || [])] }
      : {
          kind: view.tab,
          name: "",
          description: "",
          roles: ["oracle", "hephaestus"],
          mountMode: "inject",
          sourcePath: "",
          content: "",
          transport: "http",
          url: "",
          command: "",
          args: [],
          envKeys: [],
        };
    openModal({ type: "extension", mode: item ? "edit" : "new" });
  }

  function openImport() {
    view.error = "";
    draft = { kind: "skill", roles: ["oracle", "hephaestus"], mountMode: "auto", importPath: "" };
    openModal({ type: "extension", mode: "import" });
  }

  function toggleRole(role) {
    if (!draft) return;
    const roles = new Set(draft.roles || []);
    if (roles.has(role)) roles.delete(role);
    else roles.add(role);
    draft.roles = roles.size ? [...roles] : [role];
    scheduleRender();
  }

  function normalizeBody() {
    const body = { kind: draft.kind, name: draft.name, description: draft.description, roles: draft.roles };
    if (draft.kind === "mcp") {
      Object.assign(body, {
        transport: draft.transport,
        url: draft.url,
        command: draft.command,
        args: String(draft.args || "").split(/\s+/).filter(Boolean),
        envKeys: String(draft.envKeys || "").split(/[\s,]+/).filter(Boolean),
      });
    } else {
      Object.assign(body, { mountMode: draft.mountMode, sourcePath: draft.sourcePath, content: draft.content });
    }
    return body;
  }

  async function run(task, done) {
    view.saving = true;
    view.error = "";
    scheduleRender();
    try {
      await task();
      view.saving = false;
      draft = null;
      closeModal();
      host.refresh?.();
      showToast(done);
    } catch (err) {
      view.saving = false;
      view.error = err?.message || String(err);
      scheduleRender();
    }
  }

  const save = () =>
    run(
      () =>
        draft.id
          ? api(`/api/extensions/${encodeURIComponent(draft.id)}`, { method: "PATCH", body: normalizeBody() })
          : api("/api/extensions", { method: "POST", body: normalizeBody() }),
      L("已保存", "Saved")
    );

  const runImport = () => {
    const body = { path: draft.importPath, roles: draft.roles };
    if (draft.mountMode && draft.mountMode !== "auto") body.mountMode = draft.mountMode;
    return run(() => api("/api/extensions/import-skill", { method: "POST", body }), L("已导入", "Imported"));
  };

  async function toggleItem(id) {
    const item = items().find((row) => row.id === id);
    if (!item) return;
    try {
      await api(`/api/extensions/${encodeURIComponent(id)}`, { method: "PATCH", body: { enabled: !item.enabled } });
      host.refresh?.();
    } catch (err) {
      showToast(err?.message || String(err), "error");
    }
  }

  async function removeItem(id) {
    try {
      await api(`/api/extensions/${encodeURIComponent(id)}`, { method: "DELETE" });
      draft = null;
      closeModal();
      host.refresh?.();
      showToast(L("已删除", "Deleted"));
    } catch (err) {
      view.error = err?.message || String(err);
      scheduleRender();
    }
  }

  /** Returns true when the action belongs to this view (app.js then stops). */
  async function handleAction(action, target) {
    const d = target.dataset;
    switch (action) {
      case "ext-tab":
        view.tab = KIND_TABS.includes(d.extTab) ? d.extTab : "skill";
        scheduleRender();
        return true;
      case "ext-toggle-disabled":
        view.showDisabled = !view.showDisabled;
        scheduleRender();
        return true;
      case "ext-new":
        openEditor(null);
        return true;
      case "ext-import":
        openImport();
        return true;
      case "ext-edit":
        openEditor(items().find((row) => row.id === d.id) || null);
        return true;
      case "ext-toggle":
        await toggleItem(d.id);
        return true;
      case "ext-role":
        toggleRole(d.role);
        return true;
      case "ext-kind":
        draft.kind = d.kind;
        scheduleRender();
        return true;
      case "ext-mount":
        draft.mountMode = d.mountMode;
        scheduleRender();
        return true;
      case "ext-transport":
        draft.transport = d.transport;
        scheduleRender();
        return true;
      case "ext-save":
        await save();
        return true;
      case "ext-run-import":
        await runImport();
        return true;
      case "ext-delete":
        await removeItem(d.id || draft?.id);
        return true;
      default:
        return false;
    }
  }

  /** Text inputs mirror into the draft so SSE re-renders never drop edits. */
  function handleInput(el) {
    const key = el?.dataset?.extField;
    if (!key) return false;
    if (key === "search") {
      view.search = el.value;
      scheduleRender();
      return true;
    }
    if (draft) draft[key] = el.value;
    return true;
  }

  function reset() {
    draft = null;
    view.error = "";
    view.saving = false;
  }

  return { renderPage, renderModal, handleAction, handleInput, reset };
}
