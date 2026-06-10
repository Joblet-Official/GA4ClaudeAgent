"use client";

import { useState } from "react";

const SAMPLES = [
  { label: "sessions by country last 7 days", question: "sessions by country for the last 7 days" },
  { label: "daily sessions last 30 days", question: "daily sessions over the last 30 days" },
  { label: "drill-down — India by city", question: "for India, sessions and users by city last 30 days" },
  { label: "compare this week vs last week", question: "compare sessions this week vs last week" },
  { label: "weekly summary by region (6 weeks)", question: "weekly sessions and applies by region for the last 6 weeks" },
  { label: "vague — should ask", question: "how are we doing on engagement" },
  { label: "no date — should default", question: "sessions by country" },
];

interface Timing { ttft_ms: number; total_ms: number; attempts: number; }
interface BrainPanel { output: unknown; timing: Timing; provider: string; model: string; }
interface Brain3Output {
  status: "approved" | "default_applied" | "needs_clarification";
  question_for_user: string | null;
  options: Array<{ label: string; value: string }> | null;
  defaults_applied: Record<string, unknown> | null;
  approved_queries: unknown[];
}
interface ToolResult {
  query_id: string;
  rows: Array<Record<string, string | number>>;
  dimensionHeaders: string[];
  metricHeaders: Array<{ name: string; type: string }>;
  rowCount: number;
  metadata: { sampled: boolean; dataLossFromOtherRow: boolean };
  latency_ms: number;
  error?: string;
}
interface SuccessResp {
  ok: true;
  brain1: BrainPanel;
  brain2: BrainPanel;
  brain3: BrainPanel;
  tool: { results: ToolResult[]; total_ms: number } | null;
}
interface ErrorResp {
  ok: false;
  stage?: "brain1" | "brain2" | "brain3";
  error: string;
  raw_output?: string;
  zod_issues?: unknown;
  catalog_issues?: Array<{ query_id: string; kind: string; name: string; location: string }>;
  timing?: Timing;
  brain1?: BrainPanel;
  brain2?: BrainPanel;
  stage_provider?: string;
  stage_model?: string;
}
type ApiResp = SuccessResp | ErrorResp;

function badge(ms: number, thresholds: [number, number]) {
  if (ms < thresholds[0]) return "bg-green-950 text-green-300";
  if (ms < thresholds[1]) return "bg-yellow-950 text-yellow-300";
  return "bg-red-950 text-red-300";
}
function TimingBadges({ panel }: { panel: BrainPanel }) {
  return (
    <>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badge(panel.timing.ttft_ms, [2000, 8000])}`}>
        TTFT: {panel.timing.ttft_ms}ms
      </span>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badge(panel.timing.total_ms, [8000, 20000])}`}>
        total: {panel.timing.total_ms}ms
      </span>
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
        {panel.provider} · {panel.model}
      </span>
    </>
  );
}
function StatusPill({ status }: { status: Brain3Output["status"] }) {
  const styles = {
    approved: "bg-green-950 text-green-300 border-green-900",
    default_applied: "bg-blue-950 text-blue-300 border-blue-900",
    needs_clarification: "bg-amber-950 text-amber-300 border-amber-900",
  } as const;
  const labels = { approved: "✓ approved", default_applied: "↳ default applied", needs_clarification: "? needs clarification" } as const;
  return <span className={`text-xs font-mono px-2 py-0.5 rounded border ${styles[status]}`}>{labels[status]}</span>;
}

function fmtNum(v: string | number): string {
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString();
    return v.toFixed(2);
  }
  return v;
}

function DataTable({ result, query }: { result: ToolResult; query: { id: string; expected_shape: string; request_body: { dimensions: Array<{name: string}>; metrics: Array<{name: string}>; dateRanges: Array<{startDate: string; endDate: string; name?: string}> } } }) {
  const allCols = [...result.dimensionHeaders, ...result.metricHeaders.map((m) => m.name)];
  const numericCols = new Set(result.metricHeaders.map((m) => m.name));
  const ROWS_SHOWN = 50;
  const rowsToShow = result.rows.slice(0, ROWS_SHOWN);

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 mb-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-semibold text-neutral-200">Query {query.id}</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-900">{query.expected_shape}</span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
          {result.rowCount} rows · returned {result.rows.length}
        </span>
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">GA4: {result.latency_ms}ms</span>
        {result.metadata.sampled && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300">sampled</span>
        )}
        {result.metadata.dataLossFromOtherRow && (
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300">(other) row</span>
        )}
      </div>
      <div className="text-xs text-neutral-500 mb-3 flex flex-wrap gap-1.5">
        {query.request_body.dateRanges.map((dr, i) => (
          <span key={i} className="font-mono">
            {dr.name ? `${dr.name}: ` : ""}{dr.startDate} → {dr.endDate}
          </span>
        ))}
      </div>

      {result.error ? (
        <div className="text-sm text-red-300 bg-red-950/40 border border-red-900 rounded p-3">{result.error}</div>
      ) : result.rows.length === 0 ? (
        <div className="text-sm text-neutral-500 italic">No rows returned.</div>
      ) : (
        <div className="overflow-auto rounded border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-300">
              <tr>
                {allCols.map((col) => (
                  <th key={col} className={`px-3 py-2 font-mono text-xs font-semibold ${numericCols.has(col) ? "text-right" : "text-left"}`}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rowsToShow.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-neutral-950" : "bg-neutral-900/50"}>
                  {allCols.map((col) => {
                    const v = row[col];
                    return (
                      <td key={col} className={`px-3 py-1.5 font-mono text-xs ${numericCols.has(col) ? "text-right text-emerald-300" : "text-neutral-300"}`}>
                        {v === undefined ? "" : fmtNum(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {result.rows.length > ROWS_SHOWN && (
            <div className="text-xs text-neutral-500 px-3 py-2 bg-neutral-900 border-t border-neutral-800">
              showing {ROWS_SHOWN} of {result.rows.length} rows
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RunPage() {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ApiResp | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pickedOption, setPickedOption] = useState<{ label: string; value: string } | null>(null);

  async function onRun() {
    setClientError(null);
    setResult(null);
    setPickedOption(null);
    if (!question.trim()) {
      setClientError("Type a question first.");
      return;
    }
    setRunning(true);
    try {
      const r = await fetch("/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setResult((await r.json()) as ApiResp);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  function loadSample(idx: number) {
    const s = SAMPLES[idx];
    if (!s) return;
    setQuestion(s.question);
    setResult(null);
    setClientError(null);
    setPickedOption(null);
  }

  const b3 = result?.ok ? (result.brain3.output as Brain3Output) : null;
  const b2Queries = result?.ok ? (result.brain2.output as { queries: Array<{ id: string; expected_shape: string; request_body: { dimensions: Array<{ name: string }>; metrics: Array<{ name: string }>; dateRanges: Array<{ startDate: string; endDate: string; name?: string }> } }> }).queries : [];

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8">
        <nav className="flex gap-4 mb-3 text-sm flex-wrap">
          <a href="/" className="text-neutral-500 hover:text-neutral-300">Brain 1</a>
          <a href="/brain2" className="text-neutral-500 hover:text-neutral-300">Brain 2</a>
          <a href="/brain3" className="text-neutral-500 hover:text-neutral-300">Brain 3</a>
          <span className="text-neutral-200 font-medium">Run (full pipeline)</span>
          <a href="/orchestrate" className="text-neutral-500 hover:text-neutral-300">Orchestrate (B1→B6)</a>
        </nav>
        <h1 className="text-2xl font-semibold">Run — full pipeline with GA4 data</h1>
        <p className="text-sm text-neutral-400 mt-1">
          B1 → B2 → B3 → Tool Layer. If Brain 3 needs clarification, the GA4 call is skipped and we ask you instead.
        </p>
      </header>

      <section className="space-y-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. for India, sessions and users by city last 30 days"
          rows={3}
          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-600"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={onRun} disabled={running} className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2 rounded-md">
            {running ? "Running pipeline…" : "Run"}
          </button>
          <select
            onChange={(e) => { if (e.target.value !== "") loadSample(Number(e.target.value)); e.target.value = ""; }}
            defaultValue=""
            className="text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2"
          >
            <option value="" disabled>Load sample question…</option>
            {SAMPLES.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
        </div>

        {clientError && (
          <div className="rounded-md border border-red-900 bg-red-950/50 text-red-200 text-sm px-3 py-2">{clientError}</div>
        )}
      </section>

      {result?.ok && (
        <>
          <section className="mt-8 space-y-2">
            <details>
              <summary className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 flex items-center gap-2 flex-wrap">
                <span className="font-medium">Brain 1 (Intent)</span>
                <TimingBadges panel={result.brain1} />
              </summary>
              <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain1.output, null, 2)}
              </pre>
            </details>

            <details>
              <summary className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 flex items-center gap-2 flex-wrap">
                <span className="font-medium">Brain 2 (Metrics)</span>
                <TimingBadges panel={result.brain2} />
              </summary>
              <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain2.output, null, 2)}
              </pre>
            </details>

            <details open>
              <summary className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 flex items-center gap-2 flex-wrap">
                <span className="font-medium">Brain 3 (Gaps)</span>
                {b3 && <StatusPill status={b3.status} />}
                <TimingBadges panel={result.brain3} />
              </summary>
              {b3?.status === "needs_clarification" && (
                <div className="mt-3 rounded-lg border border-amber-900 bg-amber-950/30 p-5">
                  <div className="text-amber-100 text-base font-medium mb-3">{b3.question_for_user}</div>
                  {b3.options && (
                    <div className="flex flex-wrap gap-2">
                      {b3.options.map((opt, i) => (
                        <button
                          key={i}
                          onClick={() => setPickedOption(opt)}
                          className={`text-sm px-3 py-1.5 rounded-md border ${
                            pickedOption?.value === opt.value
                              ? "bg-amber-800 border-amber-600 text-amber-50"
                              : "bg-neutral-900 border-amber-900 text-amber-200 hover:bg-amber-950"
                          }`}
                        >
                          {opt.label}
                          <span className="ml-2 text-xs font-mono text-amber-400">{opt.value}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {pickedOption && (
                    <div className="mt-3 text-xs text-amber-300/80">
                      Picked: <span className="font-mono">{pickedOption.value}</span>. (Re-running with this answer is the orchestrator's job — not built yet.)
                    </div>
                  )}
                </div>
              )}
              {b3?.status === "default_applied" && b3.defaults_applied && (
                <div className="mt-3 rounded-lg border border-blue-900 bg-blue-950/30 p-3">
                  <div className="text-blue-300 text-xs mb-1">Defaults applied silently:</div>
                  <pre className="text-xs font-mono text-blue-100 whitespace-pre-wrap">
{JSON.stringify(b3.defaults_applied, null, 2)}
                  </pre>
                </div>
              )}
            </details>
          </section>

          {result.tool && (
            <section className="mt-8">
              <h2 className="text-base font-medium text-neutral-200 mb-3 flex items-center gap-2 flex-wrap">
                <span>GA4 Data</span>
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                  {result.tool.results.length} {result.tool.results.length === 1 ? "query" : "queries"} · {result.tool.total_ms}ms total
                </span>
              </h2>
              {result.tool.results.map((res, i) => {
                const query = b2Queries[i];
                if (!query) return null;
                return <DataTable key={i} result={res} query={query} />;
              })}
            </section>
          )}
        </>
      )}

      {result && !result.ok && (
        <section className="mt-8 space-y-3">
          {result.brain1 && (
            <details>
              <summary className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 flex items-center gap-2 flex-wrap">
                <span>Brain 1</span><TimingBadges panel={result.brain1} /><span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">ok</span>
              </summary>
              <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">{JSON.stringify(result.brain1.output, null, 2)}</pre>
            </details>
          )}
          {result.brain2 && (
            <details>
              <summary className="text-sm text-neutral-400 cursor-pointer hover:text-neutral-200 flex items-center gap-2 flex-wrap">
                <span>Brain 2</span><TimingBadges panel={result.brain2} /><span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">ok</span>
              </summary>
              <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">{JSON.stringify(result.brain2.output, null, 2)}</pre>
            </details>
          )}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
              <span>Failed at {result.stage ?? "request"}</span>
              {result.stage_provider && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{result.stage_provider} · {result.stage_model}</span>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-950 text-red-300">error</span>
            </h3>
            <div className="rounded-md border border-red-900 bg-red-950/40 text-red-200 text-sm px-3 py-2 whitespace-pre-wrap">{result.error}</div>
            {result.catalog_issues && result.catalog_issues.length > 0 && (
              <ul className="mt-2 text-xs font-mono text-red-300 space-y-0.5">
                {result.catalog_issues.map((i, idx) => (
                  <li key={idx}>· <span className="text-red-200">{i.name}</span> ({i.kind}) at {i.location} in {i.query_id}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-900 text-xs text-neutral-600">
        Full pipeline · <code className="font-mono">POST /api/run</code> · B1→B2→B3 + Tool Layer parallelised on approved_queries
      </footer>
    </main>
  );
}
