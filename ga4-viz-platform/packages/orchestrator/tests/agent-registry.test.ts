/**
 * Phase 5D — createAgentRegistry drives a full turn through the Orchestrator.
 *
 * Proves the deterministic registry (A1–A4 producers + REAL @gvp/agents A5/A6)
 * runs end-to-end to kind=complete, passes the per-handoff schema + gate checks,
 * and that A5/A6 actually transformed the data (narrative_stage stamped by
 * assignNarrativeStage; component caption attached from A5's description).
 * Also proves per-agent overrides compose.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  Orchestrator,
  InMemorySessionStore,
  createAgentRegistry,
  type AgentRegistry,
  type AgentFunction,
} from "../src/index.js";

describe("Phase 5D — createAgentRegistry", () => {
  let store: InMemorySessionStore;
  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it("drives a full turn to kind=complete with a real A5/A6 caption", async () => {
    const orch = new Orchestrator({ agents: createAgentRegistry(), sessionStore: store });
    const result = await orch.runTurn({
      user_query: "what is the engagement rate",
      session_id: "sess_5d_1",
    });

    expect(result.kind).toBe("complete");
    if (result.kind !== "complete") return;

    const viz = result.viz_spec as {
      sections: Array<{ components: Array<{ caption?: string; narrative_stage?: string }> }>;
    };
    const comp = viz.sections[0]!.components[0]!;
    // A6 attached A5's description as the caption (real attachCaptions path).
    expect(comp.caption).toBe("Engagement rate is 60.5% over the period.");
    // A5 stamped a valid funnel-narrative stage via assignNarrativeStage.
    expect(["overview", "acquisition", "quality", "behavior", "outcomes"]).toContain(
      comp.narrative_stage,
    );
  });

  it("honours a per-agent override (A6 replaced) while keeping the rest", async () => {
    let a6Called = false;
    const customA6: AgentFunction<unknown, unknown> = async () => {
      a6Called = true;
      return {
        schema_version: "0.1.0",
        report_title: "Custom",
        subtitle: "override",
        context_chips: [{ key: "Source", text: "GA4", kind: "context" }],
        disclosure_chips: [],
        sections: [
          {
            section_id: "sq_1_main",
            section_title: "Snapshot",
            components: [
              {
                component: "kpi_strip",
                block_ref: "sq_1_b_1",
                narrative_stage: "overview",
                kpis: [{ label: "Engagement rate", value_display: "60.5%" }],
              },
            ],
          },
        ],
        quality_notes: [],
        footer_meta: { source: "GA4 property 516147906", pulled_at: "2026-05-22T14:00:00Z" },
      };
    };

    const agents: AgentRegistry = createAgentRegistry({ a6: customA6 });
    const orch = new Orchestrator({ agents, sessionStore: store });
    const result = await orch.runTurn({ user_query: "x", session_id: "sess_5d_2" });

    expect(result.kind).toBe("complete");
    expect(a6Called).toBe(true);
    if (result.kind === "complete") {
      expect((result.viz_spec as { report_title: string }).report_title).toBe("Custom");
    }
  });

  it("a malformed override still fails fast at the gate (named agent)", async () => {
    const badA1: AgentFunction<unknown, unknown> = async () =>
      ({ schema_version: "0.1.0", report_type: "ranking" }) as unknown; // missing required fields
    const orch = new Orchestrator({ agents: createAgentRegistry({ a1: badA1 }), sessionStore: store });
    const r = await orch.runTurn({ user_query: "x", session_id: "sess_5d_3" });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.reason_code).toBe("schema_validation_failure");
      expect(r.detail).toContain("A1");
    }
  });
});
