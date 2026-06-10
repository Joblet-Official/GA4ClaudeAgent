/**
 * End-to-end smoke test: Brain 1 → Brain 2 → Brain 3.
 *
 * Each case asserts on the expected Brain 3 status (approved / default_applied /
 * needs_clarification). Brain 3's job is decision logic, so we test the
 * decision, not the exact wording.
 *
 * Run:
 *   npm run test:brain3
 *
 * Honors TEST_DELAY_MS — 3 LLM calls per case (B1 + B2 + B3) across three
 * providers, but Gemini has 1M TPM so it's never the bottleneck. Delay protects
 * Groq (B1) and Cerebras (B2).
 */
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps, Brain3ValidationError } from "@/brains/brain3_gaps";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";
import type { GapsStatus } from "@/schemas/gaps";

const b1Cfg = getClient("brain1");
const b2Cfg = getClient("brain2");
const b3Cfg = getClient("brain3");

interface Case {
  name: string;
  question: string;
  memory?: unknown;
  expect: {
    /** Set of acceptable statuses — the LLM has some judgment latitude. */
    acceptableStatuses: GapsStatus[];
    /** If status === needs_clarification, options must be non-empty. */
    requiresQuestion?: boolean;
  };
}

const CASES: Case[] = [
  {
    name: "clear request — should approve",
    question: "sessions by country for the last 7 days",
    expect: { acceptableStatuses: ["approved"] },
  },
  {
    // TIMELINE RULE (user decision): a missing time window is never defaulted —
    // Brain 3 must ask, exactly like an ambiguous metric.
    name: "no date specified — should ASK the timeline",
    question: "sessions by country",
    expect: { acceptableStatuses: ["needs_clarification"], requiresQuestion: true },
  },
  {
    name: "ambiguous metric 'engagement' — should ask",
    question: "how are we doing on engagement",
    expect: { acceptableStatuses: ["needs_clarification"], requiresQuestion: true },
  },
  {
    name: "ambiguous 'how are we doing' — should ask",
    question: "how are we doing",
    expect: { acceptableStatuses: ["needs_clarification"], requiresQuestion: true },
  },
  {
    name: "comparison with explicit windows — should approve",
    question: "compare sessions this week vs last week",
    expect: { acceptableStatuses: ["approved", "default_applied"] },
  },
  {
    name: "drill_down with explicit region — should approve",
    question: "for India, sessions and users by city last 30 days",
    expect: { acceptableStatuses: ["approved"] },
  },
];

function fmt(o: unknown): string {
  return JSON.stringify(o, null, 2);
}

async function main() {
  console.log(`Brain 1: ${b1Cfg.provider} / ${b1Cfg.model}`);
  console.log(`Brain 2: ${b2Cfg.provider} / ${b2Cfg.model}`);
  console.log(`Brain 3: ${b3Cfg.provider} / ${b3Cfg.model}`);
  const catalog = loadCatalog();
  console.log(`Catalog: ${catalog.dimensions.length} dims, ${catalog.metrics.length} metrics, ${catalog.events.length} events`);

  const delayMs = Number(process.env.TEST_DELAY_MS ?? 5000);
  const ttfts: number[] = [];
  const totals: number[] = [];
  let pass = 0;
  let fail = 0;

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.log("\n" + "=".repeat(70));
    console.log(`CASE: ${c.name}`);
    console.log(`  question: ${c.question}`);
    console.log(`  expected status: ${c.expect.acceptableStatuses.join(" | ")}`);

    try {
      const b1 = await runBrain1Intent({ question: c.question, memory: c.memory ?? null });
      console.log(`  brain1:  report_type=${b1.output.report_type}  flags=${JSON.stringify(b1.output.ambiguity_flags)}  ttft=${b1.timing.ttft_ms}ms total=${b1.timing.total_ms}ms`);

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
      console.log(`  brain2:  queries=${b2.output.queries.length}  ttft=${b2.timing.ttft_ms}ms total=${b2.timing.total_ms}ms`);

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const b3 = await runBrain3Gaps({ intent: b1.output, queries: b2.output.queries });
      console.log(`  brain3:  status=${b3.output.status}  ttft=${b3.timing.ttft_ms}ms total=${b3.timing.total_ms}ms attempts=${b3.timing.attempts}`);
      ttfts.push(b3.timing.ttft_ms);
      totals.push(b3.timing.total_ms);

      const notes: string[] = [];
      if (!c.expect.acceptableStatuses.includes(b3.output.status)) {
        notes.push(`status ${b3.output.status} not in acceptable set ${JSON.stringify(c.expect.acceptableStatuses)}`);
      }
      if (c.expect.requiresQuestion && (!b3.output.question_for_user || b3.output.question_for_user.length < 3)) {
        notes.push(`needs_clarification but question_for_user missing or empty`);
      }
      if (c.expect.requiresQuestion && (!b3.output.options || b3.output.options.length < 2)) {
        notes.push(`needs_clarification but options[] missing or too short`);
      }

      if (notes.length === 0) {
        console.log(`  ✓ pass`);
        if (b3.output.question_for_user) {
          console.log(`    Q: ${b3.output.question_for_user}`);
          if (b3.output.options) {
            for (const o of b3.output.options) console.log(`    · ${o.label} → ${o.value}`);
          }
        }
        if (b3.output.defaults_applied) {
          console.log(`    defaults: ${fmt(b3.output.defaults_applied)}`);
        }
        pass++;
      } else {
        console.log(`  ✗ assertion failures:`);
        for (const n of notes) console.log(`      - ${n}`);
        console.log(`    output:`);
        console.log(fmt(b3.output).split("\n").map((l) => "      " + l).join("\n"));
        fail++;
      }
    } catch (err) {
      fail++;
      if (err instanceof Brain3ValidationError) {
        console.log(`  ✗ Brain 3 validation failed twice`);
        console.log(`    timing: ttft=${err.timing.ttft_ms}ms total=${err.timing.total_ms}ms`);
        console.log(`    zod issues:`, fmt(err.zodIssues));
        console.log(`    raw output:`, err.rawOutput);
      } else {
        console.log(`  ✗ error:`, (err as Error).message);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  if (ttfts.length > 0) {
    const sortedT = [...ttfts].sort((a, b) => a - b);
    const sortedTot = [...totals].sort((a, b) => a - b);
    const p = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    console.log(`Brain 3 TTFT  — min ${sortedT[0]}ms   p50 ${p(sortedT,0.5)}ms   p95 ${p(sortedT,0.95)}ms   max ${sortedT[sortedT.length-1]}ms`);
    console.log(`Brain 3 TOTAL — min ${sortedTot[0]}ms   p50 ${p(sortedTot,0.5)}ms   p95 ${p(sortedTot,0.95)}ms   max ${sortedTot[sortedTot.length-1]}ms`);
  }
  console.log(`RESULT: ${pass} pass / ${fail} fail (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
