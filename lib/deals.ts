/**
 * The deal tracker's read layer and its one piece of money logic that isn't in
 * the database.
 *
 * Split of responsibility: the bonus is computed in Postgres, because it needs
 * to diff two daily snapshots per video per rule and that is a join, not a loop.
 * The flat fee is computed here, because it needs nothing but the deal row and a
 * video count and putting it in SQL would hide it.
 */


export const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
};

/**
 * The public page for one account. One definition, because a link out to a
 * handle is built on the deal page, in the scraper's detector and anywhere a
 * mark is clickable, and three spellings of a youtube channel url is how one of
 * them quietly 404s.
 *
 * `channelId` is youtube only: a UC id cannot be used as an @handle.
 */
export function profileUrl(
  platform: Platform,
  handle: string,
  channelId: string | null = null
): string {
  const name = handle.replace(/^@+/, "");
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${name}`;
    case "instagram":
      return `https://www.instagram.com/${name}/`;
    case "youtube":
      return channelId
        ? `https://www.youtube.com/channel/${channelId}`
        : `https://www.youtube.com/@${name}`;
    case "facebook":
      // a page with no vanity url is stored as its numeric id, and
      // facebook.com/1234 resolves to that page, so one shape covers both.
      return `https://www.facebook.com/${name}`;
  }
}

export type DealStatus = "draft" | "active" | "paused" | "ended";
export type FlatFeeKind = "one_time" | "per_video" | "per_month";
export type PayCycle = "one_time" | "weekly" | "biweekly" | "monthly";
export type RuleKind = "cpm" | "per_video" | "milestone";
export type WindowKind = "forever" | "absolute" | "since_post";
/** whether the bonus sits on top of the base fee or takes its place. */
export type TierMode = "add" | "replace";
/** how the views of one cut posted to several platforms are added up. */
export type ViewCounting = "per_video" | "highest" | "combined";
/** the unit a deal's video count is written per. the creator's own word. */
export type PostingPeriod = "day" | "week" | "month";

export type Brand = {
  id: string;
  name: string;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  /** a key into lib/brand-catalog.ts. null when the brand is not in the list. */
  logo_key: string | null;
  /** anything the catalogue does not cover. `brandLogo()` picks between them. */
  logo_url: string | null;
};

export type Deal = {
  id: string;
  brand_id: string;
  /**
   * whose books the deal is on. null is the creator's own account; an org id
   * is a deal done inside that agency's workspace. every list read in the app
   * scopes on it through `dealScope()` in lib/workspace.ts.
   */
  org_id: string | null;
  name: string;
  status: DealStatus;
  started_on: string | null;
  ends_on: string | null;
  flat_fee_cents: number;
  flat_fee_kind: FlatFeeKind;
  /** a per-video base fee is only owed once the video clears this. 0 = always. */
  min_views_for_base: number;
  /** how many videos the deal asks for per `posting_period`. 0 = no set number. */
  posting_quota: number;
  posting_period: PostingPeriod;
  pay_cycle: PayCycle;
  /** first day of one pay period. null = calendar months, started_on for weekly kinds. */
  cycle_anchor_on: string | null;
  net_days: number;
  currency: string;
  contract_url: string | null;
  notes: string | null;
};

export type DealAccount = {
  id: string;
  user_id: string;
  deal_id: string;
  platform: Platform;
  handle: string;
  platform_account_id: string | null;
  source: "scrape" | "oauth" | "manual";
  active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

export type MilestoneTier = { views: number; amount_cents: number };

export type BonusRule = {
  id: string;
  deal_id: string;
  label: string | null;
  kind: RuleKind;
  tier_mode: TierMode;
  view_counting: ViewCounting;
  platforms: Platform[];
  rate_cents_per_1k: number | null;
  amount_cents: number | null;
  tiers: MilestoneTier[];
  min_views: number;
  cap_cents: number | null;
  window_kind: WindowKind;
  starts_on: string | null;
  ends_on: string | null;
  window_days: number | null;
};

export type Video = {
  id: string;
  deal_id: string;
  deal_account_id: string;
  platform: Platform;
  platform_video_id: string;
  url: string | null;
  caption: string | null;
  thumbnail_url: string | null;
  posted_at: string | null;
  content_group: string | null;
  counts: boolean;
  /**
   * A hand-set payment for this cut in cents, overriding base + bonus. null is
   * "use what the rules computed" and is the normal state. Written to every
   * video of a cut and read off the lead, so the number on the row is the number
   * somebody typed rather than a share of it.
   */
  payment_override_cents: number | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  last_seen_at: string | null;
  frozen_at: string | null;
};

export type Payout = {
  id: string;
  deal_id: string;
  period_start: string;
  period_end: string;
  flat_cents: number;
  bonus_cents: number;
  adjust_cents: number;
  status: "due" | "invoiced" | "paid";
  invoiced_on: string | null;
  paid_on: string | null;
  reference: string | null;
  notes: string | null;
};

// ------------------------------------------------------------------- cadence

/**
 * Days in one of each period.
 *
 * A month is the average gregorian one, 365.2425 / 12, not a flat 30. A flat 30
 * makes every monthly quota forecast about 1.4% short, which compounds into most
 * of a month's work missing off a year's projection.
 */
const PERIOD_DAYS: Record<PostingPeriod, number> = {
  day: 1,
  week: 7,
  month: 30.436875,
};

export type Cadence = {
  perDay: number;
  perWeek: number;
  perMonth: number;
  /** "2 a day", in the creator's own unit rather than a converted one. */
  label: string;
};

/**
 * How much work a deal asks for, in every unit anything downstream needs.
 *
 * The stored pair is what the rate sheet says — "4 a week", never "0.571 a day"
 * — and this is the only place that turns it into a rate. Keeping the divisor
 * here and nowhere else is the same reason the bonus math lives once in
 * postgres: two copies of a conversion is two answers to one question.
 *
 * A quota of 0 is "no agreed number", which is every deal made before the field
 * existed. It returns null rather than a row of zeroes, so a caller has to
 * decide what "no cadence" looks like instead of rendering "0 a day" at people
 * who never set one.
 */
export function postingCadence(
  deal: Pick<Deal, "posting_quota" | "posting_period">
): Cadence | null {
  if (!deal.posting_quota || deal.posting_quota < 0) return null;

  const perDay = deal.posting_quota / (PERIOD_DAYS[deal.posting_period] ?? 1);
  return {
    perDay,
    perWeek: perDay * PERIOD_DAYS.week,
    perMonth: perDay * PERIOD_DAYS.month,
    label: `${deal.posting_quota} a ${deal.posting_period}`,
  };
}

/** How many videos the cadence expects across a span of days. */
export function expectedVideos(cadence: Cadence, days: number): number {
  return Math.round(cadence.perDay * Math.max(0, days));
}

/** Days in the calendar month containing `now`, UTC. 28 to 31, never 30.44. */
export function daysInMonth(now: Date): number {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

export type MonthlyBase = {
  /** base pay this calendar month has already earned. */
  bookedCents: number;
  /** where that lands by the last day, if the deal runs as it is written. */
  projectedCents: number;
  /** true when part of `projectedCents` is a forecast rather than money owed. */
  forecast: boolean;
};

/**
 * Where a deal's base pay lands by the end of the calendar month.
 *
 * The only answer to that question in the product. It used to be two —
 * `projectedMonthlyBaseCents` read the rate sheet for the deal page while the
 * dashboard read what the month had actually booked — and they disagreed four
 * ways: an average 30.44-day month against a named one, no floor at what was
 * already posted so a creator ahead of quota was told they were on track for
 * less than they had earned, a paused deal still forecasting a full month of
 * work nobody was going to do, and nothing at all for a retainer, which is the
 * single most certain monthly figure the product holds. Two numbers a click
 * apart under one label is worse than either of them alone, so there is one now
 * and both pages call it.
 *
 * Base only, on purpose. A bonus turns on views nobody has yet, and the whole
 * value of this figure is that a creator can plan against it: a retainer is a
 * fact, a CPM is a hope.
 *
 * Three of the four cases are already the answer, and are handed straight back:
 *
 * - a **retainer** bills the month it is in, so `bookedCents` is the whole month
 *   from the 1st. Nothing left to project.
 * - a **one-off** is owed once, and either it landed in this month or it did not.
 * - a **per-video** deal with no agreed quota has no cadence to multiply, so
 *   forecasting it would be inventing a number.
 *
 * That leaves per-video with a quota, which is the only kind that genuinely has
 * a month ahead of it: the quota across the whole calendar month at the deal's
 * own fee, floored at what has actually been posted. `daysInMonth` rather than
 * `cadence.perMonth`, because this is one named month and not an average one —
 * 30.44 days in February asks for two days of work nobody agreed to.
 *
 * Only an `active` deal is forecast. A paused one is not going to post the rest
 * of the month, and saying it will is the one way this number lies to somebody
 * planning against it.
 *
 * Known ceiling: `min_views_for_base` is applied to what has been posted (it is
 * baked into `bookedCents` via `deal_earnings`) but cannot be applied to what
 * has not. On a deal with a view floor the forecast half is the most the month
 * can pay, not the most likely. Estimating a hit rate off a handful of posts
 * would be a guess wearing the same typeface as the read numbers beside it.
 */
export function monthlyBaseOutlook(
  deal: Pick<
    Deal,
    "flat_fee_cents" | "flat_fee_kind" | "status" | "posting_quota" | "posting_period"
  >,
  /** base pay booked this month: `flatFeeCents` at today minus at the last day
   *  of last month. The caller owns that subtraction because only the database
   *  knows how many videos were owed a base fee on either day. */
  bookedCents: number,
  now = new Date()
): MonthlyBase {
  const settled = { bookedCents, projectedCents: bookedCents, forecast: false };

  if (deal.flat_fee_kind !== "per_video") return settled;
  if (deal.status !== "active" || !deal.flat_fee_cents) return settled;

  const cadence = postingCadence(deal);
  if (!cadence) return settled;

  const expected = Math.round(cadence.perDay * daysInMonth(now));
  const posted = Math.round(bookedCents / deal.flat_fee_cents);
  return {
    bookedCents,
    projectedCents: deal.flat_fee_cents * Math.max(expected, posted),
    forecast: expected > posted,
  };
}

// ------------------------------------------------------------------ flat fees

/** Whole months from `from` to `to`, counting the month in progress. */
function monthsElapsed(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) +
    1;
  return Math.max(months, 0);
}

/**
 * What the deal owes before a single view is counted.
 *
 * `per_month` bills the month it is in, not the month it finished: a retainer
 * that started on the 28th still owes for that month. `ends_on` caps it, so an
 * ended deal stops accruing instead of growing forever in the totals.
 *
 * `one_time` is owed from the day the deal starts, and this function is read
 * as-of a day by everything that reports a period, so the gate matters: without
 * it a reading taken before the deal existed still returned the fee, asof(end)
 * minus asof(start) cancelled it to nothing, and a one-off landed in no month at
 * all — visible under "all time" and nowhere else. `ends_on` is deliberately not
 * applied to it. A one-off, once owed, stays owed.
 *
 * `videoCount` is the count of videos actually owed a base fee, not every video
 * on the deal. Postgres works that out (`deal_earnings.base_videos`) because it
 * is the one place that knows which videos cleared `min_views_for_base` and
 * which had their base pay replaced by a bonus tier. This function stays a
 * multiply, which is the only reason it can live outside the database.
 */
export function flatFeeCents(
  deal: Pick<Deal, "flat_fee_cents" | "flat_fee_kind" | "started_on" | "ends_on" | "status">,
  videoCount: number,
  now = new Date()
): number {
  if (deal.status === "draft" || !deal.flat_fee_cents) return 0;

  if (deal.flat_fee_kind === "per_video") return deal.flat_fee_cents * videoCount;
  if (deal.flat_fee_kind === "one_time") {
    // a deal with no start date has no day to owe it on, so it stays owed from
    // the beginning, which is how every one of them read before the gate.
    if (!deal.started_on) return deal.flat_fee_cents;
    return new Date(`${deal.started_on}T00:00:00Z`) <= now ? deal.flat_fee_cents : 0;
  }

  if (!deal.started_on) return 0;
  const start = new Date(`${deal.started_on}T00:00:00Z`);
  const endsOn = deal.ends_on ? new Date(`${deal.ends_on}T00:00:00Z`) : null;
  const until = endsOn && endsOn < now ? endsOn : now;
  if (until < start) return 0;
  return deal.flat_fee_cents * monthsElapsed(start, until);
}

/**
 * What one video is owed of the base fee.
 *
 * A per-video fee is the only kind that has a per-post answer: `one_time` is
 * owed for the deal and `per_month` for the month, and splitting either across
 * posts would be inventing a number. Those return null, which the table shows as
 * a dash rather than as $0 — "not how this deal pays" and "earned nothing" are
 * different facts.
 *
 * The three conditions are a copy of the `base` CTE inside
 * `public.deal_earnings_asof`, deliberately: the sum of this across a deal's
 * videos has to equal `flatFeeCents(deal, base_videos)` or the table stops
 * adding up to the stat above it. If that function changes, change this with it.
 */
export function baseCentsForVideo(
  deal: Pick<Deal, "flat_fee_cents" | "flat_fee_kind" | "min_views_for_base" | "status">,
  video: Pick<Video, "counts" | "posted_at" | "views">,
  replaced: boolean
): number | null {
  if (deal.flat_fee_kind !== "per_video") return null;
  if (deal.status === "draft" || !deal.flat_fee_cents) return 0;
  if (!video.counts || !video.posted_at) return 0;
  if (replaced) return 0;
  if (video.views < deal.min_views_for_base) return 0;
  return deal.flat_fee_cents;
}

/** One row of the posts table, as money. */
export type CutPay = {
  /** the base fee across the cut's posts. null when the deal has no per-post base. */
  baseCents: number | null;
  bonusCents: number;
  /** what the rules alone say this row earned. */
  computedCents: number;
  /** the hand-set amount, or null when the rules are being used. */
  overrideCents: number | null;
  /** what the row actually pays: the override when there is one, else computed. */
  payCents: number;
  /** excluded by hand, so it pays nothing whatever else says. */
  ignored: boolean;
};

/**
 * The money on one row of the posts table.
 *
 * Order matters. Ignoring wins over everything, because `videos.counts` is what
 * the database itself filters on: an ignored cut already earns nothing in the
 * rollup, so showing an override on it would be a number nothing is paying. Then
 * the override wins over the rules. Then the rules.
 */
export function cutPay(
  deal: Pick<Deal, "flat_fee_cents" | "flat_fee_kind" | "min_views_for_base" | "status">,
  cut: Pick<Cut, "videos" | "lead" | "counts">,
  bonusByVideo: Map<string, number>,
  replacedVideos: Set<string>
): CutPay {
  const ignored = !cut.counts;

  let baseCents: number | null = null;
  for (const video of cut.videos) {
    const owed = baseCentsForVideo(deal, video, replacedVideos.has(video.id));
    if (owed === null) continue;
    baseCents = (baseCents ?? 0) + owed;
  }

  const bonusCents = cut.videos.reduce((n, v) => n + (bonusByVideo.get(v.id) ?? 0), 0);
  const computedCents = (baseCents ?? 0) + bonusCents;
  const overrideCents = cut.lead.payment_override_cents;

  return {
    baseCents,
    bonusCents,
    computedCents,
    overrideCents,
    payCents: ignored ? 0 : (overrideCents ?? computedCents),
    ignored,
  };
}

/**
 * A cut's engagement rate, the way a creator quotes it to a brand: every
 * interaction over the views that produced them.
 *
 * Lives here rather than in the page because it is a definition, not a layout
 * choice — the day this appears on the portfolio too, both places have to agree
 * on what the number means.
 *
 * One decimal under 10%, none above: 3.2% and 41% are both how somebody would
 * say it out loud, and 41.3% is a precision the underlying counts do not have.
 */
export function engagement(cut: Pick<Cut, "views" | "likes" | "comments" | "shares">): string {
  if (cut.views <= 0) return "-";
  const rate = ((cut.likes + cut.comments + cut.shares) / cut.views) * 100;
  return `${rate < 10 ? rate.toFixed(1) : Math.round(rate)}%`;
}

// ------------------------------------------------------------- rule wording

/**
 * The one-line version of a rule, every fact joined with dots.
 *
 * This is the prompt shape and only the prompt shape now: `lib/flow/*` reads it
 * to tell a model what a deal pays. The screen used to print it too and that was
 * the problem, because nine clauses in a row is a sentence a model parses fine
 * and a person's eye slides off. `ruleHeadline` / `ruleChips` in `lib/bonus.ts`
 * are the same facts split for reading.
 */
export function describeRule(rule: BonusRule): string {
  const parts: string[] = [];

  if (rule.kind === "cpm") {
    parts.push(`$${((rule.rate_cents_per_1k ?? 0) / 100).toFixed(2)} CPM`);
  } else if (rule.kind === "per_video") {
    parts.push(`$${((rule.amount_cents ?? 0) / 100).toFixed(2)} per video`);
  } else {
    const top = rule.tiers.at(-1);
    parts.push(
      rule.tiers.length === 1 && top
        ? `$${(top.amount_cents / 100).toFixed(2)} at ${top.views.toLocaleString()} views`
        : `${rule.tiers.length} tiers`
    );
  }

  // said out loud because it is the difference between $30 and $180 on a video
  // that hit its tier, and nothing else on the row would give it away.
  parts.push(rule.tier_mode === "replace" ? "replaces base pay" : "on top of base pay");

  parts.push(
    rule.platforms.length === 0
      ? "all platforms"
      : rule.platforms.map((p) => PLATFORM_LABEL[p]).join(" + ")
  );

  if (rule.view_counting === "highest") parts.push("best platform only");
  else if (rule.view_counting === "combined") parts.push("platforms combined");

  if (rule.window_kind === "since_post") parts.push(`first ${rule.window_days}d of each video`);
  else if (rule.window_kind === "absolute")
    parts.push(rule.ends_on ? `${rule.starts_on} to ${rule.ends_on}` : `from ${rule.starts_on}`);
  else parts.push("no end date");

  if (rule.min_views > 0) parts.push(`min ${rule.min_views.toLocaleString()} views`);
  if (rule.cap_cents != null) parts.push(`capped at $${(rule.cap_cents / 100).toFixed(2)}`);

  return parts.join(" · ");
}

/** True once no open window can pay this rule another cent. */
export function ruleIsClosed(rule: BonusRule, now = new Date()): boolean {
  if (rule.window_kind !== "absolute" || !rule.ends_on) return false;
  return new Date(`${rule.ends_on}T23:59:59Z`) < now;
}

/* --------------------------------------------------------- manual refresh */

/**
 * What one manual refresh costs the person spending it, read for the button.
 *
 * The allowance is a monthly count rather than a per-press cooldown, which is
 * the shape this replaced. A cooldown answers "not yet" and invites the press
 * again in fifteen minutes, so the bill it was meant to hold down is only ever
 * deferred; a count says what the year costs on the first day of the month, and
 * a creator can spend it on the days that actually matter to them.
 *
 * The numbers come from `manual_refresh_quota()` and are read fresh on every
 * page that shows the button. They are for the copy only. The claim in the
 * database is the enforcement, because a count rendered into html is a count
 * somebody can render twice.
 */
export type RefreshQuota = {
  used: number;
  quota: number;
  remaining: number;
  /** ISO date the allowance comes back, or null when the count is unknown. */
  resetsOn: string | null;
};

/* --------------------------------------------------------------- cuts ----- */

/**
 * The same edit, wherever it went out.
 *
 * One cut goes on tiktok, instagram and youtube, so a flat list of videos shows
 * the same piece of work three times and makes a creator add the views up in
 * their head. Nothing in the data says "these are the same video" outright, so
 * this matches on the signals that survive crossposting, strongest first:
 *
 * 1. `content_group` — the tag that already ties a cut together, and the thing
 *    `highest` / `combined` view counting keys off. When two videos both carry
 *    one, it is the answer either way: same tag is the same cut, different tags
 *    are different cuts, and no weaker signal may overrule that.
 * 2. **a different platform.** Everything below this line is a guess, and a
 *    guess may only ever join posts that live on different platforms. A
 *    crosspost is by definition the same edit somewhere else; two posts on one
 *    account are two pieces of work however alike they read. This is the rule
 *    that was missing first time round, and it is what produced rows carrying
 *    two and four instagram marks: a creator whose forty posts are all "make
 *    clean motion graphics with <tool>" has forty captions that look identical
 *    to a word counter and are forty different videos.
 * 3. the caption, normalised — links, hashtags, @s, emoji and punctuation
 *    stripped, since those are exactly the parts that differ per platform.
 * 4. and a close posting date. A crosspost goes out the same day or the day
 *    after; a caption reused in a later campaign does not. The window applies to
 *    an exact caption match too, because a creator with a boilerplate caption
 *    has an exact match against their whole back catalogue.
 *
 * Date alone is deliberately never enough either: three different cuts posted on
 * a Monday would collapse into one row, and a wrongly merged row hides work and
 * misreports what a video earned. Two rows for one cut is a much smaller error
 * than one row for two cuts, so every threshold here leans that way.
 *
 * Audio is not the way out of this. Most of these have no speech at all and the
 * ones that do sit over the same three trending tracks, so a transcript matches
 * everything or nothing. The signals that would actually settle it are the video
 * itself: duration to the frame, and a perceptual hash of the thumbnail. Both
 * cross platforms unchanged, neither is stored today, and both cost a fetch per
 * video — the exact bill the ingest is built to avoid. Store them when a sync
 * already has the video open, not before.
 */
export const CUT_WINDOW_DAYS = 3;
export const CUT_OVERLAP = 0.55;

/** The caption with everything platform-specific taken out of it. */
export function cutSlug(video: Video): string {
  return (video.caption ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#@][\p{L}\p{N}_.]+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Words worth comparing: the short ones are grammar, not subject. */
function cutWords(slug: string): Set<string> {
  return new Set(slug.split(" ").filter((w) => w.length >= 3));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function daysApart(a: Video, b: Video): number {
  if (!a.posted_at || !b.posted_at) return Infinity;
  const gap = Math.abs(new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());
  return gap / 86_400_000;
}

/** Whether two posts are the same edit. See {@link CUT_WINDOW_DAYS} for why. */
export function sameCut(a: Video, b: Video): boolean {
  const groupA = a.content_group?.trim().toLowerCase();
  const groupB = b.content_group?.trim().toLowerCase();
  // a hand-set group is a decision, so it answers both ways and stops here.
  if (groupA && groupB) return groupA === groupB;
  if (groupA || groupB) return false;

  // everything past here is a guess, and a guess only joins across platforms.
  if (a.platform === b.platform) return false;
  if (daysApart(a, b) > CUT_WINDOW_DAYS) return false;

  const slugA = cutSlug(a);
  const slugB = cutSlug(b);
  if (slugA.length < 12 || slugB.length < 12) return false;
  if (slugA === slugB) return true;

  return overlap(cutWords(slugA), cutWords(slugB)) >= CUT_OVERLAP;
}

/** One row of the tracked posts table: an edit and every post of it. */
export type Cut = {
  key: string;
  /** every post of this cut, in the order they arrived. */
  videos: Video[];
  /** the post the row's thumbnail, title and date come from. */
  lead: Video;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** true when at least one post of the cut is being counted. */
  counts: boolean;
  /** true when every post of the cut has stopped earning. */
  frozen: boolean;
};

/**
 * Videos into cuts, keeping the order they arrived in.
 *
 * Two rules on top of {@link sameCut}, both there to stop a row growing past
 * what a cut can be:
 *
 * - **one slot per platform.** A guessed cut holds at most one tiktok, one
 *   instagram and one youtube, so a row can never show two marks of the same
 *   platform. A hand-set `content_group` is exempt, because that is somebody
 *   saying so rather than the matcher inferring it.
 * - **nearest wins.** A video joins the matching cut whose closest post is
 *   nearest in time, not the first one it happens to match. With a boilerplate
 *   caption a dozen cuts match equally well on words alone, and the date is
 *   what tells them apart.
 */
export function groupVideos(videos: Video[]): Cut[] {
  const groups: Video[][] = [];
  const tagged = (video: Video) => Boolean(video.content_group?.trim());

  for (const video of videos) {
    let home: Video[] | null = null;
    let bestGap = Infinity;

    for (const group of groups) {
      if (!tagged(video) && group.some((held) => held.platform === video.platform)) continue;

      let matched = false;
      let gap = Infinity;
      for (const held of group) {
        if (!sameCut(held, video)) continue;
        matched = true;
        gap = Math.min(gap, daysApart(held, video));
      }

      if (matched && (home === null || gap < bestGap)) {
        home = group;
        bestGap = gap;
      }
    }

    if (home) home.push(video);
    else groups.push([video]);
  }

  return groups.map((group) => {
    const key = group[0].id;
    // the thumbnail and the caption come from the first post that has one, so a
    // youtube row with no caption does not blank a row its tiktok could fill.
    const lead = group.find((v) => v.thumbnail_url) ?? group[0];
    const named = group.find((v) => v.caption?.trim()) ?? group[0];
    // marks always read in the same order, so scanning a column of rows does not
    // mean re-reading which icon is which on every line.
    const ordered = [...group].sort(
      (a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform)
    );

    return {
      key,
      videos: ordered,
      lead,
      title: named.caption?.trim() || named.platform_video_id,
      views: group.reduce((n, v) => n + v.views, 0),
      // likes, comments and shares arrive in the same response the views do, so
      // summing them costs nothing and they are the only numbers on a deal with
      // no bonus rules that are not the same figure repeated.
      likes: group.reduce((n, v) => n + v.likes, 0),
      comments: group.reduce((n, v) => n + v.comments, 0),
      shares: group.reduce((n, v) => n + v.shares, 0),
      counts: group.some((v) => v.counts),
      frozen: group.every((v) => v.frozen_at !== null),
    };
  });
}
