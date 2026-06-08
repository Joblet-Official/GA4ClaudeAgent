/**
 * Retry policy executor.
 *
 * Reads the retry rules declared in state-machine.example.json#/retry_policy
 * (also embedded structurally in this file as DEFAULT_POLICY) and wraps an
 * agent invocation with the appropriate retry behaviour.
 */
import type { AgentId } from "./types.js";

export type FailureClass =
  | "schema_validation_failure"
  | "llm_api_5xx"
  | "llm_api_timeout"
  | "llm_api_429"
  | "llm_api_4xx"
  | "ga4_5xx"
  | "ga4_429"
  | "ga4_403_404_400"
  | "ga4_401"
  | "catalog_read_error"
  | "computation_overflow"
  | "io_write_failure";

export interface RetryRule {
  agent: AgentId;
  failure_class: FailureClass;
  action:
    | "retry_with_prompt_nudge"
    | "exponential_backoff"
    | "honor_retry_after"
    | "no_retry_surface"
    | "no_retry_escalate";
  max_attempts: number;
  backoff_seconds?: number[];
}

/**
 * Default policy mirrors state-machine.example.json#/retry_policy/rules.
 * If the JSON spec changes, update this AND verify with audit.
 */
export const DEFAULT_POLICY: RetryRule[] = [
  { agent: "A1", failure_class: "schema_validation_failure", action: "retry_with_prompt_nudge", max_attempts: 1 },
  { agent: "A1", failure_class: "llm_api_5xx",               action: "exponential_backoff",     max_attempts: 2, backoff_seconds: [1, 4] },
  { agent: "A1", failure_class: "llm_api_timeout",           action: "exponential_backoff",     max_attempts: 2, backoff_seconds: [1, 4] },
  { agent: "A1", failure_class: "llm_api_429",               action: "honor_retry_after",       max_attempts: 1 },
  { agent: "A1", failure_class: "llm_api_4xx",               action: "no_retry_surface",        max_attempts: 0 },

  { agent: "A2", failure_class: "schema_validation_failure", action: "retry_with_prompt_nudge", max_attempts: 1 },
  { agent: "A2", failure_class: "catalog_read_error",        action: "no_retry_escalate",       max_attempts: 0 },
  { agent: "A2", failure_class: "llm_api_5xx",               action: "exponential_backoff",     max_attempts: 2, backoff_seconds: [1, 4] },
  { agent: "A2", failure_class: "llm_api_timeout",           action: "exponential_backoff",     max_attempts: 2, backoff_seconds: [1, 4] },

  { agent: "A3", failure_class: "schema_validation_failure", action: "retry_with_prompt_nudge", max_attempts: 1 },

  { agent: "A4", failure_class: "ga4_5xx",                   action: "exponential_backoff",     max_attempts: 3, backoff_seconds: [1, 4, 9] },
  { agent: "A4", failure_class: "ga4_429",                   action: "honor_retry_after",       max_attempts: 2 },
  { agent: "A4", failure_class: "ga4_403_404_400",           action: "no_retry_surface",        max_attempts: 0 },
  { agent: "A4", failure_class: "ga4_401",                   action: "no_retry_escalate",       max_attempts: 0 },

  { agent: "A5", failure_class: "schema_validation_failure", action: "retry_with_prompt_nudge", max_attempts: 1 },
  { agent: "A5", failure_class: "computation_overflow",      action: "no_retry_surface",        max_attempts: 0 },

  { agent: "A6", failure_class: "schema_validation_failure", action: "retry_with_prompt_nudge", max_attempts: 1 },
  { agent: "A6", failure_class: "io_write_failure",          action: "no_retry_surface",        max_attempts: 0 },
];

/** Look up a rule by (agent, failure class). Returns undefined when no policy applies. */
export function getRule(agent: AgentId, failureClass: FailureClass): RetryRule | undefined {
  return DEFAULT_POLICY.find((r) => r.agent === agent && r.failure_class === failureClass);
}

/**
 * Sleep helper for exponential backoff. Awaitable.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Wrap an async operation with retry semantics based on a rule. The `classify`
 * callback maps a thrown Error to a FailureClass; if it returns undefined the
 * error is rethrown immediately (unhandled failure class).
 */
export async function withRetry<T>(
  agent: AgentId,
  op: () => Promise<T>,
  classify: (e: Error) => FailureClass | undefined,
): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (true) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      const err = e as Error;
      const cls = classify(err);
      if (!cls) throw err;
      const rule = getRule(agent, cls);
      if (!rule || rule.max_attempts === 0) throw err;
      if (attempt >= rule.max_attempts) throw err;
      if (rule.action === "exponential_backoff") {
        const seconds = rule.backoff_seconds?.[attempt] ?? 1;
        await sleep(seconds * 1000);
      }
      // honor_retry_after / retry_with_prompt_nudge: just loop (caller would normally inspect headers)
      attempt++;
    }
  }
  throw lastErr;
}
