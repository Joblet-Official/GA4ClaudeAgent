/**
 * State machine end-to-end tests with mock agents.
 *
 * The mock agents are HAND-WRITTEN minimal stubs that satisfy the Phase 2
 * schemas for fixed test inputs. They prove the orchestrator can drive an
 * end-to-end turn AND that schema validation passes at every handoff.
 *
 * Scenarios covered:
 *   1. DEFAULT_APPLIED single-pass ("what is the engagement rate" style)
 *   2. NEEDS_CLARIFICATION halt → resume ("top traffic sources" style)
 *   3. Schema validation rejection (mock A1 emits a malformed intent → turn fails)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  Orchestrator,
  InMemorySessionStore,
  type AgentFunction,
  type AgentRegistry,
  type TurnResult,
} from "../src/index.js";

// ============================================================
// Helpers — build minimal schema-valid records
// ============================================================

function intentForEngagementRate() {
  return {
    schema_version: "0.1.0",
    report_type: "snapshot",
    analysis_level: "L1",
    business_objective: "report engagement rate",
    sub_questions: [
      {
        id: "sq_1",
        verbatim: "what is the engagement rate",
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

function planForEngagementRate() {
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
            metrics: {
              status: "resolved",
              items: [{ name: "engagementRate" }],
            },
            dimensions: {
              status: "resolved",
              items: [{ name: "date" }],
            },
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

function decisionDefaultApplied() {
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
          metrics: {
            status: "resolved",
            items: [{ name: "engagementRate" }],
          },
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

function dataRecord() {
  return {
    schema_version: "0.1.0",
    status: "ok",
    rows_by_sub_question: {
      sq_1: [
        { dimensions: { date: "20260520" }, metrics: { engagementRate: 0.48 } },
        { dimensions: { date: "20260521" }, metrics: { engagementRate: 0.73 } },
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
          row_count: 2,
          total_rows_available: 2,
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

function dataBlocks() {
  return {
    schema_version: "0.1.0",
    blocks_by_sub_question: {
      sq_1: [
        {
          block_id: "sq_1_b_1",
          block_type: "kpi_strip",
          narrative_stage: "overview",
          title_seed: "Engagement rate snapshot",
          description: "Engagement rate is 60.5% over the period.",
          kpis: [
            { label: "Engagement rate", value: 0.605, format: "percent" },
          ],
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

function vizSpec() {
  return {
    schema_version: "0.1.0",
    report_title: "Engagement rate",
    subtitle: "joblet.ai · Last 28 days",
    context_chips: [
      { key: "Source", text: "GA4", kind: "context" },
    ],
    disclosure_chips: [],
    sections: [
      {
        section_id: "sq_1_main",
        section_title: "Snapshot",
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
    footer_meta: {
      source: "GA4 property 516147906",
      pulled_at: "2026-05-22T14:00:00Z",
    },
  };
}

// ============================================================
// Tests
// ============================================================

describe("Orchestrator — single-pass DEFAULT_APPLIED scenario", () => {
  let store: InMemorySessionStore;
  let agents: AgentRegistry;

  beforeEach(() => {
    store = new InMemorySessionStore();
    const a1: AgentFunction<unknown, unknown> = async () => intentForEngagementRate();
    const a2: AgentFunction<unknown, unknown> = async () => planForEngagementRate();
    const a3: AgentFunction<unknown, unknown> = async () => decisionDefaultApplied();
    const a4: AgentFunction<unknown, unknown> = async () => dataRecord();
    const a5: AgentFunction<unknown, unknown> = async () => dataBlocks();
    const a6: AgentFunction<unknown, unknown> = async () => vizSpec();
    agents = { a1, a2, a3, a4, a5, a6 } as AgentRegistry;
  });

  it("runs end-to-end and returns kind=complete", async () => {
    const orch = new Orchestrator({ agents, sessionStore: store });
    const result: TurnResult = await orch.runTurn({
      user_query: "what is the engagement rate",
      session_id: "sess_test_1",
    });
    expect(result.kind).toBe("complete");
    if (result.kind === "complete") {
      expect(result.viz_spec).toBeDefined();
      expect((result.viz_spec as { report_title: string }).report_title).toBe("Engagement rate");
    }
  });

  it("each agent receives a Phase-4-bound toolset (A1 empty, A4 has ga4Query)", async () => {
    const toolsetSeen: Record<string, number> = {};
    const checkToolset = (id: string): AgentFunction<unknown, unknown> => async (_input, ctx) => {
      toolsetSeen[id] = Object.keys(ctx.toolset).length;
      switch (id) {
        case "A1": return intentForEngagementRate();
        case "A2": return planForEngagementRate();
        case "A3": return decisionDefaultApplied();
        case "A4": return dataRecord();
        case "A5": return dataBlocks();
        case "A6": return vizSpec();
        default: return {};
      }
    };
    const myAgents: AgentRegistry = {
      a1: checkToolset("A1"),
      a2: checkToolset("A2"),
      a3: checkToolset("A3"),
      a4: checkToolset("A4"),
      a5: checkToolset("A5"),
      a6: checkToolset("A6"),
    };
    const orch = new Orchestrator({ agents: myAgents, sessionStore: store });
    await orch.runTurn({ user_query: "x", session_id: "s" });
    expect(toolsetSeen["A1"]).toBe(0);            // empty toolset
    expect(toolsetSeen["A4"]!).toBeGreaterThan(0); // has ga4Query
  });

  it("validation rejects a malformed A1 output and returns kind=failed", async () => {
    const myAgents: AgentRegistry = {
      ...agents,
      a1: async () => ({ schema_version: "0.1.0", report_type: "ranking" }) as unknown, // missing required fields
    };
    const orch = new Orchestrator({ agents: myAgents, sessionStore: store });
    const r = await orch.runTurn({ user_query: "x", session_id: "s" });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.reason_code).toBe("schema_validation_failure");
      expect(r.detail).toContain("A1");
    }
  });
});

describe("Orchestrator — NEEDS_CLARIFICATION halt + resume", () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it("halts on first turn and resumes successfully on second", async () => {
    // Build intent + plan + initial NEEDS_CLARIFICATION decision
    const intent = {
      schema_version: "0.1.0",
      report_type: "ranking",
      analysis_level: "L1",
      business_objective: "identify top sources",
      sub_questions: [{
        id: "sq_1", verbatim: "top sources", report_type: "ranking",
        scope_cues: { metric_term: "traffic", dimension_term: "sources", rank_direction: "top", time: null, geography: null, channel_filter: null, direction: null, device: null, page: null },
      }],
      comparison_intent: null,
      ambiguity_flags: ["metric_resolution_needed", "dimension_resolution_needed", "time_scope_missing", "ranking_limit_missing"],
      is_followup: false,
      followup_delta: null,
      out_of_scope: false,
      interpretation_request: false,
    };

    const plan = planForEngagementRate(); // shape doesn't matter for these tests

    const clarifyDecision = {
      schema_version: "0.1.0",
      decision: "NEEDS_CLARIFICATION",
      clarification: {
        question: "What should 'traffic' mean?",
        decision_points: [{
          field: "traffic_metric", user_term: "traffic",
          options: [
            { label: "Sessions", value: "sessions" },
            { label: "Users", value: "totalUsers" },
          ],
        }],
        rationale: "I'll use last 28 days by default. Metric needs your pick.",
      },
      deferred: [],
      halted_state: {
        turn_id: "ignored_overridden_by_orch",
        a1_intent: intent,
        a2_plan: plan,
        preapplied_defaults_pending: [
          { field: "date_range", chosen: "last_28_days", source: "registry", rationale: "no time scope specified" },
        ],
      },
    };

    let a3InvocationCount = 0;
    let lastA3Input: unknown;
    const agents: AgentRegistry = {
      a1: async () => intent,
      a2: async () => plan,
      a3: async (input) => {
        a3InvocationCount++;
        lastA3Input = input;
        if (a3InvocationCount === 1) return clarifyDecision; // first call halts
        return decisionDefaultApplied();                      // resume call goes through
      },
      a4: async () => dataRecord(),
      a5: async () => dataBlocks(),
      a6: async () => vizSpec(),
    };

    const orch = new Orchestrator({ agents, sessionStore: store });

    // Turn 1: halt
    const r1 = await orch.runTurn({ user_query: "top sources", session_id: "sess_X" });
    expect(r1.kind).toBe("needs_clarification");
    if (r1.kind !== "needs_clarification") throw new Error("expected halt");
    expect(r1.clarification.question).toContain("traffic");
    expect(a3InvocationCount).toBe(1);

    // Halted state should be persisted
    const halted = await store.getHaltedTurn(r1.turn_id);
    expect(halted).not.toBeNull();

    // Turn 2: resume
    const r2 = await orch.resumeTurn({
      turn_id: r1.turn_id,
      session_id: "sess_X",
      answers: { traffic_metric: "sessions" },
    });
    expect(r2.kind).toBe("complete");
    expect(a3InvocationCount).toBe(2); // re-entered at A3, NOT A1/A2

    // Halted state is consumed
    expect(await store.getHaltedTurn(r1.turn_id)).toBeNull();
  });

  it("resume with invalid user answer (value not in options) fails the turn", async () => {
    const agents: AgentRegistry = {
      a1: async () => intentForEngagementRate(),
      a2: async () => planForEngagementRate(),
      a3: async () => ({
        schema_version: "0.1.0",
        decision: "NEEDS_CLARIFICATION",
        clarification: {
          question: "?",
          decision_points: [{
            field: "metric", user_term: "x",
            options: [{ label: "A", value: "alpha" }, { label: "B", value: "beta" }],
          }],
          rationale: "r",
        },
        deferred: [],
        halted_state: {
          turn_id: "x",
          a1_intent: {},
          a2_plan: {},
          preapplied_defaults_pending: [],
        },
      }),
      a4: async () => dataRecord(),
      a5: async () => dataBlocks(),
      a6: async () => vizSpec(),
    };
    const orch = new Orchestrator({ agents, sessionStore: store });
    const r1 = await orch.runTurn({ user_query: "x", session_id: "s" });
    if (r1.kind !== "needs_clarification") throw new Error("expected halt");

    const r2 = await orch.resumeTurn({
      turn_id: r1.turn_id,
      session_id: "s",
      answers: { metric: "not_in_options" },
    });
    expect(r2.kind).toBe("failed");
    if (r2.kind === "failed") {
      expect(r2.detail).toContain("invalid value");
    }
  });
});
