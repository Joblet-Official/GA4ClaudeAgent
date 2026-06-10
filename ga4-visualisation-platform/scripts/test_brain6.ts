/**
 * Brain 6 (Visualisation / Reporting) tests.
 *
 * Core tests are DETERMINISTIC — synthetic Brain 5 data_blocks → defaultSpec →
 * renderReport → assert the real values appear in the HTML, and writeReport
 * produces a file. No LLM, no network.
 *
 * Set BRAIN6_LLM=1 to additionally exercise the real LLM spec path (Brain 6
 * routes to DeepSeek Pro, which currently hits the documented host reset — the
 * deterministic default spec then renders the report anyway).
 *
 * Run:
 *   npm run test:brain6
 *   BRAIN6_LLM=1 npm run test:brain6
 */
import path from "path";
import { promises as fs } from "fs";
import type { DataBlocksOutput } from "@/schemas/datahandling";
import { defaultSpec, renderReport, groundSpec, runBrain6Report, writeReport } from "@/brains/brain6_visualisation";
import { ReportSpec } from "@/schemas/visualisation";

const blocks: DataBlocksOutput = {
  blocks: [
    {
      id: "b1",
      title: "Sessions by country",
      block_type: "categorical",
      source_query_ids: ["q1"],
      columns: ["country", "sessions"],
      rows: [
        { country: "India", sessions: 100 },
        { country: "United States", sessions: 60 },
        { country: "(others)", sessions: 40 },
      ],
      derived_metric_names: [],
      flags: ["sampled"],
      notes: [],
    },
    {
      id: "b2",
      title: "Sessions over time",
      block_type: "timeseries",
      source_query_ids: ["q2"],
      columns: ["date", "sessions"],
      rows: [
        { date: "20260601", sessions: 10 },
        { date: "20260602", sessions: 20 },
        { date: "20260603", sessions: 15 },
      ],
      derived_metric_names: [],
      flags: [],
      notes: [],
    },
  ],
  summary_notes: ["Generated from synthetic data."],
};

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

async function main() {
  console.log("=".repeat(70));
  console.log("Brain 6 — deterministic renderer tests");

  // 1. defaultSpec auto-picks components.
  const spec = defaultSpec(blocks, "Test Report");
  check("defaultSpec yields 2 sections", spec.sections.length === 2);
  check("b1 -> bar_chart", spec.sections[0]!.blocks[0]!.component === "bar_chart");
  check("b2 -> line_chart", spec.sections[1]!.blocks[0]!.component === "line_chart");

  // 2. groundSpec catches unknown block ids.
  const bad = ReportSpec.parse({
    title: "x",
    sections: [{ id: "s1", heading: "h", blocks: [{ block_id: "nope", component: "table" }] }],
  });
  check("groundSpec flags unknown block id", groundSpec(bad, blocks).some((i) => i.problem.includes("nope")));

  // 3. renderReport puts REAL values (from blocks) into the HTML.
  const html = renderReport(spec, blocks, "2026-06-10 15:30");
  check("html contains title", html.includes("Test Report"));
  check("html contains dimension value 'India'", html.includes("India"));
  check("html contains metric value '100'", html.includes(">100<") || html.includes("100"));
  check("html contains '(others)' row", html.includes("(others)"));
  check("html renders a line chart (svg)", html.includes("<svg") && html.includes("polyline"));
  check("html renders bar rects (svg bars)", /<rect [^>]*fill="#2E5C8A"/.test(html));
  check("html surfaces 'sampled' flag chip", html.includes("sampled"));
  check("html is self-contained (inline style, no external src)", html.includes("<style>") && !/src=["']http/.test(html));

  // 3b. Gold-standard components: comparison + funnel render with deltas,
  // membership tags, heat shading, logic boxes, stage heads, premise check.
  const goldBlocks: DataBlocksOutput = {
    blocks: [
      {
        id: "g1",
        title: "Sessions: current vs baseline",
        block_type: "comparison",
        source_query_ids: ["q1"],
        purpose: "confirm",
        columns: ["metric", "baseline", "current", "delta_abs", "delta_pct"],
        rows: [{ metric: "sessions", baseline: 640, current: 1177, delta_abs: 537, delta_pct: 83.91 }],
        derived_metric_names: [],
        flags: [],
        notes: [],
        meta: { comparison: { metric: "sessions", dimension: null, baseline_label: "baseline", current_label: "current" } },
      },
      {
        id: "g2",
        title: "Sessions by country — current vs baseline",
        block_type: "comparison",
        source_query_ids: ["q2"],
        purpose: "breakdown",
        columns: ["country", "baseline", "current", "delta_abs", "delta_pct", "membership"],
        rows: [
          { country: "India", baseline: 420, current: 337, delta_abs: -83, delta_pct: -19.76, membership: "both" },
          { country: "South Africa", baseline: 0, current: 35, delta_abs: 35, delta_pct: "", membership: "new" },
        ],
        derived_metric_names: [],
        flags: [],
        notes: [],
        meta: { comparison: { metric: "sessions", dimension: "country", baseline_label: "baseline", current_label: "current" } },
      },
      {
        id: "g3",
        title: "Funnel",
        block_type: "funnel",
        source_query_ids: ["q3"],
        purpose: "funnel",
        columns: ["step", "baseline", "current"],
        rows: [
          { step: "session_start", baseline: 640, current: 1182 },
          { step: "page_view", baseline: 1880, current: 3805 },
        ],
        derived_metric_names: [],
        flags: [],
        notes: [],
        meta: {
          funnel: {
            metric: "eventCount",
            baseline_label: "baseline",
            current_label: "current",
            transitions: [{ label: "page_view per session_start", baseline_rate: 2.94, current_rate: 3.22, most_moved: true }],
          },
        },
      },
    ],
    summary_notes: [],
  };
  const goldSpec = defaultSpec(goldBlocks, "Why did organic traffic fall last month?");
  const goldHtml = renderReport(goldSpec, goldBlocks, "2026-06-10 16:00", {
    question: "why did organic traffic fall last month?",
    periods: [
      { startDate: "2026-05-01", endDate: "2026-05-31", name: "current" },
      { startDate: "2026-04-01", endDate: "2026-04-30", name: "baseline" },
    ],
    propertyId: "516147906",
  });
  check("gold: context strip with Question chip", goldHtml.includes("Question") && goldHtml.includes("context-strip"));
  check("gold: Period chip shows both windows", goldHtml.includes("2026-05-01") && goldHtml.includes("2026-04-01"));
  check("gold: stage heads rendered", goldHtml.includes('class="stage-head"') && goldHtml.includes("Overview") && goldHtml.includes("Breakdowns") && goldHtml.includes("Behavior"));
  check("gold: logic box present", goldHtml.includes("Why this step"));
  check("gold: delta pill rendered", goldHtml.includes('class="delta neutral"') && goldHtml.includes("+537"));
  check("gold: heat shading on current column", goldHtml.includes("rgba(46,92,138"));
  check("gold: membership tag for new entry", goldHtml.includes('class="mem-tag"') && goldHtml.includes("new"));
  check("gold: premise reversal detected (fall asked, rise observed)", goldHtml.includes("not borne out"));
  check("gold: most-moved step tagged", goldHtml.includes("most-moved step"));
  check("gold: caption with computed numbers", goldHtml.includes("rose from 640") && goldHtml.includes("1,177"));
  check("gold: Notes & caveats section", goldHtml.includes("Notes &amp; caveats"));

  // 3c. Tracking-availability section renders when annotations are present.
  const availBlocks: DataBlocksOutput = {
    ...goldBlocks,
    availability: [
      {
        tag_name: "GA4 - Blog Scroll",
        events: ["blog_scroll_60"],
        query_ids: ["q1"],
        status: "not_covered",
        message: 'Data before 2026-03-15 is unavailable because tag "GA4 - Blog Scroll" had not yet been deployed.',
        provenance: "manual",
      },
      {
        tag_name: "Share Open",
        events: ["share_open"],
        query_ids: ["q2"],
        status: "unverified",
        message: 'Tag "Share Open" has no known deployment date; data completeness before 2026-05-11 (first observed) cannot be verified.',
        provenance: "gtm_snapshot",
      },
    ],
  };
  const availHtml = renderReport(defaultSpec(availBlocks, "t"), availBlocks, "2026-06-10 16:30");
  check("tracking: section heading rendered", availHtml.includes("Data Quality / Tracking Availability"));
  check("tracking: definitive message rendered", availHtml.includes("had not yet been deployed"));
  check("tracking: unverified message rendered", availHtml.includes("cannot be verified"));
  check("tracking: provenance chips rendered", availHtml.includes("source: manual") && availHtml.includes("source: gtm_snapshot"));
  check("tracking: absent when no annotations", !goldHtml.includes("Data Quality / Tracking Availability"));

  // 4. writeReport produces a file.
  const outDir = path.join(process.cwd(), "reports");
  const file = await writeReport(html, { outDir, slug: "brain6-test", stamp: "20260610T1530" });
  const exists = await fs
    .stat(file)
    .then(() => true)
    .catch(() => false);
  check("writeReport created a file", exists, file);
  if (exists) console.log(`    report: ${file}`);

  console.log("\n" + "-".repeat(70));
  console.log(`Deterministic renderer: ${pass} pass / ${fail} fail`);

  // 5. Optional LLM spec path (DeepSeek Pro).
  if (process.env.BRAIN6_LLM === "1") {
    console.log("\n" + "=".repeat(70));
    console.log("Brain 6 — LLM spec path (DeepSeek Pro)");
    const r = await runBrain6Report({ blocks, title: "LLM Report" });
    console.log(`  source=${r.source} blocks->sections=${r.spec.sections.length} ttft=${r.llm.timing.ttft_ms}ms total=${r.timing.total_ms}ms${r.llm.error ? ` error=${r.llm.error}` : ""}`);
    check("LLM path produced a renderable report", r.html.includes("<html") && r.spec.sections.length >= 1);
  }

  console.log("\n" + "=".repeat(70));
  console.log(`RESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
