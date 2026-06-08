/**
 * Codegen: JSON Schemas → TypeScript types.
 *
 * Reads every *.schema.json under packages/contracts/schemas/, runs
 * json-schema-to-typescript on each, concatenates outputs into
 * packages/contracts/src/types.generated.ts.
 *
 * Cross-file $refs are resolved via the cwd option of compileFromFile.
 *
 * Run from packages/contracts root:    pnpm codegen
 * Or from workspace root:              pnpm codegen
 */
import { compileFromFile } from "json-schema-to-typescript";
import { readdir, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "../schemas");
const OUTPUT_FILE = resolve(__dirname, "../src/types.generated.ts");

async function findSchemas(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) out.push(...(await findSchemas(p)));
    else if (e.name.endsWith(".schema.json")) out.push(p);
  }
  return out;
}

async function main(): Promise<void> {
  const schemas = await findSchemas(SCHEMAS_DIR);
  console.log(`Found ${schemas.length} schema files`);

  const banner = [
    "/* eslint-disable */",
    "// AUTO-GENERATED — DO NOT EDIT BY HAND.",
    "// Source: packages/contracts/schemas/*.schema.json",
    "// Regenerate with:   pnpm --filter @gvp/contracts run codegen",
    "",
  ].join("\n");

  const parts: string[] = [banner];

  for (const schemaPath of schemas) {
    const rel = relative(SCHEMAS_DIR, schemaPath).replace(/\\/g, "/");
    try {
      const ts = await compileFromFile(schemaPath, {
        bannerComment: "",
        additionalProperties: false,
        // cwd must be the directory of the schema being compiled so its
        // relative $refs (e.g. "../_shared.schema.json") resolve correctly.
        cwd: dirname(schemaPath),
        // Inline externally-referenced types so each schema's output is self-contained.
        // Duplicate definitions across files are deduped post-concat via a Set below.
        declareExternallyReferenced: true,
        unreachableDefinitions: false,
      });
      parts.push(`\n// ===== ${rel} =====\n`);
      parts.push(ts);
      console.log(`  [ok]   ${rel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parts.push(`\n// ===== ${rel} (FAILED) =====\n// ${msg.split("\n").join("\n// ")}\n`);
      console.error(`  [FAIL] ${rel}: ${msg}`);
    }
  }

  // Dedupe: many schemas reference the same shared types (AmbiguityFlag, ReportType,
  // SubQuestionId, etc.). With declareExternallyReferenced=true each file emits its own
  // copy. We collapse duplicates by (kind, name) keeping the first occurrence.
  const merged = dedupeTopLevelDeclarations(parts.join("\n"));

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, merged, "utf-8");
  console.log(`\nWrote ${OUTPUT_FILE}`);
}

/** Collapse duplicate top-level `export interface Name {…}` and `export type Name = …` blocks. */
function dedupeTopLevelDeclarations(source: string): string {
  const seen = new Set<string>();
  const out: string[] = [];

  // Split by lines but preserve blocks. Match `export interface NAME {` start lines
  // and balance braces to find the block end.
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const ifaceMatch = line.match(/^export\s+(?:interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
    if (ifaceMatch) {
      const name = ifaceMatch[1]!;
      // Find the end of this declaration. For interfaces: balance braces. For types: until ;
      const isInterface = line.includes("interface");
      const block: string[] = [line];
      if (isInterface) {
        // count braces from this line onward
        let braces = (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
        let j = i + 1;
        while (j < lines.length && braces > 0) {
          const l = lines[j] ?? "";
          block.push(l);
          braces += (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);
          j++;
        }
        i = j;
      } else {
        // type alias — until line ending with ';'
        let j = i;
        while (j < lines.length && !(lines[j] ?? "").trimEnd().endsWith(";")) {
          if (j !== i) block.push(lines[j] ?? "");
          j++;
        }
        if (j < lines.length) {
          if (j !== i) block.push(lines[j] ?? "");
          j++;
        }
        i = j;
      }

      if (!seen.has(name)) {
        seen.add(name);
        out.push(block.join("\n"));
      }
      // else: skip (duplicate)
    } else {
      out.push(line);
      i++;
    }
  }

  return out.join("\n");
}

main().catch((err) => {
  console.error("Codegen failed:", err);
  process.exit(1);
});
