# Brains on Claude Fable (`claude-fable-5`) — migration record (2026-06-11)

> **STATUS UPDATE (2026-06-11, same day): ACTIVE ROUTING REVERTED TO DEEPSEEK
> by user directive.** `src/lib/modelRouting.ts` is restored to the DeepSeek
> canonical map (byte-identical to commit `0e54882`) and `.env.local`'s
> provider vars are back to `deepseek_pro`/`deepseek_flash` (verified against
> the pre-switch backup). Everything below the routing layer is RETAINED as an
> inert opt-in capability: the `fable` provider in `nvidia.ts`, the
> `anthropicChat.ts` adapter, the `npm run test:fable` suite (route checks now
> assert the DeepSeek canonical map), and the `@anthropic-ai/sdk` dependency.
> To use Fable for any brain: set `ANTHROPIC_API_KEY` and
> `LLM_PROVIDER_<BRAIN>=fable` — no code changes. The sections below document
> the adapter as built; read "canonical/active" claims as historical.

User directive: rebuild the brains on the Fable model while preserving the
B1–B6 architecture **exactly** as implemented. This document records what
changed, and — per the directive — only the changes that Fable compatibility
made unavoidable. Everything else is byte-identical.

## What did NOT change (verified)

- **All six brain modules** (`src/brains/*.ts`), their prompts, schemas
  (`src/schemas/*`), and contracts — untouched.
- **All API routes** (`/api/orchestrate`, `/api/brain*`, `/api/routing`,
  `/api/reports/[file]`, `/api/run`) — untouched.
- **Orchestrator** (`runPipeline.ts`, `orchestratorBrain.ts`) — untouched:
  same sequencing, clarification short-circuit, purpose re-attach,
  connection-retry shim, provider patching.
- **B4 dual-path reconciliation, B5 deterministic engine + adequacy gates,
  B6 deterministic gold renderer, GTM tracking-availability registry/analysis**
  — untouched (they live above the provider layer).
- **Escalation layer** (`lib/escalate.ts`) — untouched; `withEscalation` and
  `classifyFailure` operate on the new provider exactly as before.
- Existing deterministic suites still green after the switch:
  brain5 38, brain6 36, orchestrator 12, escalation 17; `tsc --noEmit` clean.

## What changed (3 files + env), and why each change was unavoidable

### 1. `src/lib/anthropicChat.ts` (NEW) — the one new abstraction
The Anthropic API is not OpenAI-compatible and Anthropic ships no
OpenAI-compatible endpoint suitable for production, so the official
`@anthropic-ai/sdk` is required. The adapter exposes the **exact**
`chat.completions.create` subset the brains use (catalogued from every call
site), so brain code needed zero edits:
- streaming → async-iterable of `{choices:[{delta:{content}}]}` chunks
  (B1–B6's delta loops work unchanged; TTFT capture unchanged);
- non-streaming → `{choices:[{message:{content}}]}` (OrchestratorBrain.ping).

Unavoidable parameter mapping inside the adapter (all dictated by the Fable
API surface, none by preference):

| Param the brains send | On DeepSeek | On Fable | Adapter behaviour |
|---|---|---|---|
| `temperature` | accepted | **HTTP 400** (removed on claude-fable-5, with `top_p`/`top_k`) | dropped |
| `response_format: {type:"json_object"}` (B1–B3, ping) | schemaless JSON mode | **does not exist** (only schema-bound structured outputs) | dropped — JSON enforcement remains where the architecture already guarantees it: contract prompts + Zod `safeParse` + bounded retry + escalation. B4–B6 never sent it. |
| `thinking` | n/a (DeepSeek reasons implicitly) | omitted = off; explicit `{type:"disabled"}` = **400** | omitted entirely |
| `max_tokens` | reasoning tokens counted INSIDE it (budgets were raised for this) | pure output budget (no thinking) | passed through — existing budgets (B1 4000 / B2 6000 / B3 8000) now have **more** effective headroom, not less |
| system-role messages | passed inline | separate top-level `system` param | extracted in order, joined |

Plus one new safety behaviour: a stream that ends with `stop_reason:
"max_tokens"` **throws** instead of returning silently-truncated text, and the
error wording contains an `ESCALATE_HINT` ("downstream validation") so it
classifies as model-attributable per the error-wording contract in
`lib/escalate.ts` §11.2.

### 2. `src/lib/nvidia.ts` — one provider entry + construction branch
- `Provider` union gains `"fable"`; `PROVIDERS` gains
  `{baseURL: ANTHROPIC_BASE_URL || api.anthropic.com, defaultModel:
  FABLE_MODEL || "claude-fable-5", apiKeyEnv: "ANTHROPIC_API_KEY"}`.
- `getClient()` constructs `AnthropicChatClient` for `fable` (cast confined to
  this single point); every other provider path is unchanged.
- Fable joins the 150s default-timeout class (B2/B6 prompts are large); the
  25s default for groq/cerebras/nvidia-llama is unchanged.
- Key isolation, client caching (`brain::provider::model::timeout`),
  `maxRetries: 0` — all preserved identically.

### 3. `src/lib/modelRouting.ts` — canonical map now points at Fable
All seven routes → `fable`. The two-tier escalation **structure** is fully
preserved: B3/B4/B5 keep `escalate: true` + fallback provider/model, so
`withEscalation` still grants the one bounded retry on classified failures.
With a single Fable SKU the retry is same-model; setting
`FABLE_FLASH_MODEL=claude-haiku-4-5` restores a true fast-tier→strong-tier
split with zero code changes. DeepSeek constants and provider entries remain
as inert manual fallbacks (same status NVIDIA had after the DeepSeek switch).

### 4. `.env.local` (gitignored) — config switch
`LLM_PROVIDER` + `LLM_PROVIDER_BRAIN1–4` → `fable`; `FABLE_MODEL=claude-fable-5`;
`ANTHROPIC_API_KEY` line added **commented out** so the missing key fails fast
with the explicit getClient error instead of a confusing 401. Revert
instructions are in the block. Pre-switch copy saved as
`.env.local.bak-fable-switch` (also gitignored).

## New test suite

`npm run test:fable` — `scripts/test_fable_adapter.ts`, 23 deterministic checks
(no network): request mapping, param dropping, stream chunk shaping via the
brains' exact delta loop, truncation→escalate wording, ping shape,
Anthropic-SDK error classification, getClient + canonical-route wiring.

## To go live (the only remaining step)

1. Put a real key in `.env.local`: `ANTHROPIC_API_KEY=sk-ant-…`
2. Restart the dev server (one instance only): `npm run dev` → `/orchestrate`.

## Known deltas to watch on first live runs

- **B1–B3 JSON discipline without `response_format`:** prompts already demand
  JSON-only output and Fable's instruction-following is strong; the Zod gate +
  retry/escalation catches any miss. If misses recur, the schema-bound
  structured-outputs API (`output_config.format`) is the proper fix — schema
  per brain, adapter-level, still zero brain-code changes.
- **`/api/deepseek-smoke`** remains DeepSeek-specific by design (host
  diagnostics for the inert fallback provider); it is not part of the Fable
  path.
- **Latency profile:** official-API DeepSeek numbers (~35s simple / 2–3min L4)
  no longer apply; re-baseline expected timings once live.
