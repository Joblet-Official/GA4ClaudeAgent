/**
 * Anthropic (Claude Fable) chat adapter — Layer 1 (provider client factory).
 *
 * Presents the EXACT `chat.completions.create` subset the six brains + the
 * OrchestratorBrain use (catalogued 2026-06-11 from every call site), backed by
 * the official @anthropic-ai/sdk Messages API:
 *
 *   - streaming     (B1–B6): `stream: true` → async-iterable of OpenAI-shaped
 *                   chunks; brains read `chunk.choices[0]?.delta?.content`.
 *   - non-streaming (OrchestratorBrain.ping): promise of an OpenAI-shaped
 *                   completion; caller reads `r.choices?.[0]?.message?.content`.
 *
 * Fable-compat parameter mapping (the ONLY behavioural deltas vs OpenAI-compat
 * hosts — see docs/fable-migration.md):
 *   - `temperature` / `top_p` / `top_k` are DROPPED: removed on claude-fable-5,
 *     sending any of them returns HTTP 400.
 *   - `response_format: {type:"json_object"}` is DROPPED: no schemaless JSON
 *     mode on the Anthropic API. JSON enforcement stays where the architecture
 *     already guarantees it — contract prompts ("output only JSON") + Zod
 *     safeParse + bounded retry/escalation. (B4–B6 never sent it anyway.)
 *   - `thinking` is OMITTED entirely: on Fable, omitted = off and an explicit
 *     `{type:"disabled"}` is a 400. Brains' max_tokens budgets therefore remain
 *     pure output budgets (no reasoning-inside-max_tokens as on DeepSeek).
 *   - system-role messages (any position, order preserved) map to the
 *     top-level `system` parameter; user/assistant pass through.
 *
 * Error wording is part of the escalation contract (lib/escalate.ts): the SDK's
 * timeout error message contains "timed out" (→ escalate) and its connection
 * error contains "connection error" (→ surface); HTTP statuses (401/403/429/
 * 5xx) pass through `err.status` exactly as classifyFailure expects. Do not
 * wrap or reword errors here.
 *
 * No secrets in this file — the API key arrives from getClient() (lib/nvidia.ts),
 * which reads it from env by name. maxRetries: 0 deliberately, same as every
 * other provider: retry policy lives in the higher layers where it can be
 * classified (withEscalation / withConnectionRetry).
 */
import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicChatOptions {
  apiKey: string;
  /** Optional host override; SDK default (https://api.anthropic.com) when absent. */
  baseURL?: string;
  timeoutMs: number;
}

/** The message shape every brain actually sends (string contents only). */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CreateParamsBase {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  /** Accepted and dropped — 400 on claude-fable-5. */
  temperature?: number;
  top_p?: number;
  /** Accepted and dropped — no schemaless JSON mode on the Anthropic API. */
  response_format?: { type: string };
  stream?: boolean;
}

/** OpenAI-shaped streaming chunk — the subset the brains' delta loops read. */
export interface ChatChunk {
  choices: Array<{ delta?: { content?: string } }>;
}

/** OpenAI-shaped completion — the subset OrchestratorBrain.ping reads. */
export interface ChatCompletion {
  choices: Array<{ message?: { content?: string } }>;
}

/** Anthropic requires max_tokens; used only if a caller ever omits it. */
const DEFAULT_MAX_TOKENS = 4096;

function splitMessages(messages: ChatMessage[]): {
  system: string | undefined;
  rest: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const rest: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") systemParts.push(m.content);
    else rest.push({ role: m.role, content: m.content });
  }
  return { system: systemParts.length ? systemParts.join("\n\n") : undefined, rest };
}

export class AnthropicChatClient {
  private readonly anthropic: Anthropic;

  readonly chat: {
    completions: {
      create: (params: CreateParamsBase) => AsyncIterable<ChatChunk> | Promise<ChatCompletion>;
    };
  };

  constructor(opts: AnthropicChatOptions) {
    this.anthropic = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      maxRetries: 0,
      timeout: opts.timeoutMs,
    });

    this.chat = {
      completions: {
        create: (params: CreateParamsBase) =>
          params.stream ? this.createStream(params) : this.createCompletion(params),
      },
    };
  }

  private buildRequest(params: CreateParamsBase) {
    const { system, rest } = splitMessages(params.messages);
    // temperature / top_p / response_format / thinking intentionally absent —
    // see the Fable-compat mapping in the file header.
    return {
      model: params.model,
      max_tokens: params.max_tokens ?? DEFAULT_MAX_TOKENS,
      ...(system !== undefined ? { system } : {}),
      messages: rest,
    };
  }

  private async *createStream(params: CreateParamsBase): AsyncIterable<ChatChunk> {
    const stream = this.anthropic.messages.stream(this.buildRequest(params));
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { choices: [{ delta: { content: event.delta.text } }] };
      }
    }
    // Flag a truncation the brains would otherwise misread as a complete
    // (but unparseable) answer. Wording is part of the escalation contract:
    // "downstream validation" is an ESCALATE_HINT in lib/escalate.ts, so this
    // classifies as model-attributable and gets the one bounded retry.
    const final = await stream.finalMessage();
    if (final.stop_reason === "max_tokens") {
      throw new Error(
        `Anthropic response truncated at max_tokens=${params.max_tokens ?? DEFAULT_MAX_TOKENS} — incomplete output cannot pass downstream validation`,
      );
    }
  }

  private async createCompletion(params: CreateParamsBase): Promise<ChatCompletion> {
    const msg = await this.anthropic.messages.create(this.buildRequest(params));
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    return { choices: [{ message: { content: text } }] };
  }
}
