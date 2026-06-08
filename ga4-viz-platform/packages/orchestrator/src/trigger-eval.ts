/**
 * Trigger DSL evaluator.
 *
 * Per pipeline/trigger-expressions.example.json, A2 declares conditional-stage
 * gates as strings like:
 *
 *   funnel_step_rate_drop("view_search_results") > 0.5
 *   AND top_n_dim_diff("landingPage", n=20) >= 5
 *
 * This module:
 *   1. Parses the string into a small AST.
 *   2. Evaluates the AST against accumulated stage results.
 *   3. Returns boolean.
 *
 * The 9 operators come from pipeline/trigger-expressions.example.json. Adding
 * an operator means: implement it here AND add it to the JSON catalog. The
 * verifyOperatorRegistryMatches() audit confirms parity.
 */

// ============================================================
//  Operator registry — must mirror trigger-expressions.example.json
// ============================================================

export type OperatorFn = (
  args: ReadonlyArray<string | number>,
  ctx: TriggerContext,
) => number | boolean;

/** Stage results A4 has accumulated so far. Shape is flexible. */
export interface TriggerContext {
  /** Per-stage results keyed by stage_id. */
  stage_results: Record<string, unknown>;
  /** Helper accessors — opaque to the operator, computed by the orchestrator. */
  helpers: {
    /** Get the conversion rate FROM the funnel step BEFORE event_name TO event_name itself, in a named period. */
    funnel_step_rate?: (event: string, period: "current" | "baseline") => number;
    /** Top-N landing-page diff count (symmetric appeared/disappeared between baseline and current). */
    top_n_dim_diff?: (dimension: string, n: number) => number;
    /** PoP change of a metric component as fraction (-1 to +inf). */
    component_change_pct?: (metric: string) => number;
    /** PoP change of a metric in percentage points (for rate metrics). */
    metric_period_change_pp?: (metric: string) => number;
    metric_period_change_pct?: (metric: string) => number;
    z_score_max_abs?: (series: string) => number;
    row_count_for_query?: (queryId: string) => number;
    any_landing_page_share_above?: (threshold: number) => boolean;
    /**
     * Max absolute change in any single cohort's share-of-whole between baseline
     * and current. When dim === "any_dim", scans every breakdown dimension and
     * returns the maximum. Added by L2 RCA addendum; used by the universal
     * cohort_drilldown stage trigger.
     */
    any_dimension_concentration_change?: (dim: string) => number;
  };
}

const OPERATORS: Record<string, OperatorFn> = {
  funnel_step_rate: (args, ctx) => {
    const [event, period] = args as [string, "current" | "baseline"];
    if (!ctx.helpers.funnel_step_rate) throw new Error("helper funnel_step_rate not provided");
    return ctx.helpers.funnel_step_rate(event, period);
  },
  funnel_step_rate_drop: (args, ctx) => {
    const [event] = args as [string];
    if (!ctx.helpers.funnel_step_rate) throw new Error("helper funnel_step_rate not provided");
    const baseline = ctx.helpers.funnel_step_rate(event, "baseline");
    const current = ctx.helpers.funnel_step_rate(event, "current");
    if (baseline === 0) return current > 0 ? -Infinity : 0;
    return (baseline - current) / baseline;
  },
  top_n_dim_diff: (args, ctx) => {
    const [dim, n] = args as [string, number];
    if (!ctx.helpers.top_n_dim_diff) throw new Error("helper top_n_dim_diff not provided");
    return ctx.helpers.top_n_dim_diff(dim, n);
  },
  component_change_pct: (args, ctx) => {
    const [m] = args as [string];
    if (!ctx.helpers.component_change_pct) throw new Error("helper component_change_pct not provided");
    return ctx.helpers.component_change_pct(m);
  },
  metric_period_change_pct: (args, ctx) => {
    const [m] = args as [string];
    if (!ctx.helpers.metric_period_change_pct) throw new Error("helper metric_period_change_pct not provided");
    return ctx.helpers.metric_period_change_pct(m);
  },
  metric_period_change_pp: (args, ctx) => {
    const [m] = args as [string];
    if (!ctx.helpers.metric_period_change_pp) throw new Error("helper metric_period_change_pp not provided");
    return ctx.helpers.metric_period_change_pp(m);
  },
  z_score_max_abs: (args, ctx) => {
    const [s] = args as [string];
    if (!ctx.helpers.z_score_max_abs) throw new Error("helper z_score_max_abs not provided");
    return ctx.helpers.z_score_max_abs(s);
  },
  row_count_for_query: (args, ctx) => {
    const [q] = args as [string];
    if (!ctx.helpers.row_count_for_query) throw new Error("helper row_count_for_query not provided");
    return ctx.helpers.row_count_for_query(q);
  },
  any_landing_page_share_above: (args, ctx) => {
    const [t] = args as [number];
    if (!ctx.helpers.any_landing_page_share_above) throw new Error("helper any_landing_page_share_above not provided");
    return ctx.helpers.any_landing_page_share_above(t);
  },
  any_dimension_concentration_change: (args, ctx) => {
    const [dim] = args as [string];
    if (!ctx.helpers.any_dimension_concentration_change) {
      throw new Error("helper any_dimension_concentration_change not provided");
    }
    return ctx.helpers.any_dimension_concentration_change(dim);
  },
};

export const KNOWN_OPERATORS = Object.freeze(Object.keys(OPERATORS).sort());

// ============================================================
//  Tokeniser + Parser (recursive descent)
// ============================================================

type Token =
  | { kind: "ident"; value: string }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "op"; value: string }
  | { kind: "punct"; value: "(" | ")" | "," | "=" };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) { i++; continue; }
    // string literal
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < input.length && input[j] !== c) j++;
      tokens.push({ kind: "string", value: input.slice(i + 1, j) });
      i = j + 1; continue;
    }
    // number
    if (/[0-9]/.test(c) || (c === "-" && /[0-9.]/.test(input[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < input.length && /[0-9.]/.test(input[j] ?? "")) j++;
      tokens.push({ kind: "number", value: Number(input.slice(i, j)) });
      i = j; continue;
    }
    // operators
    if (c === ">" || c === "<" || c === "=" || c === "!") {
      const two = input.slice(i, i + 2);
      if (["==", "!=", ">=", "<="].includes(two)) {
        tokens.push({ kind: "op", value: two });
        i += 2; continue;
      }
      if (c === ">" || c === "<") {
        tokens.push({ kind: "op", value: c });
        i++; continue;
      }
      if (c === "=") {
        tokens.push({ kind: "punct", value: "=" });
        i++; continue;
      }
    }
    if (c === "(" || c === ")" || c === ",") {
      tokens.push({ kind: "punct", value: c });
      i++; continue;
    }
    // ident
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j] ?? "")) j++;
      tokens.push({ kind: "ident", value: input.slice(i, j) });
      i = j; continue;
    }
    throw new Error(`tokenize: unexpected char '${c}' at index ${i}`);
  }
  return tokens;
}

// AST
type Expr =
  | { type: "and"; left: Expr; right: Expr }
  | { type: "or"; left: Expr; right: Expr }
  | { type: "not"; arg: Expr }
  | { type: "compare"; op: ">" | "<" | ">=" | "<=" | "==" | "!="; left: Expr; right: Expr }
  | { type: "call"; name: string; args: Array<string | number> }
  | { type: "literal"; value: number | string | boolean };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const e = this.expr();
    if (this.pos !== this.tokens.length) {
      throw new Error(`parse: unexpected trailing tokens at index ${this.pos}`);
    }
    return e;
  }

  /** expr := or */
  private expr(): Expr { return this.or(); }

  /** or := and ("OR" and)* */
  private or(): Expr {
    let left = this.and();
    while (this.peek("ident", "OR")) {
      this.pos++;
      const right = this.and();
      left = { type: "or", left, right };
    }
    return left;
  }

  /** and := not ("AND" not)* */
  private and(): Expr {
    let left = this.not();
    while (this.peek("ident", "AND")) {
      this.pos++;
      const right = this.not();
      left = { type: "and", left, right };
    }
    return left;
  }

  /** not := "NOT" not | compare */
  private not(): Expr {
    if (this.peek("ident", "NOT")) {
      this.pos++;
      return { type: "not", arg: this.not() };
    }
    return this.compare();
  }

  /** compare := primary (cmpop primary)? */
  private compare(): Expr {
    const left = this.primary();
    if (this.tokens[this.pos]?.kind === "op") {
      const op = (this.tokens[this.pos] as { value: string }).value as
        ">" | "<" | ">=" | "<=" | "==" | "!=";
      this.pos++;
      const right = this.primary();
      return { type: "compare", op, left, right };
    }
    return left;
  }

  /** primary := "(" expr ")" | call | literal */
  private primary(): Expr {
    if (this.peek("punct", "(")) {
      this.pos++;
      const e = this.expr();
      this.expectPunct(")");
      return e;
    }
    const t = this.tokens[this.pos];
    if (!t) throw new Error("parse: unexpected end of input");
    if (t.kind === "ident") {
      // Either a bare identifier (treated as call(no args)) or a call expression
      const next = this.tokens[this.pos + 1];
      if (next?.kind === "punct" && next.value === "(") {
        return this.call();
      }
      // Bare ident: treat as a literal value (e.g. true/false)
      if (t.value === "true" || t.value === "false") {
        this.pos++;
        return { type: "literal", value: t.value === "true" };
      }
      throw new Error(`parse: bare identifier '${t.value}' not allowed`);
    }
    if (t.kind === "number") {
      this.pos++;
      return { type: "literal", value: t.value };
    }
    if (t.kind === "string") {
      this.pos++;
      return { type: "literal", value: t.value };
    }
    throw new Error(`parse: unexpected token at ${this.pos}: ${JSON.stringify(t)}`);
  }

  /**
   * call := ident "(" (arg ("," arg)*)? ")"
   *   arg := literal | ident "=" literal | ident  (bare identifier passed as string,
   *           used by L2 RCA operators that accept symbolic tokens like "any_dim")
   */
  private call(): Expr {
    const ident = this.tokens[this.pos++] as { kind: "ident"; value: string };
    this.expectPunct("(");
    const args: Array<string | number> = [];
    if (!this.peek("punct", ")")) {
      do {
        const t = this.tokens[this.pos];
        if (!t) throw new Error("parse: unexpected end inside call args");
        // Named arg: ident "=" value
        if (t.kind === "ident" && this.tokens[this.pos + 1]?.kind === "punct" &&
            (this.tokens[this.pos + 1] as { value: string }).value === "=") {
          this.pos += 2; // skip ident, =
          const val = this.tokens[this.pos++];
          if (!val) throw new Error("parse: missing value after =");
          if (val.kind === "string" || val.kind === "number") {
            args.push(val.value);
          } else {
            throw new Error(`parse: invalid arg value: ${JSON.stringify(val)}`);
          }
        } else if (t.kind === "string" || t.kind === "number") {
          args.push(t.value);
          this.pos++;
        } else if (t.kind === "ident") {
          // Bare identifier passed as a symbolic string token. Lets the L2 RCA
          // operator `any_dimension_concentration_change(any_dim)` accept the
          // sentinel `any_dim` without forcing the ontology author to quote it.
          args.push(t.value);
          this.pos++;
        } else {
          throw new Error(`parse: unexpected arg token: ${JSON.stringify(t)}`);
        }
      } while (this.matchPunct(","));
    }
    this.expectPunct(")");
    return { type: "call", name: ident.value, args };
  }

  private peek(kind: Token["kind"], value: string): boolean {
    const t = this.tokens[this.pos];
    return t?.kind === kind && (t as { value: string }).value === value;
  }
  private matchPunct(p: string): boolean {
    if (this.peek("punct", p)) { this.pos++; return true; }
    return false;
  }
  private expectPunct(p: string): void {
    if (!this.matchPunct(p)) {
      throw new Error(`parse: expected '${p}' at ${this.pos}`);
    }
  }
}

// ============================================================
//  Evaluator
// ============================================================

function evalExpr(expr: Expr, ctx: TriggerContext): number | boolean | string {
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "call": {
      const op = OPERATORS[expr.name];
      if (!op) throw new Error(`unknown operator: ${expr.name}`);
      return op(expr.args, ctx);
    }
    case "compare": {
      const l = evalExpr(expr.left, ctx);
      const r = evalExpr(expr.right, ctx);
      if (typeof l !== "number" || typeof r !== "number") {
        // Allow string equality
        if (expr.op === "==") return l === r;
        if (expr.op === "!=") return l !== r;
        throw new Error(`compare: non-numeric operands for ${expr.op}`);
      }
      switch (expr.op) {
        case ">":  return l >  r;
        case "<":  return l <  r;
        case ">=": return l >= r;
        case "<=": return l <= r;
        case "==": return l === r;
        case "!=": return l !== r;
      }
      break;
    }
    case "and": return !!evalExpr(expr.left, ctx) && !!evalExpr(expr.right, ctx);
    case "or":  return !!evalExpr(expr.left, ctx) || !!evalExpr(expr.right, ctx);
    case "not": return !evalExpr(expr.arg, ctx);
  }
  throw new Error(`evalExpr: unhandled type`);
}

/** Public entry point. Parse + evaluate a trigger expression. */
export function evaluateTrigger(expression: string, ctx: TriggerContext): boolean {
  const tokens = tokenize(expression);
  const expr = new Parser(tokens).parse();
  const result = evalExpr(expr, ctx);
  if (typeof result !== "boolean") {
    throw new Error(`trigger expression did not evaluate to boolean: got ${result} (${typeof result})`);
  }
  return result;
}

/** Trace evaluation — same as evaluateTrigger but also returns substituted operator values. */
export function evaluateTriggerWithTrace(
  expression: string,
  ctx: TriggerContext,
): { result: boolean; substituted: string } {
  const tokens = tokenize(expression);
  const expr = new Parser(tokens).parse();
  const substituted = substituteForTrace(expr, ctx);
  const result = evaluateTrigger(expression, ctx);
  return { result, substituted };
}

function substituteForTrace(expr: Expr, ctx: TriggerContext): string {
  switch (expr.type) {
    case "literal":
      return typeof expr.value === "string" ? JSON.stringify(expr.value) : String(expr.value);
    case "call":
      try {
        const v = evalExpr(expr, ctx);
        return `${expr.name}(…) = ${typeof v === "number" ? v.toFixed(3) : v}`;
      } catch {
        return `${expr.name}(…)`;
      }
    case "compare":
      return `${substituteForTrace(expr.left, ctx)} ${expr.op} ${substituteForTrace(expr.right, ctx)}`;
    case "and": return `(${substituteForTrace(expr.left, ctx)}) AND (${substituteForTrace(expr.right, ctx)})`;
    case "or":  return `(${substituteForTrace(expr.left, ctx)}) OR (${substituteForTrace(expr.right, ctx)})`;
    case "not": return `NOT (${substituteForTrace(expr.arg, ctx)})`;
  }
}
