/**
 * GET /api/reports/<file>
 *
 * Serves a generated report HTML from the ./reports directory so the dev UI can
 * open it in the browser. Strictly sanitized: filename only (no separators, no
 * traversal), .html extension required, resolved inside ./reports.
 */
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_NAME = /^[A-Za-z0-9._-]+\.html$/;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!SAFE_NAME.test(file) || file.includes("..")) {
    return new Response("Invalid report name.", { status: 400 });
  }
  // Must mirror writeReport's env-aware default (Vercel FS is read-only outside /tmp).
  const reportsDir = process.env.VERCEL ? "/tmp/reports" : path.join(process.cwd(), "reports");
  const full = path.join(reportsDir, file);
  // Belt-and-suspenders: resolved path must stay inside ./reports.
  if (!full.startsWith(reportsDir + path.sep)) {
    return new Response("Invalid report path.", { status: 400 });
  }
  try {
    const html = await fs.readFile(full, "utf8");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return new Response("Report not found.", { status: 404 });
  }
}
