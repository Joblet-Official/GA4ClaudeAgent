/**
 * POST /api/brain6
 *
 * Full pipeline: Brain 1 → 2 → 3 → 4 (dual-path) → 5 (data handling) → 6
 * (visualisation). Renders a self-contained HTML report and writes it to
 * ./reports. Additive; does not modify /api/run or Brains 1–5.
 *
 * Body: { question: string, memory?: object|null }
 */
import { NextResponse } from "next/server";
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps } from "@/brains/brain3_gaps";
import { runBrain4DataAccess, Brain4BaselineError } from "@/brains/brain4_dataaccess";
import { runBrain5DataHandling } from "@/brains/brain5_datahandling";
import { runBrain6Report, writeReport } from "@/brains/brain6_visualisation";
import { loadCatalog } from "@/support/catalog/loadCatalog";

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
  try {
    const b1 = await runBrain1Intent({ question, memory: memory ?? null });
    const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
    const b3 = await runBrain3Gaps({ intent: b1.output, queries: b2.output.queries });

    if (b3.output.status === "needs_clarification") {
      return NextResponse.json({
        ok: true,
        status: "needs_clarification",
        question_for_user: b3.output.question_for_user,
        options: b3.output.options,
      });
    }

    const b4 = await runBrain4DataAccess({ approvedQueries: b3.output.approved_queries, intent: b1.output, catalog });
    const b5 = await runBrain5DataHandling({ dataset: b4.dataset, intent: b1.output, approvedQueries: b3.output.approved_queries });
    const periods = (b3.output.approved_queries[0]?.request_body.dateRanges ?? []) as Array<{
      startDate: string;
      endDate: string;
      name?: string;
    }>;
    const b6 = await runBrain6Report({
      blocks: b5.output,
      intent: b1.output,
      question,
      periods,
      propertyId: process.env.GA4_PROPERTY_ID,
    });

    const reportPath = await writeReport(b6.html, { slug: question });

    return NextResponse.json({
      ok: true,
      report_path: reportPath,
      brain4: { source: b4.source, reconciled: b4.reconciliation.reconciled },
      brain5: { source: b5.source, blocks: b5.output.blocks.length },
      brain6: { source: b6.source, sections: b6.spec.sections.length, llm: b6.llm, timing: b6.timing },
    });
  } catch (err) {
    const status = err instanceof Brain4BaselineError ? 502 : 500;
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "Unknown error", name: (err as Error).name },
      { status },
    );
  }
}
