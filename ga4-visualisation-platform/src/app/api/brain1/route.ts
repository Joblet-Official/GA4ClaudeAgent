/**
 * POST /api/brain1
 *
 * Body: { question: string, memory?: object|null }
 *
 * Success: { ok: true, output, timing: { ttft_ms, total_ms, attempts }, provider, model }
 * Error:   { ok: false, error, raw_output?, zod_issues?, timing? }
 */
import { NextResponse } from "next/server";
import {
  runBrain1Intent,
  BrainValidationError,
} from "@/brains/brain1_intent";
import { getClient } from "@/lib/nvidia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Pro tier max. Brain 1 typical p95 < 2s; this is the safety net.
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  const { question, memory } = (body as {
    question?: unknown;
    memory?: unknown;
  }) ?? {};

  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "question must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const { output, timing } = await runBrain1Intent({
      question,
      memory: memory ?? null,
    });
    return NextResponse.json({
      ok: true,
      output,
      timing,
      provider: getClient("brain1").provider,
      model: getClient("brain1").model,
    });
  } catch (err) {
    const cfg = getClient("brain1");
    if (err instanceof BrainValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          raw_output: err.rawOutput,
          zod_issues: err.zodIssues,
          timing: err.timing,
          provider: cfg.provider,
          model: cfg.model,
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message ?? "Unknown error",
        provider: cfg.provider,
        model: cfg.model,
      },
      { status: 500 },
    );
  }
}
