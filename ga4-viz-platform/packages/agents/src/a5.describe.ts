/**
 * A5 — Block-description layer (Phase 5D, descriptive-only).
 *
 * This module turns an A5 data block into its `description`: a neutral,
 * DESCRIPTIVE one-to-three-sentence restatement of the figures the block
 * already carries. It NEVER interprets, attributes cause, passes judgement,
 * or recommends. Numbers come from A5 (via `description_facts`); the
 * description only restates them.
 *
 * Three exports:
 *   - describeBlock(block)      deterministic: fills the block-pattern
 *                               registry template from description_facts.
 *   - assertDescriptive(text)   guard: throws on causation / judgement tokens.
 *   - describeBlockLLM(block,…) optional LLM path, guarded by assertDescriptive.
 *
 * The registry templates + delta clauses live in the block-pattern registry
 * (packages/registry-data/block-pattern.json) — A5 owns the vocabulary, this
 * layer only fills the blanks.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// packages/agents/src/../../registry-data/block-pattern.json → packages/registry-data
const BLOCK_PATTERN_PATH = resolve(
  __dirname,
  "..",
  "..",
  "registry-data",
  "block-pattern.json",
);

/** Minimal structural view of an A5 block (only what the describe layer reads). */
export interface DescribableBlock {
  block_type: string;
  description_facts?: Record<string, unknown> | null;
}

/** The two registry sections this layer consumes. */
export interface DescribeRegistry {
  description_templates: Record<string, string>;
  delta_clauses: Record<string, string>;
}

/** Period-over-period delta facts, when a block carries one. */
export interface DeltaFacts {
  direction: "higher" | "lower" | "unchanged";
  metric?: string;
  delta_abs?: string | number;
  delta_pct?: string;
  vs_period?: string;
}

/** Thrown when generated/supplied text contains non-descriptive language. */
export class DescriptiveViolationError extends Error {
  public readonly token: string;
  constructor(token: string, text: string) {
    super(
      `assertDescriptive: text contains non-descriptive token "${token}". ` +
        `Descriptions must restate figures only — no causation, judgement, or recommendation. ` +
        `Offending text: ${JSON.stringify(text)}`,
    );
    this.name = "DescriptiveViolationError";
    this.token = token;
  }
}

/** Thrown when a template references a placeholder that no fact fills. */
export class MissingFactError extends Error {
  constructor(blockType: string, missing: string[]) {
    super(
      `describeBlock: template for block_type "${blockType}" has unfilled ` +
        `placeholder(s) ${JSON.stringify(missing)}; provide them in description_facts.`,
    );
    this.name = "MissingFactError";
  }
}

// ---------------------------------------------------------------------------
// Forbidden-token vocabulary (the descriptive guard).
//
// CAUSATION and JUDGEMENT are forbidden. Factual comparatives ("higher",
// "lower", "drop", "leads", "unchanged") are NOT forbidden — direction and
// magnitude of a number are descriptive facts.
// ---------------------------------------------------------------------------
const CAUSATION_PHRASES = [
  "because",
  "due to",
  "caused by",
  "cause of",
  "causes",
  "driven by",
  "drove",
  "led to",
  "leads to",
  "resulted in",
  "result of",
  "owing to",
  "thanks to",
  "as a result",
  "attributable to",
  "explains the",
  "reflects a",
  // Cross-stage causal connectors — banned so narrative intro/handoff captions
  // stay METHOD-FRAMING only (describe what the next section shows; never assert
  // that one funnel stage's movement caused another's).
  "feeds into",
  "feed into",
  "downstream of",
  "upstream of",
  "as a consequence",
  "consequently",
  "knock-on",
  "cascades",
  "cascade into",
  "propagates",
  "ripples into",
  "translates into",
  "carries over into",
  "explains why",
  "which explains",
  "that explains",
  "gives rise to",
  "drives",
];

const JUDGEMENT_WORDS = [
  "should",
  "recommend",
  "recommendation",
  "good",
  "bad",
  "poor",
  "strong",
  "weak",
  "healthy",
  "unhealthy",
  "concerning",
  "worrying",
  "worrisome",
  "impressive",
  "disappointing",
  "better",
  "worse",
  "best",
  "worst",
  "great",
  "terrible",
  "excellent",
  "alarming",
  "encouraging",
  "improve",
  "improved",
  "improvement",
  "worsen",
  "worsened",
  "underperform",
  "outperform",
];

/**
 * Throw if `text` contains any causation or judgement token. Case-insensitive.
 * Multi-word causation phrases match as substrings; single judgement words
 * match on word boundaries (so "goodwill" or "database" do not trip).
 */
export function assertDescriptive(text: string): void {
  const lower = text.toLowerCase();

  for (const phrase of CAUSATION_PHRASES) {
    if (lower.includes(phrase)) {
      throw new DescriptiveViolationError(phrase, text);
    }
  }
  for (const word of JUDGEMENT_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(text)) {
      throw new DescriptiveViolationError(word, text);
    }
  }
}

// ---------------------------------------------------------------------------

let _registryCache: DescribeRegistry | undefined;

/** Load the description templates + delta clauses from the block-pattern registry. */
export function loadDescribeRegistry(): DescribeRegistry {
  if (_registryCache) return _registryCache;
  const raw = readFileSync(BLOCK_PATTERN_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<DescribeRegistry>;
  if (!parsed.description_templates || !parsed.delta_clauses) {
    throw new Error(
      `loadDescribeRegistry: ${BLOCK_PATTERN_PATH} is missing description_templates / delta_clauses`,
    );
  }
  _registryCache = {
    description_templates: parsed.description_templates,
    delta_clauses: parsed.delta_clauses,
  };
  return _registryCache;
}

/** Test hook: drop the cached registry. */
export function _clearDescribeRegistryCache(): void {
  _registryCache = undefined;
}

// ---------------------------------------------------------------------------
// Narrative-stage assignment (funnel-narrative grouping).
//
// A5 stamps each block with a `narrative_stage` so A6 can group blocks into the
// funnel narrative (overview -> acquisition -> quality -> behavior -> outcomes)
// instead of the playbook's "Stage N / Step X of N" order. The rules live in the
// block-pattern registry: `narrative_stage_map` (first-match-wins over a block's
// metric / dimension / stage_kind / event signals, with "*" wildcard) and
// `narrative_default_stage` (the fallback). Grouping is DESCRIPTIVE only — it
// never asserts a causal ordering between stages.
// ---------------------------------------------------------------------------

export interface NarrativeStageDef {
  id: string;
  label: string;
  order: number;
  intro: string;
  handoff: string;
}

export type NarrativeMatchValue = string | string[];

export interface NarrativeStageRule {
  metric?: NarrativeMatchValue;
  dimension?: NarrativeMatchValue;
  stage_kind?: NarrativeMatchValue;
  event?: NarrativeMatchValue;
  stage: string;
}

export interface NarrativeConfig {
  narrative_stages: NarrativeStageDef[];
  narrative_stage_map: NarrativeStageRule[];
  narrative_default_stage: string;
}

/** Loose view of a block for narrative-stage resolution (reads identifying signals only). */
export interface NarrativeBlock {
  block_type?: string;
  stage_kind?: string;
  metric?: string;
  metric_field?: string;
  metric_fields?: string[];
  dimension?: string;
  dimension_field?: string;
  dimension_fields?: string[];
  row_dimension?: string;
  col_dimension?: string;
  country_field?: string;
  event?: string;
  event_name?: string;
  collapsing_event?: string;
  steps?: Array<{ event_name?: string } & Record<string, unknown>>;
  narrative_stage?: string;
  [k: string]: unknown;
}

let _narrativeCache: NarrativeConfig | undefined;

/** Load narrative_stages + narrative_stage_map + narrative_default_stage from the registry. */
export function loadNarrativeConfig(): NarrativeConfig {
  if (_narrativeCache) return _narrativeCache;
  const raw = readFileSync(BLOCK_PATTERN_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<NarrativeConfig>;
  if (
    !Array.isArray(parsed.narrative_stages) ||
    !Array.isArray(parsed.narrative_stage_map) ||
    typeof parsed.narrative_default_stage !== "string"
  ) {
    throw new Error(
      `loadNarrativeConfig: ${BLOCK_PATTERN_PATH} is missing narrative_stages / narrative_stage_map / narrative_default_stage`,
    );
  }
  _narrativeCache = {
    narrative_stages: parsed.narrative_stages,
    narrative_stage_map: parsed.narrative_stage_map,
    narrative_default_stage: parsed.narrative_default_stage,
  };
  return _narrativeCache;
}

/** Test hook: drop the cached narrative config. */
export function _clearNarrativeConfigCache(): void {
  _narrativeCache = undefined;
}

// ---------------------------------------------------------------------------
// Metric-class awareness (drives the stage SET).
//
// A composite-rate metric (decomposition_kind "ratio" / "average", e.g.
// engagementRate, bounceRate, averageSessionDuration) carries an engagement-
// QUALITY dimension, so the funnel narrative includes a "quality" stage.
// A primitive count (decomposition_kind "atomic", e.g. sessions, totalUsers,
// newUsers) has no quality dimension, so the "quality" stage is omitted. The
// class is read from the metric ontology (decomposition_kind), never guessed.
// ---------------------------------------------------------------------------

export type MetricClass = "composite_rate" | "primitive_count";

const METRIC_ONTOLOGY_PATH = resolve(
  __dirname,
  "..",
  "..",
  "registry-data",
  "metric-ontology.json",
);

let _ontologyKindCache: Record<string, string> | undefined;

function loadMetricKinds(): Record<string, string> {
  if (_ontologyKindCache) return _ontologyKindCache;
  const raw = readFileSync(METRIC_ONTOLOGY_PATH, "utf-8");
  const parsed = JSON.parse(raw) as { metrics?: Record<string, { decomposition_kind?: string }> };
  const out: Record<string, string> = {};
  for (const [m, def] of Object.entries(parsed.metrics ?? {})) {
    if (def && typeof def.decomposition_kind === "string") out[m] = def.decomposition_kind;
  }
  _ontologyKindCache = out;
  return out;
}

/** Test hook: drop the cached metric-ontology kinds. */
export function _clearMetricOntologyCache(): void {
  _ontologyKindCache = undefined;
}

/**
 * Classify a headline metric from the ontology's decomposition_kind:
 *   ratio | average → "composite_rate" (includes a quality stage)
 *   atomic | unknown → "primitive_count" (omits the quality stage)
 */
export function metricClassFromOntology(metric: string): MetricClass {
  const kind = loadMetricKinds()[metric];
  return kind === "ratio" || kind === "average" ? "composite_rate" : "primitive_count";
}

/** True when this metric class warrants a "quality" stage in the funnel narrative. */
export function metricClassIncludesQuality(metricClass: MetricClass): boolean {
  return metricClass === "composite_rate";
}

/** Collect the metric / dimension / stage_kind / event signal arrays from a block. */
function narrativeSignals(block: NarrativeBlock): {
  metric: string[];
  dimension: string[];
  stage_kind: string[];
  event: string[];
} {
  const metric = [block.metric, block.metric_field, ...(block.metric_fields ?? [])];
  const dimension = [
    block.dimension,
    block.dimension_field,
    ...(block.dimension_fields ?? []),
    block.row_dimension,
    block.col_dimension,
    block.country_field,
  ];
  const stage_kind = [block.stage_kind, block.block_type];
  const event: (string | undefined)[] = [block.event, block.event_name, block.collapsing_event];
  for (const step of block.steps ?? []) {
    if (typeof step.event_name === "string") {
      // A funnel step's event_name may be a |-joined list of merged variants.
      for (const e of step.event_name.split("|")) event.push(e.trim());
    }
  }
  const clean = (xs: (string | undefined)[]): string[] =>
    xs.filter((x): x is string => typeof x === "string" && x.length > 0);
  return {
    metric: clean(metric),
    dimension: clean(dimension),
    stage_kind: clean(stage_kind),
    event: clean(event),
  };
}

/** A rule key matches if absent / "*" (wildcard) or intersects the block's signals for that key. */
function narrativeKeyMatches(ruleVal: NarrativeMatchValue | undefined, signals: string[]): boolean {
  if (ruleVal === undefined || ruleVal === "*") return true;
  const accepted = Array.isArray(ruleVal) ? ruleVal : [ruleVal];
  if (accepted.includes("*")) return true;
  return signals.some((s) => accepted.includes(s));
}

/**
 * Resolve a block's narrative_stage via the registry map (first-match-wins over
 * metric / dimension / stage_kind / event, "*" wildcard), falling back to
 * narrative_default_stage. Stamps `block.narrative_stage` and returns the value.
 */
export function assignNarrativeStage(
  block: NarrativeBlock,
  config: NarrativeConfig = loadNarrativeConfig(),
): string {
  const sig = narrativeSignals(block);
  for (const rule of config.narrative_stage_map) {
    if (
      narrativeKeyMatches(rule.metric, sig.metric) &&
      narrativeKeyMatches(rule.dimension, sig.dimension) &&
      narrativeKeyMatches(rule.stage_kind, sig.stage_kind) &&
      narrativeKeyMatches(rule.event, sig.event)
    ) {
      block.narrative_stage = rule.stage;
      return rule.stage;
    }
  }
  block.narrative_stage = config.narrative_default_stage;
  return config.narrative_default_stage;
}

/** Replace every {placeholder} in `template` with the matching value from `facts`. */
function interpolate(template: string, facts: Record<string, unknown>): string {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (whole, key: string) => {
    const v = facts[key];
    return v === undefined || v === null ? whole : String(v);
  });
}

/** List the {placeholders} still unresolved in a string. */
function unresolvedPlaceholders(text: string): string[] {
  const out: string[] = [];
  const re = /\{([a-z0-9_]+)\}/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Deterministically describe a block by filling the registry template for its
 * block_type from its `description_facts`. The optional `delta` fact (with a
 * `direction`) is rendered via the matching delta clause and spliced into the
 * template's `{delta_clause}` slot. Throws if a placeholder is left unfilled
 * or if the result is non-descriptive.
 */
export function describeBlock(
  block: DescribableBlock,
  registry: DescribeRegistry = loadDescribeRegistry(),
): string {
  const template = registry.description_templates[block.block_type];
  if (!template) {
    throw new Error(
      `describeBlock: no description_template for block_type "${block.block_type}"`,
    );
  }

  const facts: Record<string, unknown> = { ...(block.description_facts ?? {}) };

  // 1. Resolve the optional delta clause first.
  let deltaClause = "";
  const delta = facts["delta"] as DeltaFacts | undefined;
  if (delta && typeof delta === "object" && delta.direction) {
    const clauseTemplate = registry.delta_clauses[delta.direction];
    if (!clauseTemplate) {
      throw new Error(
        `describeBlock: no delta_clause for direction "${delta.direction}"`,
      );
    }
    const deltaFacts: Record<string, unknown> = { ...delta };
    deltaClause = interpolate(clauseTemplate, deltaFacts);
    const stillOpen = unresolvedPlaceholders(deltaClause);
    if (stillOpen.length > 0) {
      throw new MissingFactError(`${block.block_type} (delta_clause)`, stillOpen);
    }
  }

  // 2. Splice the delta clause, then fill the remaining placeholders.
  let out = template.replace(/\{delta_clause\}/g, deltaClause);
  out = interpolate(out, facts);

  const leftover = unresolvedPlaceholders(out);
  if (leftover.length > 0) {
    throw new MissingFactError(block.block_type, leftover);
  }

  out = out.replace(/\s+/g, " ").trim();

  // 3. Guard: descriptive only.
  assertDescriptive(out);
  return out;
}

/** A pluggable LLM completion function. Injected so the path stays testable + offline. */
export type LlmComplete = (prompt: string) => Promise<string>;

/**
 * Optional LLM-backed description path. Builds a tightly-scoped, descriptive-only
 * prompt, runs the injected completion, then GUARDS the output with
 * assertDescriptive — so a model that drifts into causation or judgement is
 * rejected rather than rendered. The deterministic describeBlock() output is
 * passed to the model as the canonical reference so numbers cannot drift.
 */
export async function describeBlockLLM(
  block: DescribableBlock,
  llmComplete: LlmComplete,
  registry: DescribeRegistry = loadDescribeRegistry(),
): Promise<string> {
  const reference = describeBlock(block, registry);
  const prompt = [
    "Rewrite the following analytics block description as ONE neutral, factual sentence.",
    "Rules: restate only the figures given; do NOT add causes, judgements, or recommendations;",
    "do not introduce any number not already present.",
    "",
    `block_type: ${block.block_type}`,
    `facts: ${JSON.stringify(block.description_facts ?? {})}`,
    `reference: ${reference}`,
  ].join("\n");

  const raw = await llmComplete(prompt);
  const out = raw.replace(/\s+/g, " ").trim();
  if (out.length === 0) {
    // Fall back to the deterministic description rather than emit an empty caption.
    return reference;
  }
  assertDescriptive(out);
  return out;
}
