/**
 * Local smoke test for Brain 1.
 *
 * Run:
 *   npm run test:brain1
 *
 * Calls Brain 1 with ~8 representative GA4 questions covering every
 * report_type and a follow-up case. Prints the structured output, TTFT,
 * total time, and a pass/fail mark vs the expected report_type.
 */
import { runBrain1Intent, BrainValidationError } from "@/brains/brain1_intent";
import { getClient } from "@/lib/nvidia";
import type { ReportType } from "@/schemas/intent";

const { provider: PROVIDER, model: MODEL } = getClient("brain1");

interface Case {
  name: string;
  question: string;
  memory?: unknown;
  expected_report_type: ReportType;
}

const CASES: Case[] = [
  { name: "single_metric — yesterday's sessions", question: "how many sessions did we get yesterday", memory: null, expected_report_type: "single_metric" },
  { name: "regional_breakdown — sessions by country last week", question: "sessions by country last week", memory: null, expected_report_type: "regional_breakdown" },
  { name: "weekly_summary — weekly sessions and applies by region", question: "weekly sessions and applies by region for the last 6 weeks", memory: null, expected_report_type: "weekly_summary" },
  { name: "time_series — daily sessions last 30 days", question: "show daily sessions over the last 30 days", memory: null, expected_report_type: "time_series" },
  { name: "comparison — this week vs last week", question: "compare sessions this week vs last week", memory: null, expected_report_type: "comparison" },
  { name: "drill_down — country to city", question: "for India, drill down by city showing sessions and users", memory: null, expected_report_type: "drill_down" },
  {
    name: "followup — break down by country", question: "now break that down by country",
    memory: { last_report_type: "weekly_summary", last_scope: { dateRange: "last_30_days", regions: [], filters_hint: [] }, last_questions: ["weekly sessions and applies for the last 30 days"] },
    expected_report_type: "regional_breakdown",
  },
  { name: "ambiguous — vague 'how are we doing'", question: "how are we doing on engagement", memory: null, expected_report_type: "single_metric" },
];

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2);
}

async function main() {
  console.log(`Provider: ${PROVIDER}    Model: ${MODEL}`);
  const ttfts: number[] = [];
  const totals: number[] = [];
  let pass = 0;
  let fail = 0;

  // Inter-case delay (ms). The smoke test runs 8 cases in a burst; on free-tier
  // providers with low TPM (e.g. Groq free = 12k TPM) that's enough to trip 429s.
  // Override with TEST_DELAY_MS=0 for fast runs on Dev tier.
  const delayMs = Number(process.env.TEST_DELAY_MS ?? 8000);

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    console.log("\n" + "=".repeat(70));
    console.log(`CASE: ${c.name}`);
    console.log(`  question: ${c.question}`);
    console.log(`  expected: ${c.expected_report_type}`);

    try {
      const { output, timing } = await runBrain1Intent({
        question: c.question,
        memory: c.memory ?? null,
      });
      const match = output.report_type === c.expected_report_type;
      console.log(`  got:      ${output.report_type}  ${match ? "✓" : "✗"}`);
      console.log(`  timing:   ttft=${timing.ttft_ms}ms total=${timing.total_ms}ms attempts=${timing.attempts}`);
      console.log("  output:");
      console.log(fmt(output).split("\n").map((l) => "    " + l).join("\n"));
      ttfts.push(timing.ttft_ms);
      totals.push(timing.total_ms);
      if (match) pass++;
      else fail++;
    } catch (err) {
      fail++;
      if (err instanceof BrainValidationError) {
        console.log("  ✗ schema validation failed twice");
        console.log(`  timing:   ttft=${err.timing.ttft_ms}ms total=${err.timing.total_ms}ms attempts=${err.timing.attempts}`);
        console.log("  raw output:", err.rawOutput);
        console.log("  zod issues:", fmt(err.zodIssues));
      } else {
        console.log("  ✗ error:", (err as Error).message);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  if (ttfts.length > 0) {
    const sortedT = [...ttfts].sort((a, b) => a - b);
    const sortedTot = [...totals].sort((a, b) => a - b);
    const p = (arr: number[], q: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
    console.log(`TTFT  — min ${sortedT[0]}ms   p50 ${p(sortedT,0.5)}ms   p95 ${p(sortedT,0.95)}ms   max ${sortedT[sortedT.length-1]}ms`);
    console.log(`TOTAL — min ${sortedTot[0]}ms   p50 ${p(sortedTot,0.5)}ms   p95 ${p(sortedTot,0.95)}ms   max ${sortedTot[sortedTot.length-1]}ms`);
  }
  console.log(`RESULT: ${pass} pass / ${fail} fail (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
