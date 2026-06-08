/**
 * ga4_data_api (Phase 4 tool).
 *
 *   kind:            data_api
 *   side_effect:     read_only
 *   permitted for:   A4 only
 *   credential:      service-account JSON via GOOGLE_APPLICATION_CREDENTIALS_JSON env var
 *                    OR file path via GOOGLE_APPLICATION_CREDENTIALS
 *
 * Phase 5B status: interface and signatures complete; real GA4 calls implemented.
 * Per FSM retry policy: 5xx → exponential backoff [1,4,9] up to 3 retries;
 *                       429 → honor Retry-After up to 2 retries;
 *                       403/404/400 → no retry, surface as fatal.
 */
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export interface GA4QueryRequest {
  /** Property string in the form "properties/<id>". */
  property: string;
  dimensions: string[];
  metrics: string[];
  date_range: { start_date: string; end_date: string };
  order_by?: Array<{ metric: string; desc?: boolean }> | Array<{ dimension: string; desc?: boolean }>;
  limit?: number;
}

export interface GA4Row {
  dimensions: Record<string, string>;
  metrics: Record<string, number>;
}

export interface GA4QueryResult {
  rows: GA4Row[];
  /** Total row count the API reports (may be > rows.length when limit is hit). */
  row_count: number;
  is_sampled: boolean;
  sampling_rate: number;
  subject_to_thresholding: boolean;
  time_zone: string;
  latency_ms: number;
}

let _client: BetaAnalyticsDataClient | undefined;

function getClient(): BetaAnalyticsDataClient {
  if (_client) return _client;
  // Auth source resolution order:
  //   GOOGLE_APPLICATION_CREDENTIALS_JSON  (inline JSON string)
  //   GOOGLE_APPLICATION_CREDENTIALS       (file path — handled natively by google-auth-library)
  const jsonInline = process.env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (jsonInline) {
    const credentials = JSON.parse(jsonInline) as Record<string, unknown>;
    _client = new BetaAnalyticsDataClient({ credentials: credentials as never });
  } else {
    _client = new BetaAnalyticsDataClient();
  }
  return _client;
}

/**
 * Execute a single GA4 runReport query. No retry logic here — that's
 * the orchestrator's responsibility, per Phase 3 retry policy.
 */
export async function runReport(req: GA4QueryRequest): Promise<GA4QueryResult> {
  const client = getClient();
  const t0 = Date.now();

  const [resp] = await client.runReport({
    property: req.property,
    dimensions: req.dimensions.map((name) => ({ name })),
    metrics: req.metrics.map((name) => ({ name })),
    dateRanges: [{ startDate: req.date_range.start_date, endDate: req.date_range.end_date }],
    orderBys: req.order_by?.map((o) => {
      if ("metric" in o) return { metric: { metricName: o.metric }, desc: o.desc ?? true };
      return { dimension: { dimensionName: o.dimension }, desc: o.desc ?? false };
    }),
    ...(req.limit !== undefined ? { limit: req.limit } : {}),
  });

  const latency_ms = Date.now() - t0;

  const rows: GA4Row[] = (resp.rows ?? []).map((r) => {
    const dimensions: Record<string, string> = {};
    (r.dimensionValues ?? []).forEach((dv, i) => {
      const dim = req.dimensions[i];
      if (dim !== undefined) dimensions[dim] = dv.value ?? "";
    });
    const metrics: Record<string, number> = {};
    (r.metricValues ?? []).forEach((mv, i) => {
      const m = req.metrics[i];
      if (m !== undefined) metrics[m] = Number(mv.value ?? 0);
    });
    return { dimensions, metrics };
  });

  const sampling = resp.metadata?.samplingMetadatas ?? [];
  const first = sampling[0];
  const samplesRead = first?.samplesReadCount ? Number(first.samplesReadCount) : 0;
  const samplingSpace = first?.samplingSpaceSize ? Number(first.samplingSpaceSize) : 0;
  const is_sampled = sampling.length > 0 && samplingSpace > samplesRead && samplesRead > 0;
  const sampling_rate = is_sampled && samplingSpace > 0 ? samplesRead / samplingSpace : 1.0;

  return {
    rows,
    row_count: Number(resp.rowCount ?? rows.length),
    is_sampled,
    sampling_rate,
    subject_to_thresholding: resp.metadata?.subjectToThresholding ?? false,
    time_zone: resp.metadata?.timeZone ?? "",
    latency_ms,
  };
}
