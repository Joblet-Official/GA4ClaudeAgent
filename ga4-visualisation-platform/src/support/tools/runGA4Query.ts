/**
 * Tool Layer — the one non-LLM, deterministic step in the pipeline.
 *
 * runGA4Query forwards a Brain-2-shaped request body to the GA4 Data API and
 * returns the rows plus enough metadata (headers, sampling info, row count)
 * for Brain 5 to do its pivots and groupings. The plan says "return raw rows";
 * we also return a mapped {colName: value} view because GA4 rows are otherwise
 * positional and unusable without the headers.
 *
 * Credentials:
 *   - Vercel:  set GOOGLE_APPLICATION_CREDENTIALS_JSON to the full JSON contents
 *   - Local:   set GOOGLE_APPLICATION_CREDENTIALS to the file path
 *   The SDK picks up the file-path env automatically; we explicitly parse the
 *   JSON env when present (Vercel can't ship a file path).
 */
import { BetaAnalyticsDataClient } from "@google-analytics/data";

function pickCredentials(): { credentials?: Record<string, unknown> } {
  const jsonEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (jsonEnv && jsonEnv.trim().startsWith("{")) {
    try {
      return { credentials: JSON.parse(jsonEnv) };
    } catch (e) {
      throw new Error(
        `GOOGLE_APPLICATION_CREDENTIALS_JSON is set but not valid JSON: ${(e as Error).message}`,
      );
    }
  }
  // Falls through — the SDK reads GOOGLE_APPLICATION_CREDENTIALS (file path).
  return {};
}

let _client: BetaAnalyticsDataClient | null = null;
function getClient(): BetaAnalyticsDataClient {
  if (_client) return _client;
  _client = new BetaAnalyticsDataClient(pickCredentials());
  return _client;
}

export interface MetricHeader {
  name: string;
  type: string;
}

export interface GA4QueryResult {
  /** Rows mapped to flat objects keyed by header name. Numeric metrics coerced to numbers. */
  rows: Array<Record<string, string | number>>;
  dimensionHeaders: string[];
  metricHeaders: MetricHeader[];
  /** Total row count from GA4 (may exceed `rows.length` if a limit was applied). */
  rowCount: number;
  metadata: {
    /** GA4 sets this when sampling kicked in. */
    sampled: boolean;
    /** GA4 collapses excess rows into an "(other)" row when too many groups; flags when that happened. */
    dataLossFromOtherRow: boolean;
    /** When present, GA4 restricted the schema (e.g. quota-tier-locked dimensions). */
    schemaRestriction?: unknown;
  };
}

/**
 * GA4-shaped request body. Permissive — Brain 2's Zod schema constrains this
 * upstream. Here we just forward.
 */
type GA4RequestBody = Record<string, unknown>;

export class GA4QueryError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GA4QueryError";
  }
}

export async function runGA4Query(requestBody: GA4RequestBody): Promise<GA4QueryResult> {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) {
    throw new GA4QueryError("GA4_PROPERTY_ID is not set in env.");
  }

  const client = getClient();

  // GA4 SDK's `runReport` returns a [response, request, options] tuple. We use
  // a loose `any`-cast to read fields because the proto types from the SDK are
  // overly nested for the simple flat shape we need downstream.
  let response: Record<string, unknown>;
  try {
    const fullRequest = {
      property: `properties/${propertyId}`,
      ...requestBody,
    };
    const result = await client.runReport(fullRequest as Parameters<typeof client.runReport>[0]);
    response = (result as unknown as [Record<string, unknown>])[0];
  } catch (err) {
    const e = err as { code?: number; message?: string; details?: unknown };
    throw new GA4QueryError(
      `GA4 runReport failed: ${e.message ?? "unknown error"}`,
      e.code,
      e,
    );
  }

  type Header = { name?: string; type?: unknown };
  type Value = { value?: string };
  type RawRow = { dimensionValues?: Value[]; metricValues?: Value[] };

  const dimHeaders = ((response.dimensionHeaders as Header[]) ?? []).map((h) => h.name ?? "");
  const metHeaders: MetricHeader[] = ((response.metricHeaders as Header[]) ?? []).map((h) => ({
    name: h.name ?? "",
    type: String(h.type ?? ""),
  }));

  const rawRows = (response.rows as RawRow[]) ?? [];
  const rows = rawRows.map((row) => {
    const obj: Record<string, string | number> = {};
    dimHeaders.forEach((name, i) => {
      obj[name] = row.dimensionValues?.[i]?.value ?? "";
    });
    metHeaders.forEach((h, i) => {
      const v = row.metricValues?.[i]?.value ?? "";
      // GA4 sends every metric as a string; coerce numerics so downstream
      // pivots and sums don't have to.
      const num = Number(v);
      obj[h.name] = v !== "" && Number.isFinite(num) ? num : v;
    });
    return obj;
  });

  const meta = (response.metadata as { samplingMetadatas?: unknown[]; dataLossFromOtherRow?: boolean; schemaRestrictionResponse?: unknown }) ?? {};
  return {
    rows,
    dimensionHeaders: dimHeaders,
    metricHeaders: metHeaders,
    rowCount: Number(response.rowCount ?? rows.length),
    metadata: {
      sampled: Array.isArray(meta.samplingMetadatas) && meta.samplingMetadatas.length > 0,
      dataLossFromOtherRow: meta.dataLossFromOtherRow ?? false,
      schemaRestriction: meta.schemaRestrictionResponse,
    },
  };
}
