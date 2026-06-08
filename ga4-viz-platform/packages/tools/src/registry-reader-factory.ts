/**
 * Generic factory for registry readers.
 *
 * A registry reader is a tool of kind=registry_read per Phase 4. Each reader:
 *   1. Loads the JSON file from disk.
 *   2. Validates it against its schema using @gvp/contracts.
 *   3. Caches the result in-memory (per Phase 4 constraint: cache_in_memory=true).
 *   4. Returns the typed registry record.
 *
 * Implementations of the 6 registry readers (catalog, defaults, ontology,
 * domain-profile, block-pattern, viz-registry) are thin wrappers around this.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createValidator, type SchemaName } from "@gvp/contracts";

/** Minimal structural type for an ajv ValidateFunction — avoids importing ajv into this package. */
type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath?: string; message?: string }> | null;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the registry-data package, relative to this tool file.
 * Works for both:
 *   src/registry-reader-factory.ts  (vitest, dev)   → packages/tools/src/../../registry-data
 *   dist/registry-reader-factory.js (built)         → packages/tools/dist/../../registry-data
 * Both resolve to packages/registry-data ✓
 */
const REGISTRY_DATA_DIR = resolve(__dirname, "..", "..", "registry-data");

/** A registry reader function signature. */
export type RegistryReader<T> = () => Promise<T>;

interface ReaderConfig {
  /** JSON file name within packages/registry-data/ (e.g. "catalog.json"). */
  fileName: string;
  /** Schema name in @gvp/contracts SCHEMA_PATHS (e.g. "catalogRegistry"). */
  schemaName: SchemaName;
  /** Human-friendly tool name for error messages. */
  toolName: string;
}

/**
 * Build a registry reader. Validates at first call; caches the parsed JSON in a
 * module-level Map keyed by the data file path.
 */
const _cache: Map<string, unknown> = new Map();
const _validatorPromise: { ajv?: Awaited<ReturnType<typeof createValidator>> } = {};

async function getValidator() {
  if (!_validatorPromise.ajv) {
    _validatorPromise.ajv = await createValidator();
  }
  return _validatorPromise.ajv;
}

export function createRegistryReader<T>(config: ReaderConfig): RegistryReader<T> {
  const dataPath = resolve(REGISTRY_DATA_DIR, config.fileName);

  return async function read(): Promise<T> {
    const cached = _cache.get(dataPath);
    if (cached !== undefined) return cached as T;

    let raw: string;
    try {
      raw = await readFile(dataPath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${config.toolName}: failed to read ${dataPath}: ${msg}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`${config.toolName}: ${dataPath} is not valid JSON: ${msg}`);
    }

    // Validate against the schema
    const ajv = await getValidator();
    const contractsModule = await import("@gvp/contracts");
    const schema = await contractsModule.loadSchema(config.schemaName);
    const schemaId = (schema["$id"] as string) ?? `urn:gvp:${config.schemaName}`;
    const validate = (ajv as { getSchema: (id: string) => ValidateFn | undefined }).getSchema(
      schemaId,
    );
    if (!validate) {
      throw new Error(`${config.toolName}: no validator for schema ${config.schemaName}`);
    }
    if (!validate(parsed)) {
      const errs = (validate.errors ?? [])
        .slice(0, 5)
        .map((e) => `  ${e.instancePath ?? "(root)"}: ${e.message ?? "<no message>"}`)
        .join("\n");
      throw new Error(
        `${config.toolName}: ${dataPath} failed schema validation against ${config.schemaName}:\n${errs}`,
      );
    }

    _cache.set(dataPath, parsed);
    return parsed as T;
  };
}

/** Clear the in-memory cache. Useful for tests. */
export function _clearRegistryCache(): void {
  _cache.clear();
  delete _validatorPromise.ajv;
}
