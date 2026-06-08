/**
 * Halt-and-resume protocol.
 *
 * Per ORCHESTRATION.md §5:
 *   - On A3 NEEDS_CLARIFICATION: serialise halted_state to the SessionStore,
 *     return the clarification structure to the caller.
 *   - On resume: retrieve halted_state, merge user answers + preapplied
 *     defaults into the halted plan, re-enter at A3 (NOT A1 or A2).
 */
import type { SessionStore } from "./session-store.js";
import type { HaltedTurnState } from "./types.js";
import { HaltExpiredError } from "./errors.js";

const DEFAULT_HALT_TTL_HOURS = 24;

export interface UserAnswers {
  [field: string]: string;
}

/**
 * Persist a halted turn. Returns the persisted state (with computed expires_at).
 */
export async function halt(
  store: SessionStore,
  args: {
    turnId: string;
    sessionId: string;
    a1Intent: unknown;
    a2Plan: unknown;
    preapplied: HaltedTurnState["preapplied_defaults_pending"];
    clarification: HaltedTurnState["clarification"];
    ttlHours?: number;
  },
): Promise<HaltedTurnState> {
  const now = new Date();
  const expires = new Date(now.getTime() + (args.ttlHours ?? DEFAULT_HALT_TTL_HOURS) * 60 * 60 * 1000);
  const state: HaltedTurnState = {
    turn_id: args.turnId,
    session_id: args.sessionId,
    halted_at: now.toISOString(),
    expires_at: expires.toISOString(),
    a1_intent: args.a1Intent,
    a2_plan: args.a2Plan,
    preapplied_defaults_pending: args.preapplied,
    clarification: args.clarification,
  };
  await store.putHaltedTurn(state);
  return state;
}

/**
 * Resume a halted turn. Returns the merged plan + intent ready for A3 re-entry.
 *
 * Validation:
 *   - turn must exist and not be expired (else HaltExpiredError)
 *   - every answer's field must exist in halted_state.clarification.decision_points
 *   - every answer's value must exist in that point's options[].value list
 */
export async function resume(
  store: SessionStore,
  turnId: string,
  answers: UserAnswers,
): Promise<{
  state: HaltedTurnState;
  resolvedAnswers: Array<{ field: string; chosen: string; source: "user_clarification_prior_turn" }>;
  appliedDefaults: HaltedTurnState["preapplied_defaults_pending"];
}> {
  const state = await store.getHaltedTurn(turnId);
  if (!state) throw new HaltExpiredError(turnId);

  // Validate answers against decision_points (which we serialised as unknown[]).
  // We treat each decision_point as having { field, options: [{ value }] }.
  type DP = { field: string; options: Array<{ value: string }> };
  const dps = state.clarification.decision_points as DP[];

  const resolvedAnswers: Array<{ field: string; chosen: string; source: "user_clarification_prior_turn" }> = [];
  for (const [field, value] of Object.entries(answers)) {
    const dp = dps.find((d) => d.field === field);
    if (!dp) throw new Error(`resume: answer for unknown field '${field}'`);
    const opt = dp.options.find((o) => o.value === value);
    if (!opt) {
      const known = dp.options.map((o) => o.value).join(", ");
      throw new Error(`resume: invalid value '${value}' for field '${field}' (allowed: ${known})`);
    }
    resolvedAnswers.push({ field, chosen: value, source: "user_clarification_prior_turn" });
  }

  // Also ensure no required field is missing
  for (const dp of dps) {
    if (!(dp.field in answers)) {
      throw new Error(`resume: missing answer for decision point '${dp.field}'`);
    }
  }

  // Delete the halted state — resume consumes it
  await store.deleteHaltedTurn(turnId);

  return {
    state,
    resolvedAnswers,
    appliedDefaults: state.preapplied_defaults_pending,
  };
}
