#!/usr/bin/env node
/**
 * check_guard_sync.mjs — drift guard for the §11.2 reconciliation.
 *
 * The live render guard (guard_report.mjs) bakes a copy of the palette
 * allow-list so it is self-contained at runtime. Canonical truth lives in the
 * monorepo: ga4-viz-platform/packages/registry-data/viz-registry.json
 * (colour_policy.allowed_palette + partial_only_colour). This asserts the baked
 * copy has NOT drifted from canonical, so the two A5/A6 implementations share a
 * single palette source of truth.
 *
 *   node scripts/check_guard_sync.mjs        # exit 0 if in sync, 1 if drifted
 *
 * Run in CI / before relying on the live guard. If it fails, update ALLOWED /
 * PEACH in guard_report.mjs to match viz-registry.json (or vice versa).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED, PEACH } from "./guard_report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = resolve(
  __dirname,
  "..", "..", "ga4-viz-platform", "packages", "registry-data", "viz-registry.json",
);

let policy;
try {
  policy = JSON.parse(readFileSync(REGISTRY, "utf-8")).colour_policy ?? {};
} catch (e) {
  console.error(`check_guard_sync: cannot read canonical registry ${REGISTRY}: ${e.message}`);
  process.exit(2);
}

const isHex = (c) => /^#[0-9a-f]{3,8}$/i.test(c);
const canonicalHexes = new Set((policy.allowed_palette ?? []).filter(isHex).map((c) => c.toLowerCase()));
const guardHexes = new Set([...ALLOWED].filter(isHex));

const missingInGuard = [...canonicalHexes].filter((c) => !guardHexes.has(c)); // canonical has, guard lacks
const extraInGuard = [...guardHexes].filter((c) => !canonicalHexes.has(c)); // guard has, canonical lacks
const peachCanonical = (policy.partial_only_colour ?? "").toLowerCase();
const peachDrift = peachCanonical !== PEACH.toLowerCase();

const problems = [];
if (missingInGuard.length) problems.push(`palette colours in canonical but missing from guard: ${missingInGuard.join(", ")}`);
if (extraInGuard.length) problems.push(`palette colours in guard but not in canonical: ${extraInGuard.join(", ")}`);
if (peachDrift) problems.push(`partial-period colour drift: canonical ${peachCanonical || "(none)"} vs guard ${PEACH.toLowerCase()}`);

if (problems.length === 0) {
  console.log(
    `check_guard_sync: IN SYNC — guard palette matches viz-registry.json ` +
      `(${guardHexes.size} hex colours + peach ${PEACH}).`,
  );
  process.exit(0);
}
console.error("check_guard_sync: DRIFT DETECTED");
for (const p of problems) console.error("  - " + p);
console.error("Reconcile guard_report.mjs ALLOWED/PEACH with viz-registry.json colour_policy.");
process.exit(1);
