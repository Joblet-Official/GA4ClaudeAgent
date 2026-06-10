/**
 * Brain 2 (Metrics) — Zod schema for the structured output.
 *
 * Output mirrors the GA4 Data API request shape (so Brain 4 / Tool Layer can
 * forward it verbatim). One query per sub-question from Brain 1.
 *
 * Field-name validation against the catalog happens in
 * `src/orchestrator/validate.ts` — not here. The Zod schema only enforces
 * structure; catalog grounding is a separate pass.
 */
import { z } from "zod";

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const Dimension = z.object({ name: z.string().min(1) });
export const Metric = z.object({ name: z.string().min(1) });
export const DateRangeISO = z.object({
  startDate: ISO_DATE,
  endDate: ISO_DATE,
  name: z.string().optional(),
});

/**
 * GA4 FilterExpression is recursive. We accept the loose shape here and walk
 * it in the validator to pluck out fieldName references for catalog checking.
 * Keeping it loose avoids fighting GA4's nested filter grammar at the schema
 * layer.
 */
export const FilterExpression: z.ZodType<unknown> = z.lazy(() =>
  z.record(z.unknown()),
);

export const OrderBy = z.object({
  metric: z.object({ metricName: z.string() }).optional(),
  dimension: z.object({ dimensionName: z.string() }).optional(),
  desc: z.boolean().optional(),
});

export const RequestBody = z.object({
  dimensions: z.array(Dimension).default([]),
  metrics: z.array(Metric).min(1, "at least one metric required"),
  dateRanges: z.array(DateRangeISO).min(1).max(2),
  dimensionFilter: FilterExpression.optional(),
  metricFilter: FilterExpression.optional(),
  orderBys: z.array(OrderBy).optional(),
  limit: z.union([z.number().int().positive(), z.string()]).optional(),
  offset: z.union([z.number().int().nonnegative(), z.string()]).optional(),
  keepEmptyRows: z.boolean().optional(),
});
export type RequestBody = z.infer<typeof RequestBody>;

export const ExpectedShape = z.enum(["categorical", "timeseries", "single_value"]);
export type ExpectedShape = z.infer<typeof ExpectedShape>;

/**
 * What role a query plays in the report (drives Brain 5 shaping + Brain 6
 * section order). OPTIONAL — older outputs without it remain valid.
 */
export const QueryPurpose = z.enum([
  "confirm", // headline metric, current vs baseline
  "decompose", // new-vs-returning (or similar) cohort split
  "temporal", // daily series, current vs baseline
  "breakdown", // dimensional breakdown (landing page / country / device / source)
  "structural", // composition shift (membership diff)
  "funnel", // ordered event funnel
  "path", // path exploration: event mix on top entry pages (the "Deeper look")
  "headline", // single-period headline (descriptive reports)
  "timeseries", // single-period daily series
  "other",
]);
export type QueryPurpose = z.infer<typeof QueryPurpose>;

export const Query = z.object({
  id: z.string().regex(/^q\d+$/, "query id must look like q1, q2, ..."),
  request_body: RequestBody,
  expected_shape: ExpectedShape,
  purpose: QueryPurpose.optional(),
});
export type Query = z.infer<typeof Query>;

export const MetricsOutput = z.object({
  queries: z.array(Query).min(1),
});
export type MetricsOutput = z.infer<typeof MetricsOutput>;
