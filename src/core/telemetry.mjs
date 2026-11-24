import fs from "node:fs";
import path from "node:path";

/**
 * Normalize upstream provider token usage without fabrication.
 * - OpenAI / Codex / DeepSeek: inputTokens ALREADY includes cachedInputTokens.
 * - Anthropic / Claude Code: input_tokens EXCLUDES cache_read and cache_creation.
 * - Generic ACP: report only what upstream actually returned; null if unreported.
 */
export function normalizeUsage(engine, raw) {
  if (!raw || typeof raw !== "object") {
    return {
      cacheReported: false,
      totalInputTokens: null,
      cachedInputTokens: null,
      cacheWriteTokens: null,
      outputTokens: null,
      hitRate: null,
      contextWindow: null,
      contextPct: null,
    };
  }

  const contextWindow = numOrNull(raw.contextWindow ?? raw.modelContextWindow);

  if (engine === "claude-code" || engine === "anthropic") {
    const uncached = numOrNull(raw.input_tokens ?? raw.inputTokens);
    const cacheRead = numOrNull(raw.cache_read_input_tokens ?? raw.cachedInputTokens);
    const cacheWrite = numOrNull(raw.cache_creation_input_tokens ?? raw.cacheWriteInputTokens);
    const outputTokens = numOrNull(raw.output_tokens ?? raw.outputTokens);

    if (uncached === null && cacheRead === null) {
      return {
        cacheReported: false,
        totalInputTokens: null,
        cachedInputTokens: null,
        cacheWriteTokens: null,
        outputTokens,
        hitRate: null,
        contextWindow,
        contextPct: null,
      };
    }
    const totalInput = (uncached || 0) + (cacheRead || 0) + (cacheWrite || 0);
    const cacheReported = cacheRead !== null && totalInput > 0;
    const hitRate = cacheReported ? round1((cacheRead / totalInput) * 100) : null;
    const contextPct =
      contextWindow && totalInput > 0 ? round1((totalInput / contextWindow) * 100) : null;
    return {
      cacheReported,
      totalInputTokens: totalInput,
      cachedInputTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens,
      hitRate,
      contextWindow,
      contextPct,
    };
  }

  // OpenAI / Codex / DeepSeek / OpenAI-compatible ACP
  const totalInput = numOrNull(
    raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokens
  );
  const cachedInput = numOrNull(
    raw.cachedInputTokens ??
      raw.cached_input_tokens ??
      raw.prompt_cache_hit_tokens ??
      raw.prompt_tokens_details?.cached_tokens ??
      raw.cachedTokens
  );
  const cacheWrite = numOrNull(raw.cacheWriteInputTokens ?? raw.cache_write_input_tokens);
  const outputTokens = numOrNull(
    raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens ?? raw.completionTokens
  );

  const cacheReported = totalInput !== null && totalInput > 0 && cachedInput !== null;
  const hitRate = cacheReported ? round1((cachedInput / totalInput) * 100) : null;
  const contextPct =
    contextWindow && totalInput !== null && totalInput > 0
      ? round1((totalInput / contextWindow) * 100)
      : null;

  return {
    cacheReported,
    totalInputTokens: totalInput,
    cachedInputTokens: cachedInput,
    cacheWriteTokens: cacheWrite,
    outputTokens,
    hitRate,
    contextWindow,
    contextPct,
  };
}

function numOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export class TelemetryLogger {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.logPath = path.join(this.dataDir, "telemetry.jsonl");
  }

  record(entry) {
    const line = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(this.logPath, JSON.stringify(line) + "\n", "utf8");
    return line;
  }

  readAll() {
    if (!fs.existsSync(this.logPath)) return [];
    const text = fs.readFileSync(this.logPath, "utf8");
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t));
      } catch {}
    }
    return rows;
  }

  clear() {
    if (fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, "", "utf8");
    }
  }

  getSummary(recentLimit = 30) {
    const rows = this.readAll();
    let totalTurns = rows.length;
    let reportedTurns = 0;
    let sumInput = 0;
    let sumCached = 0;
    let sumOutput = 0;
    let lastReportedHitRate = null;
    let latestContextPct = null;

    for (const r of rows) {
      if (typeof r.outputTokens === "number") sumOutput += r.outputTokens;
      if (r.cacheReported && typeof r.totalInputTokens === "number" && typeof r.cachedInputTokens === "number") {
        reportedTurns++;
        sumInput += r.totalInputTokens;
        sumCached += r.cachedInputTokens;
        if (typeof r.hitRate === "number") lastReportedHitRate = r.hitRate;
      }
      if (typeof r.contextPct === "number") latestContextPct = r.contextPct;
    }

    const cumulativeHitRate = sumInput > 0 ? round1((sumCached / sumInput) * 100) : null;
    const recent = rows.slice(-recentLimit).reverse();
    const chartPoints = rows.slice(-20).map((r) => ({
      ts: r.ts,
      role: r.role,
      engine: r.engine,
      hitRate: r.cacheReported ? r.hitRate : null,
      cacheReported: Boolean(r.cacheReported),
    }));

    return {
      logPath: this.logPath,
      totalTurns,
      reportedTurns,
      lastHitRate: lastReportedHitRate,
      cumulativeHitRate,
      totalCachedTokens: sumCached,
      totalInputTokens: sumInput,
      totalOutputTokens: sumOutput,
      latestContextPct,
      chartPoints,
      recent,
    };
  }
}
