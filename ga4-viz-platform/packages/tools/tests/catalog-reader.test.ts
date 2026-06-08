/**
 * catalog_reader smoke tests.
 *
 * Verifies the tool:
 *   1. Loads catalog.json from packages/registry-data
 *   2. Validates against catalog.schema.json (will throw if invalid)
 *   3. Returns a typed Catalog with at least the GA4 source
 *   4. Convenience lookups (findField, getHintText, resolveDeterministicAlias) work
 *
 * Also tests Phase 4 boundary: A1's toolset must NOT include catalog functions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readCatalog,
  findField,
  getHintText,
  resolveDeterministicAlias,
} from "../src/catalog-reader.js";
import { buildAgentToolset } from "../src/index.js";
import { _clearRegistryCache } from "../src/registry-reader-factory.js";

describe("catalog_reader", () => {
  beforeEach(() => {
    _clearRegistryCache();
  });

  it("loads catalog.json and validates against schema", async () => {
    const catalog = await readCatalog();
    expect(catalog).toBeDefined();
    expect(catalog.schema_version).toBe("0.1.0");
    expect(catalog.sources).toBeDefined();
    expect(catalog.sources["ga4"]).toBeDefined();
  });

  it("GA4 catalog contains engagementRate metric with rate_handling=ratio_of_sums", async () => {
    const field = await findField("ga4", "engagementRate");
    expect(field).toBeDefined();
    expect(field?.kind).toBe("metric");
    expect(field?.rate_handling).toBe("ratio_of_sums");
    expect(field?.rate_components).toEqual(["engagedSessions", "sessions"]);
  });

  it("findField returns undefined for unknown field", async () => {
    const field = await findField("ga4", "totallyMadeUp");
    expect(field).toBeUndefined();
  });

  it("getHintText returns short_definition (the A3 clarification hint source)", async () => {
    const hint = await getHintText("ga4", "sessions");
    expect(hint).toBeDefined();
    expect(typeof hint).toBe("string");
    expect(hint!.length).toBeGreaterThan(10);
  });

  it("resolveDeterministicAlias returns null for ambiguous user_term 'traffic'", async () => {
    const resolved = await resolveDeterministicAlias("ga4", "traffic");
    expect(resolved).toBeNull(); // 'traffic' is deterministic=false (multiple candidates)
  });

  it("resolveDeterministicAlias returns the mapped field for 'engagement rate'", async () => {
    const resolved = await resolveDeterministicAlias("ga4", "engagement rate");
    expect(resolved).toBe("engagementRate");
  });
});

describe("Phase 4 boundary enforcement via buildAgentToolset", () => {
  it("A1 toolset is empty (no tools at all)", () => {
    const toolset = buildAgentToolset("A1");
    expect(Object.keys(toolset).length).toBe(0);
    expect(toolset.readCatalog).toBeUndefined();
    expect(toolset.ga4Query).toBeUndefined();
  });

  it("A2 has catalog/ontology/domain readers but NOT data APIs", () => {
    const toolset = buildAgentToolset("A2");
    expect(toolset.readCatalog).toBeDefined();
    expect(toolset.readMetricOntology).toBeDefined();
    expect(toolset.readDomainProfiles).toBeDefined();
    expect(toolset.ga4Query).toBeUndefined();
    expect(toolset.readDefaults).toBeUndefined(); // A3's tool
  });

  it("A3 has defaults reader + clarification emitter but no others", () => {
    const toolset = buildAgentToolset("A3");
    expect(toolset.readDefaults).toBeDefined();
    expect(toolset.emitClarification).toBeDefined();
    expect(toolset.readCatalog).toBeUndefined();
    expect(toolset.ga4Query).toBeUndefined();
  });

  it("A4 has the GA4 data API and NOTHING else (Rule 1 boundary)", () => {
    const toolset = buildAgentToolset("A4");
    expect(toolset.ga4Query).toBeDefined();
    expect(toolset.readCatalog).toBeUndefined();
    expect(toolset.writeReportHtml).toBeUndefined();
  });

  it("A5 has only the block-pattern reader", () => {
    const toolset = buildAgentToolset("A5");
    expect(toolset.readBlockPatterns).toBeDefined();
    expect(toolset.getPatternFor).toBeDefined();
    expect(toolset.ga4Query).toBeUndefined();
    expect(toolset.readVizRegistry).toBeUndefined();
  });

  it("A6 has viz registry + html writer but no data APIs", () => {
    const toolset = buildAgentToolset("A6");
    expect(toolset.readVizRegistry).toBeDefined();
    expect(toolset.writeReportHtml).toBeDefined();
    expect(toolset.resolveSafeReportsPath).toBeDefined();
    expect(toolset.ga4Query).toBeUndefined();
    expect(toolset.emitClarification).toBeUndefined();
  });
});
