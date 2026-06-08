/**
 * Funnel-narrative test: "Why are new users declining?" (live GA4 data).
 *
 * A4 (live) produced the real rows below. This script exercises the NEW
 * monorepo restructuring:
 *   A5  → assignNarrativeStage() stamps each block's narrative_stage from the
 *         block-pattern registry map (first-match-wins).
 *   A5  → validateAgentOutput("A5") proves the blocks satisfy the widened
 *         a5-data-blocks contract (narrative_stage now required).
 *   A6  → groupSectionsByNarrative() + renderNarrativeReportHtml() group blocks
 *         into overview→acquisition→quality→behavior→outcomes with intro +
 *         bridging handoff captions, dropping the per-block "Stage N" header.
 */
import { writeFileSync } from "node:fs";
import {
  assignNarrativeStage,
  loadNarrativeConfig,
  attachCaptions,
  descriptionsByBlockId,
  narrativeStageByBlockId,
  attachNarrativeStages,
  groupSectionsByNarrative,
  renderNarrativeReportHtml,
} from "../../agents/src/index.js";
import { validateAgentOutput } from "../src/validator.js";

// ---- A5 data-handling: shape A4 rows into blocks (no narrative_stage yet) ----
const blocks: Array<Record<string, unknown>> = [
  {
    block_id: "sq_1_b_1",
    block_type: "comparison_pair",
    title_seed: "New users — last 28 days vs prior 28 days",
    description:
      "New users were 6,134 in the last 28 days versus 7,622 in the prior 28 days, 1,488 lower (-19.52%).",
    left: { label: "Prior 28 days", value: 7622 },
    right: { label: "Last 28 days", value: 6134 },
    delta: { absolute: -1488, percent: -19.52 },
  },
  {
    block_id: "sq_1_b_2",
    block_type: "time_series",
    title_seed: "Daily new users",
    description:
      "Daily new users over the last 28 days range from 84 to 801, with a peak on 2026-05-19; the period total is 6,134.",
    date_field: "date",
    metric_fields: ["newUsers"],
    points: [
      { date: "2026-05-06", newUsers: 320 }, { date: "2026-05-12", newUsers: 294 },
      { date: "2026-05-18", newUsers: 646 }, { date: "2026-05-19", newUsers: 801 },
      { date: "2026-05-25", newUsers: 119 }, { date: "2026-05-29", newUsers: 84 },
      { date: "2026-06-02", newUsers: 222, is_partial: true },
    ],
    annotations: {
      period_mean: 219,
      period_min: { date: "2026-05-29", value: 84 },
      period_max: { date: "2026-05-19", value: 801 },
    },
  },
  {
    block_id: "sq_1_b_3",
    block_type: "breakdown",
    title_seed: "New users by first-user channel",
    description:
      "New users by first-user channel, last 28 days vs prior: Direct 2,119 (from 3,500), Referral 2,833 (from 1,545), Organic Social 434 (from 1,046), Organic Search 307 (from 890), Paid Search 131 (from 282).",
    dimension_field: "firstUserDefaultChannelGroup",
    metric_field: "newUsers",
    rows: [
      { firstUserDefaultChannelGroup: "Direct", newUsers: 2119, baseline: 3500 },
      { firstUserDefaultChannelGroup: "Referral", newUsers: 2833, baseline: 1545 },
      { firstUserDefaultChannelGroup: "Organic Social", newUsers: 434, baseline: 1046 },
      { firstUserDefaultChannelGroup: "Organic Search", newUsers: 307, baseline: 890 },
      { firstUserDefaultChannelGroup: "Paid Search", newUsers: 131, baseline: 282 },
    ],
    annotations: { shown_count: 11, total_available: 11 },
  },
  {
    block_id: "sq_1_b_4",
    block_type: "breakdown",
    title_seed: "New users by landing page",
    description:
      "New users by landing page, last 28 days vs prior: / 2,419 (from 3,864), /jobs 1,396 (from 2,911); several /jobs/driver-and-delivery-jobs-wheels2wages-* pages appear in the last 28 days with no prior-period rows.",
    dimension_field: "landingPage",
    metric_field: "newUsers",
    rows: [
      { landingPage: "/", newUsers: 2419, baseline: 3864 },
      { landingPage: "/jobs", newUsers: 1396, baseline: 2911 },
      { landingPage: "/jobs/driver-and-delivery-jobs-wheels2wages-augusta-ga-us", newUsers: 455, baseline: 0 },
      { landingPage: "/jobs/137432-expVer-7", newUsers: 0, baseline: 190 },
    ],
    annotations: { shown_count: 20, total_available: 1182 },
  },
  {
    block_id: "sq_1_b_5",
    block_type: "geo_distribution",
    title_seed: "New users by country",
    description:
      "New users by country, last 28 days vs prior: United States 3,124 (from 2,322), India 1,336 (from 1,958); most other countries are lower.",
    country_field: "country",
    metric_field: "newUsers",
    rows: [
      { country: "United States", newUsers: 3124, baseline: 2322 },
      { country: "India", newUsers: 1336, baseline: 1958 },
      { country: "Canada", newUsers: 98, baseline: 263 },
    ],
    annotations: { shown_countries: 20, total_countries: 157 },
  },
  {
    block_id: "sq_1_b_6",
    block_type: "breakdown",
    title_seed: "New users by device",
    description:
      "New users by device, last 28 days vs prior: desktop 2,070 (from 4,160), mobile 4,035 (from 3,434), tablet 29 (from 28).",
    dimension_field: "deviceCategory",
    metric_field: "newUsers",
    rows: [
      { deviceCategory: "desktop", newUsers: 2070, baseline: 4160 },
      { deviceCategory: "mobile", newUsers: 4035, baseline: 3434 },
      { deviceCategory: "tablet", newUsers: 29, baseline: 28 },
    ],
    annotations: { shown_count: 3, total_available: 3 },
  },
  {
    block_id: "sq_1_b_7",
    block_type: "funnel",
    title_seed: "Event funnel (session_start → page_view → view_search_results → job_apply)",
    description:
      "Funnel event counts, last 28 days vs prior: session_start 7,383 (from 10,130), page_view 27,219 (from 29,341), view_search_results 903 (from 825), job_apply 45,400 (from 37,284). Step-to-step conversion is higher or flat at every step.",
    domain_profile_ref: "job_board",
    steps: [
      { label: "session_start", count: 7383 },
      { label: "page_view", count: 27219, step_rate_from_prev: 3.6867 },
      { label: "view_search_results", count: 903, step_rate_from_prev: 0.0332 },
      { label: "job_apply", count: 45400, step_rate_from_prev: 50.2769 },
    ],
    annotations: { biggest_drop_step: "view_search_results" },
  },
];

// ---- A5 step 1: assign narrative_stage to each block (the new function) ------
const cfg = loadNarrativeConfig();
console.log("=== A5: assignNarrativeStage (first-match-wins over the registry map) ===");
for (const b of blocks) {
  const stage = assignNarrativeStage(b);
  console.log(
    `  ${String(b.block_id).padEnd(10)} ${String(b.block_type).padEnd(16)} ` +
      `dim=${String((b.dimension_field ?? b.country_field) ?? "-").padEnd(28)} -> ${stage}`,
  );
}

// ---- A5 output, validated against the widened contract -----------------------
const a5 = {
  schema_version: "0.1.0",
  blocks_by_sub_question: { sq_1: blocks },
  data_quality_notes: [
    "No date window specified; current = last 28 days (2026-05-06..2026-06-02, today partial), baseline = prior 28 days.",
    "Conditional RCA stages (funnel-step breakdown, path exploration, structural diff) did not fire: no funnel step-rate drop and an unchanged channel set.",
  ],
  passthrough_pipeline: {
    intent: { analysis_level: "L4", interpretation_request: true },
    applied_defaults: [
      { field: "date_range", chosen: "last_28_days", source: "registry" },
    ],
    carried_forward: [],
    a3_disclosures: ["Showing last 28 days vs prior 28 days (no window specified).", "All sources, all countries."],
    a4_warnings: ["Data for 2026-06-02 is partial (today is in progress)."],
  },
};

await validateAgentOutput("A5", a5);
console.log("\n[ok] A5 validates against a5-data-blocks.schema.json (narrative_stage required)\n");

// ---- A6: build a viz spec, carry narrative_stage + captions, group + render --
const vizSpec = {
  sections: blocks.map((b) => ({
    section_id: `${b.block_id}_sec`,
    section_title: b.title_seed as string,
    step_number: "Stage ? — Step ? of 7", // the OLD per-block header (should be dropped)
    components: [{ component: "kpi_card", block_ref: b.block_id as string }],
  })),
};

attachNarrativeStages(
  vizSpec as { sections?: Array<{ components?: Array<{ block_ref: string; narrative_stage?: string }> }> },
  narrativeStageByBlockId(a5.blocks_by_sub_question as Record<string, Array<{ block_id?: string; narrative_stage?: string }>>),
);
attachCaptions(
  vizSpec as { sections?: Array<{ components?: Array<{ block_ref: string; caption?: string }> }> },
  descriptionsByBlockId(a5.blocks_by_sub_question as Record<string, Array<{ block_id?: string; description?: string }>>),
);

console.log("=== A6: groupSectionsByNarrative (registry order) ===");
const groups = groupSectionsByNarrative(vizSpec, cfg);
for (const g of groups) {
  console.log(`  ${g.stage.order}. ${g.stage.label.padEnd(12)} <- ${g.sections.map((s) => s.section_title).join("  |  ")}`);
}

const html = renderNarrativeReportHtml(vizSpec, cfg);
const outPath = "E:/Documents/joveo/reports/2026-06-02_newusers-narrative.html";
writeFileSync(outPath, `<!doctype html><meta charset="utf-8"><title>Why are new users declining?</title>\n${html}\n`, "utf-8");
console.log(`\n=== A6: rendered funnel-narrative report body ===\n`);
console.log(html);
console.log(`\n[ok] wrote ${outPath}`);
