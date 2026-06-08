/**
 * Loads catalog/ga4_catalog.json — the single source of truth for valid GA4
 * field names.
 *
 * Imports the JSON statically so Next.js's bundler ships it with the function
 * on Vercel. (Previous version used readFileSync(process.cwd()+...) which
 * works locally but isn't included in the Vercel bundle by default.)
 *
 * The catalog is therefore baked in at *build time*. Updates require:
 *   1. Re-run `pull_gtm_tags.py` to refresh the GTM snapshot.
 *   2. Re-run `scripts/refresh_catalog.py` to rebuild this JSON.
 *   3. Commit + push → Vercel redeploys.
 *
 * In dev (`npm run dev`), Next.js hot-reloads on JSON file changes, so step 3
 * is just "save and refresh the page".
 */
import rawCatalog from "../../../catalog/ga4_catalog.json";

export interface CatalogDimension {
  api_name: string;
  ui_name: string;
  category: string;
  description: string;
  custom_definition: boolean;
}

export interface CatalogMetric {
  api_name: string;
  ui_name: string;
  category: string;
  description: string;
  type: string;
  custom_definition: boolean;
}

export interface CatalogEvent {
  name: string;
  source: "gtm" | "ga4_built_in";
  from_tag?: string;
}

export interface Catalog {
  schema_version: number;
  generated_at: string;
  property_id: string;
  source: { ga4_metadata_api: boolean; gtm_snapshot: string };
  dimensions: CatalogDimension[];
  metrics: CatalogMetric[];
  events: CatalogEvent[];
  limitations: string[];
  /** O(1) lookup for validator — built lazily on first loadCatalog() call. */
  _dimensionNames?: Set<string>;
  _metricNames?: Set<string>;
}

let _cache: Catalog | null = null;

export function loadCatalog(force = false): Catalog {
  if (_cache && !force) return _cache;

  const parsed = rawCatalog as unknown as Catalog;

  if (!parsed.dimensions || !parsed.metrics || !parsed.events) {
    throw new Error(
      `catalog/ga4_catalog.json is missing required keys. Re-run scripts/refresh_catalog.py.`,
    );
  }

  parsed._dimensionNames = new Set(parsed.dimensions.map((d) => d.api_name));
  parsed._metricNames = new Set(parsed.metrics.map((m) => m.api_name));

  const ageMs = Date.now() - Date.parse(parsed.generated_at);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > 14) {
    console.warn(
      `[catalog] ga4_catalog.json is ${ageDays.toFixed(0)} days old. Re-run scripts/refresh_catalog.py.`,
    );
  }

  _cache = parsed;
  return parsed;
}

export function clearCatalogCache(): void {
  _cache = null;
}
