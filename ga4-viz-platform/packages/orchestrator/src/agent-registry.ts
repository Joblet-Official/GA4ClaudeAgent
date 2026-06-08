/**
 * Phase 5D — concrete AgentFunction registry.
 *
 * `createAgentRegistry()` returns the six AgentFunctions the Orchestrator drives,
 * so the pipeline runs from a single composition point instead of standalone
 * subagents or ad-hoc test mocks. Per the plan (types.ts), this is the
 * DETERMINISTIC tier:
 *   - A1–A4 are deterministic producers (the canonical single-metric scenario),
 *     emitting schema-valid records at each handoff.
 *   - A5 and A6 are wired to the REAL @gvp/agents logic — A5 stamps each block's
 *     narrative_stage via assignNarrativeStage and emits a neutral description;
 *     A6 attaches A5's descriptions as component captions via descriptionsByBlockId
 *     + attachCaptions (which itself guards each caption with assertDescriptive).
 *
 * Every agent is overridable: pass `overrides` to slot in an LLM-backed
 * implementation for any agent (the "5D-LLM" step) without touching the rest.
 * Whatever each agent returns is re-validated by the orchestrator's per-handoff
 * schema check + gateAgentOutput, so a bad override fails fast and named.
 */
import { assignNarrativeStage, descriptionsByBlockId, attachCaptions } from "@gvp/agents";
import type { AgentFunction, AgentRegistry } from "./types.js";

// ---- deterministic A1–A4 producers (canonical single-metric scenario) -------

function a1Intent(): unknown {
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

function a2Plan(): unknown {
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

function a3Decision(): unknown {
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

function a4DataRecord(): unknown {
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

// ---- helpers ---------------------------------------------------------------

interface DataRow {
  dimensions?: Record<string, unknown>;
  metrics?: Record<string, number>;
}

/** Mean of the first metric present across rows (deterministic; primitive math only). */
function meanFirstMetric(rows: DataRow[]): { name: string; value: number } | null {
  const name = rows.find((r) => r.metrics && Object.keys(r.metrics).length > 0)?.metrics;
  if (!name) return null;
  const metricName = Object.keys(name)[0]!;
  const vals = rows.map((r) => Number(r.metrics?.[metricName])).filter((v) => Number.isFinite(v));
  if (vals.length === 0) return null;
  return { name: metricName, value: vals.reduce((a, b) => a + b, 0) / vals.length };
}

/** Camel/identifier metric name → human label ("engagementRate" → "Engagement rate"). */
function humaniseMetric(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

// ---- A5: real narrative-stage + neutral description ------------------------

const a5DataHandling: AgentFunction<unknown, unknown> = async (input) => {
  const dr = (input as { data_record?: { rows_by_sub_question?: Record<string, DataRow[]> } }).data_record ?? {};
  const rowsBySq = dr.rows_by_sub_question ?? {};
  const blocks_by_sub_question: Record<string, unknown[]> = {};

  for (const [sq, rows] of Object.entries(rowsBySq)) {
    const stat = meanFirstMetric(rows ?? []);
    const metricName = stat?.name ?? "engagementRate";
    const label = humaniseMetric(metricName);
    const value = stat ? stat.value : 0;
    const pct = `${(value * 100).toFixed(1)}%`;

    // REAL @gvp/agents logic: stamp the funnel-narrative stage from block signals.
    const stage = assignNarrativeStage({
      block_type: "kpi_strip",
      stage_kind: "headline_kpi",
      metric: metricName,
      metric_field: metricName,
    });

    blocks_by_sub_question[sq] = [
      {
        block_id: `${sq}_b_1`,
        block_type: "kpi_strip",
        narrative_stage: stage,
        title_seed: `${label} snapshot`,
        // Neutral, factual restatement only — passes assertDescriptive.
        description: `${label} is ${pct} over the period.`,
        kpis: [{ label, value, format: "percent" }],
      },
    ];
  }

  return {
    schema_version: "0.1.0",
    blocks_by_sub_question,
    data_quality_notes: [],
    passthrough_pipeline: {
      intent: {},
      applied_defaults: [],
      carried_forward: [],
      a3_disclosures: [],
      a4_warnings: [],
    },
  };
};

// ---- A6: real caption attach from A5 descriptions --------------------------

interface A5Block {
  block_id?: string;
  description?: string;
  narrative_stage?: string;
  title_seed?: string;
  kpis?: Array<{ label?: string; value?: number; format?: string }>;
}

const a6Visualisation: AgentFunction<unknown, unknown> = async (input) => {
  const db = (input as { data_blocks?: { blocks_by_sub_question?: Record<string, A5Block[]> } }).data_blocks ?? {};
  const bbsq = db.blocks_by_sub_question ?? {};

  // REAL @gvp/agents logic: block_id → description map.
  const descById = descriptionsByBlockId(bbsq as Record<string, Array<{ block_id?: string; description?: string }>>);

  const sections = Object.entries(bbsq).map(([sq, blocks]) => {
    const components = (blocks ?? []).map((b) => {
      const kpi = b.kpis?.[0];
      const display = kpi && typeof kpi.value === "number" ? `${(kpi.value * 100).toFixed(1)}%` : "";
      return {
        component: "kpi_strip",
        block_ref: b.block_id ?? `${sq}_b_1`,
        narrative_stage: b.narrative_stage ?? "overview",
        kpis: [{ label: kpi?.label ?? "Metric", value_display: display }],
      };
    });
    return { section_id: `${sq}_main`, section_title: "Snapshot", components };
  });

  const vizSpec = {
    schema_version: "0.1.0",
    report_title: "Engagement rate",
    subtitle: "joblet.ai · Last 28 days",
    context_chips: [{ key: "Source", text: "GA4", kind: "context" }],
    disclosure_chips: [],
    sections,
    quality_notes: [],
    footer_meta: { source: "GA4 property 516147906", pulled_at: "2026-05-22T14:00:00Z" },
  };

  // REAL @gvp/agents logic: attach A5 descriptions as component captions
  // (attachCaptions runs assertDescriptive on each before attaching).
  attachCaptions(vizSpec as Parameters<typeof attachCaptions>[0], descById);
  return vizSpec;
};

// ---- factory ---------------------------------------------------------------

/**
 * Build the six AgentFunctions the Orchestrator drives. Pass `overrides` to
 * replace any agent (e.g. an LLM-backed A2) — the rest stay deterministic.
 */
export function createAgentRegistry(overrides: Partial<AgentRegistry> = {}): AgentRegistry {
  const base: AgentRegistry = {
    a1: (async () => a1Intent()) as AgentFunction<unknown, unknown>,
    a2: (async () => a2Plan()) as AgentFunction<unknown, unknown>,
    a3: (async () => a3Decision()) as AgentFunction<unknown, unknown>,
    a4: (async () => a4DataRecord()) as AgentFunction<unknown, unknown>,
    a5: a5DataHandling,
    a6: a6Visualisation,
  } as AgentRegistry;
  return { ...base, ...overrides };
}
