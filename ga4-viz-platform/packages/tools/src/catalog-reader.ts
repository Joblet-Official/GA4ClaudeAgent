/**
 * catalog_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A2 only
 *
 * Returns the GA4/GSC field catalog with annotated short_definitions used as
 * A3 clarification hints (Phase-1 finding fold-in).
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

// The Catalog type comes from @gvp/contracts after codegen. Until codegen runs we use
// a structural shape; once `pnpm codegen` runs the import below will refine.
export interface Catalog {
  schema_version: "0.1.0";
  sources: {
    [source: string]: {
      source: "ga4" | "gsc";
      metrics: FieldDef[];
      dimensions: FieldDef[];
      filter_operators?: unknown[];
      compatibility_rules?: unknown[];
      term_aliases?: TermAlias[];
      property_scope?: string;
    };
  };
}

export interface FieldDef {
  name: string;
  kind: "metric" | "dimension";
  data_type?: string;
  display_name: string;
  short_definition: string;
  long_definition?: string;
  user_term_aliases?: string[];
  gotchas?: string[];
  rate_handling?: "sum_to_period" | "weighted_average" | "ratio_of_sums" | "not_aggregatable";
  rate_components?: string[];
}

export interface TermAlias {
  user_term: string;
  maps_to: string;
  deterministic: boolean;
  context?: string;
}

/** The actual reader — validates against catalog.schema.json, caches in-memory. */
export const readCatalog: RegistryReader<Catalog> = createRegistryReader<Catalog>({
  fileName: "catalog.json",
  schemaName: "catalogRegistry",
  toolName: "catalog_reader",
});

/**
 * Convenience: look up the FieldDef for a catalog field name (case-sensitive).
 * Returns undefined when not found.
 */
export async function findField(
  source: "ga4" | "gsc",
  fieldName: string,
): Promise<FieldDef | undefined> {
  const catalog = await readCatalog();
  const sourceData = catalog.sources[source];
  if (!sourceData) return undefined;
  return (
    sourceData.metrics.find((f) => f.name === fieldName) ??
    sourceData.dimensions.find((f) => f.name === fieldName)
  );
}

/**
 * Convenience: get the short_definition (used by A3 as clarification hint text).
 * Per Phase-1 finding: A3 hint text MUST come from this function, not from model paraphrasing.
 */
export async function getHintText(
  source: "ga4" | "gsc",
  fieldName: string,
): Promise<string | undefined> {
  const field = await findField(source, fieldName);
  return field?.short_definition;
}

/**
 * Convenience: resolve a user_term to a deterministic catalog field name.
 * Returns the catalog name iff the alias is unambiguous (deterministic=true).
 * Returns null if the term has multiple candidates OR doesn't appear.
 */
export async function resolveDeterministicAlias(
  source: "ga4" | "gsc",
  userTerm: string,
): Promise<string | null> {
  const catalog = await readCatalog();
  const sourceData = catalog.sources[source];
  if (!sourceData) return null;
  const aliases = sourceData.term_aliases ?? [];
  const matches = aliases.filter((a) => a.user_term === userTerm.toLowerCase());
  if (matches.length === 1 && matches[0]!.deterministic) {
    return matches[0]!.maps_to;
  }
  return null;
}
