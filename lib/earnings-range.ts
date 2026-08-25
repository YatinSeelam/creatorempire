/**
 * What period the dashboard is showing. Browser safe.
 *
 * Split out of `dash-server` for one reason: the picker is a client component,
 * and importing the range list from there dragged the whole server module —
 * and through it `next/headers` — into the client graph, which fails the build
 * rather than tree-shaking away. This file holds the parts both sides need and
 * touches nothing that only exists on a server.
 *
 * Same split the rest of the app already uses: `deals.ts` for what the browser
 * may see, `deals-server.ts` for the reads behind it.
 */

export type EarningsRange =
  | "today"
  | "7d"
  | "14d"
  | "30d"
  | "90d"
  | "month"
  | "last"
  | "3m"
  | "ytd"
  | "all"
  | "custom";

/**
 * The presets, in the order they sit in the picker. `custom` is deliberately
 * not here: it has no fixed span to name, it carries its own two dates, and the
 * picker renders it as its own chip with a date popover behind it.
 *
 * Rolling windows rather than calendar ones. "This month" answers a question
 * about the calendar; a creator looking at a deal is asking "how is it doing
 * right now", and on the 2nd of the month the calendar answer is always nearly
 * zero. The calendar keys stay valid in the type and in loadEarnings so an old
 * link still resolves, they just have no chip of their own.
 */
export const EARNINGS_RANGES: { key: Exclude<EarningsRange, "custom">; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "14d", label: "14d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
  { key: "all", label: "all" },
];

const ALL_RANGES: EarningsRange[] = [
  "today",
  "7d",
  "14d",
  "30d",
  "90d",
  "month",
  "last",
  "3m",
  "ytd",
  "all",
  "custom",
];

/**
 * Whatever arrived in `?range=`, as a range, falling back to this month.
 *
 * Checked against every range the loader understands rather than against the
 * chips, so a link someone saved while `3m` and `ytd` had buttons still opens
 * on the period it names instead of silently landing on this month.
 */
export function toRange(value: string | undefined): EarningsRange {
  return ALL_RANGES.find((r) => r === value) ?? "30d";
}

/** A day the picker may hand back, or null. Anything that is not `YYYY-MM-DD`
 *  is dropped rather than fed to postgres. */
export function asDay(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}
