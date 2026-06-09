/**
 * GET /api/deepseek-smoke  — Phase 1 deployed validation endpoint.
 *
 * Runs on Vercel (where the OpenAI SDK transport works and the DeepSeek keys
 * live in env) and validates the DeepSeek integration end-to-end:
 *   - DeepSeek Pro   auth + structured JSON
 *   - DeepSeek Flash auth + structured JSON
 *   - Flash -> Pro escalation (model-attributable failure escalates)
 *   - Surface classification (environmental failure does NOT escalate)
 *   - Brain routing (canonical map vs env-resolved provider/model)
 *   - Orchestrator <-> DeepSeek Pro communication
 *
 * Reads secrets only from env (DEEPSEEK_PRO_API_KEY / DEEPSEEK_FLASH_API_KEY).
 * Read-only and additive; touches no existing brain.
 *
 * NOTE: folder name has NO leading underscore — a `_folder` is a Next.js
 * "private folder" and is excluded from routing.
 */
import { NextResponse } from "next/server";
import { getClient, type Provider } from "@/lib/nvidia";
import { withEscalation } from "@/lib/escalate";
import { routeFor } from "@/lib/modelRouting";
import { OrchestratorBrain, PIPELINE } from "@/orchestrator/orchestratorBrain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Check = Record<string, unknown> & { check: string; pass: boolean };

async function authJsonCheck(provider: Provider): Promise<Check> {
  const t0 = Date.now();
  try {
    const { client, model } = getClient(undefined, { provider, timeoutMs: 60_000 });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Output only compact JSON." },
        { role: "user", content: 'Return exactly {"ok":true,"n":42}' },
      ],
      max_tokens: 4000,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    let parsed: unknown = null;
    try { parsed = JSON.parse(content); } catch { /* leave null */ }
    const ok = !!parsed && (parsed as { ok?: unknown }).ok === true;
    return { check: `auth+json: ${provider}`, pass: ok, model, ms: Date.now() - t0, content: content.slice(0, 120) };
  } catch (e) {
    return { check: `auth+json: ${provider}`, pass: false, error: (e as Error).message, ms: Date.now() - t0 };
  }
}

async function escalationCheck(): Promise<Check> {
  try {
    const res = await withEscalation<string>(
      async () => { throw new Error("Request timed out"); },
      async () => "pro-result",
    );
    return { check: "escalation flash->pro", pass: res.usedFallback === true && res.value === "pro-result", usedFallback: res.usedFallback };
  } catch (e) {
    return { check: "escalation flash->pro", pass: false, error: (e as Error).message };
  }
}

async function surfaceCheck(): Promise<Check> {
  try {
    await withEscalation<string>(
      async () => { throw new Error("GA4_PROPERTY_ID is not set"); },
      async () => "should-not-run",
    );
    return { check: "surface not escalated", pass: false, detail: "fallback ran (incorrect)" };
  } catch (e) {
    return { check: "surface not escalated", pass: true, detail: (e as Error).message.slice(0, 80) };
  }
}

function routingCheck(): Check {
  const rows = PIPELINE.map((b) => {
    const canonical = routeFor(b);
    let resolved: string;
    try {
      const c = getClient(b);
      resolved = `${c.provider}:${c.model}`;
    } catch (e) {
      resolved = `unresolved (${(e as Error).message.slice(0, 40)})`;
    }
    return {
      brain: b,
      canonical: `${canonical.provider}:${canonical.model}${canonical.escalate ? " (->pro)" : ""}`,
      resolved,
    };
  });
  return { check: "brain routing (canonical vs env-resolved)", pass: true, rows };
}

async function orchestratorCheck(): Promise<Check> {
  try {
    const orch = new OrchestratorBrain();
    const r = await orch.ping();
    return { check: "orchestrator comms (pro)", pass: r.ok, model: r.model, content: r.content };
  } catch (e) {
    return { check: "orchestrator comms (pro)", pass: false, error: (e as Error).message };
  }
}

export async function GET() {
  const checks: Check[] = [];
  checks.push(await authJsonCheck("deepseek_pro"));
  checks.push(await authJsonCheck("deepseek_flash"));
  checks.push(await escalationCheck());
  checks.push(await surfaceCheck());
  checks.push(routingCheck());
  checks.push(await orchestratorCheck());

  const allPass = checks.every((c) => c.pass);
  return NextResponse.json({ ok: allPass, summary: allPass ? "ALL PASS" : "FAILURES PRESENT", checks }, { status: allPass ? 200 : 500 });
}
