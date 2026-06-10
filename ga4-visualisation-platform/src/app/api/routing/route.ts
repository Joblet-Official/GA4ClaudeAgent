/**
 * GET /api/routing
 *
 * Reports, per brain, the CANONICAL route (modelRouting.ts — the production
 * design) versus what a call would ACTUALLY execute on right now:
 *   - brains 1–3 resolve their provider from env (LLM_PROVIDER_BRAINn) at call
 *     time, so a localhost .env.local override changes their executes_on;
 *   - brains 4–6 route via the canonical map internally (routeFor), so their
 *     executes_on is the map.
 * The UI uses this to show truthful provider chips and to flag when a temporary
 * localhost override is active (executes_on ≠ canonical).
 */
import { NextResponse } from "next/server";
import { getClient } from "@/lib/nvidia";
import { routeFor, type BrainName } from "@/lib/modelRouting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Brains that resolve provider from env at call time (legacy pattern). */
const ENV_DRIVEN = new Set<BrainName>(["brain1", "brain2", "brain3"]);

const BRAINS: BrainName[] = ["brain1", "brain2", "brain3", "brain4", "brain5", "brain6"];

export async function GET() {
  const rows = BRAINS.map((b) => {
    const canonical = routeFor(b);
    let envResolved: string | null = null;
    try {
      const c = getClient(b);
      envResolved = c.provider;
    } catch {
      envResolved = null;
    }
    const executes_on = ENV_DRIVEN.has(b) ? (envResolved ?? canonical.provider) : canonical.provider;
    return {
      brain: b,
      canonical: canonical.provider,
      fallback: canonical.escalate ? canonical.fallbackProvider ?? null : null,
      executes_on,
      override_active: executes_on !== canonical.provider,
    };
  });
  return NextResponse.json({ ok: true, rows, any_override: rows.some((r) => r.override_active) });
}
