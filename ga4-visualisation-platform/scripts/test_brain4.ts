/**
 * End-to-end smoke test: Brain 1 → Brain 2 → Brain 3 → Brain 4 (dual-path).
 *
 * Exercises the dual-path Data Access layer on questions that Brain 3 should
 * approve (so retrieval actually runs). Reports which path won (llm /
 * deterministic) and the reconciliation verdict.
 *
 * Run:
 *   npm run test:brain4
 *
 * Requires GA4 access in env (GA4_PROPERTY_ID + GOOGLE_APPLICATION_CREDENTIALS).
 * If GA4 is unreachable, both paths surface the same error and Brain 4 falls
 * back to the deterministic dataset — the scaffold still runs end-to-end.
 */
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps } from "@/brains/brain3_gaps";
import { runBrain4DataAccess } from "@/brains/brain4_dataaccess";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";

const b1Cfg = getClient("brain1");
const b2Cfg = getClient("brain2");
const b3Cfg = getClient("brain3");
const b4Cfg = getClient("brain4");

interface Case {
  name: string;
  question: string;
}

const CASES: Case[] = [
  { name: "sessions by country, last 7 days", question: "sessions by country for the last 7 days" },
  { name: "sessions + users by city for India, 30 days", question: "for India, sessions and users by city last 30 days" },
];

function fmt(o: unknown): string {
  return JSON.stringify(o, null, 2);
}

async function main() {
  console.log(`Brain 1: ${b1Cfg.provider} / ${b1Cfg.model}`);
  console.log(`Brain 2: ${b2Cfg.provider} / ${b2Cfg.model}`);
  console.log(`Brain 3: ${b3Cfg.provider} / ${b3Cfg.model}`);
  console.log(`Brain 4: ${b4Cfg.provider} / ${b4Cfg.model}`);
  const catalog = loadCatalog();
  console.log(`Catalog: ${catalog.dimensions.length} dims, ${catalog.metrics.length} metrics`);
  console.log(`GA4_PROPERTY_ID: ${process.env.GA4_PROPERTY_ID ?? "(unset)"}`);

  const delayMs = Number(process.env.TEST_DELAY_MS ?? 4000);
  let pass = 0;
  let fail = 0;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    console.log("\n" + "=".repeat(70));
    console.log(`CASE: ${c.name}`);
    console.log(`  question: ${c.question}`);

    try {
      const b1 = await runBrain1Intent({ question: c.question, memory: null });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const b3 = await runBrain3Gaps({ intent: b1.output, queries: b2.output.queries });
      console.log(`  brain3 status: ${b3.output.status}  (queries=${b3.output.approved_queries.length})`);

      if (b3.output.status === "needs_clarification") {
        console.log(`  ⚠ skipped Brain 4 (needs_clarification): ${b3.output.question_for_user}`);
        continue;
      }

      const b4 = await runBrain4DataAccess({
        approvedQueries: b3.output.approved_queries,
        intent: b1.output,
        catalog,
      });

      console.log(`  brain4 SOURCE: ${b4.source.toUpperCase()}   reconciled=${b4.reconciliation.reconciled}   total=${b4.timing.total_ms}ms`);
      console.log(`    LLM path: ok=${b4.paths.llm.ok} usedFallback(Pro)=${b4.paths.llm.usedFallback} attempts=${b4.paths.llm.timing.attempts} ttft=${b4.paths.llm.timing.ttft_ms}ms total=${b4.paths.llm.timing.total_ms}ms${b4.paths.llm.error ? ` error=${b4.paths.llm.error}` : ""}`);
      console.log(`    sameQueryIntent=${b4.reconciliation.sameQueryIntent}`);
      for (const q of b4.reconciliation.perQuery) {
        console.log(`    · ${q.query_id}: reconciled=${q.reconciled} dims=${q.dimensionsMatch} metrics=${q.metricsMatch} overlap=${(q.rowKeyOverlap * 100).toFixed(0)}% mismatches=${q.valueMismatches} rows=${q.comparedRows}`);
      }
      if (b4.reconciliation.discrepancies.length) {
        console.log(`    discrepancies:`);
        for (const d of b4.reconciliation.discrepancies) console.log(`      - ${d}`);
      }
      console.log(`    chosen dataset: ${b4.dataset.length} query result(s), rows: ${b4.dataset.map((d) => d.rows.length).join(", ")}`);
      pass++;
    } catch (err) {
      fail++;
      console.log(`  ✗ error: ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${pass} ran / ${fail} errored (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
