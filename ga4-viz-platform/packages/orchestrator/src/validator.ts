/**
 * Schema validation at every handoff.
 *
 * Wraps @gvp/contracts createValidator with a tiny convenience API:
 *   validateAgentOutput("A1", record)
 *   validateAgentOutput("A2", record)
 *   ...
 *
 * Each call throws SchemaValidationError on failure (containing the error list).
 * The ajv instance is created once and reused across calls.
 */
import { createValidator, type SchemaName } from "@gvp/contracts";
import { SchemaValidationError } from "./errors.js";
import type { AgentId } from "./types.js";

const AGENT_TO_SCHEMA: Record<AgentId, SchemaName> = {
  A1: "a1Intent",
  A2: "a2QueryPlan",
  A3: "a3Decision",
  A4: "a4DataRecord",
  A5: "a5DataBlocks",
  A6: "a6VizSpec",
};

let _ajv: unknown;

interface AjvLike {
  getSchema: (id: string) => ValidateFn | undefined;
}

type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

async function getAjv(): Promise<AjvLike> {
  if (!_ajv) _ajv = await createValidator();
  return _ajv as AjvLike;
}

/**
 * Validate an agent's output record. Throws SchemaValidationError on failure.
 *
 * The ajv lookup uses the schema's $id. Each Phase 2 schema declares
 * `$id: "https://joblet.ai/contracts/agents/{name}.schema.json"`.
 */
export async function validateAgentOutput(
  agentId: AgentId,
  value: unknown,
): Promise<void> {
  const schemaName = AGENT_TO_SCHEMA[agentId];
  const ajv = await getAjv();

  // Schema id derived from the on-disk path; @gvp/contracts records this.
  const { loadSchema } = await import("@gvp/contracts");
  const schema = await loadSchema(schemaName);
  const id = (schema["$id"] as string) ?? `urn:gvp:${schemaName}`;

  const validate = ajv.getSchema(id);
  if (!validate) {
    throw new SchemaValidationError(agentId, schemaName, [`No validator for ${id}`]);
  }

  const ok = validate(value);
  if (!ok) {
    const errors = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath ?? "(root)"}: ${e.message ?? "<no msg>"}`);
    throw new SchemaValidationError(agentId, schemaName, errors);
  }
}

/** Reset the cached validator. Tests use this between runs. */
export function _resetValidator(): void {
  _ajv = undefined;
}
