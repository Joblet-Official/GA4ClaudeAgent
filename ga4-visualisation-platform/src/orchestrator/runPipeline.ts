/**
 * Orchestrator-driven pipeline runner.
 *
 * Wires Brain 1 → 6 through OrchestratorBrain.runStage, threading each brain's
 * output into the next brain's input. The Orchestrator provides the fixed A1→A6
 * sequencing, per-stage state/timing, and validation checkpoints; routing and
 * Flash→Pro escalation remain owned by the brains (no contract changes).
 *
 * Additive: imports the existing brains unchanged. Brains are injectable via
 * `opts.deps` purely for deterministic testing — production uses the real ones.
 */
import { OrchestratorBrain, type OrchestratorState } from "@/orchestrator/orchestratorBrain";
import { getClient } from "@/lib/nvidia";
import { loadCatalog as defaultLoadCatalog } from "@/support/catalog/loadCatalog";
import { runBrain1Intent } from "@/brains/brain1_intent";
import { runBrain2Metrics } from "@/brains/brain2_metrics";
import { runBrain3Gaps } from "@/brains/brain3_gaps";
import { runBrain4DataAccess } from "@/brains/brain4_dataaccess";
import { runBrain5DataHandling } from "@/brains/brain5_datahandling";
import { runBrain6Report } from "@/brains/brain6_visualisation";

export interface PipelineDeps {
  loadCatalog: typeof defaultLoadCatalog;
  intent: typeof runBrain1Intent;
  metrics: typeof runBrain2Metrics;
  gaps: typeof runBrain3Gaps;
  dataAccess: typeof runBrain4DataAccess;
  dataHandling: typeof runBrain5DataHandling;
  report: typeof runBrain6Report;
}

const DEFAULT_DEPS: PipelineDeps = {
  loadCatalog: defaultLoadCatalog,
  intent: runBrain1Intent,
  metrics: runBrain2Metrics,
  gaps: runBrain3Gaps,
  dataAccess: runBrain4DataAccess,
  dataHandling: runBrain5DataHandling,
  report: runBrain6Report,
};

export interface PipelineInput {
  question: string;
  memory?: unknown;
}

type R1 = Awaited<ReturnType<typeof runBrain1Intent>>;
type R2 = Awaited<ReturnType<typeof runBrain2Metrics>>;
type R3 = Awaited<ReturnType<typeof runBrain3Gaps>>;
type R4 = Awaited<ReturnType<typeof runBrain4DataAccess>>;
type R5 = Awaited<ReturnType<typeof runBrain5DataHandling>>;
type R6 = Awaited<ReturnType<typeof runBrain6Report>>;

export interface PipelineResult {
  status: "complete" | "needs_clarification";
  brain1: R1;
  brain2: R2;
  brain3: R3;
  brain4?: R4;
  brain5?: R5;
  brain6?: R6;
  orchestrator: OrchestratorState;
}

/**
 * Thrown when any stage fails: carries the original error's name/message plus
 * the orchestrator's per-stage state so callers (API/UI) can show exactly which
 * brain failed and how far the pipeline got.
 */
export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly causeName: string,
    public readonly state: OrchestratorState,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/**
 * LOCALHOST RESILIENCE: the NVIDIA-hosted DeepSeek endpoint intermittently
 * resets streaming connections (~38s idle reset — documented infra limitation).
 * Brains 1–3 hard-fail the pipeline on such a reset (no deterministic fallback),
 * so we retry ONLY connection-class failures a few times before surfacing.
 * Validation/auth/GA4 errors are NOT retried. This compensates for unstable
 * hosting; it is not an architectural change and can be removed after the
 * DeepSeek host switch.
 */
const CONNECTION_RESET = /connection error|econnreset|aborted|socket hang up|fetch failed|timed out/i;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;

async function withConnectionRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? String(err);
      if (!CONNECTION_RESET.test(msg) || attempt === RETRY_ATTEMPTS) throw err;
      console.warn(`[pipeline] ${label}: connection-class failure (attempt ${attempt}/${RETRY_ATTEMPTS}) — retrying in ${RETRY_DELAY_MS / 1000}s: ${msg.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw lastErr;
}

/**
 * Brains 1–3 resolve their provider from env at call time (not from the routing
 * map), so the map-derived provider runStage records can be wrong under a
 * localhost env override. Patch their stage entries to the env-resolved truth
 * so the UI/state report what actually executed.
 */
function patchEnvResolvedProviders(state: OrchestratorState): void {
  for (const brain of ["brain1", "brain2", "brain3"] as const) {
    const st = state.stages.find((s) => s.brain === brain);
    if (!st) continue;
    try {
      st.provider = getClient(brain).provider;
    } catch {
      /* missing key — leave the canonical label */
    }
  }
}

/**
 * Run the full pipeline under the Orchestrator. Stops after Brain 3 when it
 * returns `needs_clarification` (the caller asks the user and re-runs).
 */
export async function runPipeline(
  input: PipelineInput,
  opts?: { deps?: Partial<PipelineDeps> },
): Promise<PipelineResult> {
  const deps: PipelineDeps = { ...DEFAULT_DEPS, ...(opts?.deps ?? {}) };
  const orch = new OrchestratorBrain();
  orch.state.startedAt = Date.now();

  try {
    const catalog = deps.loadCatalog();

    const b1 = await orch.runStage("brain1", () =>
      withConnectionRetry("brain1", () =>
        deps.intent({ question: input.question, memory: input.memory ?? null }),
      ),
    );
    const b2 = await orch.runStage("brain2", () =>
      withConnectionRetry("brain2", () => deps.metrics({ intent: b1.output, catalog })),
    );
    const b3 = await orch.runStage("brain3", () =>
      withConnectionRetry("brain3", () =>
        deps.gaps({ intent: b1.output, queries: b2.output.queries }),
      ),
    );

    // Brain 3's LLM re-emits approved_queries and may drop the OPTIONAL
    // `purpose` field. Re-attach it deterministically from Brain 2's plan by
    // query id (B5 shaping + B6 section order key off it).
    {
      const purposeById = new Map(b2.output.queries.map((q) => [q.id, q.purpose]));
      for (const q of b3.output.approved_queries) {
        if (!q.purpose && purposeById.get(q.id)) q.purpose = purposeById.get(q.id);
      }
    }

    if (b3.output.status === "needs_clarification") {
      patchEnvResolvedProviders(orch.state);
      return { status: "needs_clarification", brain1: b1, brain2: b2, brain3: b3, orchestrator: orch.state };
    }

    const b4 = await orch.runStage("brain4", () =>
      deps.dataAccess({ approvedQueries: b3.output.approved_queries, intent: b1.output, catalog }),
    );
    const b5 = await orch.runStage("brain5", () =>
      deps.dataHandling({
        dataset: b4.dataset,
        intent: b1.output,
        approvedQueries: b3.output.approved_queries,
      }),
    );
    // Context for the gold-standard report header: the user's question, the
    // resolved date windows from the approved plan, and the GA4 property id.
    const periods = (b3.output.approved_queries[0]?.request_body?.dateRanges ?? []) as Array<{
      startDate: string;
      endDate: string;
      name?: string;
    }>;
    const b6 = await orch.runStage("brain6", () =>
      deps.report({
        blocks: b5.output,
        intent: b1.output,
        question: input.question,
        periods,
        propertyId: process.env.GA4_PROPERTY_ID,
      }),
    );

    patchEnvResolvedProviders(orch.state);
    return {
      status: "complete",
      brain1: b1,
      brain2: b2,
      brain3: b3,
      brain4: b4,
      brain5: b5,
      brain6: b6,
      orchestrator: orch.state,
    };
  } catch (err) {
    const e = err as Error;
    patchEnvResolvedProviders(orch.state);
    throw new PipelineError(e.message ?? String(err), e.name ?? "Error", orch.state);
  }
}
