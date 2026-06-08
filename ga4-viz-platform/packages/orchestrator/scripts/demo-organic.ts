/**
 * Integration smoke test for the A5 describe + A6 caption layer.
 *
 * Question: "what is the organic traffic for this month?"  (today = 2026-06-01)
 * Real GA4 data (property 516147906), this month = June 1 (partial):
 *   Organic Search — 33 sessions, 30 active users, 32 total users
 *   All channels   — 149 sessions  (organic ≈ 22.1% of sessions)
 *
 * Flow exercised:
 *   real numbers → A5 block (+ description_facts)
 *     → describeBlock()                → block.description
 *     → validateAgentOutput("A5", …)   → A5 conforms to the widened contract
 *     → attachCaptions()               → component.caption = block.description
 *     → validateAgentOutput("A6", …)   → A6 conforms (caption accepted)
 *     → renderCaptionHtml()            → neutral <p> under the heading
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  describeBlock,
  attachCaptions,
  descriptionsByBlockId,
  renderCaptionHtml,
  assignNarrativeStage,
  narrativeStageByBlockId,
  attachNarrativeStages,
} from "../../agents/src/index.js";
import { validateAgentOutput } from "../src/validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- real figures from GA4 ------------------------------------------------
const ORGANIC_SESSIONS = 33;
const ORGANIC_USERS = 30;
const ALL_SESSIONS = 149;
const SHARE = ((ORGANIC_SESSIONS / ALL_SESSIONS) * 100).toFixed(1) + "%";

// ---- A5 block, with description_facts (numbers come from A5 only) ----------
const block = {
  block_id: "sq_1_b_1",
  block_type: "kpi_strip",
  title_seed: "Organic traffic — this month",
  description_facts: {
    kpi_count: 4,
    kpi_summary: `${ORGANIC_SESSIONS} organic sessions, ${ORGANIC_USERS} organic active users, ${SHARE} share of all sessions, ${ALL_SESSIONS} total sessions`,
  },
  kpis: [
    { label: "Organic sessions", value: ORGANIC_SESSIONS, format: "number" },
    { label: "Organic active users", value: ORGANIC_USERS, format: "number" },
    { label: "Organic share of sessions", value: ORGANIC_SESSIONS / ALL_SESSIONS, format: "percent", annotation: "of all-channel sessions" },
    { label: "All-channel sessions", value: ALL_SESSIONS, format: "number" },
  ],
} as Record<string, unknown>;

// 1. Deterministic description from the registry template.
block.description = describeBlock(block as { block_type: string; description_facts?: Record<string, unknown> });
console.log("A5 block.description:\n  " + block.description + "\n");

// 1b. A5 stamps the funnel-narrative stage via the registry map.
const narrativeStage = assignNarrativeStage(block as { block_type: string });
console.log("A5 block.narrative_stage: " + narrativeStage + "\n");

const a5 = {
  schema_version: "0.1.0",
  blocks_by_sub_question: { sq_1: [block] },
  data_quality_notes: [
    "This month covers 2026-06-01 only; today is in progress, so values are partial.",
    "Organic = sessionDefaultChannelGroup 'Organic Search'.",
  ],
  passthrough_pipeline: {
    intent: { analysis_level: "L1", interpretation_request: false },
    applied_defaults: [],
    carried_forward: [],
    a3_disclosures: ["Metric read as sessions + active users (term 'organic traffic' was ambiguous)."],
    a4_warnings: ["Data for 2026-06-01 is partial (today is in progress)."],
  },
};

// 2. A5 conforms to the widened contract (description now required + non-empty).
await validateAgentOutput("A5", a5);
console.log("✓ A5 validates against a5-data-blocks.schema.json (description required)\n");

// ---- A6 viz spec referencing the block ------------------------------------
const a6: Record<string, unknown> = {
  schema_version: "0.1.0",
  report_title: "Organic traffic",
  subtitle: "joblet.ai · This month (2026-06-01, partial)",
  context_chips: [
    { key: "Source", text: "GA4 (property 516147906)", kind: "context" },
    { key: "Period", text: "This month — Jun 1, 2026", kind: "context" },
    { key: "Freshness", text: "Today (2026-06-01) is partial", kind: "partial" },
  ],
  disclosure_chips: [
    { key: "Read as", text: "sessions + active users", kind: "mapped" },
  ],
  sections: [
    {
      section_id: "sq_1_main",
      section_title: "Organic traffic — this month",
      components: [
        {
          component: "kpi_strip",
          block_ref: "sq_1_b_1",
          kpis: [
            { label: "Organic sessions", value_display: String(ORGANIC_SESSIONS) },
            { label: "Organic active users", value_display: String(ORGANIC_USERS) },
            { label: "Organic share of sessions", value_display: SHARE },
            { label: "All-channel sessions", value_display: String(ALL_SESSIONS) },
          ],
        },
      ],
    },
  ],
  quality_notes: a5.data_quality_notes,
  footer_meta: { source: "GA4 property 516147906", pulled_at: "2026-06-01T00:00:00Z", sampling: "none" },
};

// 3. Carry A5 descriptions onto A6 components as captions.
const descByBlock = descriptionsByBlockId(a5.blocks_by_sub_question as Record<string, Array<{ block_id?: string; description?: string }>>);
attachCaptions(a6 as { sections?: Array<{ components?: Array<{ block_ref: string; caption?: string }> }> }, descByBlock);

// 3b. Carry the A5 narrative_stage onto the A6 component (required by the viz-spec contract).
attachNarrativeStages(
  a6 as { sections?: Array<{ components?: Array<{ block_ref: string; narrative_stage?: string }> }> },
  narrativeStageByBlockId(a5.blocks_by_sub_question as Record<string, Array<{ block_id?: string; narrative_stage?: string }>>),
);
const attachedCaption = (a6.sections as Array<{ components: Array<{ caption?: string }> }>)[0].components[0].caption;
console.log("A6 component.caption (attached from A5):\n  " + attachedCaption + "\n");

// 4. A6 conforms (optional caption accepted by the widened contract).
await validateAgentOutput("A6", a6);
console.log("✓ A6 validates against a6-viz-spec.schema.json (caption accepted)\n");

// 5. Render the caption as neutral body text under the heading.
const captionHtml = renderCaptionHtml(attachedCaption);
console.log("Rendered caption HTML (no status colour):\n  " + captionHtml + "\n");

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Organic traffic — this month</title>
<style>.block-caption{color:#444;font:14px/1.5 system-ui;margin:.25rem 0 1rem}</style></head>
<body><h2>Organic traffic — this month</h2>${captionHtml}
<ul><li>Organic sessions: ${ORGANIC_SESSIONS}</li><li>Organic active users: ${ORGANIC_USERS}</li>
<li>Organic share of sessions: ${SHARE}</li><li>All-channel sessions: ${ALL_SESSIONS}</li></ul></body></html>`;

const outPath = resolve(__dirname, "..", "..", "..", "reports", "organic_this_month_caption_demo.html");
writeFileSync(outPath, html, "utf-8");
console.log("Wrote " + outPath);
