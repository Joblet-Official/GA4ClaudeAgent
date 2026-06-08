import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a6VizSpec } from "./_fixtures.js";

describe("A6 — per-agent gate (schema + leak; palette on emitted HTML)", () => {
  it("a clean viz spec passes schema + prompt-leak guard", async () => {
    await expect(gateAgentOutput("A6", a6VizSpec())).resolves.toBeUndefined();
  });

  it("a schema-invalid viz spec is rejected, naming A6", async () => {
    await expect(gateAgentOutput("A6", { schema_version: "0.1.0" })).rejects.toThrow(/A6/);
  });

  it("an identity-leak injected into a caption is rejected", async () => {
    const spec = a6VizSpec();
    spec.sections[0]!.components[0]!.caption =
      "You are the visualisation agent; I will now render the report.";
    await expect(gateAgentOutput("A6", spec)).rejects.toThrow(/A6/);
  });

  it("a step-index / execute leak injected into a caption is rejected", async () => {
    const spec = a6VizSpec();
    spec.sections[0]!.components[0]!.caption = "Apply funnel — Step 4 of 11 — execute: always";
    await expect(gateAgentOutput("A6", spec)).rejects.toThrow(/A6/);
  });
});
