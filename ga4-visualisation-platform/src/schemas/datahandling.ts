/**
 * Brain 5 (Data Handling) — schemas.
 *
 * CRITICAL DESIGN RULE: the LLM emits a *plan* (structure only) — it never emits
 * data values. The deterministic engine in brain5_datahandling.ts applies the
 * plan to Brain 4's real rows and computes every number. This makes numeric
 * hallucination structurally impossible: the model decides shape; arithmetic is
 * code. Brain 5 only RESHAPES data Brain 4 already retrieved — it does not plan
 * GA4 queries (that is Brain 2's job).
 */
import { z } from "zod";

/** A column derived from two existing metrics (computed deterministically). */
export const DerivedMetric = z.object({
  name: z.string().min(1),
  op: z.enum(["ratio", "percent", "difference", "sum"]),
  operands: z.tuple([z.string().min(1), z.string().min(1)]),
});
export type DerivedMetric = z.infer<typeof DerivedMetric>;

/** Constrained, deterministic reshaping operations the engine knows how to run. */
export const BaseTransform = z.discriminatedUnion("kind", [
  // Use the query's rows as-is.
  z.object({ kind: z.literal("passthrough") }),
  // Group by one dimension, summing the named metrics.
  z.object({
    kind: z.literal("aggregate_by"),
    dimension: z.string().min(1),
    metrics: z.array(z.string().min(1)).min(1),
  }),
  // Sort by a metric desc, keep top N, roll the remainder into an "(others)" row.
  z.object({
    kind: z.literal("top_n"),
    sort_metric: z.string().min(1),
    n: z.number().int().positive(),
    others_rollup: z.boolean().default(true),
  }),
  // Two-dateRange pivot: per key (dimension value, or the total when dimension
  // is null) → baseline, current, Δabs, Δ%, membership. Engine-computed.
  z.object({
    kind: z.literal("compare_by"),
    dimension: z.string().nullable(),
    metric: z.string().min(1),
  }),
  // Two-dateRange daily series aligned by day-of-month.
  z.object({
    kind: z.literal("temporal_compare"),
    metric: z.string().min(1),
  }),
  // Ordered event funnel over a two-dateRange eventName/eventCount query:
  // step counts per range + step-to-step conversion rates + most-moved step.
  z.object({
    kind: z.literal("funnel"),
    steps: z.array(z.string().min(1)).min(2),
    metric: z.string().min(1),
  }),
  // Path exploration ("Deeper look"): two-dateRange page×event query → per-page
  // event totals, membership (new/disappeared) and whether the search step
  // fires there. Engine-computed.
  z.object({
    kind: z.literal("path_explore"),
    metric: z.string().min(1),
    /** Event whose presence per page is highlighted (default view_search_results). */
    highlight_event: z.string().min(1).default("view_search_results"),
  }),
]);
export type BaseTransform = z.infer<typeof BaseTransform>;

export const BlockType = z.enum([
  "kpi",
  "timeseries",
  "categorical",
  "pivot",
  "breakdown",
  "comparison",
  "temporal",
  "funnel",
  "path",
]);
export type BlockType = z.infer<typeof BlockType>;

/** One planned output block — references an existing Brain 4 query by id. */
export const BlockPlan = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  block_type: BlockType,
  source_query_id: z.string().min(1),
  transform: BaseTransform,
  derived_metrics: z.array(DerivedMetric).default([]),
  notes: z.array(z.string()).default([]),
});
export type BlockPlan = z.infer<typeof BlockPlan>;

export const DataHandlingPlan = z.object({
  blocks: z.array(BlockPlan).min(1),
  summary_notes: z.array(z.string()).default([]),
});
export type DataHandlingPlan = z.infer<typeof DataHandlingPlan>;

// ---------------------------------------------------------------------------
// Final output — data_blocks. Values here are computed by the engine, not the LLM.
// ---------------------------------------------------------------------------

/** One step-to-step funnel transition with per-range conversion rates. */
export interface FunnelTransition {
  label: string;
  baseline_rate: number;
  current_rate: number;
  most_moved: boolean;
}

/** Engine-computed metadata that lets Brain 6 render rich components. */
export interface DataBlockMeta {
  comparison?: {
    metric: string;
    dimension: string | null;
    baseline_label: string;
    current_label: string;
  };
  temporal?: { metric: string; baseline_label: string; current_label: string };
  funnel?: {
    metric: string;
    baseline_label: string;
    current_label: string;
    transitions: FunnelTransition[];
  };
  path?: {
    metric: string;
    baseline_label: string;
    current_label: string;
    highlight_event: string;
  };
}

export interface DataBlock {
  id: string;
  title: string;
  block_type: z.infer<typeof BlockType>;
  /** Which Brain 4 query/queries fed this block. */
  source_query_ids: string[];
  /** The query's report role (from Brain 2's plan) — drives section grouping. */
  purpose?: string;
  columns: string[];
  rows: Array<Record<string, string | number>>;
  /** Names of any columns added by derived_metrics. */
  derived_metric_names: string[];
  /** Deterministic data-quality flags (sampled / data_loss_other_row / retrieval_error). */
  flags: string[];
  /** Neutral notes (LLM-authored structure notes + any data-quality note). */
  notes: string[];
  /** Present on comparison/temporal/funnel blocks; values engine-computed. */
  meta?: DataBlockMeta;
}

/** Tracking-availability finding attached by Brain 5's deterministic analysis. */
export interface TrackingAvailabilityNote {
  tag_name: string;
  events: string[];
  query_ids: string[];
  status: "not_covered" | "unverified";
  message: string;
  provenance: string;
}

export interface DataBlocksOutput {
  blocks: DataBlock[];
  summary_notes: string[];
  /** Present when the approved queries referenced GTM-tagged events with
   * availability gaps for the requested range (engine-computed). */
  availability?: TrackingAvailabilityNote[];
}
