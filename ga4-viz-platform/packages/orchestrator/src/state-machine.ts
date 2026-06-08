/**
 * State machine driver — the orchestrator's main loop.
 *
 * Implements the FSM declared in orchestration/state-machine.example.json.
 * Drives a turn from IDLE through A1 → A2 → A3 → A4 → A5 → A6 → COMPLETE,
 * branching at A3 (APPROVED / DEFAULT_APPLIED / NEEDS_CLARIFICATION) and
 * handling staged execution via stagedExecutor at A4.
 *
 * Schema validation runs at every handoff. Permission boundaries enforced via
 * bindToolsetFor. Failures are typed via OrchestratorError.
 */
import { randomUUID } from "node:crypto";
import { bindToolsetFor } from "./permission-binder.js";
import { gateAgentOutput } from "./agent-gates.js";
import { stagedExecutor, type StageSpec } from "./stage-executor.js";
import { halt, resume, type UserAnswers } from "./halt-resume.js";
import { OrchestratorError } from "./errors.js";
import type {
  AgentRegistry,
  TurnResult,
  PriorTurnContext,
  OrchestratorContext,
} from "./types.js";
import type { SessionStore } from "./session-store.js";
import type { TriggerContext } from "./trigger-eval.js";

export interface OrchestratorConfig {
  agents: AgentRegistry;
  sessionStore: SessionStore;
  /** Optional helper provider for the trigger DSL — required for staged investigations. */
  triggerHelpers?: TriggerContext["helpers"];
}

export interface RunTurnArgs {
  user_query: string;
  session_id: string;
  prior_turn_context?: PriorTurnContext;
}

export interface ResumeTurnArgs {
  turn_id: string;
  session_id: string;
  answers: UserAnswers;
}

export class Orchestrator {
  constructor(private readonly config: OrchestratorConfig) {}

  /** Start a new turn. */
  async runTurn(args: RunTurnArgs): Promise<TurnResult> {
    const ctx: OrchestratorContext = {
      turn_id: `turn_${new Date().toISOString()}_${randomUUID().slice(0, 8)}`,
      session_id: args.session_id,
    };
    try {
      // ===== A1 =====
      const a1Out = await this.invokeAgent("A1", { user_query: args.user_query, prior_turn_context: args.prior_turn_context }, ctx);
      await gateAgentOutput("A1", a1Out);

      // ===== A2 =====
      const a2Out = await this.invokeAgent("A2", { intent: a1Out }, ctx);
      await gateAgentOutput("A2", a2Out);

      // ===== A3 =====
      return await this.runFromA3(a1Out, a2Out, ctx, args.prior_turn_context);
    } catch (e) {
      return this.toFailedResult(e, ctx.turn_id);
    }
  }

  /** Resume a halted turn after user has answered clarification. */
  async resumeTurn(args: ResumeTurnArgs): Promise<TurnResult> {
    const ctx: OrchestratorContext = {
      turn_id: args.turn_id,
      session_id: args.session_id,
    };
    try {
      const { state, resolvedAnswers, appliedDefaults } = await resume(
        this.config.sessionStore,
        args.turn_id,
        args.answers,
      );

      // Re-construct the resumed plan: take a2_plan, mark fields resolved,
      // attach carried_forward from resolvedAnswers + applied_defaults from preapplied.
      // The actual structural merging is A3's responsibility; here we just hand it the inputs.
      const resumedInput = {
        intent: state.a1_intent,
        query_plan: state.a2_plan,
        prior_turn_context: undefined as PriorTurnContext | undefined,
        _resume_envelope: {
          applied_defaults: appliedDefaults,
          carried_forward: resolvedAnswers,
        },
      };

      // Re-enter at A3 (NOT A1 or A2)
      const a3Out = await this.invokeAgent("A3", resumedInput, ctx);
      await gateAgentOutput("A3", a3Out);

      return await this.continuePastA3(state.a1_intent, a3Out, ctx);
    } catch (e) {
      return this.toFailedResult(e, ctx.turn_id);
    }
  }

  // -------- private helpers --------

  private async runFromA3(
    a1Out: unknown,
    a2Out: unknown,
    ctx: OrchestratorContext,
    priorTurnContext: PriorTurnContext | undefined,
  ): Promise<TurnResult> {
    const a3Out = await this.invokeAgent("A3", {
      intent: a1Out,
      query_plan: a2Out,
      prior_turn_context: priorTurnContext,
    }, ctx);
    await gateAgentOutput("A3", a3Out);

    // Branch on decision
    const decision = (a3Out as { decision: string }).decision;
    if (decision === "NEEDS_CLARIFICATION") {
      return await this.haltForUser(a1Out, a2Out, a3Out, ctx);
    }
    return await this.continuePastA3(a1Out, a3Out, ctx);
  }

  private async haltForUser(
    a1Out: unknown,
    a2Out: unknown,
    a3Out: unknown,
    ctx: OrchestratorContext,
  ): Promise<TurnResult> {
    const decision = a3Out as {
      decision: "NEEDS_CLARIFICATION";
      clarification: { question: string; decision_points: unknown[]; rationale: string };
      halted_state: {
        preapplied_defaults_pending: Array<{
          field: string;
          chosen: unknown;
          source: string;
          rationale?: string;
        }>;
      };
    };

    await halt(this.config.sessionStore, {
      turnId: ctx.turn_id,
      sessionId: ctx.session_id,
      a1Intent: a1Out,
      a2Plan: a2Out,
      preapplied: decision.halted_state.preapplied_defaults_pending,
      clarification: decision.clarification,
    });

    return {
      kind: "needs_clarification",
      turn_id: ctx.turn_id,
      clarification: decision.clarification,
    };
  }

  private async continuePastA3(
    a1Out: unknown,
    a3Out: unknown,
    ctx: OrchestratorContext,
  ): Promise<TurnResult> {
    const decision = a3Out as { decision: "APPROVED" | "DEFAULT_APPLIED"; query_plan: unknown };
    const plan = decision.query_plan;

    // ===== A4 =====
    const isStaged = Array.isArray((a1Out as { stages?: unknown }).stages) ||
                     Array.isArray((plan as { stages?: unknown }).stages);
    let a4Out: unknown;
    if (isStaged) {
      a4Out = await this.runStaged(plan, ctx);
    } else {
      a4Out = await this.invokeAgent("A4", { decision: a3Out }, ctx);
    }
    await gateAgentOutput("A4", a4Out);

    // ===== A5 =====
    const a5Out = await this.invokeAgent("A5", { data_record: a4Out }, ctx);
    await gateAgentOutput("A5", a5Out);

    // ===== A6 =====
    const a6Out = await this.invokeAgent("A6", { data_blocks: a5Out }, ctx);
    await gateAgentOutput("A6", a6Out);

    return { kind: "complete", turn_id: ctx.turn_id, viz_spec: a6Out };
  }

  private async runStaged(plan: unknown, ctx: OrchestratorContext): Promise<unknown> {
    const stages = ((plan as { stages?: StageSpec[] }).stages ?? []) as StageSpec[];
    if (!this.config.triggerHelpers) {
      throw new OrchestratorError(
        "internal_error",
        "Staged plan requires triggerHelpers in OrchestratorConfig",
      );
    }
    const helpers = this.config.triggerHelpers;

    const { accumulated, records } = await stagedExecutor.run(
      stages,
      async (stage) => {
        const out = await this.invokeAgent("A4", {
          decision: { query_plan: plan } as unknown,
          stage: {
            stage_id: stage.id,
            query_ids: stage.query_refs,
            accumulated_results: {},
          },
        }, ctx);
        return out;
      },
      (acc) => ({
        stage_results: acc,
        helpers,
      }),
    );

    // Assemble the data record. A4 normally produces this; for staged plans we
    // merge per-stage outputs. The orchestrator does NOT compute additional
    // fields — it just unions the per-stage rows_by_sub_question maps and
    // records the stages_executed metadata.
    const merged: Record<string, unknown> = {};
    for (const v of Object.values(accumulated)) {
      const dr = v as { rows_by_sub_question?: Record<string, unknown[]>; execution_metadata?: { per_query?: unknown[] } };
      if (dr.rows_by_sub_question) {
        for (const [sq, rows] of Object.entries(dr.rows_by_sub_question)) {
          const existing = (merged[sq] as unknown[] | undefined) ?? [];
          merged[sq] = [...existing, ...(rows as unknown[])];
        }
      }
    }

    return {
      schema_version: "0.1.0",
      status: "ok",
      rows_by_sub_question: merged,
      execution_metadata: {
        queries_executed: stages.length,
        total_latency_ms: 0,
        per_query: [],
        stages_executed: records,
      },
      warnings: [],
      failures: [],
      passthrough_pipeline: {
        intent: {},
        applied_defaults: [],
        carried_forward: [],
        a3_disclosures: [],
      },
    };
  }

  private async invokeAgent(
    agentId: "A1" | "A2" | "A3" | "A4" | "A5" | "A6",
    input: unknown,
    ctx: OrchestratorContext,
  ): Promise<unknown> {
    const toolset = bindToolsetFor(agentId);
    const agentCtx = { toolset, meta: ctx };
    const fn = (this.config.agents as unknown as Record<string, (i: unknown, c: typeof agentCtx) => Promise<unknown>>)[
      agentId.toLowerCase()
    ];
    if (!fn) {
      throw new OrchestratorError(
        "internal_error",
        `No agent registered for ${agentId}`,
        agentId,
      );
    }
    return await fn(input, agentCtx);
  }

  private toFailedResult(e: unknown, turn_id: string): TurnResult {
    if (e instanceof OrchestratorError) {
      return {
        kind: "failed",
        turn_id,
        reason_code: e.reasonCode,
        detail: e.detail,
      };
    }
    const detail = e instanceof Error ? e.message : String(e);
    return {
      kind: "failed",
      turn_id,
      reason_code: "internal_error",
      detail,
    };
  }
}
