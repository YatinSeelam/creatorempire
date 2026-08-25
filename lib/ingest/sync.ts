/**
 * The sync orchestrator: pick an account, pull its feed, write today's snapshot,
 * then work out which videos can never earn again and stop asking about them.
 *
 * The freeze is the whole cost story. A creator two years into this has a
 * thousand videos and cares about maybe forty of them, because the rest sit
 * behind bonus windows that closed months ago. Freezing those turns "poll a
 * thousand videos a day forever" into "read the first page of a profile", and
 * the difference between those two is the difference between a scraper bill that
 * grows every month and one that doesn't.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BonusRule, Deal, DealAccount, Platform } from "@/lib/deals";
import { today } from "@/lib/money";
import { fetchAccountFeed, ProviderUnavailable, type FetchedVideo } from "./providers";

/** A video younger than this is never frozen, whatever the rules say. */
const FREEZE_GRACE_DAYS = 3;
const MIN_TRACK_DAYS = 7;

/**
 * How long an account is left alone before the queue wants it again.
 *
 * A daily pass over every account was most of the scraper bill, and almost
 * nothing it bought changed a payout: views move slowly, the money math
 * re-reads them whenever a page loads, and a bonus window closing is a date
 * rather than a reading. Three days is a third of the cost for the same numbers
 * two days later, and the manual refresh is what buys today's number back on
 * the days that matters.
 *
 * The interval lives here and not in the cron schedule on purpose. The run is a
 * queue drain with a time budget, so a roster too big for one invocation needs
 * the next run to finish it. Moving the schedule to every third day instead
 * would have made "did not fit" mean "three days late" rather than "one run
 * late", which is the failure this shape exists to avoid.
 *
 * It is no longer the interval every account gets: `nextSyncFor` gives each one
 * its own date, and this is the middle lane it lands in plus the fallback when
 * that date cannot be computed. It also still means "cron mode" to
 * `dueAccounts`, where 0 is the manual sweep's "everything, however fresh".
 */
export const SYNC_INTERVAL_DAYS = 3;

/** Never walk further back than this, however wide the open window claims to be. */
const MAX_HORIZON_DAYS = 400;
const MIN_HORIZON_DAYS = 35;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * The deal columns the sync itself has an opinion about.
 *
 * `status` decides how often a settled account is worth asking about, and the
 * pair of fee columns decide whether a quiet video is really finished: a
 * per-video fee with a view floor is still owed on a video that crosses it next
 * month, so that video cannot be frozen while it sits underneath.
 */
export type DealMeta = Pick<Deal, "status" | "flat_fee_kind" | "min_views_for_base">;

/** The instant a reading on `ends_on` has to exist by. 23:00Z leaves an hour. */
function closeDeadline(endsOn: string): number {
  return new Date(`${endsOn}T23:00:00Z`).getTime();
}

function applicableRules(rules: RuleShape[], platform: Platform): RuleShape[] {
  return rules.filter((r) => r.platforms.length === 0 || r.platforms.includes(platform));
}

/**
 * When this account is worth asking about again, decided from what the sync
 * just learned rather than from one interval for everybody.
 *
 * A flat three days spends the same on an account posting daily as on one that
 * has been quiet for a year, and the second is most of a mature roster. The
 * lanes below are all cost: the only accounts polled often are the ones where
 * the number is actually moving, or where a window is about to shut.
 *
 * Every applicable lane is computed and the **soonest** wins, so adding a lane
 * can only make an account fresher, never staler. And whatever they say, the
 * clamp at the end holds: a window with a close date must get a reading on that
 * date, because `w_end` is paid off the newest snapshot on or before it and a
 * stale one under-pays a real payout. That reading is money.
 */
export function nextSyncFor(
  input: {
    /** the sync that just ran failed. */
    errored: boolean;
    /** `posted_at` of every video on the account that is not frozen. */
    livePostedAt: (string | null)[];
    rules: RuleShape[];
    platform: Platform;
    /** false once the deal has ended: nothing new is coming. */
    dealActive: boolean;
  },
  now = new Date()
): Date {
  const t = now.getTime();

  const posted = input.livePostedAt
    .map((p) => (p ? new Date(p).getTime() : Number.NaN))
    .filter((ms) => Number.isFinite(ms));
  const newest = posted.length > 0 ? Math.max(...posted) : null;
  const hasLive = input.livePostedAt.length > 0;

  const lanes: number[] = [];

  // a failed pull is a question, not an answer. try again soon enough that a
  // blip resolves itself, far enough apart that a dead handle is not a loop.
  if (input.errored) lanes.push(t + 6 * HOUR_MS);

  // the first days are when views move, and they are the days a creator looks.
  if (newest !== null && t - newest < 3 * DAY_MS) lanes.push(t + 12 * HOUR_MS);
  if (newest !== null && t - newest < 14 * DAY_MS) lanes.push(t + 24 * HOUR_MS);

  const applicable = applicableRules(input.rules, input.platform);

  // a window about to shut is the one place staleness costs real money, so the
  // account gets pulled twice a day into the close.
  const closingSoon = applicable.some((r) => {
    if (!r.ends_on) return false;
    const close = closeDeadline(r.ends_on);
    return close > t && close - t <= 2 * DAY_MS;
  });
  if (closingSoon) lanes.push(t + 12 * HOUR_MS);

  if (!input.dealActive) {
    // the deal is over. the rows stay for the history and are read once a month
    // in case a platform corrects a number.
    lanes.push(t + 30 * DAY_MS);
  } else if (hasLive) {
    lanes.push(t + 3 * DAY_MS);
  } else {
    // everything on the account is frozen, so nothing here can earn. it is only
    // still in the queue in case the creator posts again.
    lanes.push(t + 7 * DAY_MS);
  }

  let next = Math.min(...lanes);

  for (const rule of applicable) {
    if (!rule.ends_on) continue;
    const close = closeDeadline(rule.ends_on);
    if (close > t && close < next) next = close;
  }

  return new Date(next);
}

export type SyncResult = {
  ok: boolean;
  accountId: string;
  platform: Platform;
  handle: string;
  seen: number;
  added: number;
  frozen: number;
  apiCalls: number;
  error?: string;
};

type RuleShape = Pick<BonusRule, "platforms" | "window_kind" | "ends_on" | "window_days">;

/**
 * When a video stops being able to earn, or null if it never stops.
 *
 * A `forever` rule, or an `absolute` rule with no end date, means null: that is
 * a deal that pays on views for as long as the video exists, and it has to be
 * polled for as long as the deal is open. Surfacing that honestly is better than
 * quietly capping it and under-reporting a payout.
 */
export function closesAt(
  rules: RuleShape[],
  platform: Platform,
  postedAt: string | null
): Date | null {
  const applicable = applicableRules(rules, platform);

  // no rule pays on this platform, so only the flat fee applies and views are
  // record-keeping. it can stop being polled as soon as the grace runs out.
  if (applicable.length === 0) return new Date(0);

  let latest = new Date(0);

  for (const rule of applicable) {
    if (rule.window_kind === "forever") return null;

    if (rule.window_kind === "absolute") {
      if (!rule.ends_on) return null;
      const end = new Date(`${rule.ends_on}T23:59:59Z`);
      if (end > latest) latest = end;
      continue;
    }

    // since_post: the window is measured from this video's own post date, so a
    // video with no known post date has no computable end and stays open.
    if (!postedAt) return null;
    const end = new Date(new Date(postedAt).getTime() + (rule.window_days ?? 0) * 86_400_000);
    if (end > latest) latest = end;
  }

  return latest;
}

/**
 * A per-video base fee with a view floor is a bonus in everything but name: the
 * video is owed nothing today and owed the whole fee the day it crosses. So a
 * video under the floor cannot be frozen, whatever the bonus rules say, or the
 * one reading that would have paid it never gets taken.
 *
 * The floor is only a floor while the deal can still pay: an ended deal owes
 * what it owed on its last day, and a crossing after that is not money.
 */
function underBaseFloor(deal: DealMeta | undefined, views: number): boolean {
  if (!deal) return false;
  if (deal.flat_fee_kind !== "per_video") return false;
  if (!deal.min_views_for_base) return false;
  if (deal.status !== "active" && deal.status !== "paused") return false;
  return views < deal.min_views_for_base;
}

function shouldFreeze(
  rules: RuleShape[],
  platform: Platform,
  postedAt: string | null,
  now: Date,
  deal?: DealMeta,
  views = 0
): boolean {
  if (!postedAt) return false;

  const age = now.getTime() - new Date(postedAt).getTime();
  if (age < MIN_TRACK_DAYS * 86_400_000) return false;

  if (underBaseFloor(deal, views)) return false;

  const closes = closesAt(rules, platform, postedAt);
  if (closes === null) return false;

  return now.getTime() > closes.getTime() + FREEZE_GRACE_DAYS * 86_400_000;
}

/**
 * How far back this account has to be walked. It is the age of its oldest
 * still-earning video, not a fixed number of days: a campaign that pays forever
 * on everything genuinely needs the whole history, and a 30-day bonus needs one
 * page.
 */
async function horizonFor(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data } = await db
    .from("videos")
    .select("posted_at")
    .eq("deal_account_id", accountId)
    .is("frozen_at", null)
    .not("posted_at", "is", null)
    .order("posted_at", { ascending: true })
    .limit(1);

  const oldest = data?.[0]?.posted_at as string | undefined;
  if (!oldest) return MIN_HORIZON_DAYS;

  const days = Math.ceil((Date.now() - new Date(oldest).getTime()) / 86_400_000) + 3;
  return Math.min(Math.max(days, MIN_HORIZON_DAYS), MAX_HORIZON_DAYS);
}

/**
 * `nextSyncFor` with the one read it needs in front of it.
 *
 * It runs after the freeze, so "still live" already means "still able to earn".
 * A read that fails must not lose the appointment: without a `next_sync_at` the
 * account is due immediately and the next run pulls it again, which is the
 * expensive way to be wrong, so the fallback is the plain interval.
 */
async function nextSyncAfter(
  db: SupabaseClient,
  account: Pick<DealAccount, "id" | "platform"> & { deal?: DealMeta },
  rules: RuleShape[],
  errored: boolean,
  now: Date
): Promise<Date> {
  try {
    const { data } = await db
      .from("videos")
      .select("posted_at")
      .eq("deal_account_id", account.id)
      .is("frozen_at", null);

    return nextSyncFor(
      {
        errored,
        livePostedAt: (data ?? []).map((v) => v.posted_at as string | null),
        rules,
        platform: account.platform,
        // no deal row on hand is treated as live: syncing something settled is
        // cheaper than never syncing something that is not.
        dealActive: account.deal ? account.deal.status !== "ended" : true,
      },
      now
    );
  } catch {
    return new Date(now.getTime() + SYNC_INTERVAL_DAYS * DAY_MS);
  }
}

/**
 * Pull one account and write what came back.
 *
 * `db` is a service client when the cron calls this and the caller's own client
 * when a "sync now" button does. Either works: the writes carry user_id
 * explicitly, so the RLS-scoped path and the RLS-bypassing path store the same
 * rows.
 */
export async function syncAccount(
  db: SupabaseClient,
  account: DealAccount & { deal?: DealMeta },
  rules: RuleShape[],
  now = new Date(),
  { source = "sync" }: { source?: "sync" | "manual" } = {}
): Promise<SyncResult> {
  const base: SyncResult = {
    ok: false,
    accountId: account.id,
    platform: account.platform,
    handle: account.handle,
    seen: 0,
    added: 0,
    frozen: 0,
    apiCalls: 0,
  };

  const run = await db
    .from("ingest_runs")
    .insert({
      user_id: account.user_id,
      deal_account_id: account.id,
      platform: account.platform,
    })
    .select("id")
    .maybeSingle();

  const runId = run.data?.id as number | undefined;

  const finish = async (result: SyncResult) => {
    if (runId) {
      await db
        .from("ingest_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: result.ok,
          videos_seen: result.seen,
          videos_new: result.added,
          api_calls: result.apiCalls,
          error: result.error ?? null,
        })
        .eq("id", runId);
    }
    // the account books its own next appointment. an account nobody is watching
    // asks to be left alone for a month; one with a window closing tomorrow asks
    // to be back in twelve hours. that is the whole cost lever now.
    const next = await nextSyncAfter(db, account, rules, Boolean(result.error), now);

    await db
      .from("deal_accounts")
      .update({
        last_synced_at: new Date().toISOString(),
        last_sync_error: result.error ?? null,
        next_sync_at: next.toISOString(),
      })
      .eq("id", account.id);
    return result;
  };

  try {
    const horizonDays = await horizonFor(db, account.id);

    const feed = await fetchAccountFeed(account.platform, account.handle, {
      horizonDays,
      accountId: account.platform_account_id,
      // the metered provider bills somebody and logs it against them. passed
      // from the row rather than the session so the cron and the button attribute
      // a credit to the same person.
      userId: account.user_id,
      targetId: account.id,
      source,
    });

    base.apiCalls = feed.apiCalls;
    base.seen = feed.videos.length;

    if (feed.platformAccountId && feed.platformAccountId !== account.platform_account_id) {
      await db
        .from("deal_accounts")
        .update({ platform_account_id: feed.platformAccountId })
        .eq("id", account.id);
    }

    const written = await writeFeed(db, account, feed.videos, now);
    base.added = written.added;

    base.frozen = await freezeAccount(db, account, rules, now);
    base.ok = true;
    return await finish(base);
  } catch (err) {
    base.error =
      err instanceof ProviderUnavailable
        ? `${err.message}, so this platform cannot be pulled yet`
        : err instanceof Error
          ? err.message
          : "sync failed";
    return await finish(base);
  }
}

/**
 * Videos first, then one snapshot row per video for today.
 *
 * The video upsert deliberately omits `counts` and `content_group`: those are
 * the creator's columns, and supabase builds the ON CONFLICT update from the
 * keys present in the payload, so leaving them out is what stops a nightly sync
 * from un-ticking a video the creator excluded.
 */
async function writeFeed(
  db: SupabaseClient,
  account: DealAccount,
  videos: FetchedVideo[],
  now: Date
): Promise<{ added: number }> {
  if (videos.length === 0) return { added: 0 };

  const before = await db
    .from("videos")
    .select("platform_video_id")
    .eq("deal_account_id", account.id);
  const known = new Set((before.data ?? []).map((r) => r.platform_video_id as string));

  const rows = videos.map((v) => ({
    user_id: account.user_id,
    deal_id: account.deal_id,
    deal_account_id: account.id,
    platform: account.platform,
    platform_video_id: v.platformVideoId,
    url: v.url,
    caption: v.caption,
    thumbnail_url: v.thumbnailUrl,
    posted_at: v.postedAt,
    views: v.views,
    likes: v.likes,
    comments: v.comments,
    shares: v.shares,
    last_seen_at: now.toISOString(),
  }));

  const { data: saved, error } = await db
    .from("videos")
    .upsert(rows, { onConflict: "deal_account_id,platform_video_id" })
    .select("id, platform_video_id");

  if (error) throw new Error(`videos upsert: ${error.message}`);

  const idBy = new Map((saved ?? []).map((r) => [r.platform_video_id as string, r.id as string]));
  const day = today(now);

  const stats = videos
    .map((v) => {
      const id = idBy.get(v.platformVideoId);
      if (!id) return null;
      return {
        video_id: id,
        day,
        user_id: account.user_id,
        views: v.views,
        likes: v.likes,
        comments: v.comments,
        shares: v.shares,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (stats.length > 0) {
    // one point per video per day. a second sync in the same day replaces the
    // morning's reading rather than adding a second opinion next to it.
    const { error: statsError } = await db
      .from("video_stats")
      .upsert(stats, { onConflict: "video_id,day" });
    if (statsError) throw new Error(`video_stats upsert: ${statsError.message}`);
  }

  const added = videos.filter((v) => !known.has(v.platformVideoId)).length;
  return { added };
}

/** Marks every video on the account that can no longer earn. Returns the count. */
export async function freezeAccount(
  db: SupabaseClient,
  account: Pick<DealAccount, "id" | "platform"> & { deal?: DealMeta },
  rules: RuleShape[],
  now = new Date()
): Promise<number> {
  const { data } = await db
    .from("videos")
    .select("id, posted_at, views")
    .eq("deal_account_id", account.id)
    .is("frozen_at", null);

  const due = (data ?? [])
    .filter((v) =>
      shouldFreeze(
        rules,
        account.platform,
        v.posted_at as string | null,
        now,
        account.deal,
        (v.views as number | null) ?? 0
      )
    )
    .map((v) => v.id as string);

  if (due.length === 0) return 0;

  await db.from("videos").update({ frozen_at: now.toISOString() }).in("id", due);
  return due.length;
}

/**
 * A rule change can reopen a window, so anything the old rules froze has to be
 * let go before the next sync, or the account's horizon stays short and the
 * reopened videos are never asked about again.
 */
export async function thawDeal(db: SupabaseClient, dealId: string): Promise<void> {
  await db.from("videos").update({ frozen_at: null }).eq("deal_id", dealId);
}

export type DueAccount = DealAccount & { rules: RuleShape[]; deal?: DealMeta };

/**
 * The work queue: active accounts on live deals whose own appointment has come
 * round, soonest first, never-synced first of all. One pass over this ordering
 * is fair without needing a cursor.
 *
 * The due date is the account's, not the queue's: every sync writes its own
 * `next_sync_at` (see `nextSyncFor`), so a busy account comes back in hours and
 * a settled one in a month, and the cron only has to ask who is due. A null is
 * an account that has never been pulled, or one written before this existed;
 * either way it goes to the front.
 *
 * `intervalDays: 0` means "every account, however fresh". That is what a manual
 * refresh passes, and running it with the caller's own client is what scopes it
 * to one person: rls does the filtering, so there is no user argument here and
 * no second query shape to keep in step with this one.
 */
export async function dueAccounts(
  db: SupabaseClient,
  limit: number,
  { intervalDays = SYNC_INTERVAL_DAYS }: { intervalDays?: number } = {}
): Promise<DueAccount[]> {
  const cron = intervalDays > 0;

  let query = db
    .from("deal_accounts")
    .select("*, deal:deals!inner(id, status, flat_fee_kind, min_views_for_base)")
    .eq("active", true)
    .in("deal.status", ["active", "paused"]);

  if (cron) {
    // the null half has to be spelled out: `lte` against a null column is null,
    // not true, so a never-synced account would filter itself out of the very
    // queue that exists to reach it.
    query = query.or(`next_sync_at.is.null,next_sync_at.lte.${new Date().toISOString()}`);
  }

  const { data, error } = await query
    // the manual sweep takes everything, so it orders by staleness instead: if
    // the clock runs out mid-sweep, the accounts that got read are the ones that
    // most needed reading.
    .order(cron ? "next_sync_at" : "last_synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) throw new Error(error.message);

  const accounts = (data ?? []) as unknown as (DealAccount & { deal: DealMeta & { id: string } })[];
  if (accounts.length === 0) return [];

  const dealIds = [...new Set(accounts.map((a) => a.deal_id))];
  const { data: rules } = await db
    .from("bonus_rules")
    .select("deal_id, platforms, window_kind, ends_on, window_days")
    .in("deal_id", dealIds);

  const rulesBy = new Map<string, RuleShape[]>();
  for (const r of rules ?? []) {
    const list = rulesBy.get(r.deal_id as string) ?? [];
    list.push(r as unknown as RuleShape);
    rulesBy.set(r.deal_id as string, list);
  }

  return accounts.map((a) => ({ ...a, rules: rulesBy.get(a.deal_id) ?? [] }));
}
