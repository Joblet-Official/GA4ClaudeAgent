import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a1Intent } from "./_fixtures.js";

describe("A1 — per-agent gate", () => {
  it("a clean intent passes schema + prompt-leak guard", async () => {
    await expect(gateAgentOutput("A1", a1Intent())).resolves.toBeUndefined();
  });

  it("a schema-invalid intent is rejected, naming A1", async () => {
    await expect(gateAgentOutput("A1", { schema_version: "0.1.0", report_type: "ranking" })).rejects.toThrow(/A1/);
  });
});
