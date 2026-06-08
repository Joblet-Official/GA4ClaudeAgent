/**
 * A6 — palette lint (descriptive-only colour policy).
 *
 * assertPaletteAllowed(html) scans every colour value A6 emits — in <style>
 * CSS, inline style="" attributes, and SVG fill/stroke/etc. attributes — and
 * throws if any colour is outside the registry allow-list, or if the peach
 * partial-period colour appears on a node that is NOT tagged .partial.
 *
 * The allow-list (identity blue scale + neutrals + grey + structural keywords)
 * and the partial-only peach come from packages/registry-data/viz-registry.json
 * (colour_policy.allowed_palette + colour_policy.partial_only_colour). There are
 * NO editorial tokens (no --good/--bad, no red/green): a colour outside the list
 * is rejected, full stop.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIZ_REGISTRY_PATH = resolve(__dirname, "..", "..", "registry-data", "viz-registry.json");

/** Thrown when emitted HTML uses a colour outside the allow-list (or misuses peach). */
export class PaletteViolationError extends Error {
  public readonly colour: string;
  constructor(colour: string, reason: string) {
    super(`assertPaletteAllowed: ${reason} (colour ${JSON.stringify(colour)}).`);
    this.name = "PaletteViolationError";
    this.colour = colour;
  }
}

interface ColourPolicy {
  identity_palette?: string[];
  colour_purposes?: Record<string, string>;
  allowed_palette?: string[];
  partial_only_colour?: string;
}

export interface PaletteAllowlist {
  /** Lower-cased set of every permitted colour value (hex expanded to 6-digit + keywords). */
  allowed: Set<string>;
  /** The peach partial-period colour (lower-cased, 6-digit), permitted only on .partial nodes. */
  peach: string | null;
}

/** Expand #abc → #aabbcc; lower-case; pass keywords through unchanged (lower-cased). */
function normaliseColour(raw: string): string {
  let c = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) {
    c = "#" + c[1]! + c[1]! + c[2]! + c[2]! + c[3]! + c[3]!;
  }
  return c;
}

let _cache: PaletteAllowlist | undefined;

/** Build the allow-list from the viz registry's colour_policy. */
export function loadPaletteAllowlist(): PaletteAllowlist {
  if (_cache) return _cache;
  const raw = readFileSync(VIZ_REGISTRY_PATH, "utf-8");
  const policy = (JSON.parse(raw) as { colour_policy?: ColourPolicy }).colour_policy ?? {};
  const allowed = new Set<string>();
  for (const c of policy.allowed_palette ?? []) allowed.add(normaliseColour(c));
  // identity palette + neutral text purposes are always allowed.
  for (const c of policy.identity_palette ?? []) allowed.add(normaliseColour(c));
  for (const key of ["sentinel", "default_text", "muted_text"]) {
    const v = policy.colour_purposes?.[key];
    if (typeof v === "string") allowed.add(normaliseColour(v));
  }
  // Structural keywords are always permitted.
  for (const kw of ["transparent", "none", "currentcolor", "inherit", "unset", "initial"]) {
    allowed.add(kw);
  }
  const peach = policy.partial_only_colour
    ? normaliseColour(policy.partial_only_colour)
    : policy.colour_purposes?.partial_period
      ? normaliseColour(policy.colour_purposes.partial_period)
      : null;
  _cache = { allowed, peach };
  return _cache;
}

/** Test hook: drop the cached allow-list. */
export function _clearPaletteAllowlistCache(): void {
  _cache = undefined;
}

// Colour-bearing CSS properties / SVG attributes we validate.
const COLOUR_PROPS =
  "fill|stroke|stop-color|flood-color|lighting-color|color|background|background-color|border|border-color|border-top-color|border-bottom-color|border-left-color|border-right-color|outline|outline-color|box-shadow|text-shadow";

// A colour value: hex, rgb()/rgba(), hsl()/hsla(), or a bare word (named colour / keyword).
const COLOUR_VALUE_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const DECL_RE = new RegExp(`(?:${COLOUR_PROPS})\\s*[:=]\\s*["']?([^;"'>{}]+)`, "gi");

/** Pull individual colour tokens out of a CSS/attribute value string. */
function coloursIn(value: string): string[] {
  const out: string[] = [];
  const hexFns = value.match(COLOUR_VALUE_RE);
  if (hexFns) out.push(...hexFns);
  return out.map(normaliseColour);
}

/** True if a tag string or CSS selector marks the node as a partial-period node. */
function isPartialContext(context: string): boolean {
  // class="… partial …"  OR a CSS selector containing .partial
  if (/class\s*=\s*["'][^"']*\bpartial\b[^"']*["']/i.test(context)) return true;
  if (/\.partial\b/.test(context)) return true;
  return false;
}

/**
 * Scan emitted HTML and throw on the first colour violation:
 *   - any colour value outside the allow-list, or
 *   - the peach partial-period colour on a node/selector not tagged .partial.
 * Scans <style> CSS, inline style="" attributes, and SVG colour attributes.
 */
export function assertPaletteAllowed(
  html: string,
  allowlist: PaletteAllowlist = loadPaletteAllowlist(),
): void {
  if (typeof html !== "string" || html.length === 0) return;
  const { allowed, peach } = allowlist;

  const check = (value: string, context: string): void => {
    for (const colour of coloursIn(value)) {
      if (peach && colour === peach) {
        if (!isPartialContext(context)) {
          throw new PaletteViolationError(colour, "peach (partial-period) colour used on a non-.partial node");
        }
        continue; // peach on a .partial node is allowed
      }
      if (!allowed.has(colour)) {
        throw new PaletteViolationError(colour, "colour is outside the allowed palette");
      }
    }
  };

  // 1) <style> blocks: validate per CSS rule, with the selector as the .partial context.
  const styleBlocks = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  for (const block of styleBlocks) {
    const css = block.replace(/<\/?style[^>]*>/gi, "");
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let rule: RegExpExecArray | null;
    while ((rule = ruleRe.exec(css)) !== null) {
      const selector = rule[1] ?? "";
      const decls = rule[2] ?? "";
      let decl: RegExpExecArray | null;
      const dre = new RegExp(DECL_RE.source, "gi");
      while ((decl = dre.exec(decls)) !== null) {
        check(decl[1] ?? "", selector);
      }
    }
  }

  // 2) Element tags: inline style="" + SVG colour attributes, with the tag as the .partial context.
  const htmlNoStyle = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const tagRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(htmlNoStyle)) !== null) {
    const attrs = tag[2] ?? "";
    const dre = new RegExp(DECL_RE.source, "gi");
    let decl: RegExpExecArray | null;
    while ((decl = dre.exec(attrs)) !== null) {
      check(decl[1] ?? "", tag[0]);
    }
  }
}
