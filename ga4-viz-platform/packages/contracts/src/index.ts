/**
 * @gvp/contracts — Phase 2/3/4 schemas + codegen'd types + runtime validation.
 *
 * Public surface:
 *   - Generated TypeScript types (re-exported)
 *   - SCHEMA_PATHS:   map of named schema → on-disk path (for ajv $ref resolution)
 *   - createValidator(): factory returning an ajv instance with all schemas loaded
 *   - loadSchema():   parse a schema by path
 */
// ajv 8 has a well-known CJS/ESM interop quirk: the default export is presented as a
// namespace at the type level even though at runtime it is the class constructor (or
// .default for some bundlers). We use the canonical "any-cast escape hatch" common in
// ajv 8 + TypeScript codebases. Runtime is correct; we lose construct-time type safety
// on the ajv instance only.
import _Ajv from "ajv/dist/2020.js";
import _addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv: any = ((_Ajv as any).default as any) ?? _Ajv;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormats: any = ((_addFormats as any).default as any) ?? _addFormats;
type AjvInstance = unknown;
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Schemas directory relative to the package root.
// In dev:   packages/contracts/schemas/*
// After build: dist/../schemas/*  → same
const SCHEMAS_ROOT = resolve(__dirname, "..", "schemas");

/**
 * Named accessors for the on-disk path of each schema.
 * Use with loadSchema() or pass directly to ajv.
 */
export const SCHEMA_PATHS = {
  shared:              resolve(SCHEMAS_ROOT, "_shared.schema.json"),
  a1Intent:            resolve(SCHEMAS_ROOT, "agents", "a1-intent.schema.json"),
  a2QueryPlan:         resolve(SCHEMAS_ROOT, "agents", "a2-query-plan.schema.json"),
  a3Decision:          resolve(SCHEMAS_ROOT, "agents", "a3-decision.schema.json"),
  a4DataRecord:        resolve(SCHEMAS_ROOT, "agents", "a4-data-record.schema.json"),
  a5DataBlocks:        resolve(SCHEMAS_ROOT, "agents", "a5-data-blocks.schema.json"),
  a6VizSpec:           resolve(SCHEMAS_ROOT, "agents", "a6-viz-spec.schema.json"),
  catalogRegistry:     resolve(SCHEMAS_ROOT, "registries", "catalog.schema.json"),
  defaultsRegistry:    resolve(SCHEMAS_ROOT, "registries", "defaults.schema.json"),
  metricOntology:      resolve(SCHEMAS_ROOT, "registries", "metric-ontology.schema.json"),
  domainProfile:       resolve(SCHEMAS_ROOT, "registries", "domain-profile.schema.json"),
  blockPatternRegistry:resolve(SCHEMAS_ROOT, "registries", "block-pattern.schema.json"),
  vizRegistry:         resolve(SCHEMAS_ROOT, "registries", "viz-registry.schema.json"),
  pipelinePassthrough: resolve(SCHEMAS_ROOT, "pipeline", "passthrough.schema.json"),
  triggerExpressions:  resolve(SCHEMAS_ROOT, "pipeline", "trigger-expressions.schema.json"),
  stateMachine:        resolve(SCHEMAS_ROOT, "orchestration", "state-machine.schema.json"),
  toolBoundaries:      resolve(SCHEMAS_ROOT, "tool-boundaries", "tool-boundaries.schema.json"),
} as const;

export type SchemaName = keyof typeof SCHEMA_PATHS;

/** Read a schema file from disk and return parsed JSON. */
export async function loadSchema(name: SchemaName): Promise<Record<string, unknown>> {
  const path = SCHEMA_PATHS[name];
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Create an ajv validator pre-loaded with every schema in this package.
 * Cross-file $refs resolve via the schema's $id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createValidator(): Promise<any> {
  const ajv = new Ajv({
    strict: false,           // our schemas use $id with https URIs; relax strict mode
    allErrors: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);

  for (const name of Object.keys(SCHEMA_PATHS) as SchemaName[]) {
    const schema = await loadSchema(name);
    const id = (schema["$id"] as string) ?? `urn:gvp:${name}`;
    if (!ajv.getSchema(id)) {
      ajv.addSchema(schema, id);
    }
  }
  return ajv;
}

/** Validate a value against a named schema. Throws on validation failure. */
export async function validateAgainst(
  name: SchemaName,
  value: unknown,
): Promise<void> {
  const ajv = await createValidator();
  const schema = await loadSchema(name);
  const id = (schema["$id"] as string) ?? `urn:gvp:${name}`;
  const validate = ajv.getSchema(id) as ValidateFunction | undefined;
  if (!validate) throw new Error(`No validator for schema ${name}`);
  const ok = validate(value);
  if (!ok) {
    const errs = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`Schema validation failed for ${name}:\n${errs}`);
  }
}

// Runtime output guards (shared, imported by orchestrator + agents).
export {
  PromptLeakError,
  assertNoPromptLeak,
  collectVisibleText,
  visibleTextFromHtml,
  assertNoPromptLeakInValue,
  assertNoPromptLeakInHtml,
} from "./guards.js";

// Re-export generated types. Codegen produces ./types.generated.ts.
// If codegen hasn't run yet, this import will fail with a useful message.
export * from "./types.generated.js";
