import { latestBalance } from "@/lib/scrape/usage";
import { requireFounderView } from "@/lib/supabase/founder";

const WINDOW_DAYS = 30;

export type CreditHealth = {
  /** what the provider said was left, on the newest call we made. */
  balance: number | null;
  /** credits charged over the last 30 days. */
  burned: number;
  /** credits a day, averaged over that window. */
  perDay: number;
  /** days of runway at that rate, or null when nothing is burning. */
  daysLeft: number | null;
};

/**
 * The one thing the deleted usage page knew that nothing else did.
 *
 * A ledger of every metered call is a report; "how many credits are left and
 * how long do they last" is the question somebody actually opens a founder page
 * to answer, and the cron already emails about it when it crosses under 100. So
 * it comes with, as three numbers rather than a table.
 *
 * `credits_remaining` is what the provider reported on a call, not something we
 * add up ourselves, so the newest row that has one IS the balance. Burn is the
 * charges over a fixed 30 days rather than since the beginning: a month that
 * spent nothing must not be averaged away by a launch week two years ago.
 */
export async function loadCreditHealth(): Promise<CreditHealth> {
  const { supabase } = await requireFounderView("/founder");

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const [balance, spent] = await Promise.all([
    latestBalance(),
    supabase
      .from("api_usage_events")
      .select("credits_charged")
      .gte("created_at", since),
  ]);

  const burned = (spent.data ?? []).reduce(
    (n, r) => n + ((r.credits_charged as number) ?? 0),
    0
  );
  const perDay = burned / WINDOW_DAYS;

  return {
    balance,
    burned,
    perDay,
    // no burn is not infinite runway, it is an unanswerable question, and a
    // screen saying "∞ days" about a paid balance reads as a bug.
    daysLeft: balance !== null && perDay > 0 ? Math.floor(balance / perDay) : null,
  };
}
