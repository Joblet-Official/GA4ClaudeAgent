/**
 * Brain 3 (Gaps) — Zod schema.
 *
 * Brain 3 is a gatekeeper: it inspects Brain 1's ambiguity flags and Brain 2's
 * queries, and decides one of three outcomes:
 *
 *   - "approved"              — nothing material missing; proceed to Tool Layer
 *   - "default_applied"       — minor gap; we filled a safe default and proceed
 *   - "needs_clarification"   — material gap; pause and ask the user
 *
 * approved_queries is always present (a mutated copy of Brain 2's queries when
 * defaults were applied, or the original when approved). When status is
 * "needs_clarification", approved_queries still contains the best-guess queries
 * — the orchestrator may use them as a draft when the user answers.
 */
import { z } from "zod";
import { Query } from "@/schemas/metrics";

export const ClarificationOption = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
});
export type ClarificationOption = z.infer<typeof ClarificationOption>;

export const GapsStatus = z.enum([
  "approved",
  "default_applied",
  "needs_clarification",
]);
export type GapsStatus = z.infer<typeof GapsStatus>;

export const GapsOutput = z
  .object({
    status: GapsStatus,
    question_for_user: z.string().nullable(),
    options: z.array(ClarificationOption).nullable(),
    defaults_applied: z.record(z.string(), z.unknown()).nullable(),
    approved_queries: z.array(Query).min(1),
  })
  .superRefine((data, ctx) => {
    // Cross-field invariants
    if (data.status === "needs_clarification") {
      if (!data.question_for_user || data.question_for_user.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["question_for_user"],
          message: "question_for_user is required when status='needs_clarification'",
        });
      }
    }
    if (data.status === "default_applied") {
      if (!data.defaults_applied || Object.keys(data.defaults_applied).length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["defaults_applied"],
          message: "defaults_applied must be non-empty when status='default_applied'",
        });
      }
    }
  });
export type GapsOutput = z.infer<typeof GapsOutput>;
