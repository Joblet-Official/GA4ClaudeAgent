/**
 * Canonical model-routing map for the Orchestrator Brain + the six Brains.
 *
 * This file is NON-SECRET configuration. API keys are never here — the provider
 * layer (lib/nvidia.ts) reads them from env via each provider's apiKeyEnv. The
 * existing per-brain env overrides (LLM_PROVIDER_<BRAIN> / LLM_MODEL_<BRAIN>)
 * still take precedence at the getClient layer; this map is the canonical
 * default the Orchestrator and escalation layer consult.
 *
 * Target production routing (Claude Fable — user directive 2026-06-11,
 * supersedes the DeepSeek allocation; DeepSeek entries remain inert fallbacks):
 *   Orchestrator → Fable
 *   Brain 1 → Fable
 *   Brain 2 → Fable
 *   Brain 3 → Fable (escalate: bounded retry → Fable on classified failure)
 *   Brain 4 → Fable (escalate: bounded retry → Fable on classified failure)
 *   Brain 5 → Fable (escalate: bounded retry → Fable on classified failure)
 *   Brain 6 → Fable
 *
 * The Flash→Pro two-tier shape is PRESERVED structurally: B3/B4/B5 keep
 * `escalate: true` + fallback fields, so withEscalation still grants the one
 * bounded retry on model-attributable failures. With a single Fable SKU the
 * retry is same-model; point FABLE_FLASH_MODEL at a cheaper SKU (e.g.
 * claude-haiku-4-5) to restore a true two-tier split — env-only, no code.
 */
import type { Provider } from "@/lib/nvidia";

export type BrainName =
  | "orchestrator"
  | "brain1"
  | "brain2"
  | "brain3"
  | "brain4"
  | "brain5"
  | "brain6";

export interface BrainRoute {
  /** Primary provider for this brain. */
  provider: Provider;
  /** Primary model id. */
  model: string;
  /** When true, a classified Flash failure retries once on the fallback (Pro). */
  escalate: boolean;
  fallbackProvider?: Provider;
  fallbackModel?: string;
}

// Model ids are host-specific (NVIDIA gateway: "deepseek-ai/..."; official
// DeepSeek API: bare ids). Env wins so a host switch is config-only; the NVIDIA
// ids remain the fallback.
export const DEEPSEEK_PRO_MODEL = process.env.DEEPSEEK_PRO_MODEL || "deepseek-ai/deepseek-v4-pro";
export const DEEPSEEK_FLASH_MODEL = process.env.DEEPSEEK_FLASH_MODEL || "deepseek-ai/deepseek-v4-flash";

// Fable model ids. Env wins so a SKU change is config-only. FABLE_FLASH_MODEL
// exists to preserve the two-tier (fast primary → strong fallback) shape of
// the routing map; it defaults to the same Fable SKU per the user's
// "all brains on Fable" directive.
export const FABLE_MODEL = process.env.FABLE_MODEL || "claude-fable-5";
export const FABLE_FLASH_MODEL = process.env.FABLE_FLASH_MODEL || FABLE_MODEL;

export const BRAIN_ROUTING: Record<BrainName, BrainRoute> = {
  orchestrator: { provider: "fable", model: FABLE_MODEL, escalate: false },
  brain1: { provider: "fable", model: FABLE_MODEL, escalate: false },
  brain2: { provider: "fable", model: FABLE_MODEL, escalate: false },
  brain3: {
    provider: "fable",
    model: FABLE_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "fable",
    fallbackModel: FABLE_MODEL,
  },
  brain4: {
    provider: "fable",
    model: FABLE_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "fable",
    fallbackModel: FABLE_MODEL,
  },
  brain5: {
    provider: "fable",
    model: FABLE_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "fable",
    fallbackModel: FABLE_MODEL,
  },
  brain6: { provider: "fable", model: FABLE_MODEL, escalate: false },
};

export function routeFor(brain: BrainName): BrainRoute {
  return BRAIN_ROUTING[brain];
}
