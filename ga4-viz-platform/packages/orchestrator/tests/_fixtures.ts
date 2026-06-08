/**
 * Clean, schema-valid agent-output fixtures for the per-agent gate suites.
 * These mirror the end-to-end mock outputs used by state-machine.test.ts; each
 * one is schema-valid, descriptive-only, and prompt-leak-free, so a clean
 * fixture passes every guard the orchestrator applies to that agent.
 */

export function a1Intent() {
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

export function a2Plan() {
  return {
    schema_version: "0.1.0",
    propagated_a1_flags: { is_followup: false, out_of_scope: false, interpretation_request: false },
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
    mapping_trace: [{ user_term: "engagement rate", mapped_to: "engagementRate", kind: "metric" }],
    ambiguity_report: {
      mapping_choices: [],
      range_choices: [],
      default_candidates: [{ field: "date_range", candidates: ["last_28_days"] }],
      feasibility_failures: [],
    },
  };
}

export function a3Decision() {
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

export function a4DataRecord() {
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
    passthrough_pipeline: { intent: {}, applied_defaults: [], carried_forward: [], a3_disclosures: [] },
  };
}

export function a5DataBlocks() {
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
          kpis: [{ label: "Engagement rate", value: 0.605, format: "percent" }],
        },
      ],
    },
    data_quality_notes: [],
    passthrough_pipeline: { intent: {}, applied_defaults: [], carried_forward: [], a3_disclosures: [], a4_warnings: [] },
  };
}

export function a6VizSpec() {
  return {
    schema_version: "0.1.0",
    report_title: "Engagement rate",
    subtitle: "joblet.ai · Last 28 days",
    context_chips: [{ key: "Source", text: "GA4", kind: "context" }],
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
            caption: "Engagement rate is 60.5% over the period.",
            kpis: [{ label: "Engagement rate", value_display: "60.5%" }],
          },
        ],
      },
    ],
    quality_notes: [],
    footer_meta: { source: "GA4 property 516147906", pulled_at: "2026-05-22T14:00:00Z" },
  };
}
