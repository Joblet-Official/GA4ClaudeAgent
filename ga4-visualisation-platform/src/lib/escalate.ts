/**
 * Flash -> Pro escalation layer (additive; modifies no existing brain).
 *
 * classifyFailure(err): is this failure model-attributable (escalate) or
 * environmental/structural (surface)? withEscalation(primary, fallback): run
 * the primary (Flash) attempt; on a classified-escalatable failure, retry ONCE
 * with the fallback (Pro), then surface. One bounded retry — a failure Pro also
 * hits is structural, not model, so it is surfaced.
 *
 * Escalate ON (model-attributable): timeout, empty response, malformed/JSON
 * parse failure, schema-validation failure, invalid structured output, refusal,
 * output that fails downstream validation.
 *
 * Escalate NEVER (surface the true error): missing GA4 data/permissions,
 * invalid credentials, missing env vars, quota exhaustion, infrastructure (5xx),
 * network failures, deterministic/code failures, missing dependencies.
 */

export type FailureClass = "escalate" | "surface";

export interface ClassifiedFailure {
  klass: FailureClass;
  reason: string;
}

/** Lowercased substrings marking an environmental/structural failure — surface. */
const SURFACE_HINTS = [
  "permission",
  "unauthor",
  "forbidden",
  "credential",
  "api key",
  "is not set",
  "quota",
  "rate limit",
  "too many requests",
  "network",
  "econnrefused",
  "econnreset",
  "enotfound",
  "fetch failed",
  "connection error",
  "ga4",
  "property",
  "runreport",
  "google_application_credentials",
  "ga4_property_id",
  "missing dependency",
  "cannot read prop",
];

/** Lowercased substrings marking a model-attributable failure — escalate. */
const ESCALATE_HINTS = [
  "timed out",
  "timeout",
  "empty response",
  "no content",
  "not valid json",
  "json parse",
  "unexpected end of json",
  "schema validation",
  "failed validation",
  "failed schema",
  "invalid structured output",
  "refus", // refused / refusal
  "content filter",
  "could not parse",
  "downstream validation",
];

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; code?: number; response?: { status?: number } };
  if (typeof e?.status === "number") return e.status;
  if (typeof e?.response?.status === "number") return e.response.status;
  if (typeof e?.code === "number") return e.code;
  return undefined;
}

export function classifyFailure(err: unknown): ClassifiedFailure {
  const name = ((err as Error)?.name ?? "").toLowerCase();
  const msg = ((err as Error)?.message ?? String(err ?? "")).toLowerCase();
  const status = statusOf(err);

  // 1. HTTP status decides the clear environmental cases first.
  if (status === 401 || status === 403) return { klass: "surface", reason: `auth/permission (HTTP ${status})` };
  if (status === 429) return { klass: "surface", reason: "quota / rate limit (HTTP 429)" };
  if (typeof status === "number" && status >= 500) return { klass: "surface", reason: `provider infrastructure (HTTP ${status})` };

  // 2. Typed validation errors from the brains (schema / JSON) always escalate,
  //    checked before message-substring surface hints (Zod messages can contain
  //    words like "missing" that would otherwise look environmental).
  if (/validationerror/.test(name)) return { klass: "escalate", reason: "typed validation error (schema/JSON)" };

  // 3. Environmental / structural hints surface.
  for (const h of SURFACE_HINTS) {
    if (msg.includes(h)) return { klass: "surface", reason: `environmental/structural ("${h}")` };
  }

  // 4. Model-attributable hints escalate.
  for (const h of ESCALATE_HINTS) {
    if (msg.includes(h)) return { klass: "escalate", reason: `model-attributable ("${h}")` };
  }

  // 5. Unknown -> surface (never mask an unrecognised error behind a model retry).
  return { klass: "surface", reason: "unclassified (surfaced, not escalated)" };
}

export interface EscalationOutcome<T> {
  value: T;
  usedFallback: boolean;
  primaryError?: string;
  primaryClass?: FailureClass;
}

/**
 * Run `primary` (Flash). If it throws (or `opts.validate` rejects its output) and
 * the failure classifies as escalatable, run `fallback` (Pro) ONCE. A surface-class
 * failure is rethrown unchanged. The validate hook lets "output that cannot pass
 * downstream validation" trigger an escalation by throwing.
 */
export async function withEscalation<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  opts?: { validate?: (v: T) => void },
): Promise<EscalationOutcome<T>> {
  try {
    const v = await primary();
    if (opts?.validate) opts.validate(v);
    return { value: v, usedFallback: false };
  } catch (err) {
    const c = classifyFailure(err);
    if (c.klass === "surface") throw err;
    const v = await fallback();
    if (opts?.validate) opts.validate(v);
    return {
      value: v,
      usedFallback: true,
      primaryError: (err as Error)?.message ?? String(err),
      primaryClass: c.klass,
    };
  }
}
