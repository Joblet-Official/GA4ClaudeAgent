/**
 * Orchestrator integration tests — fully deterministic (no LLM, no network).
 *
 *   Part 1: OrchestratorBrain.runStage mechanics — return value, state tracking,
 *           validation-failure propagation, Flash→Pro escalation bookkeeping.
 *   Part 2: runPipeline wiring — output→input threading across B1–B6 via injected
 *           stub brains, plus the needs_clarification short-circuit.
 *
 * Run: npm run test:orchestrator
 */
import { OrchestratorBrain } from "@/orchestrator/orchestratorBrain";
import { runPipeline, type PipelineDeps } from "@/orchestrator/runPipeline";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const timing = { ttft_ms: 1, total_ms: 1, attempts: 1 };

async function part1() {
  console.log("=".repeat(70));
  console.log("Part 1 — runStage mechanics");

  const orch = new OrchestratorBrain();

  const v = await orch.runStage("brain1", async () => ({ ok: 1 }));
  check("runStage returns the brain value", v.ok === 1);
  check("state tracks stage as ok", orch.state.stages[0]?.status === "ok" && typeof orch.state.stages[0]?.ms === "number");

  let threw = false;
  try {
    await orch.runStage("brain2", async () => ({ x: 1 }), () => {
      throw new Error("validation failed");
    });
  } catch {
    threw = true;
  }
  check("validate-failure propagates + marks stage failed", threw && orch.state.stages.some((s) => s.brain === "brain2" && s.status === "failed"));

  // brain4 route escalates (flash→pro): primary throws an escalatable error, fallback succeeds.
  let calls = 0;
  const r = await orch.runStage("brain4", async () => {
    calls += 1;
    if (calls === 1) throw new Error("schema validation failed");
    return { ok: 2 };
  });
  check("escalation ran fallback after escalatable failure", r.ok === 2 && calls === 2);
  const st4 = orch.state.stages.find((s) => s.brain === "brain4");
  check("escalated stage flagged usedFallback + status=escalated", st4?.usedFallback === true && st4?.status === "escalated");
}

async function part2() {
  console.log("\n" + "=".repeat(70));
  console.log("Part 2 — runPipeline wiring (injected stubs)");

  let metricsGotIntent = false;
  let dataAccessGotApproved = false;

  const stubs: Partial<PipelineDeps> = {
    loadCatalog: (() => ({}) as never) as PipelineDeps["loadCatalog"],
    intent: (async () => ({ output: { report_type: "trend" }, timing })) as unknown as PipelineDeps["intent"],
    metrics: (async (inp: { intent: { report_type?: string } }) => {
      metricsGotIntent = inp.intent?.report_type === "trend";
      return { output: { queries: [{ id: "q1" }] }, timing };
    }) as unknown as PipelineDeps["metrics"],
    gaps: (async () => ({
      output: { status: "approved", approved_queries: [{ id: "q1" }], question_for_user: null, options: null, defaults_applied: null },
      timing,
    })) as unknown as PipelineDeps["gaps"],
    dataAccess: (async (inp: { approvedQueries: Array<{ id: string }> }) => {
      dataAccessGotApproved = inp.approvedQueries?.[0]?.id === "q1";
      return {
        dataset: [{ query_id: "q1", expected_shape: "categorical", dimensionHeaders: ["country"], metricHeaders: [{ name: "sessions", type: "INT" }], rows: [{ country: "India", sessions: 100 }], rowCount: 1, metadata: { sampled: false, dataLossFromOtherRow: false } }],
        source: "deterministic",
        reconciliation: { reconciled: true, sameQueryIntent: true, perQuery: [], discrepancies: [] },
        paths: { llm: { ok: false, timing }, deterministic: { ok: true, dataset: [] } },
        timing: { total_ms: 1 },
      };
    }) as unknown as PipelineDeps["dataAccess"],
    dataHandling: (async () => ({
      output: { blocks: [{ id: "b1", title: "Sessions by country", block_type: "categorical", source_query_ids: ["q1"], columns: ["country", "sessions"], rows: [{ country: "India", sessions: 100 }], derived_metric_names: [], flags: [], notes: [] }], summary_notes: [] },
      source: "deterministic_default",
      llm: { ok: false, timing },
      timing: { total_ms: 1 },
    })) as unknown as PipelineDeps["dataHandling"],
    report: (async (inp: { blocks: { blocks: Array<{ rows: Array<Record<string, unknown>> }> } }) => {
      const row = inp.blocks.blocks[0]?.rows[0] ?? {};
      return {
        html: `<html><body>${String(row.country)}-${String(row.sessions)}</body></html>`,
        spec: { title: "t", subtitle: null, sections: [{ id: "s1", heading: "h", blocks: [], narrative: [] }], context_notes: [] },
        source: "deterministic_default",
        llm: { ok: false, timing },
        timing: { total_ms: 1 },
      };
    }) as unknown as PipelineDeps["report"],
  };

  const res = await runPipeline({ question: "sessions by country" }, { deps: stubs });
  check("pipeline status=complete", res.status === "complete");
  check("orchestrator tracked all 6 stages", res.orchestrator.stages.length === 6);
  check("all 6 stages ok", res.orchestrator.stages.every((s) => s.status === "ok"));
  check("B1 intent threaded into B2", metricsGotIntent);
  check("B3 approved_queries threaded into B4", dataAccessGotApproved);
  check("B5 blocks threaded into B6 report (real values)", !!res.brain6 && res.brain6.html.includes("India") && res.brain6.html.includes("100"));

  // needs_clarification short-circuit.
  const clarifyStubs: Partial<PipelineDeps> = {
    ...stubs,
    gaps: (async () => ({
      output: { status: "needs_clarification", question_for_user: "Which metric?", options: [], approved_queries: [{ id: "q1" }], defaults_applied: null },
      timing,
    })) as unknown as PipelineDeps["gaps"],
  };
  const res2 = await runPipeline({ question: "ambiguous" }, { deps: clarifyStubs });
  check("needs_clarification short-circuits after B3", res2.status === "needs_clarification" && res2.orchestrator.stages.length === 3 && !res2.brain4);
}

async function main() {
  await part1();
  await part2();
  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
