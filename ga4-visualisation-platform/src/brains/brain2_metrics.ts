/**
 * Brain 2 — Metrics.
 *
 * Reads { intent (Brain 1 output), catalog, today? } → returns a list of GA4
 * Data API query specs, one per sub-question. Each query is Zod-validated AND
 * catalog-validated (no hallucinated field names allowed past this point).
 *
 * Date resolution happens in code (resolveDateRange), not in the LLM — the
 * model only reasons about field names. That cuts prompt size and removes a
 * source of arithmetic error.
 *
 * Failure model: same as Brain 1. One retry with errors (Zod + catalog) fed
 * back; second failure throws BrainValidationError → orchestrator regex fallback.
 */
import { getClient } from "@/lib/nvidia";
import type { IntentOutput } from "@/schemas/intent";

const BRAIN_KEY = "brain2";
import {
  MetricsOutput,
  type MetricsOutput as MetricsOutputT,
} from "@/schemas/metrics";
import { buildBrain2SystemPrompt } from "@/brains/prompts/brain2_metrics";
import type { Catalog } from "@/support/catalog/loadCatalog";
import { resolveDateRange, comparisonDefaults, previousPeriod } from "@/support/dates";
import { validateAgainstCatalog, type CatalogValidationIssue } from "@/orchestrator/validate";

const TEMPERATURE = 0.1;
// Diagnostic playbooks emit ~8 queries (~3-4k tokens of JSON); 1600 truncated them.
const MAX_TOKENS = 6000;

export interface BrainTiming {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}

export interface Brain2Result {
  output: MetricsOutputT;
  timing: BrainTiming;
}

export class Brain2ValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly zodIssues: unknown,
    public readonly catalogIssues: CatalogValidationIssue[],
    public readonly timing: BrainTiming,
  ) {
    super(message);
    this.name = "Brain2ValidationError";
  }
}

function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return trimmed;
}

export interface Brain2Input {
  intent: IntentOutput;
  catalog: Catalog;
  /** Today's date (UTC). Injectable for deterministic tests. */
  today?: Date;
}

function buildUserPrompt(input: Brain2Input): string {
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);

  // Resolve dates in code so the LLM doesn't have to. ALWAYS provide both the
  // current window and the equal-length baseline window: diagnostic playbooks
  // and confirm-style queries need both, and the LLM must never do date math.
  let dateBlock: string;
  if (input.intent.report_type === "comparison" && input.intent.scope.dateRange == null) {
    const [curr, prev] = comparisonDefaults(input.today);
    dateBlock =
      `Resolved comparison windows (use BOTH in dateRanges):\n` +
      `  current:  { startDate: "${curr.startDate}", endDate: "${curr.endDate}", name: "current" }\n` +
      `  baseline: { startDate: "${prev.startDate}", endDate: "${prev.endDate}", name: "baseline" }`;
  } else {
    const r = resolveDateRange(input.intent.scope.dateRange, input.today);
    const base = previousPeriod(r);
    dateBlock =
      `Resolved current window: { startDate: "${r.startDate}", endDate: "${r.endDate}", name: "current" }\n` +
      `Equal-length baseline window (for comparison/diagnostic queries): { startDate: "${base.startDate}", endDate: "${base.endDate}", name: "baseline" }`;
  }

  return `Today's date (UTC): ${today}

${dateBlock}

Brain 1 Intent output:
${JSON.stringify(input.intent, null, 2)}

Produce the queries JSON.`;
}

async function callLLM(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<{ content: string; ttft_ms: number; elapsed_ms: number }> {
  const t0 = Date.now();
  let ttft_ms: number | null = null;
  let content = "";

  const { client, model } = getClient(BRAIN_KEY);
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    stream: true,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      if (ttft_ms === null) ttft_ms = Date.now() - t0;
      content += delta;
    }
  }

  const elapsed_ms = Date.now() - t0;
  if (!content) throw new Error("Brain 2: empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? elapsed_ms, elapsed_ms };
}

interface ParseFailure {
  zodIssues?: unknown;
  catalogIssues?: CatalogValidationIssue[];
  reason: string;
}

function validate(raw: string, catalog: Catalog): { ok: true; value: MetricsOutputT } | { ok: false; fail: ParseFailure } {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch (e) {
    return { ok: false, fail: { reason: `JSON.parse failed: ${(e as Error).message}` } };
  }

  const zod = MetricsOutput.safeParse(json);
  if (!zod.success) {
    return {
      ok: false,
      fail: {
        zodIssues: zod.error.issues,
        reason: "schema validation failed",
      },
    };
  }

  const cat = validateAgainstCatalog(zod.data, catalog);
  if (!cat.ok) {
    return {
      ok: false,
      fail: {
        catalogIssues: cat.issues,
        reason: "catalog validation failed (unknown field names)",
      },
    };
  }

  return { ok: true, value: zod.data };
}

export async function runBrain2Metrics(input: Brain2Input): Promise<Brain2Result> {
  const startedAt = Date.now();
  const systemPrompt = buildBrain2SystemPrompt(input.catalog);

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const first = await callLLM(messages);
  const firstResult = validate(first.content, input.catalog);
  if (firstResult.ok) {
    return {
      output: firstResult.value,
      timing: {
        ttft_ms: first.ttft_ms,
        total_ms: Date.now() - startedAt,
        attempts: 1,
      },
    };
  }

  // Build a retry message that surfaces both Zod and catalog issues.
  const errorParts: string[] = [];
  if (firstResult.fail.zodIssues) {
    errorParts.push(`Schema errors: ${JSON.stringify(firstResult.fail.zodIssues)}`);
  }
  if (firstResult.fail.catalogIssues) {
    const unknown = firstResult.fail.catalogIssues
      .map((i) => `'${i.name}' (${i.kind} at ${i.location} in ${i.query_id})`)
      .join(", ");
    errorParts.push(
      `Unknown field names not in catalog: ${unknown}. Use ONLY names from the VALID NAMES list in the system prompt.`,
    );
  }

  messages.push({ role: "user", content: first.content });
  messages.push({
    role: "user",
    content: `Your previous response was rejected. ${errorParts.join(" ")} Return ONLY the corrected JSON, no prose, no code fences.`,
  });

  const second = await callLLM(messages);
  const secondResult = validate(second.content, input.catalog);
  const timing: BrainTiming = {
    ttft_ms: second.ttft_ms,
    total_ms: Date.now() - startedAt,
    attempts: 2,
  };

  if (secondResult.ok) {
    return { output: secondResult.value, timing };
  }

  throw new Brain2ValidationError(
    "Brain 2 failed validation twice",
    second.content,
    secondResult.fail.zodIssues ?? null,
    secondResult.fail.catalogIssues ?? [],
    timing,
  );
}
