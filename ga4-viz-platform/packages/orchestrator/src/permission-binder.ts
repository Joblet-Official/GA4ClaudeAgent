/**
 * Permission binder — wraps @gvp/tools buildAgentToolset.
 *
 * Phase 4 enforcement: before invoking an agent, the orchestrator constructs
 * a toolset object containing ONLY the tools the agent is permitted to use.
 * The orchestrator never passes the unbound full toolset.
 *
 * In Phase 5C we reuse the buildAgentToolset() function shipped from @gvp/tools.
 * That function reads from a hard-coded PERMISSION_MATRIX that mirrors
 * tool-boundaries.example.json. If the matrix drifts from the JSON spec, the
 * audit step in this file's verifyToolBoundariesMatch() catches it.
 */
import { buildAgentToolset, PERMISSION_MATRIX, type AgentId, type AgentToolset } from "@gvp/tools";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bind an agent's toolset per Phase 4 permission matrix.
 * Returns an object whose enumerable keys are exactly the tools the agent may call.
 */
export function bindToolsetFor(agentId: AgentId): AgentToolset {
  return buildAgentToolset(agentId);
}

/**
 * Audit: verify the in-code PERMISSION_MATRIX matches the on-disk
 * tool-boundaries.json. If they drift, this function returns the diff.
 * Returning empty array = no drift.
 */
export async function verifyToolBoundariesMatch(): Promise<string[]> {
  const dataPath = resolve(__dirname, "..", "..", "registry-data", "tool-boundaries.json");
  let json: { agent_permissions: Record<string, { may_use: string[] }> };
  try {
    const raw = await readFile(dataPath, "utf-8");
    json = JSON.parse(raw);
  } catch (e) {
    return [`Cannot read tool-boundaries.json at ${dataPath}: ${(e as Error).message}`];
  }

  // Map JSON tool_ids to PERMISSION_MATRIX function names.
  // The JSON uses snake_case tool_ids; the matrix uses camelCase function names.
  const idMap: Record<string, string[]> = {
    ga4_data_api: ["ga4Query"],
    catalog_reader: ["readCatalog", "findField", "getHintText", "resolveDeterministicAlias"],
    defaults_registry_reader: ["readDefaults", "getDefaultPolicy"],
    metric_ontology_reader: ["readMetricOntology", "getOntologyEntry"],
    domain_profile_reader: ["readDomainProfiles", "getProfileFor"],
    block_pattern_registry_reader: ["readBlockPatterns", "getPatternFor"],
    viz_registry_reader: ["readVizRegistry", "getComponentFor", "getLayoutFor"],
    html_file_writer: ["writeReportHtml", "resolveSafeReportsPath"],
    clarification_emitter: ["emitClarification"],
  };

  const diffs: string[] = [];
  for (const [agent, perm] of Object.entries(json.agent_permissions)) {
    const expected = new Set<string>();
    for (const toolId of perm.may_use) {
      const fns = idMap[toolId];
      if (!fns) {
        diffs.push(`Unknown tool_id '${toolId}' in tool-boundaries.json for ${agent}`);
        continue;
      }
      for (const fn of fns) expected.add(fn);
    }
    const actual = PERMISSION_MATRIX[agent as AgentId] ?? new Set();
    for (const fn of expected) {
      if (!actual.has(fn as keyof AgentToolset)) {
        diffs.push(`${agent}: in JSON but missing from PERMISSION_MATRIX: ${fn}`);
      }
    }
    for (const fn of actual) {
      if (!expected.has(fn)) {
        diffs.push(`${agent}: in PERMISSION_MATRIX but not in JSON tool_ids: ${fn}`);
      }
    }
  }
  return diffs;
}

export type { AgentId, AgentToolset };
