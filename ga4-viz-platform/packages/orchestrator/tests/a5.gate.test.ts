import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a5DataBlocks } from "./_fixtures.js";

describe("A5 — per-agent gate (schema + leak + descriptive)", () => {
  it("clean data blocks pass schema + prompt-leak + descriptive guards", async () => {
    await expect(gateAgentOutput("A5", a5DataBlocks())).resolves.toBeUndefined();
  });

  it("a schema-invalid blocks record is rejected, naming A5", async () => {
    await expect(gateAgentOutput("A5", { schema_version: "0.1.0" })).rejects.toThrow(/A5/);
  });

  it("a NON-descriptive caption is rejected by the descriptive guard, naming A5", async () => {
    const blocks = a5DataBlocks();
    blocks.blocks_by_sub_question.sq_1[0]!.description = "Engagement is strong, driven by paid search.";
    await expect(gateAgentOutput("A5", blocks)).rejects.toThrow(/A5/);
  });

  it("a prompt-leak in a description is rejected", async () => {
    const blocks = a5DataBlocks();
    blocks.blocks_by_sub_question.sq_1[0]!.description = "As the data agent, I will now summarise A4's rows.";
    await expect(gateAgentOutput("A5", blocks)).rejects.toThrow();
  });
});
