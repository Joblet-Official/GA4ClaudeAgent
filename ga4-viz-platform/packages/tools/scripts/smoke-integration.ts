/**
 * Phase 5B integration smoke test.
 *
 * Exercises the tool layer end-to-end against the REAL joblet.ai GA4 property:
 *   1. Loads + validates the catalog (registry_read kind)
 *   2. Looks up the engagementRate field via the convenience function
 *   3. Loads the metric ontology + domain profile (more registry_read tools)
 *   4. Calls GA4 runReport for top sessionSource × totalUsers, last 28 days
 *   5. Writes a small HTML summary via the path-constrained html_writer
 *   6. Reads it back and confirms bytes
 *
 * Run with credentials in env:
 *   GOOGLE_APPLICATION_CREDENTIALS=path-to-service-account.json
 *
 * Exit 0 on success, non-zero on any failure. No external dependencies beyond
 * what the tools package already declares.
 */
import { readCatalog, findField, getHintText } from "../src/catalog-reader.js";
import { readMetricOntology, getOntologyEntry } from "../src/ontology-reader.js";
import { readDomainProfiles, getProfileFor } from "../src/domain-profile-reader.js";
import { runReport } from "../src/ga4-client.js";
import { writeReportHtml, resolveSafeReportsPath } from "../src/html-writer.js";
import { buildAgentToolset } from "../src/index.js";
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GA4_PROPERTY = "properties/516147906";
let pass = 0;
let fail = 0;

function ok(label: string, detail?: string): void {
  pass++;
  console.log(`  [PASS] ${label}${detail ? `  ${detail}` : ""}`);
}
function err(label: string, e: unknown): void {
  fail++;
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`  [FAIL] ${label}\n         ${msg.split("\n").join("\n         ")}`);
}

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    ok(label);
  } catch (e) {
    err(label, e);
  }
}

async function run(): Promise<void> {
  console.log("=".repeat(70));
  console.log("Phase 5B — integration smoke test");
  console.log("=".repeat(70));
  console.log("");

  // ===== 1. Registry readers =====
  console.log("Section 1 — Registry readers (Phase 4: kind=registry_read)");

  await step("catalog_reader loads + validates", async () => {
    const cat = await readCatalog();
    if (!cat.sources["ga4"]) throw new Error("missing ga4 source");
    if ((cat.sources["ga4"]!.metrics).length === 0) throw new Error("no metrics");
  });

  await step("catalog: findField finds engagementRate with rate_components", async () => {
    const f = await findField("ga4", "engagementRate");
    if (!f) throw new Error("engagementRate not found");
    if (f.rate_handling !== "ratio_of_sums") throw new Error(`unexpected rate_handling=${f.rate_handling}`);
    if (!f.rate_components?.includes("engagedSessions")) throw new Error("missing rate_components");
  });

  await step("catalog: getHintText returns short_definition for A3 hints", async () => {
    const hint = await getHintText("ga4", "sessions");
    if (!hint || hint.length < 10) throw new Error(`hint missing or too short: "${hint}"`);
  });

  await step("metric_ontology_reader: engagementRate entry has investigation_branches", async () => {
    const ent = await getOntologyEntry("engagementRate");
    if (!ent) throw new Error("no ontology entry for engagementRate");
    if (ent.formula !== "engagedSessions / sessions") throw new Error("unexpected formula");
    if (!ent.investigation_branches || ent.investigation_branches.length < 5) {
      throw new Error(`expected ≥5 branches, got ${ent.investigation_branches?.length ?? 0}`);
    }
  });

  await step("domain_profile_reader: joblet.ai profile = job_board", async () => {
    const p = await getProfileFor("ga4:516147906");
    if (!p) throw new Error("no profile for joblet.ai");
    if (p.domain_type !== "job_board") throw new Error(`unexpected domain_type=${p.domain_type}`);
    if (!p.funnel_template || p.funnel_template.length < 3) throw new Error("funnel_template missing");
  });

  console.log("");

  // ===== 2. Phase 4 permission binder =====
  console.log("Section 2 — Permission binder (Phase 4 enforcement)");

  await step("A1 toolset is empty", async () => {
    const ts = buildAgentToolset("A1");
    if (Object.keys(ts).length !== 0) throw new Error(`A1 has ${Object.keys(ts).length} tools, expected 0`);
  });

  await step("A4 toolset has ga4Query and nothing else", async () => {
    const ts = buildAgentToolset("A4");
    if (!ts.ga4Query) throw new Error("missing ga4Query");
    if (ts.readCatalog) throw new Error("A4 must not have catalog access");
    if (ts.writeReportHtml) throw new Error("A4 must not have file write");
  });

  await step("A6 toolset has writeReportHtml but NOT ga4Query", async () => {
    const ts = buildAgentToolset("A6");
    if (!ts.writeReportHtml) throw new Error("missing writeReportHtml");
    if (ts.ga4Query) throw new Error("A6 must not have GA4 access");
  });

  console.log("");

  // ===== 3. Real GA4 call =====
  console.log("Section 3 — GA4 data API (real call against joblet.ai)");

  // Ensure credentials are configured
  const haveCreds = !!process.env["GOOGLE_APPLICATION_CREDENTIALS"]
                 || !!process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (!haveCreds) {
    console.log("  [SKIP] GA4 calls — no credentials in env");
    console.log("         Set GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json and rerun.");
    console.log("");
  } else {
    let ga4Result: Awaited<ReturnType<typeof runReport>> | undefined;

    await step("runReport returns top 10 sessionSource × totalUsers for last 28 days", async () => {
      ga4Result = await runReport({
        property: GA4_PROPERTY,
        dimensions: ["sessionSource"],
        metrics: ["totalUsers"],
        date_range: { start_date: "28daysAgo", end_date: "today" },
        order_by: [{ metric: "totalUsers", desc: true }],
        limit: 10,
      });
      if (ga4Result.rows.length === 0) throw new Error("empty result");
      if (ga4Result.rows.length > 10) throw new Error(`got ${ga4Result.rows.length} rows, expected ≤ 10`);
    });

    await step("GA4 response shape: canonical row form", async () => {
      if (!ga4Result) throw new Error("no result");
      const row = ga4Result.rows[0]!;
      if (!row.dimensions || typeof row.dimensions["sessionSource"] !== "string") {
        throw new Error("missing/malformed dimensions");
      }
      if (!row.metrics || typeof row.metrics["totalUsers"] !== "number") {
        throw new Error("missing/malformed metrics");
      }
    });

    await step("GA4 response captures execution metadata (latency, row_count)", async () => {
      if (!ga4Result) throw new Error("no result");
      if (ga4Result.latency_ms < 0) throw new Error("invalid latency");
      if (ga4Result.row_count < ga4Result.rows.length) throw new Error("row_count < rows.length");
      console.log(
        `         latency=${ga4Result.latency_ms}ms  rows=${ga4Result.rows.length}  ` +
        `total_available=${ga4Result.row_count}  sampling=${ga4Result.is_sampled}`,
      );
    });

    console.log("");

    // ===== 4. HTML writer round-trip =====
    console.log("Section 4 — HTML writer (Phase 4: path-constrained)");

    const SMOKE_DIR = resolve(__dirname, "..", "..", "..", "reports", "smoke");
    await mkdir(SMOKE_DIR, { recursive: true });

    const reportPath = resolve(SMOKE_DIR, `phase5b-smoke-${Date.now()}.html`);
    const reportContent = buildHtmlReport(ga4Result!);

    let writeResult: Awaited<ReturnType<typeof writeReportHtml>> | undefined;

    await step("writeReportHtml writes to constrained path", async () => {
      writeResult = await writeReportHtml({
        path: reportPath,
        content: reportContent,
        cwd: resolve(__dirname, "..", "..", ".."),
      });
      if (writeResult.bytes !== Buffer.byteLength(reportContent, "utf-8")) {
        throw new Error("byte count mismatch");
      }
    });

    await step("HTML round-trip: file exists, size matches", async () => {
      if (!writeResult) throw new Error("no write result");
      const s = await stat(writeResult.absolute_path);
      if (s.size !== writeResult.bytes) throw new Error(`disk size ${s.size} != reported ${writeResult.bytes}`);
      const read = await readFile(writeResult.absolute_path, "utf-8");
      if (!read.includes("Phase 5B smoke")) throw new Error("written content missing marker");
    });

    await step("writeReportHtml REJECTS path outside reports/", async () => {
      try {
        await writeReportHtml({
          path: resolve(__dirname, "..", "..", "..", "evil.html"),
          content: "<html></html>",
          cwd: resolve(__dirname, "..", "..", ".."),
        });
        throw new Error("write should have been rejected");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("outside the allowed reports/")) {
          throw new Error(`expected reports-root violation; got: ${msg}`);
        }
        // expected — pass
      }
    });

    await step("writeReportHtml REJECTS path traversal", async () => {
      try {
        await writeReportHtml({
          path: "reports/../../../etc/passwd.html",
          content: "<html></html>",
          cwd: resolve(__dirname, "..", "..", ".."),
        });
        throw new Error("traversal should have been rejected");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("outside the allowed reports/")) {
          throw new Error(`expected reports-root violation; got: ${msg}`);
        }
      }
    });

    console.log("");
    console.log(`Report written: ${writeResult?.absolute_path}`);
    console.log("");
  }

  // ===== Summary =====
  console.log("=".repeat(70));
  console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
  console.log("=".repeat(70));
  if (fail > 0) process.exit(1);
}

function buildHtmlReport(ga4Result: Awaited<ReturnType<typeof runReport>>): string {
  const rows = ga4Result.rows
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${r.dimensions["sessionSource"]}</td><td>${r.metrics["totalUsers"]}</td></tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Phase 5B smoke</title>
<style>body{font-family:system-ui;padding:24px;color:#1f2937}table{border-collapse:collapse}th,td{padding:6px 12px;border-bottom:1px solid #ddd}th{background:#2E5C8A;color:#fff;text-align:left}</style>
</head><body>
<h1>Phase 5B smoke — top sources by totalUsers</h1>
<p>joblet.ai · last 28 days · ${ga4Result.rows.length} of ${ga4Result.row_count} rows · ${ga4Result.latency_ms}ms latency</p>
<table><thead><tr><th>#</th><th>Source</th><th>Total users</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

run().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
