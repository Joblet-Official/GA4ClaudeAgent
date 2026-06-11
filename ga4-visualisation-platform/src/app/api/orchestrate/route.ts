/**
 * POST /api/orchestrate
 *
 * Runs the full B1→B6 pipeline under the Orchestrator (OrchestratorBrain.runStage)
 * and writes the rendered report. Returns the per-stage orchestrator state.
 *
 * Body: { question: string, memory?: object|null }
 *
 * Additive: does not modify /api/run, /api/brainN, or any brain.
 */
import { NextResponse } from "next/server";
import { runPipeline, PipelineError } from "@/orchestrator/runPipeline";
import { writeReport } from "@/brains/brain6_visualisation";

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

  try {
    const result = await runPipeline({ question, memory });

    if (result.status === "needs_clarification") {
      return NextResponse.json({
        ok: true,
        status: "needs_clarification",
        question_for_user: result.brain3.output.question_for_user,
        options: result.brain3.output.options,
        orchestrator: result.orchestrator,
      });
    }

    const reportPath = await writeReport(result.brain6!.html, { slug: question });

    // Structured one-line run summary → Vercel runtime logs (server-side
    // observability: question, outcome, provider + timing per stage).
    console.log(
      "[orchestrate]",
      JSON.stringify({
        question,
        status: "complete",
        stages: result.orchestrator.stages.map((s) => ({
          brain: s.brain,
          status: s.status,
          provider: s.provider,
          ms: s.ms,
        })),
      }),
    );

    return NextResponse.json({
      ok: true,
      status: "complete",
      report_path: reportPath,
      // Inline HTML — the UI opens this as a Blob, so reports work on Vercel's
      // read-only filesystem (the /tmp file is per-instance best-effort only).
      report_html: result.brain6!.html,
      brain4: { source: result.brain4!.source, reconciled: result.brain4!.reconciliation.reconciled },
      brain5: { source: result.brain5!.source, blocks: result.brain5!.output.blocks.length },
      brain6: { source: result.brain6!.source, sections: result.brain6!.spec.sections.length },
      orchestrator: result.orchestrator,
    });
  } catch (err) {
    if (err instanceof PipelineError) {
      console.log(
        "[orchestrate]",
        JSON.stringify({
          question,
          status: "failed",
          error: err.message,
          failed_stage: err.state.stages.find((s) => s.status === "failed")?.brain ?? null,
        }),
      );
      const status = err.causeName === "Brain4BaselineError" ? 502 : 500;
      return NextResponse.json(
        { ok: false, error: err.message, name: err.causeName, orchestrator: err.state },
        { status },
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "Unknown error", name: (err as Error).name },
      { status: 500 },
    );
  }
}
