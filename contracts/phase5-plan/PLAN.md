# Phase 5 — Implementation plan

## 1. Locked decisions

### 1.1 Runtime: TypeScript on Next.js / Vercel

Rationale:

- Native Vercel fit. Single deployment target, no Python runtime configuration.
- Single language across backend (agents, orchestrator, tools) and frontend (Next.js app).
- Strong typing against Phase 2 schemas: JSON Schemas codegen to TypeScript types so
  every handoff is compile-time-checked, not just runtime-validated.
- The Python traces in this project (engagement-rate, traffic-by-country, bot-likely,
  investigation v3) were exploratory tools. They establish what's possible; they aren't
  the production codebase.

Stack pin:

- Node.js 20+ (LTS)
- Next.js 14+ (App Router)
- TypeScript 5+ in strict mode
- Package manager: **pnpm** (monorepo support, lockfile determinism)
- Schema validation runtime: **ajv** (native JSON Schema 2020-12 support)
- Schema → TS types codegen: **json-schema-to-typescript**
- Testing: **vitest**
- GA4 client: `@google-analytics/data` (official Node SDK)
- GSC client: `googleapis` (official Node SDK)

### 1.2 Agent strategy: stubs first

- Write deterministic TypeScript stub implementations for A1–A6 that produce schema-valid
  records for a fixed test suite (the three Phase 3 walkthrough scenarios plus 5–10 more).
- Stubs let the orchestrator be fully built and end-to-end tested without any LLM cost,
  any non-determinism, or any external LLM provider dependency.
- LLM-backed agents replace stubs incrementally in Phase 5D-LLM. Stubs remain available
  as a dev-mode fallback and as the deterministic golden against which LLM agents are evaluated.

### 1.3 Anticipated production split

A read from Phase 1 designs: **only A1 and A2 strictly need LLM reasoning.**

| Agent | Production fit |
|---|---|
| A1 — Intent | LLM-backed (natural-language parsing) |
| A2 — Query Planning | LLM-backed (term-to-catalog mapping, decomposition) — though much of this is deterministic given a clean catalog |
| A3 — Validation/Clarification | **Deterministic.** Registry lookup + branching + structured clarification. No LLM. |
| A4 — Data Access | **Deterministic.** Reasoning is bounded execution-strategy choice; no NL involved. |
| A5 — Data Handling | **Deterministic.** Computation only. |
| A6 — Visualisation | **Deterministic.** Template rendering + SVG generation. No LLM. |

This may evolve, but the default is: LLM only where the task genuinely is NL → structure
(A1) or structure → catalog reasoning (A2). Everywhere else, deterministic code is faster,
cheaper, more reliable, and matches the agent specs (which are themselves deterministic).

## 2. Proposed repo structure

Monorepo using pnpm workspaces.

```
ga4-viz-platform/
├── package.json                              workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json                        shared TS config
├── README.md
├── apps/
│   └── web/                                  Next.js app
│       ├── app/                              Next.js App Router
│       ├── components/                       React components mapping viz_spec → DOM
│       └── package.json
├── packages/
│   ├── contracts/                            ← Phase 2/3/4 schemas live here (copy of contracts/)
│   │   ├── _shared.schema.json
│   │   ├── agents/*.schema.json
│   │   ├── registries/*.schema.json
│   │   ├── pipeline/*.schema.json
│   │   ├── orchestration/*.schema.json
│   │   ├── tool-boundaries/*.schema.json
│   │   ├── examples/*.example.json
│   │   ├── src/types.generated.ts            ← codegen output from json-schema-to-typescript
│   │   ├── src/index.ts                      exports types + raw schemas
│   │   └── package.json
│   ├── tools/                                ← Phase 5B
│   │   ├── src/ga4-client.ts
│   │   ├── src/gsc-client.ts
│   │   ├── src/registry-readers.ts
│   │   ├── src/html-writer.ts
│   │   ├── src/clarification-emitter.ts
│   │   ├── src/index.ts                      ← tool registry per Phase 4 permissions
│   │   └── package.json
│   ├── orchestrator/                         ← Phase 5C
│   │   ├── src/state-machine.ts              FSM implementation per state-machine.example.json
│   │   ├── src/halt-resume.ts                clarification round-trip
│   │   ├── src/stage-executor.ts             staged plan + trigger DSL evaluator
│   │   ├   ├── trigger-eval.ts               9 operators from trigger-expressions.example.json
│   │   ├── src/retry-policy.ts               retry rules from FSM example
│   │   ├── src/session-store.ts              interface + in-memory impl
│   │   ├── src/permission-binder.ts          enforces Phase 4 boundaries at agent invocation
│   │   ├── src/validator.ts                  ajv-based schema validation per handoff
│   │   └── package.json
│   ├── agents/                               ← Phase 5D
│   │   ├── src/a1-intent.stub.ts             deterministic stub
│   │   ├── src/a1-intent.llm.ts              LLM-backed (later)
│   │   ├── src/a2-query-plan.stub.ts
│   │   ├── src/a2-query-plan.llm.ts          LLM-backed (later)
│   │   ├── src/a3-decision.ts                deterministic (no LLM)
│   │   ├── src/a4-data-access.ts             deterministic with GA4/GSC tool calls
│   │   ├── src/a5-data-handling.ts           deterministic computation
│   │   ├── src/a6-visualisation.ts           deterministic templating + SVG
│   │   ├── src/index.ts                      agent registry; switches stub/llm per env
│   │   └── package.json
│   └── registry-data/                        ← the actual registry JSON files
│       ├── catalog.json                      from contracts/examples/catalog.example.json
│       ├── defaults.json
│       ├── metric-ontology.json
│       ├── domain-profile.json
│       ├── block-pattern.json
│       ├── viz-registry.json
│       └── package.json
└── tests/
    ├── walkthrough-1-engagement-rate.test.ts          single-pass DEFAULT_APPLIED
    ├── walkthrough-2-top-traffic-sources.test.ts      halt-and-resume
    ├── walkthrough-3-engagement-investigation.test.ts staged investigation
    └── fixtures/
        ├── user-queries.json
        └── expected-records.json
```

## 3. Sub-phase roadmap

Each sub-phase is independently shippable. The system works end-to-end at every checkpoint.

### Phase 5B — Tool layer

**Goal**: real implementations of the 10 tools from the Phase 4 catalog.

Deliverables:
- `packages/contracts/` with all schemas + codegen'd TypeScript types
- `packages/tools/`:
  - `ga4-client.ts` — wraps `@google-analytics/data`. Implements retry per FSM policy (5xx, 429). Reads service-account JSON from env.
  - `gsc-client.ts` — wraps `googleapis` Search Console API.
  - `registry-readers.ts` — 6 readers (catalog, defaults, ontology, domain, block-pattern, viz). All cache in-memory at module load.
  - `html-writer.ts` — writes to `reports/**/*.html` only; rejects path traversal.
  - `clarification-emitter.ts` — returns a typed clarification payload (orchestrator forwards to frontend).
  - `index.ts` — tool registry: `{ tool_id → function }` map; orchestrator imports from here.

Acceptance criteria:
- All registry readers load `packages/registry-data/*.json` and validate at load time against their Phase 2 schemas.
- GA4 client smoke test: pull top 10 sessionSource for last 28 days → returns canonical rows.
- GSC client smoke test: pull top 10 queries for last 28 days → returns canonical rows.
- HTML writer rejects paths outside `reports/`.

Estimated scope: 2–3 sessions of focused work.

### Phase 5C — Orchestrator core

**Goal**: TypeScript implementation of the Phase 3 state machine.

Deliverables:
- `packages/orchestrator/src/state-machine.ts` — explicit FSM loop. Reads
  `state-machine.example.json` at boot, validates against the FSM schema, drives transitions.
- `packages/orchestrator/src/validator.ts` — ajv-based validator with all Phase 2 schemas
  pre-compiled at module load.
- `packages/orchestrator/src/halt-resume.ts` — serializes halted_state to session storage;
  resumes by retrieving + merging user answers.
- `packages/orchestrator/src/stage-executor.ts` — executes staged plans, calls
  `trigger-eval.ts` for conditional gates.
- `packages/orchestrator/src/trigger-eval.ts` — implements the 9 DSL operators from
  `trigger-expressions.example.json`. Pure functions over accumulated stage results.
- `packages/orchestrator/src/retry-policy.ts` — reads retry rules from FSM example,
  applies them per agent invocation.
- `packages/orchestrator/src/session-store.ts` — `SessionStore` interface + in-memory impl
  for dev. (Vercel KV impl deferred to 5F.)
- `packages/orchestrator/src/permission-binder.ts` — at each agent invocation, exposes only
  the tools listed in `tool-boundaries.example.json` for that agent.

Acceptance criteria:
- Orchestrator can be instantiated with stub agents.
- The 3 walkthrough scenarios from Phase 3 run end-to-end against stub agents.
- Schema validation passes at every handoff in every walkthrough.
- Permission check rejects forbidden tool calls (e.g. if A1 tries to call ga4 it fails with `permission_denied`).

Estimated scope: 3–4 sessions.

### Phase 5D-stubs — Deterministic agent stubs

**Goal**: A1–A6 as deterministic TypeScript functions that produce schema-valid records
for the test fixture queries.

Approach:
- Each stub is a function `(input) → output`. Pattern-match on the input (user query text
  or upstream record contents) to produce one of a small set of known-good outputs.
- Stubs are NOT smart. They handle the 8–10 test queries and explicitly return a
  `not_implemented` error for anything outside.
- The point is plumbing validation, not behavior.

Test fixture (saved alongside stubs):
- `what is the engagement rate` → A1 stub returns the canonical intent record.
- `top traffic sources` → A1 stub returns the corresponding intent record.
- `how is our organic traffic` → A1 stub returns intent with implicit comparison flag.
- `where is the traffic dropping` → A1 stub returns breakdown intent.
- `why did the engagement rate drop in April` → A1 stub returns intent with `interpretation_request=true`.
- `what is the engagement` → A1 stub returns intent with metric_resolution_needed.

Same approach for A2, A3, A4, A5, A6: pattern-match against the intent / plan / decision /
data record from the prior stage, return the known-good corresponding output.

A4 is special: even as a "stub", it does real GA4 calls because the data is real. A4's
stub is actually thin glue + the real GA4 client. A5 and A6 stubs are deterministic
computation against real A4 output.

A3 may already be production-quality in this phase — it's deterministic by spec, so the
stub IS the implementation.

Acceptance criteria:
- All 3 walkthrough tests pass end-to-end.
- The 5–10 fixture queries each produce a schema-valid viz_spec.
- Stubs are isolated per agent file; no cross-contamination.

Estimated scope: 2–3 sessions.

### Phase 5E — Minimal frontend

**Goal**: a Next.js app that lets a user type a query and see the rendered viz_spec.

Deliverables:
- `apps/web/app/page.tsx` — query input + result display.
- `apps/web/app/api/turn/route.ts` — POST endpoint that invokes the orchestrator.
- `apps/web/components/viz-spec-renderer.tsx` — switches on Section's component types
  (kpi_strip, bar_chart_table_pair, line_chart, …) and renders the corresponding React component.
- `apps/web/components/clarification-modal.tsx` — renders NEEDS_CLARIFICATION decision points,
  collects user picks, POSTs back to `/api/turn?turn_id=…`.

Acceptance criteria:
- User types `"top traffic sources"`, gets a clarification UI, picks options, sees rendered report.
- User types `"what is the engagement rate"`, sees the KPI card + sparkline + line chart immediately.

Estimated scope: 3–4 sessions.

### Phase 5D-LLM — Replace A1 and A2 stubs with LLM-backed

**Goal**: real LLM-backed A1 and A2 that handle arbitrary user queries.

Decisions (locked at start of this sub-phase):
- LLM provider for A1 (fast, cheap, NL→JSON): candidates are Groq Llama 3.3 70B, Cerebras Llama 3.3, OpenAI gpt-4o-mini, Anthropic Claude 3.5 Haiku. Pick on latency + cost during this sub-phase.
- LLM provider for A2 (catalog-grounded careful output): candidates are Claude 3.5 Sonnet, gpt-4o, Gemini 2.5 Pro. Pick on quality.

Approach:
- Each LLM-backed agent: system prompt + few-shot examples + JSON-mode response.
- Validate output against schema; retry once with structured error feedback if invalid.
- Stubs remain as fallback for E2E tests.

Acceptance criteria:
- Same walkthrough tests pass with LLM agents (modulo non-determinism — assert against schema validity, not exact JSON match).
- New eval suite: 20+ user queries, manual or LLM-judged quality scoring.

Estimated scope: 3–5 sessions (LLM iteration is slow).

### Phase 5F — Vercel deployment

**Goal**: the system runs on Vercel with persistent state and observability.

Deliverables:
- Vercel project setup (repo connected, env vars configured).
- Session storage: switch from in-memory to Vercel KV.
- Service account JSON loaded from `GOOGLE_APPLICATION_CREDENTIALS_JSON` env var.
- LLM provider keys in env vars.
- Logging: Vercel logs + optional structured log shipping.
- Basic metrics: per-turn latency, schema validation passes, retry counts.

Acceptance criteria:
- Deployment URL responds to user queries.
- Halt-and-resume works across cold serverless invocations (state stored in KV).
- LLM cost visible in dashboard.
- p50 turn latency under 5 seconds.

Estimated scope: 1–2 sessions.

## 4. Cross-cutting decisions

### 4.1 Schema → TypeScript types

Workflow:
1. JSON Schemas are the source of truth (already exist, validated by `verify.py`).
2. Build step runs `json-schema-to-typescript` to produce `packages/contracts/src/types.generated.ts`.
3. Code imports types from `@gvp/contracts`.
4. Runtime validation uses ajv with the same schemas.

This gives compile-time type safety + runtime validation against the same source.

### 4.2 Validation strategy

- **Build time**: TypeScript compiler catches type-level mismatches.
- **Runtime**: ajv validates every agent's output against its schema at every handoff.
  Schema validation failure → orchestrator retries per FSM policy.
- **Test time**: vitest unit tests + integration tests against the fixture queries.

### 4.3 LLM provider abstraction

A thin interface in `packages/agents/src/llm/`:

```typescript
interface LLMProvider {
  generateJSON<T>(systemPrompt: string, userMessage: string, schema: JSONSchema): Promise<T>;
}
```

Implementations: `AnthropicProvider`, `OpenAIProvider`, `GroqProvider`, etc. Picked per-agent
at startup via env var.

### 4.4 Testing strategy

- **Unit tests**: each agent stub function tested with golden input/output pairs.
- **Integration tests**: orchestrator + tools + stub agents run the 3 walkthrough scenarios.
- **E2E tests** (Phase 5E onward): Playwright against the Next.js app.
- **Eval suite** (Phase 5D-LLM onward): structured prompt/expected-record pairs, scored by
  schema validity + manual review.

### 4.5 Observability

- Per-turn structured log: `{ turn_id, user_query, agent_latencies, final_status, errors }`.
- Per-agent traces: input record, output record, latency, retries, schema validation result.
- Aggregate metrics: turn rate, clarification rate, failure rate, p50/p95 latencies, LLM cost.

Implementation: starts as `console.log` in dev; Phase 5F adds structured logging.

## 5. Risks and mitigations

| Risk | Mitigation |
|---|---|
| TypeScript codegen from JSON Schema produces ugly types | Use json-schema-to-typescript's options (e.g. `bannerComment`, `style`); pin output for review |
| GA4 Node SDK is less mature than Python SDK | Wrap in narrow interface; if SDK is buggy, swap with raw HTTP calls |
| Stubs hide cases real LLMs will hit | Eval suite in Phase 5D-LLM enumerates failure modes; stubs are scaffolding, not coverage |
| Halt-and-resume across serverless invocations | Vercel KV in Phase 5F; in-memory in dev (single process). |
| LLM cost balloons during dev | Keep stubs as default mode; LLM mode opt-in via env var |
| Schema drift between codegen and runtime | Single CI step regenerates types; PR fails if generated types are stale |
| Permission enforcement bypassed by agent code | Permission binder exposes only allowed tools as functions; unauthorised tools are not in the agent's scope, so calling them is a compile error |

## 6. What's NOT in this plan (deferred)

- **LLM provider selection**: locked in Phase 5D-LLM, not now.
- **Caching policy** beyond in-memory registry caches: deferred to Phase 5F.
- **Authentication and authorisation**: deferred. Public demo at first; auth added later.
- **Multi-tenancy**: single property (joblet.ai) for v1. Multi-property is a separate effort.
- **GTM integration**: out of scope.
- **Real-time data**: GA4 standard reports are not real-time; live data feed is out of scope.
- **Custom event tracking** beyond what GA4 reports: out of scope.

## 7. Open questions to be resolved in Phase 5B

These are not blocking the plan but need decisions before code starts:

1. **State store interface shape.** Should it be Promise-based throughout, or sync for in-memory? (Likely Promise everywhere for Vercel KV compatibility.)
2. **HTML writer output location.** `apps/web/public/reports/` (served statically) or out-of-band path written to KV? (Likely public/ for v1.)
3. **Test harness for orchestrator.** Vitest with mocked agents OR a thin test driver that exercises the FSM directly? (Likely both: unit + integration.)
4. **Logging library.** `pino`, `winston`, or just `console.log` to start? (Pino — fast, structured, Vercel-friendly.)

## 8. Sequencing summary

```
Phase 5B (tool layer)          — 2-3 sessions    \
Phase 5C (orchestrator core)   — 3-4 sessions    |  Working stub pipeline by end of 5D-stubs
Phase 5D-stubs                 — 2-3 sessions    /
Phase 5E (frontend)            — 3-4 sessions    ← User-visible product
Phase 5D-LLM                   — 3-5 sessions    ← Production-grade NL handling
Phase 5F (Vercel deploy)       — 1-2 sessions    ← Public deployment
                              ─────────────────
                                ~14-21 sessions total
```

Each session = a focused work block, similar in scope to one of the larger phases we've already done.

## 9. Next concrete step

Phase 5B — set up the repo and implement the tool layer. This is where actual code starts.
The first commit will be:
- `package.json` + `pnpm-workspace.yaml` + `tsconfig.base.json`
- `packages/contracts/` with schemas copied + first codegen of TypeScript types
- `packages/tools/` skeleton with the 10 tool function signatures
- One implemented tool (suggest `catalog_reader` first — pure file read, simplest)
- One test confirming the tool returns schema-valid output

When you're ready to begin Phase 5B, say so and I'll start.
