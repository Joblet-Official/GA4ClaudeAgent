"use client";

/**
 * Orchestrate — full B1→B6 pipeline UI.
 *
 * POSTs to /api/orchestrate and visualises the orchestrator's per-stage state:
 * which brain ran, on which provider, ok/escalated/failed, and timing — plus a
 * link to the generated report. Answers "did all six brains run?" at a glance.
 */
import { useEffect, useState } from "react";

const SAMPLES = [
  { label: "sessions by country last 7 days", question: "sessions by country for the last 7 days" },
  { label: "daily sessions last 30 days", question: "daily sessions over the last 30 days" },
  { label: "drill-down — India by city", question: "for India, sessions and users by city last 30 days" },
  { label: "vague — should ask", question: "how are we doing on engagement" },
];

const STAGE_META: Record<string, { label: string; role: string }> = {
  brain1: { label: "Brain 1", role: "Intent" },
  brain2: { label: "Brain 2", role: "Query Planning" },
  brain3: { label: "Brain 3", role: "Clarification" },
  brain4: { label: "Brain 4", role: "Data Access (dual-path)" },
  brain5: { label: "Brain 5", role: "Data Handling" },
  brain6: { label: "Brain 6", role: "Visualisation" },
};
const PIPELINE = ["brain1", "brain2", "brain3", "brain4", "brain5", "brain6"];

interface Stage {
  brain: string;
  provider: string;
  status: "running" | "ok" | "escalated" | "failed";
  usedFallback?: boolean;
  primaryError?: string;
  error?: string;
  ms?: number;
}
interface OrchState {
  startedAt: number | null;
  stages: Stage[];
}
interface CompleteResp {
  ok: true;
  status: "complete";
  report_path: string;
  /** Inline report HTML — opened as a Blob so it works on Vercel's read-only FS. */
  report_html?: string;
  brain4: { source: string; reconciled: boolean };
  brain5: { source: string; blocks: number };
  brain6: { source: string; sections: number };
  orchestrator: OrchState;
}
interface ClarifyResp {
  ok: true;
  status: "needs_clarification";
  question_for_user: string | null;
  options: Array<{ label: string; value: string }> | null;
  orchestrator: OrchState;
}
interface ErrorResp {
  ok: false;
  error: string;
  name?: string;
  orchestrator?: OrchState;
}
type ApiResp = CompleteResp | ClarifyResp | ErrorResp;

interface RoutingRow {
  brain: string;
  canonical: string;
  fallback: string | null;
  executes_on: string;
  override_active: boolean;
}
interface RoutingResp {
  ok: boolean;
  rows: RoutingRow[];
  any_override: boolean;
}

function short(p: string): string {
  return p.replace("deepseek_", "");
}

function triage(message: string, name?: string): { label: string; hint: string } {
  const m = `${name ?? ""} ${message}`.toLowerCase();
  if (/connection error|econnreset|apiconnection/.test(m))
    return { label: "DeepSeek host instability", hint: "Documented infra limitation of the NVIDIA-hosted DeepSeek Pro endpoint (idle-stream reset ~38s). Not a pipeline bug." };
  if (/validationerror|schema validation|failed validation/.test(m))
    return { label: "Brain validation", hint: "The brain's output failed Zod/catalog validation twice. Inspect raw_output/zod_issues via the per-brain routes." };
  if (/ga4|runreport|property_id|baseline/.test(m))
    return { label: "GA4 retrieval", hint: "GA4 Data API failure — check GA4_PROPERTY_ID, service-account credentials, and per-query error fields." };
  if (/rate limit|quota|429/.test(m))
    return { label: "Provider quota", hint: "The LLM provider rate-limited the call. Wait and retry, or adjust provider routing." };
  return { label: "Unclassified", hint: "Not matched to a known failure class — read the message and the failed stage below." };
}

function StagePill({ status }: { status: Stage["status"] | "pending" | "skipped" }) {
  const styles: Record<string, string> = {
    ok: "bg-green-950 text-green-300 border-green-900",
    escalated: "bg-blue-950 text-blue-300 border-blue-900",
    failed: "bg-red-950 text-red-300 border-red-900",
    running: "bg-amber-950 text-amber-300 border-amber-900",
    pending: "bg-neutral-900 text-neutral-500 border-neutral-800",
    skipped: "bg-neutral-900 text-neutral-600 border-neutral-800",
  };
  const labels: Record<string, string> = {
    ok: "✓ ok",
    escalated: "↗ escalated (flash→pro)",
    failed: "✗ failed",
    running: "… running",
    pending: "· pending",
    skipped: "– skipped",
  };
  return <span className={`text-xs font-mono px-2 py-0.5 rounded border ${styles[status]}`}>{labels[status]}</span>;
}

function StageTracker({ state, terminal }: { state?: OrchState; terminal: "complete" | "needs_clarification" | "failed" | null }) {
  const byBrain = new Map((state?.stages ?? []).map((s) => [s.brain, s]));
  return (
    <div className="space-y-2">
      {PIPELINE.map((b) => {
        const meta = STAGE_META[b]!;
        const st = byBrain.get(b);
        let status: Stage["status"] | "pending" | "skipped" = st?.status ?? "pending";
        if (!st && terminal === "needs_clarification") status = "skipped";
        return (
          <div key={b} className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-2.5 flex-wrap">
            <span className="text-sm font-semibold text-neutral-200 w-16">{meta.label}</span>
            <span className="text-xs text-neutral-500 w-44">{meta.role}</span>
            <StagePill status={status} />
            {st?.provider && <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{st.provider}</span>}
            {typeof st?.ms === "number" && <span className="text-xs font-mono text-neutral-500">{st.ms.toLocaleString()}ms</span>}
            {st?.usedFallback && st.primaryError && (
              <span className="text-xs text-blue-300/80" title={st.primaryError}>flash failed → pro recovered</span>
            )}
            {st?.error && <span className="text-xs text-red-300 break-all">{st.error}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function OrchestratePage() {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ApiResp | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [routing, setRouting] = useState<RoutingResp | null>(null);

  useEffect(() => {
    fetch("/api/routing")
      .then((r) => r.json())
      .then((j: RoutingResp) => setRouting(j))
      .catch(() => setRouting(null));
  }, []);

  async function runPipeline(memory?: unknown, questionOverride?: string) {
    const q = (questionOverride ?? question).trim();
    setClientError(null);
    setResult(null);
    if (!q) {
      setClientError("Type a question first.");
      return;
    }
    setRunning(true);
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const r = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(memory === undefined ? { question: q } : { question: q, memory }),
      });
      setResult((await r.json()) as ApiResp);
    } catch (e) {
      setResult({ ok: false, error: (e as Error).message });
    } finally {
      clearInterval(tick);
      setRunning(false);
    }
  }

  function onRun() {
    void runPipeline();
  }

  /**
   * Answer Brain 3's clarification: fold the chosen option into the question
   * text (B1's memory convention is previous-turn context, not clarifications —
   * and the brains stay unmodified), update the textarea so the user sees the
   * effective question, and re-run.
   */
  function answerClarification(_questionForUser: string | null, opt: { label: string; value: string }) {
    const augmented = `${question.trim()} — use ${opt.label} (${opt.value})`;
    setQuestion(augmented);
    void runPipeline(undefined, augmented);
  }

  const terminal: "complete" | "needs_clarification" | "failed" | null = result
    ? result.ok
      ? result.status
      : "failed"
    : null;
  const orchState = result ? (result as { orchestrator?: OrchState }).orchestrator : undefined;
  const reportFile =
    result?.ok && result.status === "complete" ? result.report_path.split(/[\\/]/).pop() ?? null : null;
  const failure = result && !result.ok ? triage(result.error, result.name) : null;

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <header className="mb-8">
        <nav className="flex gap-4 mb-3 text-sm flex-wrap">
          <a href="/" className="text-neutral-500 hover:text-neutral-300">Brain 1</a>
          <a href="/brain2" className="text-neutral-500 hover:text-neutral-300">Brain 2</a>
          <a href="/brain3" className="text-neutral-500 hover:text-neutral-300">Brain 3</a>
          <a href="/run" className="text-neutral-500 hover:text-neutral-300">Run (B1→B3)</a>
          <span className="text-neutral-200 font-medium">Orchestrate (B1→B6)</span>
        </nav>
        <h1 className="text-2xl font-semibold">Orchestrate — full six-brain pipeline</h1>
        <p className="text-sm text-neutral-400 mt-1">
          B1 Intent → B2 Query Planning → B3 Clarification → B4 Data Access (dual-path) → B5 Data Handling → B6 Report.
          Runs under the Orchestrator; every stage&apos;s status is shown below.
        </p>
        {routing && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-neutral-500">Live routing:</span>
              {routing.rows.map((r) => (
                <span
                  key={r.brain}
                  title={r.override_active ? `canonical: ${r.canonical} — temporary localhost override active` : `canonical: ${r.canonical}${r.fallback ? ` → ${r.fallback}` : ""}`}
                  className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
                    r.override_active
                      ? "bg-amber-950 text-amber-300 border-amber-900"
                      : "bg-neutral-900 text-neutral-400 border-neutral-800"
                  }`}
                >
                  B{r.brain.replace("brain", "")}: {short(r.executes_on)}
                  {r.fallback && !r.override_active ? `→${short(r.fallback)}` : ""}
                  {r.override_active ? " (temp)" : ""}
                </span>
              ))}
            </div>
            {routing.any_override && (
              <p className="text-xs text-amber-400/80 mt-1.5">
                ⚠ Temporary localhost override active (set in .env.local): amber brains run on Flash because the
                NVIDIA-hosted DeepSeek Pro endpoint resets idle connections (~38s). Canonical/production routing is unchanged.
              </p>
            )}
            <p className="text-xs text-neutral-500 mt-1.5">
              Calls on this host are slow and variable (up to minutes); an occasional ~38s &quot;Connection error&quot; can hit
              Flash too — re-running usually succeeds. One pipeline run at a time.
            </p>
          </div>
        )}
      </header>

      <section className="space-y-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. sessions by country for the last 7 days"
          rows={3}
          className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:border-neutral-600"
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-800 disabled:text-neutral-500 text-white text-sm font-medium px-4 py-2 rounded-md"
          >
            {running ? `Running… ${elapsed}s` : "Run pipeline"}
          </button>
          <select
            onChange={(e) => {
              const i = Number(e.target.value);
              if (SAMPLES[i]) {
                setQuestion(SAMPLES[i].question);
                setResult(null);
                setClientError(null);
              }
              e.target.value = "";
            }}
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

      {(running || result) && (
        <section className="mt-8">
          <h2 className="text-base font-medium text-neutral-200 mb-3">Pipeline stages</h2>
          <StageTracker state={orchState} terminal={terminal} />
        </section>
      )}

      {result?.ok && result.status === "complete" && (
        <section className="mt-8 rounded-lg border border-green-900 bg-green-950/20 p-5">
          <div className="text-green-200 text-base font-medium mb-2">✓ Pipeline complete — all six brains executed</div>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
              B4: {result.brain4.source}{result.brain4.reconciled ? " · reconciled" : " · fallback"}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
              B5: {result.brain5.source} · {result.brain5.blocks} block{result.brain5.blocks === 1 ? "" : "s"}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-300">
              B6: {result.brain6.source} · {result.brain6.sections} section{result.brain6.sections === 1 ? "" : "s"}
            </span>
          </div>
          {result.report_html ? (
            <button
              onClick={() => {
                // Blob URL: renders the report without any server file read —
                // required on Vercel, where the /tmp report file is per-instance.
                const url = URL.createObjectURL(new Blob([result.report_html!], { type: "text/html" }));
                window.open(url, "_blank", "noreferrer");
              }}
              className="inline-block bg-green-700 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-md"
            >
              Open report ↗
            </button>
          ) : reportFile ? (
            <a
              href={`/api/reports/${encodeURIComponent(reportFile)}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block bg-green-700 hover:bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-md"
            >
              Open report ↗
            </a>
          ) : null}
          <div className="text-xs text-neutral-500 mt-3 font-mono break-all">{result.report_path}</div>
        </section>
      )}

      {result?.ok && result.status === "needs_clarification" && (
        <section className="mt-8 rounded-lg border border-amber-900 bg-amber-950/30 p-5">
          <div className="text-amber-100 text-base font-medium mb-3">{result.question_for_user}</div>
          {result.options && (
            <div className="flex flex-wrap gap-2">
              {result.options.map((opt, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={running}
                  onClick={() => answerClarification(result.question_for_user, opt)}
                  className="text-sm px-3 py-1.5 rounded-md border bg-neutral-900 border-amber-900 text-amber-200 hover:bg-amber-950 hover:border-amber-700 disabled:opacity-50 cursor-pointer"
                >
                  {opt.label} <span className="ml-1 text-xs font-mono text-amber-400">{opt.value}</span>
                </button>
              ))}
            </div>
          )}
          <div className="text-xs text-amber-300/70 mt-3">
            Brain 3 paused the pipeline — B4–B6 were intentionally skipped. <span className="text-amber-200">Click an option above</span> to
            answer and re-run the full pipeline with your choice, or refine the question and run again.
          </div>
        </section>
      )}

      {result && !result.ok && failure && (
        <section className="mt-8 rounded-lg border border-red-900 bg-red-950/30 p-5">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-red-200 text-base font-medium">✗ Pipeline failed</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-900">{failure.label}</span>
            {result.name && <span className="text-xs font-mono px-2 py-0.5 rounded bg-neutral-900 text-neutral-400 border border-neutral-800">{result.name}</span>}
          </div>
          <div className="text-sm text-red-200/90 whitespace-pre-wrap break-all mb-2">{result.error}</div>
          <div className="text-xs text-neutral-400">{failure.hint}</div>
        </section>
      )}

      <footer className="mt-12 pt-6 border-t border-neutral-900 text-xs text-neutral-600">
        Orchestrated pipeline · <code className="font-mono">POST /api/orchestrate</code> · reports written to <code className="font-mono">./reports</code>
      </footer>
    </main>
  );
}
