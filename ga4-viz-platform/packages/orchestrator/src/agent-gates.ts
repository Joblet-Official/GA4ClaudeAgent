/**
 * Per-agent output gate (per-agent isolation).
 *
 * After every agent step the orchestrator validates THAT agent's output on its
 * own, so each agent passes or fails on its own merits:
 *   (a) JSON schema (validateAgentOutput)
 *   (b) prompt-leak guard on the output's visible text (assertNoPromptLeak)
 *   (c) the agent-specific rule:
 *         A5 → assertDescriptive on every block description / caption
 *         A6 → assertPaletteAllowed + assertNoPromptLeak on emitted HTML (if any)
 *
 * On any failure this throws — naming the failing agent — so the orchestrator
 * HALTS the turn and reports which agent failed and why. This does not change
 * the FSM transitions; it only widens the validation already run at each handoff.
 */
import { assertNoPromptLeak, collectVisibleText, visibleTextFromHtml } from "@gvp/contracts";
import { assertDescriptive, assertPaletteAllowed } from "@gvp/agents";
import { validateAgentOutput } from "./validator.js";
import type { AgentId } from "./types.js";

/** Collect strings under description/caption keys (recursively) for the A5 descriptive rule. */
function collectDescriptions(value: unknown): string[] {
  const out: string[] = [];
  const DESC_KEYS = new Set(["description", "caption"]);
  const visit = (node: unknown, underDescKey: boolean): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (underDescKey) out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, underDescKey);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, DESC_KEYS.has(k));
      }
    }
  };
  visit(value, false);
  return out;
}

/** Find an HTML string in an A6 output, if one is carried (else null). */
function extractHtml(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const HTML_KEYS = ["html", "report_html", "rendered_html", "document_html"];
  const obj = value as Record<string, unknown>;
  for (const k of HTML_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && /<[a-z][\s\S]*>/i.test(v)) return v;
  }
  return null;
}

/**
 * Independently validate one agent's output. Throws (naming the agent) on any
 * of: schema invalid, prompt leak in visible text, A5 non-descriptive caption,
 * A6 palette violation or HTML leak.
 */
export async function gateAgentOutput(agentId: AgentId, output: unknown): Promise<void> {
  // (a) schema — throws SchemaValidationError(agentId, …)
  await validateAgentOutput(agentId, output);

  // (b) prompt-leak on the output's visible text (caption/label/heading/etc.)
  assertNoPromptLeak(collectVisibleText(output), agentId);

  // (c) agent-specific rule
  if (agentId === "A5") {
    for (const text of collectDescriptions(output)) {
      try {
        assertDescriptive(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`[A5] descriptive-guard rejected a caption: ${msg}`);
      }
    }
  } else if (agentId === "A6") {
    const html = extractHtml(output);
    if (html) {
      assertPaletteAllowed(html); // throws PaletteViolationError on a bad colour
      assertNoPromptLeak(visibleTextFromHtml(html), agentId);
    }
  }
}
