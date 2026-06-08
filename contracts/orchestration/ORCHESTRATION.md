# Orchestration design

## 1. Principles

1. **The orchestrator is plain deterministic code.** No LLM, no reasoning, no interpretation.
2. **The orchestrator does not modify agent outputs.** It validates them against Phase 2 contracts, persists them, and passes them to the next agent unchanged.
3. **Every decision the orchestrator makes is derivable from agent outputs.** The A3 decision branch, the A4 stage-condition evaluation, and the failure routing all key on explicit fields in the agent records.
4. **Session state is the orchestrator's only durable surface.** Agents are stateless; their inputs are intent + plan + prior records; outputs are written to session storage.
5. **The orchestrator owns failure ownership classification.** Whether a failure aborts, retries, or surfaces to the user is its decision, governed by deterministic rules.

## 2. State machine (overview)

```
        ┌─────────┐
        │  IDLE   │  ◄── session created
        └────┬────┘
             │  user_input_received
             ▼
        ┌─────────┐
        │   A1    │  intent interpretation
        └────┬────┘
             │  intent_emitted
             ▼
        ┌─────────┐
        │   A2    │  query planning  (+ staged plan if interpretation_request=true)
        └────┬────┘
             │  plan_emitted
             ▼
        ┌─────────┐
        │   A3    │  validation / clarification
        └────┬────┘
             │
   ┌─────────┼─────────────────────────────┐
   │         │                             │
   ▼         ▼                             ▼
APPROVED   DEFAULT_APPLIED         NEEDS_CLARIFICATION
   │         │                             │
   └────┬────┘                             │
        ▼                          ┌───────▼──────────┐
   ┌─────────┐                     │ HALTED_FOR_USER  │
   │   A4    │                     │   (session save) │
   └────┬────┘                     └───────┬──────────┘
        │                                  │  user_clarification_received
        │  staged?                         │
   ┌────┴──────────────┐                   ▼
   no                 yes              re-enter A3
   │                   │                with merged answers
   ▼                   ▼
   data         ┌──────────────┐
   │            │ A4 STAGED    │
   │            │  ┌─ stage_i ─┐
   │            │  │  execute  │
   │            │  └──────┬────┘
   │            │         │
   │            │  evaluate next stage's
   │            │  execute_if against
   │            │  accumulated results
   │            │         │
   │            │     skip OR run
   │            └──────────────┘
   │                   │
   ▼                   ▼
        ┌─────────┐
        │   A5    │
        └────┬────┘
             ▼
        ┌─────────┐
        │   A6    │
        └────┬────┘
             ▼
        ┌─────────┐
        │COMPLETE │
        └─────────┘

At any point: unrecoverable error → FAILED
```

Formal states and transitions live in `state-machine.example.json`, validated by
`state-machine.schema.json`.

## 3. Single-pass flow

For most queries, the pipeline is linear:

```
IDLE
  → on user_input_received: invoke A1 with { user_query, prior_turn_context? }
A1
  → validate output against agents/a1-intent.schema.json
  → on validation failure: retry once; if still invalid, transition FAILED with system_error
  → persist intent to session storage
  → invoke A2 with intent
A2
  → validate output against agents/a2-query-plan.schema.json
  → if output contains `stages` field: mark turn as staged (affects A4 routing)
  → persist plan to session storage
  → invoke A3 with intent + plan
A3
  → validate output against agents/a3-decision.schema.json
  → branch on `decision`:
      APPROVED        → invoke A4 with query_plan
      DEFAULT_APPLIED → invoke A4 with resolved query_plan
      NEEDS_CLARIFICATION → see §5 (halt-and-resume)
A4
  → if staged: see §4 (staged flow)
  → otherwise: execute queries, validate output against agents/a4-data-record.schema.json
  → persist data record
  → invoke A5 with data record (which contains passthrough from upstream)
A5
  → validate output against agents/a5-data-blocks.schema.json
  → persist data blocks
  → invoke A6 with data blocks (which contains accumulated passthrough)
A6
  → validate output against agents/a6-viz-spec.schema.json
  → persist viz spec; optionally write HTML file
  → transition COMPLETE
  → return viz spec to frontend
```

**Validation at every handoff is mandatory.** If an agent emits a record that doesn't match
its Phase 2 schema, the orchestrator does not pass it downstream — that's a contract
violation, and the turn fails with a clear `schema_validation_failure` reason. This catches
implementation regressions immediately.

## 4. Staged flow (when A2 emits `stages`)

When A2's record contains a top-level `stages` array, A4's execution becomes staged:

```
For each stage in plan.stages (in declared order):
  if stage.execute == "always":
    execute stage.query_refs
    accumulate results into a stage-keyed result map
  else (stage.execute == "conditional"):
    evaluate stage.execute_if against accumulated results
      (using the DSL operators from pipeline/trigger-expressions.schema.json)
    if evaluation == true:
      execute stage.query_refs
      accumulate results
      record StageExecutionRecord with status="executed", condition_result=true
    else:
      record StageExecutionRecord with status="skipped", condition_result=false, skip_reason
      do NOT execute stage.query_refs

After all stages:
  produce A4's data record with:
    rows_by_sub_question = union of all executed stage results
    execution_metadata.stages_executed = array of StageExecutionRecord (one per declared stage)
```

The trigger DSL is evaluated by the orchestrator (or a helper module), NOT by an LLM.
Every operator is in `pipeline/trigger-expressions.schema.json#/$defs/OperatorDef`. The
orchestrator's expression evaluator is the contract between A2 and A4.

**Stage ordering constraint:** any operator whose `evaluates_against` includes
`all_prior_stages` requires all prior stages to have completed first. A2 must order stages
such that conditional-stage triggers can be evaluated. The orchestrator does not reorder.

## 5. Halt-and-resume

The clarification round-trip is the most consequential orchestrator responsibility. Exact
protocol:

### 5.1 Halt

When A3 emits `decision: "NEEDS_CLARIFICATION"`:

```
1. orchestrator validates the record (must contain clarification + halted_state)
2. orchestrator persists the entire A3 record to session storage,
   keyed by halted_state.turn_id
3. orchestrator returns to the frontend:
     {
       "type": "clarification_required",
       "turn_id": halted_state.turn_id,
       "clarification": {
         question, decision_points, rationale  (from A3)
       }
     }
4. orchestrator transitions to HALTED_FOR_USER state
5. session storage retains halted_state for up to N hours
   (default 24h; configurable in deployment)
```

The frontend renders the clarification UI. The user sees the question, picks options.

### 5.2 Resume

When the frontend submits the user's answers:

```
Payload from frontend:
{
  "turn_id": "<the turn_id returned during halt>",
  "answers": {
    "<field_1>": "<chosen_value>",
    "<field_2>": "<chosen_value>",
    ...
  }
}

Orchestrator:
1. Retrieve halted_state by turn_id. If not found or expired → FAILED with halt_expired.
2. Validate each answer:
   - field must exist in halted_state.clarification.decision_points
   - value must be in the corresponding options[].value set
   - free-text answers may be coerced via exact match on value or label
   - on validation failure: re-emit NEEDS_CLARIFICATION with re-asked question + note
3. Construct a resumed_plan:
   a. Start with halted_state.a2_plan
   b. Apply every preapplied_defaults_pending: fill defaulted fields, set status='resolved'
   c. Apply every user answer: fill chosen value, set status='resolved'
   d. Result is a fully-resolved query plan
4. Re-invoke A3 with the resumed plan (intent unchanged from halted_state.a1_intent)
   - A3 sees an empty ambiguity_report and emits DEFAULT_APPLIED
     (with applied_defaults from preapplied_defaults_pending +
      carried_forward from user_clarification_prior_turn for each user answer)
5. Pipeline continues normally from A4
```

**Critical: do NOT re-invoke A1 or A2 on resume.** The intent is already understood; the
plan is already constructed; only A3's gate needs a second pass to confirm the resumed
plan has no remaining ambiguity. Re-invoking A1/A2 would burn LLM cost and risk drift.

### 5.3 Multi-round clarification

If A3's re-entry on resume still emits NEEDS_CLARIFICATION (because A3 had `deferred`
decision points punted to the next round), the protocol repeats:
- New turn_id NOT created — the same turn_id is reused, decremented in some
  `clarification_round` counter for telemetry.
- halted_state is updated with the new (smaller) set of decision_points.
- User answers again.

There is no hard cap on round count, but the orchestrator emits a warning if a single
turn exceeds 3 clarification rounds (likely indicates an A3 bug or under-specified
defaults registry).

## 6. Retry policy

Per-agent retry behaviour. All retries respect the orchestrator's per-turn budget
(default: 30 seconds total LLM work).

| Agent | Failure class | Action | Max attempts |
|---|---|---|---|
| A1 | schema_validation_failure | Retry with prompt nudge | 1 retry |
| A1 | LLM API 5xx / timeout | Exp backoff (1s, 4s) | 2 retries |
| A1 | LLM API 429 | Honor Retry-After | 1 retry |
| A1 | LLM API 4xx (not 429) | No retry; transition FAILED | 0 |
| A2 | schema_validation_failure | Retry with prompt nudge | 1 retry |
| A2 | catalog read error | No retry (deployment issue); FAILED | 0 |
| A3 | schema_validation_failure | Retry with prompt nudge | 1 retry |
| A4 | schema_validation_failure of plan input | No retry; FAILED with `plan_invalid` | 0 |
| A4 | GA4/GSC 5xx | Exp backoff (1s, 4s, 9s) | 3 retries |
| A4 | GA4/GSC 429 | Honor Retry-After header | 2 retries |
| A4 | GA4/GSC 403/404/400 | No retry; record as fatal Failure | 0 |
| A4 | GA4/GSC 401 | No retry; FAILED with `auth_failure` (deployment escalation) | 0 |
| A5 | schema_validation_failure | Retry with prompt nudge | 1 retry |
| A5 | division by zero / computation | Use null + flag; no retry | 0 |
| A6 | schema_validation_failure | Retry with prompt nudge | 1 retry |
| A6 | HTML write failure | Surface error; no retry | 0 |

"Retry with prompt nudge" applies to LLM-backed agents (Phase 5): the orchestrator
appends a structured-error explanation to the system prompt and re-invokes. For
deterministic agents (stubs in early Phase 5), schema validation failure is a code bug
and should never happen — orchestrator transitions FAILED immediately.

## 7. Failure routing

Three failure categories:

### 7.1 User-blocking failure

The turn cannot complete. The orchestrator returns a structured error to the user:

```
{
  "type": "turn_failed",
  "reason_code": "<one of: schema_validation_failure, llm_api_unavailable,
                  ga4_auth_failure, halt_expired, internal_error>",
  "user_message": "<one factual sentence from a small fixed string table — NEVER LLM-generated>",
  "telemetry_id": "<so support can correlate>"
}
```

User-blocking failures are rare and serious. They are logged at error level.

### 7.2 Degraded success

The turn completes but with partial data. A4 returned `status: partial`; A5 emits blocks
for the sub-questions that succeeded plus a quality note about the ones that didn't; A6
renders normally with the quality notes visible. This is **not** a failure — it's an
expected mode for multi-sub-question queries when some queries hit transient issues.

### 7.3 Recoverable failure

The turn re-tries internally per §6 and succeeds on a subsequent attempt. The user sees
nothing; telemetry records the retry.

## 8. State storage

### 8.1 What's stored per turn

Keyed by `turn_id`:

```
{
  "turn_id":             string,
  "session_id":          string,
  "created_at":          ISO timestamp,
  "user_query":          string,
  "prior_turn_context":  reference to prior turn (or null),

  "stages_completed": ["A1", "A2", "A3", ...],
  "current_state":    "<one of the FSM states>",
  "halt_count":        integer,
  "clarification_rounds": integer,

  "intent":             A1 record (or null if A1 hasn't completed),
  "query_plan":         A2 record,
  "decision":           A3 record (most recent — overwritten on each round),
  "data_record":        A4 record,
  "data_blocks":        A5 record,
  "viz_spec":           A6 record,

  "failures":   [ ...telemetry of any retries ],
  "completed_at":       ISO timestamp (when COMPLETE or FAILED)
}
```

### 8.2 What's stored per session

Keyed by `session_id`:

```
{
  "session_id":   string,
  "created_at":   ISO timestamp,
  "last_active":  ISO timestamp,
  "turn_ids":   [ ordered list ],

  "resolved_metrics_by_user_term": {
    "<user_term>": "<catalog_field>"
  }
  // Drives sticky carryover in A3: when the same user_term appears in a later turn
  // AND the prior resolution is known, A3 may carry it forward (with disclosure).
  // Per the Phase-1 finding, this is keyed on RESOLVED METRIC, not literal user_term.
}
```

### 8.3 Lifecycle

- **Active turn:** in-memory + persisted on every state transition.
- **Halted turn:** persisted to session storage for the halt TTL (default 24h).
- **Completed turn:** persisted for telemetry retention (default 30 days).
- **Session:** persisted while any turn is active or halted; archived after configured idle period.

Backing store choice is Phase 5 (Vercel KV, Postgres, Redis — all viable). Phase 3 only
defines the contract: get_by_turn_id, get_by_session_id, set, update, expire.

## 9. Concurrency

- **Within a turn:** strict sequential except for A4's internal sub-query parallelism (which
  is A4's own concern, not the orchestrator's).
- **Across turns within a session:** one active turn at a time. A new user query while a
  turn is HALTED_FOR_USER does not interrupt the halt — it's queued, or the user explicitly
  abandons the halt (frontend action).
- **Across sessions:** unbounded parallelism; sessions are independent.

## 10. Telemetry

Emitted on every transition; sampled at 100% in early phases, configurable later.

### 10.1 Per-turn metrics

| Metric | Captured at | Purpose |
|---|---|---|
| `turn.latency_ms` | COMPLETE / FAILED | end-to-end timing |
| `agent.{N}.latency_ms` | each agent transition | per-agent cost |
| `agent.{N}.tokens_in / tokens_out` | (Phase 5, LLM-backed) | LLM cost tracking |
| `agent.{N}.retries` | each agent transition | reliability signal |
| `agent.{N}.schema_validation_passed` | each handoff | regression detector |
| `clarification.rounds` | COMPLETE / FAILED | UX quality signal |
| `staged.stages_executed` | A4 → A5 | investigation depth |
| `staged.stages_skipped` | A4 → A5 | conditional logic working |
| `failure.kind` | FAILED | failure-class diagnosis |

### 10.2 Per-session aggregates

Rolled up over time:
- turns per session
- median turn latency
- clarification rate (% of turns with at least one round)
- failure rate (% of turns ending FAILED)
- average per-turn cost (LLM tokens + API calls)

## 11. What the orchestrator is NOT

- **Not** an agent. Doesn't reason.
- **Not** an interpreter. Doesn't read data semantically.
- **Not** a planner. Doesn't decide what to query.
- **Not** a renderer. Doesn't generate user-facing text beyond the small fixed error-message table.
- **Not** a memory store with intelligence. Session state is mechanical persistence.
- **Not** a tool. Has no GA4/GSC credentials; those live in A4's tool layer.
- **Not** allowed to invent agent behaviour to cover gaps. If an agent doesn't emit a required field, that's a contract violation that fails the turn — the orchestrator does not paper over it.

## 12. Open design decisions (deferred to Phase 5)

These are real choices that affect production but don't change the orchestration contract:

- **Backing store** — Vercel KV, Postgres, Redis, in-memory for dev.
- **LLM provider per agent** — A1 (Groq/Cerebras for speed?), A2 (need catalog-grounded careful output — Claude Sonnet?), A3 (deterministic-leaning, fast model is fine), A5/A6 (deterministic stubs may suffice; if LLM, fast model).
- **Caching policy** — at minimum, catalog/registries cached in-memory per deployment; A4 results within a session for follow-ups; potentially aggressive caching of A1/A2 for repeated identical queries.
- **Rate limiting** — per-session, per-deployment, per-LLM-provider budget caps.
- **Observability** — log destination, metric backend, alerting thresholds.

None of these change the wire contract or the state machine. They are operational choices
made at deployment time.
