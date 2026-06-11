/**
 * POST /api/brain2
 *
 * Two modes:
 *   1. Pipeline:  { question: string, memory?: object|null }
 *                 → runs Brain 1, then Brain 2 on Brain 1's output
 *   2. Direct:    { intent: IntentOutput }
 *                 → skips Brain 1, runs Brain 2 against the provided intent
 *
 * Useful for poking at Brain 2 in isolation (mode 2) without rebuilding Brain 1.
 *
 * Returns timing/provider/model per brain so the UI can show "where the time went".
 */
import { NextResponse } from "next/server";
import { runBrain1Intent, BrainValidationError } from "@/brains/brain1_intent";
import { runBrain2Metrics, Brain2ValidationError } from "@/brains/brain2_metrics";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";
import { IntentOutput, type IntentOutput as IntentOutputT } from "@/schemas/intent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro tier max. Brain 2 p95 ~3.5s; combined B1+B2 p95 ~4.5s. Plenty of headroom.
export const maxDuration = 300; // Vercel Pro ceiling — L3/L4 pipelines run 2-3+ min

interface PipelineBody {
  question: string;
  memory?: unknown;
}
interface DirectBody {
  intent: unknown;
}

function isPipeline(body: unknown): body is PipelineBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as PipelineBody).question === "string" &&
    (body as PipelineBody).question.trim().length > 0
  );
}
function isDirect(body: unknown): body is DirectBody {
  return (
    typeof body === "object" &&
    body !== null &&
    "intent" in (body as Record<string, unknown>) &&
    typeof (body as DirectBody).intent === "object"
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body is not valid JSON" }, { status: 400 });
  }

  const catalog = loadCatalog();
  const b1Cfg = getClient("brain1");
  const b2Cfg = getClient("brain2");

  // Mode 1: pipeline (run Brain 1 first)
  if (isPipeline(body)) {
    let brain1Output: IntentOutputT;
    let brain1Timing;
    try {
      const r = await runBrain1Intent({ question: body.question, memory: body.memory ?? null });
      brain1Output = r.output;
      brain1Timing = r.timing;
    } catch (err) {
      if (err instanceof BrainValidationError) {
        return NextResponse.json(
          {
            ok: false,
            stage: "brain1",
            error: err.message,
            raw_output: err.rawOutput,
            zod_issues: err.zodIssues,
            timing: err.timing,
            brain1_provider: b1Cfg.provider,
            brain1_model: b1Cfg.model,
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          stage: "brain1",
          error: (err as Error).message,
          brain1_provider: b1Cfg.provider,
          brain1_model: b1Cfg.model,
        },
        { status: 500 },
      );
    }

    try {
      const r = await runBrain2Metrics({ intent: brain1Output, catalog });
      return NextResponse.json({
        ok: true,
        brain1: {
          output: brain1Output,
          timing: brain1Timing,
          provider: b1Cfg.provider,
          model: b1Cfg.model,
        },
        brain2: {
          output: r.output,
          timing: r.timing,
          provider: b2Cfg.provider,
          model: b2Cfg.model,
        },
      });
    } catch (err) {
      return handleBrain2Error(err, brain1Output, brain1Timing, b1Cfg, b2Cfg);
    }
  }

  // Mode 2: direct (user supplied an Intent — skip Brain 1)
  if (isDirect(body)) {
    const parsed = IntentOutput.safeParse(body.intent);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Provided intent does not match IntentOutput schema",
          zod_issues: parsed.error.issues,
        },
        { status: 400 },
      );
    }
    try {
      const r = await runBrain2Metrics({ intent: parsed.data, catalog });
      return NextResponse.json({
        ok: true,
        brain2: {
          output: r.output,
          timing: r.timing,
          provider: b2Cfg.provider,
          model: b2Cfg.model,
        },
      });
    } catch (err) {
      return handleBrain2Error(err, parsed.data, null, b1Cfg, b2Cfg);
    }
  }

  return NextResponse.json(
    { ok: false, error: "Body must include either { question } or { intent: {...} }" },
    { status: 400 },
  );
}

function handleBrain2Error(
  err: unknown,
  intent: IntentOutputT,
  brain1Timing: unknown,
  b1Cfg: { provider: string; model: string },
  b2Cfg: { provider: string; model: string },
) {
  if (err instanceof Brain2ValidationError) {
    return NextResponse.json(
      {
        ok: false,
        stage: "brain2",
        error: err.message,
        raw_output: err.rawOutput,
        zod_issues: err.zodIssues,
        catalog_issues: err.catalogIssues,
        timing: err.timing,
        brain1: brain1Timing
          ? { output: intent, timing: brain1Timing, provider: b1Cfg.provider, model: b1Cfg.model }
          : undefined,
        brain2_provider: b2Cfg.provider,
        brain2_model: b2Cfg.model,
      },
      { status: 422 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      stage: "brain2",
      error: (err as Error).message,
      brain1: brain1Timing
        ? { output: intent, timing: brain1Timing, provider: b1Cfg.provider, model: b1Cfg.model }
        : undefined,
      brain2_provider: b2Cfg.provider,
      brain2_model: b2Cfg.model,
    },
    { status: 500 },
  );
}
