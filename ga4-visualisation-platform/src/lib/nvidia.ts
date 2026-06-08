/**
 * LLM client — OpenAI-compatible, per-brain provider selection.
 *
 * Each brain calls `getClient("brainName")` to get its own configured client.
 * Provider and model resolve from env vars in this order:
 *
 *   provider:  LLM_PROVIDER_<BRAIN>   (e.g. LLM_PROVIDER_BRAIN2=cerebras)
 *           →  LLM_PROVIDER           (default for any brain)
 *           →  "nvidia"
 *
 *   model:     LLM_MODEL_<BRAIN>      (e.g. LLM_MODEL_BRAIN2=gpt-oss-120b)
 *           →  provider's defaultModel (per the table below)
 *
 * This lets us pin Brain 1 to fast-and-cheap Llama 3.3 70B on Groq while
 * routing Brain 2's much heavier (catalog-laden) prompt to Cerebras with its
 * 5× larger free TPM budget — without touching brain code.
 *
 * Provider/default-model matrix:
 *   nvidia    → build.nvidia.com           meta/llama-3.3-70b-instruct
 *   groq      → api.groq.com               llama-3.3-70b-versatile
 *   cerebras  → api.cerebras.ai            llama-3.3-70b              (use LLM_MODEL_* to override)
 *   together  → api.together.xyz           meta-llama/Llama-3.3-70B-Instruct-Turbo
 *
 * Hardened defaults on every client: maxRetries: 0, timeout: 25_000ms.
 */
import OpenAI from "openai";

type Provider = "nvidia" | "groq" | "cerebras" | "together" | "gemini";

interface ProviderConfig {
  baseURL: string;
  defaultModel: string;
  apiKeyEnv: string;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  nvidia: {
    baseURL: "https://integrate.api.nvidia.com/v1",
    defaultModel: "meta/llama-3.3-70b-instruct",
    apiKeyEnv: "NVIDIA_API_KEY",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  cerebras: {
    baseURL: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    apiKeyEnv: "CEREBRAS_API_KEY",
  },
  together: {
    baseURL: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  gemini: {
    // Google AI Studio's OpenAI-compatible endpoint. Free tier: 1M TPM, 15 RPM, 1500 RPD.
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-2.0-flash",
    apiKeyEnv: "GEMINI_API_KEY",
  },
};

function pickProvider(brain?: string): Provider {
  const brainKey = brain ? `LLM_PROVIDER_${brain.toUpperCase()}` : undefined;
  const raw = (brainKey && process.env[brainKey]) || process.env.LLM_PROVIDER || "nvidia";
  const norm = raw.toLowerCase();
  if (!(norm in PROVIDERS)) {
    throw new Error(
      `Provider '${raw}' is not supported. Use one of: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return norm as Provider;
}

function pickModel(provider: Provider, brain?: string): string {
  const brainKey = brain ? `LLM_MODEL_${brain.toUpperCase()}` : undefined;
  return (brainKey && process.env[brainKey]) || PROVIDERS[provider].defaultModel;
}

export interface BrainClient {
  client: OpenAI;
  model: string;
  provider: Provider;
}

const clientCache = new Map<string, BrainClient>();

export function getClient(brain?: string): BrainClient {
  const cacheKey = brain ?? "_default";
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  const provider = pickProvider(brain);
  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Provider ${provider} (used by ${brain ?? "default"}) requires ${cfg.apiKeyEnv} in .env.local.`,
    );
  }

  const model = pickModel(provider, brain);
  const client = new OpenAI({
    apiKey,
    baseURL: cfg.baseURL,
    maxRetries: 0,
    timeout: 25_000,
  });

  const out: BrainClient = { client, model, provider };
  clientCache.set(cacheKey, out);
  return out;
}

/** Reset cache — only used in tests when env vars change between calls. */
export function clearClientCache(): void {
  clientCache.clear();
}
