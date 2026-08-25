import { NextResponse } from "next/server";
import {
  autoApproveDeliveredJobs,
  expireOverdueClaims,
  retierEditors,
  warnDueSoonClaims,
} from "@/lib/editing-auto";
import { notificationHtml, sendEmail } from "@/lib/email/send";
import { dueAccounts, syncAccount, type SyncResult } from "@/lib/ingest/sync";
import { latestBalance } from "@/lib/scrape/usage";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The pull. One run takes the accounts whose own `next_sync_at` has come round,
 * soonest first, and stops when it runs out of accounts or out of time.
 *
 * It is a queue drain rather than a full pass on purpose: if there are more
 * accounts than fit in one invocation, the next run picks up where this one left
 * off, because "soonest due first" is a cursor that needs no state. Nothing
 * breaks when the account count outgrows the schedule; the numbers just get an
 * hour older.
 *
 * **Hourly, and almost always finding nothing.** The cost lever moved onto the
 * accounts themselves (`nextSyncFor`): a busy one asks to come back in twelve
 * hours, a settled one in a month. That only works if somebody is checking often
 * enough to honour a twelve-hour answer, and it is what lets a window closing
 * today get its reading today — that reading is money. An empty run is a
 * database query and nothing else. A creator who wants a number right now
 * spends a manual refresh, which is the same sweep with the interval set to
 * zero.
 *
 * Runs as the service key, so it can see every creator's accounts. The rows it
 * writes carry the owner's user_id, so what it stores is identical to what the
 * "sync now" button stores through RLS.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Leave enough room to finish the account in flight and write the run rows. */
const TIME_BUDGET_MS = 240_000;
const MAX_ACCOUNTS = 200;

/**
 * Accounts in flight at once. The providers are already spaced per host inside
 * `lib/ingest/http.ts`, so this buys wall clock rather than throughput: six at a
 * time is what lets an hourly run empty a real queue inside its budget instead
 * of pushing the tail into the next hour every hour.
 */
const SYNC_CONC = 6;

/** Tell somebody once the balance crosses this on the way down. */
const LOW_BALANCE = 100;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` on its own once the
  // env var exists. No secret configured means the endpoint stays shut rather
  // than open, because an open one lets anyone burn the api quota.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  if (!db) {
    return NextResponse.json({ error: "SUPABASE_SECRET_KEY is not set" }, { status: 503 });
  }

  // rebound for the worker below: a hoisted function declaration does not see
  // the narrowing that proved `db` is not null.
  const client = db;
  const startedAt = Date.now();
  const balanceBefore = await latestBalance();
  const queue = await dueAccounts(client, MAX_ACCOUNTS);

  const results: SyncResult[] = [];
  let cursor = 0;
  let stoppedEarly = false;

  async function worker() {
    while (cursor < queue.length) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        stoppedEarly = true;
        return;
      }
      const account = queue[cursor++];
      results.push(
        await syncAccount(client, account, account.rules, new Date(), { source: "sync" })
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SYNC_CONC, queue.length) }, () => worker())
  );

  const failed = results.filter((r) => !r.ok);
  const balance = await latestBalance();

  // the editing market's clocks ride the same hourly tick. each one best
  // effort: a failure here must not fail a sync run that already spent real
  // credits, and one clock failing must not stop the others.
  let jobsAutoApproved = 0;
  let claimsWarned = 0;
  let claimsExpired = 0;
  let editorsRetiered = 0;
  try {
    jobsAutoApproved = (await autoApproveDeliveredJobs(client)).approved;
  } catch (err) {
    console.error("[cron] auto-approve failed", err);
  }
  try {
    claimsWarned = (await warnDueSoonClaims(client)).warned;
  } catch (err) {
    console.error("[cron] sla warn failed", err);
  }
  try {
    claimsExpired = (await expireOverdueClaims(client)).expired;
  } catch (err) {
    console.error("[cron] claim expiry failed", err);
  }
  try {
    editorsRetiered = (await retierEditors(client)).changed;
  } catch (err) {
    console.error("[cron] retier failed", err);
  }

  // one alert, on the crossing only. a balance that is already low sends nothing
  // every hour: an alert that repeats is an alert nobody reads.
  const crossed =
    balanceBefore !== null &&
    balance !== null &&
    balanceBefore >= LOW_BALANCE &&
    balance < LOW_BALANCE;

  if (crossed && process.env.ADMIN_ALERT_EMAIL) {
    await sendEmail({
      to: process.env.ADMIN_ALERT_EMAIL,
      subject: "scraping credits low",
      html: notificationHtml({
        heading: "scraping credits are running low",
        lines: [
          `the provider balance is down to **${balance}** credits.`,
          "the nightly sync stops spending under 25 and the manual refresh under 10, so numbers go stale before anything breaks.",
        ],
        cta: { label: "see usage", url: "https://www.creatorempire.app/founder/usage" },
      }),
    });
  }

  return NextResponse.json({
    ok: true,
    ms: Date.now() - startedAt,
    accounts_due: queue.length,
    accounts_synced: results.length,
    /** what the provider said was left on the last call of this run. */
    balance,
    // the queue is not empty, the clock ran out. the next run continues it.
    stopped_early: stoppedEarly,
    videos_seen: results.reduce((n, r) => n + r.seen, 0),
    videos_new: results.reduce((n, r) => n + r.added, 0),
    videos_frozen: results.reduce((n, r) => n + r.frozen, 0),
    api_calls: results.reduce((n, r) => n + r.apiCalls, 0),
    jobs_auto_approved: jobsAutoApproved,
    claims_warned: claimsWarned,
    claims_expired: claimsExpired,
    editors_retiered: editorsRetiered,
    failures: failed.map((r) => ({ handle: r.handle, platform: r.platform, error: r.error })),
  });
}
