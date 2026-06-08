# Tool boundaries — design

## 1. Principles

1. **Permissions are explicit and enumerable.** Every tool an agent may invoke is listed
   in `tool-boundaries.example.json`. Anything not listed is denied. This is allow-list,
   not deny-list.
2. **The orchestrator enforces.** At runtime, when an agent attempts a tool call, the
   orchestrator checks the agent's permission set. Unauthorised calls fail the turn with
   a `permission_denied` reason. Implementation lives in Phase 5; the contract lives here.
3. **Rules 1 and 2 are absolute.** Even if the policy file accidentally grants a forbidden
   permission, the schema's negative tests would catch it; even past the schema, the
   orchestrator has hard-coded enforcement of these two rules.
4. **Tool scopes are typed.** Each tool declares `kind` (data_api, registry_read,
   file_write, telemetry) and `side_effect` (read_only, write). The orchestrator can
   reason structurally about whether a permission grant is dangerous.

## 2. The tool catalog

For joblet.ai, the surface area is small:

| Tool ID | Kind | Side effect | Credential | Used by |
|---|---|---|---|---|
| `ga4_data_api` | data_api | read_only | yes (service account, `analytics.readonly`) | A4 only |
| `gsc_api` | data_api | read_only | yes (service account, `webmasters.readonly`) | A4 only |
| `catalog_reader` | registry_read | read_only | no | A2 only |
| `defaults_registry_reader` | registry_read | read_only | no | A3 only |
| `metric_ontology_reader` | registry_read | read_only | no | A2 only |
| `domain_profile_reader` | registry_read | read_only | no | A2 only |
| `block_pattern_registry_reader` | registry_read | read_only | no | A5 only |
| `viz_registry_reader` | registry_read | read_only | no | A6 only |
| `html_file_writer` | file_write | write | no | A6 only |
| `clarification_emitter` | user_surface | write | no | A3 only |

Other things that look tool-shaped but aren't agent tools:
- **Session storage** — orchestrator-only, not an agent surface.
- **Telemetry** — emitted by the orchestrator from observed agent transitions, not by agents themselves.
- **Trigger-expression evaluator** — orchestrator runtime, evaluates A2's `execute_if` strings.
- **Schema validator** — orchestrator runtime, validates each handoff.

## 3. Per-agent permissions and rationale

### A1 — Intent Interpretation

**Permitted tools:** *none*

A1 is a pure language → structure transform. It reads the user's text and emits an intent
record. No catalog, no data, no user contact, no file writes.

| Forbidden | Why |
|---|---|
| All data APIs | Rule 1 |
| Catalog reader | A1 stays in user-language; A2 owns catalog grounding. If A1 normalised terms to catalog names, A2 would lose the chance to flag mapping ambiguity. |
| Defaults registry reader | A1 does not apply defaults |
| User surface | A1 does not talk to the user |

### A2 — Query Planning

**Permitted tools:** `catalog_reader`, `metric_ontology_reader`, `domain_profile_reader`

A2 reads design-time artifacts to ground intents in real catalog fields and (when the
intent is interpretation_request=true) to plan staged investigations using the metric
ontology and domain profile.

| Forbidden | Why |
|---|---|
| `ga4_data_api`, `gsc_api` | Rule 1. A2 plans, never queries. |
| `defaults_registry_reader` | A3's job. A2 emits `default_candidates`; A3 decides. |
| `block_pattern_registry_reader`, `viz_registry_reader` | A2 plans queries, not visualisations. |
| `html_file_writer` | A6's job. |
| `clarification_emitter` | A3's job. |

### A3 — Validation / Clarification

**Permitted tools:** `defaults_registry_reader`, `clarification_emitter`

A3 is the gatekeeper. It reads the defaults registry to decide APPROVED vs DEFAULT_APPLIED
vs NEEDS_CLARIFICATION, and emits the clarification structure when needed.

| Forbidden | Why |
|---|---|
| `ga4_data_api`, `gsc_api` | Rule 1 |
| `catalog_reader` | A3 does NOT re-validate catalog mappings — that was A2's job. A3 only resolves the ambiguities A2 already enumerated. |
| `metric_ontology_reader`, `domain_profile_reader` | Not needed; the resolved plan is sufficient. |

### A4 — Data Access

**Permitted tools:** `ga4_data_api`, `gsc_api`

The first agent with data access. Per-tool constraints below.

| Forbidden | Why |
|---|---|
| All registry readers | A4 receives a resolved plan; its job is execution, not validation. |
| `clarification_emitter` | A4 does not contact the user; failures are returned as structured records. |
| `html_file_writer` | A6's job. |
| Any write API | A4 is read-only. |

### A5 — Data Handling

**Permitted tools:** `block_pattern_registry_reader`

A5 transforms raw rows into structured blocks per the block-pattern registry. No data
fetching, no file writes, no user contact.

| Forbidden | Why |
|---|---|
| All data APIs | Rule 1 territory — A5 sits downstream of A4. If A5 could re-query, A4's contract would be undermined and we'd lose telemetry. |
| Catalog / defaults / ontology / domain readers | A5 receives all upstream metadata via `passthrough_pipeline`; re-reading registries would be inconsistent with the upstream resolution. |
| `viz_registry_reader` | A5 emits block_type; A6 maps block_type to component. |
| `html_file_writer` | A6's job. |

### A6 — Visualisation

**Permitted tools:** `viz_registry_reader`, `html_file_writer` (constrained)

A6 reads the viz registry to map block_type → component and to look up the colour policy,
then writes the rendered HTML to a constrained path.

| Forbidden | Why |
|---|---|
| All data APIs | Rule 1. A6 paints what A5 emits; no live data calls. |
| Catalog / defaults / ontology / domain readers | A6 reads only the viz registry. |
| `block_pattern_registry_reader` | A5 already chose blocks; A6 maps blocks to components via `viz_registry`. |
| `clarification_emitter` | A3's job. |

## 4. Constraints per tool

### `ga4_data_api`

- `max_rows_per_query`: 100,000 (GA4 hard limit)
- `max_concurrent_queries_per_turn`: 5
- `max_total_queries_per_turn`: 50 (sanity cap; staged investigations may approach this)
- `read_only_enforced`: true (no `runReport` write operations exist anyway, but contractually true)
- `credential_scope`: `https://www.googleapis.com/auth/analytics.readonly`
- `rate_limit_response`: honor `Retry-After` header; orchestrator retry policy in `state-machine.example.json` defines exponential backoff for 5xx and 429.

### `gsc_api`

- `max_rows_per_query`: 25,000 (GSC max)
- `read_only_enforced`: true
- `credential_scope`: `https://www.googleapis.com/auth/webmasters.readonly`
- `notes`: Site identifier must use exact Domain-property form (`sc-domain:joblet.ai`), not URL-prefix form.

### `html_file_writer`

- `write_path_pattern`: must match `reports/**/*.html`. Path traversal (`..`, absolute paths outside the project root) rejected.
- `max_file_size_mb`: 10
- `overwrite_policy`: allowed for timestamped paths; warn for non-timestamped.
- `format`: `text/html; charset=utf-8` only.

### Registry readers (catalog, defaults, metric_ontology, domain_profile, block_pattern, viz_registry)

- `read_only_enforced`: true (it's static config; no writes possible by design)
- `cache_policy`: in-memory cache per deployment; refresh on deployment cycle.
- `staleness_tolerance`: registry changes require a deployment.

### `clarification_emitter`

- `rate_limit_per_turn`: 1 emit (`NEEDS_CLARIFICATION` is at most one round per pause; multiple rounds in a session each emit once)
- `payload_shape`: must conform to `agents/a3-decision.schema.json#/$defs/Clarification`
- `template_source`: hint text MUST come from `catalog.term_definitions`; A3 does not generate hint text freely.

## 5. Enforcement model

At each agent boundary, the orchestrator (per `state-machine.example.json` action steps)
performs:

1. **Pre-invoke permission check.** Before invoking agent N, the orchestrator binds a
   tool-call context that exposes only the tool functions listed in
   `tool-boundaries.example.json#/agent_permissions/<agent>`. Any attempt to call an
   unexposed tool raises a `permission_denied` error within the agent's runtime.
2. **Post-execution audit.** The orchestrator records every tool call (tool_id, args,
   latency, outcome) in telemetry. If telemetry reveals an unexpected tool use pattern,
   audit alerts fire.
3. **Schema-level guard.** This Phase-4 schema rejects policy files that grant forbidden
   combinations (e.g. A1 → `ga4_data_api`). Negative tests in `../verify.py` confirm.

The runtime mechanism is Phase 5 code, but the contract is binding: any implementation
must enforce these boundaries or it's non-conformant.

## 6. Auditing

A conformance audit checks:

1. Policy file validates against `tool-boundaries.schema.json` ✓ (verify.py)
2. Negative tests prove forbidden grants are rejected ✓ (verify.py)
3. **Structural invariants** (these are constraints the schema enforces by construction):
   - Only A4 has any `kind: "data_api"` tool in its `may_use` set.
   - Only A3 has the `clarification_emitter` tool.
   - Only A6 has the `html_file_writer` tool.
   - No agent has both a registry reader AND a data API.
4. Runtime: telemetry must show no `permission_denied` events in normal operation. If
   they appear, an agent attempted forbidden access — escalate.

## 7. What's NOT a tool boundary concern

- **Prompt engineering.** Whether A1's system prompt is good is a Phase 5 quality
  concern, not a permission concern.
- **LLM provider choice.** Which provider runs which agent is operational.
- **Caching strategy.** Cache hits don't bypass permission checks; cached results are
  still subject to the agent's permission scope.
- **Output content.** What A6 writes inside the HTML is a Phase 1+2 design concern
  (factual, no editorial). Whether A6 is *allowed* to write the HTML at all is Phase 4.

## 8. Cross-references

- Rule 1 originated in the master prompt (Section 5, Rule 1).
- Rule 2 originated in the master prompt (Section 5, Rule 2).
- A3's catalog-sourced hint requirement: Phase-1 finding from the `totalUsers` hint error.
- HTML writer path constraint: Phase 5 deployment topology decision pre-encoded here.
