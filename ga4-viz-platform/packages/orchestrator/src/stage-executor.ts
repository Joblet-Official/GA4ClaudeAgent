/**
 * Stage executor for staged investigation plans.
 *
 * When A2 emits a `stages` block (set on interpretation_request=true intents),
 * the orchestrator:
 *   1. Calls A4 once per stage in declared order.
 *   2. Accumulates each stage's results.
 *   3. For each subsequent stage marked execute='conditional', evaluates its
 *      execute_if expression against accumulated results via trigger-eval.
 *   4. Records a StageExecutionRecord per stage (executed or skipped + reason).
 *
 * The output is the assembled A4 data record with execution_metadata.stages_executed
 * populated per Phase 2 spec.
 */
import { evaluateTriggerWithTrace, type TriggerContext } from "./trigger-eval.js";

export interface StageSpec {
  id: string;
  execute: "always" | "conditional";
  execute_if?: string;
  query_refs: string[];
  rationale?: string;
}

export interface StageExecutionRecord {
  stage_id: string;
  status: "executed" | "skipped";
  execute_if?: string;
  condition_evaluated?: string;
  condition_result?: boolean;
  skip_reason?: string;
}

/**
 * Driver for staged execution. The caller (state machine) supplies:
 *   - The list of stages to iterate.
 *   - An `execute` callback that runs one stage and returns its A4 result fragment.
 *   - A `triggerCtx` provider that turns accumulated results into a TriggerContext.
 */
export interface StagedExecutor {
  run(
    stages: StageSpec[],
    execute: (stage: StageSpec) => Promise<unknown>,
    triggerCtxFor: (accumulated: Record<string, unknown>) => TriggerContext,
  ): Promise<{
    accumulated: Record<string, unknown>;
    records: StageExecutionRecord[];
  }>;
}

export const stagedExecutor: StagedExecutor = {
  async run(stages, execute, triggerCtxFor) {
    const accumulated: Record<string, unknown> = {};
    const records: StageExecutionRecord[] = [];

    for (const stage of stages) {
      if (stage.execute === "always") {
        const result = await execute(stage);
        accumulated[stage.id] = result;
        records.push({ stage_id: stage.id, status: "executed" });
        continue;
      }

      // conditional
      if (!stage.execute_if) {
        records.push({
          stage_id: stage.id,
          status: "skipped",
          skip_reason: "conditional stage missing execute_if expression",
        });
        continue;
      }

      const ctx = triggerCtxFor(accumulated);
      let condResult = false;
      let trace = "";
      try {
        const out = evaluateTriggerWithTrace(stage.execute_if, ctx);
        condResult = out.result;
        trace = out.substituted;
      } catch (e) {
        records.push({
          stage_id: stage.id,
          status: "skipped",
          execute_if: stage.execute_if,
          skip_reason: `trigger eval failed: ${(e as Error).message}`,
        });
        continue;
      }

      if (condResult) {
        const result = await execute(stage);
        accumulated[stage.id] = result;
        records.push({
          stage_id: stage.id,
          status: "executed",
          execute_if: stage.execute_if,
          condition_evaluated: trace,
          condition_result: true,
        });
      } else {
        records.push({
          stage_id: stage.id,
          status: "skipped",
          execute_if: stage.execute_if,
          condition_evaluated: trace,
          condition_result: false,
          skip_reason: "trigger condition evaluated false",
        });
      }
    }

    return { accumulated, records };
  },
};
