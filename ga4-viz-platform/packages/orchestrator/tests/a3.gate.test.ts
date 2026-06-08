import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a3Decision } from "./_fixtures.js";

describe("A3 — per-agent gate", () => {
  it("a clean decision passes schema + prompt-leak guard", async () => {
    await expect(gateAgentOutput("A3", a3Decision())).resolves.toBeUndefined();
  });

  it("a schema-invalid decision is rejected, naming A3", async () => {
    await expect(gateAgentOutput("A3", { schema_version: "0.1.0" })).rejects.toThrow(/A3/);
  });
});
