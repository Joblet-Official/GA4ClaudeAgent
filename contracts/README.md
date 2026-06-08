# Phase 2 — Inter-agent contracts

This directory defines the JSON shape of every handoff in the GA4 visualisation pipeline.
Each agent produces a strict, schema-validated artifact; the next agent consumes that
exact shape. The orchestrator (Phase 3) uses these schemas to validate handoffs and to
serialise state between turns.

## Architecture refresher

Six agents, single-pass pipeline. A2 expands scope when A1 sets `interpretation_request=true`
(plans a staged investigation); A4 evaluates stage trigger conditions at execution time.
No 7th agent.

```
user_input
  ↓
A1 — Intent Interpretation      → a1-intent.schema.json
  ↓
A2 — Query Planning             → a2-query-plan.schema.json
  ↓
A3 — Validation / Clarification → a3-decision.schema.json
  ↓ (only if APPROVED or DEFAULT_APPLIED)
A4 — Data Access                → a4-data-record.schema.json
  ↓
A5 — Data Handling              → a5-data-blocks.schema.json
  ↓
A6 — Visualisation              → a6-viz-spec.schema.json
  ↓
frontend render
```

## File layout

```
contracts/
├── README.md                          (this file)
├── _shared.schema.json                 shared enums and types
├── agents/
│   ├── a1-intent.schema.json
│   ├── a2-query-plan.schema.json
│   ├── a3-decision.schema.json
│   ├── a4-data-record.schema.json     (Chunk 2)
│   ├── a5-data-blocks.schema.json     (Chunk 2)
│   └── a6-viz-spec.schema.json        (Chunk 2)
├── registries/                         (Chunk 3)
│   ├── catalog.schema.json
│   ├── defaults.schema.json
│   ├── metric-ontology.schema.json
│   ├── domain-profile.schema.json
│   ├── block-pattern.schema.json
│   └── viz-registry.schema.json
├── pipeline/                           (Chunk 3)
│   ├── passthrough.schema.json
│   └── trigger-expressions.schema.json
└── examples/
    ├── intent.example.json
    ├── query-plan.example.json
    ├── decision-approved.example.json
    ├── decision-default-applied.example.json
    └── decision-needs-clarification.example.json
```

## Conventions

- **JSON Schema 2020-12** (`https://json-schema.org/draft/2020-12/schema`).
- Every top-level schema declares `x-schema-version: "0.1.0"`. Bumped on breaking changes.
- `additionalProperties: false` everywhere. Strict; no unspecified fields permitted.
- Required fields explicit. Optional fields documented as optional in `description`.
- IDs are strings with documented patterns (`sq_N`, `q_N`, etc.) so they're stable across handoffs.
- Cross-file references use `$ref: "../<file>.schema.json#/$defs/<Type>"`.

## Spec findings folded into this version

Every spec finding accumulated across the Phase 1 traces is incorporated. Tracked here so
future readers can see what each finding was and where it landed:

| Finding | Source trace | Where it lives now |
|---|---|---|
| Closed enum of `ambiguity_flag` types | A1 trace ("top traffic sources") | `_shared.schema.json#/$defs/AmbiguityFlag` |
| `dimension_resolution_needed`, `ranking_limit_missing` flags | A1 trace | added to enum |
| `default_candidates` shape covers non-time fields | A2 trace | generic `DefaultCandidate` type |
| Optional `preferred` hint per mapping_choice | A2 trace | optional field in `MappingChoice` |
| Formal `conditional_on_default` field | "how is our organic traffic" trace | `Query.conditional_on_default` |
| Staged plan structure (`stages` + `execute_if`) | engagement-rate investigation | `a2-query-plan.schema.json#/properties/stages` |
| `halted_state` schema pinned | A3 design | `a3-decision.schema.json#/$defs/HaltedState` |
| `decision_points` may include hint text — but hint MUST come from catalog | A3 clarification UX | enforced by referencing `catalog.term_definitions` |
| Sticky-carryover keyed on resolved metric, not literal user_term | engagement-vs-engagement-rate finding | `a3-decision.schema.json#/$defs/CarriedForward` notes |
| Pipeline passthrough includes A1 intent + A2 plan (not just A3 metadata) | A4 trace | Chunk 2 in `passthrough.schema.json` |
| `total_rows_available` execution metadata | A4 trace | Chunk 2 |
| `truncated_by` vocabulary | A4 trace | Chunk 2 |
| Approved-annotations list per block_type | A5 trace | Chunk 3 in `block-pattern.schema.json` |
| Path-exploration sampling fix (sample by event firing, not by structural diff) | view_search_results-0 finding | Chunk 3 in `metric-ontology.schema.json#/$defs/PathExplorationStrategy` |
| Specific-event-of-interest must show actual count, not in-top-K badge | view_search_results-0 finding | Chunk 2 in `a6-viz-spec.schema.json` |
| Colour-purpose registry: peach reserved for partial-period/data-freshness only | A6 trace | Chunk 3 in `viz-registry.schema.json` |

## Reading order

1. `_shared.schema.json` — vocabulary
2. `agents/a1-intent.schema.json` through `a6-viz-spec.schema.json` — pipeline order
3. `registries/*.schema.json` — design-time artifacts agents read
4. `pipeline/*.schema.json` — cross-cutting

## Validation

Any JSON Schema 2020-12 validator. From the project root:

```bash
# Python (jsonschema)
python -m jsonschema -i examples/intent.example.json agents/a1-intent.schema.json

# Or Node (ajv-cli)
npx ajv-cli validate -s agents/a1-intent.schema.json -d examples/intent.example.json
```

## What this directory is NOT

- Not implementation code.
- Not LLM prompts.
- Not the orchestrator runtime.
- Not the content of the registries (only their schema).

These are the wire contracts. Implementations in any language can validate against them.
