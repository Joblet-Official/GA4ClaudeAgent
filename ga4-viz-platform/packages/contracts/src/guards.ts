/**
 * @gvp/contracts — runtime output guards (shared).
 *
 * assertNoPromptLeak(text) scans VISIBLE TEXT ONLY for strings that betray the
 * pipeline's internals — model/role identity, chain-of-thought, orchestration /
 * spec internals, and internal identifiers (agent ids, brain / tool / registry
 * names, section slugs). It is imported by the orchestrator (run on each agent's
 * serialized output) and by A6 (run on the final HTML's visible text).
 *
 * "Visible text" = caption / label / heading / text-node strings. It is NEVER
 * the id/class attributes or JSON keys — those legitimately carry slugs like
 * `sec_funnel`, `execute`, `narrative_stage`. Callers reduce a structure to its
 * visible text with collectVisibleText() (JSON) or visibleTextFromHtml() (HTML)
 * before calling assertNoPromptLeak().
 */

/** Thrown when visible text contains a prompt/internal leak. */
export class PromptLeakError extends Error {
  public readonly token: string;
  public readonly where: string | undefined;
  constructor(token: string, text: string, where?: string) {
    super(
      `assertNoPromptLeak${where ? ` [${where}]` : ""}: visible text leaks an internal token ` +
        `(${JSON.stringify(token)}). Rendered text must never expose model identity, ` +
        `chain-of-thought, orchestration/spec internals, or internal identifiers. ` +
        `Offending text: ${JSON.stringify(text.slice(0, 240))}`,
    );
    this.name = "PromptLeakError";
    this.token = token;
    this.where = where;
  }
}

/** A leak rule: a case-insensitive substring, or a RegExp tested as-is. */
type LeakRule = string | RegExp;

// identity / role
const IDENTITY: LeakRule[] = [
  "you are",
  "as an ai",
  "language model",
  "system prompt",
  "my instructions",
  "per my instructions",
  "i will now",
  "i am agent",
  /as the\b[^.]*?\bagent\b/i, // "as the * agent"
];

// chain-of-thought
const COT: LeakRule[] = [
  "let me ",
  "first, i",
  "thinking:",
  "reasoning:",
  "<thinking",
  "step-by-step",
];

// orchestration / spec internals
const SPEC: LeakRule[] = [
  "execute:",
  "(always)",
  "conditional — executed",
  "conditional - executed",
  "trigger: ran",
  "tier-2",
  "tier 2 override",
  "marker event",
  "symmetric difference",
  "condition is met",
  /step\s+\d+\s+of\s+\d+/i, // "Step N of M"
  /stage\s+\d+\s+\(/i, // "Stage N ("
  />=\s*\d+\s*condition/i, // ">=5 condition"
];

// internal identifiers
const IDENT: LeakRule[] = [
  /\bagent\s+[1-6]\b/i, // "agent 1".."agent 6"
  /\bA[1-6]\b/, // bare A1..A6 (case-sensitive: the role ids)
  "block_pattern",
  "viz_registry",
  "html_file_writer",
  "assignnarrativestage", // matched case-insensitively
  "narrative_stage_map",
  /\bsec_[a-z0-9]+/i, // internal section slugs sec_* surfacing as visible text
];

const ALL_RULES: LeakRule[] = [...IDENTITY, ...COT, ...SPEC, ...IDENT];

/**
 * Throw PromptLeakError if `text` contains any leak token. String rules match
 * case-insensitively as substrings; RegExp rules are tested as written.
 * `where` (e.g. an agent id) is included in the error for fail-fast naming.
 */
export function assertNoPromptLeak(text: string, where?: string): void {
  if (typeof text !== "string" || text.length === 0) return;
  const lower = text.toLowerCase();
  for (const rule of ALL_RULES) {
    if (typeof rule === "string") {
      if (lower.includes(rule)) throw new PromptLeakError(rule, text, where);
    } else if (rule.test(text)) {
      const m = text.match(rule);
      throw new PromptLeakError(m ? m[0] : rule.source, text, where);
    }
  }
}

// ---------------------------------------------------------------------------
// Visible-text extraction.
// ---------------------------------------------------------------------------

/**
 * Keys whose string values are RENDERED to the reader. Only these are scanned;
 * id/class/slug keys (block_id, section_id, narrative_stage, execute, …) are
 * skipped so internal slugs never trip the guard.
 */
const VISIBLE_TEXT_KEYS = new Set<string>([
  "caption",
  "label",
  "title",
  "report_title",
  "subtitle",
  "heading",
  "section_title",
  "stage_label",
  "intro",
  "handoff",
  "description",
  "text",
  "note",
  "notes",
  "eyebrow",
  "step_number", // legacy eyebrow field — if still present, it must be leak-free
]);

/**
 * Walk a JSON value and concatenate the strings found under VISIBLE_TEXT_KEYS
 * (including arrays of strings under those keys). Recurses through all nested
 * objects/arrays, but only collects strings that sit under a visible-text key —
 * never bare values under id/class/slug keys.
 */
export function collectVisibleText(value: unknown): string {
  const out: string[] = [];
  const visit = (node: unknown, underVisibleKey: boolean): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (underVisibleKey) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, underVisibleKey);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, VISIBLE_TEXT_KEYS.has(k));
      }
    }
  };
  visit(value, false);
  return out.join("\n");
}

/**
 * Reduce HTML to its visible text nodes: drop <style>/<script> blocks, strip all
 * tags (and therefore every id/class/style attribute), and decode the common
 * HTML entities. The result contains no attribute text — only what a reader sees.
 */
export function visibleTextFromHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Convenience: assert no leak in a JSON structure's visible text. */
export function assertNoPromptLeakInValue(value: unknown, where?: string): void {
  assertNoPromptLeak(collectVisibleText(value), where);
}

/** Convenience: assert no leak in an HTML document's visible text. */
export function assertNoPromptLeakInHtml(html: string, where?: string): void {
  assertNoPromptLeak(visibleTextFromHtml(html), where);
}
