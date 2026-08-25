/**
 * Pay cycle arithmetic. Pure, browser safe, all UTC day keys (YYYY-MM-DD).
 *
 * A deal's pay_cycle says how often the brand pays, and `cycle_anchor_on` says
 * where the boundary sits: a "16th to 15th" deal stores the 16th, a biweekly
 * deal stores any day inside one of its periods. Null keeps the defaults, which
 * are the calendar month for monthly and started_on for weekly and biweekly,
 * so an untouched deal reads the way the dashboard always read it.
 *
 * Earnings never live here. A cycle is only a pair of day keys the reads
 * subtract earnings-as-of between.
 */

import type { Deal } from "@/lib/deals";

const DAY_MS = 86_400_000;

export const toDay = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (key: string): Date => new Date(`${key}T00:00:00Z`);

export function addDays(key: string, n: number): string {
  return toDay(new Date(parse(key).getTime() + n * DAY_MS));
}

/**
 * First day of the calendar month `offset` months from the one containing `now`.
 *
 * A calendar month is not a pay cycle and this file is otherwise about cycles,
 * but it is the same day-key arithmetic and the alternative is every caller
 * writing its own `Date.UTC(y, m + n, 1)`. That fork is exactly what let the
 * dashboard and the deal page disagree about a month in the first place.
 */
export function monthStart(now: Date, offset = 0): string {
  return toDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
}

/** Inclusive day-key bounds. `end` null means the cycle has no close (one_time, open ended). */
export type Cycle = { start: string | null; end: string | null };

type CycleDeal = Pick<Deal, "pay_cycle" | "cycle_anchor_on" | "started_on" | "ends_on" | "net_days">;

/** Day-of-month boundary for monthly cycles, clamped to 28 so every month has it. */
function anchorDay(deal: CycleDeal): number {
  if (!deal.cycle_anchor_on) return 1;
  return Math.min(parse(deal.cycle_anchor_on).getUTCDate(), 28);
}

function monthlyCycle(deal: CycleDeal, ref: string): Cycle {
  const day = anchorDay(deal);
  const d = parse(ref);
  const m = d.getUTCMonth() - (d.getUTCDate() < day ? 1 : 0);
  const start = new Date(Date.UTC(d.getUTCFullYear(), m, day));
  const next = new Date(Date.UTC(d.getUTCFullYear(), m + 1, day));
  return { start: toDay(start), end: addDays(toDay(next), -1) };
}

/** Fixed-length cycles counted out from the anchor, in both directions. */
function rollingCycle(anchor: string, lengthDays: number, ref: string): Cycle {
  const steps = Math.floor((parse(ref).getTime() - parse(anchor).getTime()) / DAY_MS / lengthDays);
  const start = addDays(anchor, steps * lengthDays);
  return { start, end: addDays(start, lengthDays - 1) };
}

/** The pay cycle containing `ref`. */
export function cycleFor(deal: CycleDeal, ref: string): Cycle {
  if (deal.pay_cycle === "one_time") {
    return { start: deal.started_on, end: deal.ends_on };
  }
  if (deal.pay_cycle === "monthly") return monthlyCycle(deal, ref);

  const length = deal.pay_cycle === "weekly" ? 7 : 14;
  // 2026-01-05 is a Monday, so an unanchored weekly deal runs Monday to Sunday.
  const anchor = deal.cycle_anchor_on ?? deal.started_on ?? "2026-01-05";
  return rollingCycle(anchor, length, ref);
}

/** The cycle before `cycle`, or null when there is no boundary to step over. */
export function previousCycle(deal: CycleDeal, cycle: Cycle): Cycle | null {
  if (!cycle.start || deal.pay_cycle === "one_time") return null;
  return cycleFor(deal, addDays(cycle.start, -1));
}

/** "Aug 16 to Sep 15", or what can be said when a bound is open. */
export function cycleLabel(cycle: Cycle, now = new Date()): string {
  const fmt = (key: string) => {
    const d = parse(key);
    const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone: "UTC",
    });
  };
  if (!cycle.start) return "whole deal";
  if (!cycle.end) return `since ${fmt(cycle.start)}`;
  return `${fmt(cycle.start)} to ${fmt(cycle.end)}`;
}

/** When the money for a cycle should land: cycle close plus the net terms. */
export function payBy(deal: CycleDeal, cycle: Cycle): string | null {
  if (!cycle.end) return null;
  return addDays(cycle.end, deal.net_days);
}
