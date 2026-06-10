/**
 * Brain 3 — Gaps.
 *
 * Reads { intent (Brain 1), queries (Brain 2) } → returns a gating decision
 * with the (possibly mutated) queries to run.
 *
 * Failure model: identical to Brain 2. One retry with Zod errors fed back;
 * second failure throws Brain3ValidationError.
 */
import { getClient } from "@/lib/nvidia";
import type { IntentOutput } from "@/schemas/intent";
import type { Query } from "@/schemas/metrics";
import { GapsOutput, type GapsOutput as GapsOutputT } from "@/schemas/gaps";
import { BRAIN3_SYSTEM_PROMPT } from "@/brains/prompts/brain3_gaps";

const BRAIN_KEY = "brain3";
const TEMPERATURE = 0.1;
// Reasoning models think inside max_tokens — and Brain 3 must re-emit the full
// approved_queries array (large for diagnostic playbooks). Generous budget.
const MAX_TOKENS = 8000;

export interface BrainTiming {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}

export interface Brain3Result {
  output: GapsOutputT;
  timing: BrainTiming;
}

export class Brain3ValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly zodIssues: unknown,
    public readonly timing: BrainTiming,
  ) {
    super(message);
    this.name = "Brain3ValidationError";
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

export interface Brain3Input {
  intent: IntentOutput;
  queries: Query[];
}

function buildUserPrompt(input: Brain3Input): string {
  return `Brain 1 Intent output:
${JSON.stringify(input.intent, null, 2)}

Brain 2 queries:
${JSON.stringify(input.queries, null, 2)}

Produce the Gaps JSON.`;
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
  if (!content) throw new Error("Brain 3: empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? elapsed_ms, elapsed_ms };
}

type ParseResult =
  | { ok: true; value: GapsOutputT }
  | { ok: false; issues: unknown };

function tryParse(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonBlock(raw));
  } catch (e) {
    return {
      ok: false,
      issues: [{ message: `not valid JSON: ${(e as Error).message}` }],
    };
  }
  const result = GapsOutput.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues };
}

export async function runBrain3Gaps(input: Brain3Input): Promise<Brain3Result> {
  const startedAt = Date.now();
  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: BRAIN3_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  const first = await callLLM(messages);
  const firstParsed = tryParse(first.content);
  if (firstParsed.ok) {
    return {
      output: firstParsed.value,
      timing: {
        ttft_ms: first.ttft_ms,
        total_ms: Date.now() - startedAt,
        attempts: 1,
      },
    };
  }

  messages.push({ role: "user", content: first.content });
  messages.push({
    role: "user",
    content: `Your previous response failed schema validation. Issues: ${JSON.stringify(
      firstParsed.issues,
    )}. Return ONLY the corrected JSON, no prose, no code fences.`,
  });

  const second = await callLLM(messages);
  const secondParsed = tryParse(second.content);
  const timing: BrainTiming = {
    ttft_ms: second.ttft_ms,
    total_ms: Date.now() - startedAt,
    attempts: 2,
  };

  if (secondParsed.ok) {
    return { output: secondParsed.value, timing };
  }

  throw new Brain3ValidationError(
    "Brain 3 failed validation twice",
    second.content,
    secondParsed.issues,
    timing,
  );
}
