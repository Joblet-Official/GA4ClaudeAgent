/**
 * Brain 6 (Visualisation / Reporting) — schemas.
 *
 * Same rule as Brain 5: the LLM emits a SPEC (which component per block, section
 * order, headings, neutral narrative) — never data values. The deterministic
 * renderer pulls every number from Brain 5's data_blocks. The LLM decides
 * presentation; values are rendered by code.
 */
import { z } from "zod";

/** Render components the deterministic renderer knows how to draw. */
export const ComponentType = z.enum([
  "kpi_card",
  "table",
  "bar_chart",
  "line_chart",
  "comparison", // baseline-vs-current table + paired bars + delta pills + membership
  "temporal", // two-series daily line chart + heat day table
  "funnel", // step bars + counts table + step-rate table + most-moved callout
]);
export type ComponentType = z.infer<typeof ComponentType>;

export const SectionBlock = z.object({
  block_id: z.string().min(1),
  component: ComponentType,
});
export type SectionBlock = z.infer<typeof SectionBlock>;

/** Report stage a section belongs to (drives the stage-head grouping). */
export const StageName = z.enum(["Overview", "Breakdowns", "Behavior", "Other"]);
export type StageName = z.infer<typeof StageName>;

export const SectionSpec = z.object({
  id: z.string().min(1),
  heading: z.string().min(1),
  stage: StageName.optional(),
  blocks: z.array(SectionBlock).min(1),
  /** Neutral framing text — no values, no conclusions beyond what the data shows. */
  narrative: z.array(z.string()).default([]),
});
export type SectionSpec = z.infer<typeof SectionSpec>;

export const ReportSpec = z.object({
  title: z.string().min(1),
  subtitle: z.string().nullable().default(null),
  sections: z.array(SectionSpec).min(1),
  context_notes: z.array(z.string()).default([]),
});
export type ReportSpec = z.infer<typeof ReportSpec>;
