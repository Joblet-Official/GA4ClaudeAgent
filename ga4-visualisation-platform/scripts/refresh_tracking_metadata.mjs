/**
 * Tracking Metadata Registry generator.
 *
 * Builds catalog/tracking_metadata.json — the broad tracking registry
 * (availability windows + ownership + deployment notes + change history) —
 * from what is AUTOMATICALLY derivable:
 *   - GTM snapshot: tag inventory, per-tag fingerprint (= last-modified epoch
 *     ms), paused state, first/last observed dates (bounded by snapshot
 *     history — exact creation/removal dates are NOT exposed by GTM's API).
 *   - GA4 catalog: event → tag mapping (events[].from_tag).
 *
 * MANUAL fields survive regeneration: any availability date whose precision is
 * "exact" (or provenance "manual"), plus ownership / deployment_notes, are
 * carried over from the existing registry file.
 *
 * Usage:
 *   node scripts/refresh_tracking_metadata.mjs [--snapshot <path>] [--out <path>]
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const ROOT = process.cwd();
const SNAPSHOT = argOf("--snapshot", path.join(ROOT, "..", "gtm_snapshot.latest.json"));
const OUT = argOf("--out", path.join(ROOT, "catalog", "tracking_metadata.json"));
const CATALOG = path.join(ROOT, "catalog", "ga4_catalog.json");

// --- load inputs ---
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));

// Deep-walk the snapshot for tag objects (accounts → containers → workspaces → tags).
const tags = [];
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (o.tagId && o.name) tags.push(o);
    Object.values(o).forEach(walk);
  }
})(snapshot.accounts ?? []);

const snapshotDate = String(snapshot.fetched_at ?? "").slice(0, 10) || null;

// Event → tag mapping from the GA4 catalog.
const eventsByTag = new Map();
for (const e of catalog.events ?? []) {
  if (!e.from_tag) continue;
  if (!eventsByTag.has(e.from_tag)) eventsByTag.set(e.from_tag, []);
  eventsByTag.get(e.from_tag).push(e.name);
}

// Existing registry → preserve manual fields.
let existing = new Map();
if (fs.existsSync(OUT)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    existing = new Map((prev.tags ?? []).map((t) => [t.tag_name, t]));
  } catch {
    /* regenerate from scratch */
  }
}

function fingerprintDate(fp) {
  const ms = Number(fp);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

const outTags = tags
  .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  .map((t) => {
    const prev = existing.get(t.name);
    const prevAv = prev?.availability ?? {};
    const manualDeployed = prevAv.deployed_on_precision === "exact" || prevAv.provenance === "manual";
    const manualDeactivated = prevAv.deactivated_on_precision === "exact" || prevAv.provenance === "manual";
    const lastModified = fingerprintDate(t.fingerprint);

    // first_observed = earliest PROOF of existence: the fingerprint date (the
    // tag must have existed to be modified), the snapshot date, or whatever an
    // earlier registry already established.
    const candidates = [prevAv.first_observed, lastModified, snapshotDate].filter(Boolean);
    const firstObserved = candidates.length ? candidates.sort()[0] : null;

    return {
      tag_name: t.name,
      tag_type: t.type ?? null,
      events: eventsByTag.get(t.name) ?? [],
      availability: {
        deployed_on: manualDeployed ? prevAv.deployed_on : null,
        deployed_on_precision: manualDeployed ? "exact" : "unknown",
        first_observed: firstObserved,
        deactivated_on: manualDeactivated ? prevAv.deactivated_on : null,
        deactivated_on_precision: manualDeactivated ? "exact" : "unknown",
        last_observed: snapshotDate,
        paused: t.paused === true,
        provenance: manualDeployed || manualDeactivated ? "manual+gtm_snapshot" : "gtm_snapshot",
      },
      ownership: prev?.ownership ?? { owner: null, team: null, contact: null },
      deployment_notes: prev?.deployment_notes ?? [],
      change_history: [
        ...(lastModified
          ? [{ date: lastModified, change: "last modified (GTM fingerprint)", source: "gtm_fingerprint" }]
          : []),
        ...((prev?.change_history ?? []).filter((c) => c.source !== "gtm_fingerprint")),
      ],
    };
  });

const registry = {
  schema_version: 1,
  generated_at: snapshot.fetched_at ?? null,
  source: { gtm_snapshot: path.basename(SNAPSHOT), ga4_catalog: "ga4_catalog.json" },
  limitations: [
    "GTM's API exposes no creation date; deployed_on requires manual seeding (precision 'exact').",
    "Removal dates are only bracketed by snapshot diffs; deactivated_on requires manual seeding.",
    `Snapshot history begins ${snapshotDate ?? "(unknown)"} — nothing before it is automatically verifiable.`,
  ],
  tags: outTags,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(registry, null, 2) + "\n", "utf8");
console.log(`tracking_metadata.json: ${outTags.length} tags (${outTags.filter((t) => t.events.length).length} with GA4 events), first_observed=${snapshotDate}`);
