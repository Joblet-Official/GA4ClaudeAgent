/**
 * block_pattern_registry_reader (Phase 4 tool).
 *
 *   kind:            registry_read
 *   side_effect:     read_only
 *   permitted for:   A5 only
 */
import { createRegistryReader, type RegistryReader } from "./registry-reader-factory.js";

export interface BlockPatternRegistry {
  schema_version: "0.1.0";
  patterns: { [reportType: string]: BlockPattern };
}

export interface BlockPattern {
  report_type: string;
  blocks: BlockSpec[];
  events_of_interest_displays?: Array<{
    block_type: string;
    event_name: string;
    when?: string;
  }>;
  other_rollup_policy?: "never" | "if_a4_fetched_tail" | "always_fetch_tail_for_rollup";
}

export interface BlockSpec {
  block_type: string;
  required?: boolean;
  mandatory_annotations?: string[];
  purpose?: string;
}

export const readBlockPatterns: RegistryReader<BlockPatternRegistry> =
  createRegistryReader<BlockPatternRegistry>({
    fileName: "block-pattern.json",
    schemaName: "blockPatternRegistry",
    toolName: "block_pattern_registry_reader",
  });

export async function getPatternFor(reportType: string): Promise<BlockPattern | undefined> {
  const reg = await readBlockPatterns();
  return reg.patterns[reportType];
}
