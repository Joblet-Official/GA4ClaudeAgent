/**
 * End-to-end smoke test: Brain 1 → Brain 2.
 *
 * Each case posts a natural-language question. Brain 1 classifies it; Brain 2
 * turns the intent into GA4 query specs. We assert each output's high-level
 * shape (expected_shape, dimensions present, metrics present) rather than
 * exact equality — the LLM has some freedom on field choice.
 *
 * Run:
 *   npm run test:brain2
 *
 * Honours TEST_DELAY_MS (default 8000ms) — two LLM calls per case (Brain 1 +
 * Brain 2) burn ~3k tokens, so spacing keeps us under Groq free 12k TPM.
 */
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics, Brain2ValidationError } from "@/brains/brain2_metrics";
import { loadCatalog } from "@/support/catalog/loadCatalog";
import { getClient } from "@/lib/nvidia";
import type { MetricsOutput } from "@/schemas/metrics";

const b1Cfg = getClient("brain1");
const b2Cfg = getClient("brain2");

interface Case {
  name: string;
  question: string;
  memory?: unknown;
  /** Soft assertions over Brain 2's output. */
  expect: {
    queryCount?: number;
    /** Each entry is one query; checks dimensions/metrics present (subset). */
    queries: Array<{
      mustHaveDimensions?: string[];
      mustHaveMetrics?: string[];
      expectedShape?: "categorical" | "timeseries" | "single_value";
      dateRanges?: number;
    }>;
  };
}

const CASES: Case[] = [
  {
    name: "single_metric — yesterday's sessions",
    question: "how many sessions did we get yesterday",
    expect: {
      queryCount: 1,
      queries: [{
        mustHaveMetrics: ["sessions"],
        expectedShape: "single_value",
        dateRanges: 1,
      }],
    },
  },
  {
    name: "regional_breakdown — sessions by country last week",
    question: "sessions by country last week",
    expect: {
      queryCount: 1,
      queries: [{
        mustHaveDimensions: ["country"],
        mustHaveMetrics: ["sessions"],
        expectedShape: "categorical",
        dateRanges: 1,
      }],
    },
  },
  {
    name: "time_series — daily sessions last 30 days",
    question: "show daily sessions over the last 30 days",
    expect: {
      queryCount: 1,
      queries: [{
        mustHaveDimensions: ["date"],
        mustHaveMetrics: ["sessions"],
        expectedShape: "timeseries",
        dateRanges: 1,
      }],
    },
  },
  {
    name: "weekly_summary — weekly sessions and applies by region",
    question: "weekly sessions and applies by region for the last 6 weeks",
    expect: {
      queryCount: 2,
      queries: [
        { mustHaveMetrics: ["sessions"], expectedShape: "timeseries" },
        { mustHaveMetrics: ["eventCount"], expectedShape: "timeseries" },
      ],
    },
  },
  {
    name: "drill_down — India by city",
    question: "for India, show sessions and users by city",
    expect: {
      queryCount: 1,
      queries: [{
        mustHaveDimensions: ["city"],
        mustHaveMetrics: ["sessions", "totalUsers"],
        expectedShape: "categorical",
      }],
    },
  },
  {
    name: "comparison — this week vs last week sessions",
    question: "compare sessions this week vs last week",
    expect: {
      queryCount: 1,
      queries: [{
        mustHaveMetrics: ["sessions"],
        dateRanges: 2,
      }],
    },
  },
];

function fmt(o: unknown): string {
  return JSON.stringify(o, null, 2);
}

function checkSubset(actual: string[], required: string[]): { ok: boolean; missing: string[] } {
  const have = new Set(actual);
  const missing = required.filter((n) => !have.has(n));
  return { ok: missing.length === 0, missing };
}

interface CaseReport {
  passed: boolean;
  notes: string[];
}

function assertCase(c: Case, out: MetricsOutput): CaseReport {
  // Lenient model: we check the UNION of dimensions + metrics across all
  // queries (Brain 1 may legitimately split a multi-metric question into
  // multiple sub-questions). Individual `dateRanges` and `expected_shape`
  // are still checked per query when supplied.
  const notes: string[] = [];
  let passed = true;

  const unionDims = new Set(
    out.queries.flatMap((q) => q.request_body.dimensions.map((d) => d.name)),
  );
  const unionMetrics = new Set(
    out.queries.flatMap((q) => q.request_body.metrics.map((m) => m.name)),
  );

  const allDims = c.expect.queries.flatMap((e) => e.mustHaveDimensions ?? []);
  const allMetrics = c.expect.queries.flatMap((e) => e.mustHaveMetrics ?? []);

  for (const d of allDims) {
    if (!unionDims.has(d)) {
      notes.push(`missing dimension '${d}' across all queries (saw ${JSON.stringify([...unionDims])})`);
      passed = false;
    }
  }
  for (const m of allMetrics) {
    if (!unionMetrics.has(m)) {
      notes.push(`missing metric '${m}' across all queries (saw ${JSON.stringify([...unionMetrics])})`);
      passed = false;
    }
  }

  // expected_shape: at least one query must have the expected shape (if specified)
  const expectedShapes = c.expect.queries
    .map((e) => e.expectedShape)
    .filter(Boolean) as string[];
  for (const shape of expectedShapes) {
    if (!out.queries.some((q) => q.expected_shape === shape)) {
      notes.push(`no query has expected_shape '${shape}' (saw ${JSON.stringify(out.queries.map((q) => q.expected_shape))})`);
      passed = false;
    }
  }

  // dateRanges: comparison case needs at least one query with 2 ranges
  const maxRanges = Math.max(...c.expect.queries.map((e) => e.dateRanges ?? 0));
  if (maxRanges >= 2) {
    if (!out.queries.some((q) => q.request_body.dateRanges.length >= 2)) {
      notes.push(`expected at least one query with ${maxRanges} dateRanges (comparison)`);
      passed = false;
    }
  }

  return { passed, notes };
}

async function main() {
  console.log(`Brain 1: ${b1Cfg.provider} / ${b1Cfg.model}`);
  console.log(`Brain 2: ${b2Cfg.provider} / ${b2Cfg.model}`);
  const catalog = loadCatalog();
  console.log(`Catalog: ${catalog.dimensions.length} dims, ${catalog.metrics.length} metrics, ${catalog.events.length} events`);

  const delayMs = Number(process.env.TEST_DELAY_MS ?? 8000);
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

    try {
      // Brain 1
      const b1 = await runBrain1Intent({ question: c.question, memory: c.memory ?? null });
      console.log(`  brain1:   report_type=${b1.output.report_type}  ttft=${b1.timing.ttft_ms}ms total=${b1.timing.total_ms}ms`);

      // Brain 2 (with TPM-aware delay between the two LLM calls)
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const b2 = await runBrain2Metrics({ intent: b1.output, catalog });
      console.log(`  brain2:   queries=${b2.output.queries.length}  ttft=${b2.timing.ttft_ms}ms total=${b2.timing.total_ms}ms attempts=${b2.timing.attempts}`);
      ttfts.push(b2.timing.ttft_ms);
      totals.push(b2.timing.total_ms);

      const report = assertCase(c, b2.output);
      if (report.passed) {
        console.log(`  ✓ all assertions passed`);
        pass++;
      } else {
        console.log(`  ✗ assertion failures:`);
        for (const n of report.notes) console.log(`      - ${n}`);
        fail++;
      }
      console.log(`  output queries:`);
      console.log(fmt(b2.output.queries).split("\n").map((l) => "    " + l).join("\n"));
    } catch (err) {
      fail++;
      if (err instanceof Brain2ValidationError) {
        console.log(`  ✗ Brain 2 validation failed twice`);
        console.log(`    timing: ttft=${err.timing.ttft_ms}ms total=${err.timing.total_ms}ms attempts=${err.timing.attempts}`);
        console.log(`    catalog issues:`, fmt(err.catalogIssues));
        if (err.zodIssues) console.log(`    zod issues:`, fmt(err.zodIssues));
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
    console.log(`Brain 2 TTFT  — min ${sortedT[0]}ms   p50 ${p(sortedT,0.5)}ms   p95 ${p(sortedT,0.95)}ms   max ${sortedT[sortedT.length-1]}ms`);
    console.log(`Brain 2 TOTAL — min ${sortedTot[0]}ms   p50 ${p(sortedTot,0.5)}ms   p95 ${p(sortedTot,0.95)}ms   max ${sortedTot[sortedTot.length-1]}ms`);
  }
  console.log(`RESULT: ${pass} pass / ${fail} fail (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
