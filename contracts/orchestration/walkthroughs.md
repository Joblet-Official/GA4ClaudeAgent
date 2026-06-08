# Orchestrator walkthroughs

Three end-to-end scenarios traced step-by-step through the state machine. These ground the
abstract design in concrete Phase-1 traces from this project.

---

## Walkthrough 1: single-pass with `DEFAULT_APPLIED`

User query: **`"what is the engagement rate"`**

This is the cleanest happy path — one metric maps deterministically, one ambiguity (time
scope) has a safe registry default, no clarification needed.

```
state: IDLE
└─ trigger: user_input_received
   action: load_prior_turn_context (none); invoke_a1
   → A1_RUNNING

state: A1_RUNNING
└─ A1 emits intent { report_type: snapshot, ambiguity_flags: [time_scope_missing], ... }
   → A1_VALIDATING_OUTPUT

state: A1_VALIDATING_OUTPUT
└─ validate against a1-intent.schema.json → passes
   action: persist_intent; invoke_a2
   → A2_RUNNING

state: A2_RUNNING
└─ A2 reads catalog: "engagement rate" → engagementRate (deterministic, in term_aliases)
   A2 reads metric-ontology: engagementRate.rate_components = [engagedSessions, sessions]
   A2 emits plan with metrics [engagementRate, engagedSessions, sessions], dim [date],
   date_range status=missing → ambiguity_report.default_candidates = [{field: date_range}]
   No stages emitted.
   → A2_VALIDATING_OUTPUT

state: A2_VALIDATING_OUTPUT
└─ validate against a2-query-plan.schema.json → passes
   detect_staged_mode → single-pass
   action: persist_plan; invoke_a3
   → A3_RUNNING

state: A3_RUNNING
└─ A3 reads defaults registry:
     date_range → defaultable=true, default_value=last_28_days
   A3 emits decision: DEFAULT_APPLIED with applied_defaults=[{field: date_range, chosen: last_28_days}]
   query_plan has all status fields resolved.
   disclosures = ["Showing last 28 days (no time range specified)."]
   → A3_VALIDATING_OUTPUT

state: A3_VALIDATING_OUTPUT
└─ validate → passes
   guard: decision in (APPROVED, DEFAULT_APPLIED) AND plan.stages undefined → A4_RUNNING_SINGLE
   action: persist_decision; invoke_a4 with resolved plan
   → A4_RUNNING_SINGLE

state: A4_RUNNING_SINGLE
└─ A4 calls GA4 Data API (28daysAgo to today, date × engagementRate, engagedSessions, sessions)
   29 rows returned; sampling false; thresholding false; latency 721ms
   A4 emits data_record with status=ok, rows_by_sub_question, execution_metadata,
   passthrough_pipeline carrying intent + applied_defaults + a3_disclosures
   → A4_VALIDATING_OUTPUT

state: A4_VALIDATING_OUTPUT
└─ validate → passes
   action: persist_data_record; invoke_a5
   → A5_RUNNING

state: A5_RUNNING
└─ A5 reads block-pattern registry: snapshot → [kpi_strip]
   Computes period rate from rate_components (engagedSessions sum / sessions sum, complete days only)
   Builds kpi_card block with sparkline + kpi_strip block with supporting stats
   data_quality_notes: ["Today partial; excluded from period rate.", ...]
   → A5_VALIDATING_OUTPUT

state: A5_VALIDATING_OUTPUT
└─ validate → passes
   action: persist_blocks; invoke_a6
   → A6_RUNNING

state: A6_RUNNING
└─ A6 reads viz-registry: kpi_card → kpi_card component; kpi_strip → kpi_strip component
   Reads layouts.snapshot for section ordering
   Renders HTML, writes file, builds viz_spec
   → A6_VALIDATING_OUTPUT

state: A6_VALIDATING_OUTPUT
└─ validate → passes
   action: persist_viz_spec; return_to_frontend
   → COMPLETE

state: COMPLETE
└─ Viz spec returned. Total: 6 agent calls, no halts, no retries.
```

**Telemetry emitted:**
- `turn.latency_ms`: ~3s total (A4 dominates with 721ms; LLM calls each ~200-500ms in Phase 5)
- `agent.A1..A6.latency_ms`: per-agent
- `clarification.rounds`: 0
- `staged.stages_executed`: 0 (single-pass)
- All `agent.{N}.schema_validation_passed`: true

---

## Walkthrough 2: halt-and-resume with clarification

User query: **`"top traffic sources"`**

Two material ambiguities (`traffic_metric`, `sources_dimension`) → NEEDS_CLARIFICATION,
halt, user picks, resume.

### Turn 1 (halt)

```
IDLE → A1_RUNNING → A1_VALIDATING_OUTPUT
└─ A1 emits intent with 4 ambiguity_flags:
   [time_scope_missing, metric_resolution_needed,
    dimension_resolution_needed, ranking_limit_missing]
→ A2_RUNNING → A2_VALIDATING_OUTPUT
└─ A2 reads catalog: "traffic" has 4 candidates (sessions/activeUsers/totalUsers/screenPageViews)
   "sources" has 4 candidates (sessionSource/sessionMedium/sessionSourceMedium/defaultChannelGroup)
   A2 emits plan with mapping_choices for both + default_candidates for date_range and ranking_limit
→ A3_RUNNING → A3_VALIDATING_OUTPUT
└─ A3 reads defaults:
   date_range → defaultable=true (last_28_days)
   ranking_limit → defaultable=true (10)
   traffic_metric → defaultable=false (registry: no_default_reason)
   sources_dimension → defaultable=false (registry: no_default_reason)
   Two material ambiguities → NEEDS_CLARIFICATION
   clarification bundles both decision_points into one round
   halted_state captures a1_intent + a2_plan + preapplied_defaults_pending = [date_range, ranking_limit]
   turn_id = "turn_2026-05-22T14:03:22Z"

state: A3_VALIDATING_OUTPUT
└─ guard: decision == NEEDS_CLARIFICATION → HALTED_FOR_USER
   action: persist_halted_state; return_clarification_to_frontend

state: HALTED_FOR_USER
└─ Frontend renders the question. Session storage holds halted_state keyed by turn_id.
   Turn paused.
```

### Turn 1 (resume after user answers)

```
Frontend posts:
{
  turn_id: "turn_2026-05-22T14:03:22Z",
  answers: {
    traffic_metric:   "totalUsers",
    sources_dimension: "sessionSource"
  }
}

state: HALTED_FOR_USER
└─ trigger: user_clarification_received
   action: retrieve_halted_state_by_turn_id; validate_answers_against_options
   - both values found in their respective options[].value sets → validation passes
   → RESUME_MERGE_USER_ANSWERS

state: RESUME_MERGE_USER_ANSWERS
└─ Construct resumed_plan:
   - Start from halted_state.a2_plan
   - Apply preapplied_defaults_pending: date_range=last_28_days, ranking_limit=10
   - Apply user answers: traffic_metric=totalUsers, sources_dimension=sessionSource
   - All status fields now 'resolved'
   action: invoke_a3 with intent + resumed_plan (NOT a1 or a2)
   → A3_RUNNING

state: A3_RUNNING
└─ A3 sees an empty ambiguity_report (everything resolved)
   Emits DEFAULT_APPLIED with:
     applied_defaults from preapplied_defaults_pending
     carried_forward = [traffic_metric+sources_dimension] with source=user_clarification_prior_turn
     disclosures = ["Showing last 28 days...", "Top 10 sources...", ...]
   → A3_VALIDATING_OUTPUT → A4_RUNNING_SINGLE → ... → COMPLETE
```

**Telemetry:**
- `clarification.rounds`: 1
- `agent.A1.invocations`: 1 (NOT re-invoked on resume)
- `agent.A2.invocations`: 1 (NOT re-invoked on resume)
- `agent.A3.invocations`: 2 (initial + resume)
- `halt.duration_ms`: time between halt and resume (could be seconds or hours)

### What's notable
- The `turn_id` carries through the entire round-trip. Same turn, two A3 invocations.
- Session-level `resolved_metrics_by_user_term` is updated: `{"traffic": "totalUsers"}` is now sticky-eligible for future turns in this session.

---

## Walkthrough 3: staged investigation with conditional path-exploration

User query: **`"why did the engagement rate drop in April"`**

`interpretation_request=true` → A2 emits staged plan → A4 evaluates conditional stage 4
(path exploration) and decides to run it because both trigger conditions are met.

```
IDLE → A1_RUNNING → A1_VALIDATING_OUTPUT
└─ A1 emits intent with:
   report_type = trend
   interpretation_request = true
   sub_questions[0].verbatim = "why did the engagement rate drop in April"
   scope_cues.time = "April 2026", scope_cues.direction = "drop"
→ A2_RUNNING → A2_VALIDATING_OUTPUT
└─ A2 reads metric-ontology entry for engagementRate
   A2 reads domain-profile (ga4:516147906 → job_board, funnel_template defined)
   A2 emits staged plan:
     stages: [
       { id: "foundation",                execute: always       },
       { id: "temporal_localisation",     execute: always       },
       { id: "sessions_component_channel",execute: always       },
       { id: "engaged_component_lp",      execute: always       },
       { id: "engaged_component_pt_diff", execute: always       },
       { id: "engaged_component_events",  execute: always       },
       { id: "custom_funnel",             execute: always       },
       { id: "path_exploration",          execute: conditional,
         execute_if: "funnel_step_rate_drop(\"view_search_results\") > 0.5
                      AND top_n_dim_diff(\"landingPage\", n=20) >= 5" }
     ]
→ A3_RUNNING → A3_VALIDATING_OUTPUT
└─ A3 sees no mapping_choices (engagementRate resolves 1-to-1), no material ambiguity
   Emits DEFAULT_APPLIED with applied_defaults for date_range
   Carries interpretation_request disclosure: "Investigation, not interpretation. No causal text."

state: A3_VALIDATING_OUTPUT
└─ guard: plan.stages is defined → A4_RUNNING_STAGE
   action: persist_decision; init_stage_iterator (idx=0); invoke_a4_with_stage(stages[0])

state: A4_RUNNING_STAGE (stage: foundation)
└─ A4 fires PoP totals query → results accumulated
   → A4_EVALUATING_STAGE_TRIGGER

state: A4_EVALUATING_STAGE_TRIGGER (idx=1, stage: temporal_localisation)
└─ stage.execute == "always" → next_stage_triggered
   → A4_RUNNING_STAGE

... [stages 2-7 all execute_always, similar pattern] ...

state: A4_EVALUATING_STAGE_TRIGGER (idx=7, stage: path_exploration)
└─ stage.execute == "conditional"
   Orchestrator evaluates execute_if:
     - funnel_step_rate_drop("view_search_results")
       computes from accumulated stage results: (mar_step_rate - apr_step_rate) / mar_step_rate
       = (0.306 - 0.034) / 0.306 = 0.889
       evaluates 0.889 > 0.5 = true
     - top_n_dim_diff("landingPage", n=20)
       computes from stage 4 results: 15 pages in Mar top 20 not in Apr top 20
       evaluates 15 >= 5 = true
     - AND combinator → true
   Result: trigger fires
   Record StageExecutionRecord {
     stage_id: "path_exploration",
     status: "executed",
     execute_if: "...",
     condition_evaluated: "funnel_step_rate_drop = 0.89 > 0.5 AND top_n_dim_diff = 15 >= 5",
     condition_result: true
   }
   → A4_RUNNING_STAGE (path_exploration)

state: A4_RUNNING_STAGE (path_exploration)
└─ A4 fires landingPage×eventName query → accumulated
   → A4_EVALUATING_STAGE_TRIGGER (no more stages)

state: A4_EVALUATING_STAGE_TRIGGER
└─ all_stages_processed → A4_VALIDATING_OUTPUT
   action: assemble_data_record; validate
   data_record.execution_metadata.stages_executed = 8 StageExecutionRecord entries

state: A4_VALIDATING_OUTPUT → A5_RUNNING
└─ A5 reads block-pattern.example.json (composite or trend pattern for interpretation_request)
   Builds blocks for each investigation step:
     - kpi_strip (foundation step: rate, components, delta)
     - time_series (temporal)
     - breakdown × multiple (per-dimension steps)
     - funnel (custom funnel from domain profile)
     - bar_chart_table_pair × multiple (path exploration per page)
   data_quality_notes include investigation-specific facts

→ A6_RUNNING → A6_VALIDATING_OUTPUT
└─ A6 reads viz-registry layouts.composite → supports_step_narration=true
   Renders multi-section report with step_rationale + step_number per section
   Disclosure chip emphasized at top
→ COMPLETE
```

**Telemetry:**
- `staged.stages_executed`: 8 (all triggered)
- `staged.stages_skipped`: 0 (would be 1+ if conditional gate hadn't fired)
- `agent.A4.queries`: 9+ (multiple sub-queries per stage)
- `agent.A4.latency_ms`: dominant component (multiple GA4 calls)

### What's notable

- A1, A2, A3 are each invoked exactly **once** despite the 8-stage flow. The staged
  iteration happens entirely between A3 and A5, inside A4's execution scope as orchestrated
  by the state machine.
- The trigger DSL evaluation is deterministic code in the orchestrator, NOT an LLM call.
  Every value substituted into `condition_evaluated` comes from accumulated stage results
  the orchestrator already has.
- If the condition had been false (e.g. baseline funnel rate stable, no new landing pages),
  the orchestrator records `status: "skipped"` and proceeds to the next stage or to A5.
  The investigation report's stage-4 section then renders with the visible note "Skipped:
  trigger condition not met."

---

## Cross-cutting observations

1. **Validation at every handoff.** Every agent output is schema-validated before the next agent is invoked. Schema failures retry once then fail the turn.
2. **A1/A2 are never re-invoked within a turn.** The orchestrator's only loop is the A3 ↔ HALTED_FOR_USER cycle. No LLM cost is duplicated on resumes.
3. **The trigger DSL is the contract between A2 and A4.** A2 declares conditions in strings; the orchestrator evaluates them. The DSL is closed (9 operators), bounded (no I/O, no side effects), and verifiable.
4. **Failures are routed deterministically.** No agent decides to "give up gracefully"; the orchestrator enforces the policy.
5. **The orchestrator never paraphrases an agent's output.** Disclosures from A3, warnings from A4, quality notes from A5 — all flow verbatim to A6 via `passthrough_pipeline`.
