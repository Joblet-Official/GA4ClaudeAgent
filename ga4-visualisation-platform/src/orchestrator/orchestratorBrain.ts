/**
 * Orchestrator Brain (first-class, DeepSeek Pro).
 *
 * The Orchestrator coordinates — it does NOT absorb any brain's responsibilities.
 * It owns: brain sequencing, per-stage routing, retry/escalation management,
 * validation checkpoints, cross-brain handoff, and state. The A1→A6 sequence is
 * fixed (by architecture); the Orchestrator reasons about coordination and
 * escalation using DeepSeek Pro, and runs each stage through its routed provider
 * with Flash→Pro escalation where the route allows it.
 *
 * Additive: this module calls brains via injected stage functions, so existing
 * brains (A1–A3) are not modified by it.
 */
import { getClient, type Provider } from "@/lib/nvidia";
import { routeFor, type BrainName } from "@/lib/modelRouting";
import { withEscalation } from "@/lib/escalate";

/** The fixed pipeline order the Orchestrator coordinates. */
export const PIPELINE: BrainName[] = ["brain1", "brain2", "brain3", "brain4", "brain5", "brain6"];

export interface StageState {
  brain: BrainName;
  provider: Provider;
  status: "running" | "ok" | "escalated" | "failed";
  usedFallback?: boolean;
  primaryError?: string;
  error?: string;
  ms?: number;
}

export interface OrchestratorState {
  startedAt: number | null;
  stages: StageState[];
}

/** Resolved routing handed to a stage function so brain logic stays untouched. */
export interface StageContext {
  brain: BrainName;
  provider: Provider;
  model: string;
}

export class OrchestratorBrain {
  readonly state: OrchestratorState = { startedAt: null, stages: [] };

  /** The DeepSeek Pro client the Orchestrator uses for coordination/escalation reasoning. */
  client() {
    const r = routeFor("orchestrator");
    return getClient("orchestrator", { provider: r.provider, model: r.model, timeoutMs: 60_000 });
  }

  /**
   * Run one brain stage with: its routed provider, Flash→Pro escalation (when the
   * route allows), a validation checkpoint, and state tracking. `fn` receives the
   * resolved {provider, model} so the brain's own code is never changed here.
   */
  async runStage<T>(
    brain: BrainName,
    fn: (ctx: StageContext) => Promise<T>,
    validate?: (v: T) => void,
  ): Promise<T> {
    const route = routeFor(brain);
    const st: StageState = { brain, provider: route.provider, status: "running" };
    this.state.stages.push(st);
    const t0 = Date.now();

    try {
      if (route.escalate && route.fallbackProvider) {
        const res = await withEscalation<T>(
          () => fn({ brain, provider: route.provider, model: route.model }),
          () =>
            fn({
              brain,
              provider: route.fallbackProvider!,
              model: route.fallbackModel ?? route.model,
            }),
          { validate },
        );
        st.usedFallback = res.usedFallback;
        st.primaryError = res.primaryError;
        st.provider = res.usedFallback ? route.fallbackProvider! : route.provider;
        st.status = res.usedFallback ? "escalated" : "ok";
        st.ms = Date.now() - t0;
        return res.value;
      }

      const v = await fn({ brain, provider: route.provider, model: route.model });
      if (validate) validate(v);
      st.status = "ok";
      st.ms = Date.now() - t0;
      return v;
    } catch (err) {
      st.status = "failed";
      st.error = (err as Error)?.message ?? String(err);
      st.ms = Date.now() - t0;
      throw err;
    }
  }

  /**
   * Confirm the Orchestrator can reason via DeepSeek Pro (used by the validation
   * endpoint). A minimal structured-JSON coordination call.
   */
  async ping(): Promise<{ ok: boolean; model: string; content: string }> {
    const route = routeFor("orchestrator");
    // Short timeout + small token budget so the validation endpoint stays well
    // under the Hobby 10s function limit.
    const { client, model } = getClient("orchestrator", {
      provider: route.provider,
      model: route.model,
      timeoutMs: 8_000,
    });
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a pipeline coordinator. Output only compact JSON." },
        { role: "user", content: 'Return exactly {"coordinator":"ready"}' },
      ],
      max_tokens: 256,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const content = r.choices?.[0]?.message?.content ?? "";
    return { ok: content.includes("ready"), model, content: content.slice(0, 200) };
  }
}
