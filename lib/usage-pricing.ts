/**
 * Every price the app needs to turn usage into dollars, in one file.
 *
 * Deliberately constants, not a settings table. The admin usage page used to
 * ask for "dollars per credit" and "credits purchased" by hand, and the honest
 * outcome was that nobody filled them in and every figure read "not set".
 * Prices change once or twice a year; a code change is the right cost for
 * that, and it means the dashboard never shows an unpriced number again.
 * `api_pricing` still exists as an override: a row with a real value wins,
 * an empty table falls back to these.
 */

/** scrapecreators: $20 plan, 10,000 credits. $0.002 a credit, in micro-dollars. */
export const DEFAULT_MICROS_PER_CREDIT = 2000;

/** The runaway rail: most credits one person can burn in a day. */
export const DEFAULT_DAILY_CREDIT_CAP = 50;

/**
 * claude-opus-5, per million tokens, in micro-dollars so the math stays in
 * integers: input $5, output $25, cache read $0.50, cache write $6.25.
 */
export const MODEL_PRICES: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  "claude-opus-5": {
    input: 5_000_000,
    output: 25_000_000,
    cacheRead: 500_000,
    cacheWrite: 6_250_000,
  },
};

const FALLBACK_MODEL = "claude-opus-5";

export type FlowUsageTotals = {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Cost of a pile of flow tokens in micro-dollars. */
export function flowCostMicros(model: string, u: FlowUsageTotals): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES[FALLBACK_MODEL];
  return Math.round(
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_tokens * p.cacheRead +
      u.cache_write_tokens * p.cacheWrite) /
      1_000_000
  );
}

/** Micro-dollars to a display string. Two decimals above a cent, four under. */
export function microsToUsd(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
