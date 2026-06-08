/**
 * @gvp/orchestrator — Phase 5C runtime.
 *
 * Public surface:
 *   - Orchestrator (the main FSM driver)
 *   - SessionStore interface + InMemorySessionStore
 *   - Types for agents, registries, results
 *   - evaluateTrigger (the DSL evaluator) for testing
 *   - Errors
 */
export { Orchestrator } from "./state-machine.js";
export type { OrchestratorConfig, RunTurnArgs, ResumeTurnArgs } from "./state-machine.js";

export { createAgentRegistry } from "./agent-registry.js";

export {
  InMemorySessionStore,
  type SessionStore,
} from "./session-store.js";

export type {
  AgentId,
  AgentRegistry,
  AgentFunction,
  AgentContext,
  TurnResult,
  HaltedTurnState,
  PriorTurnContext,
  FailureReasonCode,
  A1Input,
  A2Input,
  A3Input,
  A4Input,
  A5Input,
  A6Input,
} from "./types.js";

export { validateAgentOutput } from "./validator.js";

export { gateAgentOutput } from "./agent-gates.js";

export {
  evaluateTrigger,
  evaluateTriggerWithTrace,
  KNOWN_OPERATORS,
  type TriggerContext,
} from "./trigger-eval.js";

export {
  stagedExecutor,
  type StageSpec,
  type StageExecutionRecord,
} from "./stage-executor.js";

export {
  bindToolsetFor,
  verifyToolBoundariesMatch,
} from "./permission-binder.js";

export {
  DEFAULT_POLICY,
  withRetry,
  type RetryRule,
  type FailureClass,
} from "./retry-policy.js";

export {
  OrchestratorError,
  SchemaValidationError,
  PermissionDeniedError,
  HaltExpiredError,
} from "./errors.js";
