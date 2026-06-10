/**
 * Canonical model-routing map for the Orchestrator Brain + the six Brains.
 *
 * This file is NON-SECRET configuration. API keys are never here — the provider
 * layer (lib/nvidia.ts) reads them from env via each provider's apiKeyEnv. The
 * existing per-brain env overrides (LLM_PROVIDER_<BRAIN> / LLM_MODEL_<BRAIN>)
 * still take precedence at the getClient layer; this map is the canonical
 * default the Orchestrator and escalation layer consult.
 *
 * Target production routing (DeepSeek):
 *   Orchestrator → Pro
 *   Brain 1 → Pro
 *   Brain 2 → Pro
 *   Brain 3 → Flash (→ Pro on failure)
 *   Brain 4 → Flash (→ Pro on failure)
 *   Brain 5 → Flash (→ Pro on failure)
 *   Brain 6 → Pro
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

export const BRAIN_ROUTING: Record<BrainName, BrainRoute> = {
  orchestrator: { provider: "deepseek_pro", model: DEEPSEEK_PRO_MODEL, escalate: false },
  brain1: { provider: "deepseek_pro", model: DEEPSEEK_PRO_MODEL, escalate: false },
  brain2: { provider: "deepseek_pro", model: DEEPSEEK_PRO_MODEL, escalate: false },
  brain3: {
    provider: "deepseek_flash",
    model: DEEPSEEK_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "deepseek_pro",
    fallbackModel: DEEPSEEK_PRO_MODEL,
  },
  brain4: {
    provider: "deepseek_flash",
    model: DEEPSEEK_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "deepseek_pro",
    fallbackModel: DEEPSEEK_PRO_MODEL,
  },
  brain5: {
    provider: "deepseek_flash",
    model: DEEPSEEK_FLASH_MODEL,
    escalate: true,
    fallbackProvider: "deepseek_pro",
    fallbackModel: DEEPSEEK_PRO_MODEL,
  },
  brain6: { provider: "deepseek_pro", model: DEEPSEEK_PRO_MODEL, escalate: false },
};

export function routeFor(brain: BrainName): BrainRoute {
  return BRAIN_ROUTING[brain];
}
