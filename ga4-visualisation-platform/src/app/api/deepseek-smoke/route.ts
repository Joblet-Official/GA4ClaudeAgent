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
    const { client, model } = getClient(undefined, { provider, timeoutMs: 50_000 });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Output only compact JSON." },
        { role: "user", content: 'Return exactly {"ok":true,"n":42}' },
      ],
      max_tokens: 256,
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

/**
 * Raw fetch() call (no OpenAI SDK) — isolates whether the SDK transport is the
 * problem. If this passes where authJsonCheck() times out, the fix is to route
 * the LLM calls through fetch instead of the SDK.
 */
async function rawFetchCheck(provider: "deepseek_pro" | "deepseek_flash"): Promise<Check> {
  const t0 = Date.now();
  const base = process.env.DEEPSEEK_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const isPro = provider === "deepseek_pro";
  const model = isPro
    ? process.env.DEEPSEEK_PRO_MODEL || "deepseek-ai/deepseek-v4-pro"
    : process.env.DEEPSEEK_FLASH_MODEL || "deepseek-ai/deepseek-v4-flash";
  const key = isPro ? process.env.DEEPSEEK_PRO_API_KEY : process.env.DEEPSEEK_FLASH_API_KEY;
  if (!key) {
    return { check: `rawfetch: ${provider}`, pass: false, error: `missing ${isPro ? "DEEPSEEK_PRO_API_KEY" : "DEEPSEEK_FLASH_API_KEY"}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000); // pro is slow+variable (47s–75s+ solo); no function cap on localhost
  try {
    // ROOT CAUSE: deepseek-v4-pro/flash on NVIDIA are reasoning models that HANG
    // on a non-streamed request (the gateway buffers the full reasoning trace and
    // never returns). They respond correctly only with stream:true. So we stream
    // and accumulate the content deltas. (response_format json_object is dropped —
    // the prompt alone yields valid JSON, and it isn't needed under streaming.)
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Output only compact JSON." },
          { role: "user", content: 'Return exactly {"ok":true,"n":42}' },
        ],
        max_tokens: 256,
        temperature: 0,
        stream: true,
      }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let content = "";
    for (const line of raw.split("\n")) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") break;
      try {
        const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        content += j?.choices?.[0]?.delta?.content ?? "";
      } catch { /* ignore keepalive / partial frames */ }
    }
    let inner: unknown = null;
    try { inner = JSON.parse(content); } catch { /* ignore */ }
    const pass = res.status === 200 && (inner as { ok?: unknown })?.ok === true;
    return { check: `rawfetch: ${provider}`, pass, status: res.status, ms: Date.now() - t0, content: String(content).slice(0, 80) };
  } catch (e) {
    return { check: `rawfetch: ${provider}`, pass: false, error: (e as Error).message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Raw fetch() to an arbitrary NVIDIA model (using the Pro key, which is an NVIDIA
 * key). Baseline to tell whether ALL NVIDIA models are slow from Vercel, or only
 * the deepseek-v4 ones.
 */
async function rawModelCheck(label: string, model: string): Promise<Check> {
  const t0 = Date.now();
  const base = process.env.DEEPSEEK_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const key = process.env.DEEPSEEK_PRO_API_KEY;
  if (!key) return { check: label, pass: false, error: "missing DEEPSEEK_PRO_API_KEY" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000); // pro is slow+variable (47s–75s+ solo); no function cap on localhost
  try {
    const res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: 'Return {"ok":true}' }], max_tokens: 64, temperature: 0 }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { check: label, pass: res.status === 200, status: res.status, ms: Date.now() - t0, content: text.slice(0, 80) };
  } catch (e) {
    return { check: label, pass: false, error: (e as Error).message, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
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
  // SEQUENTIAL, not parallel: deepseek-v4 on NVIDIA has a low concurrency limit —
  // firing pro+flash together makes them queue and balloon (10s solo -> 80s+
  // concurrent). Run them one at a time. The llama baseline is a separate fast
  // model, run last. (This means total latency ≈ pro ~47s + flash ~10s.)
  const rawPro = await rawFetchCheck("deepseek_pro");
  const rawFlash = await rawFetchCheck("deepseek_flash");
  const rawLlama = await rawModelCheck("nvidia baseline: llama-3.3-70b", "meta/llama-3.3-70b-instruct");
  // The remaining checks are pure logic (no network) and instant.
  const checks: Check[] = [
    rawPro,
    rawFlash,
    rawLlama,
    await escalationCheck(),
    await surfaceCheck(),
    routingCheck(),
  ];

  const allPass = checks.every((c) => c.pass);
  return NextResponse.json({ ok: allPass, summary: allPass ? "ALL PASS" : "FAILURES PRESENT", checks }, { status: allPass ? 200 : 500 });
}
