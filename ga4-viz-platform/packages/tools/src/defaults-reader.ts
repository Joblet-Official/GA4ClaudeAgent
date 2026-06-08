/**
 * defaults_registry_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A3 only
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

export interface DefaultsRegistry {
  schema_version: "0.1.0";
  fields: { [field: string]: DefaultPolicy };
}

export interface DefaultPolicy {
  defaultable: boolean;
  default_value?: unknown;
  candidates?: unknown[];
  no_default_reason?: string;
  disclosure_template?: string;
  applies_to_report_types?: string[];
  depends_on?: Record<string, unknown>;
  registry_recommended?: boolean;
}

export const readDefaults: RegistryReader<DefaultsRegistry> =
  createRegistryReader<DefaultsRegistry>({
    fileName: "defaults.json",
    schemaName: "defaultsRegistry",
    toolName: "defaults_registry_reader",
  });

/** Lookup a single field's policy. Returns undefined when not in registry. */
export async function getDefaultPolicy(
  fieldName: string,
): Promise<DefaultPolicy | undefined> {
  const reg = await readDefaults();
  return reg.fields[fieldName];
}
