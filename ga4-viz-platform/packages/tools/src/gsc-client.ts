/**
 * gsc_api (Phase 4 tool).
 *
 *   kind:            data_api
 *   side_effect:     read_only
 *   permitted for:   A4 only
 *   credential:      service-account JSON
 *   notes:           site identifier MUST be exact Domain-property form, e.g. "sc-domain:joblet.ai"
 *
 * Phase 5B status: interface complete; real GSC calls implemented.
 */
import { google, type searchconsole_v1 } from "googleapis";

export interface GSCQueryRequest {
  /** Exact Domain-property identifier, e.g. "sc-domain:joblet.ai". */
  site_url: string;
  start_date: string;
  end_date: string;
  dimensions?: Array<"date" | "query" | "page" | "country" | "device" | "searchAppearance">;
  row_limit?: number;
}

export interface GSCRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCQueryResult {
  rows: GSCRow[];
  latency_ms: number;
}

let _client: searchconsole_v1.Searchconsole | undefined;

async function getClient(): Promise<searchconsole_v1.Searchconsole> {
  if (_client) return _client;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env. For inline JSON,
    // GoogleAuth picks up GOOGLE_APPLICATION_CREDENTIALS_JSON automatically in some versions;
    // for full safety we read it explicitly if present.
    credentials: process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"]
      ? JSON.parse(process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"]!)
      : undefined,
  });
  const authClient = await auth.getClient();
  _client = google.searchconsole({ version: "v1", auth: authClient as never });
  return _client;
}

/** Execute a single GSC searchanalytics.query. */
export async function searchAnalyticsQuery(req: GSCQueryRequest): Promise<GSCQueryResult> {
  const client = await getClient();
  const t0 = Date.now();
  const { data } = await client.searchanalytics.query({
    siteUrl: req.site_url,
    requestBody: {
      startDate: req.start_date,
      endDate: req.end_date,
      dimensions: req.dimensions ?? [],
      rowLimit: req.row_limit ?? 1000,
    },
  });
  const latency_ms = Date.now() - t0;

  const rows: GSCRow[] = (data.rows ?? []).map((r) => ({
    keys: r.keys ?? [],
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  }));

  return { rows, latency_ms };
}
