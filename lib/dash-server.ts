/**
 * The reads behind /dashboard and /social. Server only.
 *
 * Both pages are views over the deal tracker's tables, and this file is what
 * retired `lib/dash-data.ts`'s placeholder objects for them. Nothing here
 * writes. Every query runs as the signed-in user, so RLS is the only scoping
 * and there is no user_id filter to forget.
 *
 * The loaders share sub-queries but are kept separate on purpose: each page
 * fetches exactly what it renders, and a shared "load everything" would grow
 * toward the union of all of them forever.
 */

import { createClient } from "@/lib/supabase/server";
import { loadDeals, type DealListRow } from "@/lib/deals-server";
import { dealScope, onBooks } from "@/lib/workspace";
import {
  daysInMonth,
  flatFeeCents,
  monthlyBaseOutlook,
  PLATFORMS,
  type Brand,
  type DealStatus,
  type FlatFeeKind,
  type MonthlyBase,
  type Platform,
} from "@/lib/deals";
import { addDays, cycleFor, cycleLabel, monthStart, payBy, toDay } from "@/lib/cycles";
import type { EarningsRange } from "@/lib/earnings-range";
import { money, shortDate } from "@/lib/money";

/* -------------------------------------------------------------- shared bits */

/** A tracked video with enough context to say whose it is. */
export type FeedVideo = {
  id: string;
  platform: Platform;
  url: string | null;
  caption: string | null;
  posted_at: string | null;
  views: number;
  likes: number;
  comments: number;
  brandName: string;
  handle: string;
};

type VideoRow = {
  id: string;
  platform: Platform;
  url: string | null;
  caption: string | null;
  posted_at: string | null;
  views: number;
  likes: number;
  comments: number;
  deal: { brand: { name: string } | null } | null;
  account: { handle: string } | null;
};

// `deals!inner` rather than a plain embed: the join is what the workspace
// filter hangs off, and a left embed would keep every video whose deal failed
// the filter with a null deal on it.
const FEED_SELECT =
  "id, platform, url, caption, posted_at, views, likes, comments, deal:deals!inner(org_id, brand:brands(name)), account:deal_accounts(handle)";

function toFeed(rows: VideoRow[]): FeedVideo[] {
  return rows.map((v) => ({
    id: v.id,
    platform: v.platform,
    url: v.url,
    caption: v.caption,
    posted_at: v.posted_at,
    views: Number(v.views),
    likes: Number(v.likes),
    comments: Number(v.comments),
    brandName: v.deal?.brand?.name ?? "unknown",
    handle: v.account?.handle ?? "",
  }));
}

/* ---------------------------------------------------------------- dashboard */

/**
 * How far each of the stat row's four numbers moved in the last seven days.
 *
 * Every one of them is a real reading rather than a decoration, and each is the
 * honest answer its own table can give:
 *
 * - `newDeals` is deals that STARTED inside the window. Nothing records when a
 *   deal's status changed, so "how many were live a week ago" is not knowable;
 *   `started_on` is, and it is the move a creator would actually name.
 * - `postedDelta` is this week's posts against the seven days before them, and
 *   is the only one that can go negative.
 * - `viewsGrowth` is what `video_stats` recorded in the window, per video, last
 *   reading minus first. Conservative by construction: a video first seen
 *   inside the window brings its first reading as its baseline rather than
 *   zero, so a brand new post counts only what it gained after we started
 *   watching. A trend chip is the right place to be wrong downwards.
 * - `earnedGrowthCents` goes through `deal_earnings_asof` and `flatFeeCents`
 *   exactly as the earnings panel does, so the chip and the panel cannot
 *   disagree about what a week earned.
 */
export type DashboardTrend = {
  newDeals: number;
  postedDelta: number;
  viewsGrowth: number;
  earnedGrowthCents: number;
};

export type DashboardData = {
  /** first name for the greeting, from auth metadata with the email as backup. */
  firstName: string;
  deals: DealListRow[];
  recentVideos: FeedVideo[];
  postedThisWeek: number;
  accountsByPlatform: Record<Platform, number>;
  accountsWithErrors: number;
  trend: DashboardTrend;
};

export async function loadDashboard(): Promise<DashboardData> {
  const [supabase, scope] = await Promise.all([createClient(), dealScope()]);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const fortnightAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const today = toDay(now);
  const weekStart = addDays(today, -7);

  // every direct read of a child table joins back to deals with `!inner` and
  // takes the workspace filter through it, so a creator switched into an
  // agency seat sees that agency's posts and nothing from their own books.
  const [{ data: auth }, deals, recent, week, weekBefore, accounts, stats, earnedThen] =
    await Promise.all([
      supabase.auth.getUser(),
      loadDeals(),
      supabase
        .from("videos")
        .select(FEED_SELECT)
        .filter(...onBooks(scope, "deal.org_id"))
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from("videos")
        .select("id, deal:deals!inner(org_id)", { count: "exact", head: true })
        .filter(...onBooks(scope, "deal.org_id"))
        .gte("posted_at", weekAgo),
      supabase
        .from("videos")
        .select("id, deal:deals!inner(org_id)", { count: "exact", head: true })
        .filter(...onBooks(scope, "deal.org_id"))
        .gte("posted_at", fortnightAgo)
        .lt("posted_at", weekAgo),
      supabase
        .from("deal_accounts")
        .select("platform, last_sync_error, deal:deals!inner(org_id)")
        .filter(...onBooks(scope, "deal.org_id"))
        .eq("active", true),
      // one row per video per day, which is exactly what makes a window
      // computable at all. Bounded to the window, so this is a handful of rows
      // per tracked video rather than the whole history.
      supabase
        .from("video_stats")
        .select("video_id, day, views, video:videos!inner(deal:deals!inner(org_id))")
        .filter(...onBooks(scope, "video.deal.org_id"))
        .gte("day", weekStart),
      supabase.rpc("deal_earnings_asof", { p_at: weekStart }),
    ]);

  const user = auth?.user;
  const metaName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined);
  const firstName = (metaName ?? user?.email ?? "there").split(/[\s@]/)[0];

  const accountsByPlatform = Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<
    Platform,
    number
  >;
  let accountsWithErrors = 0;
  for (const a of accounts.data ?? []) {
    accountsByPlatform[a.platform as Platform] += 1;
    if (a.last_sync_error) accountsWithErrors += 1;
  }

  // first and last reading per video inside the window. Rows arrive unordered,
  // so both ends are tracked rather than assuming the query's shape.
  const firstSeen = new Map<string, { day: string; views: number }>();
  const lastSeen = new Map<string, { day: string; views: number }>();
  for (const s of (stats.data ?? []) as { video_id: string; day: string; views: number }[]) {
    const reading = { day: s.day, views: Number(s.views ?? 0) };
    const f = firstSeen.get(s.video_id);
    if (!f || reading.day < f.day) firstSeen.set(s.video_id, reading);
    const l = lastSeen.get(s.video_id);
    if (!l || reading.day > l.day) lastSeen.set(s.video_id, reading);
  }
  let viewsGrowth = 0;
  for (const [id, last] of lastSeen) {
    // platforms do occasionally report a lower number than yesterday; the same
    // clamp the earnings math uses, for the same reason.
    viewsGrowth += Math.max(last.views - (firstSeen.get(id)?.views ?? 0), 0);
  }

  const thenByDeal = new Map(
    ((earnedThen.data ?? []) as { deal_id: string; bonus_cents: number; base_videos: number }[]).map(
      (r) => [r.deal_id, r]
    )
  );
  const thenClock = new Date(`${weekStart}T23:59:59Z`);
  const earnedNow = deals.reduce((n, r) => n + r.earnedCents, 0);
  const earnedBefore = deals.reduce((n, r) => {
    const row = thenByDeal.get(r.deal.id);
    if (!row) return n;
    return (
      n +
      Number(row.bonus_cents ?? 0) +
      flatFeeCents(r.deal, Number(row.base_videos ?? 0), thenClock)
    );
  }, 0);

  return {
    firstName,
    deals,
    recentVideos: toFeed((recent.data ?? []) as unknown as VideoRow[]),
    postedThisWeek: week.count ?? 0,
    accountsByPlatform,
    accountsWithErrors,
    trend: {
      newDeals: deals.filter(
        (r) =>
          r.deal.status === "active" && r.deal.started_on !== null && r.deal.started_on >= weekStart
      ).length,
      postedDelta: (week.count ?? 0) - (weekBefore.count ?? 0),
      viewsGrowth,
      earnedGrowthCents: Math.max(earnedNow - earnedBefore, 0),
    },
  };
}

/* ----------------------------------------------------------------- earnings */

/**
 * The Stripe-shaped read: pick a period, see what it earned, and the past is
 * always there. Everything leans on one primitive, `deal_earnings_asof(day)`:
 * earnings inside any span are asof(end) minus asof(day before start), which
 * keeps caps, min_views and milestone tiers honest because both readings went
 * through the same rules. The flat fee gets the identical treatment in TS via
 * `flatFeeCents` with a clock argument, and the video count it multiplies comes
 * off the same reading, so a view floor or a replacing tier moves both halves
 * of the number at once.
 *
 * Cycles are the other half: a "monthly" deal paid 16th to 15th earns against
 * its own boundary, not the calendar month, so the per-deal rows subtract at
 * each deal's own cycle start instead of the 1st.
 */

// the range list, its type and the day parser live in `earnings-range` so the
// picker (a client component) can import them without dragging this module —
// and `next/headers` with it — into the browser bundle.
export { EARNINGS_RANGES, asDay, type EarningsRange } from "@/lib/earnings-range";

export type DealPeriodRow = {
  dealId: string;
  brand: Brand;
  flatCents: number;
  bonusCents: number;
  totalCents: number;
};

export type CycleRow = {
  dealId: string;
  brandName: string;
  payCycle: string;
  cycleLabel: string;
  earnedCents: number;
  /** cycle close plus net terms; null when the cycle has no close. */
  payBy: string | null;
};

export type MonthRow = { key: string; label: string; totalCents: number };

/** One deal's base pay for the calendar month, booked and projected. */
export type BaseMonthRow = MonthlyBase & {
  dealId: string;
  brand: Brand;
  kind: FlatFeeKind;
  status: DealStatus;
};

/**
 * The month's base pay, before a single bonus.
 *
 * Its own field rather than part of `perDeal` because it is deliberately not
 * filtered by the range picker: "what am I on track to make this month" is one
 * fixed question, and answering it against a 7-day window would be a different
 * number wearing the same label.
 */
export type BaseMonthData = {
  /** "August", for the panel to say which month it means. */
  label: string;
  /** base pay the month has already earned. */
  bookedCents: number;
  /** where that lands by the last day, if every deal runs as written. */
  projectedCents: number;
  /** true when any part of the projection is a forecast rather than owed money. */
  forecast: boolean;
  dayOfMonth: number;
  days: number;
  /** the deals behind it, biggest first. */
  rows: BaseMonthRow[];
};

export type EarningsData = {
  range: EarningsRange;
  /** the window that was actually read, after clamping. null `from` means the
   *  span is open at the start ("all time"). The picker prints these back so a
   *  custom range says what it covered rather than only that it was custom. */
  from: string | null;
  to: string;
  totalCents: number;
  flatCents: number;
  bonusCents: number;
  perDeal: DealPeriodRow[];
  /** this calendar month's base pay. never filtered by `range`. */
  baseMonth: BaseMonthData;
  /** the last six calendar months, oldest first, always present. */
  months: MonthRow[];
  /** every active deal's current pay cycle, soonest close first. */
  cycles: CycleRow[];
};

export async function loadEarnings(
  deals: DealListRow[],
  range: EarningsRange,
  /** only read when `range` is "custom". Either end may be null, which means
   *  open at that end: no `from` is "since the beginning", no `to` is "up to
   *  today". */
  custom?: { from: string | null; to: string | null }
): Promise<EarningsData> {
  const supabase = await createClient();
  const now = new Date();
  const today = toDay(now);

  // the spans everything below subtracts across. a range's baseline day is the
  // day BEFORE it opens, so views earned on the first day count.
  //
  // A custom span is not a special case downstream — it resolves to the same
  // pair of days a preset does, and every read past this point works the same
  // way, because the underlying primitive is asof(end) minus asof(start-1) and
  // it does not care where the two dates came from.
  //
  // the rolling windows are inclusive of today, so "7 days" is today plus the
  // six before it rather than today plus seven — a week of readings, not eight.
  const presetStart: Record<Exclude<EarningsRange, "custom">, string | null> = {
    today,
    "7d": addDays(today, -6),
    "14d": addDays(today, -13),
    "30d": addDays(today, -29),
    "90d": addDays(today, -89),
    month: monthStart(now, 0),
    last: monthStart(now, -1),
    "3m": monthStart(now, -2),
    ytd: toDay(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))),
    all: null,
  };
  const presetEnd: Record<Exclude<EarningsRange, "custom">, string> = {
    today,
    "7d": today,
    "14d": today,
    "30d": today,
    "90d": today,
    month: today,
    last: addDays(monthStart(now, 0), -1),
    "3m": today,
    ytd: today,
    all: today,
  };

  let spanStart: string | null;
  let spanEnd: string;
  if (range === "custom") {
    spanStart = custom?.from ?? null;
    // a range that ends in the future would read the same numbers as today and
    // print a window nobody can have earned in yet
    spanEnd = custom?.to && custom.to < today ? custom.to : today;
    // backwards dates are a slip of the picker, not an intent to earn nothing
    if (spanStart && spanStart > spanEnd) [spanStart, spanEnd] = [spanEnd, spanStart];
  } else {
    spanStart = presetStart[range];
    spanEnd = presetEnd[range];
  }

  const active = deals.filter((r) => r.deal.status === "active");
  const cyclesByDeal = new Map(active.map((r) => [r.deal.id, cycleFor(r.deal, today)]));

  // one rpc per distinct day, deduped: the range's two edges, seven month
  // boundaries for the history, and each deal's own cycle baseline.
  const days = new Set<string>([today, spanEnd]);
  if (spanStart) days.add(addDays(spanStart, -1));
  for (let m = -5; m <= 0; m += 1) {
    days.add(addDays(monthStart(now, m), -1));
    days.add(m === 0 ? today : addDays(monthStart(now, m + 1), -1));
  }
  for (const c of cyclesByDeal.values()) if (c.start) days.add(addDays(c.start, -1));

  const dayList = [...days];
  const readings = await Promise.all(
    dayList.map((d) => supabase.rpc("deal_earnings_asof", { p_at: d }))
  );
  // the same reading carries the flat fee's side of the answer: how many videos
  // were owed a base fee on that day, after `min_views_for_base` and any rule
  // set to replace base pay. counting posted videos here instead would bill for
  // videos the terms say are not owed anything.
  const bonusAt = new Map<string, Map<string, number>>();
  const baseAt = new Map<string, Map<string, number>>();
  dayList.forEach((d, i) => {
    const bonusPerDeal = new Map<string, number>();
    const basePerDeal = new Map<string, number>();
    const rows = (readings[i].data ?? []) as {
      deal_id: string;
      bonus_cents: number;
      base_videos: number;
    }[];
    for (const row of rows) {
      bonusPerDeal.set(row.deal_id, Number(row.bonus_cents ?? 0));
      basePerDeal.set(row.deal_id, Number(row.base_videos ?? 0));
    }
    bonusAt.set(d, bonusPerDeal);
    baseAt.set(d, basePerDeal);
  });

  const dealById = new Map(deals.map((r) => [r.deal.id, r]));

  const bonusAsOf = (dealId: string, day: string | null): number =>
    day === null ? 0 : (bonusAt.get(day)?.get(dealId) ?? 0);

  const flatAsOf = (dealId: string, day: string | null): number => {
    if (day === null) return 0;
    const row = dealById.get(dealId);
    if (!row) return 0;
    const count = baseAt.get(day)?.get(dealId) ?? 0;
    return flatFeeCents(row.deal, count, new Date(`${day}T23:59:59Z`));
  };

  /** what a deal earned between two readings, never negative. */
  const between = (dealId: string, baseline: string | null, end: string) => {
    const flat = Math.max(flatAsOf(dealId, end) - flatAsOf(dealId, baseline), 0);
    const bonus = Math.max(bonusAsOf(dealId, end) - bonusAsOf(dealId, baseline), 0);
    return { flat, bonus };
  };

  const baseline = spanStart ? addDays(spanStart, -1) : null;
  const perDeal: DealPeriodRow[] = deals
    .map((r) => {
      const { flat, bonus } = between(r.deal.id, baseline, spanEnd);
      return {
        dealId: r.deal.id,
        brand: r.brand,
        flatCents: flat,
        bonusCents: bonus,
        totalCents: flat + bonus,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  // ------------------------------------------------- the month's base pay
  //
  // Free of extra queries: the month history below already reads
  // `deal_earnings_asof` at the day before this month opened, and `today` is
  // always in the set, so the booked half is the same subtraction the rest of
  // this function does. Only the flat side is taken — a bonus is not base pay,
  // and that distinction is the whole point of the number.
  const openMonth = monthStart(now, 0);
  const baseRows: BaseMonthRow[] = deals
    .map((r) => ({
      dealId: r.deal.id,
      brand: r.brand,
      kind: r.deal.flat_fee_kind,
      status: r.deal.status,
      // the same subtraction `loadDeal` makes for one deal, through the same
      // function, which is what stops the two pages disagreeing about a month.
      ...monthlyBaseOutlook(r.deal, between(r.deal.id, addDays(openMonth, -1), today).flat, now),
    }))
    // a live deal with nothing on it yet is still an answer ("$0 so far"), but a
    // deal that ended in March is noise on an August panel.
    .filter((r) => r.status === "active" || r.bookedCents > 0)
    .sort((a, b) => b.projectedCents - a.projectedCents || b.bookedCents - a.bookedCents);

  const baseMonth: BaseMonthData = {
    label: new Date(`${openMonth}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "long",
      timeZone: "UTC",
    }),
    bookedCents: baseRows.reduce((n, r) => n + r.bookedCents, 0),
    projectedCents: baseRows.reduce((n, r) => n + r.projectedCents, 0),
    forecast: baseRows.some((r) => r.forecast),
    dayOfMonth: now.getUTCDate(),
    days: daysInMonth(now),
    rows: baseRows,
  };

  const months: MonthRow[] = [];
  for (let m = -5; m <= 0; m += 1) {
    const start = monthStart(now, m);
    const end = m === 0 ? today : addDays(monthStart(now, m + 1), -1);
    const total = deals.reduce((sum, r) => {
      const { flat, bonus } = between(r.deal.id, addDays(start, -1), end);
      return sum + flat + bonus;
    }, 0);
    months.push({
      key: start.slice(0, 7),
      label: new Date(`${start}T00:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      totalCents: total,
    });
  }

  const cycles: CycleRow[] = active
    .map((r) => {
      const cycle = cyclesByDeal.get(r.deal.id)!;
      const { flat, bonus } = between(
        r.deal.id,
        cycle.start ? addDays(cycle.start, -1) : null,
        today
      );
      return {
        dealId: r.deal.id,
        brandName: r.brand.name,
        payCycle: r.deal.pay_cycle,
        cycleLabel: cycleLabel(cycle, now),
        earnedCents: flat + bonus,
        payBy: payBy(r.deal, cycle),
      };
    })
    .sort((a, b) => (a.payBy ?? "9999").localeCompare(b.payBy ?? "9999"));

  const flatTotal = perDeal.reduce((n, r) => n + r.flatCents, 0);
  const bonusTotal = perDeal.reduce((n, r) => n + r.bonusCents, 0);

  return {
    range,
    from: spanStart,
    to: spanEnd,
    totalCents: flatTotal + bonusTotal,
    flatCents: flatTotal,
    bonusCents: bonusTotal,
    perDeal,
    baseMonth,
    months,
    cycles,
  };
}

/* ---------------------------------------------------------- the overview */

/**
 * The rest of what the dashboard shows beside the money: views inside the
 * period, what is connected, what is in flight on the editing and posting
 * sides, a fortnight of activity for the trend, and the short list of things
 * that need a hand. One read, scoped to the books like everything above.
 */
export type TrendDay = { day: string; edits: number; posts: number };

export type Attention = {
  kind: "accounts" | "review" | "failed" | "payout" | "sync";
  title: string;
  line: string;
  href: string;
};

export type OverviewData = {
  /** views that accrued inside the window, across every tracked video. */
  viewsInRange: number;
  /** videos posted inside the window. */
  postedInRange: number;
  /** platforms with a posting login, across every deal on these books. */
  connectedAccounts: number;
  /** edit jobs still moving: open, in edit, delivered, revisions. */
  jobsInFlight: number;
  /** jobs delivered and waiting on the creator to approve or send back. */
  jobsAwaitingReview: number;
  /** autoposts created inside the window that are queued or already out. */
  postsInRange: number;
  postsQueued: number;
  postsFailed: number;
  /** the last 14 days, oldest first, one entry per day. */
  trend: TrendDay[];
  attention: Attention[];
  /** per deal, inside the window. */
  perDeal: Record<string, { views: number; posts: number }>;
};

export async function loadOverview(
  deals: DealListRow[],
  window: { from: string | null; to: string },
  cycles: CycleRow[]
): Promise<OverviewData> {
  const [supabase, scope] = await Promise.all([createClient(), dealScope()]);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const now = new Date();
  const today = toDay(now);
  const fortnightStart = addDays(today, -13);
  // the day before the window opens is the baseline reading, so the first
  // day's views count. an open start reads everything.
  const baseline = window.from ? addDays(window.from, -1) : null;
  const fromIso = window.from ? `${window.from}T00:00:00Z` : null;
  const toIso = `${window.to}T23:59:59Z`;
  const trendFromIso = `${fortnightStart}T00:00:00Z`;

  let statsQ = supabase
    .from("video_stats")
    .select("video_id, day, views, video:videos!inner(deal_id, deal:deals!inner(org_id))")
    .filter(...onBooks(scope, "video.deal.org_id"))
    .lte("day", window.to);
  if (baseline) statsQ = statsQ.gte("day", baseline);

  let postedQ = supabase
    .from("videos")
    .select("id, deal_id, deal:deals!inner(org_id)")
    .filter(...onBooks(scope, "deal.org_id"))
    .lte("posted_at", toIso);
  if (fromIso) postedQ = postedQ.gte("posted_at", fromIso);

  // social posts back to whichever is older: the window's start or the trend's
  let socialQ = supabase
    .from("social_posts")
    .select("id, deal_id, status, scheduled_for, created_at, deal:deals!inner(org_id)")
    .filter(...onBooks(scope, "deal.org_id"));
  const socialSince = fromIso && fromIso < trendFromIso ? fromIso : trendFromIso;
  if (window.from) socialQ = socialQ.gte("created_at", socialSince);

  const [stats, posted, profiles, jobs, social] = await Promise.all([
    statsQ,
    postedQ,
    supabase
      .from("social_profiles")
      .select("deal_id, connected, deal:deals!inner(org_id)")
      .filter(...onBooks(scope, "deal.org_id")),
    user
      ? supabase
          .from("edit_jobs")
          .select("id, status, created_at, deal_id, deal:deals(org_id)")
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] as unknown[] }),
    socialQ,
  ]);

  // views inside the window: last reading minus the first, per video, clamped
  const first = new Map<string, { day: string; views: number; deal: string }>();
  const last = new Map<string, { day: string; views: number; deal: string }>();
  for (const s of (stats.data ?? []) as unknown as {
    video_id: string;
    day: string;
    views: number;
    video: { deal_id: string };
  }[]) {
    const r = { day: s.day, views: Number(s.views ?? 0), deal: s.video.deal_id };
    const f = first.get(s.video_id);
    if (!f || r.day < f.day) first.set(s.video_id, r);
    const l = last.get(s.video_id);
    if (!l || r.day > l.day) last.set(s.video_id, r);
  }
  const perDeal: Record<string, { views: number; posts: number }> = {};
  const bump = (deal: string, key: "views" | "posts", n: number) => {
    perDeal[deal] ??= { views: 0, posts: 0 };
    perDeal[deal][key] += n;
  };
  let viewsInRange = 0;
  for (const [id, l] of last) {
    const f = first.get(id);
    // with no baseline day inside the read, an open window counts the whole
    // reading; a closed one counts the growth since its first reading.
    const gained = baseline ? Math.max(l.views - (f?.views ?? 0), 0) : l.views;
    viewsInRange += gained;
    bump(l.deal, "views", gained);
  }
  for (const v of (posted.data ?? []) as { id: string; deal_id: string }[]) {
    bump(v.deal_id, "posts", 1);
  }

  let connectedAccounts = 0;
  for (const p of (profiles.data ?? []) as { connected: Record<string, string> | null }[]) {
    connectedAccounts += Object.keys(p.connected ?? {}).length;
  }

  const jobRows = ((jobs.data ?? []) as {
    id: string;
    status: string;
    created_at: string;
    deal_id: string | null;
    deal: { org_id: string | null } | null;
  }[]).filter((j) => !j.deal_id || (j.deal?.org_id ?? null) === scope.orgId);
  const inFlight = new Set(["open", "claimed", "delivered", "revisions"]);
  const jobsInFlight = jobRows.filter((j) => inFlight.has(j.status)).length;
  const jobsAwaitingReview = jobRows.filter((j) => j.status === "delivered").length;

  const socialRows = (social.data ?? []) as {
    id: string;
    deal_id: string | null;
    status: string;
    scheduled_for: string | null;
    created_at: string;
  }[];
  const inWindow = (iso: string) => (!fromIso || iso >= fromIso) && iso <= toIso;
  const postsInRange = socialRows.filter(
    (p) => inWindow(p.created_at) && p.status !== "canceled" && p.status !== "failed"
  ).length;
  const postsQueued = socialRows.filter(
    (p) => p.status === "scheduled" || p.status === "processing"
  ).length;
  const postsFailed = socialRows.filter((p) => p.status === "failed").length;

  // the fortnight, one bucket a day, filled from zero so the chart has a bar
  // for every day whether or not anything happened on it
  const trend: TrendDay[] = [];
  for (let i = 13; i >= 0; i--) trend.push({ day: addDays(today, -i), edits: 0, posts: 0 });
  const bucket = new Map(trend.map((t) => [t.day, t]));
  for (const j of jobRows) {
    const d = bucket.get(j.created_at.slice(0, 10));
    if (d) d.edits += 1;
  }
  for (const p of socialRows) {
    if (p.status === "canceled") continue;
    const d = bucket.get(p.created_at.slice(0, 10));
    if (d) d.posts += 1;
  }

  const attention: Attention[] = [];
  const untracked = deals.filter(
    (r) => r.deal.status === "active" && r.platforms.length === 0
  );
  for (const r of untracked.slice(0, 3)) {
    attention.push({
      kind: "accounts",
      title: `${r.brand.name} has no tracked account`,
      line: "add a handle or connect a login so views start counting",
      href: `/deals/${r.deal.id}/edit`,
    });
  }
  if (jobsAwaitingReview > 0) {
    attention.push({
      kind: "review",
      title: `${jobsAwaitingReview} cut${jobsAwaitingReview === 1 ? "" : "s"} waiting on you`,
      line: "an editor delivered. approve it or send it back",
      href: "/editing",
    });
  }
  if (postsFailed > 0) {
    attention.push({
      kind: "failed",
      title: `${postsFailed} post${postsFailed === 1 ? "" : "s"} failed to go out`,
      line: "open the scheduler to retry or fix the connection",
      href: "/tools/autoposting",
    });
  }
  const due = cycles
    .filter((c) => c.payBy !== null && c.earnedCents > 0)
    .sort((a, b) => (a.payBy ?? "").localeCompare(b.payBy ?? ""))
    .slice(0, 2);
  for (const c of due) {
    attention.push({
      kind: "payout",
      title: `${c.brandName} pays ${money(c.earnedCents)} by ${shortDate(c.payBy)}`,
      line: `${c.cycleLabel}. log the payout when it lands`,
      href: `/deals/${c.dealId}`,
    });
  }

  return {
    viewsInRange,
    postedInRange: posted.data?.length ?? 0,
    connectedAccounts,
    jobsInFlight,
    jobsAwaitingReview,
    postsInRange,
    postsQueued,
    postsFailed,
    trend,
    attention,
    perDeal,
  };
}
