/**
 * Typed error classes for the orchestrator. Each maps to a FailureReasonCode
 * surfaced in TurnResult.
 */
import type { FailureReasonCode } from "./types.js";

export class OrchestratorError extends Error {
  readonly reasonCode: FailureReasonCode;
  readonly detail: string;
  readonly agentId?: string;

  constructor(reasonCode: FailureReasonCode, detail: string, agentId?: string) {
    super(`${reasonCode}: ${detail}${agentId ? ` (agent=${agentId})` : ""}`);
    this.name = "OrchestratorError";
    this.reasonCode = reasonCode;
    this.detail = detail;
    if (agentId !== undefined) this.agentId = agentId;
  }
}

export class SchemaValidationError extends OrchestratorError {
  constructor(agentId: string, schemaName: string, errors: string[]) {
    super(
      "schema_validation_failure",
      `${agentId} output failed validation against ${schemaName}:\n${errors.join("\n")}`,
      agentId,
    );
  }
}

export class PermissionDeniedError extends OrchestratorError {
  constructor(agentId: string, toolId: string) {
    super(
      "permission_denied",
      `Agent ${agentId} attempted to invoke tool '${toolId}' which is not in its permission set`,
      agentId,
    );
  }
}

export class HaltExpiredError extends OrchestratorError {
  constructor(turnId: string) {
    super(
      "halt_expired",
      `Halted turn ${turnId} has expired and cannot be resumed`,
    );
  }
}
