/**
 * The deal tracker's reads. Server only.
 *
 * These live apart from `lib/deals.ts` for one reason: that file also holds the
 * types and the pure money helpers, and `components/dash/deal-forms.tsx` needs
 * those in the browser. A single module would drag `next/headers` into the
 * client bundle through the supabase server client, which is a build error, not
 * a warning. Types and pure functions in `deals.ts`, anything that talks to the
 * database here.
 */

import { createClient } from "@/lib/supabase/server";
import { dealScope, onBooks } from "@/lib/workspace";
import { cutPay, flatFeeCents, groupVideos, monthlyBaseOutlook, PLATFORMS } from "@/lib/deals";
import { addDays, monthStart } from "@/lib/cycles";
import type {
  BonusRule,
  Brand,
  Deal,
  DealAccount,
  MonthlyBase,
  Payout,
  Platform,
  RefreshQuota,
  Video,
} from "@/lib/deals";

// ----------------------------------------------------------------- the reads

export type DealListRow = {
  deal: Deal;
  brand: Brand;
  videoCount: number;
  totalViews: number;
  lastPostedAt: string | null;
  bonusCents: number;
  flatCents: number;
  earnedCents: number;
  paidCents: number;
  platforms: Platform[];
  /**
   * The freshest sync across the deal's accounts, or null when nothing has ever
   * pulled. The list's footer reads the newest of these to say how old the
   * numbers in the table are, which is the one thing a column of view counts
   * cannot tell you about itself.
   */
  lastSyncedAt: string | null;
};

/**
 * Every deal with its numbers, in four queries rather than four per deal. The
 * rollup view and both earnings functions are `security_invoker`, so RLS is
 * what scopes them — there is no user_id filter to forget here.
 *
 * The one filter that IS here is the workspace: the creator's own books or
 * the seat they switched into (`dealScope`). Everything else in this read is
 * keyed off the deals that come back, so scoping the deals scopes the lot.
 */
export async function loadDeals(): Promise<DealListRow[]> {
  const [supabase, scope] = await Promise.all([createClient(), dealScope()]);

  const [deals, rollups, earnings, accounts, payouts, overridden] = await Promise.all([
    supabase
      .from("deals")
      .select("*, brand:brands(*)")
      .filter(...onBooks(scope))
      .order("created_at", { ascending: false }),
    supabase.from("deal_rollup").select("*"),
    supabase.rpc("deal_earnings"),
    supabase
      .from("deal_accounts")
      .select("deal_id, platform, last_synced_at")
      .eq("active", true),
    supabase.from("payouts").select("deal_id, flat_cents, bonus_cents, adjust_cents, status"),
    // which deals hold a hand-set payment at all. almost always none, and the
    // full cut math below only runs for the deals in this list.
    supabase
      .from("videos")
      .select("deal_id")
      .not("payment_override_cents", "is", null),
  ]);

  if (deals.error) throw new Error(deals.error.message);

  // hand-set payments, folded in the same way the detail page folds them
  // (`loadDeal`'s overrideDelta) — the list and the detail have to say the same
  // "earned" or the two screens argue about money. computed per affected deal
  // only, because it needs the deal's cuts and rule earnings.
  const overrideBy = new Map<string, number>();
  const affected = [...new Set((overridden.data ?? []).map((r) => r.deal_id as string))];
  if (affected.length > 0) {
    const dealRowBy = new Map(
      ((deals.data ?? []) as unknown as (Deal & { brand: Brand })[]).map((d) => [d.id, d])
    );
    await Promise.all(
      affected.map(async (dealId) => {
        const deal = dealRowBy.get(dealId);
        if (!deal) return;
        const [vids, rules] = await Promise.all([
          supabase.from("videos").select("*").eq("deal_id", dealId),
          supabase.rpc("video_rule_earnings", { p_deal: dealId }),
        ]);
        const bonusByVideo = new Map<string, number>();
        const replaced = new Set<string>();
        for (const r of (rules.data ?? []) as RuleEarning[]) {
          bonusByVideo.set(
            r.video_id,
            (bonusByVideo.get(r.video_id) ?? 0) + Number(r.amount_cents ?? 0)
          );
          if (r.replaces_base) replaced.add(r.video_id);
        }
        let delta = 0;
        for (const cut of groupVideos((vids.data ?? []) as Video[])) {
          const pay = cutPay(deal, cut, bonusByVideo, replaced);
          if (pay.overrideCents === null || pay.ignored) continue;
          delta += pay.overrideCents - pay.computedCents;
        }
        overrideBy.set(dealId, delta);
      })
    );
  }

  const rollupBy = new Map(
    (rollups.data ?? []).map((r) => [
      r.deal_id as string,
      {
        videoCount: Number(r.video_count ?? 0),
        totalViews: Number(r.total_views ?? 0),
        lastPostedAt: (r.last_posted_at as string | null) ?? null,
      },
    ])
  );
  // one rpc carries both halves: what the bonus rules paid, and how many videos
  // are still owed a base fee after `min_views_for_base` and any replacing rule
  // have had their say. the rollup's `video_count` is the display count, not the
  // billing one, so the two are deliberately different numbers.
  const earned = (earnings.data ?? []) as {
    deal_id: string;
    bonus_cents: number;
    base_videos: number;
  }[];
  const bonusBy = new Map(earned.map((r) => [r.deal_id, Number(r.bonus_cents ?? 0)]));
  const baseVideosBy = new Map(earned.map((r) => [r.deal_id, Number(r.base_videos ?? 0)]));

  const platformsBy = new Map<string, Set<Platform>>();
  const syncedBy = new Map<string, string>();
  for (const a of accounts.data ?? []) {
    const dealId = a.deal_id as string;
    const set = platformsBy.get(dealId) ?? new Set<Platform>();
    set.add(a.platform as Platform);
    platformsBy.set(dealId, set);

    // string compare rather than Date: these are ISO timestamps out of postgres
    // and lexical order is chronological order for them.
    const at = a.last_synced_at as string | null;
    if (at && at > (syncedBy.get(dealId) ?? "")) syncedBy.set(dealId, at);
  }

  const paidBy = new Map<string, number>();
  for (const p of payouts.data ?? []) {
    if (p.status !== "paid") continue;
    const total = Number(p.flat_cents) + Number(p.bonus_cents) + Number(p.adjust_cents);
    paidBy.set(p.deal_id as string, (paidBy.get(p.deal_id as string) ?? 0) + total);
  }

  return (deals.data ?? []).map((row) => {
    const { brand, ...deal } = row as unknown as Deal & { brand: Brand };
    const roll = rollupBy.get(deal.id) ?? { videoCount: 0, totalViews: 0, lastPostedAt: null };
    const bonusCents = bonusBy.get(deal.id) ?? 0;
    const flatCents = flatFeeCents(deal, baseVideosBy.get(deal.id) ?? 0);

    return {
      deal,
      brand,
      ...roll,
      bonusCents,
      flatCents,
      earnedCents: flatCents + bonusCents + (overrideBy.get(deal.id) ?? 0),
      paidCents: paidBy.get(deal.id) ?? 0,
      platforms: [...(platformsBy.get(deal.id) ?? [])].sort(),
      lastSyncedAt: syncedBy.get(deal.id) ?? null,
    };
  });
}

export type RuleEarning = {
  deal_id: string;
  video_id: string;
  rule_id: string;
  countable_views: number;
  amount_cents: number;
  /** the rule paid for this video's cut and took the base fee's place. */
  replaces_base: boolean;
};

export type DealDetail = {
  deal: Deal;
  brand: Brand;
  accounts: DealAccount[];
  rules: BonusRule[];
  videos: Video[];
  payouts: Payout[];
  /** video id → cents that video has earned across every rule. */
  bonusByVideo: Map<string, number>;
  /** rule id → cents that rule has paid across every video. */
  bonusByRule: Map<string, number>;
  /** video id → rule id → countable views under that rule's window. */
  countableViews: Map<string, Map<string, number>>;
  /** videos whose base fee a replacing rule has already paid for. */
  replacedVideos: Set<string>;
  bonusCents: number;
  flatCents: number;
  /**
   * This calendar month's base pay, booked and projected.
   *
   * The same object the dashboard's "Base pay this month" panel is built from,
   * out of the same function, so a deal cannot read one figure on the dashboard
   * and a different one on its own page.
   */
  baseMonth: MonthlyBase;
  /** how many videos the per-video base fee is actually owed on. */
  baseVideos: number;
  totalViews: number;
  /**
   * What the hand-set payments add to, or take off, the rules' answer.
   *
   * A delta rather than a total on purpose. `flatCents` and `bonusCents` come out
   * of postgres, which knows nothing about an override, and re-deriving them here
   * would be a second copy of the earnings calculation. A delta layers on top and
   * works for every fee kind, including the two that have no per-post base to
   * replace.
   */
  overrideDelta: number;
  /** how many cuts are being paid a hand-set amount. */
  overriddenCuts: number;
};

export async function loadDeal(id: string): Promise<DealDetail | null> {
  const supabase = await createClient();

  const { data: dealRow, error } = await supabase
    .from("deals")
    .select("*, brand:brands(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!dealRow) return null;

  const { brand, ...deal } = dealRow as unknown as Deal & { brand: Brand };

  // the day before this month opened, which is the baseline every "what did
  // this month earn" subtraction in the product runs against.
  const now = new Date();
  const priorDay = addDays(monthStart(now), -1);

  const [accounts, rules, videos, payouts, earnings, rollup, priorRollup] = await Promise.all([
    supabase.from("deal_accounts").select("*").eq("deal_id", id).order("platform"),
    supabase.from("bonus_rules").select("*").eq("deal_id", id).order("created_at"),
    supabase
      .from("videos")
      .select("*")
      .eq("deal_id", id)
      .order("posted_at", { ascending: false, nullsFirst: false }),
    supabase.from("payouts").select("*").eq("deal_id", id).order("period_start", { ascending: false }),
    supabase.rpc("video_rule_earnings", { p_deal: id }),
    // the same rollup the list page reads, for one deal. it is what knows how
    // many videos are owed a base fee once the view floor and any replacing
    // rule have been applied, and that is not something the per-rule rows can
    // answer: a video with no rule on it produces no row at all.
    supabase.rpc("deal_earnings", { p_deal: id }),
    // the same rollup read at the last day of last month, so this month's base
    // pay is a subtraction rather than a second way of counting videos.
    // `deal_earnings_asof` takes no deal argument — it is rls-scoped and returns
    // a row per deal — so this is filtered on the way out. It costs one call and
    // is what keeps this page and the dashboard on the same number.
    supabase.rpc("deal_earnings_asof", { p_at: priorDay }),
  ]);

  const rows = (earnings.data ?? []) as RuleEarning[];

  const bonusByVideo = new Map<string, number>();
  const bonusByRule = new Map<string, number>();
  const countableViews = new Map<string, Map<string, number>>();
  const replacedVideos = new Set<string>();

  for (const r of rows) {
    const cents = Number(r.amount_cents ?? 0);
    bonusByVideo.set(r.video_id, (bonusByVideo.get(r.video_id) ?? 0) + cents);
    bonusByRule.set(r.rule_id, (bonusByRule.get(r.rule_id) ?? 0) + cents);
    if (r.replaces_base) replacedVideos.add(r.video_id);

    const perVideo = countableViews.get(r.video_id) ?? new Map<string, number>();
    perVideo.set(r.rule_id, Number(r.countable_views ?? 0));
    countableViews.set(r.video_id, perVideo);
  }

  const baseVideos = Number(
    ((rollup.data ?? []) as { base_videos: number }[])[0]?.base_videos ?? 0
  );

  // what the month has booked in base pay: the flat fee at today's video count
  // less the flat fee at last month's. Clamped, because a video losing its base
  // fee (views revised down under the floor) must not read as negative pay.
  // A deal with no row in the prior reading simply had earned nothing yet.
  const priorBaseVideos = Number(
    ((priorRollup.data ?? []) as { deal_id: string; base_videos: number }[]).find(
      (r) => r.deal_id === id
    )?.base_videos ?? 0
  );
  const bookedBaseCents = Math.max(
    flatFeeCents(deal, baseVideos, now) -
      flatFeeCents(deal, priorBaseVideos, new Date(`${priorDay}T23:59:59Z`)),
    0
  );

  const videoRows = (videos.data ?? []) as Video[];
  const counted = videoRows.filter((v) => v.counts);
  const bonusCents = [...bonusByVideo.values()].reduce((a, b) => a + b, 0);

  // grouped here as well as in the page, because the deal's own total has to
  // agree with the column under it and the override is stored per cut. An
  // ignored cut is skipped: `counts` already took it out of both rollups, so
  // counting its override again would pay for a post nothing is paying for.
  let overrideDelta = 0;
  let overriddenCuts = 0;
  for (const cut of groupVideos(videoRows)) {
    const pay = cutPay(deal, cut, bonusByVideo, replacedVideos);
    if (pay.overrideCents === null || pay.ignored) continue;
    overrideDelta += pay.overrideCents - pay.computedCents;
    overriddenCuts += 1;
  }

  return {
    deal,
    brand,
    accounts: (accounts.data ?? []) as DealAccount[],
    rules: (rules.data ?? []) as BonusRule[],
    videos: videoRows,
    payouts: (payouts.data ?? []) as Payout[],
    bonusByVideo,
    bonusByRule,
    countableViews,
    replacedVideos,
    bonusCents,
    flatCents: flatFeeCents(deal, baseVideos, now),
    baseMonth: monthlyBaseOutlook(deal, bookedBaseCents, now),
    baseVideos,
    totalViews: counted.reduce((sum, v) => sum + Number(v.views), 0),
    overrideDelta,
    overriddenCuts,
  };
}

/**
 * The refresh allowance for the signed-in person.
 *
 * Read on every page that shows the button, which is cheap: it is one count
 * over a table that holds at most a handful of rows per person per month.
 *
 * A database that has not had the migration yet answers with a null `resetsOn`,
 * which the button reads as "count unknown" and renders without one rather than
 * as "none left". Neither state is a permission: the claim inside
 * `refreshEverything` is the only thing that enforces the cap, and it fails
 * closed on exactly the deploys this fallback fires on.
 */
export async function loadRefreshQuota(): Promise<RefreshQuota> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("manual_refresh_quota")
    .maybeSingle<{ used: number; quota: number; remaining: number; resets_on: string }>();

  if (error || !data) {
    return { used: 0, quota: 0, remaining: 0, resetsOn: null };
  }

  return {
    used: data.used,
    quota: data.quota,
    remaining: data.remaining,
    resetsOn: data.resets_on,
  };
}

/** The brand picker on the new-deal form. */
export async function loadBrands(): Promise<Brand[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("brands").select("*").order("name");
  return (data ?? []) as Brand[];
}

export type ConnectedAccount = { platform: Platform; handle: string };

/**
 * What this deal has connected for posting, read from the Upload-Post profile
 * cache. The bridge between posting and tracking: a connected account can be
 * attached to the deal in one click instead of retyped, and it lands with source
 * 'oauth' so the sync knows an api path exists for it.
 *
 * Scoped to the deal, which it has to be twice over. Profiles are one row per
 * (creator, deal) since autoposting went per deal, so the unfiltered version of
 * this read asked maybeSingle() of a table that holds one row per brand and got
 * an error back the moment a creator had two - which is to say the one-click
 * attach silently stopped working for everyone it was built for.
 *
 * Reads the cache as-is rather than refreshing upstream: this is a convenience
 * list on a deals page, not the social page's source of truth.
 */
export async function loadConnectedForDeal(dealId: string): Promise<ConnectedAccount[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_profiles")
    .select("connected")
    .eq("deal_id", dealId)
    .maybeSingle();
  const connected = (data?.connected ?? {}) as Record<string, string>;

  const tracked = PLATFORMS;
  return tracked
    .filter((p) => typeof connected[p] === "string" && connected[p].trim() !== "")
    .map((p) => ({ platform: p, handle: connected[p].trim().replace(/^@/, "") }));
}
