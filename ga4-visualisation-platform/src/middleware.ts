/**
 * App-level access lock for hosted deployments.
 *
 * Vercel Authentication cannot cover production domains on the Pro plan
 * (API: 428 invalid_sso_protection), so production access control lives here:
 * HTTP Basic Auth against APP_ACCESS_USER / APP_ACCESS_PASSWORD.
 *
 * - Enforced ONLY when APP_ACCESS_PASSWORD is set (it is set on Vercel,
 *   absent in local .env.local → localhost stays frictionless).
 * - Covers every page and API route, so /api/orchestrate cannot be invoked
 *   anonymously (it spends LLM credits and exposes GA4 data).
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return NextResponse.next(); // local dev: no lock configured

  const user = process.env.APP_ACCESS_USER || "joblet";
  const expected = "Basic " + btoa(`${user}:${password}`);
  const got = req.headers.get("authorization");
  if (got === expected) return NextResponse.next();

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="GA4ClaudeAgent", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next.js internals/static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
