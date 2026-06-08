/**
 * viz_registry_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A6 only
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

export interface VizRegistry {
  schema_version: "0.1.0";
  block_to_component: { [blockType: string]: ComponentMapping };
  colour_policy: ColourPolicy;
  layouts: { [reportType: string]: LayoutTemplate };
}

export interface ComponentMapping {
  primary_component: string;
  alternate_components?: string[];
  always_pair_table_with_chart?: boolean;
}

export interface ColourPolicy {
  identity_palette: string[];
  colour_purposes: {
    sentinel: string;
    partial_period: string;
    z_score_encoding: "monochrome_intensity_blue" | "monochrome_intensity_grey";
    default_text?: string;
    muted_text?: string;
  };
  forbidden_uses: string[];
}

export interface LayoutTemplate {
  sections_order: string[];
  supports_step_narration?: boolean;
}

export const readVizRegistry: RegistryReader<VizRegistry> =
  createRegistryReader<VizRegistry>({
    fileName: "viz-registry.json",
    schemaName: "vizRegistry",
    toolName: "viz_registry_reader",
  });

export async function getComponentFor(blockType: string): Promise<ComponentMapping | undefined> {
  const reg = await readVizRegistry();
  return reg.block_to_component[blockType];
}

export async function getLayoutFor(reportType: string): Promise<LayoutTemplate | undefined> {
  const reg = await readVizRegistry();
  return reg.layouts[reportType];
}
