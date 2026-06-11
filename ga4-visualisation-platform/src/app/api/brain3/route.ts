/**
 * POST /api/brain3
 *
 * Three modes:
 *   1. Pipeline:  { question: string, memory?: object|null }
 *                 → runs Brain 1, Brain 2, then Brain 3 on B2's queries
 *   2. From Brain 2: { intent: IntentOutput, queries: Query[] }
 *                 → skips Brain 1+2, runs Brain 3 directly on the supplied state
 *   3. Mixed:    { intent: IntentOutput }  → runs Brain 2 then Brain 3
 *
 * Use Mode 2 to iterate on Brain 3's prompt without burning Brain 1/2 quota.
 */
import { NextResponse } from "next/server";
import { runBrain1Intent, BrainValidationError } from "@/brains/brain1_intent";
import { runBrain2Metrics, Brain2ValidationError } from "@/brains/brain2_metrics";
import { runBrain3Gaps, Brain3ValidationError } from "@/brains/brain3_gaps";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";
import { IntentOutput, type IntentOutput as IntentOutputT } from "@/schemas/intent";
import { Query, type Query as QueryT } from "@/schemas/metrics";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro ceiling — L3/L4 pipelines run 2-3+ min

const PipelineBody = z.object({ question: z.string().min(1), memory: z.unknown().optional() });
const Brain2OutBody = z.object({ intent: IntentOutput, queries: z.array(Query).min(1) });
const IntentOnlyBody = z.object({ intent: IntentOutput });

interface BrainPanel {
  output: unknown;
  timing: unknown;
  provider: string;
  model: string;
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
  const b3Cfg = getClient("brain3");

  let intent: IntentOutputT;
  let queries: QueryT[];
  let brain1Panel: BrainPanel | undefined;
  let brain2Panel: BrainPanel | undefined;

  // Mode 2: queries already supplied
  const b2Parsed = Brain2OutBody.safeParse(body);
  if (b2Parsed.success) {
    intent = b2Parsed.data.intent;
    queries = b2Parsed.data.queries;
  } else {
    // Mode 3: intent supplied, run Brain 2
    const intentOnly = IntentOnlyBody.safeParse(body);
    if (intentOnly.success) {
      intent = intentOnly.data.intent;
      try {
        const b2 = await runBrain2Metrics({ intent, catalog });
        queries = b2.output.queries;
        brain2Panel = { output: b2.output, timing: b2.timing, provider: b2Cfg.provider, model: b2Cfg.model };
      } catch (err) {
        return handleBrainError(err, "brain2", { b1Cfg, b2Cfg, b3Cfg }, undefined);
      }
    } else {
      // Mode 1: full pipeline
      const pipe = PipelineBody.safeParse(body);
      if (!pipe.success) {
        return NextResponse.json(
          { ok: false, error: "Body must include either { question }, { intent }, or { intent, queries }" },
          { status: 400 },
        );
      }
      try {
        const b1 = await runBrain1Intent({ question: pipe.data.question, memory: pipe.data.memory ?? null });
        intent = b1.output;
        brain1Panel = { output: b1.output, timing: b1.timing, provider: b1Cfg.provider, model: b1Cfg.model };
      } catch (err) {
        return handleBrainError(err, "brain1", { b1Cfg, b2Cfg, b3Cfg }, undefined);
      }
      try {
        const b2 = await runBrain2Metrics({ intent, catalog });
        queries = b2.output.queries;
        brain2Panel = { output: b2.output, timing: b2.timing, provider: b2Cfg.provider, model: b2Cfg.model };
      } catch (err) {
        return handleBrainError(err, "brain2", { b1Cfg, b2Cfg, b3Cfg }, brain1Panel);
      }
    }
  }

  // Brain 3
  try {
    const b3 = await runBrain3Gaps({ intent, queries });
    return NextResponse.json({
      ok: true,
      brain1: brain1Panel,
      brain2: brain2Panel,
      brain3: { output: b3.output, timing: b3.timing, provider: b3Cfg.provider, model: b3Cfg.model },
    });
  } catch (err) {
    return handleBrainError(err, "brain3", { b1Cfg, b2Cfg, b3Cfg }, brain1Panel, brain2Panel);
  }
}

function handleBrainError(
  err: unknown,
  stage: "brain1" | "brain2" | "brain3",
  cfgs: { b1Cfg: { provider: string; model: string }; b2Cfg: { provider: string; model: string }; b3Cfg: { provider: string; model: string } },
  brain1Panel?: BrainPanel,
  brain2Panel?: BrainPanel,
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
        brain1: brain1Panel,
        brain2: brain2Panel,
        stage_provider: cfgs.b1Cfg.provider,
        stage_model: cfgs.b1Cfg.model,
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
        brain1: brain1Panel,
        stage_provider: cfgs.b2Cfg.provider,
        stage_model: cfgs.b2Cfg.model,
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
        brain1: brain1Panel,
        brain2: brain2Panel,
        stage_provider: cfgs.b3Cfg.provider,
        stage_model: cfgs.b3Cfg.model,
      },
      { status: 422 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      stage,
      error: (err as Error).message ?? "Unknown error",
      brain1: brain1Panel,
      brain2: brain2Panel,
      stage_provider: stage === "brain1" ? cfgs.b1Cfg.provider : stage === "brain2" ? cfgs.b2Cfg.provider : cfgs.b3Cfg.provider,
      stage_model: stage === "brain1" ? cfgs.b1Cfg.model : stage === "brain2" ? cfgs.b2Cfg.model : cfgs.b3Cfg.model,
    },
    { status: 500 },
  );
}
