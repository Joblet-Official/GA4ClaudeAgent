/**
 * Brain 6 — Visualisation / Reporting (gold-standard template).
 *
 * Turns Brain 5's data_blocks into a finished, self-contained HTML report that
 * follows the approved exemplar design language
 * (reports/2026-06-03_163959_organic-traffic-v2-newrules.html):
 *   context strip · premise-check callout · stage heads (Overview → Breakdowns
 *   → Behavior) · per-block "Why this step" logic boxes · templated captions ·
 *   comparison tables with heat shading, delta pills and membership tags ·
 *   paired-bar SVGs · two-series temporal chart + heat day table · funnel with
 *   step-to-step conversion and most-moved step · Notes & caveats.
 *
 * Division of labour is unchanged:
 *   - LLM (DeepSeek Pro) emits a report SPEC (sections, components, neutral
 *     narrative) — never data values.
 *   - The DETERMINISTIC renderer computes captions/pills/heat from Brain 5's
 *     engine-computed rows. The LLM cannot fabricate a number anywhere.
 *   - A deterministic DEFAULT spec guarantees the gold-standard layout renders
 *     even when the LLM spec fails.
 */
import { promises as fs } from "fs";
import path from "path";
import { getClient, type Provider } from "@/lib/nvidia";
import { routeFor } from "@/lib/modelRouting";
import { withEscalation } from "@/lib/escalate";
import type { IntentOutput } from "@/schemas/intent";
import type { DataBlock, DataBlocksOutput } from "@/schemas/datahandling";
import {
  ReportSpec,
  type ReportSpec as ReportSpecT,
  type ComponentType,
  type StageName,
} from "@/schemas/visualisation";
import { BRAIN6_SYSTEM_PROMPT } from "@/brains/prompts/brain6_visualisation";

const BRAIN_KEY = "brain6";
const TEMPERATURE = 0.2;
const MAX_TOKENS = 4000;
const BRAIN6_TIMEOUT_MS = 150_000;
const SAMPLE_ROWS = 5;

export interface BrainTiming {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}

export type Brain6Source = "llm" | "deterministic_default";

export interface Brain6Result {
  html: string;
  spec: ReportSpecT;
  source: Brain6Source;
  llm: { ok: boolean; usedFallback?: boolean; error?: string; timing: BrainTiming };
  timing: { total_ms: number };
}

export interface ReportPeriod {
  startDate: string;
  endDate: string;
  name?: string;
}

export interface Brain6Input {
  blocks: DataBlocksOutput;
  intent?: IntentOutput;
  /** The user's question verbatim — shown in the context strip + premise check. */
  question?: string;
  /** Resolved date windows from the approved plan (current [+ baseline]). */
  periods?: ReportPeriod[];
  /** GA4 property id for the context strip. */
  propertyId?: string;
  /** Title fallback when no question is available. */
  title?: string;
  /** ISO-ish timestamp string for the report header (caller-supplied for determinism). */
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// Formatting helpers (deterministic)
// ---------------------------------------------------------------------------

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v: unknown): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return Number(v.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return esc(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function signed(v: number): string {
  return v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(Math.abs(v))}` : "0";
}

function signedPct(v: unknown): string {
  if (v === "" || v == null) return "—";
  const n = num(v);
  return n > 0 ? `+${fmt(n)}%` : n < 0 ? `−${fmt(Math.abs(n))}%` : "0%";
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "report"
  );
}

function deltaPill(v: unknown): string {
  if (v === "" || v == null) return `<span class="delta neutral">—</span>`;
  return `<span class="delta neutral">${typeof v === "string" ? esc(v) : signed(num(v))}</span>`;
}

function memTag(v: unknown): string {
  const s = String(v ?? "both");
  if (s === "both") return "both";
  return `<span class="mem-tag">${esc(s)}</span>`;
}

/** Heat shading for a "current" cell: navy alpha scaled by value/max. */
function heatStyle(v: number, max: number): string {
  if (max <= 0 || v <= 0) return "";
  const a = Math.max(0.06, Math.min(1, v / max));
  const ink = a > 0.55 ? "; color:#ffffff" : "";
  return ` class="num heat-cell" style="background: rgba(46,92,138,${a.toFixed(2)})${ink}"`;
}

// ---------------------------------------------------------------------------
// Gold-standard CSS (adapted from the approved exemplar)
// ---------------------------------------------------------------------------

const STYLE = `
:root{--bg:#ffffff;--ink:#1f2937;--muted:#6b7280;--rule:#e5e7eb;--navy:#2E5C8A;--navy-deep:#1f3f63;
--info-bg:#f8fafc;--info-ink:#2E5C8A;--accent:#f8fafc;--neutral-bg:#f8fafc;--neutral-line:#94a3b8;}
*{box-sizing:border-box;}
body{font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:32px 40px;max-width:1180px;}
h1{font-size:28px;font-weight:700;margin:0 0 4px;color:#1f2937;}
.subtitle{color:var(--muted);margin-bottom:12px;}
hr.rule{border:0;border-top:1px solid var(--navy);margin:12px 0 18px;}
.context-strip{display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 18px;}
.ctx{font-size:12px;padding:6px 12px;border:1px solid var(--rule);border-radius:8px;background:#fff;color:var(--ink);}
.ctx .k{color:var(--muted);margin-right:6px;}
.ctx.info{background:var(--info-bg);border-color:var(--info-ink);color:var(--info-ink);}
h2.stage-head{color:var(--navy);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;margin:34px 0 4px;border-bottom:2px solid var(--navy);padding-bottom:6px;}
section{margin:18px 0 26px;}
h3.block-title{color:var(--navy-deep);font-size:18px;font-weight:700;margin:18px 0 10px;}
h4.sub-h{color:var(--navy-deep);font-size:13px;font-weight:700;margin:16px 0 6px;}
.logic-box{background:var(--neutral-bg);border-left:4px solid var(--neutral-line);border-radius:0 6px 6px 0;padding:10px 14px;margin:0 0 12px;}
.logic-label{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;}
.logic-text{font-size:13px;color:#1f2937;}
.caption{color:#1f2937;font-size:13.5px;margin:0 0 14px;max-width:920px;}
table.report{width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px;}
table.report thead th{background:var(--navy-deep);color:#fff;font-weight:600;padding:8px 10px;text-align:left;white-space:nowrap;}
table.report th.num,table.report td.num{text-align:right;}
table.report tbody td{padding:7px 10px;border-bottom:1px solid var(--rule);}
table.report tbody tr.accent{background:var(--accent);}
table.report tbody tr.muted td{color:var(--muted);font-style:italic;}
.heat-cell{color:var(--ink);}
.callout{padding:8px 12px;margin:8px 0 12px;border-radius:4px;font-size:13px;}
.callout.neutral{background:var(--neutral-bg);color:#1f2937;border-left:3px solid var(--neutral-line);}
.delta{font-size:12px;padding:2px 8px;border-radius:999px;font-weight:600;display:inline-block;}
.delta.neutral{color:#1f2937;background:var(--neutral-bg);border:1px solid var(--neutral-line);}
.mem-tag{font-size:10.5px;font-weight:600;color:#1f2937;background:var(--neutral-bg);border:1px solid var(--neutral-line);border-radius:999px;padding:2px 9px;}
.step-tag{background:var(--neutral-bg);color:#1f2937;border:1px solid var(--neutral-line);font-size:10px;padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:.05em;margin-left:6px;}
.chart-wrap{margin:8px 0 6px;overflow-x:auto;}
.chart-wrap svg{display:block;max-width:100%;height:auto;}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:4px 0 8px;}
.legend .sw{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:2px;vertical-align:middle;}
section.deeper{border:1px solid #3730a3;border-top:4px solid #3730a3;border-radius:8px;padding:18px 22px;background:#f8fafc;}
.cond-tag{background:#3730a3;color:#fff;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 10px;border-radius:999px;margin-left:10px;vertical-align:middle;}
.path-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start;}
.col-count{font-size:11px;font-weight:600;color:var(--muted);background:#fff;border:1px solid var(--rule);border-radius:999px;padding:1px 8px;margin-left:8px;}
.page-card{border:1px solid var(--rule);border-radius:8px;padding:10px 12px;margin:0 0 10px;background:#fff;}
.page-path{font-family:"SFMono-Regular",Consolas,monospace;font-size:12px;font-weight:600;color:var(--navy);word-break:break-all;margin-bottom:6px;}
.vsr-badge{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.04em;color:#1f2937;background:var(--neutral-bg);border:1px solid var(--neutral-line);border-radius:999px;padding:2px 9px;margin-bottom:6px;}
.page-events{font-size:12px;color:var(--muted);}
@media (max-width:760px){.path-cols{grid-template-columns:1fr;}}
.kpi-row{display:flex;gap:18px;flex-wrap:wrap}
.kpi{padding:10px 16px;border:1px solid var(--rule);border-radius:8px;min-width:120px;background:#fff}
.kpi-val{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums}
.kpi-label{color:var(--muted);font-size:12px}
`;

const NAVY = "#2E5C8A";
const GRAY = "#94a3b8";

// ---------------------------------------------------------------------------
// Column classification (legacy components)
// ---------------------------------------------------------------------------

function classifyColumns(block: DataBlock): { dims: string[]; metrics: string[] } {
  const dims: string[] = [];
  const metrics: string[] = [];
  for (const c of block.columns) {
    const isNum = block.rows.length > 0 && block.rows.every((r) => typeof r[c] === "number");
    (isNum ? metrics : dims).push(c);
  }
  return { dims, metrics };
}

// ---------------------------------------------------------------------------
// Legacy components (single-range blocks; kept for descriptive reports)
// ---------------------------------------------------------------------------

function renderKpiCard(block: DataBlock): string {
  const { metrics } = classifyColumns(block);
  const row = block.rows[0] ?? {};
  const cards = metrics
    .map(
      (m) =>
        `<div class="kpi"><div class="kpi-val">${fmt(row[m])}</div><div class="kpi-label">${esc(m)}</div></div>`,
    )
    .join("");
  return `<div class="kpi-row">${cards || '<div class="caption">no metric</div>'}</div>`;
}

function renderTable(block: DataBlock): string {
  const cols = block.columns;
  const { metrics } = classifyColumns(block);
  const metricSet = new Set(metrics);
  const primary = metrics[0];
  const max = primary ? Math.max(0, ...block.rows.map((r) => num(r[primary]))) : 0;
  const head = cols.map((c) => `<th${metricSet.has(c) ? ' class="num"' : ""}>${esc(c)}</th>`).join("");
  const body = block.rows
    .map((r) => {
      const isOthers = cols.some((c) => String(r[c]) === "(others)");
      const cells = cols
        .map((c) => {
          if (metricSet.has(c) && c === primary) return `<td${heatStyle(num(r[c]), max)}>${fmt(r[c])}</td>`;
          return `<td${metricSet.has(c) ? ' class="num"' : ""}>${fmt(r[c])}</td>`;
        })
        .join("");
      return `<tr${isOthers ? ' class="muted"' : ""}>${cells}</tr>`;
    })
    .join("");
  return `<table class="report"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderBarChart(block: DataBlock): string {
  const { dims, metrics } = classifyColumns(block);
  const dim = dims[0];
  const metric = metrics[0];
  if (!dim || !metric) return renderTable(block);
  const rows = block.rows.slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => num(r[metric])));
  const rowH = 26;
  const H = rows.length * rowH + 10;
  const bars = rows
    .map((r, i) => {
      const y = 8 + i * rowH;
      const w = (num(r[metric]) / max) * 560;
      const others = String(r[dim]) === "(others)";
      return (
        `<text x="192" y="${y + 11}" font-size="11" fill="#1f2937" text-anchor="end">${esc(r[dim])}</text>` +
        `<rect x="200" y="${y}" width="${Math.max(w, 1).toFixed(1)}" height="14" fill="${others ? GRAY : NAVY}" rx="2"/>` +
        `<text x="${(206 + w).toFixed(1)}" y="${y + 11}" font-size="9.5" fill="#1f2937">${fmt(r[metric])}</text>`
      );
    })
    .join("");
  return `<div class="chart-wrap"><svg width="860" height="${H}" viewBox="0 0 860 ${H}" role="img">${bars}</svg></div>${renderTable(block)}`;
}

function renderLineChart(block: DataBlock): string {
  const { dims, metrics } = classifyColumns(block);
  const dim = dims[0];
  const metric = metrics[0];
  if (!dim || !metric || block.rows.length < 2) return renderTable(block);
  const W = 860;
  const H = 220;
  const P = 36;
  const vals = block.rows.map((r) => num(r[metric]));
  const max = Math.max(...vals, 1);
  const n = vals.length;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(n - 1, 1);
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${NAVY}"/>`).join("");
  const first = esc(block.rows[0]?.[dim]);
  const last = esc(block.rows[n - 1]?.[dim]);
  return `<div class="chart-wrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#6b7280" stroke-width="1"/>
<polyline fill="none" stroke="${NAVY}" stroke-width="2" points="${pts}"/>${dots}
<text x="${P}" y="${H - 10}" font-size="9" fill="#6b7280">${first}</text>
<text x="${W - P}" y="${H - 10}" font-size="9" fill="#6b7280" text-anchor="end">${last}</text>
<text x="${P}" y="${P - 8}" font-size="9" fill="#6b7280">max ${fmt(max)}</text>
</svg></div>`;
}

// ---------------------------------------------------------------------------
// Gold-standard components (comparison / temporal / funnel)
// ---------------------------------------------------------------------------

function legend(baseline: string, current: string): string {
  return `<div class="legend"><span><span class="sw" style="background:${GRAY}"></span>${esc(baseline)}</span><span><span class="sw" style="background:${NAVY}"></span>${esc(current)}</span></div>`;
}

/** Paired horizontal bars (baseline gray over current navy) for top rows. */
function pairedBars(rows: Array<{ label: string; baseline: number; current: number }>): string {
  const top = rows.slice(0, 5);
  if (!top.length) return "";
  const max = Math.max(1, ...top.flatMap((r) => [r.baseline, r.current]));
  const groupH = 46;
  const H = top.length * groupH + 16;
  const w = (v: number) => Math.max((v / max) * 578, 1);
  const parts = top
    .map((r, i) => {
      const yTop = 14 + i * groupH;
      return (
        `<text x="192" y="${yTop + 22}" font-size="11" fill="#1f2937" text-anchor="end">${esc(r.label)}</text>` +
        `<rect x="200" y="${yTop}" width="${w(r.baseline).toFixed(1)}" height="14" fill="${GRAY}" rx="2"/>` +
        `<text x="${(206 + w(r.baseline)).toFixed(1)}" y="${yTop + 11}" font-size="9.5" fill="#6b7280">${fmt(r.baseline)}</text>` +
        `<rect x="200" y="${yTop + 18}" width="${w(r.current).toFixed(1)}" height="14" fill="${NAVY}" rx="2"/>` +
        `<text x="${(206 + w(r.current)).toFixed(1)}" y="${yTop + 29}" font-size="9.5" fill="#1f2937">${fmt(r.current)}</text>`
      );
    })
    .join("");
  return `<div class="chart-wrap"><svg width="860" height="${H}" viewBox="0 0 860 ${H}" role="img">${parts}</svg></div>`;
}

function comparisonRows(block: DataBlock): Array<{ label: string; baseline: number; current: number }> {
  const keyCol = block.columns[0] ?? "metric";
  return block.rows.map((r) => ({
    label: String(r[keyCol] ?? ""),
    baseline: num(r.baseline),
    current: num(r.current),
  }));
}

function renderComparison(block: DataBlock, periodLabels: { baseline: string; current: string }): string {
  const dim = block.meta?.comparison?.dimension ?? null;
  const keyCol = block.columns[0] ?? "metric";
  const max = Math.max(0, ...block.rows.map((r) => num(r.current)));
  const hasMembership = block.columns.includes("membership");

  const head =
    `<th>${esc(dim ?? "Metric")}</th><th class="num">${esc(periodLabels.baseline)}</th><th class="num">${esc(periodLabels.current)}</th><th class="num">Δ abs</th><th class="num">Δ %</th>` +
    (hasMembership ? `<th>Membership</th>` : "");
  const body = block.rows
    .map((r) => {
      const isNotSet = String(r[keyCol]) === "(not set)";
      return (
        `<tr${isNotSet ? ' class="muted"' : ""}>` +
        `<td>${esc(r[keyCol])}</td>` +
        `<td class="num">${fmt(num(r.baseline))}</td>` +
        `<td${heatStyle(num(r.current), max)}>${fmt(num(r.current))}</td>` +
        `<td class="num">${deltaPill(r.delta_abs)}</td>` +
        `<td class="num">${deltaPill(signedPct(r.delta_pct))}</td>` +
        (hasMembership ? `<td>${memTag(r.membership)}</td>` : "") +
        `</tr>`
      );
    })
    .join("");

  const bars = dim ? legend(periodLabels.baseline, periodLabels.current) + pairedBars(comparisonRows(block)) : "";
  return `${bars}<table class="report"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderTemporal(block: DataBlock, periodLabels: { baseline: string; current: string }): string {
  const rows = block.rows;
  if (!rows.length) return `<p class="caption">No daily data.</p>`;
  const W = 860;
  const H = 300;
  const PL = 44;
  const PT = 20;
  const PB = 30;
  const cur = rows.map((r) => num(r.current));
  const base = rows.map((r) => num(r.baseline));
  const max = Math.max(...cur, ...base, 1);
  const n = rows.length;
  const x = (i: number) => PL + (i * (W - PL - 24)) / Math.max(n - 1, 1);
  const y = (v: number) => H - PB - (v / max) * (H - PT - PB);
  const line = (vals: number[], color: string) => {
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.2" fill="${color}"/>`).join("");
    return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/>${dots}`;
  };
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const gy = y(max * f);
      return `<line x1="${PL}" y1="${gy.toFixed(1)}" x2="${W - 24}" y2="${gy.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/><text x="${PL - 6}" y="${(gy + 3).toFixed(1)}" font-size="10" fill="#6b7280" text-anchor="end">${fmt(Math.round(max * f))}</text>`;
    })
    .join("");
  const xLabels = rows
    .filter((_, i) => i % 2 === 0)
    .map((r, j) => `<text x="${x(j * 2).toFixed(1)}" y="${H - 14}" font-size="9" fill="#6b7280" text-anchor="middle">${esc(r.day)}</text>`)
    .join("");

  const chart = `<div class="chart-wrap"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">${grid}<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#6b7280" stroke-width="1"/>${line(base, GRAY)}${line(cur, NAVY)}${xLabels}</svg></div>`;

  const maxCur = Math.max(0, ...cur);
  const tableBody = rows
    .map((r) => {
      const cv = num(r.current);
      const noData = cv === 0 && num(r.baseline) > 0;
      return `<tr${noData ? ' class="muted"' : ""}><td>${esc(r.day)}</td><td class="num">${fmt(num(r.baseline))}</td><td${cv > 0 ? heatStyle(cv, maxCur) : ' class="num"'}>${cv > 0 ? fmt(cv) : "—"}</td></tr>`;
    })
    .join("");
  const table = `<table class="report"><thead><tr><th>Day</th><th class="num">${esc(periodLabels.baseline)}</th><th class="num">${esc(periodLabels.current)}</th></tr></thead><tbody>${tableBody}</tbody></table>`;

  return legend(periodLabels.baseline, periodLabels.current) + chart + table;
}

function renderFunnel(block: DataBlock, periodLabels: { baseline: string; current: string }): string {
  const transitions = block.meta?.funnel?.transitions ?? [];
  const stepsRows = block.rows.map((r) => ({
    label: String(r.step ?? ""),
    baseline: num(r.baseline),
    current: num(r.current),
  }));

  const bars = legend(periodLabels.baseline, periodLabels.current) + pairedBars(stepsRows);

  const countsBody = stepsRows
    .map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${fmt(s.baseline)}</td><td class="num">${fmt(s.current)}</td></tr>`)
    .join("");
  const counts = `<h4 class="sub-h">Event counts by funnel step</h4><table class="report"><thead><tr><th>Funnel step</th><th class="num">${esc(periodLabels.baseline)}</th><th class="num">${esc(periodLabels.current)}</th></tr></thead><tbody>${countsBody}</tbody></table>`;

  const ratesBody = transitions
    .map(
      (t) =>
        `<tr${t.most_moved ? ' class="accent"' : ""}><td>${esc(t.label)}${t.most_moved ? '<span class="step-tag">most-moved step</span>' : ""}</td><td class="num">${fmt(t.baseline_rate)}</td><td class="num">${fmt(t.current_rate)}</td></tr>`,
    )
    .join("");
  const rates = transitions.length
    ? `<h4 class="sub-h">Step-to-step conversion</h4><table class="report"><thead><tr><th>Transition</th><th class="num">${esc(periodLabels.baseline)}</th><th class="num">${esc(periodLabels.current)}</th></tr></thead><tbody>${ratesBody}</tbody></table>`
    : "";

  const moved = transitions.find((t) => t.most_moved);
  const callout = moved
    ? `<div class="callout neutral">Most-moved step: ${esc(moved.label)} moved from ${fmt(moved.baseline_rate)} to ${fmt(moved.current_rate)} (${esc(periodLabels.baseline)} → ${esc(periodLabels.current)}).</div>`
    : "";

  return bars + callout + counts + rates;
}

function renderPath(block: DataBlock, periodLabels: { baseline: string; current: string }): string {
  const pageCol = block.columns[0] ?? "landingPage";
  const highlight = block.meta?.path?.highlight_event ?? "view_search_results";
  const card = (r: Record<string, string | number>) =>
    `<div class="page-card"><div class="page-path">${esc(r[pageCol])}</div>` +
    `<span class="vsr-badge">${esc(highlight)}: ${esc(r[highlight] ?? "no")}</span>` +
    `<div class="page-events">total events ${fmt(num(r.current))} (${esc(periodLabels.current)}) · ${fmt(num(r.baseline))} (${esc(periodLabels.baseline)})</div></div>`;

  const news = block.rows.filter((r) => String(r.membership) === "new").slice(0, 5);
  const gone = block.rows.filter((r) => String(r.membership) === "disappeared").slice(0, 5);
  const cols =
    news.length || gone.length
      ? `<div class="path-cols">
<div><h4 class="sub-h">New in ${esc(periodLabels.current)} <span class="col-count">${news.length}</span></h4>${news.map(card).join("") || '<p class="caption">none</p>'}</div>
<div><h4 class="sub-h">Disappeared from ${esc(periodLabels.baseline)} <span class="col-count">${gone.length}</span></h4>${gone.map(card).join("") || '<p class="caption">none</p>'}</div>
</div>`
      : "";

  // Top pages table (event totals + highlight presence).
  const top = block.rows.slice(0, 10);
  const max = Math.max(0, ...top.map((r) => num(r.current)));
  const body = top
    .map(
      (r) =>
        `<tr><td>${esc(r[pageCol])}</td><td class="num">${fmt(num(r.baseline))}</td><td${heatStyle(num(r.current), max)}>${fmt(num(r.current))}</td><td>${memTag(r.membership)}</td><td>${esc(r[highlight] ?? "no")}</td></tr>`,
    )
    .join("");
  const table = `<table class="report"><thead><tr><th>Entry page</th><th class="num">${esc(periodLabels.baseline)}</th><th class="num">${esc(periodLabels.current)}</th><th>Membership</th><th>${esc(highlight)}</th></tr></thead><tbody>${body}</tbody></table>`;

  return cols + table;
}

// ---------------------------------------------------------------------------
// Deterministic narrative: logic boxes + captions (values from block rows only)
// ---------------------------------------------------------------------------

const LOGIC_TEXT: Record<string, string> = {
  confirm: "Confirm the headline metric moved, and by how much, before localising anything.",
  decompose: "Split into cohorts to see whether the move sits on the new-user or returning-user side.",
  temporal: "Plot daily counts to surface gradual drift vs a step-change, and pinpoint any inflection.",
  breakdown: "Break the volume by this dimension to see whether the move concentrates or is broad-based.",
  structural: "Composition shift across the set between the two periods.",
  funnel: "Ordered domain funnel; step-to-step conversion rates show which step's rate moved between the two periods.",
  path: "On the top entry pages, render the event mix and check whether the search event fires there.",
  headline: "Establish the headline value for the requested metric.",
  timeseries: "Plot the metric over time to show its shape across the period.",
  other: "Supporting view for the question.",
};

function logicBox(block: DataBlock): string {
  const text = LOGIC_TEXT[block.purpose ?? "other"] ?? LOGIC_TEXT.other!;
  return `<div class="logic-box"><div class="logic-label">Why this step</div><div class="logic-text">${esc(text)}</div></div>`;
}

/** Templated caption — every number computed here from block rows. */
function caption(block: DataBlock, labels: { baseline: string; current: string }): string {
  let text = "";
  if (block.meta?.comparison && !block.meta.comparison.dimension) {
    const r = block.rows[0];
    if (r) {
      const b = num(r.baseline);
      const c = num(r.current);
      const d = c - b;
      const verb = d > 0 ? "rose" : d < 0 ? "fell" : "was flat";
      text = `${block.meta.comparison.metric} ${verb} from ${fmt(b)} (${labels.baseline}) to ${fmt(c)} (${labels.current}), ${signed(d)} (${signedPct(r.delta_pct)}).`;
    }
  } else if (block.meta?.comparison) {
    const movers = [...block.rows].sort((a, b) => Math.abs(num(b.delta_abs)) - Math.abs(num(a.delta_abs)));
    const keyCol = block.columns[0] ?? "key";
    const parts: string[] = [];
    for (const m of movers.slice(0, 2)) {
      const d = num(m.delta_abs);
      parts.push(`${String(m[keyCol])} ${d >= 0 ? "rose" : "fell"} ${fmt(num(m.baseline))} to ${fmt(num(m.current))} (${signed(d)})`);
    }
    const news = block.rows.filter((r) => String(r.membership) === "new").map((r) => String(r[keyCol]));
    if (news.length) parts.push(`new in ${labels.current}: ${news.slice(0, 3).join(", ")}`);
    const gone = block.rows.filter((r) => String(r.membership) === "disappeared").map((r) => String(r[keyCol]));
    if (gone.length) parts.push(`no longer present: ${gone.slice(0, 3).join(", ")}`);
    text = parts.join("; ") + ".";
  } else if (block.meta?.temporal) {
    const totalC = block.rows.reduce((s, r) => s + num(r.current), 0);
    const totalB = block.rows.reduce((s, r) => s + num(r.baseline), 0);
    const peak = [...block.rows].sort((a, b) => num(b.current) - num(a.current))[0];
    text = `Daily ${block.meta.temporal.metric}: ${labels.current} total ${fmt(totalC)} vs ${labels.baseline} total ${fmt(totalB)}.`;
    if (peak) text += ` Peak ${labels.current} day: ${String(peak.day)} (${fmt(num(peak.current))}).`;
    const zero = block.rows.filter((r) => num(r.current) === 0 && num(r.baseline) > 0).map((r) => String(r.day));
    if (zero.length) text += ` No ${labels.current} activity on day(s): ${zero.join(", ")}.`;
  } else if (block.meta?.funnel) {
    const parts = block.rows.map((r) => `${String(r.step)} ${fmt(num(r.baseline))} to ${fmt(num(r.current))}`);
    text = `Funnel step counts (${labels.baseline} → ${labels.current}): ${parts.join(", ")}.`;
  } else if (block.meta?.path) {
    const pageCol = block.columns[0] ?? "page";
    const highlight = block.meta.path.highlight_event;
    const firing = block.rows.filter((r) => String(r[highlight]) === "yes").map((r) => String(r[pageCol]));
    const news = block.rows.filter((r) => String(r.membership) === "new").length;
    const gone = block.rows.filter((r) => String(r.membership) === "disappeared").length;
    text = firing.length
      ? `${highlight} fires on ${firing.length} entry page(s) in ${labels.current}: ${firing.slice(0, 3).join(", ")}.`
      : `${highlight} fires on none of the top entry pages in ${labels.current}.`;
    if (news || gone) text += ` Entry-page set shifted: ${news} new, ${gone} disappeared.`;
  } else if (block.rows.length > 0) {
    text = `${block.rows.length} row(s).`;
  } else {
    text = "No rows returned.";
  }
  return `<p class="caption">${esc(text)}</p>`;
}

// ---------------------------------------------------------------------------
// Premise check (question wording vs confirm block direction)
// ---------------------------------------------------------------------------

interface Premise {
  asked: "down" | "up";
  observed: "down" | "up" | "flat";
  contradicted: boolean;
  text: string;
}

function premiseCheck(question: string | undefined, blocks: DataBlocksOutput): Premise | null {
  if (!question) return null;
  const q = question.toLowerCase();
  const asksDown = /\b(fall|fell|drop|dropped|decline|declined|decrease|decreased|down|lost|losing)\b/.test(q);
  const asksUp = /\b(rise|rose|grow|grew|increase|increased|spike|spiked|up|gain)\b/.test(q);
  if (!asksDown && !asksUp) return null;

  const confirm = blocks.blocks.find((b) => b.meta?.comparison && !b.meta.comparison.dimension);
  const r = confirm?.rows[0];
  if (!confirm || !r) return null;
  const b = num(r.baseline);
  const c = num(r.current);
  const d = c - b;
  const observed: Premise["observed"] = d > 0 ? "up" : d < 0 ? "down" : "flat";
  const asked: Premise["asked"] = asksDown ? "down" : "up";
  const contradicted = (asked === "down" && observed === "up") || (asked === "up" && observed === "down");
  const metric = confirm.meta!.comparison!.metric;
  const dirWord = observed === "up" ? "INCREASED" : observed === "down" ? "DECREASED" : "was FLAT";
  const text = contradicted
    ? `Observed direction: ${metric} ${dirWord} ${signed(d)} (${signedPct(r.delta_pct)}) over the period — the premise in the question is not borne out by the data. Stated neutrally.`
    : `Observed direction: ${metric} ${dirWord} ${signed(d)} (${signedPct(r.delta_pct)}) over the period.`;
  return { asked, observed, contradicted, text };
}

// ---------------------------------------------------------------------------
// Stage grouping + default spec
// ---------------------------------------------------------------------------

const PURPOSE_STAGE: Record<string, StageName> = {
  confirm: "Overview",
  decompose: "Overview",
  temporal: "Overview",
  headline: "Overview",
  timeseries: "Overview",
  breakdown: "Breakdowns",
  structural: "Breakdowns",
  funnel: "Behavior",
  path: "Behavior",
  other: "Other",
};

function stageOf(block: DataBlock): StageName {
  // Purpose wins when present; otherwise infer from engine metadata so stage
  // grouping survives a dropped/missing purpose field.
  const byPurpose = block.purpose ? PURPOSE_STAGE[block.purpose] : undefined;
  if (byPurpose) return byPurpose;
  if (block.meta?.funnel || block.meta?.path) return "Behavior";
  if (block.meta?.temporal) return "Overview";
  if (block.meta?.comparison) return block.meta.comparison.dimension ? "Breakdowns" : "Overview";
  return "Other";
}

function autoComponent(block: DataBlock): ComponentType {
  if (block.meta?.path) return "path";
  if (block.meta?.funnel) return "funnel";
  if (block.meta?.temporal) return "temporal";
  if (block.meta?.comparison) return "comparison";
  switch (block.block_type) {
    case "kpi":
      return "kpi_card";
    case "timeseries":
      return "line_chart";
    case "pivot":
      return "table";
    case "comparison":
      return "comparison";
    case "temporal":
      return "temporal";
    case "funnel":
      return "funnel";
    case "path":
      return "path";
    default:
      return "bar_chart";
  }
}

export function defaultSpec(blocks: DataBlocksOutput, title: string): ReportSpecT {
  const order: StageName[] = ["Overview", "Breakdowns", "Behavior", "Other"];
  const sorted = [...blocks.blocks].sort((a, b) => order.indexOf(stageOf(a)) - order.indexOf(stageOf(b)));
  const sections = sorted.map((b, i) => ({
    id: `s${i + 1}`,
    heading: b.title,
    stage: stageOf(b),
    blocks: [{ block_id: b.id, component: autoComponent(b) }],
    narrative: [],
  }));
  return ReportSpec.parse({
    title,
    subtitle: null,
    sections: sections.length ? sections : [{ id: "s1", heading: "Report", blocks: [], narrative: [] }],
    context_notes: [],
  });
}

// ---------------------------------------------------------------------------
// Full-report renderer
// ---------------------------------------------------------------------------

function periodLabelsFor(block: DataBlock, periods?: ReportPeriod[]): { baseline: string; current: string } {
  const current = periods?.find((p) => p.name === "current");
  const baseline = periods?.find((p) => p.name === "baseline" || p.name === "previous");
  return {
    current: current ? `${current.startDate} → ${current.endDate} (current)` : "current",
    baseline: baseline ? `${baseline.startDate} → ${baseline.endDate} (baseline)` : "baseline",
  };
}

function shortPeriodLabels(periods?: ReportPeriod[]): { baseline: string; current: string } {
  return { baseline: "baseline", current: "current" };
}

function renderComponent(block: DataBlock, component: ComponentType, labels: { baseline: string; current: string }): string {
  switch (component) {
    case "comparison":
      return renderComparison(block, labels);
    case "temporal":
      return renderTemporal(block, labels);
    case "funnel":
      return renderFunnel(block, labels);
    case "path":
      return renderPath(block, labels);
    case "kpi_card":
      return renderKpiCard(block);
    case "bar_chart":
      return renderBarChart(block);
    case "line_chart":
      return renderLineChart(block);
    case "table":
    default:
      return renderTable(block);
  }
}

export function renderReport(
  spec: ReportSpecT,
  blocks: DataBlocksOutput,
  generatedAt: string,
  opts?: { question?: string; periods?: ReportPeriod[]; propertyId?: string; intent?: IntentOutput },
): string {
  const byId = new Map(blocks.blocks.map((b) => [b.id, b]));
  const labels = shortPeriodLabels(opts?.periods);
  const premise = premiseCheck(opts?.question, blocks);

  // --- context strip ---
  const allFlags = [...new Set(blocks.blocks.flatMap((b) => b.flags))];
  const current = opts?.periods?.find((p) => p.name === "current") ?? opts?.periods?.[0];
  const baseline = opts?.periods?.find((p) => p.name === "baseline" || p.name === "previous");
  const ctx: string[] = [];
  if (opts?.question) ctx.push(`<span class="ctx"><span class="k">Question</span>${esc(opts.question)}</span>`);
  if (current) {
    const period = baseline
      ? `${current.startDate} → ${current.endDate} (current) vs ${baseline.startDate} → ${baseline.endDate} (baseline)`
      : `${current.startDate} → ${current.endDate}`;
    ctx.push(`<span class="ctx"><span class="k">Period</span>${esc(period)}</span>`);
  }
  if (opts?.propertyId) ctx.push(`<span class="ctx"><span class="k">Property</span>GA4 ${esc(opts.propertyId)}</span>`);
  const level = (opts?.intent as { analysis_level?: unknown } | undefined)?.analysis_level;
  if (typeof level === "string") ctx.push(`<span class="ctx"><span class="k">Level</span>${esc(level)}</span>`);
  const scope = opts?.intent?.scope as { regions?: string[] | null; filters_hint?: string[] } | undefined;
  if (scope) {
    const parts: string[] = [];
    if (scope.filters_hint?.length) parts.push(scope.filters_hint.join(", "));
    parts.push(scope.regions?.length ? `region = ${scope.regions.join(", ")}` : "region = all");
    ctx.push(`<span class="ctx"><span class="k">Scope</span>${esc(parts.join("; "))}</span>`);
  }
  const confirm = blocks.blocks.find((b) => b.meta?.comparison && !b.meta.comparison.dimension);
  const cr = confirm?.rows[0];
  if (cr) {
    ctx.push(`<span class="ctx"><span class="k">Sample</span>${fmt(num(cr.current))} current / ${fmt(num(cr.baseline))} baseline</span>`);
  }
  ctx.push(`<span class="ctx"><span class="k">Generated</span>${esc(generatedAt)}</span>`);
  for (const f of allFlags) ctx.push(`<span class="ctx info"><span class="k">⚑</span>${esc(f)}</span>`);
  if (!allFlags.includes("sampled")) ctx.push(`<span class="ctx info"><span class="k">⚑</span>Unsampled</span>`);
  if (premise?.contradicted && cr) {
    ctx.push(`<span class="ctx info"><span class="k">⚑</span>Premise not borne out: ${fmt(num(cr.baseline))} → ${fmt(num(cr.current))}</span>`);
  }

  const premiseCallout = premise ? `<div class="callout neutral">${esc(premise.text)}</div>` : "";

  // --- sections grouped by stage ---
  const stageOrder: StageName[] = ["Overview", "Breakdowns", "Behavior", "Other"];
  const byStage = new Map<StageName, string[]>();
  for (const s of spec.sections) {
    const firstBlock = s.blocks[0] ? byId.get(s.blocks[0].block_id) : undefined;
    const stage: StageName = s.stage ?? (firstBlock ? stageOf(firstBlock) : "Other");
    const narr = s.narrative.map((n) => `<p class="caption">${esc(n)}</p>`).join("");
    const body = s.blocks
      .map((sb) => {
        const block = byId.get(sb.block_id);
        if (!block) return "";
        const notes = block.notes.length
          ? block.notes.map((n) => `<div class="callout neutral">${esc(n)}</div>`).join("")
          : "";
        const isDeeper = !!block.meta?.path;
        return (
          `<section id="${esc(block.id)}"${isDeeper ? ' class="deeper"' : ""}><h3 class="block-title">${esc(block.title)}${isDeeper ? '<span class="cond-tag">Deeper look</span>' : ""}</h3>` +
          logicBox(block) +
          caption(block, labels) +
          renderComponent(block, sb.component, labels) +
          notes +
          `</section>`
        );
      })
      .join("");
    const html = narr + body;
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(html);
  }

  const stageHtml = stageOrder
    .filter((st) => byStage.has(st))
    .map((st) => `<h2 class="stage-head">${esc(st)}</h2>` + byStage.get(st)!.join(""))
    .join("");

  // --- data quality / tracking availability (deterministic, registry-driven) ---
  let availabilityHtml = "";
  if (blocks.availability?.length) {
    const items = blocks.availability
      .map((a) => {
        const chips =
          `<span class="mem-tag">${esc(a.status === "not_covered" ? "unavailable" : "unverified")}</span> ` +
          `<span class="mem-tag">tag: ${esc(a.tag_name)}</span> ` +
          `<span class="mem-tag">event: ${esc(a.events.join(", "))}</span> ` +
          `<span class="mem-tag">source: ${esc(a.provenance)}</span>`;
        return `<div class="callout neutral">${esc(a.message)}<div style="margin-top:6px">${chips}</div></div>`;
      })
      .join("");
    availabilityHtml =
      `<h2 class="stage-head">Data Quality / Tracking Availability</h2>` +
      `<section id="tracking-availability">` +
      `<p class="caption">The queries below reference events whose GTM tags have known or unverifiable availability gaps for the requested period. Affected blocks carry a tracking flag; values shown there reflect only the period the tag was actually live.</p>` +
      items +
      `</section>`;
  }

  // --- notes & caveats ---
  const notes: string[] = [];
  if (premise?.contradicted) notes.push(`<div class="callout neutral"><strong>premise vs data</strong> — ${esc(premise.text)}</div>`);
  for (const b of blocks.blocks) {
    if (b.flags.includes("retrieval_error")) {
      notes.push(`<div class="callout neutral"><strong>${esc(b.id)}</strong> — retrieval failed; block omitted from analysis.</div>`);
    }
  }
  if (allFlags.includes("sampled")) {
    notes.push(`<div class="callout neutral"><strong>sampling</strong> — GA4 reported sampling on at least one query; values are estimates.</div>`);
  }
  if (allFlags.includes("data_loss_other_row")) {
    notes.push(`<div class="callout neutral"><strong>(other) row</strong> — GA4 collapsed excess groups into "(other)" on at least one query.</div>`);
  }
  for (const n of blocks.summary_notes) notes.push(`<div class="callout neutral">${esc(n)}</div>`);
  const notesHtml = notes.length ? `<h2 class="stage-head">Notes &amp; caveats</h2><section id="notes">${notes.join("")}</section>` : "";

  const subtitle = spec.subtitle ? `<div class="subtitle">${esc(spec.subtitle)}</div>` : "";

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(spec.title)}</title><style>${STYLE}</style></head><body>
<header>
<h1>${esc(spec.title)}</h1>${subtitle}
<hr class="rule">
<div class="context-strip">${ctx.join("")}</div>
${premiseCallout}
</header>
<main>${stageHtml}${availabilityHtml}${notesHtml}</main>
</body></html>`;
}

// ---------------------------------------------------------------------------
// LLM spec path (Pro) — unchanged contract
// ---------------------------------------------------------------------------

export interface SpecIssue {
  section_id: string;
  problem: string;
}

export function groundSpec(spec: ReportSpecT, blocks: DataBlocksOutput): SpecIssue[] {
  const ids = new Set(blocks.blocks.map((b) => b.id));
  const issues: SpecIssue[] = [];
  for (const s of spec.sections) {
    for (const sb of s.blocks) {
      if (!ids.has(sb.block_id)) issues.push({ section_id: s.id, problem: `block_id '${sb.block_id}' not in data_blocks` });
    }
  }
  return issues;
}

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function blocksSummary(blocks: DataBlocksOutput): string {
  return JSON.stringify(
    blocks.blocks.map((b) => ({
      id: b.id,
      title: b.title,
      block_type: b.block_type,
      purpose: b.purpose ?? null,
      columns: b.columns,
      sample_rows: b.rows.slice(0, SAMPLE_ROWS),
      flags: b.flags,
    })),
    null,
    2,
  );
}

async function callLLM(
  ctx: { provider: Provider; model: string },
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; ttft_ms: number }> {
  const t0 = Date.now();
  let ttft_ms: number | null = null;
  let content = "";
  const { client, model } = getClient(BRAIN_KEY, {
    provider: ctx.provider,
    model: ctx.model,
    timeoutMs: BRAIN6_TIMEOUT_MS,
  });
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    stream: true,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      if (ttft_ms === null) ttft_ms = Date.now() - t0;
      content += delta;
    }
  }
  if (!content) throw new Error("Brain 6: empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? Date.now() - t0 };
}

async function attemptSpec(
  ctx: { provider: Provider; model: string },
  blocks: DataBlocksOutput,
  intent: IntentOutput | undefined,
  meta: { attempts: number; ttft_ms: number },
): Promise<ReportSpecT> {
  meta.attempts += 1;
  const user = `Brain 1 intent (context):
${intent ? JSON.stringify(intent) : "(none)"}

Brain 5 data_blocks (shape + sample rows — do NOT echo values back):
${blocksSummary(blocks)}

Produce the report spec JSON.`;
  const r = await callLLM(ctx, [
    { role: "system", content: BRAIN6_SYSTEM_PROMPT },
    { role: "user", content: user },
  ]);
  meta.ttft_ms = r.ttft_ms;
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(r.content));
  } catch (e) {
    throw new Error(`Brain 6 spec: schema validation failed (not valid JSON): ${(e as Error).message}`);
  }
  const parsed = ReportSpec.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Brain 6 spec: schema validation failed: ${JSON.stringify(parsed.error.issues)}`);
  }
  const issues = groundSpec(parsed.data, blocks);
  if (issues.length) {
    throw new Error(`Brain 6 spec: invalid structured output — grounding failed: ${JSON.stringify(issues)}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Orchestration + report writing
// ---------------------------------------------------------------------------

function reportTitle(input: Brain6Input): string {
  if (input.question) {
    const q = input.question.trim();
    return q.charAt(0).toUpperCase() + q.slice(1);
  }
  if (input.title) return input.title;
  const rt = (input.intent as { report_type?: unknown } | undefined)?.report_type;
  return typeof rt === "string" && rt ? `GA4 Report — ${rt}` : "GA4 Report";
}

export async function runBrain6Report(input: Brain6Input): Promise<Brain6Result> {
  const startedAt = Date.now();
  const generatedAt = input.generatedAt ?? new Date().toISOString().slice(0, 16).replace("T", " ");
  const title = reportTitle(input);

  let spec: ReportSpecT | undefined;
  let llmError: string | undefined;
  let llmTiming: BrainTiming = { ttft_ms: 0, total_ms: 0, attempts: 0 };
  let usedFallback = false;

  if (input.blocks.blocks.length > 0) {
    const route = routeFor("brain6");
    const primaryCtx: { provider: Provider; model: string } = { provider: route.provider, model: route.model };
    const meta = { attempts: 0, ttft_ms: 0 };
    const t0 = Date.now();
    try {
      if (route.escalate && route.fallbackProvider) {
        const fallbackCtx: { provider: Provider; model: string } = {
          provider: route.fallbackProvider,
          model: route.fallbackModel ?? route.model,
        };
        const res = await withEscalation<ReportSpecT>(
          () => attemptSpec(primaryCtx, input.blocks, input.intent, meta),
          () => attemptSpec(fallbackCtx, input.blocks, input.intent, meta),
        );
        spec = res.value;
        usedFallback = res.usedFallback;
      } else {
        spec = await attemptSpec(primaryCtx, input.blocks, input.intent, meta);
      }
    } catch (err) {
      llmError = (err as Error).message;
    }
    llmTiming = { ttft_ms: meta.ttft_ms, total_ms: Date.now() - t0, attempts: meta.attempts };
  } else {
    llmError = "no data_blocks to report";
  }

  let source: Brain6Source;
  if (!spec) {
    spec = defaultSpec(input.blocks, title);
    source = "deterministic_default";
  } else {
    // The LLM provides structure/narrative; the title stays caller-derived so
    // the report always names the user's actual question.
    spec = { ...spec, title };
    source = "llm";
  }

  const html = renderReport(spec, input.blocks, generatedAt, {
    question: input.question,
    periods: input.periods,
    propertyId: input.propertyId,
    intent: input.intent,
  });

  return {
    html,
    spec,
    source,
    llm: { ok: source === "llm", usedFallback, error: llmError, timing: llmTiming },
    timing: { total_ms: Date.now() - startedAt },
  };
}

/** Write the HTML to <outDir>/<timestamp>_<slug>.html and return the absolute path. */
export async function writeReport(
  html: string,
  opts?: { outDir?: string; slug?: string; stamp?: string },
): Promise<string> {
  // Vercel's serverless filesystem is read-only except /tmp — write there in
  // production (best-effort, per-instance); locally ./reports stays the
  // persistent archive. The orchestrate API also returns the HTML inline, so
  // the UI never depends on this file surviving across instances.
  const outDir =
    opts?.outDir ?? (process.env.VERCEL ? "/tmp/reports" : path.join(process.cwd(), "reports"));
  const stamp = opts?.stamp ?? new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const slug = slugify(opts?.slug ?? "report");
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `${stamp}_${slug}.html`);
  await fs.writeFile(file, html, "utf8");
  return file;
}
