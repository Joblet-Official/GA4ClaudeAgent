/**
 * Brain 4 — Data Access (dual-path).
 *
 * Responsibility: DATA ACCESS ONLY. The retrieval decision is made upstream
 * (Brain 2 plans, Brain 3 clarifies + approves). Brain 4 executes the approved
 * plan through TWO independent paths and reconciles them before handing data to
 * Brain 5:
 *
 *   - Brain 4A (LLM path):           the LLM turns the approved plan into GA4
 *                                    request bodies, which are catalog-validated
 *                                    and executed. This is the PRIMARY path.
 *   - Brain 4B (deterministic path): the approved request bodies are executed
 *                                    verbatim. This is the SAFETY BASELINE.
 *   - Brain 4C (validation):         reconcile Dataset A vs Dataset B. If they
 *                                    agree within tolerance → pass A downstream.
 *                                    If they materially differ (or A failed) →
 *                                    pass B and record the discrepancy.
 *
 * Design constraints honored here:
 *   - Additive: imports existing machinery (getClient streaming, runGA4Query,
 *     validateAgainstCatalog). Touches no other brain.
 *   - No parallel LLM calls: only Brain 4A calls the LLM, exactly once (+ one
 *     bounded retry). GA4 executions are run sequentially.
 *   - Streaming + generous timeout: the LLM call streams (reasoning-model safe)
 *     and uses a DeepSeek-sized timeout override.
 */
import { getClient, type Provider } from "@/lib/nvidia";
import { routeFor } from "@/lib/modelRouting";
import { withEscalation } from "@/lib/escalate";
import { MetricsOutput, type Query } from "@/schemas/metrics";
import type { IntentOutput } from "@/schemas/intent";
import type { Catalog } from "@/support/catalog/loadCatalog";
import { validateAgainstCatalog } from "@/orchestrator/validate";
import { runGA4Query, type GA4QueryResult } from "@/support/tools/runGA4Query";
import { BRAIN4_SYSTEM_PROMPT } from "@/brains/prompts/brain4_dataaccess";

const BRAIN_KEY = "brain4";
const TEMPERATURE = 0.1;
const MAX_TOKENS = 6000;
/** DeepSeek reasoning models are slow + variable; give the LLM path real headroom. */
const BRAIN4_TIMEOUT_MS = 150_000;

/** Reconciliation tolerances — absorb GA4 sampling / freshness / timing jitter. */
const VALUE_REL_TOL = 0.02; // 2% relative difference per metric cell
const VALUE_ABS_TOL = 0.5; // absolute floor so tiny counts don't trip the relative test
const ROW_MISMATCH_TOL = 0.05; // up to 5% of compared rows may differ before "material"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrainTiming {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}

/** One query's executed result, tagged with its id + which path it belongs to. */
export interface DataAccessQueryResult extends GA4QueryResult {
  query_id: string;
  expected_shape: string;
  /** The query's report role from Brain 2's plan (confirm/temporal/breakdown/funnel/...). */
  purpose?: string;
  /** Present iff this single query failed to execute. */
  error?: string;
}

export type Dataset = DataAccessQueryResult[];
export type PathLabel = "llm" | "deterministic";

export interface QueryReconciliation {
  query_id: string;
  reconciled: boolean;
  reasons: string[];
  dimensionsMatch: boolean;
  metricsMatch: boolean;
  /** Fraction of deterministic rows whose key was found in the LLM dataset. */
  rowKeyOverlap: number;
  /** Count of rows whose metric values diverged beyond tolerance. */
  valueMismatches: number;
  comparedRows: number;
}

export interface ReconciliationReport {
  /** Overall verdict: same query intent AND every query reconciled. */
  reconciled: boolean;
  /** Did both paths retrieve the exact same set of query ids? */
  sameQueryIntent: boolean;
  perQuery: QueryReconciliation[];
  /** Human-readable discrepancy notes for debugging + audit. */
  discrepancies: string[];
}

export interface Brain4Result {
  /** The dataset that proceeds to Brain 5. */
  dataset: Dataset;
  /** Which path produced the accepted dataset. */
  source: PathLabel;
  reconciliation: ReconciliationReport;
  paths: {
    llm: { ok: boolean; usedFallback?: boolean; error?: string; dataset?: Dataset; timing: BrainTiming };
    deterministic: { ok: boolean; dataset: Dataset };
  };
  timing: { total_ms: number };
}

export interface Brain4Input {
  /** Brain 3's approved_queries. */
  approvedQueries: Query[];
  /** Brain 1 intent — carried for context/audit; reconciliation keys on query ids. */
  intent?: IntentOutput;
  catalog: Catalog;
}

/** The deterministic baseline could not run — we have no trustworthy source of truth. */
export class Brain4BaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Brain4BaselineError";
  }
}

/** The LLM path failed validation twice — caller falls back to the deterministic dataset. */
export class Brain4LLMError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly issues: unknown,
  ) {
    super(message);
    this.name = "Brain4LLMError";
  }
}

// ---------------------------------------------------------------------------
// Shared execution
// ---------------------------------------------------------------------------

function emptyGA4(): GA4QueryResult {
  return {
    rows: [],
    dimensionHeaders: [],
    metricHeaders: [],
    rowCount: 0,
    metadata: { sampled: false, dataLossFromOtherRow: false },
  };
}

/** Execute a set of queries sequentially. A single query's failure is captured, not thrown. */
async function executeQueries(queries: Query[]): Promise<Dataset> {
  const out: Dataset = [];
  for (const q of queries) {
    try {
      const r = await runGA4Query(q.request_body as unknown as Record<string, unknown>);
      out.push({ query_id: q.id, expected_shape: q.expected_shape, purpose: q.purpose, ...r });
    } catch (err) {
      out.push({
        query_id: q.id,
        expected_shape: q.expected_shape,
        purpose: q.purpose,
        error: (err as Error).message,
        ...emptyGA4(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brain 4B — deterministic path
// ---------------------------------------------------------------------------

/**
 * Execute the approved plan verbatim. Defensive catalog re-validation first: the
 * baseline must be schema-correct, and a bad field here is a hard error (the
 * upstream contract was violated), not something to silently retrieve around.
 */
export async function runBrain4Deterministic(
  approvedQueries: Query[],
  catalog: Catalog,
): Promise<Dataset> {
  const v = validateAgainstCatalog({ queries: approvedQueries }, catalog);
  if (!v.ok) {
    throw new Brain4BaselineError(
      `approved queries failed catalog validation: ${JSON.stringify(v.issues)}`,
    );
  }
  return executeQueries(approvedQueries);
}

// ---------------------------------------------------------------------------
// Brain 4A — LLM path
// ---------------------------------------------------------------------------

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

function buildUserPrompt(approvedQueries: Query[]): string {
  return `Approved retrieval plan from Brain 3:
${JSON.stringify(approvedQueries, null, 2)}

For each query above, output the exact GA4 request_body to execute. Return ONLY the JSON object {"queries":[...]}.`;
}

async function callLLM(
  ctx: { provider: Provider; model: string },
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; ttft_ms: number; elapsed_ms: number }> {
  const t0 = Date.now();
  let ttft_ms: number | null = null;
  let content = "";

  // ctx is DeepSeek Flash (primary) or Pro (fallback), per the routing map.
  // Stream so the reasoning model's buffered trace can't hang the call; generous
  // timeout for DeepSeek latency. response_format is intentionally omitted —
  // deepseek-v4 is unreliable with it; the prompt + extractJsonBlock yield JSON.
  const { client, model } = getClient(BRAIN_KEY, {
    provider: ctx.provider,
    model: ctx.model,
    timeoutMs: BRAIN4_TIMEOUT_MS,
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
  if (!content) throw new Error("Brain 4 (LLM path): empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? elapsed_ms, elapsed_ms };
}

type ParseResult = { ok: true; value: Query[] } | { ok: false; issues: unknown };

function tryParseQueries(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch (e) {
    return { ok: false, issues: [{ message: `not valid JSON: ${(e as Error).message}` }] };
  }
  const parsed = MetricsOutput.safeParse(json);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, value: parsed.data.queries };
}

/**
 * One attempt on a given provider/model: call → parse → catalog-validate. Throws
 * (with an escalation-classifiable message) on any failure, so the escalation
 * layer retries on the fallback (Pro). Updates `meta` with attempt count + TTFT.
 */
async function attemptLLMPath(
  ctx: { provider: Provider; model: string },
  approvedQueries: Query[],
  catalog: Catalog,
  meta: { attempts: number; ttft_ms: number },
): Promise<Query[]> {
  meta.attempts += 1;
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: BRAIN4_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(approvedQueries) },
  ];
  const r = await callLLM(ctx, messages);
  meta.ttft_ms = r.ttft_ms;

  const parsed = tryParseQueries(r.content);
  if (!parsed.ok) {
    // "schema validation" → classified escalate, so Pro gets a turn.
    throw new Error(`Brain 4 LLM path: schema validation failed: ${JSON.stringify(parsed.issues)}`);
  }
  const v = validateAgainstCatalog({ queries: parsed.value }, catalog);
  if (!v.ok) {
    // "invalid structured output" → classified escalate.
    throw new Error(
      `Brain 4 LLM path: invalid structured output — catalog validation failed: ${JSON.stringify(v.issues)}`,
    );
  }
  return parsed.value;
}

/**
 * Brain 4A. Routes per the canonical map: DeepSeek Flash (primary) → Pro
 * (fallback) on a model-attributable failure. One attempt per provider — no
 * parallel calls — then sequential GA4 execution. Throws Brain4LLMError if
 * neither provider yields a catalog-valid plan; the caller then falls back to
 * the deterministic dataset.
 */
export async function runBrain4LLM(
  approvedQueries: Query[],
  catalog: Catalog,
): Promise<{ dataset: Dataset; timing: BrainTiming; usedFallback: boolean }> {
  const startedAt = Date.now();
  const route = routeFor("brain4");
  const primaryCtx: { provider: Provider; model: string } = {
    provider: route.provider,
    model: route.model,
  };
  const meta = { attempts: 0, ttft_ms: 0 };

  let queries: Query[];
  let usedFallback = false;
  try {
    if (route.escalate && route.fallbackProvider) {
      const fallbackCtx: { provider: Provider; model: string } = {
        provider: route.fallbackProvider,
        model: route.fallbackModel ?? route.model,
      };
      const res = await withEscalation<Query[]>(
        () => attemptLLMPath(primaryCtx, approvedQueries, catalog, meta),
        () => attemptLLMPath(fallbackCtx, approvedQueries, catalog, meta),
      );
      queries = res.value;
      usedFallback = res.usedFallback;
    } else {
      queries = await attemptLLMPath(primaryCtx, approvedQueries, catalog, meta);
    }
  } catch (err) {
    throw new Brain4LLMError(
      `Brain 4 (LLM path) failed on Flash and Pro: ${(err as Error).message}`,
      "",
      undefined,
    );
  }

  const dataset = await executeQueries(queries);
  return {
    dataset,
    timing: { ttft_ms: meta.ttft_ms, total_ms: Date.now() - startedAt, attempts: meta.attempts },
    usedFallback,
  };
}

// ---------------------------------------------------------------------------
// Brain 4C — reconciliation
// ---------------------------------------------------------------------------

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

function rowKey(row: Record<string, string | number>, dimHeaders: string[]): string {
  return dimHeaders.map((h) => String(row[h] ?? "")).join("");
}

function valuesClose(a: unknown, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  const diff = Math.abs(na - nb);
  if (diff <= VALUE_ABS_TOL) return true;
  return diff / Math.max(Math.abs(nb), 1e-9) <= VALUE_REL_TOL;
}

function reconcileQuery(a: DataAccessQueryResult, b: DataAccessQueryResult): QueryReconciliation {
  const reasons: string[] = [];
  if (a.error) reasons.push(`LLM path error: ${a.error}`);
  if (b.error) reasons.push(`deterministic path error: ${b.error}`);

  const dimensionsMatch = sameSet(a.dimensionHeaders, b.dimensionHeaders);
  const metricsMatch = sameSet(
    a.metricHeaders.map((h) => h.name),
    b.metricHeaders.map((h) => h.name),
  );
  if (!dimensionsMatch) reasons.push(`dimensions differ: A=[${a.dimensionHeaders}] B=[${b.dimensionHeaders}]`);
  if (!metricsMatch) {
    reasons.push(
      `metrics differ: A=[${a.metricHeaders.map((h) => h.name)}] B=[${b.metricHeaders.map((h) => h.name)}]`,
    );
  }

  let valueMismatches = 0;
  let missing = 0;
  let compared = 0;

  if (dimensionsMatch && metricsMatch && !a.error && !b.error) {
    const aByKey = new Map(a.rows.map((r) => [rowKey(r, a.dimensionHeaders), r]));
    const metricNames = b.metricHeaders.map((h) => h.name);
    for (const br of b.rows) {
      compared++;
      const ar = aByKey.get(rowKey(br, b.dimensionHeaders));
      if (!ar) {
        missing++;
        continue;
      }
      for (const m of metricNames) {
        if (!valuesClose(ar[m], br[m])) {
          valueMismatches++;
          break;
        }
      }
    }
  }

  const denom = Math.max(compared, 1);
  const mismatchFraction = (valueMismatches + missing) / denom;
  const reconciled =
    dimensionsMatch && metricsMatch && !a.error && !b.error && mismatchFraction <= ROW_MISMATCH_TOL;
  if (reconciled === false && dimensionsMatch && metricsMatch && !a.error && !b.error) {
    reasons.push(
      `value mismatch ${(mismatchFraction * 100).toFixed(1)}% > ${(ROW_MISMATCH_TOL * 100).toFixed(0)}% ` +
        `(mismatched=${valueMismatches}, missing=${missing}, rows=${compared})`,
    );
  }

  return {
    query_id: b.query_id,
    reconciled,
    reasons,
    dimensionsMatch,
    metricsMatch,
    rowKeyOverlap: compared ? (compared - missing) / compared : 1,
    valueMismatches,
    comparedRows: compared,
  };
}

/** Brain 4C. Compare the LLM dataset (A) against the deterministic dataset (B). */
export function reconcileDatasets(a: Dataset, b: Dataset): ReconciliationReport {
  const aIds = a.map((d) => d.query_id);
  const bIds = b.map((d) => d.query_id);
  const sameQueryIntent = sameSet(aIds, bIds);
  const aById = new Map(a.map((d) => [d.query_id, d]));

  const perQuery: QueryReconciliation[] = [];
  const discrepancies: string[] = [];

  if (!sameQueryIntent) {
    discrepancies.push(`query id sets differ: A=[${aIds}] B=[${bIds}]`);
  }

  for (const bq of b) {
    const aq = aById.get(bq.query_id);
    if (!aq) {
      perQuery.push({
        query_id: bq.query_id,
        reconciled: false,
        reasons: ["missing from LLM dataset"],
        dimensionsMatch: false,
        metricsMatch: false,
        rowKeyOverlap: 0,
        valueMismatches: 0,
        comparedRows: 0,
      });
      discrepancies.push(`${bq.query_id}: missing from LLM dataset`);
      continue;
    }
    const rec = reconcileQuery(aq, bq);
    perQuery.push(rec);
    if (!rec.reconciled) discrepancies.push(`${bq.query_id}: ${rec.reasons.join("; ")}`);
  }

  const reconciled = sameQueryIntent && perQuery.every((q) => q.reconciled);
  return { reconciled, sameQueryIntent, perQuery, discrepancies };
}

// ---------------------------------------------------------------------------
// Brain 4 — orchestration of the two paths + the decision
// ---------------------------------------------------------------------------

/**
 * Run both paths and decide. Order: deterministic baseline first (our source of
 * truth), then the LLM path, then reconcile. Sequential — no parallel LLM calls.
 *
 * Decision:
 *   - LLM path failed                         → use deterministic, record reason.
 *   - datasets reconcile within tolerance     → use LLM (primary).
 *   - datasets materially differ              → use deterministic, record discrepancy.
 */
export async function runBrain4DataAccess(input: Brain4Input): Promise<Brain4Result> {
  const startedAt = Date.now();

  // Brain 4B — deterministic baseline (must succeed; it is the source of truth).
  let bDataset: Dataset;
  try {
    bDataset = await runBrain4Deterministic(input.approvedQueries, input.catalog);
  } catch (err) {
    throw new Brain4BaselineError(
      `deterministic baseline failed — cannot trust retrieval: ${(err as Error).message}`,
    );
  }

  // Brain 4A — LLM path (primary). Its failure is non-fatal: we fall back to B.
  let aDataset: Dataset | undefined;
  let aError: string | undefined;
  let aTiming: BrainTiming = { ttft_ms: 0, total_ms: 0, attempts: 0 };
  let aUsedFallback = false;
  try {
    const a = await runBrain4LLM(input.approvedQueries, input.catalog);
    aDataset = a.dataset;
    aTiming = a.timing;
    aUsedFallback = a.usedFallback;
  } catch (err) {
    aError = (err as Error).message;
  }

  // Brain 4C — decide.
  let source: PathLabel;
  let dataset: Dataset;
  let reconciliation: ReconciliationReport;

  if (!aDataset) {
    source = "deterministic";
    dataset = bDataset;
    reconciliation = {
      reconciled: false,
      sameQueryIntent: false,
      perQuery: [],
      discrepancies: [`LLM path failed: ${aError}`],
    };
  } else {
    reconciliation = reconcileDatasets(aDataset, bDataset);
    if (reconciliation.reconciled) {
      source = "llm";
      dataset = aDataset;
    } else {
      source = "deterministic";
      dataset = bDataset;
    }
  }

  return {
    dataset,
    source,
    reconciliation,
    paths: {
      llm: { ok: !!aDataset, usedFallback: aUsedFallback, error: aError, dataset: aDataset, timing: aTiming },
      deterministic: { ok: true, dataset: bDataset },
    },
    timing: { total_ms: Date.now() - startedAt },
  };
}
