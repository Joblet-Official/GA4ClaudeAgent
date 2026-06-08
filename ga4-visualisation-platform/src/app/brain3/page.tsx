"use client";

import { useState } from "react";

const SAMPLES = [
  { label: "approve — sessions by country last 7 days", question: "sessions by country for the last 7 days" },
  { label: "default — no date specified", question: "sessions by country" },
  { label: "clarify — vague 'how are we doing'", question: "how are we doing" },
  { label: "clarify — ambiguous 'engagement'", question: "how are we doing on engagement" },
  { label: "approve — explicit comparison", question: "compare sessions this week vs last week" },
  { label: "approve — drill-down with region", question: "for India, sessions and users by city last 30 days" },
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

interface SuccessResp { ok: true; brain1?: BrainPanel; brain2?: BrainPanel; brain3: BrainPanel; }
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
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badge(panel.timing.ttft_ms, [2000, 8000])}`} title="time-to-first-token">
        TTFT: {panel.timing.ttft_ms}ms
      </span>
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badge(panel.timing.total_ms, [8000, 20000])}`}>
        total: {panel.timing.total_ms}ms
      </span>
      {panel.timing.attempts > 1 && (
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300">
          {panel.timing.attempts} attempts
        </span>
      )}
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
  };
  const labels = {
    approved: "✓ approved",
    default_applied: "↳ default applied",
    needs_clarification: "? needs clarification",
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

export default function Brain3Page() {
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
      const r = await fetch("/api/brain3", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
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
    setQuestion(s.question);
    setResult(null);
    setClientError(null);
    setPickedOption(null);
  }

  const b3Output = result?.ok ? (result.brain3.output as Brain3Output) : null;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      <header className="mb-8">
        <nav className="flex gap-4 mb-3 text-sm flex-wrap">
          <a href="/" className="text-neutral-500 hover:text-neutral-300">Brain 1 (Intent)</a>
          <a href="/brain2" className="text-neutral-500 hover:text-neutral-300">Brain 2 (Metrics)</a>
          <span className="text-neutral-200 font-medium">Brain 3 (Gaps)</span>
          <a href="/run" className="text-neutral-500 hover:text-neutral-300">Run (full pipeline)</a>
        </nav>
        <h1 className="text-2xl font-semibold">Brain 3 — Gaps Tester</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Runs Brain 1 → Brain 2 → Brain 3. Brain 3 decides: approve, apply a default, or ask the user.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. how are we doing on engagement"
            rows={3}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-600"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={onRun} disabled={running} className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2 rounded-md">
            {running ? "Running…" : "Run pipeline"}
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
          {result.brain1 && (
            <section className="mt-8">
              <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
                <span>Brain 1 (Intent)</span>
                <TimingBadges panel={result.brain1} />
              </h2>
              <details>
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">intent JSON</summary>
                <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain1.output, null, 2)}
                </pre>
              </details>
            </section>
          )}

          {result.brain2 && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
                <span>Brain 2 (Metrics)</span>
                <TimingBadges panel={result.brain2} />
              </h2>
              <details>
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">queries JSON</summary>
                <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(result.brain2.output, null, 2)}
                </pre>
              </details>
            </section>
          )}

          {b3Output && (
            <section className="mt-6">
              <h2 className="text-sm font-medium text-neutral-300 mb-3 flex items-center gap-2 flex-wrap">
                <span>Brain 3 (Gaps)</span>
                <StatusPill status={b3Output.status} />
                <TimingBadges panel={result.brain3} />
              </h2>

              {b3Output.status === "needs_clarification" && (
                <div className="rounded-lg border border-amber-900 bg-amber-950/30 p-5 mb-3">
                  <div className="text-amber-100 text-base font-medium mb-3">
                    {b3Output.question_for_user}
                  </div>
                  {b3Output.options && (
                    <div className="flex flex-wrap gap-2">
                      {b3Output.options.map((opt, i) => (
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
                      You picked: <span className="font-mono">{pickedOption.value}</span>. (Wiring this back into the pipeline is the orchestrator's job — not built yet.)
                    </div>
                  )}
                </div>
              )}

              {b3Output.status === "default_applied" && b3Output.defaults_applied && (
                <div className="rounded-lg border border-blue-900 bg-blue-950/30 p-4 mb-3">
                  <div className="text-blue-300 text-sm mb-2">Defaults applied (user wasn't prompted):</div>
                  <pre className="text-xs font-mono text-blue-100 whitespace-pre-wrap">
{JSON.stringify(b3Output.defaults_applied, null, 2)}
                  </pre>
                </div>
              )}

              {b3Output.status === "approved" && (
                <div className="rounded-lg border border-green-900 bg-green-950/30 px-4 py-3 mb-3 text-sm text-green-300">
                  Approved — queries are ready for the Tool Layer. No clarification needed.
                </div>
              )}

              <details>
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">
                  approved_queries ({b3Output.approved_queries.length})
                </summary>
                <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(b3Output.approved_queries, null, 2)}
                </pre>
              </details>
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">raw Brain 3 JSON</summary>
                <pre className="mt-2 rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
{JSON.stringify(b3Output, null, 2)}
                </pre>
              </details>
            </section>
          )}
        </>
      )}

      {result && !result.ok && (
        <section className="mt-8 space-y-3">
          {result.brain1 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
                <span>Brain 1</span>
                <TimingBadges panel={result.brain1} />
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">ok</span>
              </h3>
            </div>
          )}
          {result.brain2 && (
            <div>
              <h3 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
                <span>Brain 2</span>
                <TimingBadges panel={result.brain2} />
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-950 text-green-300">ok</span>
              </h3>
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
              <span>Error in {result.stage ?? "request"}</span>
              {result.stage_provider && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{result.stage_provider} · {result.stage_model}</span>
              )}
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-950 text-red-300">failed</span>
            </h3>
            <div className="rounded-md border border-red-900 bg-red-950/40 text-red-200 text-sm px-3 py-2 whitespace-pre-wrap">{result.error}</div>
            {result.catalog_issues && result.catalog_issues.length > 0 && (
              <details className="mt-2" open>
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">unknown catalog names</summary>
                <ul className="mt-1 text-xs font-mono text-red-300 space-y-0.5">
                  {result.catalog_issues.map((i, idx) => (
                    <li key={idx}>· <span className="text-red-200">{i.name}</span> ({i.kind}) at {i.location} in {i.query_id}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.zod_issues !== undefined && (
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">Zod issues</summary>
                <pre className="mt-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded p-2 overflow-auto">{JSON.stringify(result.zod_issues, null, 2)}</pre>
              </details>
            )}
            {result.raw_output !== undefined && (
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer hover:text-neutral-300">raw model output</summary>
                <pre className="mt-1 text-xs font-mono bg-neutral-900 border border-neutral-800 rounded p-2 overflow-auto whitespace-pre-wrap">{result.raw_output}</pre>
              </details>
            )}
          </div>
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-900 text-xs text-neutral-600">
        Brain 3 · gate before the Tool Layer · <code className="font-mono">POST /api/brain3</code>
      </footer>
    </main>
  );
}
