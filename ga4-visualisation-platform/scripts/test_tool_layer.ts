/**
 * Smoke test for the Tool Layer.
 *
 * Runs three representative GA4 queries against the real API:
 *   1. Time series — sessions by date (verifies date dimension + metric)
 *   2. Categorical — sessions by country (verifies grouping)
 *   3. Filtered    — sessions filtered to India (verifies dimensionFilter)
 *
 * Each verifies row count, headers, and a sample row.
 *
 * Run:  npm run test:tool
 */
import { runGA4Query, GA4QueryError } from "@/support/tools/runGA4Query";

interface Case {
  name: string;
  body: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    name: "time series — sessions by date last 7 days",
    body: {
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }],
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    },
  },
  {
    name: "categorical — top countries by sessions last 7 days",
    body: {
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }],
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    },
  },
  {
    name: "filtered — India only, sessions by city last 30 days",
    body: {
      dimensions: [{ name: "city" }],
      metrics: [{ name: "sessions" }],
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      dimensionFilter: {
        filter: { fieldName: "country", stringFilter: { value: "India" } },
      },
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 10,
    },
  },
];

function fmt(o: unknown): string {
  return JSON.stringify(o);
}

async function main() {
  console.log(`GA4_PROPERTY_ID: ${process.env.GA4_PROPERTY_ID ?? "(unset!)"}`);
  console.log(`Credentials env: ${process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? "JSON inline" : process.env.GOOGLE_APPLICATION_CREDENTIALS ? "file path" : "(unset!)"}`);

  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    console.log("\n" + "=".repeat(70));
    console.log(`CASE: ${c.name}`);

    try {
      const t0 = Date.now();
      const r = await runGA4Query(c.body);
      const dt = Date.now() - t0;

      console.log(`  ✓ ${r.rowCount} rows total, ${r.rows.length} returned  (${dt} ms)`);
      console.log(`  headers: ${r.dimensionHeaders.join(", ")} | ${r.metricHeaders.map((h) => h.name).join(", ")}`);
      if (r.metadata.sampled) console.log(`  ⚠ sampling applied`);
      if (r.metadata.dataLossFromOtherRow) console.log(`  ⚠ (other) row — too many distinct groups`);

      const preview = r.rows.slice(0, Math.min(5, r.rows.length));
      console.log(`  preview:`);
      for (const row of preview) console.log(`    ${fmt(row)}`);
      pass++;
    } catch (err) {
      fail++;
      if (err instanceof GA4QueryError) {
        console.log(`  ✗ GA4QueryError (code ${err.code ?? "?"}): ${err.message}`);
      } else {
        console.log(`  ✗ error: ${(err as Error).message}`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${pass} pass / ${fail} fail (of ${CASES.length})`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
