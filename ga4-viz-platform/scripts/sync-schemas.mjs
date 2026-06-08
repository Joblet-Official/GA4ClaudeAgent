#!/usr/bin/env node
/**
 * sync-schemas.mjs — mirror the canonical JSON-Schemas into the monorepo.
 *
 * Source of truth: E:/Documents/joveo/contracts/  (the canonical schemas +
 * verify.py harness). Mirror (codegen input): packages/contracts/schemas/.
 * This copies every *.schema.json from canonical → mirror, preserving the
 * sub-directory layout (agents/, registries/, orchestration/, pipeline/,
 * tool-boundaries/, plus _shared.schema.json).
 *
 * Usage (from the monorepo root, ga4-viz-platform/):
 *   node scripts/sync-schemas.mjs          # sync: copy canonical → mirror
 *   node scripts/sync-schemas.mjs --check  # report only; exit 1 if out of sync
 *
 * After a sync, regenerate types with the codegen step and re-run
 * `python ../contracts/verify.py` (verify.py validates the canonical set, which
 * this script never writes to).
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(__dirname, "..", "..", "contracts");
const MIRROR = resolve(__dirname, "..", "packages", "contracts", "schemas");

const checkOnly = process.argv.includes("--check");

/** Recursively list *.schema.json under a root, returned as paths relative to it. */
function listSchemas(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".schema.json")) out.push(relative(root, full));
    }
  };
  walk(root);
  return out.sort();
}

const rels = listSchemas(CANONICAL);
let copied = 0;
let unchanged = 0;
const outOfSync = [];

for (const rel of rels) {
  const src = join(CANONICAL, rel);
  const dst = join(MIRROR, rel);
  const srcBuf = readFileSync(src);
  let dstBuf = null;
  try {
    dstBuf = readFileSync(dst);
  } catch {
    /* missing in mirror */
  }
  const same = dstBuf !== null && Buffer.compare(srcBuf, dstBuf) === 0;
  if (same) {
    unchanged++;
    continue;
  }
  outOfSync.push(rel);
  if (!checkOnly) {
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, srcBuf);
    copied++;
  }
}

if (checkOnly) {
  if (outOfSync.length === 0) {
    console.log(`sync-schemas --check: IN SYNC (${rels.length} schemas).`);
    process.exit(0);
  }
  console.error(`sync-schemas --check: OUT OF SYNC (${outOfSync.length} of ${rels.length}):`);
  for (const r of outOfSync) console.error("  - " + r);
  console.error("Run `node scripts/sync-schemas.mjs` to update the mirror.");
  process.exit(1);
}

console.log(
  `sync-schemas: ${copied} copied, ${unchanged} unchanged (${rels.length} canonical schemas → mirror).`,
);
if (copied > 0) {
  console.log("Updated:");
  for (const r of outOfSync) console.log("  - " + r);
  console.log("Next: regenerate types (codegen) and re-run `python ../contracts/verify.py`.");
}
