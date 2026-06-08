/**
 * @gvp/agents — Phase 5D agent-implementation layer.
 *
 * Descriptive-only helpers that sit on top of the A5 / A6 contracts:
 *   - a5.describe: turn a data block into a neutral description.
 *   - a6.caption:  carry that description through to the viz spec + render it.
 */
export {
  describeBlock,
  describeBlockLLM,
  assertDescriptive,
  loadDescribeRegistry,
  _clearDescribeRegistryCache,
  assignNarrativeStage,
  loadNarrativeConfig,
  _clearNarrativeConfigCache,
  metricClassFromOntology,
  metricClassIncludesQuality,
  _clearMetricOntologyCache,
  DescriptiveViolationError,
  MissingFactError,
  type MetricClass,
  type DescribableBlock,
  type DescribeRegistry,
  type DeltaFacts,
  type LlmComplete,
  type NarrativeStageDef,
  type NarrativeStageRule,
  type NarrativeMatchValue,
  type NarrativeConfig,
  type NarrativeBlock,
} from "./a5.describe.js";

export {
  attachCaptions,
  descriptionsByBlockId,
  renderCaptionHtml,
  narrativeStageByBlockId,
  attachNarrativeStages,
  groupSectionsByNarrative,
  renderNarrativeReportHtml,
  guardReportHtml,
  type NarrativeGroupOpts,
  type CaptionableBlock,
  type CaptionableComponent,
  type CaptionableSection,
  type CaptionableVizSpec,
  type NarrativeGroup,
} from "./a6.caption.js";

export {
  assertPaletteAllowed,
  loadPaletteAllowlist,
  _clearPaletteAllowlistCache,
  PaletteViolationError,
  type PaletteAllowlist,
} from "./palette.js";
