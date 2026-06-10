/**
 * Brain 5 — Data Handling.
 *
 * Reshapes Brain 4's retrieved rows into renderable "data_blocks" for Brain 6.
 *
 *   - LLM (Flash → Pro) emits a PLAN: which blocks, their type, source query,
 *     transform (passthrough / aggregate_by / top_n), and derived metrics.
 *   - A DETERMINISTIC engine applies the plan to the real rows and computes every
 *     number. The LLM never emits data values, so numeric hallucination is
 *     structurally impossible.
 *   - If the LLM plan is missing/invalid, a deterministic DEFAULT shaping
 *     (passthrough one block per query) guarantees Brain 5 always emits usable
 *     blocks.
 *
 * Brain 5 only RESHAPES what Brain 4 retrieved — it never plans GA4 queries
 * (that is Brain 2's responsibility).
 *
 * Constraints honored: additive; streaming; DeepSeek Flash→Pro per the routing
 * map; generous timeout; no parallel LLM calls; Brains 1–4 untouched.
 */
import { getClient, type Provider } from "@/lib/nvidia";
import { routeFor } from "@/lib/modelRouting";
import { withEscalation } from "@/lib/escalate";
import type { IntentOutput } from "@/schemas/intent";
import type { Query } from "@/schemas/metrics";
import type { Dataset, DataAccessQueryResult } from "@/brains/brain4_dataaccess";
import {
  analyzeTrackingAvailability,
  type TrackingRegistry,
} from "@/support/tracking/availability";
import {
  DataHandlingPlan,
  type DataHandlingPlan as DataHandlingPlanT,
  type BlockPlan,
  type DerivedMetric,
  type DataBlock,
  type DataBlocksOutput,
  type BlockType,
} from "@/schemas/datahandling";
import { BRAIN5_SYSTEM_PROMPT } from "@/brains/prompts/brain5_datahandling";

const BRAIN_KEY = "brain5";
const TEMPERATURE = 0.1;
const MAX_TOKENS = 4000;
const BRAIN5_TIMEOUT_MS = 150_000;
const SAMPLE_ROWS = 5;

export interface BrainTiming {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}

export type Brain5Source = "llm" | "deterministic_default";

export interface Brain5Result {
  output: DataBlocksOutput;
  source: Brain5Source;
  /** The LLM plan, when one was accepted. */
  plan?: DataHandlingPlanT;
  llm: { ok: boolean; usedFallback?: boolean; error?: string; timing: BrainTiming };
  timing: { total_ms: number };
}

export interface Brain5Input {
  /** Brain 4's chosen dataset. */
  dataset: Dataset;
  /** Brain 1 intent — context for titling/ordering blocks. */
  intent?: IntentOutput;
  /**
   * Brain 3's approved queries (OPTIONAL, additive) — needed only for the
   * tracking-availability analysis, which compares each query's requested
   * dateRanges against the GTM tag windows in the tracking registry. When
   * absent, behaviour is identical to before.
   */
  approvedQueries?: Query[];
}

export class Brain5PlanError extends Error {
  constructor(message: string, public readonly rawOutput: string, public readonly issues: unknown) {
    super(message);
    this.name = "Brain5PlanError";
  }
}

// ---------------------------------------------------------------------------
// Deterministic engine — applies a plan to real rows. No LLM, no network.
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function flagsFor(r: DataAccessQueryResult): string[] {
  const f: string[] = [];
  if (r.metadata?.sampled) f.push("sampled");
  if (r.metadata?.dataLossFromOtherRow) f.push("data_loss_other_row");
  if (r.error) f.push("retrieval_error");
  return f;
}

export interface PlanIssue {
  block_id: string;
  problem: string;
}

/** Ground a plan against the dataset: every referenced id/field must exist. */
export function groundPlan(plan: DataHandlingPlanT, dataset: Dataset): PlanIssue[] {
  const byId = new Map(dataset.map((d) => [d.query_id, d]));
  const issues: PlanIssue[] = [];
  for (const b of plan.blocks) {
    const src = byId.get(b.source_query_id);
    if (!src) {
      issues.push({ block_id: b.id, problem: `source_query_id '${b.source_query_id}' not in dataset` });
      continue;
    }
    const dims = new Set(src.dimensionHeaders);
    const mets = new Set(src.metricHeaders.map((h) => h.name));
    const t = b.transform;
    if (t.kind === "aggregate_by") {
      if (!dims.has(t.dimension)) issues.push({ block_id: b.id, problem: `dimension '${t.dimension}' not in ${src.query_id}` });
      for (const m of t.metrics) if (!mets.has(m)) issues.push({ block_id: b.id, problem: `metric '${m}' not in ${src.query_id}` });
    } else if (t.kind === "top_n") {
      if (!mets.has(t.sort_metric)) issues.push({ block_id: b.id, problem: `sort_metric '${t.sort_metric}' not in ${src.query_id}` });
    } else if (t.kind === "compare_by") {
      if (!dims.has(RANGE_DIM)) issues.push({ block_id: b.id, problem: `compare_by requires two dateRanges (no '${RANGE_DIM}' dimension in ${src.query_id})` });
      if (t.dimension && !dims.has(t.dimension)) issues.push({ block_id: b.id, problem: `dimension '${t.dimension}' not in ${src.query_id}` });
      if (!mets.has(t.metric)) issues.push({ block_id: b.id, problem: `metric '${t.metric}' not in ${src.query_id}` });
    } else if (t.kind === "temporal_compare") {
      if (!dims.has(RANGE_DIM)) issues.push({ block_id: b.id, problem: `temporal_compare requires two dateRanges in ${src.query_id}` });
      if (!mets.has(t.metric)) issues.push({ block_id: b.id, problem: `metric '${t.metric}' not in ${src.query_id}` });
    } else if (t.kind === "funnel") {
      if (!dims.has(RANGE_DIM)) issues.push({ block_id: b.id, problem: `funnel requires two dateRanges in ${src.query_id}` });
      if (!mets.has(t.metric)) issues.push({ block_id: b.id, problem: `metric '${t.metric}' not in ${src.query_id}` });
    }
    for (const dm of b.derived_metrics) {
      for (const op of dm.operands) if (!mets.has(op)) issues.push({ block_id: b.id, problem: `derived operand '${op}' not in ${src.query_id}` });
    }
  }
  return issues;
}

type Row = Record<string, string | number>;

function applyAggregate(src: DataAccessQueryResult, dimension: string, metrics: string[]): { columns: string[]; rows: Row[] } {
  const groups = new Map<string, Record<string, number>>();
  for (const row of src.rows) {
    const key = String(row[dimension] ?? "");
    let acc = groups.get(key);
    if (!acc) {
      acc = {};
      for (const m of metrics) acc[m] = 0;
      groups.set(key, acc);
    }
    for (const m of metrics) acc[m] = (acc[m] ?? 0) + num(row[m]);
  }
  const rows: Row[] = [...groups.entries()].map(([k, acc]) => ({ [dimension]: k, ...acc }));
  return { columns: [dimension, ...metrics], rows };
}

function applyTopN(
  src: DataAccessQueryResult,
  sortMetric: string,
  n: number,
  othersRollup: boolean,
): { columns: string[]; rows: Row[] } {
  const dimH = src.dimensionHeaders;
  const metH = src.metricHeaders.map((h) => h.name);
  const sorted = [...src.rows].sort((a, b) => num(b[sortMetric]) - num(a[sortMetric]));
  const rows: Row[] = sorted.slice(0, n).map((r) => ({ ...r }));
  if (othersRollup && sorted.length > n) {
    const rest = sorted.slice(n);
    const others: Row = {};
    dimH.forEach((d, i) => (others[d] = i === 0 ? "(others)" : ""));
    for (const m of metH) others[m] = rest.reduce((s, r) => s + num(r[m]), 0);
    rows.push(others);
  }
  return { columns: [...dimH, ...metH], rows };
}

// ---------------------------------------------------------------------------
// Two-dateRange (current vs baseline) helpers
// ---------------------------------------------------------------------------

const RANGE_DIM = "dateRange";
const FUNNEL_ORDER = ["session_start", "page_view", "view_search_results", "job_apply"];

function hasRangeDim(src: DataAccessQueryResult): boolean {
  return src.dimensionHeaders.includes(RANGE_DIM);
}

/** Resolve the dateRange column values naming current vs baseline. */
function rangeLabels(src: DataAccessQueryResult): { current: string; baseline: string } {
  const values = new Set(src.rows.map((r) => String(r[RANGE_DIM] ?? "")));
  const current = values.has("current") ? "current" : "date_range_0";
  const baseline = values.has("baseline") ? "baseline" : "date_range_1";
  return { current, baseline };
}

function membershipOf(baseline: number, current: number): string {
  if (baseline === 0 && current > 0) return "new";
  if (current === 0 && baseline > 0) return "disappeared";
  return "both";
}

/**
 * compare_by: pivot a two-range query on `dimension` (null → single total row)
 * for one metric. Columns: [dim?, baseline, current, delta_abs, delta_pct,
 * membership?]. Sorted by current desc; total row when dimension is null.
 */
function applyCompareBy(
  src: DataAccessQueryResult,
  dimension: string | null,
  metric: string,
): { columns: string[]; rows: Row[] } {
  const { current, baseline } = rangeLabels(src);
  const acc = new Map<string, { baseline: number; current: number }>();
  for (const row of src.rows) {
    const key = dimension ? String(row[dimension] ?? "") : "(total)";
    let slot = acc.get(key);
    if (!slot) {
      slot = { baseline: 0, current: 0 };
      acc.set(key, slot);
    }
    const v = num(row[metric]);
    const range = String(row[RANGE_DIM] ?? "");
    if (range === current) slot.current += v;
    else if (range === baseline) slot.baseline += v;
  }
  const rows: Row[] = [...acc.entries()]
    .map(([key, s]) => {
      const delta = s.current - s.baseline;
      const pct = s.baseline !== 0 ? Number(((delta / s.baseline) * 100).toFixed(2)) : "";
      const base: Row = dimension ? { [dimension]: key } : { metric };
      return {
        ...base,
        baseline: s.baseline,
        current: s.current,
        delta_abs: delta,
        delta_pct: pct,
        ...(dimension ? { membership: membershipOf(s.baseline, s.current) } : {}),
      };
    })
    .sort((a, b) => num(b.current) - num(a.current));
  const keyCol = dimension ?? "metric";
  const columns = [keyCol, "baseline", "current", "delta_abs", "delta_pct", ...(dimension ? ["membership"] : [])];
  return { columns, rows };
}

/** temporal_compare: two-range daily series aligned by day-of-month. */
function applyTemporalCompare(
  src: DataAccessQueryResult,
  metric: string,
): { columns: string[]; rows: Row[] } {
  const { current, baseline } = rangeLabels(src);
  const dateDim = src.dimensionHeaders.find((d) => d !== RANGE_DIM) ?? "date";
  const byDay = new Map<string, { baseline: number; current: number }>();
  for (const row of src.rows) {
    const raw = String(row[dateDim] ?? "");
    const day = raw.length >= 8 ? raw.slice(6, 8) : raw; // YYYYMMDD → DD
    let slot = byDay.get(day);
    if (!slot) {
      slot = { baseline: 0, current: 0 };
      byDay.set(day, slot);
    }
    const v = num(row[metric]);
    const range = String(row[RANGE_DIM] ?? "");
    if (range === current) slot.current += v;
    else if (range === baseline) slot.baseline += v;
  }
  const rows: Row[] = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, s]) => ({ day, baseline: s.baseline, current: s.current }));
  return { columns: ["day", "baseline", "current"], rows };
}

/** funnel: ordered step counts per range + step-to-step rates + most-moved. */
function applyFunnel(
  src: DataAccessQueryResult,
  steps: string[],
  metric: string,
): { columns: string[]; rows: Row[]; transitions: Array<{ label: string; baseline_rate: number; current_rate: number; most_moved: boolean }> } {
  const { current, baseline } = rangeLabels(src);
  const stepDim = src.dimensionHeaders.find((d) => d !== RANGE_DIM) ?? "eventName";
  const counts = new Map<string, { baseline: number; current: number }>();
  for (const s of steps) counts.set(s, { baseline: 0, current: 0 });
  for (const row of src.rows) {
    const step = String(row[stepDim] ?? "");
    const slot = counts.get(step);
    if (!slot) continue; // events outside the declared funnel are ignored
    const v = num(row[metric]);
    const range = String(row[RANGE_DIM] ?? "");
    if (range === current) slot.current += v;
    else if (range === baseline) slot.baseline += v;
  }
  const rows: Row[] = steps.map((s) => ({
    step: s,
    baseline: counts.get(s)!.baseline,
    current: counts.get(s)!.current,
  }));

  const transitions: Array<{ label: string; baseline_rate: number; current_rate: number; most_moved: boolean }> = [];
  for (let i = 1; i < steps.length; i++) {
    const prev = counts.get(steps[i - 1]!)!;
    const cur = counts.get(steps[i]!)!;
    const bRate = prev.baseline > 0 ? cur.baseline / prev.baseline : 0;
    const cRate = prev.current > 0 ? cur.current / prev.current : 0;
    transitions.push({
      label: `${steps[i]} per ${steps[i - 1]}`,
      baseline_rate: Number(bRate.toFixed(4)),
      current_rate: Number(cRate.toFixed(4)),
      most_moved: false,
    });
  }
  // Most-moved = largest relative rate change.
  let bestIdx = -1;
  let bestScore = -1;
  transitions.forEach((t, i) => {
    const denom = Math.max(t.baseline_rate, 1e-9);
    const score = Math.abs(t.current_rate - t.baseline_rate) / denom;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  if (bestIdx >= 0) transitions[bestIdx]!.most_moved = true;

  return { columns: ["step", "baseline", "current"], rows, transitions };
}

function computeDerived(columns: string[], rows: Row[], derived: DerivedMetric[]): { columns: string[]; rows: Row[] } {
  if (!derived.length) return { columns, rows };
  const outCols = [...columns];
  for (const dm of derived) if (!outCols.includes(dm.name)) outCols.push(dm.name);
  const outRows = rows.map((r) => {
    const nr: Row = { ...r };
    for (const dm of derived) {
      const a = num(r[dm.operands[0]]);
      const b = num(r[dm.operands[1]]);
      let v = 0;
      switch (dm.op) {
        case "ratio":
          v = b !== 0 ? a / b : 0;
          break;
        case "percent":
          v = b !== 0 ? (a / b) * 100 : 0;
          break;
        case "difference":
          v = a - b;
          break;
        case "sum":
          v = a + b;
          break;
      }
      nr[dm.name] = v;
    }
    return nr;
  });
  return { columns: outCols, rows: outRows };
}

function buildBlock(b: BlockPlan, dataset: Dataset): DataBlock {
  const src = dataset.find((d) => d.query_id === b.source_query_id)!; // grounded before call
  let columns: string[];
  let rows: Row[];
  let meta: DataBlock["meta"];
  const t = b.transform;
  if (t.kind === "aggregate_by") {
    ({ columns, rows } = applyAggregate(src, t.dimension, t.metrics));
  } else if (t.kind === "top_n") {
    ({ columns, rows } = applyTopN(src, t.sort_metric, t.n, t.others_rollup));
  } else if (t.kind === "compare_by") {
    const labels = rangeLabels(src);
    ({ columns, rows } = applyCompareBy(src, t.dimension, t.metric));
    meta = {
      comparison: {
        metric: t.metric,
        dimension: t.dimension,
        baseline_label: labels.baseline,
        current_label: labels.current,
      },
    };
  } else if (t.kind === "temporal_compare") {
    const labels = rangeLabels(src);
    ({ columns, rows } = applyTemporalCompare(src, t.metric));
    meta = { temporal: { metric: t.metric, baseline_label: labels.baseline, current_label: labels.current } };
  } else if (t.kind === "funnel") {
    const labels = rangeLabels(src);
    const f = applyFunnel(src, t.steps, t.metric);
    columns = f.columns;
    rows = f.rows;
    meta = {
      funnel: {
        metric: t.metric,
        baseline_label: labels.baseline,
        current_label: labels.current,
        transitions: f.transitions,
      },
    };
  } else {
    columns = [...src.dimensionHeaders, ...src.metricHeaders.map((h) => h.name)];
    rows = src.rows.map((r) => ({ ...r }));
  }
  ({ columns, rows } = computeDerived(columns, rows, b.derived_metrics));
  return {
    id: b.id,
    title: b.title,
    block_type: b.block_type,
    source_query_ids: [b.source_query_id],
    purpose: src.purpose,
    columns,
    rows,
    derived_metric_names: b.derived_metrics.map((d) => d.name),
    flags: flagsFor(src),
    notes: b.notes,
    meta,
  };
}

/** Apply a (grounded) plan to the dataset, computing all values deterministically. */
export function applyPlan(plan: DataHandlingPlanT, dataset: Dataset): DataBlocksOutput {
  return {
    blocks: plan.blocks.map((b) => buildBlock(b, dataset)),
    summary_notes: plan.summary_notes,
  };
}

const SHAPE_TO_BLOCK: Record<string, BlockType> = {
  categorical: "categorical",
  timeseries: "timeseries",
  single_value: "kpi",
};

function blockTitle(d: DataAccessQueryResult): string {
  const mets = d.metricHeaders.map((h) => h.name).join(", ");
  const dims = d.dimensionHeaders.join(", ");
  if (mets && dims) return `${mets} by ${dims}`;
  if (mets) return mets;
  return d.query_id;
}

/**
 * Deterministic ROLE-AWARE shaping: comparison / temporal / funnel blocks are
 * built whenever the query carries two dateRanges, keyed off the query purpose
 * (with header-based inference as fallback). This is the default path — report
 * richness never depends on the LLM plan landing.
 */
export function defaultShaping(dataset: Dataset): DataBlocksOutput {
  const blocks: DataBlock[] = dataset.map((d, i) => {
    const id = d.query_id || `b${i + 1}`;
    const flags = flagsFor(d);
    const notes = d.error ? [`Retrieval error: ${d.error}`] : [];
    const metric = d.metricHeaders[0]?.name;
    const otherDims = d.dimensionHeaders.filter((h) => h !== RANGE_DIM);

    if (hasRangeDim(d) && metric && !d.error) {
      const labels = rangeLabels(d);
      const firstDim = otherDims[0];

      // temporal: date dimension present
      if (d.purpose === "temporal" || firstDim === "date") {
        const { columns, rows } = applyTemporalCompare(d, metric);
        return {
          id,
          title: `Daily ${metric} — current vs baseline`,
          block_type: "temporal" as const,
          source_query_ids: [d.query_id],
          purpose: d.purpose ?? "temporal",
          columns,
          rows,
          derived_metric_names: [],
          flags,
          notes,
          meta: { temporal: { metric, baseline_label: labels.baseline, current_label: labels.current } },
        };
      }

      // funnel: eventName dimension with eventCount
      if (d.purpose === "funnel" || (firstDim === "eventName" && metric === "eventCount")) {
        const present = new Set(d.rows.map((r) => String(r[firstDim ?? "eventName"] ?? "")));
        const ordered = FUNNEL_ORDER.filter((s) => present.has(s));
        const extras = [...present].filter((s) => s && !FUNNEL_ORDER.includes(s)).sort();
        const steps = [...ordered, ...extras];
        if (steps.length >= 2) {
          const f = applyFunnel(d, steps, metric);
          return {
            id,
            title: `Funnel (${steps.join(" → ")})`,
            block_type: "funnel" as const,
            source_query_ids: [d.query_id],
            purpose: d.purpose ?? "funnel",
            columns: f.columns,
            rows: f.rows,
            derived_metric_names: [],
            flags,
            notes,
            meta: {
              funnel: {
                metric,
                baseline_label: labels.baseline,
                current_label: labels.current,
                transitions: f.transitions,
              },
            },
          };
        }
      }

      // generic comparison (confirm has no dimension; breakdowns have one)
      const dim = firstDim ?? null;
      const { columns, rows } = applyCompareBy(d, dim, metric);
      return {
        id,
        title: dim ? `${metric} by ${dim} — current vs baseline` : `${metric} — current vs baseline`,
        block_type: "comparison" as const,
        source_query_ids: [d.query_id],
        purpose: d.purpose ?? (dim ? "breakdown" : "confirm"),
        columns,
        rows,
        derived_metric_names: [],
        flags,
        notes,
        meta: {
          comparison: { metric, dimension: dim, baseline_label: labels.baseline, current_label: labels.current },
        },
      };
    }

    // single-range queries: legacy passthrough
    return {
      id,
      title: blockTitle(d),
      block_type: SHAPE_TO_BLOCK[d.expected_shape] ?? ("categorical" as const),
      source_query_ids: [d.query_id],
      purpose: d.purpose,
      columns: [...d.dimensionHeaders, ...d.metricHeaders.map((h) => h.name)],
      rows: d.rows.map((r) => ({ ...r })),
      derived_metric_names: [],
      flags,
      notes,
    };
  });
  return { blocks, summary_notes: [] };
}

// ---------------------------------------------------------------------------
// Tracking availability (deterministic; metadata analysis only)
// ---------------------------------------------------------------------------

/**
 * Annotate the shaped output with tracking-availability findings: top-level
 * `availability` array + per-block flags and templated notes on every block
 * sourced from an affected query. Pure — registry injectable for tests.
 */
export function attachTrackingAvailability(
  output: DataBlocksOutput,
  approvedQueries: Query[],
  registry?: TrackingRegistry,
): DataBlocksOutput {
  const annotations = registry
    ? analyzeTrackingAvailability(approvedQueries, registry)
    : analyzeTrackingAvailability(approvedQueries);
  if (!annotations.length) return output;

  const affected = new Map<string, Set<string>>(); // query_id → set of messages
  const statusByQuery = new Map<string, "not_covered" | "unverified">();
  for (const a of annotations) {
    for (const qid of a.query_ids) {
      if (!affected.has(qid)) affected.set(qid, new Set());
      affected.get(qid)!.add(a.message);
      // not_covered outranks unverified for the flag
      if (a.status === "not_covered" || !statusByQuery.has(qid)) statusByQuery.set(qid, a.status);
    }
  }

  for (const b of output.blocks) {
    const msgs = new Set<string>();
    let worst: "not_covered" | "unverified" | undefined;
    for (const qid of b.source_query_ids) {
      for (const m of affected.get(qid) ?? []) msgs.add(m);
      const s = statusByQuery.get(qid);
      if (s === "not_covered" || (s && !worst)) worst = s;
    }
    if (!msgs.size) continue;
    const flag = worst === "not_covered" ? "tracking_unavailable_partial" : "tracking_unverified";
    if (!b.flags.includes(flag)) b.flags.push(flag);
    for (const m of msgs) if (!b.notes.includes(m)) b.notes.push(m);
  }

  output.availability = annotations;
  return output;
}

// ---------------------------------------------------------------------------
// LLM plan path (Flash → Pro)
// ---------------------------------------------------------------------------

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function buildDatasetSummary(dataset: Dataset): string {
  // Headers + a small sample only — never the full rows (keeps prompt bounded and
  // reinforces "you plan structure, not values").
  const parts = dataset.map((d) => ({
    query_id: d.query_id,
    expected_shape: d.expected_shape,
    dimensions: d.dimensionHeaders,
    metrics: d.metricHeaders.map((h) => h.name),
    row_count: d.rows.length,
    sample_rows: d.rows.slice(0, SAMPLE_ROWS),
    metadata: d.metadata,
    error: d.error ?? null,
  }));
  return JSON.stringify(parts, null, 2);
}

function buildUserPrompt(dataset: Dataset, intent?: IntentOutput): string {
  return `Brain 1 intent (context):
${intent ? JSON.stringify(intent) : "(none)"}

Brain 4 dataset (shape + sample rows — do NOT echo values back):
${buildDatasetSummary(dataset)}

Produce the data-handling plan JSON.`;
}

async function callLLM(
  ctx: { provider: Provider; model: string },
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; ttft_ms: number; elapsed_ms: number }> {
  const t0 = Date.now();
  let ttft_ms: number | null = null;
  let content = "";
  const { client, model } = getClient(BRAIN_KEY, {
    provider: ctx.provider,
    model: ctx.model,
    timeoutMs: BRAIN5_TIMEOUT_MS,
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
  const elapsed_ms = Date.now() - t0;
  if (!content) throw new Error("Brain 5: empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? elapsed_ms, elapsed_ms };
}

type ParseResult = { ok: true; value: DataHandlingPlanT } | { ok: false; issues: unknown };

function tryParsePlan(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch (e) {
    return { ok: false, issues: [{ message: `not valid JSON: ${(e as Error).message}` }] };
  }
  const parsed = DataHandlingPlan.safeParse(json);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, value: parsed.data };
}

async function attemptPlan(
  ctx: { provider: Provider; model: string },
  dataset: Dataset,
  intent: IntentOutput | undefined,
  meta: { attempts: number; ttft_ms: number },
): Promise<DataHandlingPlanT> {
  meta.attempts += 1;
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: BRAIN5_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(dataset, intent) },
  ];
  const r = await callLLM(ctx, messages);
  meta.ttft_ms = r.ttft_ms;

  const parsed = tryParsePlan(r.content);
  if (!parsed.ok) {
    throw new Error(`Brain 5 plan: schema validation failed: ${JSON.stringify(parsed.issues)}`);
  }
  const issues = groundPlan(parsed.value, dataset);
  if (issues.length) {
    throw new Error(`Brain 5 plan: invalid structured output — grounding failed: ${JSON.stringify(issues)}`);
  }
  return parsed.value;
}

async function runBrain5Plan(
  dataset: Dataset,
  intent: IntentOutput | undefined,
): Promise<{ plan: DataHandlingPlanT; timing: BrainTiming; usedFallback: boolean }> {
  const startedAt = Date.now();
  const route = routeFor("brain5");
  const primaryCtx: { provider: Provider; model: string } = { provider: route.provider, model: route.model };
  const meta = { attempts: 0, ttft_ms: 0 };

  let plan: DataHandlingPlanT;
  let usedFallback = false;
  if (route.escalate && route.fallbackProvider) {
    const fallbackCtx: { provider: Provider; model: string } = {
      provider: route.fallbackProvider,
      model: route.fallbackModel ?? route.model,
    };
    const res = await withEscalation<DataHandlingPlanT>(
      () => attemptPlan(primaryCtx, dataset, intent, meta),
      () => attemptPlan(fallbackCtx, dataset, intent, meta),
    );
    plan = res.value;
    usedFallback = res.usedFallback;
  } else {
    plan = await attemptPlan(primaryCtx, dataset, intent, meta);
  }
  return { plan, timing: { ttft_ms: meta.ttft_ms, total_ms: Date.now() - startedAt, attempts: meta.attempts }, usedFallback };
}

// ---------------------------------------------------------------------------
// Brain 5 — orchestration
// ---------------------------------------------------------------------------

export async function runBrain5DataHandling(input: Brain5Input): Promise<Brain5Result> {
  const startedAt = Date.now();

  let plan: DataHandlingPlanT | undefined;
  let llmError: string | undefined;
  let llmTiming: BrainTiming = { ttft_ms: 0, total_ms: 0, attempts: 0 };
  let usedFallback = false;

  if (input.dataset.length > 0) {
    try {
      const p = await runBrain5Plan(input.dataset, input.intent);
      plan = p.plan;
      llmTiming = p.timing;
      usedFallback = p.usedFallback;
    } catch (err) {
      llmError = (err as Error).message;
    }
  } else {
    llmError = "empty dataset";
  }

  // Adequacy gate: a plan that passthroughs/aggregates a two-dateRange query
  // would DOWNGRADE the report below the deterministic default. Reject such
  // plans and use the role-aware default instead.
  if (plan) {
    const byId = new Map(input.dataset.map((d) => [d.query_id, d]));
    const compareKinds = new Set(["compare_by", "temporal_compare", "funnel"]);
    const inadequate = plan.blocks.some((b) => {
      const src = byId.get(b.source_query_id);
      if (!src || !hasRangeDim(src)) return false;
      if (!compareKinds.has(b.transform.kind)) return true;
      // Funnel-shaped sources (eventName × eventCount, or purpose=funnel) must
      // get the funnel transform — a plain comparison loses step rates.
      const otherDim = src.dimensionHeaders.find((d) => d !== RANGE_DIM);
      const isFunnelSrc =
        src.purpose === "funnel" || (otherDim === "eventName" && src.metricHeaders[0]?.name === "eventCount");
      return isFunnelSrc && b.transform.kind !== "funnel";
    });
    if (inadequate) {
      llmError = (llmError ? llmError + "; " : "") +
        "plan rejected by adequacy gate: two-dateRange query shaped without a compare-family transform";
      plan = undefined;
    }
  }

  let output: DataBlocksOutput;
  let source: Brain5Source;
  if (plan) {
    output = applyPlan(plan, input.dataset);
    source = "llm";
  } else {
    output = defaultShaping(input.dataset);
    source = "deterministic_default";
  }

  // Tracking availability — deterministic metadata analysis (never blocks).
  if (input.approvedQueries?.length) {
    try {
      output = attachTrackingAvailability(output, input.approvedQueries);
    } catch {
      /* registry unreadable → skip annotation rather than fail the report */
    }
  }

  return {
    output,
    source,
    plan,
    llm: { ok: !!plan, usedFallback, error: llmError, timing: llmTiming },
    timing: { total_ms: Date.now() - startedAt },
  };
}
