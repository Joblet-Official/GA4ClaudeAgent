/**
 * Trigger DSL evaluator unit tests.
 *
 * Covers the parser + each operator + boolean combinators + edge cases.
 * Uses synthetic helpers that return canned numbers, so tests are deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateTrigger,
  evaluateTriggerWithTrace,
  KNOWN_OPERATORS,
  type TriggerContext,
} from "../src/trigger-eval.js";

function ctx(over: Partial<TriggerContext["helpers"]> = {}): TriggerContext {
  return {
    stage_results: {},
    helpers: {
      funnel_step_rate: () => 0,
      top_n_dim_diff: () => 0,
      component_change_pct: () => 0,
      metric_period_change_pct: () => 0,
      metric_period_change_pp: () => 0,
      z_score_max_abs: () => 0,
      row_count_for_query: () => 0,
      any_landing_page_share_above: () => false,
      any_dimension_concentration_change: () => 0,
      ...over,
    },
  };
}

describe("trigger-eval / KNOWN_OPERATORS", () => {
  it("has the 10 operators declared in trigger-expressions.example.json", () => {
    expect(KNOWN_OPERATORS).toEqual([
      "any_dimension_concentration_change",
      "any_landing_page_share_above",
      "component_change_pct",
      "funnel_step_rate",
      "funnel_step_rate_drop",
      "metric_period_change_pct",
      "metric_period_change_pp",
      "row_count_for_query",
      "top_n_dim_diff",
      "z_score_max_abs",
    ]);
  });
});

describe("trigger-eval / simple comparisons", () => {
  it("funnel_step_rate_drop > 0.5  with baseline=0.3, current=0.034 = TRUE", () => {
    const c = ctx({
      funnel_step_rate: (_event, period) =>
        period === "baseline" ? 0.306 : 0.034,
    });
    expect(evaluateTrigger('funnel_step_rate_drop("view_search_results") > 0.5', c)).toBe(true);
  });

  it("funnel_step_rate_drop > 0.5  with baseline=0.3, current=0.25 = FALSE", () => {
    const c = ctx({
      funnel_step_rate: (_e, p) => (p === "baseline" ? 0.3 : 0.25),
    });
    expect(evaluateTrigger('funnel_step_rate_drop("view_search_results") > 0.5', c)).toBe(false);
  });

  it("top_n_dim_diff >= 5 with helper returning 15 = TRUE", () => {
    const c = ctx({ top_n_dim_diff: () => 15 });
    expect(evaluateTrigger('top_n_dim_diff("landingPage", n=20) >= 5', c)).toBe(true);
  });

  it("top_n_dim_diff >= 5 with helper returning 3 = FALSE", () => {
    const c = ctx({ top_n_dim_diff: () => 3 });
    expect(evaluateTrigger('top_n_dim_diff("landingPage", n=20) >= 5', c)).toBe(false);
  });
});

describe("trigger-eval / boolean combinators", () => {
  it("AND both true = TRUE", () => {
    const c = ctx({
      funnel_step_rate: (_e, p) => (p === "baseline" ? 0.3 : 0.034),
      top_n_dim_diff: () => 15,
    });
    expect(
      evaluateTrigger(
        'funnel_step_rate_drop("view_search_results") > 0.5 AND top_n_dim_diff("landingPage", n=20) >= 5',
        c,
      ),
    ).toBe(true);
  });

  it("AND one false = FALSE", () => {
    const c = ctx({
      funnel_step_rate: (_e, p) => (p === "baseline" ? 0.3 : 0.034),
      top_n_dim_diff: () => 3,
    });
    expect(
      evaluateTrigger(
        'funnel_step_rate_drop("view_search_results") > 0.5 AND top_n_dim_diff("landingPage", n=20) >= 5',
        c,
      ),
    ).toBe(false);
  });

  it("OR one true = TRUE", () => {
    const c = ctx({
      funnel_step_rate: (_e, p) => (p === "baseline" ? 0.3 : 0.034),
      top_n_dim_diff: () => 3,
    });
    expect(
      evaluateTrigger(
        'funnel_step_rate_drop("view_search_results") > 0.5 OR top_n_dim_diff("landingPage", n=20) >= 5',
        c,
      ),
    ).toBe(true);
  });

  it("NOT inverts", () => {
    const c = ctx({ top_n_dim_diff: () => 0 });
    expect(evaluateTrigger('NOT top_n_dim_diff("X", n=10) >= 5', c)).toBe(true);
  });

  it("parens group", () => {
    const c = ctx({ component_change_pct: () => -0.5 });
    expect(evaluateTrigger("(component_change_pct(\"sessions\") < -0.3)", c)).toBe(true);
  });
});

describe("trigger-eval / divide by zero protection", () => {
  it("funnel_step_rate_drop with baseline=0, current=0 returns 0 (no drop)", () => {
    const c = ctx({ funnel_step_rate: () => 0 });
    expect(evaluateTrigger('funnel_step_rate_drop("x") > 0.5', c)).toBe(false);
  });
});

describe("trigger-eval / withTrace", () => {
  it("substitutes operator results into the trace string", () => {
    const c = ctx({
      funnel_step_rate: (_e, p) => (p === "baseline" ? 0.306 : 0.034),
    });
    const { result, substituted } = evaluateTriggerWithTrace(
      'funnel_step_rate_drop("view_search_results") > 0.5',
      c,
    );
    expect(result).toBe(true);
    expect(substituted).toContain("funnel_step_rate_drop");
    expect(substituted).toContain("0.5");
  });
});

describe("trigger-eval / errors", () => {
  it("rejects unknown operator", () => {
    expect(() => evaluateTrigger("frobnicate() > 1", ctx())).toThrow(/unknown operator/);
  });

  it("rejects expression that doesn't evaluate to boolean", () => {
    expect(() => evaluateTrigger('top_n_dim_diff("x", n=10)', ctx())).toThrow(/did not evaluate to boolean/);
  });

  it("rejects unbalanced parens", () => {
    expect(() => evaluateTrigger('(funnel_step_rate_drop("x") > 0.5', ctx())).toThrow();
  });
});
