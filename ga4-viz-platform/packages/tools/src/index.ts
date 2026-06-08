/**
 * @gvp/tools — Phase 5B tool layer.
 *
 * Exports the 9 tools from the Phase 4 catalog, plus a `buildAgentToolset`
 * factory that returns ONLY the tools each agent is permitted to invoke
 * (per tool-boundaries.example.json). This is the Phase-4 enforcement boundary
 * referenced in ORCHESTRATION.md §5: agents receive a tool-call surface that
 * physically excludes tools they may not use.
 */

// Re-export each tool's public surface
export * as catalog from "./catalog-reader.js";
export * as defaults from "./defaults-reader.js";
export * as ontology from "./ontology-reader.js";
export * as domainProfile from "./domain-profile-reader.js";
export * as blockPattern from "./block-pattern-reader.js";
export * as vizRegistry from "./viz-registry-reader.js";
export * as ga4 from "./ga4-client.js";
export * as htmlWriter from "./html-writer.js";
export * as clarification from "./clarification-emitter.js";

// Named imports for the factory
import { readCatalog, findField, getHintText, resolveDeterministicAlias } from "./catalog-reader.js";
import { readDefaults, getDefaultPolicy } from "./defaults-reader.js";
import { readMetricOntology, getOntologyEntry } from "./ontology-reader.js";
import { readDomainProfiles, getProfileFor } from "./domain-profile-reader.js";
import { readBlockPatterns, getPatternFor } from "./block-pattern-reader.js";
import { readVizRegistry, getComponentFor, getLayoutFor } from "./viz-registry-reader.js";
import { runReport } from "./ga4-client.js";
import { writeReportHtml, resolveSafeReportsPath } from "./html-writer.js";
import { emitClarification } from "./clarification-emitter.js";

export type AgentId = "A1" | "A2" | "A3" | "A4" | "A5" | "A6";

/**
 * Toolset bound for a single agent. Calling any property that the agent's
 * permission set excludes returns `undefined`. The orchestrator should
 * pass this object as the agent's tool-call surface.
 *
 * Permission shape is taken from packages/registry-data/tool-boundaries.json
 * at runtime — see permission-binder in @gvp/orchestrator (Phase 5C).
 */
export interface AgentToolset {
  // registry readers
  readCatalog?: typeof readCatalog;
  findField?: typeof findField;
  getHintText?: typeof getHintText;
  resolveDeterministicAlias?: typeof resolveDeterministicAlias;
  readDefaults?: typeof readDefaults;
  getDefaultPolicy?: typeof getDefaultPolicy;
  readMetricOntology?: typeof readMetricOntology;
  getOntologyEntry?: typeof getOntologyEntry;
  readDomainProfiles?: typeof readDomainProfiles;
  getProfileFor?: typeof getProfileFor;
  readBlockPatterns?: typeof readBlockPatterns;
  getPatternFor?: typeof getPatternFor;
  readVizRegistry?: typeof readVizRegistry;
  getComponentFor?: typeof getComponentFor;
  getLayoutFor?: typeof getLayoutFor;
  // data APIs
  ga4Query?: typeof runReport;
  // file write
  writeReportHtml?: typeof writeReportHtml;
  resolveSafeReportsPath?: typeof resolveSafeReportsPath;
  // user surface
  emitClarification?: typeof emitClarification;
}

/**
 * The full Phase 4 permission matrix, hard-coded to mirror
 * tool-boundaries.example.json. The orchestrator's permission-binder
 * (Phase 5C) will read the JSON at boot and produce this same mapping;
 * having it here as a default lets tests run without the orchestrator.
 */
const PERMISSION_MATRIX: Record<AgentId, Set<keyof AgentToolset>> = {
  A1: new Set(),
  A2: new Set([
    "readCatalog", "findField", "getHintText", "resolveDeterministicAlias",
    "readMetricOntology", "getOntologyEntry",
    "readDomainProfiles", "getProfileFor",
  ]),
  A3: new Set([
    "readDefaults", "getDefaultPolicy",
    "emitClarification",
  ]),
  A4: new Set([
    "ga4Query",
  ]),
  A5: new Set([
    "readBlockPatterns", "getPatternFor",
  ]),
  A6: new Set([
    "readVizRegistry", "getComponentFor", "getLayoutFor",
    "writeReportHtml", "resolveSafeReportsPath",
  ]),
};

/**
 * Build a tool surface bound to a single agent's permissions.
 * Tools not in the agent's permission set are omitted from the returned object,
 * so calling them is a TypeScript-level error and a runtime no-op.
 */
export function buildAgentToolset(agent: AgentId): AgentToolset {
  const allow = PERMISSION_MATRIX[agent];
  const toolset: AgentToolset = {};

  const all: AgentToolset = {
    readCatalog, findField, getHintText, resolveDeterministicAlias,
    readDefaults, getDefaultPolicy,
    readMetricOntology, getOntologyEntry,
    readDomainProfiles, getProfileFor,
    readBlockPatterns, getPatternFor,
    readVizRegistry, getComponentFor, getLayoutFor,
    ga4Query: runReport,
    writeReportHtml, resolveSafeReportsPath,
    emitClarification,
  };

  for (const key of Object.keys(all) as Array<keyof AgentToolset>) {
    if (allow.has(key)) {
      // Type assertion — we've checked membership.
      (toolset as Record<string, unknown>)[key] = (all as Record<string, unknown>)[key];
    }
  }
  return toolset;
}

export { PERMISSION_MATRIX };
