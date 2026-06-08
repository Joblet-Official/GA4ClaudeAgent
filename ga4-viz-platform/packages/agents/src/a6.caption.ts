/**
 * A6 — Caption layer (Phase 5D, descriptive-only).
 *
 * A6 does not write prose. It carries the A5 block.description through to the
 * viz spec as `component.caption`, and renders it under each component heading
 * as neutral body text. No status colour, no editorial classes — a caption is
 * the A5 description verbatim.
 */
import {
  assertDescriptive,
  loadNarrativeConfig,
  metricClassIncludesQuality,
  type NarrativeConfig,
  type NarrativeStageDef,
  type MetricClass,
} from "./a5.describe.js";
import { assertNoPromptLeakInHtml } from "@gvp/contracts";
import { assertPaletteAllowed } from "./palette.js";

/** A block whose description (if any) becomes a caption. */
export interface CaptionableBlock {
  block_id?: string;
  description?: string;
}

/** Minimal structural view of an A6 component. */
export interface CaptionableComponent {
  component: string;
  block_ref: string;
  caption?: string;
  [k: string]: unknown;
}

/** Minimal structural view of an A6 section. */
export interface CaptionableSection {
  components?: CaptionableComponent[];
  [k: string]: unknown;
}

/** Minimal structural view of an A6 viz spec. */
export interface CaptionableVizSpec {
  sections?: CaptionableSection[];
  [k: string]: unknown;
}

/**
 * Build a block_id → description map from an A5 blocks_by_sub_question object.
 * Blocks without a description are skipped.
 */
export function descriptionsByBlockId(
  blocksBySubQuestion: Record<string, CaptionableBlock[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const blocks of Object.values(blocksBySubQuestion)) {
    for (const b of blocks) {
      if (b.block_id && typeof b.description === "string" && b.description.length > 0) {
        out[b.block_id] = b.description;
      }
    }
  }
  return out;
}

/**
 * Set `caption = block.description` on every component whose block_ref has a
 * description. Mutates and returns the same viz spec. Each caption is guarded
 * with assertDescriptive so a non-descriptive A5 description never silently
 * becomes a rendered caption.
 */
export function attachCaptions(
  vizSpec: CaptionableVizSpec,
  descriptionsByBlock: Record<string, string>,
): CaptionableVizSpec {
  for (const section of vizSpec.sections ?? []) {
    for (const component of section.components ?? []) {
      const description = descriptionsByBlock[component.block_ref];
      if (typeof description === "string" && description.length > 0) {
        assertDescriptive(description);
        component.caption = description;
      }
    }
  }
  return vizSpec;
}

/** Escape the five HTML-significant characters. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a caption as neutral body text to sit directly under a component
 * heading. The class is descriptive ("block-caption") and carries NO status /
 * evaluative colour. Returns an empty string for an empty caption.
 */
export function renderCaptionHtml(caption: string | undefined | null): string {
  if (!caption || caption.trim().length === 0) return "";
  return `<p class="block-caption">${escapeHtml(caption.trim())}</p>`;
}

// ---------------------------------------------------------------------------
// Funnel-narrative grouping.
//
// A6 groups blocks by their narrative_stage (carried through from A5) into the
// registry-ordered funnel narrative — overview → acquisition → quality →
// behavior → outcomes — rendering a stage header + a templated intro caption
// per stage and a handoff caption bridging to the next stage, in place of the
// playbook's per-block "Stage N / Step X of N" header. Block titles are kept.
// ---------------------------------------------------------------------------

/** Build a block_id → narrative_stage map from an A5 blocks_by_sub_question object. */
export function narrativeStageByBlockId(
  blocksBySubQuestion: Record<string, Array<{ block_id?: string; narrative_stage?: string }>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const blocks of Object.values(blocksBySubQuestion)) {
    for (const b of blocks) {
      if (b.block_id && typeof b.narrative_stage === "string" && b.narrative_stage.length > 0) {
        out[b.block_id] = b.narrative_stage;
      }
    }
  }
  return out;
}

/** Carry narrative_stage from A5 blocks onto matching A6 components (by block_ref). */
export function attachNarrativeStages(
  vizSpec: CaptionableVizSpec,
  stagesByBlock: Record<string, string>,
): CaptionableVizSpec {
  for (const section of vizSpec.sections ?? []) {
    for (const component of section.components ?? []) {
      const stage = stagesByBlock[component.block_ref];
      if (typeof stage === "string" && stage.length > 0) {
        component.narrative_stage = stage;
      }
    }
  }
  return vizSpec;
}

/** A narrative stage paired with the sections that belong to it. */
export interface NarrativeGroup {
  stage: NarrativeStageDef;
  sections: CaptionableSection[];
}

/** Resolve a section's stage: explicit on the section, else its first component, else default. */
function sectionStageId(section: CaptionableSection, fallback: string): string {
  if (typeof section.narrative_stage === "string" && section.narrative_stage.length > 0) {
    return section.narrative_stage;
  }
  for (const c of section.components ?? []) {
    if (typeof c.narrative_stage === "string" && c.narrative_stage.length > 0) {
      return c.narrative_stage;
    }
  }
  return fallback;
}

/**
 * Group a viz spec's sections into the funnel narrative, in registry order
 * (overview → acquisition → quality → behavior → outcomes). Only stages that
 * have at least one section appear, and they appear in registry order. Sections
 * keep their titles and components; any per-block "Stage N / Step X of N" header
 * is NOT carried into the grouped view.
 */
export interface NarrativeGroupOpts {
  /**
   * Headline metric class. A "primitive_count" report omits the "quality" stage
   * entirely (counts have no engagement-quality dimension); a "composite_rate"
   * report keeps it. When omitted, no stage is pre-excluded. Either way, stages
   * with zero blocks are dropped.
   */
  metricClass?: MetricClass;
}

export function groupSectionsByNarrative(
  vizSpec: CaptionableVizSpec,
  config: NarrativeConfig = loadNarrativeConfig(),
  opts: NarrativeGroupOpts = {},
): NarrativeGroup[] {
  let ordered = [...config.narrative_stages].sort((a, b) => a.order - b.order);
  // Metric-class-aware stage SET: primitive counts omit the quality stage.
  if (opts.metricClass && !metricClassIncludesQuality(opts.metricClass)) {
    ordered = ordered.filter((s) => s.id !== "quality");
  }
  const known = new Set(ordered.map((s) => s.id));
  const buckets = new Map<string, CaptionableSection[]>();

  for (const section of vizSpec.sections ?? []) {
    let stageId = sectionStageId(section, config.narrative_default_stage);
    if (!known.has(stageId)) stageId = config.narrative_default_stage;
    const list = buckets.get(stageId) ?? [];
    list.push(section);
    buckets.set(stageId, list);
  }

  const groups: NarrativeGroup[] = [];
  for (const stage of ordered) {
    const sections = buckets.get(stage.id);
    if (sections && sections.length > 0) groups.push({ stage, sections });
  }
  return groups;
}

/**
 * Render the funnel-narrative report body: for each present stage in order, a
 * stage header + templated intro caption, then each block's title + caption,
 * with a handoff caption bridging to the next stage. Intro and handoff strings
 * are guarded by assertDescriptive (method-framing only — never causal links
 * between stages). The per-block "Stage N / Step X of N" header is dropped;
 * block titles are kept.
 */
export function renderNarrativeReportHtml(
  vizSpec: CaptionableVizSpec,
  config: NarrativeConfig = loadNarrativeConfig(),
  opts: NarrativeGroupOpts = {},
): string {
  const groups = groupSectionsByNarrative(vizSpec, config, opts);
  const parts: string[] = [];

  groups.forEach((group, gi) => {
    parts.push(`<section class="narrative-stage" data-stage="${escapeHtml(group.stage.id)}">`);
    parts.push(`<h2 class="stage-header">${escapeHtml(group.stage.label)}</h2>`);

    assertDescriptive(group.stage.intro);
    parts.push(`<p class="stage-intro">${escapeHtml(group.stage.intro)}</p>`);

    for (const section of group.sections) {
      const title = typeof section.section_title === "string" ? section.section_title : "";
      if (title.length > 0) parts.push(`<h3 class="block-title">${escapeHtml(title)}</h3>`);
      for (const component of section.components ?? []) {
        const caption = typeof component.caption === "string" ? component.caption : "";
        const html = renderCaptionHtml(caption);
        if (html.length > 0) parts.push(html);
      }
    }
    parts.push(`</section>`);

    // Bridging caption to the next stage (not after the final stage).
    if (gi < groups.length - 1) {
      assertDescriptive(group.stage.handoff);
      parts.push(`<p class="stage-handoff">${escapeHtml(group.stage.handoff)}</p>`);
    }
  });

  return parts.join("\n");
}

/**
 * Final A6 safety gate, to be called on the complete report HTML immediately
 * before handing it to the html_file_writer. Runs the palette lint (no colour
 * outside the allow-list; peach only on .partial nodes) and the prompt-leak
 * guard on the HTML's visible text. Throws on violation; returns the HTML
 * unchanged when clean.
 */
export function guardReportHtml(html: string): string {
  assertPaletteAllowed(html);
  assertNoPromptLeakInHtml(html, "A6");
  return html;
}
