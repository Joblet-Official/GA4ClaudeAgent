"use client";

import { useState } from "react";

const SAMPLES = [
  { label: "single_metric — yesterday's sessions", question: "how many sessions did we get yesterday", memory: null },
  { label: "regional_breakdown — sessions by country last week", question: "sessions by country last week", memory: null },
  { label: "time_series — daily sessions last 30 days", question: "show daily sessions over the last 30 days", memory: null },
  { label: "weekly_summary — weekly sessions and applies by region", question: "weekly sessions and applies by region for the last 6 weeks", memory: null },
  { label: "drill_down — India by city", question: "for India, show sessions and users by city", memory: null },
  { label: "comparison — this week vs last week", question: "compare sessions this week vs last week", memory: null },
  { label: "filtered — mobile sessions in India", question: "mobile sessions in India last 30 days", memory: null },
  { label: "event-based — applies by job title last month", question: "applies by job title for the last month", memory: null },
];

interface Timing { ttft_ms: number; total_ms: number; attempts: number; }
interface BrainResult {
  output: unknown;
  timing: Timing;
  provider: string;
  model: string;
}
interface SuccessResp { ok: true; brain1?: BrainResult; brain2: BrainResult; }
interface ErrorResp {
  ok: false;
  stage?: "brain1" | "brain2";
  error: string;
  raw_output?: string;
  zod_issues?: unknown;
  catalog_issues?: Array<{ query_id: string; kind: string; name: string; location: string }>;
  timing?: Timing;
  brain1?: BrainResult;
  brain1_provider?: string;
  brain1_model?: string;
  brain2_provider?: string;
  brain2_model?: string;
}
type ApiResp = SuccessResp | ErrorResp;

function badgeForLatency(ms: number, kind: "ttft" | "total") {
  const thresholds = kind === "ttft" ? [2000, 8000] : [8000, 20000];
  if (ms < thresholds[0]!) return "bg-green-950 text-green-300";
  if (ms < thresholds[1]!) return "bg-yellow-950 text-yellow-300";
  return "bg-red-950 text-red-300";
}

function TimingBadges({ result }: { result: BrainResult }) {
  return (
    <>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badgeForLatency(result.timing.ttft_ms, "ttft")}`} title="time-to-first-token">
        TTFT: {result.timing.ttft_ms}ms
      </span>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badgeForLatency(result.timing.total_ms, "total")}`} title="total wall-clock for this brain">
        total: {result.timing.total_ms}ms
      </span>
      {result.timing.attempts > 1 && (
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300" title="retries needed">
          {result.timing.attempts} attempts
        </span>
      )}
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
        {result.provider} · {result.model}
      </span>
    </>
  );
}

function Chip({ children, color = "neutral" }: { children: React.ReactNode; color?: "neutral" | "blue" | "purple" | "emerald" }) {
  const colors = {
    neutral: "bg-neutral-800 text-neutral-300 border-neutral-700",
    blue: "bg-blue-950 text-blue-300 border-blue-900",
    purple: "bg-purple-950 text-purple-300 border-purple-900",
    emerald: "bg-emerald-950 text-emerald-300 border-emerald-900",
  };
  return (
    <span className={`inline-block text-xs font-mono px-2 py-0.5 rounded border ${colors[color]}`}>
      {children}
    </span>
  );
}

interface RequestBody {
  dimensions: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  dateRanges: Array<{ startDate: string; endDate: string; name?: string }>;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  orderBys?: unknown;
  limit?: unknown;
}
interface Query {
  id: string;
  request_body: RequestBody;
  expected_shape: "categorical" | "timeseries" | "single_value";
}

function QueryCard({ query, index }: { query: Query; index: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-sm font-semibold text-neutral-200">Query {index + 1}</span>
        <Chip color="neutral">{query.id}</Chip>
        <Chip color="purple">shape: {query.expected_shape}</Chip>
        <Chip color="neutral">{query.request_body.dateRanges.length} date range{query.request_body.dateRanges.length > 1 ? "s" : ""}</Chip>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs text-neutral-500 mb-1.5">Dimensions ({query.request_body.dimensions.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {query.request_body.dimensions.length === 0 && <span className="text-xs text-neutral-600 italic">none</span>}
            {query.request_body.dimensions.map((d, i) => <Chip key={i} color="blue">{d.name}</Chip>)}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-500 mb-1.5">Metrics ({query.request_body.metrics.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {query.request_body.metrics.map((m, i) => <Chip key={i} color="emerald">{m.name}</Chip>)}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <div className="text-xs text-neutral-500 mb-1.5">Date ranges</div>
        <div className="flex flex-wrap gap-2">
          {query.request_body.dateRanges.map((dr, i) => (
            <div key={i} className="text-xs font-mono bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
              {dr.name ? <span className="text-neutral-400 mr-1">{dr.name}:</span> : null}
              {dr.startDate} → {dr.endDate}
            </div>
          ))}
        </div>
      </div>

      {Boolean(query.request_body.dimensionFilter || query.request_body.metricFilter) && (
        <details className="mb-1">
          <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">filters</summary>
          <pre className="mt-2 text-xs font-mono bg-neutral-950 border border-neutral-800 rounded p-2 overflow-auto">
{JSON.stringify({ dimensionFilter: query.request_body.dimensionFilter, metricFilter: query.request_body.metricFilter }, null, 2)}
          </pre>
        </details>
      )}

      <details>
        <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">raw GA4 request_body</summary>
        <pre className="mt-2 text-xs font-mono bg-neutral-950 border border-neutral-800 rounded p-2 overflow-auto">
{JSON.stringify(query.request_body, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function Brain2Page() {
  const [mode, setMode] = useState<"pipeline" | "direct">("pipeline");
  const [question, setQuestion] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [intentText, setIntentText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ApiResp | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  async function onRun() {
    setClientError(null);
    setResult(null);

    let payload: object;
    if (mode === "pipeline") {
      if (!question.trim()) {
        setClientError("Type a question first.");
        return;
      }
      let memory: unknown = null;
      if (memoryEnabled && memoryText.trim()) {
        try { memory = JSON.parse(memoryText); }
        catch (e) { setClientError(`Memory JSON invalid: ${(e as Error).message}`); return; }
      }
      payload = { question, memory };
    } else {
      if (!intentText.trim()) {
        setClientError("Paste an IntentOutput JSON first.");
        return;
      }
      let intent: unknown;
      try { intent = JSON.parse(intentText); }
      catch (e) { setClientError(`Intent JSON invalid: ${(e as Error).message}`); return; }
      payload = { intent };
    }

    setRunning(true);
    try {
      const r = await fetch("/api/brain2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await r.json()) as ApiResp;
      setResult(data);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  function loadSample(idx: number) {
    const s = SAMPLES[idx];
    if (!s) return;
    setMode("pipeline");
    setQuestion(s.question);
    if (s.memory) {
      setMemoryEnabled(true);
      setMemoryText(JSON.stringify(s.memory, null, 2));
    } else {
      setMemoryEnabled(false);
      setMemoryText("");
    }
    setResult(null);
    setClientError(null);
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <header className="mb-8">
        <nav className="flex gap-4 mb-3 text-sm flex-wrap">
          <a href="/" className="text-neutral-500 hover:text-neutral-300">Brain 1 (Intent)</a>
          <span className="text-neutral-200 font-medium">Brain 2 (Metrics)</span>
          <a href="/brain3" className="text-neutral-500 hover:text-neutral-300">Brain 3 (Gaps)</a>
          <a href="/run" className="text-neutral-500 hover:text-neutral-300">Run (full pipeline)</a>
        </nav>
        <h1 className="text-2xl font-semibold">Brain 2 — Metrics Tester</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Type any GA4 question. Pipeline mode runs Brain 1 → Brain 2 and shows both outputs. Direct mode skips Brain 1 and feeds a hand-crafted Intent.
        </p>
      </header>

      <section className="mb-6">
        <div className="inline-flex rounded-md border border-neutral-800 bg-neutral-900 p-1">
          <button onClick={() => setMode("pipeline")} className={`text-xs px-3 py-1.5 rounded ${mode === "pipeline" ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
            Pipeline (B1 → B2)
          </button>
          <button onClick={() => setMode("direct")} className={`text-xs px-3 py-1.5 rounded ${mode === "direct" ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200"}`}>
            Direct (paste Intent)
          </button>
        </div>
      </section>

      <section className="space-y-4">
        {mode === "pipeline" ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5">Question</label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. weekly sessions by country for the last 4 weeks"
                rows={3}
                className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-600"
              />
            </div>
            <div>
              <button type="button" onClick={() => setMemoryEnabled((v) => !v)} className="text-xs text-neutral-400 hover:text-neutral-200">
                {memoryEnabled ? "▾" : "▸"} Memory (optional, simulates a prior turn)
              </button>
              {memoryEnabled && (
                <textarea
                  value={memoryText}
                  onChange={(e) => setMemoryText(e.target.value)}
                  placeholder='{"last_report_type":"weekly_summary",...}'
                  rows={4}
                  className="mt-2 w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs font-mono focus:outline-none focus:border-neutral-600"
                />
              )}
            </div>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1.5">Intent JSON</label>
            <p className="text-xs text-neutral-500 mb-1.5">
              Must match the Brain 1 IntentOutput schema. Run Brain 1 first and copy its output to seed this.
            </p>
            <textarea
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              placeholder={`{\n  "report_type": "regional_breakdown",\n  "sub_questions": [{"id":"q1","natural_language":"sessions by country","kind":"primary"}],\n  "scope": {"dateRange":"last_30_days","regions":null,"filters_hint":[]},\n  "is_followup": false,\n  "ambiguity_flags": []\n}`}
              rows={12}
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs font-mono focus:outline-none focus:border-neutral-600"
            />
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={onRun} disabled={running} className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2 rounded-md">
            {running ? "Running…" : mode === "pipeline" ? "Run pipeline" : "Run Brain 2"}
          </button>

          {mode === "pipeline" && (
            <select
              onChange={(e) => { if (e.target.value !== "") loadSample(Number(e.target.value)); e.target.value = ""; }}
              defaultValue=""
              className="text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2"
            >
              <option value="" disabled>Load sample question…</option>
              {SAMPLES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
            </select>
          )}
        </div>

        {clientError && (
          <div className="rounded-md border border-red-900 bg-red-950/50 text-red-200 text-sm px-3 py-2">
            {clientError}
          </div>
        )}
      </section>

      {result?.ok && result.brain1 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
            <span>Brain 1 (Intent)</span>
            <TimingBadges result={result.brain1} />
          </h2>
          <pre className="rounded-md bg-neutral-900 border border-neutral-800 p-4 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain1.output, null, 2)}
          </pre>
        </section>
      )}

      {result?.ok && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-neutral-300 mb-3 flex items-center gap-2 flex-wrap">
            <span>Brain 2 (Metrics)</span>
            <TimingBadges result={result.brain2} />
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">catalog-validated</span>
          </h2>

          <div className="space-y-3">
            {((result.brain2.output as { queries: Query[] }).queries).map((q, i) => (
              <QueryCard key={i} query={q} index={i} />
            ))}
          </div>

          <details className="mt-4">
            <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">raw MetricsOutput JSON</summary>
            <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain2.output, null, 2)}
            </pre>
          </details>
        </section>
      )}

      {result && !result.ok && (
        <section className="mt-8 space-y-3">
          {result.brain1 && (
            <div>
              <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
                <span>Brain 1 (Intent)</span>
                <TimingBadges result={result.brain1} />
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">ok</span>
              </h2>
              <pre className="rounded-md bg-neutral-900 border border-neutral-800 p-4 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain1.output, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
              <span>Error in {result.stage ?? "request"}</span>
              {result.timing && (
                <>
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badgeForLatency(result.timing.total_ms, "total")}`}>total: {result.timing.total_ms}ms</span>
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300">{result.timing.attempts} attempts</span>
                </>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-950 text-red-300">failed</span>
            </h2>
            <div className="rounded-md border border-red-900 bg-red-950/40 text-red-200 text-sm px-3 py-2">
              {result.error}
            </div>
            {result.catalog_issues && result.catalog_issues.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-neutral-500 mb-1">Unknown catalog names (rejected):</div>
                <ul className="text-xs font-mono text-red-300 space-y-0.5">
                  {result.catalog_issues.map((i, idx) => (
                    <li key={idx}>· <span className="text-red-200">{i.name}</span> ({i.kind}) at {i.location} in {i.query_id}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.zod_issues !== undefined && (
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">Zod issues</summary>
                <pre className="mt-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded p-2 overflow-auto">{JSON.stringify(result.zod_issues, null, 2)}</pre>
              </details>
            )}
            {result.raw_output !== undefined && (
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">Raw model output</summary>
                <pre className="mt-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded p-2 overflow-auto whitespace-pre-wrap">{result.raw_output}</pre>
              </details>
            )}
          </div>
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-900 text-xs text-neutral-600">
        Brain 2 · catalog-grounded · <code className="font-mono">POST /api/brain2</code>
      </footer>
    </main>
  );
}
