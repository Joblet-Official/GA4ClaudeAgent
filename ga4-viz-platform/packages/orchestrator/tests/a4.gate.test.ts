import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a4DataRecord } from "./_fixtures.js";

describe("A4 — per-agent gate", () => {
  it("a clean data record passes schema + prompt-leak guard", async () => {
    await expect(gateAgentOutput("A4", a4DataRecord())).resolves.toBeUndefined();
  });

  it("a schema-invalid data record is rejected, naming A4", async () => {
    await expect(gateAgentOutput("A4", { schema_version: "0.1.0" })).rejects.toThrow(/A4/);
  });
});
