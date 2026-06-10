/**
 * POST /api/brain5
 *
 * Additive route exercising the pipeline through Brain 5 (Data Handling):
 * Brain 1 → 2 → 3 → 4 (dual-path) → 5 (reshape into data_blocks).
 *
 * Body: { question: string, memory?: object|null }
 *
 * If Brain 3 needs clarification, retrieval + handling are skipped (brain4/brain5
 * null). Does not modify /api/run, /api/brain4, or Brains 1–4.
 */
import { NextResponse } from "next/server";
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps } from "@/brains/brain3_gaps";
import { runBrain4DataAccess, Brain4BaselineError } from "@/brains/brain4_dataaccess";
import { runBrain5DataHandling } from "@/brains/brain5_datahandling";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const cfg = (b: string) => {
    const c = getClient(b);
    return { provider: c.provider, model: c.model };
  };

  try {
    const b1 = await runBrain1Intent({ question, memory: memory ?? null });
    const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
    const b3 = await runBrain3Gaps({ intent: b1.output, queries: b2.output.queries });

    const panels = {
      brain1: { output: b1.output, timing: b1.timing, ...cfg("brain1") },
      brain2: { output: b2.output, timing: b2.timing, ...cfg("brain2") },
      brain3: { output: b3.output, timing: b3.timing, ...cfg("brain3") },
    };

    if (b3.output.status === "needs_clarification") {
      return NextResponse.json({ ok: true, ...panels, brain4: null, brain5: null });
    }

    const b4 = await runBrain4DataAccess({
      approvedQueries: b3.output.approved_queries,
      intent: b1.output,
      catalog,
    });

    const b5 = await runBrain5DataHandling({ dataset: b4.dataset, intent: b1.output });

    return NextResponse.json({
      ok: true,
      ...panels,
      brain4: {
        source: b4.source,
        reconciliation: b4.reconciliation,
        timing: b4.timing,
        ...cfg("brain4"),
      },
      brain5: {
        source: b5.source,
        ...cfg("brain5"),
        timing: b5.timing,
        llm: b5.llm,
        plan: b5.plan,
        output: b5.output,
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
