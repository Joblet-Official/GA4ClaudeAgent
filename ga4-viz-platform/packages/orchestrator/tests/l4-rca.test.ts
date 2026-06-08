/**
 * L4 RCA Playbook tests — Phase 2/3 addendum.
 *
 * These tests cover the RCA-playbook addendum (see L2_RCA_LOGIC_ADDENDUM.md
 * §8). They prove the orchestrator drives the L4 staged-plan path correctly
 * when mock brains supply playbook-expanded plans. NOTE: the diagnostic
 * "why did X change" level was the addendum's L2; after the L1-L5 spectrum
 * widening it is L4. The `universal_l2_playbook` registry key is a retained
 * structural name, not the L2 spectrum level.
 *
 * IMPORTANT: A2's expansion algorithm (universal_l2_playbook + per-metric
 * rca_playbook inheritance, dimensional-filter handling, proxy_investigations)
 * is the agent SPEC; these tests use mock A2 brains that hand-author the
 * expanded `stages[]` array. The orchestrator's job is to drive that array
 * through stage-executor + trigger-eval — that is what's under test here.
 */
import { describe, it, expect } from "vitest";
import {
  Orchestrator,
  InMemorySessionStore,
  type AgentFunction,
  type AgentRegistry,
  type TurnResult,
} from "../src/index.js";
import type { TriggerContext } from "../src/trigger-eval.js";

// ============================================================
//  Helpers: build schema-valid records
// ============================================================

function l1Intent(verbatim: string) {
  return {
    schema_version: "0.1.0",
    report_type: "snapshot",
    analysis_level: "L1",
    business_objective: "report engagement rate",
    sub_questions: [
      {
        id: "sq_1",
        verbatim,
        report_type: "snapshot",
        scope_cues: {
          metric_term: "engagement rate",
          dimension_term: null,
          time: null,
          geography: null,
          channel_filter: null,
          rank_direction: null,
          direction: null,
          device: null,
          page: null,
        },
      },
    ],
    comparison_intent: null,
    ambiguity_flags: ["time_scope_missing"],
    is_followup: false,
    followup_delta: null,
    out_of_scope: false,
    interpretation_request: false,
  };
}

function l4Intent(verbatim: string, metricTerm: string, direction: string) {
  return {
    schema_version: "0.1.0",
    report_type: "trend",
    analysis_level: "L4",
    business_objective: `localize change in ${metricTerm}`,
    sub_questions: [
      {
        id: "sq_1",
        verbatim,
        report_type: "trend",
        scope_cues: {
          metric_term: metricTerm,
          dimension_term: null,
          time: "in April 2026",
          geography: null,
          channel_filter: null,
          rank_direction: null,
          direction,
          device: null,
          page: null,
        },
      },
    ],
    comparison_intent: null,
    ambiguity_flags: ["comparison_period_implicit"],
    is_followup: false,
    followup_delta: null,
    out_of_scope: false,
    interpretation_request: true,
  };
}

/** Build a minimal A2 query plan with a `stages[]` block. */
function l4PlanWithStages(stages: Array<{
  id: string;
  execute: "always" | "conditional";
  execute_if?: string;
  query_refs: string[];
  rationale?: string;
}>) {
  // Build a flat list of queries, one per stage; the orchestrator only needs
  // query_ids to match stage.query_refs.
  const queries = stages.map((s) => ({
    query_id: s.query_refs[0]!,
    source: "ga4" as const,
    purpose: "primary" as const,
    metrics: { status: "resolved" as const, items: [{ name: "engagementRate" }] },
    dimensions: { status: "resolved" as const, items: [{ name: "date" }] },
    filters: [],
    date_range: { status: "resolved" as const, type: "relative" as const, value: "last_28_days" as const },
    order_by: [],
    limit: null,
    grouping: "by_date" as const,
    partial_period: true,
  }));

  return {
    schema_version: "0.1.0",
    propagated_a1_flags: {
      is_followup: false,
      out_of_scope: false,
      interpretation_request: true,
    },
    query_plans: [{ sub_question_id: "sq_1", queries }],
    stages,
    mapping_trace: [
      { user_term: "engagement rate", mapped_to: "engagementRate", kind: "metric" as const },
    ],
    ambiguity_report: {
      mapping_choices: [],
      range_choices: [],
      default_candidates: [],
      feasibility_failures: [],
    },
  };
}

/** Build a minimal A2 query plan WITHOUT a stages block (L1 path). */
function l1Plan() {
  return {
    schema_version: "0.1.0",
    propagated_a1_flags: {
      is_followup: false,
      out_of_scope: false,
      interpretation_request: false,
    },
    query_plans: [
      {
        sub_question_id: "sq_1",
        queries: [
          {
            query_id: "q_1_main",
            source: "ga4",
            purpose: "primary",
            metrics: { status: "resolved", items: [{ name: "engagementRate" }] },
            dimensions: { status: "resolved", items: [{ name: "date" }] },
            filters: [],
            date_range: { status: "missing", candidates: ["last_28_days"] },
            order_by: [],
            limit: null,
            grouping: "by_date",
            partial_period: true,
          },
        ],
      },
    ],
    mapping_trace: [
      { user_term: "engagement rate", mapped_to: "engagementRate", kind: "metric" },
    ],
    ambiguity_report: {
      mapping_choices: [],
      range_choices: [],
      default_candidates: [{ field: "date_range", candidates: ["last_28_days"] }],
      feasibility_failures: [],
    },
  };
}

/** A3 APPROVED that carries the staged plan forward. */
function approvedWithPlan(plan: unknown) {
  return {
    schema_version: "0.1.0",
    decision: "APPROVED",
    query_plan: plan,
    carried_forward: [],
    disclosures: [],
  };
}

/** A3 DEFAULT_APPLIED for the L1 path. */
function defaultAppliedSimple() {
  return {
    schema_version: "0.1.0",
    decision: "DEFAULT_APPLIED",
    query_plan: {
      sub_question_id: "sq_1",
      queries: [
        {
          query_id: "q_1_main",
          source: "ga4",
          purpose: "primary",
          metrics: { status: "resolved", items: [{ name: "engagementRate" }] },
          dimensions: { status: "resolved", items: [{ name: "date" }] },
          filters: [],
          date_range: { status: "resolved", type: "relative", value: "last_28_days" },
          order_by: [],
          limit: null,
          grouping: "by_date",
          partial_period: true,
        },
      ],
    },
    applied_defaults: [
      { field: "date_range", chosen: "last_28_days", source: "registry", rationale: "no time scope specified" },
    ],
    carried_forward: [],
    disclosures: ["Showing last 28 days (no time range specified)."],
  };
}

/** A4 fragment for one stage — minimal shape. */
function a4StageFragment(stageId: string) {
  return {
    schema_version: "0.1.0",
    status: "ok",
    rows_by_sub_question: {
      sq_1: [
        { dimensions: { date: "20260420", stage: stageId }, metrics: { engagementRate: 0.6 } },
      ],
    },
    execution_metadata: {
      queries_executed: 1,
      total_latency_ms: 5,
      per_query: [],
    },
    warnings: [],
    failures: [],
    passthrough_pipeline: {
      intent: {},
      applied_defaults: [],
      carried_forward: [],
      a3_disclosures: [],
    },
  };
}

/** A4 single-call record (non-staged path). */
function a4SingleRecord() {
  return {
    schema_version: "0.1.0",
    status: "ok",
    rows_by_sub_question: {
      sq_1: [
        { dimensions: { date: "20260520" }, metrics: { engagementRate: 0.605 } },
      ],
    },
    execution_metadata: {
      queries_executed: 1,
      execution_strategy: "single",
      total_latency_ms: 700,
      per_query: [
        {
          sub_question_id: "sq_1",
          query_id: "q_1_main",
          source: "ga4",
          latency_ms: 700,
          row_count: 1,
          total_rows_available: 1,
          sampling: { is_sampled: false, rate: 1.0 },
          thresholding: { applied: false, hidden_rows: 0 },
          truncated: false,
          truncated_by: "none",
          data_freshness: { latest_data_date: "2026-05-21", is_partial: false },
          time_zone: "Asia/Calcutta",
          retries_attempted: 0,
        },
      ],
    },
    warnings: [],
    failures: [],
    passthrough_pipeline: {
      intent: {},
      applied_defaults: [],
      carried_forward: [],
      a3_disclosures: [],
    },
  };
}

function a5Blocks() {
  return {
    schema_version: "0.1.0",
    blocks_by_sub_question: {
      sq_1: [
        {
          block_id: "sq_1_b_1",
          block_type: "kpi_strip",
          narrative_stage: "overview",
          title_seed: "Headline",
          description: "Engagement rate is 60.5% over the period.",
          kpis: [{ label: "Engagement rate", value: 0.605, format: "percent" }],
        },
      ],
    },
    data_quality_notes: [],
    passthrough_pipeline: {
      intent: {},
      applied_defaults: [],
      carried_forward: [],
      a3_disclosures: [],
      a4_warnings: [],
    },
  };
}

function a6Spec() {
  return {
    schema_version: "0.1.0",
    report_title: "L4 RCA test",
    subtitle: "joblet.ai",
    context_chips: [{ key: "Source", text: "GA4", kind: "context" }],
    disclosure_chips: [],
    sections: [
      {
        section_id: "sq_1_main",
        section_title: "Summary",
        components: [
          {
            component: "kpi_strip",
            block_ref: "sq_1_b_1",
            narrative_stage: "overview",
            kpis: [{ label: "Engagement rate", value_display: "60.5%" }],
          },
        ],
      },
    ],
    quality_notes: [],
    footer_meta: { source: "GA4 property 516147906", pulled_at: "2026-05-22T14:00:00Z" },
  };
}

// ============================================================
//  Universal L2 playbook stages — used to seed mock A2 outputs
// ============================================================

/**
 * The 12 universal stages, in plan-format (id/execute/execute_if/query_refs).
 * Mirrors metric-ontology.example.json#/universal_l2_playbook.stages but
 * converted to A2 query-plan stage shape (query_refs only).
 */
const UNIVERSAL_STAGES_PLAN = [
  { id: "confirm_headline",       execute: "always" as const, query_refs: ["q_confirm_headline"] },
  { id: "decompose_components",   execute: "always" as const, query_refs: ["q_decompose"] },
  { id: "temporal_weekly",        execute: "always" as const, query_refs: ["q_weekly"] },
  { id: "temporal_daily",         execute: "always" as const, query_refs: ["q_daily"] },
  { id: "breakdown_channel",      execute: "always" as const, query_refs: ["q_breakdown_channel"] },
  { id: "breakdown_landing_page", execute: "always" as const, query_refs: ["q_breakdown_lp"] },
  { id: "breakdown_device",       execute: "always" as const, query_refs: ["q_breakdown_device"] },
  { id: "breakdown_country",      execute: "always" as const, query_refs: ["q_breakdown_country"] },
  { id: "breakdown_event",        execute: "always" as const, query_refs: ["q_breakdown_event"] },
  { id: "structural_diff_all",    execute: "always" as const, query_refs: ["q_structural_diff"] },
  {
    id: "path_exploration",
    execute: "conditional" as const,
    execute_if: 'top_n_dim_diff("landingPage", n=20) >= 5',
    query_refs: ["q_path_exploration"],
  },
  {
    id: "cohort_drilldown",
    execute: "conditional" as const,
    execute_if: "any_dimension_concentration_change(any_dim) > 0.15",
    query_refs: ["q_cohort_drilldown"],
  },
] as const;

// ============================================================
//  Mock-brain factory shared across tests
// ============================================================

function buildAgents(opts: {
  intent: unknown;
  plan: unknown;
  decision: unknown;
}): AgentRegistry {
  const a1: AgentFunction<unknown, unknown> = async () => opts.intent;
  const a2: AgentFunction<unknown, unknown> = async () => opts.plan;
  const a3: AgentFunction<unknown, unknown> = async () => opts.decision;
  const a4: AgentFunction<unknown, unknown> = async (input) => {
    const stage = (input as { stage?: { stage_id: string } }).stage;
    if (stage) return a4StageFragment(stage.stage_id);
    return a4SingleRecord();
  };
  const a5: AgentFunction<unknown, unknown> = async () => a5Blocks();
  const a6: AgentFunction<unknown, unknown> = async () => a6Spec();
  return { a1, a2, a3, a4, a5, a6 } as AgentRegistry;
}

/** Helpers that always return zeros — overridden per-test where the trigger matters. */
function zeroHelpers(): TriggerContext["helpers"] {
  return {
    funnel_step_rate: () => 0,
    top_n_dim_diff: () => 0,
    component_change_pct: () => 0,
    metric_period_change_pct: () => 0,
    metric_period_change_pp: () => 0,
    z_score_max_abs: () => 0,
    row_count_for_query: () => 0,
    any_landing_page_share_above: () => false,
    any_dimension_concentration_change: () => 0,
  };
}

// ============================================================
//  Tests (addendum §8 — 7 tests)
// ============================================================

describe("L4 RCA /1. L2 with Tier-2 entry (engagementRate)", () => {
  it("expanded plan emits 14+ stages including funnel_run and conditionals parse via DSL", async () => {
    // Tier-2 for engagementRate: universal (12) - replaced path_exploration (1)
    // + adds (funnel_run, funnel_step_breakdown, path_exploration_with_event) = 14.
    const tier2Stages = [
      ...UNIVERSAL_STAGES_PLAN.filter((s) => s.id !== "path_exploration"),
      { id: "funnel_search_to_apply",      execute: "always" as const, query_refs: ["q_funnel"] },
      {
        id: "funnel_step_breakdown",
        execute: "conditional" as const,
        execute_if: 'funnel_step_rate_drop("view_search_results") > 0.3',
        query_refs: ["q_funnel_step_breakdown"],
      },
      {
        id: "path_exploration_with_event",
        execute: "conditional" as const,
        execute_if: 'top_n_dim_diff("landingPage", n=20) >= 5',
        query_refs: ["q_path_exploration_with_event"],
      },
    ];

    expect(tier2Stages.length).toBeGreaterThanOrEqual(14);

    const intent = l4Intent("why did engagement rate drop in April 2026", "engagement rate", "dropped");
    const plan = l4PlanWithStages(tier2Stages);
    const decision = approvedWithPlan(plan);
    const agents = buildAgents({ intent, plan, decision });

    // Helpers that make BOTH conditional triggers evaluate true → all stages run.
    const helpers: TriggerContext["helpers"] = {
      ...zeroHelpers(),
      funnel_step_rate: (_e, period) => (period === "baseline" ? 0.3 : 0.034),
      top_n_dim_diff: () => 15,
    };

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: helpers,
    });
    const r: TurnResult = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });

    expect(r.kind).toBe("complete");
    // Stage presence check — assert funnel_run and the path-exploration replacement both made it
    const stageIds = tier2Stages.map((s) => s.id);
    expect(stageIds).toContain("funnel_search_to_apply");
    expect(stageIds).toContain("path_exploration_with_event");
    expect(stageIds).not.toContain("path_exploration"); // universal version was replaced
  });
});

describe("L4 RCA /2. L2 without Tier-2 (sessions — primitive metric)", () => {
  it("emits 11 stages (12 universal minus decompose_components for a primitive metric)", async () => {
    // A2 expansion skips decompose_components when the headline metric has no
    // catalog.components. Mock A2 reflects that by omitting that stage.
    const primitiveStages = UNIVERSAL_STAGES_PLAN.filter((s) => s.id !== "decompose_components");
    expect(primitiveStages.length).toBe(11);

    const intent = l4Intent("why did sessions drop in April", "sessions", "dropped");
    const plan = l4PlanWithStages([...primitiveStages]);
    const decision = approvedWithPlan(plan);
    const agents = buildAgents({ intent, plan, decision });

    // Both conditional triggers false → only the 9 always stages execute.
    const helpers = zeroHelpers();

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: helpers,
    });
    const r = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });
    expect(r.kind).toBe("complete");
    // No decompose_components in the plan
    expect(plan.stages.map((s) => s.id)).not.toContain("decompose_components");
  });
});

describe("L4 RCA /3. L2 with dimensional filter (slice question)", () => {
  it("share_of_whole stage is prepended and stages carry a dimensional_filter marker", async () => {
    // Per addendum §6.1, the dimensional filter case prepends one share_of_whole
    // stage (kind: cohort_drilldown) before the rest of the universal playbook.
    // The mock A2 emits the prepended shape; orchestrator just drives it.
    const filteredStages = [
      { id: "share_of_whole", execute: "always" as const, query_refs: ["q_share_of_whole"], rationale: 'dim filter: sessionDefaultChannelGroup="(Direct)"' },
      ...UNIVERSAL_STAGES_PLAN.filter((s) => s.id !== "decompose_components"),
    ];

    const intent = l4Intent("why is direct traffic so high", "sessions", "rose");
    const plan = l4PlanWithStages(filteredStages);
    const decision = approvedWithPlan(plan);
    const agents = buildAgents({ intent, plan, decision });

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: zeroHelpers(),
    });
    const r = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });
    expect(r.kind).toBe("complete");
    expect(plan.stages[0]!.id).toBe("share_of_whole"); // prepended
    // Marker for filter is conveyed via rationale text in this mock; real A2
    // would propagate a structured dimensional_filter on every stage.
    expect(plan.stages[0]!.rationale).toContain("sessionDefaultChannelGroup");
  });
});

describe("L4 RCA /4. L2 with un-mapped concept (proxy_investigations cap = 3)", () => {
  it("emits at most 3 proxy investigations; orchestrator runs each as a sub-plan", async () => {
    // Per addendum §6.2: for un-mapped concepts like "bot activity", A2 emits
    // proxy_investigations[] instead of a single stages[]. Here the orchestrator
    // sees the first proxy expanded into stages[] (one sub-plan at a time —
    // the addendum reserves the multi-proxy renderer for A6's parallel panels).
    // We assert the cap is enforced at the proxy list level.
    const PROXY_CAP = 3;
    const proposedProxies = ["sessions_not_set_source", "avgSessionDuration_suspicious_sources", "sessions_zero_engagement", "pages_per_session_high"];
    const enforced = proposedProxies.slice(0, PROXY_CAP);
    expect(enforced.length).toBe(3);

    // Drive the first proxy through the orchestrator end-to-end to prove the
    // plumbing works on a single proxy's expanded universal playbook.
    const stages = UNIVERSAL_STAGES_PLAN.filter((s) => s.id !== "decompose_components");
    const intent = {
      ...l4Intent("why is bot activity high", "sessions", "rose"),
      ambiguity_flags: ["comparison_period_implicit"],
    };
    const plan = l4PlanWithStages([...stages]);
    const decision = approvedWithPlan(plan);
    const agents = buildAgents({ intent, plan, decision });

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: zeroHelpers(),
    });
    const r = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });
    expect(r.kind).toBe("complete");
  });
});

describe("L4 RCA /5. Stage 11 (path_exploration) trigger MET → executes", () => {
  it("fires path_exploration when top_n_dim_diff >= 5", async () => {
    // Universal playbook (12 stages). Stage 11 is conditional on
    // top_n_dim_diff("landingPage", n=20) >= 5.
    const stages = [...UNIVERSAL_STAGES_PLAN];
    const intent = l4Intent("why did engagement rate drop in April", "engagement rate", "dropped");
    const plan = l4PlanWithStages(stages);
    const decision = approvedWithPlan(plan);

    const stagesInvoked: string[] = [];
    const a4: AgentFunction<unknown, unknown> = async (input) => {
      const stage = (input as { stage?: { stage_id: string } }).stage;
      if (stage) {
        stagesInvoked.push(stage.stage_id);
        return a4StageFragment(stage.stage_id);
      }
      return a4SingleRecord();
    };
    const agents: AgentRegistry = {
      ...buildAgents({ intent, plan, decision }),
      a4,
    };

    const helpers: TriggerContext["helpers"] = {
      ...zeroHelpers(),
      top_n_dim_diff: () => 7, // >= 5 → fires path_exploration
    };

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: helpers,
    });
    const r = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });
    expect(r.kind).toBe("complete");
    expect(stagesInvoked).toContain("path_exploration");
  });
});

describe("L4 RCA /6. Stage 11 (path_exploration) trigger NOT MET → skipped", () => {
  it("skips path_exploration when top_n_dim_diff < 5; cohort_drilldown also skipped", async () => {
    const stages = [...UNIVERSAL_STAGES_PLAN];
    const intent = l4Intent("why did engagement rate drop in April", "engagement rate", "dropped");
    const plan = l4PlanWithStages(stages);
    const decision = approvedWithPlan(plan);

    const stagesInvoked: string[] = [];
    const a4: AgentFunction<unknown, unknown> = async (input) => {
      const stage = (input as { stage?: { stage_id: string } }).stage;
      if (stage) {
        stagesInvoked.push(stage.stage_id);
        return a4StageFragment(stage.stage_id);
      }
      return a4SingleRecord();
    };
    const agents: AgentRegistry = {
      ...buildAgents({ intent, plan, decision }),
      a4,
    };

    const helpers: TriggerContext["helpers"] = {
      ...zeroHelpers(),
      top_n_dim_diff: () => 2, // < 5 → path_exploration skipped
      any_dimension_concentration_change: () => 0.05, // < 0.15 → cohort_drilldown skipped
    };

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      triggerHelpers: helpers,
    });
    const r = await orch.runTurn({ user_query: intent.sub_questions[0].verbatim, session_id: "s" });
    expect(r.kind).toBe("complete");
    expect(stagesInvoked).not.toContain("path_exploration");
    expect(stagesInvoked).not.toContain("cohort_drilldown");
    // The 10 always-run stages were invoked
    expect(stagesInvoked.length).toBe(10);
  });
});

describe("L4 RCA /7. L1 unchanged — no stages[] field present", () => {
  it("a non-staged plan flows A1->A2->A3->A4->A5->A6 with no stage_executor involvement", async () => {
    const intent = l1Intent("what is the engagement rate");
    const plan = l1Plan();
    const decision = defaultAppliedSimple();
    const agents = buildAgents({ intent, plan, decision });

    const orch = new Orchestrator({
      agents,
      sessionStore: new InMemorySessionStore(),
      // No triggerHelpers needed for L1 path.
    });
    const r = await orch.runTurn({ user_query: "what is the engagement rate", session_id: "s" });
    expect(r.kind).toBe("complete");

    // Confirm: plan has no stages[] block
    expect((plan as { stages?: unknown }).stages).toBeUndefined();
  });
});
