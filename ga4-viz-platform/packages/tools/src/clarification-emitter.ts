/**
 * clarification_emitter (Phase 4 tool).
 *
 *   kind:            user_surface
 *   side_effect:     write
 *   permitted for:   A3 only
 *
 * Wraps A3's NEEDS_CLARIFICATION decision into a frontend-bound payload.
 * Does not actually emit anywhere — returns a typed payload the orchestrator
 * forwards to the frontend.
 */

export interface ClarificationOption {
  label: string;
  value: string;
  hint?: string;
}

export interface ClarificationDecisionPoint {
  field: string;
  user_term: string;
  options: ClarificationOption[];
}

export interface ClarificationPayload {
  type: "clarification_required";
  turn_id: string;
  question: string;
  decision_points: ClarificationDecisionPoint[];
  rationale: string;
}

export interface EmitClarificationInput {
  turn_id: string;
  question: string;
  decision_points: ClarificationDecisionPoint[];
  rationale: string;
}

/**
 * Build a frontend-ready clarification payload from A3's clarification record.
 * Per Phase 4: hint text in options MUST come from catalog.short_definition;
 * this function does not enforce that (A3 is the source of options), but the
 * orchestrator/test layer should assert it.
 */
export function emitClarification(
  input: EmitClarificationInput,
): ClarificationPayload {
  if (!input.turn_id) {
    throw new Error("clarification_emitter: turn_id is required");
  }
  if (!input.question) {
    throw new Error("clarification_emitter: question is required");
  }
  if (!input.decision_points || input.decision_points.length === 0) {
    throw new Error("clarification_emitter: at least one decision_point required");
  }

  return {
    type: "clarification_required",
    turn_id: input.turn_id,
    question: input.question,
    decision_points: input.decision_points,
    rationale: input.rationale,
  };
}
