/**
 * POST /api/brain4
 *
 * Additive route that exercises the pipeline through Brain 4 (dual-path Data
 * Access). Mirrors /api/run's chain (Brain 1 → 2 → 3) but, instead of the old
 * inline Tool Layer, routes the approved plan through Brain 4A/4B/4C.
 *
 * Body: { question: string, memory?: object|null }
 *
 * If Brain 3 returns needs_clarification, retrieval is skipped (brain4: null).
 * Otherwise returns the chosen dataset, the path that produced it, and the full
 * reconciliation report.
 *
 * This route does NOT modify /api/run or Brains 1–3.
 */
import { NextResponse } from "next/server";
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps } from "@/brains/brain3_gaps";
import { runBrain4DataAccess, Brain4BaselineError } from "@/brains/brain4_dataaccess";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro ceiling — L3/L4 pipelines run 2-3+ min

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
  const b4Cfg = getClient("brain4");

  try {
    // Brain 1 → 2 → 3 (unchanged behavior)
    const b1 = await runBrain1Intent({ question, memory: memory ?? null });
    const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
    const b3 = await runBrain3Gaps({ intent: b1.output, queries: b2.output.queries });

    const panels = {
      brain1: { output: b1.output, timing: b1.timing, provider: b1Cfg.provider, model: b1Cfg.model },
      brain2: { output: b2.output, timing: b2.timing, provider: b2Cfg.provider, model: b2Cfg.model },
      brain3: { output: b3.output, timing: b3.timing, provider: b3Cfg.provider, model: b3Cfg.model },
    };

    if (b3.output.status === "needs_clarification") {
      return NextResponse.json({ ok: true, ...panels, brain4: null });
    }

    // Brain 4 — dual-path data access
    const b4 = await runBrain4DataAccess({
      approvedQueries: b3.output.approved_queries,
      intent: b1.output,
      catalog,
    });

    return NextResponse.json({
      ok: true,
      ...panels,
      brain4: {
        source: b4.source,
        provider: b4Cfg.provider,
        model: b4Cfg.model,
        reconciliation: b4.reconciliation,
        timing: b4.timing,
        llm_timing: b4.paths.llm.timing,
        llm_ok: b4.paths.llm.ok,
        llm_error: b4.paths.llm.error,
        dataset: b4.dataset,
      },
    });
  } catch (err) {
    const status = err instanceof Brain4BaselineError ? 502 : 500;
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "Unknown error", name: (err as Error).name },
      { status },
    );
  }
}
