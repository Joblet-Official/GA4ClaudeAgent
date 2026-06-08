/**
 * html_file_writer (Phase 4 tool).
 *
 *   kind:            file_write
 *   side_effect:     write
 *   permitted for:   A6 only
 *
 * Enforces the Phase 4 path constraint: writes must land under reports/**.html.
 * Path traversal (.., absolute paths outside project root) is rejected.
 */
import { writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep, posix } from "node:path";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per Phase 4
const ALLOWED_ROOT_BASENAME = "reports";

export interface WriteOptions {
  /** Absolute or relative path under reports/. Must end in .html. */
  path: string;
  /** HTML content to write. */
  content: string;
  /** Root directory under which reports/ lives. Defaults to current working directory. */
  cwd?: string;
}

export interface WriteResult {
  absolute_path: string;
  bytes: number;
}

/**
 * Validate that the path is under the reports/ subtree of cwd. Returns the
 * resolved absolute path. Throws on violation.
 */
export function resolveSafeReportsPath(
  path: string,
  cwd: string = process.cwd(),
): string {
  if (!path.toLowerCase().endsWith(".html")) {
    throw new Error(`html_file_writer: path must end with .html, got "${path}"`);
  }

  const reportsRoot = resolve(cwd, ALLOWED_ROOT_BASENAME);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);

  // Reject if absolute is not within reportsRoot
  const rel = relative(reportsRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).some((p) => p === "..")) {
    throw new Error(
      `html_file_writer: path "${path}" resolves outside the allowed reports/ root. ` +
        `(reportsRoot=${reportsRoot}, absolute=${absolute})`,
    );
  }

  return absolute;
}

/**
 * Write HTML content to a constrained path.
 *
 * Enforces:
 *   - Path under cwd/reports/
 *   - .html extension
 *   - Size <= 10 MB
 */
export async function writeReportHtml(opts: WriteOptions): Promise<WriteResult> {
  const cwd = opts.cwd ?? process.cwd();
  const absolute = resolveSafeReportsPath(opts.path, cwd);

  const bytes = Buffer.byteLength(opts.content, "utf-8");
  if (bytes > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `html_file_writer: content size ${bytes} exceeds max ${MAX_FILE_SIZE_BYTES} bytes`,
    );
  }

  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, opts.content, "utf-8");

  return { absolute_path: absolute, bytes };
}
