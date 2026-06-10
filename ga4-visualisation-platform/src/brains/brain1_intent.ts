/**
 * Brain 1 — Intent.
 *
 * Reads { question, memory } → returns IntentOutput (Zod-validated) plus timing.
 *
 * Streams the model response so we can capture TTFT (time-to-first-token)
 * separately from total time. TTFT is what queueing on shared infra affects;
 * generation rate is roughly constant per provider/model. Splitting them lets
 * us diagnose whether a slow run was "stuck in queue" vs "model generating slowly".
 *
 * Failure model: one retry with the Zod error embedded in the prompt. Second
 * failure throws BrainValidationError — orchestrator catches → regex fallback.
 */
import { getClient } from "@/lib/nvidia";
import {
  IntentInput,
  IntentOutput,
  type IntentInput as IntentInputT,
  type IntentOutput as IntentOutputT,
} from "@/schemas/intent";
import { BRAIN1_SYSTEM_PROMPT } from "@/brains/prompts/brain1_intent";

const BRAIN_KEY = "brain1";

const TEMPERATURE = 0.1;
// DeepSeek v4 (reasoning) spends its thinking tokens INSIDE max_tokens; 800
// starved complex questions into empty responses (finish_reason=length with
// zero content). 4000 leaves room for reasoning + the JSON.
const MAX_TOKENS = 4000;

export interface BrainTiming {
  ttft_ms: number;     // time-to-first-token of the winning attempt
  total_ms: number;    // total elapsed across all attempts (incl. retries)
  attempts: number;    // 1 on first-shot success, 2 if first attempt failed validation
}

export interface Brain1Result {
  output: IntentOutputT;
  timing: BrainTiming;
}

export class BrainValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly zodIssues: unknown,
    public readonly timing: BrainTiming,
  ) {
    super(message);
    this.name = "BrainValidationError";
  }
}

/**
 * Strip stray code fences / leading prose so JSON.parse succeeds. The prompt
 * forbids these but quantised models sometimes add them anyway.
 */
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

function buildUserPrompt(input: IntentInputT): string {
  const memoryBlock =
    input.memory == null
      ? "memory: null"
      : `memory: ${JSON.stringify(input.memory)}`;
  const today = new Date().toISOString().slice(0, 10);
  return `Today's date (UTC): ${today}

${memoryBlock}

question: ${JSON.stringify(input.question)}

Return ONLY the JSON object.`;
}

interface CallResult {
  content: string;
  ttft_ms: number;
  elapsed_ms: number;
}

async function callLLM(
  messages: Array<{ role: "system" | "user"; content: string }>,
): Promise<CallResult> {
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
  if (!content) throw new Error("Brain 1: empty response from LLM");
  return { content, ttft_ms: ttft_ms ?? elapsed_ms, elapsed_ms };
}

type ParseResult =
  | { ok: true; value: IntentOutputT }
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
  const result = IntentOutput.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues };
}

export async function runBrain1Intent(rawInput: unknown): Promise<Brain1Result> {
  const input = IntentInput.parse(rawInput);
  const startedAt = Date.now();

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: BRAIN1_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];

  // attempt 1
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

  // attempt 2 — feed the zod error back
  messages.push({ role: "user", content: first.content });
  messages.push({
    role: "user",
    content: `Your previous response failed schema validation. Issues: ${JSON.stringify(
      firstParsed.issues,
    )}. Return ONLY the corrected JSON object, no prose, no code fences.`,
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

  throw new BrainValidationError(
    "Brain 1 failed schema validation twice",
    second.content,
    secondParsed.issues,
    timing,
  );
}
