/**
 * Brain 1 (Intent) — Zod schema for the structured output.
 *
 * Brain 1 reads { question, memory } and produces:
 *   - report_type: classification of what the user is asking for
 *   - sub_questions: 1..N decomposition of the question
 *   - scope: dateRange + regions + raw filter cues
 *   - is_followup: whether this builds on prior context (memory)
 *   - ambiguity_flags: list of cues the orchestrator may need to resolve
 *
 * Used by:
 *   - src/brains/brain1_intent.ts (parses & validates the LLM JSON)
 *   - src/orchestrator/validate.ts (re-validates at orchestrator boundary)
 *   - downstream brains (typed input)
 */
import { z } from "zod";

export const ReportType = z.enum([
  "regional_breakdown",
  "weekly_summary",
  "drill_down",
  "time_series",
  "comparison",
  "single_metric",
]);
export type ReportType = z.infer<typeof ReportType>;

export const SubQuestion = z.object({
  id: z.string().regex(/^q\d+$/, "sub-question id must look like q1, q2, ..."),
  natural_language: z.string().min(1),
  kind: z.enum(["primary", "secondary"]),
});
export type SubQuestion = z.infer<typeof SubQuestion>;

/**
 * dateRange is either a relative-window string ("last_30_days", "last_7_days",
 * "this_week", "this_month", "last_week", "last_month") OR an absolute
 * { start, end } pair in YYYY-MM-DD.
 *
 * If the user did not specify a window, Brain 1 emits null and the Gaps brain
 * fills the default (last_30_days).
 */
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const DateRange = z.union([
  z.enum([
    "last_7_days",
    "last_14_days",
    "last_28_days",
    "last_30_days",
    "last_90_days",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "this_quarter",
    "last_quarter",
    "year_to_date",
  ]),
  z.object({ start: ISO_DATE, end: ISO_DATE }),
]);
export type DateRange = z.infer<typeof DateRange>;

export const Scope = z.object({
  dateRange: DateRange.nullable(),
  regions: z.array(z.string()).nullable(),
  filters_hint: z.array(z.string()),
});
export type Scope = z.infer<typeof Scope>;

/**
 * Analysis depth (ported from the v5 agent architecture's Agent 1):
 *   L1 single fact · L2 descriptive trend/breakdown · L3 performance
 *   review/evaluation · L4 diagnostic (why did X change) · L5 strategic /
 *   multi-factor diagnostic. Brain 2 keys report depth off this — L3 adds the
 *   funnel, L4/L5 get the full RCA playbook incl. funnel + path exploration.
 * OPTIONAL so pre-existing intent outputs remain valid.
 */
export const AnalysisLevel = z.enum(["L1", "L2", "L3", "L4", "L5"]);
export type AnalysisLevel = z.infer<typeof AnalysisLevel>;

export const IntentOutput = z.object({
  report_type: ReportType,
  analysis_level: AnalysisLevel.optional(),
  sub_questions: z.array(SubQuestion).min(1),
  scope: Scope,
  is_followup: z.boolean(),
  ambiguity_flags: z.array(z.string()),
});
export type IntentOutput = z.infer<typeof IntentOutput>;

/**
 * Memory shape passed into Brain 1. Built by buildMemory() after each turn.
 * Kept minimal here; the buildMemory module owns the canonical shape.
 */
export const IntentMemory = z
  .object({
    last_report_type: ReportType.nullable().optional(),
    last_scope: Scope.nullable().optional(),
    last_questions: z.array(z.string()).optional(),
  })
  .nullable();
export type IntentMemory = z.infer<typeof IntentMemory>;

export const IntentInput = z.object({
  question: z.string().min(1),
  memory: IntentMemory,
});
export type IntentInput = z.infer<typeof IntentInput>;
