/**
 * metric_ontology_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A2 only
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

export interface MetricOntology {
  schema_version: "0.1.0";
  metrics: { [name: string]: MetricOntologyEntry };
}

export interface MetricOntologyEntry {
  metric: string;
  decomposition_kind: "ratio" | "sum_of_parts" | "average" | "count" | "atomic";
  formula?: string;
  components?: string[];
  affected_by?: Record<string, string[]>;
  investigation_branches?: InvestigationBranch[];
  path_exploration_strategy?: PathExplorationStrategy;
}

export interface InvestigationBranch {
  branch_id: string;
  trigger: "always" | "conditional";
  condition?: string;
  queries?: QueryTemplate[];
  rationale_template?: string;
}

export interface QueryTemplate {
  template_id: string;
  source: "ga4" | "gsc";
  metrics?: string[];
  dimensions?: string[];
  date_window?: "current" | "comparison" | "both" | "current_plus_baseline";
  limit?: number | null;
  ordering?: string;
}

export interface PathExplorationStrategy {
  trigger_when?: string;
  sample_strategy?: string[];
  target_event_for_event_count?: string;
}

export const readMetricOntology: RegistryReader<MetricOntology> =
  createRegistryReader<MetricOntology>({
    fileName: "metric-ontology.json",
    schemaName: "metricOntology",
    toolName: "metric_ontology_reader",
  });

export async function getOntologyEntry(
  metricName: string,
): Promise<MetricOntologyEntry | undefined> {
  const ont = await readMetricOntology();
  return ont.metrics[metricName];
}
