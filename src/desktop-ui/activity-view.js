/**
 * A.stand v2 — "实时任务" (Live Activity) Master-Detail chat-stream view.
 *
 * Scheme A layout:
 *   - Left rail: running + recent jobs (up to 30, memory + disk hydrated), each
 *     tagged with its upstream client icon/name, role, elapsed & relative time.
 *   - Right canvas: AI chat-room execution stream (collapsible lead prompt,
 *     Markdown assistant prose, grouped collapsible command/file steps,
 *     live status indicator, and zero-jump smart auto-follow bottom scrolling).
 *
 * Zero inline handlers; every dynamic string passes through `esc()`.
 */

function normText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

function basenameOf(p) {
  const clean = String(p || "").replace(/[\\/]+$/, "");
  if (!clean) return "";
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function formatErrorSnippet(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  // Extract human-readable message from nested JSON protocol errors when present.
  const nested = /"message"\s*:\s*"([^"]{4,260})"/.exec(text);
  if (nested?.[1]) {
    const clean = nested[1].replace(/\\"/g, '"').replace(/\\n/g, " ");
    if (text.length > 260) return `${clean} (${text.slice(0, 90)}…)`;
  }
  return text.length > 900 ? `${text.slice(0, 899)}…` : text;
}

function splitAstandFooter(text) {
  const clean = normText(text).trim();
  if (!clean) return { body: "", footer: "" };
  const match = /\n*\s*(\[A\.stand\s+·[^\n]+\])\s*$/.exec(clean);
  if (!match) return { body: clean, footer: "" };
  return {
    body: clean.slice(0, match.index).trim(),
    footer: match[1].slice(1, -1).trim(),
  };
}

function classifyStep(a) {
  const kind = String(a?.kind || a?.type || "").toLowerCase();
  if (["cmd", "cmd_start", "cmd_done", "command", "shell"].includes(kind)) return "cmd";
  if (["edit", "write", "file", "patch"].includes(kind)) return "edit";
  if (["read", "search", "grep", "list", "glob", "tool"].includes(kind)) return "read";
  if (["thought", "reasoning"].includes(kind)) return "thought";
  if (["output", "message", "assistant"].includes(kind)) return "prose";
  if (["fallback", "triage", "triage_alert", "steer", "interrupt"].includes(kind)) return "notice";
  if (kind === "error") return "error";
  if (["start", "touch", "log"].includes(kind)) return "ignore";
  return "read";
}

function buildStreamBlocks(activities) {
  const blocks = [];
  let currentGroup = null;
  let seq = 0;

  const flushGroup = () => {
    if (currentGroup && currentGroup.items.length) {
      blocks.push(currentGroup);
    }
    currentGroup = null;
  };

  for (const raw of activities || []) {
    const cls = classifyStep(raw);
    if (cls === "ignore") continue;

    if (cls === "cmd" || cls === "edit" || cls === "read") {
      if (!currentGroup) {
        currentGroup = {
          type: "steps",
          key: `grp_${seq++}`,
          items: [],
          counts: { cmd: 0, edit: 0, read: 0 },
          running: false,
        };
      }
      currentGroup.items.push({ cls, raw, key: `step_${raw.id || seq++}` });
      currentGroup.counts[cls] += 1;
      if (raw.status === "running") currentGroup.running = true;
      continue;
    }

    flushGroup();
    if (cls === "thought") {
      const text = normText(raw.detail || raw.summary || raw.title || "").trim();
      if (text) blocks.push({ type: "thought", key: `th_${raw.id || seq++}`, text, title: raw.title || raw.summary || "" });
    } else if (cls === "prose") {
      const text = normText(raw.detail || raw.title || raw.summary || "").trim();
      if (text) blocks.push({ type: "prose", key: `pr_${raw.id || seq++}`, text });
    } else if (cls === "notice") {
      const text = String(raw.summary || raw.title || raw.detail || "").trim();
      if (text) blocks.push({ type: "notice", key: `nt_${raw.id || seq++}`, text, kind: raw.type || raw.kind || "notice" });
    } else if (cls === "error") {
      const text = formatErrorSnippet(raw.summary || raw.detail || raw.title || "");
      if (text) blocks.push({ type: "error", key: `er_${raw.id || seq++}`, text });
    }
  }

  flushGroup();
  return blocks;
}

/**
 * Safe, zero-dependency Markdown renderer for subagent chat prose.
 * Escapes all HTML first via `esc()` before applying structural formatting.
 */
function renderMarkdown(esc, rawText) {
  const source = normText(rawText).trim();
  if (!source) return "";

  // Split out fenced code blocks first so their contents stay verbatim.
  const segments = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = fenceRe.exec(source)) !== null) {
    if (match.index > last) segments.push({ type: "text", content: source.slice(last, match.index) });
    segments.push({ type: "code", lang: match[1] || "", content: match[2].replace(/\n$/, "") });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ type: "text", content: source.slice(last) });

  const inlineFormat = (line) => {
    // Protect inline code spans before bold/italic.
    const codes = [];
    let safe = esc(line).replace(/`([^`]+)`/g, (_, code) => {
      const idx = codes.length;
      codes.push(`<code>${code}</code>`);
      return `\u0000C${idx}\u0000`;
    });
    safe = safe.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    return safe.replace(/\u0000C(\d+)\u0000/g, (_, idx) => codes[Number(idx)] || "");
  };

  const html = [];
  for (const seg of segments) {
    if (seg.type === "code") {
      html.push(`<pre class="act-code-block"><code>${esc(seg.content)}</code></pre>`);
      continue;
    }
    const lines = seg.content.split("\n");
    let inList = false;
    let para = [];

    const flushPara = () => {
      if (!para.length) return;
      html.push(`<p>${para.map(inlineFormat).join("<br />")}</p>`);
      para = [];
    };
    const closeList = () => {
      if (!inList) return;
      html.push("</ul>");
      inList = false;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        flushPara();
        closeList();
        continue;
      }
      const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (heading) {
        flushPara();
        closeList();
        const level = Math.min(4, heading[1].length);
        html.push(`<div class="act-h act-h${level}">${inlineFormat(heading[2])}</div>`);
        continue;
      }
      const bullet = /^(?:[-*•]|\d+\.)\s+(.+)$/.exec(trimmed);
      if (bullet) {
        flushPara();
        if (!inList) {
          html.push('<ul class="act-ul">');
          inList = true;
        }
        html.push(`<li>${inlineFormat(bullet[1])}</li>`);
        continue;
      }
      closeList();
      para.push(line);
    }
    flushPara();
    closeList();
  }
  return html.join("");
}

export function createActivityView(host) {
  const {
    esc,
    api,
    iconSvg,
    clientIconSvg,
    normalizeClientIconKey,
    scheduleRender,
    showToast,
    showError,
    copyText,
    isEn,
    getState,
    findClient,
    roleName,
    statusTag,
    fmtElapsedSec,
    fmtDuration,
    fmtRelative,
    fmtPct,
    refreshState,
  } = host;

  const L = (zh, enText) => (isEn() ? enText : zh);

  const view = {
    selectedJobId: "",
    filter: "all", // "all" | "running"
    detail: null,
    detailJobId: "",
    detailSignature: "",
    loading: false,
    error: "",
    fetchSeq: 0,

    expandedPrompts: new Set(),
    expandedGroups: new Set(),
    expandedSteps: new Set(),
    expandedThoughts: new Set(),

    railScrollTop: 0,
    streamScrollTop: 0,
    autoFollow: true,
    forceScrollBottom: false,
  };

  function allJobsList() {
    const st = getState() || {};
    const running = Array.isArray(st.activeJobs) ? st.activeJobs : [];
    const runningIds = new Set(running.map((j) => j.jobId));
    const recent = (Array.isArray(st.recentJobs) ? st.recentJobs : []).filter(
      (j) => j && j.status !== "running" && !runningIds.has(j.jobId)
    );
    return { running, recent: recent.slice(0, 30), interrupted: Array.isArray(st.interruptedJobs) ? st.interruptedJobs : [] };
  }

  function resolveUpstream(job) {
    if (!job) return { label: "", iconKey: "generic" };
    const c = job.client && typeof job.client === "object" ? job.client : null;
    const matched = c?.clientId ? findClient(c.clientId) : null;
    const label = matched?.name || c?.clientLabel || job.upstreamClientLabel || "";
    const iconKey = normalizeClientIconKey(matched?.iconKey || c?.iconKey || label || "generic");
    return { label, iconKey };
  }

  function findSummary(jobId) {
    if (!jobId) return null;
    const { running, recent, interrupted } = allJobsList();
    return (
      running.find((j) => j.jobId === jobId) ||
      recent.find((j) => j.jobId === jobId) ||
      interrupted.find((j) => j.jobId === jobId) ||
      null
    );
  }

  function ensureSelection() {
    const { running, recent, interrupted } = allJobsList();
    const all = [...running, ...recent, ...interrupted];
    if (!all.length) {
      view.selectedJobId = "";
      view.detail = null;
      view.detailJobId = "";
      return;
    }
    const stillExists = view.selectedJobId && all.some((j) => j.jobId === view.selectedJobId);
    if (!stillExists) {
      const next = running[0] || recent[0] || interrupted[0];
      if (next) selectJob(next.jobId, { auto: true });
    }
  }

  function selectJob(jobId, { auto = false } = {}) {
    if (!jobId) return;
    const changed = view.selectedJobId !== jobId;
    view.selectedJobId = jobId;
    if (changed) {
      view.detail = null;
      view.detailJobId = "";
      view.detailSignature = "";
      view.error = "";
      view.streamScrollTop = 0;
      const summary = findSummary(jobId);
      const isRunning = summary?.status === "running";
      view.autoFollow = isRunning;
      view.forceScrollBottom = isRunning;
    }
    void fetchDetail(jobId, { silent: auto && !changed });
    if (!auto) scheduleRender();
  }

  async function fetchDetail(jobId, { silent = false } = {}) {
    if (!jobId) return;
    const seq = ++view.fetchSeq;
    if (!silent && view.detailJobId !== jobId) {
      view.loading = true;
      view.error = "";
      scheduleRender();
    }
    try {
      const res = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (seq !== view.fetchSeq || view.selectedJobId !== jobId) return;
      if (res?.ok && res.job) {
        const j = res.job;
        const lastAct = j.activities?.length ? j.activities[j.activities.length - 1] : null;
        const sig = [
          j.jobId,
          j.status,
          j.modelDisplayName,
          j.activities?.length || 0,
          lastAct?.status || "",
          lastAct?.summary?.length || 0,
          lastAct?.detail?.length || 0,
          j.finalText?.length || 0,
          j.error?.length || 0,
          j.hitRate ?? "",
        ].join("|");
        const prevSig = view.detailSignature;
        view.detail = j;
        view.detailJobId = jobId;
        view.detailSignature = sig;
        view.error = "";
        view.loading = false;
        if (!silent || sig !== prevSig) scheduleRender();
      } else {
        view.loading = false;
        view.error = res?.error || L("任务日志加载失败", "Failed to load job log");
        scheduleRender();
      }
    } catch (err) {
      if (seq !== view.fetchSeq || view.selectedJobId !== jobId) return;
      view.loading = false;
      view.error = err?.message || L("任务日志加载失败", "Failed to load job log");
      scheduleRender();
    }
  }

  function onStateUpdated() {
    ensureSelection();
    if (view.selectedJobId) {
      const summary = findSummary(view.selectedJobId);
      if (summary?.status === "running" || view.detailJobId !== view.selectedJobId) {
        void fetchDetail(view.selectedJobId, { silent: true });
      }
    }
  }

  function captureScroll() {
    const rail = document.querySelector('[data-act-rail="1"]');
    if (rail) view.railScrollTop = rail.scrollTop;
    const stream = document.querySelector('[data-act-stream="1"]');
    if (stream) {
      view.streamScrollTop = stream.scrollTop;
      const dist = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      view.autoFollow = dist <= 56;
    }
  }

  function syncJumpButton(stream) {
    const btn = document.querySelector('[data-act-jump="1"]');
    if (!btn || !stream) return;
    const dist = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    const scrollable = stream.scrollHeight > stream.clientHeight + 72;
    btn.classList.toggle("visible", scrollable && dist > 64);
  }

  function restoreScroll() {
    const rail = document.querySelector('[data-act-rail="1"]');
    if (rail) rail.scrollTop = view.railScrollTop;

    const stream = document.querySelector('[data-act-stream="1"]');
    if (!stream) return;

    if (view.forceScrollBottom || view.autoFollow) {
      stream.scrollTop = stream.scrollHeight;
      view.streamScrollTop = stream.scrollTop;
      view.forceScrollBottom = false;
    } else {
      stream.scrollTop = view.streamScrollTop;
    }
    syncJumpButton(stream);

    if (!stream.dataset.scrollBound) {
      stream.dataset.scrollBound = "1";
      stream.addEventListener(
        "scroll",
        () => {
          view.streamScrollTop = stream.scrollTop;
          const dist = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
          view.autoFollow = dist <= 56;
          syncJumpButton(stream);
        },
        { passive: true }
      );
    }
  }

  function stepGroupSummary(group) {
    const parts = [];
    if (group.counts.edit > 0) {
      parts.push(isEn() ? `Edited ${group.counts.edit} file${group.counts.edit > 1 ? "s" : ""}` : `编辑了 ${group.counts.edit} 个文件`);
    }
    if (group.counts.cmd > 0) {
      parts.push(isEn() ? `Ran ${group.counts.cmd} command${group.counts.cmd > 1 ? "s" : ""}` : `运行了 ${group.counts.cmd} 条命令`);
    }
    if (group.counts.read > 0) {
      parts.push(isEn() ? `Inspected ${group.counts.read} item${group.counts.read > 1 ? "s" : ""}` : `读取/检索 ${group.counts.read} 项`);
    }
    if (!parts.length) return L("执行步骤", "Steps");
    const joined = parts.join(isEn() ? " · " : " · ");
    return group.running ? `${joined}…` : joined;
  }

  function renderCrashStrip(interrupted) {
    if (!interrupted.length) return "";
    return `<div class="act-crash">
      <div class="act-crash-head">
        ${iconSvg("alert", 13)}
        <span>${esc(L(`崩溃恢复 · ${interrupted.length}`, `Interrupted · ${interrupted.length}`))}</span>
        <button class="link-btn" style="margin-left:auto;font-size:10.5px" data-action="dismiss-interrupted">${esc(L("全部忽略", "Dismiss all"))}</button>
      </div>
      ${interrupted
        .slice(0, 4)
        .map(
          (job) => `<div class="act-crash-row">
            <button class="act-crash-open truncate" data-action="act-select" data-job="${esc(job.jobId)}">${esc(job.title || job.jobId)}</button>
            <button class="chip-btn" data-action="dismiss-interrupted" data-job="${esc(job.jobId)}" title="${esc(L("忽略", "Dismiss"))}">×</button>
          </div>`
        )
        .join("")}
    </div>`;
  }

  function renderRailItem(job) {
    const running = job.status === "running";
    const selected = job.jobId === view.selectedJobId;
    const role = job.role === "hephaestus" ? "hephaestus" : "oracle";
    const upstream = resolveUpstream(job);
    const st = statusTag(job.status);

    const statusBadge = running
      ? `<span class="act-live-dot" title="${esc(st.label)}"></span>`
      : job.status === "failed"
      ? `<span class="act-dot-fail" title="${esc(st.label)}"></span>`
      : job.status === "interrupted"
      ? `<span class="act-dot-warn" title="${esc(st.label)}"></span>`
      : `<span class="act-dot-done" title="${esc(st.label)}"></span>`;

    return `<button class="act-item ${selected ? "selected" : ""} ${running ? "running" : ""}" data-action="act-select" data-job="${esc(job.jobId)}" aria-current="${selected ? "true" : "false"}">
      <div class="act-item-top">
        <span class="job-role ${role} act-role-sm">${esc(roleName(role))}</span>
        <span class="act-item-title truncate">${esc(job.title || job.jobId)}</span>
        ${statusBadge}
      </div>
      <div class="act-item-meta">
        ${upstream.label
          ? `<span class="act-source-chip">
              <span class="act-source-ico">${clientIconSvg(upstream.iconKey, 12)}</span>
              <span class="truncate">${esc(upstream.label)}</span>
            </span>`
          : ""}
        <span class="mono nums">${esc(fmtElapsedSec(job.elapsedSec))}</span>
        <span class="sep">·</span>
        <span class="truncate">${esc(fmtRelative(job.startedAt))}</span>
      </div>
    </button>`;
  }

  function renderRail(running, recent, interrupted) {
    const retentionDays = Number(getState()?.settings?.retentionDays ?? 30);
    const retentionText =
      retentionDays > 0
        ? L(`最近 30 条 · 磁盘保留 ${retentionDays} 天`, `Last 30 jobs · ${retentionDays}d on disk`)
        : L("最近 30 条 · 磁盘永久保留", "Last 30 jobs · kept forever");

    const showRecent = view.filter !== "running";
    const hasAny = running.length > 0 || recent.length > 0;

    return `<aside class="act-rail">
      <div class="act-rail-head">
        <div class="seg" role="group">
          <button class="seg-btn ${view.filter === "all" ? "active" : ""}" data-action="act-filter" data-filter="all">${esc(L("全部", "All"))} <span class="act-count nums">${running.length + recent.length}</span></button>
          <button class="seg-btn ${view.filter === "running" ? "active" : ""}" data-action="act-filter" data-filter="running">${esc(L("运行中", "Live"))} <span class="act-count nums">${running.length}</span></button>
        </div>
      </div>
      <div class="act-rail-list" data-act-rail="1">
        ${renderCrashStrip(interrupted)}
        ${running.length
          ? `<div class="act-rail-sec">
              <div class="act-rail-label"><span class="nav-dot"></span><span>${esc(L("运行中", "Running"))}</span><span class="nums">${running.length}</span></div>
              <div class="act-rail-group">${running.map(renderRailItem).join("")}</div>
            </div>`
          : view.filter === "running"
          ? `<div class="empty-state" style="padding:26px 12px">${esc(L("当前没有运行中的任务", "No running jobs"))}</div>`
          : ""}
        ${showRecent && recent.length
          ? `<div class="act-rail-sec">
              <div class="act-rail-label"><span>${esc(L("最近任务", "Recent"))}</span><span class="nums">${recent.length}</span></div>
              <div class="act-rail-group">${recent.map(renderRailItem).join("")}</div>
            </div>`
          : ""}
        ${!hasAny && view.filter === "all"
          ? `<div class="empty-state" style="padding:36px 14px">
              <div class="empty-icon">${iconSvg("history", 18)}</div>
              <div style="font-weight:600;color:var(--ink);margin-bottom:4px">${esc(L("暂无任务记录", "No jobs yet"))}</div>
              <div>${esc(L("上游 AI 委派白泽或祝融后，这里会像聊天室一样实时呈现进度。", "Once an upstream AI delegates to Oracle or Hephaestus, live execution streams appear here."))}</div>
            </div>`
          : ""}
      </div>
      <div class="act-rail-foot">${esc(retentionText)}</div>
    </aside>`;
  }

  function renderStepGroup(jobId, group) {
    const fullKey = `${jobId}:${group.key}`;
    const open = view.expandedGroups.has(fullKey);
    const summary = stepGroupSummary(group);
    const hasError = group.items.some((x) => x.raw.exitCode != null && x.raw.exitCode !== 0);

    return `<div class="act-step-group ${open ? "open" : ""} ${group.running ? "running" : ""}">
      <button class="act-step-toggle" data-action="act-toggle-group" data-key="${esc(fullKey)}" aria-expanded="${open}">
        <span class="act-step-ico">${group.running ? iconSvg("refresh", 13) : iconSvg("terminal", 13)}</span>
        <span class="act-step-summary">${esc(summary)}</span>
        ${hasError ? `<span class="tag red" style="height:17px;font-size:10px">${esc(L("含异常退出", "non-zero"))}</span>` : ""}
        <span class="act-step-chev">${iconSvg("chevron", 13)}</span>
      </button>
      ${open
        ? `<div class="act-step-body">
            ${group.items
              .map(({ cls, raw, key }) => {
                const stepKey = `${jobId}:${key}`;
                const stepOpen = view.expandedSteps.has(stepKey);
                const label = raw.title || raw.summary || cls;
                const dur = raw.durationSec != null ? fmtDuration(Number(raw.durationSec) * 1000) : "";
                const badExit = raw.exitCode != null && raw.exitCode !== 0;
                const detail = normText(raw.detail || "").trim();
                const iconName = cls === "edit" ? "edit" : cls === "cmd" ? "terminal" : "search";
                return `<div class="act-step-row ${badExit ? "fail" : ""}">
                  <button class="act-step-row-btn" data-action="act-toggle-step" data-key="${esc(stepKey)}" ${detail ? "" : "disabled"}>
                    <span class="act-step-row-ico">${iconSvg(iconName, 12)}</span>
                    <span class="act-step-cmd truncate">${esc(label)}</span>
                    ${dur ? `<span class="act-step-meta nums">${esc(dur)}</span>` : ""}
                    ${raw.exitCode != null ? `<span class="act-step-exit ${badExit ? "fail" : ""}">exit ${esc(raw.exitCode)}</span>` : ""}
                  </button>
                  ${stepOpen && detail ? `<pre class="act-step-detail">${esc(detail)}</pre>` : ""}
                </div>`;
              })
              .join("")}
          </div>`
        : ""}
    </div>`;
  }

  function renderPane() {
    if (!view.selectedJobId) {
      return `<section class="act-pane act-pane-empty">
        <div class="empty-state">
          <div class="empty-icon">${iconSvg("activity", 18)}</div>
          <div style="font-size:13.5px;font-weight:620;color:var(--ink);margin-bottom:4px">${esc(L("选择一个任务查看执行过程", "Select a job to inspect"))}</div>
          <div style="max-width:360px;margin:0 auto">${esc(L("右侧会以聊天室流式视图展示子 Agent 的思考、命令折叠组与最终回复。", "The right canvas streams the subagent's prose, collapsible command groups, and final response."))}</div>
        </div>
      </section>`;
    }

    const summary = findSummary(view.selectedJobId);
    const job = view.detailJobId === view.selectedJobId && view.detail ? view.detail : summary;
    const role = job?.role === "hephaestus" ? "hephaestus" : "oracle";
    const status = statusTag(job?.status || "running");
    const running = job?.status === "running";
    const upstream = resolveUpstream(job || summary);
    const modelName = job?.modelDisplayName || job?.modelId || job?.engine || "";
    const workspaceName = basenameOf(job?.cwd);
    const hitRate = job?.hitRate;

    const head = `<header class="act-head">
      <div class="act-head-main">
        <div class="act-head-title-row">
          <span class="job-role ${role}">${esc(roleName(role))}</span>
          <h2 class="act-head-title truncate">${esc(job?.title || view.selectedJobId)}</h2>
          ${upstream.label
            ? `<span class="act-upstream-pill">
                <span class="act-source-ico">${clientIconSvg(upstream.iconKey, 13)}</span>
                <span>${esc(L(`来自 ${upstream.label}`, `From ${upstream.label}`))}</span>
              </span>`
            : ""}
        </div>
        <div class="act-head-meta">
          ${modelName ? `<span class="mono truncate" title="${esc(modelName)}">${esc(modelName)}</span>` : ""}
          ${hitRate != null ? `<span class="sep">·</span><span class="act-cache-pill nums">${esc(L("缓存", "Cache"))} ${esc(fmtPct(hitRate, 1))}</span>` : ""}
          ${job?.elapsedSec != null ? `<span class="sep">·</span><span class="mono nums">${esc(fmtElapsedSec(job.elapsedSec))}</span>` : ""}
          ${running && job?.silentSec != null ? `<span class="sep">·</span><span>${esc(L("静默", "Silent"))} ${esc(fmtElapsedSec(job.silentSec))}</span>` : ""}
          ${workspaceName ? `<span class="sep">·</span><span class="mono" title="${esc(job.cwd || "")}">${esc(workspaceName)}</span>` : ""}
        </div>
      </div>
      <div class="act-head-actions">
        <span class="tag ${status.cls}">${esc(status.label)}</span>
        ${running ? `<button class="btn xs danger" data-action="stop-job" data-job="${esc(view.selectedJobId)}">${iconSvg("stop")} ${esc(L("停止", "Stop"))}</button>` : ""}
        ${job?.finalText ? `<button class="btn xs" data-action="act-copy-final">${iconSvg("copy")} ${esc(L("复制回复", "Copy reply"))}</button>` : ""}
      </div>
    </header>`;

    let streamBody = "";
    if (view.loading && !view.detail) {
      streamBody = `<div class="empty-state" style="padding:48px 18px">${esc(L("正在加载执行流…", "Loading execution stream…"))}</div>`;
    } else if (view.error && !view.detail) {
      streamBody = `<div class="empty-state" style="color:var(--red);padding:48px 18px">${esc(view.error)}</div>`;
    } else {
      const promptText = normText(job?.prompt || "").trim();
      const promptLong = promptText.length > 210 || promptText.split("\n").length > 3;
      const promptExpanded = view.expandedPrompts.has(view.selectedJobId);

      const promptCard = promptText
        ? `<div class="act-prompt ${promptExpanded || !promptLong ? "expanded" : "clamped"}">
            <div class="act-prompt-head">
              ${upstream.label ? `<span class="act-source-ico">${clientIconSvg(upstream.iconKey, 14)}</span>` : iconSvg("user", 13)}
              <span class="act-prompt-label">${esc(upstream.label ? L(`${upstream.label} 派发指令`, `Prompt from ${upstream.label}`) : L("主 Agent 指令", "Lead agent prompt"))}</span>
              ${promptLong
                ? `<button class="link-btn" style="margin-left:auto" data-action="act-toggle-prompt" data-job="${esc(view.selectedJobId)}">${esc(promptExpanded ? L("收起", "Collapse") : L("展开完整指令", "Expand prompt"))}</button>`
                : ""}
            </div>
            <div class="act-prompt-body">${esc(promptText)}</div>
          </div>`
        : "";

      const blocks = buildStreamBlocks(job?.activities || []);
      const feedParts = [];
      let lastProseText = "";

      for (const blk of blocks) {
        if (blk.type === "steps") {
          feedParts.push(renderStepGroup(view.selectedJobId, blk));
        } else if (blk.type === "thought") {
          const tKey = `${view.selectedJobId}:${blk.key}`;
          const open = view.expandedThoughts.has(tKey);
          feedParts.push(`<div class="act-thought ${open ? "open" : ""}">
            <button class="act-thought-btn" data-action="act-toggle-thought" data-key="${esc(tKey)}" aria-expanded="${open}">
              ${iconSvg("spark", 12)}
              <span>${esc(L("思考过程", "Reasoning"))}</span>
              <span class="act-step-chev">${iconSvg("chevron", 12)}</span>
            </button>
            ${open ? `<div class="act-thought-body">${esc(blk.text)}</div>` : ""}
          </div>`);
        } else if (blk.type === "prose") {
          lastProseText = blk.text;
          feedParts.push(`<div class="act-prose">${renderMarkdown(esc, blk.text)}</div>`);
        } else if (blk.type === "notice") {
          feedParts.push(`<div class="act-notice">${iconSvg("zap", 12)}<span>${esc(blk.text)}</span></div>`);
        } else if (blk.type === "error") {
          feedParts.push(`<div class="act-error">${iconSvg("alert", 14)}<span>${esc(blk.text)}</span></div>`);
        }
      }

      const { body: finalBody, footer: finalFooter } = splitAstandFooter(job?.finalText || "");
      const showFinal = Boolean(finalBody && finalBody !== lastProseText.trim());

      const finalHtml = showFinal
        ? `<div class="act-final">
            <div class="act-final-head">
              <span class="job-role ${role} act-role-sm">${esc(roleName(role))}</span>
              <span>${esc(L("最终回复", "Final response"))}</span>
            </div>
            <div class="act-prose">${renderMarkdown(esc, finalBody)}</div>
            ${finalFooter ? `<div class="act-final-foot mono">${esc(finalFooter)}</div>` : ""}
          </div>`
        : finalFooter
        ? `<div class="act-final-foot mono" style="margin-top:4px">${esc(finalFooter)}</div>`
        : "";

      const errHtml =
        job?.error && !blocks.some((b) => b.type === "error" && b.text.includes(job.error.slice(0, 40)))
          ? `<div class="act-error">${iconSvg("alert", 14)}<span>${esc(formatErrorSnippet(job.error))}</span></div>`
          : "";

      const liveFooter = running
        ? `<div class="act-live-status">
            <span class="nav-dot"></span>
            <span>${esc(L(`${roleName(role)}正在执行中…`, `${roleName(role)} is working…`))}</span>
            ${job?.silentSec != null ? `<span class="mono nums">${esc(L(`静默 ${fmtElapsedSec(job.silentSec)}`, `quiet ${fmtElapsedSec(job.silentSec)}`))}</span>` : ""}
          </div>`
        : !feedParts.length && !finalHtml && !errHtml
        ? `<div class="empty-state" style="padding:36px 12px">${esc(L("暂无步骤输出记录", "No execution steps recorded"))}</div>`
        : "";

      streamBody = `<div class="act-stream-inner">
        ${promptCard}
        <div class="act-feed">${feedParts.join("")}</div>
        ${errHtml}
        ${finalHtml}
        ${liveFooter}
      </div>`;
    }

    return `<section class="act-pane">
      ${head}
      <div class="act-stream" data-act-stream="1">${streamBody}</div>
      <button class="act-jump-btn" data-act-jump="1" data-action="act-jump-bottom" title="${esc(L("回到最新", "Jump to latest"))}" aria-label="${esc(L("回到最新", "Jump to latest"))}">
        ${iconSvg("arrowDown", 16)}
      </button>
    </section>`;
  }

  function renderPage() {
    ensureSelection();
    const { running, recent, interrupted } = allJobsList();
    return `<div class="act-shell">
      ${renderRail(running, recent, interrupted)}
      ${renderPane()}
    </div>`;
  }

  async function handleAction(action, target) {
    if (action === "act-select") {
      const jobId = target.dataset.job;
      if (jobId) selectJob(jobId);
      return true;
    }
    if (action === "act-filter") {
      const next = target.dataset.filter === "running" ? "running" : "all";
      view.filter = next;
      scheduleRender();
      return true;
    }
    if (action === "act-toggle-prompt") {
      const jobId = target.dataset.job || view.selectedJobId;
      if (view.expandedPrompts.has(jobId)) view.expandedPrompts.delete(jobId);
      else view.expandedPrompts.add(jobId);
      scheduleRender();
      return true;
    }
    if (action === "act-toggle-group") {
      const key = target.dataset.key;
      if (!key) return true;
      if (view.expandedGroups.has(key)) view.expandedGroups.delete(key);
      else view.expandedGroups.add(key);
      scheduleRender();
      return true;
    }
    if (action === "act-toggle-step") {
      const key = target.dataset.key;
      if (!key) return true;
      if (view.expandedSteps.has(key)) view.expandedSteps.delete(key);
      else view.expandedSteps.add(key);
      scheduleRender();
      return true;
    }
    if (action === "act-toggle-thought") {
      const key = target.dataset.key;
      if (!key) return true;
      if (view.expandedThoughts.has(key)) view.expandedThoughts.delete(key);
      else view.expandedThoughts.add(key);
      scheduleRender();
      return true;
    }
    if (action === "act-jump-bottom") {
      view.autoFollow = true;
      const stream = document.querySelector('[data-act-stream="1"]');
      if (stream) {
        stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
        syncJumpButton(stream);
      }
      return true;
    }
    if (action === "act-copy-final") {
      const text = view.detail?.finalText || "";
      if (text) void copyText(text, L("已复制回复", "Reply copied"));
      return true;
    }
    return false;
  }

  return {
    renderPage,
    handleAction,
    onStateUpdated,
    captureScroll,
    restoreScroll,
    selectJob,
    refreshSelected: () => {
      if (view.selectedJobId) void fetchDetail(view.selectedJobId, { silent: true });
    },
    getSelectedJobId: () => view.selectedJobId,
  };
}
