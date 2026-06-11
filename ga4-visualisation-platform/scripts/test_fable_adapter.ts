/**
 * Fable adapter tests — fully deterministic (no LLM, no network).
 *
 *   Part 1: request mapping — system-role extraction, max_tokens default,
 *           Fable-unsupported params (temperature / response_format) dropped.
 *   Part 2: streaming — OpenAI-shaped chunks from Anthropic events, non-text
 *           events ignored, max_tokens truncation throws with escalate-class
 *           wording (the error-wording contract of lib/escalate.ts).
 *   Part 3: non-streaming — OpenAI-shaped completion for OrchestratorBrain.ping.
 *   Part 4: classifyFailure on Anthropic-SDK-shaped errors; getClient wiring.
 *
 * The stub replaces the adapter's private `anthropic` instance — production
 * code carries no test seams.
 *
 * Run: npm run test:fable
 */
import { AnthropicChatClient, type ChatChunk, type ChatCompletion } from "@/lib/anthropicChat";
import { classifyFailure } from "@/lib/escalate";
import { getClient, clearClientCache } from "@/lib/nvidia";
import { routeFor } from "@/lib/modelRouting";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type AnyRecord = Record<string, unknown>;

/** Build an adapter whose Anthropic instance is replaced by stubs. */
function stubbedClient(stubs: {
  create?: (req: AnyRecord) => Promise<AnyRecord>;
  stream?: (req: AnyRecord) => unknown;
}): AnthropicChatClient {
  const c = new AnthropicChatClient({ apiKey: "test-key", timeoutMs: 1000 });
  (c as unknown as { anthropic: { messages: AnyRecord } }).anthropic = {
    messages: { create: stubs.create, stream: stubs.stream },
  } as never;
  return c;
}

function fakeStream(events: AnyRecord[], stopReason: string) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    async finalMessage() {
      return { stop_reason: stopReason };
    },
  };
}

const MESSAGES = [
  { role: "system" as const, content: "You are Brain N." },
  { role: "system" as const, content: "Hard boundaries apply." },
  { role: "user" as const, content: "question" },
];

async function part1() {
  console.log("=".repeat(70));
  console.log("Part 1 — request mapping");

  let captured: AnyRecord | null = null;
  const c = stubbedClient({
    create: async (req) => {
      captured = req;
      return { content: [{ type: "text", text: "{}" }] };
    },
  });

  await (c.chat.completions.create({
    model: "claude-fable-5",
    messages: MESSAGES,
    temperature: 0.2,
    response_format: { type: "json_object" },
    max_tokens: 8000,
  }) as Promise<ChatCompletion>);

  const req = captured as AnyRecord | null;
  check("system messages joined into top-level system (order preserved)",
    (req?.system as string) === "You are Brain N.\n\nHard boundaries apply.");
  check("system messages removed from messages[]",
    Array.isArray(req?.messages) && (req?.messages as AnyRecord[]).length === 1 &&
    (req?.messages as AnyRecord[])[0]?.role === "user");
  check("max_tokens passed through", req?.max_tokens === 8000);
  check("temperature DROPPED (400 on claude-fable-5)", !("temperature" in (req ?? {})));
  check("response_format DROPPED (no schemaless JSON mode)", !("response_format" in (req ?? {})));
  check("thinking OMITTED entirely (explicit disabled = 400 on Fable)", !("thinking" in (req ?? {})));

  captured = null;
  await (c.chat.completions.create({
    model: "claude-fable-5",
    messages: [{ role: "user", content: "q" }],
  }) as Promise<ChatCompletion>);
  check("max_tokens defaults when omitted (Anthropic requires it)",
    (captured as AnyRecord | null)?.max_tokens === 4096);
}

async function part2() {
  console.log("=".repeat(70));
  console.log("Part 2 — streaming");

  const c = stubbedClient({
    stream: () =>
      fakeStream(
        [
          { type: "message_start" },
          { type: "content_block_start", content_block: { type: "text" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: '{"a"' } },
          { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "ignore me" } },
          { type: "content_block_delta", delta: { type: "text_delta", text: ":1}" } },
          { type: "message_stop" },
        ],
        "end_turn",
      ),
  });

  let content = "";
  let chunkShapeOk = true;
  const stream = (await c.chat.completions.create({
    model: "claude-fable-5",
    messages: [{ role: "user", content: "q" }],
    max_tokens: 100,
    stream: true,
  })) as AsyncIterable<ChatChunk>;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (typeof delta !== "string") chunkShapeOk = false;
    if (delta) content += delta;
  }
  check("deltas accumulate via the brains' exact loop", content === '{"a":1}');
  check("chunks are OpenAI-shaped (choices[0].delta.content)", chunkShapeOk);

  const cTrunc = stubbedClient({
    stream: () =>
      fakeStream([{ type: "content_block_delta", delta: { type: "text_delta", text: '{"partial' } }], "max_tokens"),
  });
  let truncErr: Error | null = null;
  try {
    const s = (await cTrunc.chat.completions.create({
      model: "claude-fable-5",
      messages: [{ role: "user", content: "q" }],
      max_tokens: 10,
      stream: true,
    })) as AsyncIterable<ChatChunk>;
    for await (const _ of s) void _;
  } catch (e) {
    truncErr = e as Error;
  }
  check("max_tokens truncation throws (not silently partial)", truncErr !== null);
  check("truncation wording classifies as ESCALATE (error-wording contract)",
    truncErr !== null && classifyFailure(truncErr).klass === "escalate",
    truncErr?.message);
}

async function part3() {
  console.log("=".repeat(70));
  console.log("Part 3 — non-streaming (OrchestratorBrain.ping shape)");

  const c = stubbedClient({
    create: async () => ({
      content: [
        { type: "text", text: '{"coordinator":' },
        { type: "thinking", thinking: "ignore" },
        { type: "text", text: '"ready"}' },
      ],
    }),
  });
  const r = (await c.chat.completions.create({
    model: "claude-fable-5",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 256,
  })) as ChatCompletion;
  const content = r.choices?.[0]?.message?.content ?? "";
  check("text blocks joined, non-text blocks ignored", content === '{"coordinator":"ready"}');
  check("completion is OpenAI-shaped (choices[0].message.content)", content.includes("ready"));
}

async function part4() {
  console.log("=".repeat(70));
  console.log("Part 4 — failure classification + getClient wiring");

  // Anthropic SDK errors carry .status; SDK timeout message contains "timed out";
  // SDK connection failure contains "Connection error.".
  check("HTTP 429 (RateLimitError shape) → surface",
    classifyFailure({ status: 429, message: "429 rate_limit_error" } as never).klass === "surface");
  check("HTTP 529 (OverloadedError shape) → surface",
    classifyFailure({ status: 529, message: "529 overloaded_error" } as never).klass === "surface");
  check("HTTP 401 (AuthenticationError shape) → surface",
    classifyFailure({ status: 401, message: "401 authentication_error" } as never).klass === "surface");
  check("SDK timeout message → escalate",
    classifyFailure(new Error("Request timed out.")).klass === "escalate");
  check("SDK connection error message → surface",
    classifyFailure(new Error("Connection error.")).klass === "surface");

  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test-key-for-wiring-check";
  clearClientCache();
  const bc = getClient("brain5", { provider: "fable" });
  check("getClient('brain5', {provider:'fable'}) returns the fable provider", bc.provider === "fable");
  check("fable default model resolves (env FABLE_MODEL first, else claude-fable-5)",
    bc.model === (process.env.FABLE_MODEL || "claude-fable-5"), bc.model);
  check("fable client exposes the brains' call surface",
    typeof (bc.client as unknown as AnthropicChatClient).chat?.completions?.create === "function");

  // Canonical routing is DeepSeek (reverted 2026-06-11); fable is an inert
  // opt-in provider reached via env (LLM_PROVIDER_<BRAIN>=fable) or override.
  const r4 = routeFor("brain4");
  check("canonical route brain4 → deepseek_flash → deepseek_pro (escalation preserved)",
    r4.provider === "deepseek_flash" && r4.escalate === true && r4.fallbackProvider === "deepseek_pro");
  const r1 = routeFor("brain1");
  check("canonical route brain1 → deepseek_pro (no escalation, as before)",
    r1.provider === "deepseek_pro" && r1.escalate === false);
  clearClientCache();
}

(async () => {
  await part1();
  await part2();
  await part3();
  await part4();
  console.log("=".repeat(70));
  console.log(`${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
})();
