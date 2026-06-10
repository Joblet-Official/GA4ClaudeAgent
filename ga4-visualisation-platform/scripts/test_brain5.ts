/**
 * Brain 5 (Data Handling) tests.
 *
 * The core tests are DETERMINISTIC — they feed a synthetic Brain 4 dataset
 * through Brain 5's engine (defaultShaping / applyPlan / groundPlan) and assert
 * on the computed numbers. No LLM, no network, so they run locally regardless of
 * DeepSeek host status.
 *
 * Set BRAIN5_LLM=1 to additionally exercise the real LLM plan path (Brain 5
 * routes to DeepSeek Flash, which works on the current host).
 *
 * Run:
 *   npm run test:brain5
 *   BRAIN5_LLM=1 npm run test:brain5
 */
import type { Dataset } from "@/brains/brain4_dataaccess";
import {
  applyPlan,
  defaultShaping,
  groundPlan,
  runBrain5DataHandling,
  attachTrackingAvailability,
} from "@/brains/brain5_datahandling";
import { DataHandlingPlan } from "@/schemas/datahandling";
import type { Query } from "@/schemas/metrics";
import {
  analyzeTrackingAvailability,
  type TrackingRegistry,
} from "@/support/tracking/availability";

const dataset: Dataset = [
  {
    query_id: "q1",
    expected_shape: "categorical",
    dimensionHeaders: ["country"],
    metricHeaders: [
      { name: "sessions", type: "TYPE_INTEGER" },
      { name: "totalUsers", type: "TYPE_INTEGER" },
    ],
    rows: [
      { country: "India", sessions: 100, totalUsers: 80 },
      { country: "United States", sessions: 60, totalUsers: 50 },
      { country: "United Kingdom", sessions: 30, totalUsers: 25 },
      { country: "Germany", sessions: 10, totalUsers: 9 },
    ],
    rowCount: 4,
    metadata: { sampled: false, dataLossFromOtherRow: false },
  },
  {
    query_id: "q2",
    expected_shape: "categorical",
    dimensionHeaders: ["deviceCategory"],
    metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
    rows: [
      { deviceCategory: "mobile", sessions: 5 },
      { deviceCategory: "mobile", sessions: 7 },
      { deviceCategory: "desktop", sessions: 20 },
    ],
    rowCount: 3,
    metadata: { sampled: true, dataLossFromOtherRow: false },
  },
];

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

function findRow(rows: Array<Record<string, string | number>>, key: string, val: string) {
  return rows.find((r) => String(r[key]) === val);
}

async function main() {
  console.log("=".repeat(70));
  console.log("Brain 5 — deterministic engine tests");

  // 1. defaultShaping: one passthrough block per query.
  const def = defaultShaping(dataset);
  check("defaultShaping yields 2 blocks", def.blocks.length === 2);
  check("default block q1 is passthrough (4 rows)", def.blocks[0]!.rows.length === 4);
  check("default block q1 type=categorical", def.blocks[0]!.block_type === "categorical");
  check("default block q2 carries 'sampled' flag", def.blocks[1]!.flags.includes("sampled"));

  // 2. groundPlan: valid plan clean, invalid plan flagged.
  const validPlan = DataHandlingPlan.parse({
    blocks: [{ id: "b1", title: "Sessions by country", block_type: "breakdown", source_query_id: "q1", transform: { kind: "passthrough" } }],
  });
  check("groundPlan: valid plan has no issues", groundPlan(validPlan, dataset).length === 0);

  const badPlan = DataHandlingPlan.parse({
    blocks: [{ id: "b1", title: "x", block_type: "breakdown", source_query_id: "q1", transform: { kind: "aggregate_by", dimension: "country", metrics: ["clicks"] } }],
  });
  const badIssues = groundPlan(badPlan, dataset);
  check("groundPlan: flags unknown metric 'clicks'", badIssues.some((i) => i.problem.includes("clicks")));

  // 3. top_n + others rollup + derived ratio — verify computed numbers.
  const topPlan = DataHandlingPlan.parse({
    blocks: [
      {
        id: "b1",
        title: "Top countries",
        block_type: "breakdown",
        source_query_id: "q1",
        transform: { kind: "top_n", sort_metric: "sessions", n: 2, others_rollup: true },
        derived_metrics: [{ name: "usersPerSession", op: "ratio", operands: ["totalUsers", "sessions"] }],
      },
    ],
  });
  const topOut = applyPlan(topPlan, dataset);
  const topRows = topOut.blocks[0]!.rows;
  check("top_n yields 3 rows (top 2 + others)", topRows.length === 3);
  const others = findRow(topRows, "country", "(others)");
  check("(others) sessions = 40 (UK 30 + DE 10)", !!others && Number(others!.sessions) === 40, JSON.stringify(others));
  check("(others) totalUsers = 34 (25 + 9)", !!others && Number(others!.totalUsers) === 34);
  const india = findRow(topRows, "country", "India");
  check("derived usersPerSession(India) = 0.8", !!india && Math.abs(Number(india!.usersPerSession) - 0.8) < 1e-9, JSON.stringify(india));
  check("derived column present in block.columns", topOut.blocks[0]!.columns.includes("usersPerSession"));

  // 3b. NEW gold-standard engine: compare_by / temporal_compare / funnel.
  const cmpDataset: Dataset = [
    {
      query_id: "q1",
      expected_shape: "single_value",
      purpose: "confirm",
      dimensionHeaders: ["dateRange"],
      metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
      rows: [
        { dateRange: "current", sessions: 1177 },
        { dateRange: "baseline", sessions: 640 },
      ],
      rowCount: 2,
      metadata: { sampled: false, dataLossFromOtherRow: false },
    },
    {
      query_id: "q2",
      expected_shape: "categorical",
      purpose: "breakdown",
      dimensionHeaders: ["dateRange", "country"],
      metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
      rows: [
        { dateRange: "baseline", country: "India", sessions: 420 },
        { dateRange: "current", country: "India", sessions: 337 },
        { dateRange: "current", country: "South Africa", sessions: 35 },
        { dateRange: "baseline", country: "Spain", sessions: 12 },
      ],
      rowCount: 4,
      metadata: { sampled: false, dataLossFromOtherRow: false },
    },
    {
      query_id: "q3",
      expected_shape: "timeseries",
      purpose: "temporal",
      dimensionHeaders: ["dateRange", "date"],
      metricHeaders: [{ name: "sessions", type: "TYPE_INTEGER" }],
      rows: [
        { dateRange: "baseline", date: "20260401", sessions: 4 },
        { dateRange: "current", date: "20260501", sessions: 153 },
        { dateRange: "baseline", date: "20260402", sessions: 10 },
        { dateRange: "current", date: "20260502", sessions: 237 },
      ],
      rowCount: 4,
      metadata: { sampled: false, dataLossFromOtherRow: false },
    },
    {
      query_id: "q4",
      expected_shape: "categorical",
      purpose: "funnel",
      dimensionHeaders: ["dateRange", "eventName"],
      metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
      rows: [
        { dateRange: "baseline", eventName: "session_start", eventCount: 640 },
        { dateRange: "current", eventName: "session_start", eventCount: 1182 },
        { dateRange: "baseline", eventName: "page_view", eventCount: 1880 },
        { dateRange: "current", eventName: "page_view", eventCount: 3805 },
        { dateRange: "baseline", eventName: "view_search_results", eventCount: 52 },
        { dateRange: "current", eventName: "view_search_results", eventCount: 66 },
      ],
      rowCount: 6,
      metadata: { sampled: false, dataLossFromOtherRow: false },
    },
  ];
  const gold = defaultShaping(cmpDataset);
  const confirmBlk = gold.blocks[0]!;
  check("confirm → comparison block", confirmBlk.block_type === "comparison" && !!confirmBlk.meta?.comparison);
  const cRow = confirmBlk.rows[0]!;
  check("confirm delta_abs = 537", Number(cRow.delta_abs) === 537, JSON.stringify(cRow));
  check("confirm delta_pct ≈ 83.91", Math.abs(Number(cRow.delta_pct) - 83.91) < 0.01);

  const brkBlk = gold.blocks[1]!;
  const indiaCmp = brkBlk.rows.find((r) => r.country === "India");
  const sa = brkBlk.rows.find((r) => r.country === "South Africa");
  const spain = brkBlk.rows.find((r) => r.country === "Spain");
  check("breakdown India Δ = −83, membership both", !!indiaCmp && Number(indiaCmp.delta_abs) === -83 && indiaCmp.membership === "both", JSON.stringify(indiaCmp));
  check("breakdown South Africa membership = new", !!sa && sa.membership === "new");
  check("breakdown Spain membership = disappeared", !!spain && spain.membership === "disappeared");

  const tmpBlk = gold.blocks[2]!;
  check("temporal block aligned by day", tmpBlk.block_type === "temporal" && tmpBlk.rows.length === 2 && Number(tmpBlk.rows[0]!.baseline) === 4 && Number(tmpBlk.rows[0]!.current) === 153, JSON.stringify(tmpBlk.rows));

  const funBlk = gold.blocks[3]!;
  check("funnel block ordered steps", funBlk.block_type === "funnel" && String(funBlk.rows[0]!.step) === "session_start" && String(funBlk.rows[2]!.step) === "view_search_results");
  const trans = funBlk.meta?.funnel?.transitions ?? [];
  const vsr = trans.find((t) => t.label.startsWith("view_search_results"));
  check("funnel rate view_search_results/page_view ≈ 0.0277 → 0.0173", !!vsr && Math.abs(vsr.baseline_rate - 0.0277) < 0.001 && Math.abs(vsr.current_rate - 0.0173) < 0.001, JSON.stringify(vsr));
  check("a most-moved step is flagged", trans.some((t) => t.most_moved));

  // 4. aggregate_by collapses duplicate dimension values.
  const aggPlan = DataHandlingPlan.parse({
    blocks: [
      {
        id: "b1",
        title: "Sessions by device",
        block_type: "categorical",
        source_query_id: "q2",
        transform: { kind: "aggregate_by", dimension: "deviceCategory", metrics: ["sessions"] },
      },
    ],
  });
  const aggOut = applyPlan(aggPlan, dataset);
  const mobile = findRow(aggOut.blocks[0]!.rows, "deviceCategory", "mobile");
  check("aggregate_by sums mobile sessions = 12 (5 + 7)", !!mobile && Number(mobile!.sessions) === 12, JSON.stringify(mobile));
  check("aggregate_by yields 2 device rows", aggOut.blocks[0]!.rows.length === 2);

  // 5. Tracking availability — three-state analysis with a synthetic registry.
  const registry: TrackingRegistry = {
    schema_version: 1,
    generated_at: "2026-06-10",
    limitations: [],
    tags: [
      {
        tag_name: "GA4 - Blog Scroll",
        tag_type: "gaawe",
        events: ["blog_scroll_60"],
        availability: {
          deployed_on: "2026-03-15",
          deployed_on_precision: "exact",
          first_observed: "2026-03-15",
          deactivated_on: "2026-05-10",
          deactivated_on_precision: "exact",
          last_observed: "2026-05-10",
          provenance: "manual",
        },
        ownership: { owner: null, team: null, contact: null },
        deployment_notes: [],
        change_history: [],
      },
      {
        tag_name: "Share Open",
        tag_type: "gaawe",
        events: ["share_open"],
        availability: {
          deployed_on: null,
          deployed_on_precision: "unknown",
          first_observed: "2026-05-11",
          deactivated_on: null,
          deactivated_on_precision: "unknown",
          last_observed: "2026-05-20",
          provenance: "gtm_snapshot",
        },
        ownership: { owner: null, team: null, contact: null },
        deployment_notes: [],
        change_history: [],
      },
    ],
  };
  const availQueries: Query[] = [
    {
      id: "q1",
      expected_shape: "categorical",
      request_body: {
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dateRanges: [{ startDate: "2026-01-01", endDate: "2026-06-30" }],
        dimensionFilter: {
          filter: { fieldName: "eventName", inListFilter: { values: ["blog_scroll_60", "session_start"] } },
        },
      },
    },
    {
      id: "q2",
      expected_shape: "single_value",
      request_body: {
        dimensions: [],
        metrics: [{ name: "eventCount" }],
        dateRanges: [{ startDate: "2026-04-01", endDate: "2026-04-30" }],
        dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "share_open" } } },
      },
    },
    {
      id: "q3",
      expected_shape: "single_value",
      request_body: {
        dimensions: [],
        metrics: [{ name: "sessions" }],
        dateRanges: [{ startDate: "2026-01-01", endDate: "2026-06-30" }],
      },
    },
  ];
  const anns = analyzeTrackingAvailability(availQueries, registry);
  check("availability: q1 'before deployed' definitive finding (user-example wording)",
    anns.some((a) => a.message === 'Data before 2026-03-15 is unavailable because tag "GA4 - Blog Scroll" had not yet been deployed.'),
    JSON.stringify(anns.map((a) => a.message)));
  check("availability: q1 'after deactivated' definitive finding",
    anns.some((a) => a.message === 'Data after 2026-05-10 is unavailable because tag "GA4 - Blog Scroll" was no longer active.'));
  check("availability: q2 unverified (no known deployment date, range before first_observed)",
    anns.some((a) => a.status === "unverified" && a.tag_name === "Share Open" && a.message.includes("cannot be verified")));
  check("availability: built-in event (session_start) produces no annotation",
    !anns.some((a) => a.events.includes("session_start")));
  check("availability: q3 (no event reference) produces no annotation",
    !anns.some((a) => a.query_ids.includes("q3")));
  check("availability: not_covered sorted before unverified",
    anns.length >= 2 && anns[0]!.status === "not_covered" && anns[anns.length - 1]!.status === "unverified");

  // 6. attachTrackingAvailability — flags + notes land on affected blocks only.
  const availDataset: Dataset = availQueries.map((q) => ({
    query_id: q.id,
    expected_shape: q.expected_shape,
    dimensionHeaders: q.request_body.dimensions.map((d) => d.name),
    metricHeaders: q.request_body.metrics.map((m) => ({ name: m.name, type: "TYPE_INTEGER" })),
    rows: [],
    rowCount: 0,
    metadata: { sampled: false, dataLossFromOtherRow: false },
  }));
  const shaped = attachTrackingAvailability(defaultShaping(availDataset), availQueries, registry);
  const b1blk = shaped.blocks.find((b) => b.source_query_ids.includes("q1"))!;
  const b2blk = shaped.blocks.find((b) => b.source_query_ids.includes("q2"))!;
  const b3blk = shaped.blocks.find((b) => b.source_query_ids.includes("q3"))!;
  check("attach: q1 block flagged tracking_unavailable_partial", b1blk.flags.includes("tracking_unavailable_partial"));
  check("attach: q1 block carries the templated note", b1blk.notes.some((n) => n.includes("had not yet been deployed")));
  check("attach: q2 block flagged tracking_unverified", b2blk.flags.includes("tracking_unverified"));
  check("attach: q3 block untouched", !b3blk.flags.some((f) => f.startsWith("tracking_")) && b3blk.notes.length === 0);
  check("attach: top-level availability array present", (shaped.availability?.length ?? 0) >= 3);

  console.log("\n" + "-".repeat(70));
  console.log(`Deterministic engine: ${pass} pass / ${fail} fail`);

  // 5. Optional: real LLM plan path (DeepSeek Flash) — only with BRAIN5_LLM=1.
  if (process.env.BRAIN5_LLM === "1") {
    console.log("\n" + "=".repeat(70));
    console.log("Brain 5 — LLM plan path (DeepSeek Flash)");
    try {
      const r = await runBrain5DataHandling({ dataset });
      console.log(`  source=${r.source} usedFallback(Pro)=${r.llm.usedFallback} blocks=${r.output.blocks.length} ttft=${r.llm.timing.ttft_ms}ms total=${r.timing.total_ms}ms`);
      for (const b of r.output.blocks) {
        console.log(`    · ${b.id} [${b.block_type}] "${b.title}" rows=${b.rows.length} cols=[${b.columns.join(", ")}] flags=[${b.flags.join(",")}]`);
      }
      check("LLM path produced >=1 block", r.output.blocks.length >= 1);
    } catch (err) {
      check("LLM path ran", false, (err as Error).message);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
