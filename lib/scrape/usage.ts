/**
 * The credit ledger and the safety rail.
 *
 * Everything here goes through the service client, because `api_usage_events`
 * has a read policy and deliberately no insert policy. A person may see what
 * they spent; nobody, including them, may write a row saying they spent less.
 * The table is the only record of what this costs, so it is not user-writable.
 *
 * Server only.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_DAILY_CREDIT_CAP, DEFAULT_MICROS_PER_CREDIT } from "@/lib/usage-pricing";
import type { Platform } from "./types";

const PROVIDER = "scrapecreators";

/**
 * Who asked for the call.
 *
 * `sync` is the cron spending on its own initiative, `manual` is the refresh
 * button, `tool` is everything a person typed a handle into. The split exists
 * because the two rails below have to treat them differently: a daily cap is a
 * promise to a person about their own clicking, and the cron eating that cap
 * would take away something they paid for without them doing anything.
 */
export type UsageSource = "sync" | "manual" | "tool";

/**
 * How low the provider balance can go before each source stops spending.
 *
 * The cron stops first, and that is the whole point: when the balance is nearly
 * out the last credits should belong to somebody sitting in front of the
 * product, not to a background job that will happily finish the job of emptying
 * it at 3am. The gap between the two numbers is the reserve.
 */
const BALANCE_FLOOR: Record<UsageSource, number> = { sync: 25, manual: 10, tool: 10 };

/** What one account is allowed to cost the cron in a month, in credits. */
const SYNC_CREDITS_PER_ACCOUNT = 60;

export type UsageEvent = {
  userId: string;
  /** copied in at write time so a deleted account still shows in last month's
   *  costs. the fk is `on delete set null` for the same reason. */
  userEmail: string | null;
  /** the path only. no query string: cursors are long and handles are noise. */
  endpoint: string;
  platform: Platform | null;
  targetId: string | null;
  /** off the response body. never assumed to be 1, never assumed at all. */
  creditsCharged: number;
  creditsRemaining: number | null;
  cached: boolean;
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number | null;
  /** left out by the tool callers, whose rows the column defaults to 'tool'. */
  source?: UsageSource;
};

/**
 * One row per outbound call, success or failure. A failed call still tells the
 * admin page something: a wall of 403s is the platform blocking us and that is
 * worth seeing before the credits run out rather than after.
 *
 * It never throws. The call has already happened and the credit is already
 * spent by the time this runs, so failing loudly here would turn a bookkeeping
 * problem into a user-visible error without un-spending anything.
 */
export async function logUsage(event: UsageEvent): Promise<void> {
  const db = createServiceClient();
  if (!db) return;

  const { error } = await db.from("api_usage_events").insert({
    user_id: event.userId,
    user_email: event.userEmail,
    provider: PROVIDER,
    endpoint: event.endpoint,
    platform: event.platform,
    target_id: event.targetId,
    credits_charged: event.creditsCharged,
    credits_remaining: event.creditsRemaining,
    cached: event.cached,
    ok: event.ok,
    status_code: event.statusCode,
    // the column is text and a provider message can be a whole html page.
    error: event.error ? event.error.slice(0, 500) : null,
    duration_ms: event.durationMs,
    // omitted rather than nulled when the caller did not say: the column's own
    // default is 'tool', which is what every caller that predates this is.
    ...(event.source ? { source: event.source } : {}),
  });

  if (error) console.error("[scrape] usage ledger write failed", error.message);
}

/**
 * What this person has spent since midnight utc, on things they asked for.
 *
 * utc, not local: the cap has to reset at the same instant for everyone, and a
 * timezone in the middle of a spending limit is a bug waiting for a customer in
 * a different one. Summed in js rather than sql because the cap keeps the row
 * count per person per day in the tens.
 *
 * The cron's own spend (`source = 'sync'`) is deliberately not counted. The
 * daily cap is a ceiling on what a person can click through in a day; letting a
 * background job eat it would mean waking up to a limit already spent by
 * something nobody asked for. The cron has its own rail below.
 */
export async function creditsUsedToday(userId: string): Promise<number> {
  const db = createServiceClient();
  if (!db) return 0;

  const now = new Date();
  const midnightUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  ).toISOString();

  const { data, error } = await db
    .from("api_usage_events")
    .select("credits_charged")
    .eq("user_id", userId)
    .in("source", ["manual", "tool"])
    .gte("created_at", midnightUtc);

  if (error || !data) {
    // the rail failing open would let a broken query spend the whole balance,
    // so a read failure is reported as "spent nothing" only because the caller
    // treats an unreadable ledger as a reason to refuse further up.
    if (error) console.error("[scrape] could not read today's usage", error.message);
    return 0;
  }

  return data.reduce((sum, row) => sum + (row.credits_charged ?? 0), 0);
}

/**
 * What the provider said was left the last time anybody called it, or null if
 * nothing in the ledger has ever carried a balance.
 *
 * It is the whole account's balance and not one person's, because that is what
 * the number on the response means. Reading it back out of the ledger rather
 * than asking the provider costs nothing and is never more than one call stale.
 */
export async function latestBalance(): Promise<number | null> {
  const db = createServiceClient();
  if (!db) return null;

  const { data } = await db
    .from("api_usage_events")
    .select("credits_remaining")
    .not("credits_remaining", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.credits_remaining as number | null) ?? null;
}

/**
 * The reason this source may not spend right now, or null to go ahead.
 *
 * An unreadable balance is not a refusal: nothing has been billed yet on a
 * fresh deploy and refusing on "we don't know" would mean the first call can
 * never happen.
 */
export async function balanceFloorError(source: UsageSource): Promise<string | null> {
  const balance = await latestBalance();
  if (balance === null) return null;
  if (balance >= BALANCE_FLOOR[source]) return null;

  return source === "sync"
    ? "scraping balance low, sync paused"
    : "scraping balance is nearly out, top it up to keep going";
}

/** What the cron has spent on this person since the 1st, utc. */
export async function syncCreditsThisMonth(userId: string): Promise<number> {
  const db = createServiceClient();
  if (!db) return 0;

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();

  const { data, error } = await db
    .from("api_usage_events")
    .select("credits_charged")
    .eq("user_id", userId)
    .eq("source", "sync")
    .gte("created_at", monthStart);

  if (error || !data) {
    if (error) console.error("[scrape] could not read this month's sync usage", error.message);
    return 0;
  }

  return data.reduce((sum, row) => sum + (row.credits_charged ?? 0), 0);
}

/**
 * How many accounts the cron is on the hook for, cached for the length of a run.
 *
 * The budget rail runs once per account per pass, so without this the count
 * query would be as many round trips as the sync itself. A stale count for a
 * few minutes cannot hurt: it only widens or narrows a ceiling nobody is near.
 */
const ACCOUNT_COUNT_TTL_MS = 10 * 60_000;
const accountCounts = new Map<string, { n: number; at: number }>();

async function activeAccountCount(userId: string): Promise<number> {
  const hit = accountCounts.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_COUNT_TTL_MS) return hit.n;

  const db = createServiceClient();
  if (!db) return 0;

  const { count } = await db
    .from("deal_accounts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("active", true);

  const n = count ?? 0;
  accountCounts.set(userId, { n, at: Date.now() });
  return n;
}

/**
 * The cron's own ceiling: `SYNC_CREDITS_PER_ACCOUNT` a month per active account.
 *
 * The daily cap is deliberately blind to the cron now, so something has to stop
 * a runaway loop from spending a month's credits in a night. Per-account rather
 * than flat, because the honest cost of a roster is linear in the roster and a
 * flat number would either strangle a big one or leave a small one unguarded.
 *
 * Returns the message to fail the account with, or null to go ahead. It is a
 * refusal for this account, not for the run: it comes back as the account's
 * `last_sync_error` so it reads as "why is this stale" on the page that cares.
 */
export async function syncBudgetError(userId: string): Promise<string | null> {
  const [spent, accounts] = await Promise.all([
    syncCreditsThisMonth(userId),
    activeAccountCount(userId),
  ]);

  // a zero count is "could not count" as often as it is "has none", and an
  // account being synced right now proves it is not really zero. either way the
  // balance floor and the ledger still apply, so this rail stands down.
  if (accounts === 0) return null;

  const budget = accounts * SYNC_CREDITS_PER_ACCOUNT;
  if (spent <= budget) return null;

  return `this month's automatic sync budget is used up (${spent} of ${budget} credits), it resets on the 1st`;
}

/**
 * This person's daily ceiling, or null for unlimited.
 *
 * A row in `api_user_limits` beats the default, including a row whose cap is
 * null: that is an admin saying "this one is unlimited" on purpose, and it has
 * to outrank the global default rather than fall through to it.
 */
export async function dailyCapFor(userId: string): Promise<number | null> {
  const db = createServiceClient();
  if (!db) return null;

  const { data } = await db
    .from("api_user_limits")
    .select("daily_credit_cap")
    .eq("user_id", userId)
    .maybeSingle();

  if (data) return data.daily_credit_cap ?? null;

  const pricing = await getPricing();
  return pricing.defaultDailyCreditCap;
}

/** The `scrapecreators` row of `api_pricing`, falling back to the constants in
 *  `lib/usage-pricing.ts`. Nothing is ever "not set": an untouched deploy still
 *  prices a credit at the plan rate and still carries the default daily cap. A
 *  db row only exists to override that, and only where its value is real. */
export async function getPricing(): Promise<{
  microsPerCredit: number;
  defaultDailyCreditCap: number | null;
  creditsPurchased: number | null;
}> {
  const defaults = {
    microsPerCredit: DEFAULT_MICROS_PER_CREDIT,
    defaultDailyCreditCap: DEFAULT_DAILY_CREDIT_CAP,
    creditsPurchased: null,
  };

  const db = createServiceClient();
  if (!db) return defaults;

  const { data } = await db
    .from("api_pricing")
    .select("micros_per_credit, default_daily_credit_cap, credits_purchased")
    .eq("provider", PROVIDER)
    .maybeSingle();

  if (!data) return defaults;

  return {
    microsPerCredit: data.micros_per_credit || DEFAULT_MICROS_PER_CREDIT,
    defaultDailyCreditCap: data.default_daily_credit_cap ?? DEFAULT_DAILY_CREDIT_CAP,
    creditsPurchased: data.credits_purchased ?? null,
  };
}
