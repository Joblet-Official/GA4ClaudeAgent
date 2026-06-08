import { describe, it, expect } from "vitest";
import { gateAgentOutput } from "../src/index.js";
import { a2Plan } from "./_fixtures.js";

describe("A2 — per-agent gate", () => {
  it("a clean query plan passes schema + prompt-leak guard", async () => {
    await expect(gateAgentOutput("A2", a2Plan())).resolves.toBeUndefined();
  });

  it("a schema-invalid plan is rejected, naming A2", async () => {
    await expect(gateAgentOutput("A2", { schema_version: "0.1.0" })).rejects.toThrow(/A2/);
  });
});
