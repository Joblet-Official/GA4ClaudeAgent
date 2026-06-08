#!/usr/bin/env node
/**
 * guard_report.mjs — HARD guard for the LIVE A6 render path.
 *
 * Runs the two descriptive-only guards over a finished HTML report and FAILS
 * (exit 1) on any violation, so A6 can refuse to deliver an off-policy file.
 *
 *   node scripts/guard_report.mjs <path-to-report.html>
 *
 * Faithful port of:
 *   - assertPaletteAllowed  (ga4-viz-platform/packages/agents/src/palette.ts)
 *   - assertNoPromptLeak    (ga4-viz-platform/packages/contracts/src/guards.ts)
 *
 * Deliberate extension over the monorepo port: the live A6 emits monochrome
 * intensity shading as rgb()/rgba() (heatmap cells, the policy's
 * z_score_encoding = monochrome_intensity_blue). We normalise rgb()/rgba() to
 * its base hex (alpha ignored) before the allow-list check — so navy/grey/white
 * intensity shading passes, while any genuinely off-palette colour still fails.
 *
 * Allow-list source of truth: ga4-viz-platform/packages/registry-data/
 * viz-registry.json -> colour_policy. Baked in here so the live runtime needs
 * no cross-repo dependency at runtime; `check_guard_sync.mjs` asserts the baked
 * copy has not drifted from canonical (run it in CI / before relying on the guard).
 *
 * ALLOWED / PEACH / paletteViolations / leakViolations are exported so the
 * drift checker can import them WITHOUT running the CLI (guarded at the bottom).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---- colour policy (mirror of viz-registry.json colour_policy) --------------
export const ALLOWED = new Set(
  [
    "#2e5c8a", "#1f3f63", "#3730a3", "#94a3b8", "#6b7280", "#1f2937",
    "#e5e7eb", "#f8fafc", "#ffffff", "#000000",
    "transparent", "none", "currentcolor", "inherit", "unset", "initial",
  ].map((c) => c.toLowerCase()),
);
export const PEACH = "#fff3e0"; // partial-period colour — allowed ONLY on .partial nodes

// ---- palette guard ---------------------------------------------------------
function expandHex(c) {
  if (/^#[0-9a-f]{3}$/.test(c)) return "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7); // #rrggbbaa -> drop alpha
  return c;
}
function rgbToHex(fn) {
  const nums = (fn.match(/-?\d*\.?\d+%?/g) || []).slice(0, 3).map((n) => {
    if (n.endsWith("%")) return Math.round((parseFloat(n) / 100) * 255);
    return Math.round(parseFloat(n));
  });
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return fn; // leave odd values to fail
  return "#" + nums.map((n) => n.toString(16).padStart(2, "0")).join("");
}
function normaliseColour(raw) {
  let c = raw.trim().toLowerCase();
  if (c.startsWith("rgb")) return rgbToHex(c);
  if (c.startsWith("hsl")) return c; // hsl not used by A6; leave to fail if present
  return expandHex(c);
}
const COLOUR_PROPS =
  "fill|stroke|stop-color|flood-color|lighting-color|color|background|background-color|border|border-color|border-top-color|border-bottom-color|border-left-color|border-right-color|outline|outline-color|box-shadow|text-shadow";
const COLOUR_VALUE_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const DECL_SRC = `(?:${COLOUR_PROPS})\\s*[:=]\\s*["']?([^;"'>{}]+)`;

function coloursIn(value) {
  const m = value.match(COLOUR_VALUE_RE);
  return m ? m.map(normaliseColour) : [];
}
function isPartialContext(ctx) {
  return /class\s*=\s*["'][^"']*\bpartial\b[^"']*["']/i.test(ctx) || /\.partial\b/.test(ctx);
}
export function paletteViolations(html) {
  const out = [];
  const check = (value, ctx) => {
    for (const colour of coloursIn(value)) {
      if (colour === PEACH) {
        if (!isPartialContext(ctx)) out.push(`peach ${colour} on non-.partial node`);
        continue;
      }
      if (!ALLOWED.has(colour)) out.push(`off-palette colour ${colour}`);
    }
  };
  // 1) <style> rules (selector = .partial context)
  for (const block of html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []) {
    const css = block.replace(/<\/?style[^>]*>/gi, "");
    let rule;
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    while ((rule = ruleRe.exec(css)) !== null) {
      const selector = rule[1] || "";
      const decls = rule[2] || "";
      let decl;
      const dre = new RegExp(DECL_SRC, "gi");
      while ((decl = dre.exec(decls)) !== null) check(decl[1] || "", selector);
    }
  }
  // 2) element tags (tag = .partial context)
  const noStyle = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  let tag;
  const tagRe = /<([a-zA-Z][\w-]*)\b([^>]*)>/g;
  while ((tag = tagRe.exec(noStyle)) !== null) {
    let decl;
    const dre = new RegExp(DECL_SRC, "gi");
    while ((decl = dre.exec(tag[2] || "")) !== null) check(decl[1] || "", tag[0]);
  }
  return [...new Set(out)];
}

// ---- prompt-leak guard -----------------------------------------------------
const RULES = [
  // identity / role
  "you are", "as an ai", "language model", "system prompt", "my instructions",
  "per my instructions", "i will now", "i am agent", /as the\b[^.]*?\bagent\b/i,
  // chain-of-thought
  "let me ", "first, i", "thinking:", "reasoning:", "<thinking", "step-by-step",
  // orchestration / spec internals
  "execute:", "(always)", "conditional — executed", "conditional - executed",
  "trigger: ran", "tier-2", "tier 2 override", "marker event", "symmetric difference",
  "condition is met", /step\s+\d+\s+of\s+\d+/i, /stage\s+\d+\s+\(/i, />=\s*\d+\s*condition/i,
  // internal identifiers
  /\bagent\s+[1-6]\b/i, /\bA[1-6]\b/, "block_pattern", "viz_registry", "html_file_writer",
  "assignnarrativestage", "narrative_stage_map", /\bsec_[a-z0-9]+/i,
];
function visibleTextFromHtml(html) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}
export function leakViolations(html) {
  const text = visibleTextFromHtml(html);
  const lower = text.toLowerCase();
  const out = [];
  for (const rule of RULES) {
    if (typeof rule === "string") {
      if (lower.includes(rule)) out.push(`leak token ${JSON.stringify(rule)}`);
    } else if (rule.test(text)) {
      const m = text.match(rule);
      out.push(`leak pattern ${JSON.stringify(m ? m[0] : rule.source)}`);
    }
  }
  return [...new Set(out)];
}

// ---- CLI (only when run directly, not when imported) -----------------------
function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/guard_report.mjs <report.html>");
    process.exit(2);
  }
  let html;
  try {
    html = readFileSync(path, "utf-8");
  } catch (e) {
    console.error(`GUARD ERROR: cannot read ${path}: ${e.message}`);
    process.exit(2);
  }
  const pal = paletteViolations(html);
  const leak = leakViolations(html);
  if (pal.length === 0 && leak.length === 0) {
    console.log(`GUARD PASS  ${path}  (palette ok, no prompt leak)`);
    process.exit(0);
  }
  console.error(`GUARD FAIL  ${path}`);
  if (pal.length) console.error("  palette violations:\n" + pal.map((v) => "    - " + v).join("\n"));
  if (leak.length) console.error("  prompt-leak violations:\n" + leak.map((v) => "    - " + v).join("\n"));
  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
