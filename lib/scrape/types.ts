/**
 * The contract between the three halves of the profile scraper: the provider
 * client that talks to scrapecreators, the tool page that shows the table, and
 * the admin page that adds up what it cost.
 *
 * Nothing here imports anything. It is types and two pure helpers, so a client
 * component can import it without dragging the server code in behind it.
 */

import type { Platform } from "@/lib/deals";

export type { Platform };

/** One post, already normalised out of whatever the platform called its fields. */
export type ScrapedPost = {
  platform: Platform;
  /** the platform's own id. unique inside one target, which is the upsert key. */
  platformPostId: string;
  postUrl: string;
  title: string | null;
  thumbnailUrl: string | null;

  /** null means the platform did not report it. that is not the same as zero and
   *  the ui has to keep them apart, so these are nullable all the way down. */
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;

  durationSeconds: number | null;
  /** iso 8601. null when the platform only gave a relative date. */
  postedAt: string | null;

  isPinned: boolean;
  isAd: boolean;

  /** tiktok photo carousels come back down the same endpoint as videos and earn
   *  views the same way, so they are kept. they have no duration and calling
   *  one a video in the ui is just wrong, hence the flag. optional because only
   *  tiktok can produce one. */
  isPhotoPost?: boolean;
};

/** Whatever the posts response happened to say about the account. Never worth a
 *  second request: the profile endpoint is another credit for a follower count
 *  nobody is being paid on. */
export type ScrapedAuthor = {
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followerCount: number | null;
  postCount: number | null;
};

/** A profile url pulled apart. `handle` is lowercased with no leading @. */
export type DetectedProfile = {
  platform: Platform;
  handle: string;
  /** youtube only: a /channel/UC... url has to go out as channelId, not handle. */
  channelId: string | null;
  /** the tidy form of the profile page, for linking back. */
  profileUrl: string;
};

/** One page of posts, plus what it cost and where the next page starts. */
export type ScrapePage = {
  posts: ScrapedPost[];
  author: ScrapedAuthor;
  /** opaque, platform shaped: tiktok max_cursor, instagram max_id, youtube
   *  continuationToken. null when the platform said there is nothing after this. */
  nextCursor: string | null;
  hasMore: boolean;
  /** off the response body, never assumed. a cached hit is 0. */
  creditsCharged: number;
  /** the provider's own running balance, so the ui can warn before it runs dry. */
  creditsRemaining: number | null;
};

/**
 * Every provider call resolves to one of these. It never throws at the caller:
 * a scrape failing is a normal Tuesday and the page has to say why in words a
 * creator understands, not a stack trace.
 */
export type ScrapeOutcome =
  | ({ ok: true } & ScrapePage)
  | {
      ok: false;
      /** already written for a human. lowercase, no jargon. */
      error: string;
      /** what actually went wrong, for branching. */
      reason:
        | "bad_url"
        | "not_configured"
        | "no_credits"
        | "daily_cap"
        | "blocked"
        | "not_found"
        | "rate_limited"
        | "provider_error"
        | "network";
      /** true when a second attempt could plausibly work. */
      retryable: boolean;
    };

// ------------------------------------------------------------------- money

/** Micros per dollar. Credits cost a fraction of a cent each, which is why the
 *  ledger cannot use the product's usual integer cents. */
export const MICROS_PER_DOLLAR = 1_000_000;

/** Credits times the configured rate, as a dollar string. A rate of 0 means an
 *  admin has not set the plan price yet, and the page says so rather than
 *  printing a confident $0.00. */
export function creditsToUsd(
  credits: number,
  microsPerCredit: number
): string | null {
  if (!Number.isFinite(credits) || !Number.isFinite(microsPerCredit)) return null;
  if (microsPerCredit <= 0) return null;

  const dollars = (credits * microsPerCredit) / MICROS_PER_DOLLAR;
  // sub-cent totals are real and worth showing, so four places under a dollar.
  const places = dollars > 0 && dollars < 1 ? 4 : 2;
  return `$${dollars.toFixed(places)}`;
}

/** likes + comments + shares over views. Kept here as well as in the generated
 *  column so a freshly scraped page can show a rate before it is saved, and the
 *  two can never disagree about the formula. */
export function engagementRate(post: {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}): number | null {
  const views = post.views;
  if (views == null || views <= 0) return null;
  return ((post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0)) / views;
}

/** What every column shows when the platform did not report the number. A plain
 *  hyphen, not an em dash: the product bans those in ui strings, and this string
 *  is rendered in three different tables. */
export const NOT_REPORTED = "-";

/** "12.4%" or a hyphen. One place: engagement is single digit percents and the
 *  second decimal is noise. */
export function formatEngagement(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return NOT_REPORTED;
  return `${(rate * 100).toFixed(1)}%`;
}

/** 1,680,144 -> "1.7M". The table holds nine columns and a raw view count is
 *  the widest thing in it. */
export function compactCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return NOT_REPORTED;
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
