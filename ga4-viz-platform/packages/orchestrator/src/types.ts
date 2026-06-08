/**
 * Public types for the orchestrator runtime.
 *
 * The orchestrator does not depend on any specific agent implementation. Any
 * function that satisfies AgentFunction<I, O> can be plugged in: deterministic
 * stubs (Phase 5D), LLM-backed implementations (5D-LLM), or hand-written mocks
 * (this file's tests). The Phase 2 schemas constrain I/O at every handoff.
 */
import type { AgentToolset } from "@gvp/tools";

export type AgentId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

export interface OrchestratorContext {
  turn_id: string;
  session_id: string;
}

export interface AgentContext {
  /** Toolset bound by Phase 4 permissions for this agent. */
  toolset: AgentToolset;
  /** Session-level identifiers for telemetry + halt-resume. */
  meta: OrchestratorContext;
}

export type AgentFunction<TInput, TOutput> = (
  input: TInput,
  ctx: AgentContext,
) => Promise<TOutput>;

/**
 * Records the agent registry the orchestrator drives. Each entry conforms to
 * the I/O shape declared by Phase 2 schemas — but TypeScript can't know that
 * without bringing in the generated types, which lives in @gvp/contracts.
 * We type these as `unknown` here and rely on runtime schema validation at
 * every handoff.
 */
export interface AgentRegistry {
  a1: AgentFunction<A1Input, unknown>;
  a2: AgentFunction<A2Input, unknown>;
  a3: AgentFunction<A3Input, unknown>;
  a4: AgentFunction<A4Input, unknown>;
  a5: AgentFunction<A5Input, unknown>;
  a6: AgentFunction<A6Input, unknown>;
}

export interface A1Input {
  user_query: string;
  prior_turn_context?: PriorTurnContext;
}

export interface PriorTurnContext {
  /** Previous turn's resolved intent + summary. Optional. */
  resolved_intent?: unknown;
  resolved_metrics_by_user_term?: Record<string, string>;
}

export interface A2Input {
  intent: unknown; // validated against a1-intent.schema.json by orchestrator
}

export interface A3Input {
  intent: unknown;
  query_plan: unknown;
  prior_turn_context?: PriorTurnContext;
}

export interface A4Input {
  decision: unknown; // approved or default_applied A3 record
  /** Optional stage spec for staged investigations. */
  stage?: {
    stage_id: string;
    query_ids: string[];
    accumulated_results: Record<string, unknown>;
  };
}

export interface A5Input {
  data_record: unknown;
}

export interface A6Input {
  data_blocks: unknown;
}

/**
 * Result of a single turn through the orchestrator.
 */
export type TurnResult =
  | {
      kind: "complete";
      turn_id: string;
      viz_spec: unknown;
    }
  | {
      kind: "needs_clarification";
      turn_id: string;
      clarification: {
        question: string;
        decision_points: unknown[];
        rationale: string;
      };
    }
  | {
      kind: "failed";
      turn_id: string;
      reason_code: FailureReasonCode;
      detail: string;
    };

export type FailureReasonCode =
  | "schema_validation_failure"
  | "llm_api_unavailable"
  | "ga4_auth_failure"
  | "ga4_unrecoverable"
  | "halt_expired"
  | "permission_denied"
  | "internal_error";

/**
 * Stored state for a halted turn. Persisted to SessionStore between turns.
 */
export interface HaltedTurnState {
  turn_id: string;
  session_id: string;
  halted_at: string;
  expires_at: string;
  a1_intent: unknown;
  a2_plan: unknown;
  /** Defaults A3 had already decided to apply before halting. */
  preapplied_defaults_pending: Array<{ field: string; chosen: unknown; source: string; rationale?: string }>;
  /** The clarification structure the user saw. */
  clarification: {
    question: string;
    decision_points: unknown[];
    rationale: string;
  };
}
