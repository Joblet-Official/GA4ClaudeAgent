/**
 * Resolve Brain 1's `scope.dateRange` (relative string OR absolute pair OR
 * null) into concrete YYYY-MM-DD ranges for GA4. The LLM doesn't do date math
 * — we resolve here so Brain 2 only has to reason about field names.
 *
 * `today` is injectable so tests are deterministic; in production we use UTC.
 */
import type { DateRange } from "@/schemas/intent";

export interface ResolvedDateRange {
  startDate: string;
  endDate: string;
  name?: string;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function offsetDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function startOfWeek(d: Date): Date {
  // ISO week starts Monday.
  const out = new Date(d);
  const day = out.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1 - day);
  return offsetDays(out, diff);
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
}

function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
}

/**
 * Resolve a single DateRange to absolute dates. Falls back to last_30_days if
 * input is null — this keeps Brain 2's draft queries valid, but per the
 * timeline rule Brain 3 will pause and ASK the user rather than silently
 * shipping this default (the fallback only ever feeds best-guess drafts).
 */
export function resolveDateRange(
  dr: DateRange | null,
  today: Date = new Date(),
): ResolvedDateRange {
  if (dr == null) return resolveRelative("last_30_days", today);
  if (typeof dr === "string") return resolveRelative(dr, today);
  return { startDate: dr.start, endDate: dr.end };
}

function resolveRelative(name: string, today: Date): ResolvedDateRange {
  const end = new Date(today);
  switch (name) {
    case "last_7_days":
      return { startDate: fmt(offsetDays(end, -6)), endDate: fmt(end) };
    case "last_14_days":
      return { startDate: fmt(offsetDays(end, -13)), endDate: fmt(end) };
    case "last_28_days":
      return { startDate: fmt(offsetDays(end, -27)), endDate: fmt(end) };
    case "last_30_days":
      return { startDate: fmt(offsetDays(end, -29)), endDate: fmt(end) };
    case "last_90_days":
      return { startDate: fmt(offsetDays(end, -89)), endDate: fmt(end) };
    case "this_week":
      return { startDate: fmt(startOfWeek(end)), endDate: fmt(end) };
    case "last_week": {
      const tw = startOfWeek(end);
      const lwEnd = offsetDays(tw, -1);
      const lwStart = offsetDays(lwEnd, -6);
      return { startDate: fmt(lwStart), endDate: fmt(lwEnd) };
    }
    case "this_month":
      return { startDate: fmt(startOfMonth(end)), endDate: fmt(end) };
    case "last_month": {
      const ts = startOfMonth(end);
      const lmEnd = offsetDays(ts, -1);
      const lmStart = startOfMonth(lmEnd);
      return { startDate: fmt(lmStart), endDate: fmt(lmEnd) };
    }
    case "this_quarter":
      return { startDate: fmt(startOfQuarter(end)), endDate: fmt(end) };
    case "last_quarter": {
      const ts = startOfQuarter(end);
      const lqEnd = offsetDays(ts, -1);
      const lqStart = startOfQuarter(lqEnd);
      return { startDate: fmt(lqStart), endDate: fmt(endOfQuarter(lqEnd)) };
    }
    case "year_to_date":
      return {
        startDate: fmt(new Date(Date.UTC(end.getUTCFullYear(), 0, 1))),
        endDate: fmt(end),
      };
    default:
      // Unknown relative name → fall back to last_30_days
      return { startDate: fmt(offsetDays(end, -29)), endDate: fmt(end) };
  }
}

/**
 * For comparison report_type with no explicit two-window spec, this returns
 * (this_week, last_week) ranges. Brain 2 wires them into the same query as
 * two dateRanges entries.
 */
export function comparisonDefaults(today: Date = new Date()): [ResolvedDateRange, ResolvedDateRange] {
  return [
    { ...resolveRelative("this_week", today), name: "current" },
    { ...resolveRelative("last_week", today), name: "previous" },
  ];
}

/**
 * Equal-length period immediately preceding `range` — the baseline window for
 * comparison/diagnostic queries. If `range` is exactly a calendar month, the
 * baseline is the previous calendar month (matches analyst expectation: May vs
 * April, not May vs a 31-day offset window).
 */
export function previousPeriod(range: ResolvedDateRange): ResolvedDateRange {
  const start = new Date(range.startDate + "T00:00:00Z");
  const end = new Date(range.endDate + "T00:00:00Z");

  const isMonthStart = start.getUTCDate() === 1;
  const isMonthEnd = fmt(endOfMonth(start)) === range.endDate;
  if (isMonthStart && isMonthEnd) {
    const prevEnd = offsetDays(start, -1);
    return { startDate: fmt(startOfMonth(prevEnd)), endDate: fmt(prevEnd), name: "baseline" };
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = offsetDays(start, -1);
  const prevStart = offsetDays(prevEnd, -(days - 1));
  return { startDate: fmt(prevStart), endDate: fmt(prevEnd), name: "baseline" };
}
