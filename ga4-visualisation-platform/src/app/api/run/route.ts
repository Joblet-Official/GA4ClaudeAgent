/**
 * POST /api/run
 *
 * Full pipeline: Brain 1 (intent) → Brain 2 (metrics) → Brain 3 (gaps) → Tool Layer.
 *
 * Body: { question: string, memory?: object|null }
 *
 * If Brain 3 returns `needs_clarification`, the Tool Layer is skipped — the
 * caller (UI) shows the question and waits for the user to pick an option.
 * Otherwise we fire all approved_queries in parallel against GA4 and return
 * the rows.
 *
 * This is the "actual data on the screen" milestone before Brain 5/6 transform
 * and visualise.
 */
import { NextResponse } from "next/server";
import { runBrain1Intent, BrainValidationError } from "@/brains/brain1_intent";
import { runBrain2Metrics, Brain2ValidationError } from "@/brains/brain2_metrics";
import { runBrain3Gaps, Brain3ValidationError } from "@/brains/brain3_gaps";
import { runGA4Query, GA4QueryError } from "@/support/tools/runGA4Query";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";
import type { Query } from "@/schemas/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface BrainPanel {
  output: unknown;
  timing: { ttft_ms: number; total_ms: number; attempts: number };
  provider: string;
  model: string;
}

interface ToolResult {
  query_id: string;
  rows: Array<Record<string, string | number>>;
  dimensionHeaders: string[];
  metricHeaders: Array<{ name: string; type: string }>;
  rowCount: number;
  metadata: { sampled: boolean; dataLossFromOtherRow: boolean };
  latency_ms: number;
  /** present iff the query errored */
  error?: string;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body is not valid JSON" }, { status: 400 });
  }
  const { question, memory } = (body as { question?: unknown; memory?: unknown }) ?? {};
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "question must be a non-empty string" }, { status: 400 });
  }

  const catalog = loadCatalog();
  const b1Cfg = getClient("brain1");
  const b2Cfg = getClient("brain2");
  const b3Cfg = getClient("brain3");

  // Brain 1
  let brain1Panel: BrainPanel;
  try {
    const r = await runBrain1Intent({ question, memory: memory ?? null });
    brain1Panel = { output: r.output, timing: r.timing, provider: b1Cfg.provider, model: b1Cfg.model };
  } catch (err) {
    return errorResp(err, "brain1", { provider: b1Cfg.provider, model: b1Cfg.model });
  }

  // Brain 2
  let brain2Panel: BrainPanel;
  let queries: Query[];
  try {
    const r = await runBrain2Metrics({ intent: brain1Panel.output as never, catalog });
    brain2Panel = { output: r.output, timing: r.timing, provider: b2Cfg.provider, model: b2Cfg.model };
    queries = r.output.queries;
  } catch (err) {
    return errorResp(err, "brain2", { provider: b2Cfg.provider, model: b2Cfg.model }, { brain1: brain1Panel });
  }

  // Brain 3
  let brain3Panel: BrainPanel;
  let approvedQueries: Query[];
  let b3Status: "approved" | "default_applied" | "needs_clarification";
  try {
    const r = await runBrain3Gaps({ intent: brain1Panel.output as never, queries });
    brain3Panel = { output: r.output, timing: r.timing, provider: b3Cfg.provider, model: b3Cfg.model };
    approvedQueries = r.output.approved_queries;
    b3Status = r.output.status;
  } catch (err) {
    return errorResp(err, "brain3", { provider: b3Cfg.provider, model: b3Cfg.model }, { brain1: brain1Panel, brain2: brain2Panel });
  }

  // If Brain 3 says clarify, return without firing GA4
  if (b3Status === "needs_clarification") {
    return NextResponse.json({
      ok: true,
      brain1: brain1Panel,
      brain2: brain2Panel,
      brain3: brain3Panel,
      tool: null,
    });
  }

  // Tool Layer — parallel GA4 calls, one per query
  const toolT0 = Date.now();
  const toolResults: ToolResult[] = await Promise.all(
    approvedQueries.map(async (q) => {
      const t0 = Date.now();
      try {
        const r = await runGA4Query(q.request_body);
        return {
          query_id: q.id,
          rows: r.rows,
          dimensionHeaders: r.dimensionHeaders,
          metricHeaders: r.metricHeaders,
          rowCount: r.rowCount,
          metadata: { sampled: r.metadata.sampled, dataLossFromOtherRow: r.metadata.dataLossFromOtherRow },
          latency_ms: Date.now() - t0,
        };
      } catch (err) {
        return {
          query_id: q.id,
          rows: [],
          dimensionHeaders: [],
          metricHeaders: [],
          rowCount: 0,
          metadata: { sampled: false, dataLossFromOtherRow: false },
          latency_ms: Date.now() - t0,
          error: err instanceof GA4QueryError ? err.message : (err as Error).message,
        };
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    brain1: brain1Panel,
    brain2: brain2Panel,
    brain3: brain3Panel,
    tool: {
      results: toolResults,
      total_ms: Date.now() - toolT0,
    },
  });
}

function errorResp(
  err: unknown,
  stage: "brain1" | "brain2" | "brain3",
  cfg: { provider: string; model: string },
  panels?: { brain1?: BrainPanel; brain2?: BrainPanel },
) {
  if (err instanceof BrainValidationError && stage === "brain1") {
    return NextResponse.json(
      {
        ok: false,
        stage,
        error: err.message,
        raw_output: err.rawOutput,
        zod_issues: err.zodIssues,
        timing: err.timing,
        stage_provider: cfg.provider,
        stage_model: cfg.model,
        ...panels,
      },
      { status: 422 },
    );
  }
  if (err instanceof Brain2ValidationError && stage === "brain2") {
    return NextResponse.json(
      {
        ok: false,
        stage,
        error: err.message,
        raw_output: err.rawOutput,
        zod_issues: err.zodIssues,
        catalog_issues: err.catalogIssues,
        timing: err.timing,
        stage_provider: cfg.provider,
        stage_model: cfg.model,
        ...panels,
      },
      { status: 422 },
    );
  }
  if (err instanceof Brain3ValidationError && stage === "brain3") {
    return NextResponse.json(
      {
        ok: false,
        stage,
        error: err.message,
        raw_output: err.rawOutput,
        zod_issues: err.zodIssues,
        timing: err.timing,
        stage_provider: cfg.provider,
        stage_model: cfg.model,
        ...panels,
      },
      { status: 422 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      stage,
      error: (err as Error).message ?? "Unknown error",
      stage_provider: cfg.provider,
      stage_model: cfg.model,
      ...panels,
    },
    { status: 500 },
  );
}
