/**
 * Tracking Availability — deterministic metadata analysis over the Tracking
 * Metadata Registry (catalog/tracking_metadata.json).
 *
 * Answers: "for the date range this query requested, was the GTM tag behind the
 * referenced event(s) actually deployed/active?" — three-state, conservative:
 *
 *   - covered      → known window fully contains the range: no annotation.
 *   - not_covered  → a KNOWN boundary (manual/exact dates) excludes part of the
 *                    range: definitive statement ("Data before X is unavailable
 *                    because this tag had not yet been deployed.").
 *   - unverified   → the boundary is unknown and the range starts before the
 *                    tag's first PROOF of existence (fingerprint/snapshot):
 *                    hedged statement, never a definitive claim.
 *
 * This is REPORTING/data-quality only: it never plans, rewrites or trims
 * queries (Brain 2/3's domain), and it never touches retrieval (Brain 4).
 * All sentences are code-templated — no LLM authorship of any date or claim.
 */
import rawRegistry from "../../../catalog/tracking_metadata.json";
import type { Query } from "@/schemas/metrics";

export interface TagAvailability {
  deployed_on: string | null;
  deployed_on_precision: "exact" | "unknown";
  first_observed: string | null;
  deactivated_on: string | null;
  deactivated_on_precision: "exact" | "unknown";
  last_observed: string | null;
  paused?: boolean;
  provenance: string;
}

export interface TrackingTag {
  tag_name: string;
  tag_type: string | null;
  events: string[];
  availability: TagAvailability;
  ownership: { owner: string | null; team: string | null; contact: string | null };
  deployment_notes: string[];
  change_history: Array<{ date: string; change: string; source: string }>;
}

export interface TrackingRegistry {
  schema_version: number;
  generated_at: string | null;
  limitations: string[];
  tags: TrackingTag[];
}

let _cache: TrackingRegistry | null = null;

export function loadTrackingRegistry(force = false): TrackingRegistry {
  if (_cache && !force) return _cache;
  _cache = rawRegistry as unknown as TrackingRegistry;
  return _cache;
}

export type AvailabilityStatus = "not_covered" | "unverified";

export interface AvailabilityAnnotation {
  tag_name: string;
  events: string[];
  query_ids: string[];
  status: AvailabilityStatus;
  /** Code-templated, user-facing statement. */
  message: string;
  provenance: string;
}

// ---------------------------------------------------------------------------
// Event extraction — which GTM events does a query actually reference?
// ---------------------------------------------------------------------------

/** Recursively collect eventName values referenced in a GA4 filter expression. */
function collectEventNames(expr: unknown, out: Set<string>): void {
  if (expr == null || typeof expr !== "object") return;
  const node = expr as Record<string, unknown>;
  const f = node["filter"] as Record<string, unknown> | undefined;
  if (f && f["fieldName"] === "eventName") {
    const sf = f["stringFilter"] as { value?: unknown } | undefined;
    if (typeof sf?.value === "string") out.add(sf.value);
    const ilf = f["inListFilter"] as { values?: unknown } | undefined;
    if (Array.isArray(ilf?.values)) for (const v of ilf.values) if (typeof v === "string") out.add(v);
  }
  for (const key of ["andGroup", "orGroup"]) {
    const g = node[key] as { expressions?: unknown[] } | undefined;
    if (Array.isArray(g?.expressions)) g.expressions.forEach((e) => collectEventNames(e, out));
  }
  if (node["notExpression"]) collectEventNames(node["notExpression"], out);
}

export function eventsReferencedBy(q: Query): string[] {
  const out = new Set<string>();
  collectEventNames(q.request_body.dimensionFilter, out);
  collectEventNames(q.request_body.metricFilter, out);
  return [...out];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

interface Finding {
  status: AvailabilityStatus;
  message: string;
}

/** Compare one date range against one tag's availability window. ISO string compare. */
function judge(tag: TrackingTag, start: string, end: string): Finding[] {
  const a = tag.availability;
  const findings: Finding[] = [];

  if (a.deployed_on && a.deployed_on_precision === "exact" && start < a.deployed_on) {
    findings.push({
      status: "not_covered",
      message: `Data before ${a.deployed_on} is unavailable because tag "${tag.tag_name}" had not yet been deployed.`,
    });
  } else if (!a.deployed_on && a.first_observed && start < a.first_observed) {
    findings.push({
      status: "unverified",
      message: `Tag "${tag.tag_name}" has no known deployment date; data completeness before ${a.first_observed} (first observed) cannot be verified.`,
    });
  }

  if (a.deactivated_on && a.deactivated_on_precision === "exact" && end > a.deactivated_on) {
    findings.push({
      status: "not_covered",
      message: `Data after ${a.deactivated_on} is unavailable because tag "${tag.tag_name}" was no longer active.`,
    });
  }

  return findings;
}

/**
 * Analyse the approved queries against the registry. Pure + injectable for
 * tests. Annotations are deduped by (tag, message) with query ids collected.
 */
export function analyzeTrackingAvailability(
  queries: Query[],
  registry: TrackingRegistry = loadTrackingRegistry(),
): AvailabilityAnnotation[] {
  const tagByEvent = new Map<string, TrackingTag>();
  for (const t of registry.tags) for (const e of t.events) tagByEvent.set(e, t);

  const byKey = new Map<string, AvailabilityAnnotation>();
  for (const q of queries) {
    const events = eventsReferencedBy(q);
    if (!events.length) continue;
    const ranges = q.request_body.dateRanges ?? [];
    for (const ev of events) {
      const tag = tagByEvent.get(ev);
      if (!tag) continue; // GA4 built-ins (session_start, page_view, ...) have no tag window
      for (const r of ranges) {
        for (const f of judge(tag, r.startDate, r.endDate)) {
          const key = `${tag.tag_name}::${f.message}`;
          let ann = byKey.get(key);
          if (!ann) {
            ann = {
              tag_name: tag.tag_name,
              events: [],
              query_ids: [],
              status: f.status,
              message: f.message,
              provenance: tag.availability.provenance,
            };
            byKey.set(key, ann);
          }
          if (!ann.events.includes(ev)) ann.events.push(ev);
          if (!ann.query_ids.includes(q.id)) ann.query_ids.push(q.id);
        }
      }
    }
  }
  // Definitive findings first, then unverified.
  return [...byKey.values()].sort((a, b) =>
    a.status === b.status ? a.tag_name.localeCompare(b.tag_name) : a.status === "not_covered" ? -1 : 1,
  );
}
