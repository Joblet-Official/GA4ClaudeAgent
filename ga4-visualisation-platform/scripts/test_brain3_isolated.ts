/**
 * Brain 3 isolated test — hand-crafted intent + queries.
 *
 * Useful when Brain 1 (Groq) is rate-limited and we still want to validate
 * Brain 3's decision logic. No Brain 1 or Brain 2 calls.
 *
 * Run:  npx tsx --env-file=.env.local scripts/test_brain3_isolated.ts
 */
import { runBrain3Gaps, Brain3ValidationError } from "@/brains/brain3_gaps";
import { getClient } from "@/lib/nvidia";
import type { IntentOutput } from "@/schemas/intent";
import type { Query } from "@/schemas/metrics";
import type { GapsStatus } from "@/schemas/gaps";

const b3Cfg = getClient("brain3");

interface Case {
  name: string;
  intent: IntentOutput;
  queries: Query[];
  expectedStatuses: GapsStatus[];
}

const CASES: Case[] = [
  {
    name: "clear request — approve",
    intent: {
      report_type: "regional_breakdown",
      sub_questions: [{ id: "q1", natural_language: "sessions by country last 7 days", kind: "primary" }],
      scope: { dateRange: "last_7_days", regions: [], filters_hint: [] },
      is_followup: false,
      ambiguity_flags: [],
    },
    queries: [
      {
        id: "q1",
        request_body: {
          dimensions: [{ name: "country" }],
          metrics: [{ name: "sessions" }],
          dateRanges: [{ startDate: "2026-05-13", endDate: "2026-05-20" }],
        },
        expected_shape: "categorical",
      },
    ],
    expectedStatuses: ["approved"],
  },
  {
    name: "no date — default applied",
    intent: {
      report_type: "regional_breakdown",
      sub_questions: [{ id: "q1", natural_language: "sessions by country", kind: "primary" }],
      scope: { dateRange: null, regions: [], filters_hint: [] },
      is_followup: false,
      ambiguity_flags: ["no date window"],
    },
    queries: [
      {
        id: "q1",
        request_body: {
          dimensions: [{ name: "country" }],
          metrics: [{ name: "sessions" }],
          dateRanges: [{ startDate: "2026-04-20", endDate: "2026-05-20" }],
        },
        expected_shape: "categorical",
      },
    ],
    expectedStatuses: ["default_applied", "approved"],
  },
  {
    name: "ambiguous engagement — ask user",
    intent: {
      report_type: "single_metric",
      sub_questions: [{ id: "q1", natural_language: "engagement", kind: "primary" }],
      scope: { dateRange: null, regions: null, filters_hint: [] },
      is_followup: false,
      ambiguity_flags: [
        "metric 'engagement' could mean engaged sessions or engagement rate",
        "no date window",
      ],
    },
    queries: [
      {
        id: "q1",
        request_body: {
          dimensions: [],
          metrics: [{ name: "engagedSessions" }],
          dateRanges: [{ startDate: "2026-04-20", endDate: "2026-05-20" }],
        },
        expected_shape: "single_value",
      },
    ],
    expectedStatuses: ["needs_clarification"],
  },
  {
    name: "vague how-are-we-doing — ask or default",
    intent: {
      report_type: "single_metric",
      sub_questions: [{ id: "q1", natural_language: "performance", kind: "primary" }],
      scope: { dateRange: null, regions: null, filters_hint: [] },
      is_followup: false,
      ambiguity_flags: [
        "no specific metric specified",
        "no date window",
        "unclear what 'doing' refers to",
      ],
    },
    queries: [
      {
        id: "q1",
        request_body: {
          dimensions: [],
          metrics: [{ name: "sessions" }],
          dateRanges: [{ startDate: "2026-04-20", endDate: "2026-05-20" }],
        },
        expected_shape: "single_value",
      },
    ],
    // Either "ask the user what they meant" OR "default to sessions/30d" is
    // a defensible outcome for a very vague question — both follow the prompt
    // rules. We accept either.
    expectedStatuses: ["needs_clarification", "default_applied"],
  },
  {
    name: "comparison with explicit windows — approve",
    intent: {
      report_type: "comparison",
      sub_questions: [{ id: "q1", natural_language: "sessions this week vs last week", kind: "primary" }],
      scope: { dateRange: null, regions: null, filters_hint: [] },
      is_followup: false,
      ambiguity_flags: [],
    },
    queries: [
      {
        id: "q1",
        request_body: {
          dimensions: [],
          metrics: [{ name: "sessions" }],
          dateRanges: [
            { startDate: "2026-05-18", endDate: "2026-05-20", name: "current" },
            { startDate: "2026-05-11", endDate: "2026-05-17", name: "previous" },
          ],
        },
        expected_shape: "categorical",
      },
    ],
    expectedStatuses: ["approved", "default_applied"],
  },
];

function fmt(o: unknown): string {
  return JSON.stringify(o, null, 2);
}

async function main() {
  console.log(`Brain 3: ${b3Cfg.provider} / ${b3Cfg.model}`);
  const ttfts: number[] = [];
  const totals: number[] = [];
  let pass = 0;
  let fail = 0;

  const delayMs = Number(process.env.TEST_DELAY_MS ?? 3000);
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]!;
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    console.log("\n" + "=".repeat(70));
    console.log(`CASE: ${c.name}`);
    console.log(`  expected: ${c.expectedStatuses.join(" | ")}`);

    try {
      const r = await runBrain3Gaps({ intent: c.intent, queries: c.queries });
      console.log(`  status:   ${r.output.status}  ttft=${r.timing.ttft_ms}ms total=${r.timing.total_ms}ms attempts=${r.timing.attempts}`);
      ttfts.push(r.timing.ttft_ms);
      totals.push(r.timing.total_ms);

      const ok = c.expectedStatuses.includes(r.output.status);
      if (ok) {
        console.log(`  ✓ pass`);
        if (r.output.question_for_user) console.log(`    Q: ${r.output.question_for_user}`);
        if (r.output.options) for (const o of r.output.options) console.log(`    · ${o.label} → ${o.value}`);
        if (r.output.defaults_applied) console.log(`    defaults: ${fmt(r.output.defaults_applied)}`);
        pass++;
      } else {
        console.log(`  ✗ status ${r.output.status} not in ${JSON.stringify(c.expectedStatuses)}`);
        console.log(fmt(r.output).split("\n").map((l) => "      " + l).join("\n"));
        fail++;
      }
    } catch (err) {
      fail++;
      if (err instanceof Brain3ValidationError) {
        console.log(`  ✗ validation failed`);
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
    console.log(`TTFT  — min ${sortedT[0]}ms   p50 ${p(sortedT,0.5)}ms   p95 ${p(sortedT,0.95)}ms`);
    console.log(`TOTAL — min ${sortedTot[0]}ms   p50 ${p(sortedTot,0.5)}ms   p95 ${p(sortedTot,0.95)}ms`);
  }
  console.log(`RESULT: ${pass} pass / ${fail} fail (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
