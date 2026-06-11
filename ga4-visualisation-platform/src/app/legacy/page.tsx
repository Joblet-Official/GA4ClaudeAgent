"use client";

import { useState } from "react";

interface SampleCase {
  label: string;
  question: string;
  memory: unknown;
}

const SAMPLES: SampleCase[] = [
  {
    label: "single_metric — yesterday's sessions",
    question: "how many sessions did we get yesterday",
    memory: null,
  },
  {
    label: "regional_breakdown — sessions by country last week",
    question: "sessions by country last week",
    memory: null,
  },
  {
    label: "weekly_summary — weekly sessions and applies by region",
    question: "weekly sessions and applies by region for the last 6 weeks",
    memory: null,
  },
  {
    label: "time_series — daily sessions last 30 days",
    question: "show daily sessions over the last 30 days",
    memory: null,
  },
  {
    label: "comparison — this week vs last week",
    question: "compare sessions this week vs last week",
    memory: null,
  },
  {
    label: "drill_down — country to city",
    question: "for India, drill down by city showing sessions and users",
    memory: null,
  },
  {
    label: "followup — break down by country (with memory)",
    question: "now break that down by country",
    memory: {
      last_report_type: "weekly_summary",
      last_scope: {
        dateRange: "last_30_days",
        regions: [],
        filters_hint: [],
      },
      last_questions: ["weekly sessions and applies for the last 30 days"],
    },
  },
  {
    label: "ambiguous — vague engagement question",
    question: "how are we doing on engagement",
    memory: null,
  },
];

interface Timing {
  ttft_ms: number;
  total_ms: number;
  attempts: number;
}
interface SuccessResp {
  ok: true;
  output: unknown;
  timing: Timing;
  provider: string;
  model: string;
}
interface ErrorResp {
  ok: false;
  error: string;
  raw_output?: string;
  zod_issues?: unknown;
  timing?: Timing;
  provider?: string;
  model?: string;
}
type ApiResp = SuccessResp | ErrorResp;

export default function Page() {
  const [question, setQuestion] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ApiResp | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  async function onRun() {
    setClientError(null);
    setResult(null);

    if (!question.trim()) {
      setClientError("Type a question first.");
      return;
    }

    let memory: unknown = null;
    if (memoryEnabled && memoryText.trim()) {
      try {
        memory = JSON.parse(memoryText);
      } catch (e) {
        setClientError(`Memory is not valid JSON: ${(e as Error).message}`);
        return;
      }
    }

    setRunning(true);
    const t0 = Date.now();
    try {
      const r = await fetch("/api/brain1", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, memory }),
      });
      const data = (await r.json()) as ApiResp;
      setResult(data);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      setElapsedMs(Date.now() - t0);
      setRunning(false);
    }
  }

  function loadSample(idx: number) {
    const s = SAMPLES[idx];
    if (!s) return;
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
    <main className="max-w-4xl mx-auto px-6 py-10">
      <header className="mb-8">
        <nav className="flex gap-4 mb-3 text-sm flex-wrap">
          <span className="text-neutral-200 font-medium">Brain 1 (Intent)</span>
          <a href="/brain2" className="text-neutral-500 hover:text-neutral-300">Brain 2 (Metrics)</a>
          <a href="/brain3" className="text-neutral-500 hover:text-neutral-300">Brain 3 (Gaps)</a>
          <a href="/run" className="text-neutral-500 hover:text-neutral-300">Run (full pipeline)</a>
        </nav>
        <h1 className="text-2xl font-semibold">Brain 1 — Intent Tester</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Type any GA4 question. Brain 1 classifies it and returns structured JSON.
        </p>
      </header>

      <section className="space-y-4">
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
          <button
            type="button"
            onClick={() => setMemoryEnabled((v) => !v)}
            className="text-xs text-neutral-400 hover:text-neutral-200"
          >
            {memoryEnabled ? "▾" : "▸"} Memory (optional, simulates a prior turn)
          </button>
          {memoryEnabled && (
            <textarea
              value={memoryText}
              onChange={(e) => setMemoryText(e.target.value)}
              placeholder='{"last_report_type":"weekly_summary","last_scope":{...}}'
              rows={5}
              className="mt-2 w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-xs font-mono focus:outline-none focus:border-neutral-600"
            />
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            {running ? "Running…" : "Run Brain 1"}
          </button>

          <select
            onChange={(e) => {
              if (e.target.value !== "") loadSample(Number(e.target.value));
              e.target.value = "";
            }}
            defaultValue=""
            className="text-sm bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2"
          >
            <option value="" disabled>
              Load sample case…
            </option>
            {SAMPLES.map((s, i) => (
              <option key={i} value={i}>
                {s.label}
              </option>
            ))}
          </select>

          {elapsedMs !== null && !running && (
            <span className="text-xs text-neutral-500">
              client elapsed: {elapsedMs} ms
            </span>
          )}
        </div>

        {clientError && (
          <div className="rounded-md border border-red-900 bg-red-950/50 text-red-200 text-sm px-3 py-2">
            {clientError}
          </div>
        )}
      </section>

      {result && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-neutral-300 mb-2 flex items-center gap-2 flex-wrap">
            <span>Output</span>
            {result.timing && (
              <>
                <span
                  className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    result.timing.ttft_ms < 2000
                      ? "bg-green-950 text-green-300"
                      : result.timing.ttft_ms < 8000
                      ? "bg-yellow-950 text-yellow-300"
                      : "bg-red-950 text-red-300"
                  }`}
                  title="Time-to-first-token — dominated by queue wait on shared infra"
                >
                  TTFT: {result.timing.ttft_ms} ms
                </span>
                <span
                  className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                    result.timing.total_ms < 8000
                      ? "bg-green-950 text-green-300"
                      : result.timing.total_ms < 20000
                      ? "bg-yellow-950 text-yellow-300"
                      : "bg-red-950 text-red-300"
                  }`}
                  title="Total server time including any validation retries"
                >
                  total: {result.timing.total_ms} ms
                </span>
                {result.timing.attempts > 1 && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-950 text-yellow-300" title="A second LLM call was needed because the first failed schema validation">
                    {result.timing.attempts} attempts
                  </span>
                )}
              </>
            )}
            {result.provider && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                {result.provider}
              </span>
            )}
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                result.ok
                  ? "bg-green-950 text-green-300"
                  : "bg-red-950 text-red-300"
              }`}
            >
              {result.ok ? "valid" : "error"}
            </span>
          </h2>

          {result.ok ? (
            <pre className="rounded-md bg-neutral-900 border border-neutral-800 p-4 text-xs font-mono overflow-auto whitespace-pre-wrap">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border border-red-900 bg-red-950/50 text-red-200 text-sm px-3 py-2">
                {result.error}
              </div>
              {result.raw_output !== undefined && (
                <div>
                  <div className="text-xs text-neutral-500 mb-1">
                    Raw model output:
                  </div>
                  <pre className="rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
                    {result.raw_output}
                  </pre>
                </div>
              )}
              {result.zod_issues !== undefined && (
                <div>
                  <div className="text-xs text-neutral-500 mb-1">
                    Zod issues:
                  </div>
                  <pre className="rounded-md bg-neutral-900 border border-neutral-800 p-3 text-xs font-mono overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(result.zod_issues, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-900 text-xs text-neutral-600">
        meta/llama-3.3-70b-instruct via build.nvidia.com · Brain 1 ·{" "}
        <code className="font-mono">POST /api/brain1</code>
      </footer>
    </main>
  );
}
