/**
 * One fetcher per platform, all returning the same shape.
 *
 * The rule that makes this affordable: **ask about accounts, never about
 * videos.** A profile request comes back with 35 to 50 videos and their view
 * counts in it. Polling each video separately is the same information for 35x
 * the money, and it is what makes a per-result scraper bill land at four
 * figures. Nothing in here fetches a single video.
 *
 * Cost per platform per account per day:
 *   youtube    free. the official Data API gives 10,000 quota units a day, a
 *              50-video statistics batch costs 1 unit. an account is ~3 units.
 *   tiktok     one profile lookup + one page per 35 videos, on a flat-rate
 *              RapidAPI subscription. no per-result charge.
 *   instagram  same, one profile lookup + one page per ~12 reels.
 *   facebook   one page per 10 reels, metered. the dearest of the four per
 *              video, which is why it gets its own page budget below.
 *
 * Adding an OAuth path later replaces a provider here and nothing else: the
 * TikTok Display API and the Instagram Graph API both return this same shape
 * for a creator who has connected their own account, and both are free.
 */

import { profileUrl, type Platform } from "@/lib/deals";
import { getJson, pickArray, pickNumber, pickString, Spacer, withRetry } from "./http";
import { parsePostUrl } from "./urls";
import {
  fetchFacebookReels,
  fetchInstagramReels,
  fetchTiktokVideos,
  fetchYoutubeShorts,
  hasApiKey as hasScrapeKey,
} from "@/lib/scrape/scrapecreators";
import {
  normalizeFacebook,
  normalizeInstagram,
  normalizeTiktok,
  normalizeYoutube,
} from "@/lib/scrape/normalize";
import {
  balanceFloorError,
  creditsUsedToday,
  dailyCapFor,
  logUsage,
  syncBudgetError,
  type UsageSource,
} from "@/lib/scrape/usage";
import type { ScrapePage } from "@/lib/scrape/types";
import { createServiceClient } from "@/lib/supabase/service";

export type FetchedVideo = {
  platformVideoId: string;
  url: string;
  caption: string | null;
  thumbnailUrl: string | null;
  /** ISO. null only if the provider gave nothing usable. */
  postedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

export type AccountFeed = {
  /** the stable id, cached back onto deal_accounts so a rename can't orphan videos. */
  platformAccountId: string | null;
  videos: FetchedVideo[];
  /** billable requests spent. written to ingest_runs so cost is a number on a page. */
  apiCalls: number;
};

export type FetchOptions = {
  /** stop paginating once items are older than this. */
  horizonDays: number;
  /** cached stable id, skips the profile lookup entirely when we already have it. */
  accountId?: string | null;
  /** hard stop, so a provider that always says hasMore can't spin. */
  maxPages?: number;
  /**
   * Who the credits are being spent on behalf of. Only the metered provider
   * reads it, and it reads it for the ledger and the daily cap rather than for
   * scoping: a paid call with nobody's name on it is an unattributable line on
   * next month's bill, so scrapecreators refuses to run without one.
   */
  userId?: string | null;
  /** the deal_accounts row, for the ledger's target column. */
  targetId?: string | null;
  /**
   * Who wanted this pull. The cron is `sync` and the refresh button is
   * `manual`, and the metered provider treats them differently: the daily cap
   * belongs to the person clicking, and the last credits on the account are
   * held back for them rather than handed to a job running at 3am.
   */
  source?: Extract<UsageSource, "sync" | "manual">;
};

export class ProviderUnavailable extends Error {}

const RAPID_KEY = () => process.env.RAPIDAPI_KEY ?? "";
const YT_KEY = () => process.env.YOUTUBE_API_KEY ?? "";

// Instagram's host throttles hardest, so it gets the widest gap.
const igSpacer = new Spacer(1_150);
const ttSpacer = new Spacer(140);
const ytSpacer = new Spacer(60);

function cutoff(horizonDays: number): number {
  return Date.now() - horizonDays * 86_400_000;
}

function isoOrNull(seconds: number | null): string | null {
  if (!seconds) return null;
  // providers hand back seconds; a value in the future is a parsing mistake.
  const ms = seconds > 4_000_000_000 ? seconds : seconds * 1_000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) || ms > Date.now() + 86_400_000
    ? null
    : date.toISOString();
}

// ------------------------------------------------------------------- youtube

const YT = "https://www.googleapis.com/youtube/v3";

/**
 * Free, and the reason youtube should always be wired up before the other two.
 *
 * Three calls for an account with 50 recent uploads: resolve the channel (skipped
 * once cached), list the uploads playlist, batch the statistics 50 at a time.
 * The daily 10,000-unit grant is ~3,000 accounts a day at that rate, so this
 * never becomes the thing that costs money.
 */
async function fetchYouTube(handle: string, opts: FetchOptions): Promise<AccountFeed> {
  const key = YT_KEY();
  if (!key) throw new ProviderUnavailable("YOUTUBE_API_KEY is not set");

  let calls = 0;
  let channelId = opts.accountId?.startsWith("UC") ? opts.accountId : null;

  if (!channelId) {
    // forHandle is the cheap resolver (1 unit). search.list would also work and
    // costs 100 units, which is why it is not here.
    for (const param of [`forHandle=@${encodeURIComponent(handle)}`, `forUsername=${encodeURIComponent(handle)}`]) {
      await ytSpacer.wait();
      calls++;
      const res = await withRetry(() =>
        getJson<Json>(`${YT}/channels?part=contentDetails&${param}&key=${key}`)
      );
      channelId = pickString(res, ["items.0.id"]);
      if (channelId) break;
    }
    // a raw UC id typed into the handle field is also valid.
    if (!channelId && /^UC[\w-]{20,}$/.test(handle)) channelId = handle;
    if (!channelId) throw new Error(`youtube: no channel for "${handle}"`);
  }

  // every channel's uploads playlist is its id with the second letter swapped.
  const uploads = `UU${channelId.slice(2)}`;
  const since = cutoff(opts.horizonDays);
  const maxPages = opts.maxPages ?? 20;

  const ids: string[] = [];
  const meta = new Map<string, { postedAt: string | null; caption: string | null; thumb: string | null }>();
  let pageToken = "";

  for (let page = 0; page < maxPages; page++) {
    await ytSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(
        `${YT}/playlistItems?part=snippet,contentDetails&playlistId=${uploads}` +
          `&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}&key=${key}`
      )
    );

    const items = pickArray(res, ["items"]);
    if (items.length === 0) break;

    let reachedHorizon = false;
    for (const item of items) {
      const id = pickString(item, ["contentDetails.videoId", "snippet.resourceId.videoId"]);
      const publishedAt = pickString(item, ["contentDetails.videoPublishedAt", "snippet.publishedAt"]);
      if (!id) continue;
      if (publishedAt && new Date(publishedAt).getTime() < since) {
        reachedHorizon = true;
        continue;
      }
      ids.push(id);
      meta.set(id, {
        postedAt: publishedAt,
        caption: pickString(item, ["snippet.title"]),
        thumb: pickString(item, [
          "snippet.thumbnails.maxres.url",
          "snippet.thumbnails.high.url",
          "snippet.thumbnails.default.url",
        ]),
      });
    }

    // the uploads playlist is newest-first, so the first old item ends the walk.
    if (reachedHorizon) break;
    pageToken = pickString(res, ["nextPageToken"]) ?? "";
    if (!pageToken) break;
  }

  const videos: FetchedVideo[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    await ytSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(`${YT}/videos?part=statistics&id=${batch.join(",")}&key=${key}`)
    );

    for (const item of pickArray(res, ["items"])) {
      const id = pickString(item, ["id"]);
      if (!id) continue;
      const m = meta.get(id);
      videos.push({
        platformVideoId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        caption: m?.caption ?? null,
        thumbnailUrl: m?.thumb ?? null,
        postedAt: m?.postedAt ?? null,
        views: pickNumber(item, ["statistics.viewCount"]) ?? 0,
        likes: pickNumber(item, ["statistics.likeCount"]) ?? 0,
        comments: pickNumber(item, ["statistics.commentCount"]) ?? 0,
        shares: 0, // youtube does not publish it. nobody pays on shares.
      });
    }
  }

  return { platformAccountId: channelId, videos, apiCalls: calls };
}

// -------------------------------------------------------------------- tiktok

const TT_HOST = "tiktok-api23.p.rapidapi.com";

function rapidHeaders(host: string): Record<string, string> {
  return { "x-rapidapi-key": RAPID_KEY(), "x-rapidapi-host": host };
}

/**
 * secUid first, then pages of 35. secUid is cached on the account row because
 * the lookup is a whole request and a handle rarely changes.
 */
async function fetchTikTok(handle: string, opts: FetchOptions): Promise<AccountFeed> {
  if (!RAPID_KEY()) throw new ProviderUnavailable("RAPIDAPI_KEY is not set");

  let calls = 0;
  let secUid = opts.accountId ?? null;

  if (!secUid) {
    await ttSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(
        `https://${TT_HOST}/api/user/info?uniqueId=${encodeURIComponent(handle)}`,
        rapidHeaders(TT_HOST)
      )
    );
    secUid = pickString(res, [
      "userInfo.user.secUid",
      "data.userInfo.user.secUid",
      "user.secUid",
      "secUid",
    ]);
    if (!secUid) throw new Error(`tiktok: no secUid for "@${handle}"`);
  }

  const since = cutoff(opts.horizonDays);
  const maxPages = opts.maxPages ?? 25;
  const videos: FetchedVideo[] = [];
  let cursor = "0";

  for (let page = 0; page < maxPages; page++) {
    await ttSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(
        `https://${TT_HOST}/api/user/posts?secUid=${encodeURIComponent(secUid)}&count=35&cursor=${cursor}`,
        rapidHeaders(TT_HOST)
      )
    );

    const items = pickArray(res, ["data.itemList", "itemList", "data.items"]);
    if (items.length === 0) break;

    let reachedHorizon = false;
    for (const item of items) {
      const id = pickString(item, ["id", "aweme_id", "video.id"]);
      if (!id) continue;
      const postedAt = isoOrNull(pickNumber(item, ["createTime", "create_time"]));
      if (postedAt && new Date(postedAt).getTime() < since) {
        reachedHorizon = true;
        continue;
      }
      const author = pickString(item, ["author.uniqueId", "author.unique_id"]) ?? handle;
      videos.push({
        platformVideoId: id,
        url: `https://www.tiktok.com/@${author}/video/${id}`,
        caption: pickString(item, ["desc", "title"]),
        thumbnailUrl: pickString(item, [
          "video.cover",
          "video.originCover",
          "video.dynamicCover",
        ]),
        postedAt,
        views: pickNumber(item, ["stats.playCount", "statsV2.playCount", "play_count"]) ?? 0,
        likes: pickNumber(item, ["stats.diggCount", "statsV2.diggCount", "digg_count"]) ?? 0,
        comments: pickNumber(item, ["stats.commentCount", "statsV2.commentCount", "comment_count"]) ?? 0,
        shares: pickNumber(item, ["stats.shareCount", "statsV2.shareCount", "share_count"]) ?? 0,
      });
    }

    if (reachedHorizon) break;
    const hasMore = pickNumber(res, ["data.hasMore", "hasMore"]);
    const next = pickString(res, ["data.cursor", "cursor"]);
    if (!next || next === cursor || hasMore === 0) break;
    cursor = next;
  }

  return { platformAccountId: secUid, videos, apiCalls: calls };
}

// ----------------------------------------------------------------- instagram

const IG_HOST = "instagram-api-fast-reliable-data-scraper.p.rapidapi.com";

/**
 * The hardest of the three and the one worth replacing with OAuth first: the
 * Instagram Graph API gives a creator's own reel insights for free, including
 * the `views` metric that public pages do not reliably expose at all.
 */
async function fetchInstagram(handle: string, opts: FetchOptions): Promise<AccountFeed> {
  if (!RAPID_KEY()) throw new ProviderUnavailable("RAPIDAPI_KEY is not set");

  let calls = 0;
  let pk = opts.accountId ?? null;

  if (!pk) {
    await igSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(
        `https://${IG_HOST}/profile?username=${encodeURIComponent(handle)}`,
        rapidHeaders(IG_HOST)
      )
    );
    pk = pickString(res, ["pk", "id", "user.pk", "data.user.pk", "data.pk", "user.id"]);
    if (!pk) throw new Error(`instagram: no user id for "@${handle}"`);
  }

  const since = cutoff(opts.horizonDays);
  const maxPages = opts.maxPages ?? 25;
  const videos: FetchedVideo[] = [];
  let maxId = "";

  for (let page = 0; page < maxPages; page++) {
    await igSpacer.wait();
    calls++;
    const res = await withRetry(() =>
      getJson<Json>(
        `https://${IG_HOST}/reels?user_id=${encodeURIComponent(pk)}${maxId ? `&max_id=${encodeURIComponent(maxId)}` : ""}`,
        rapidHeaders(IG_HOST)
      )
    );

    const items = pickArray(res, ["items", "data.items", "data.reels", "reels"]);
    if (items.length === 0) break;

    let reachedHorizon = false;
    for (const raw of items) {
      // some pages wrap each reel in { media: {...} }, some do not.
      const item = (raw as Record<string, unknown>)?.media ?? raw;
      const code = pickString(item, ["code", "shortcode"]);
      if (!code) continue;
      const postedAt = isoOrNull(pickNumber(item, ["taken_at", "taken_at_timestamp", "device_timestamp"]));
      if (postedAt && new Date(postedAt).getTime() < since) {
        reachedHorizon = true;
        continue;
      }
      videos.push({
        platformVideoId: code,
        url: `https://www.instagram.com/reel/${code}/`,
        caption: pickString(item, ["caption.text", "caption", "edge_media_to_caption.edges.0.node.text"]),
        thumbnailUrl: pickString(item, [
          "image_versions2.candidates.0.url",
          "thumbnail_url",
          "display_url",
        ]),
        postedAt,
        // ig has shipped this count under four names. play_count is the reel
        // plays, view_count is the older video views, both are "views" to a brand.
        views:
          pickNumber(item, [
            "play_count",
            "ig_play_count",
            "view_count",
            "video_view_count",
            "video_play_count",
          ]) ?? 0,
        likes: pickNumber(item, ["like_count", "edge_liked_by.count"]) ?? 0,
        comments: pickNumber(item, ["comment_count", "edge_media_to_comment.count"]) ?? 0,
        shares: pickNumber(item, ["reshare_count", "share_count"]) ?? 0,
      });
    }

    if (reachedHorizon) break;
    const next = pickString(res, ["paging_info.max_id", "next_max_id", "data.next_max_id"]);
    const more = pickNumber(res, ["paging_info.more_available"]);
    if (!next || next === maxId || more === 0) break;
    maxId = next;
  }

  return { platformAccountId: pk, videos, apiCalls: calls };
}

// ----------------------------------------------------------- scrapecreators

/**
 * The metered path, and the one most deploys actually run on.
 *
 * It reuses the profile scraper's client, normalisers and ledger rather than
 * speaking to scrapecreators a second way. Those endpoints already answer
 * exactly the question this layer asks — one request, one page of a profile,
 * view counts in the body — so a second client would be a second set of field
 * names to keep in step with a provider that renames them.
 *
 * Two rails, both of them in front of the money:
 *
 * - **No ledger, no calls.** `api_usage_events` is the only record of what this
 *   costs, and the nightly cron spending credits with nothing writing them down
 *   is worse than the same mistake made by hand. Without a service client it
 *   refuses rather than runs blind, the same rule `scrapeProfilePage` follows.
 * - **Each source has its own ceiling.** The person's daily cap covers what
 *   they clicked (the button and the tools); the cron gets a monthly per-account
 *   budget instead, plus a higher balance floor so it stops spending before they
 *   do. A cap the cron could eat is a promise broken by a background job. Every
 *   refusal surfaces as the account's own `last_sync_error`, so it reads as "why
 *   is this account stale" rather than vanishing into a cron log.
 *
 * Ids are taken from the canonical url parser rather than from the provider's
 * own post id, so a video the sync finds and the same video pasted into the
 * add-by-link box collide on one `platform_video_id` and merge. Instagram is why
 * that matters: this endpoint's id is the media pk and every url in the product
 * is keyed on the shortcode.
 */
const SC_MAX_PAGES = 4;
/**
 * Facebook returns ten reels a page where tiktok returns thirty five, so the
 * shared budget of four would cap a facebook account at forty reels and
 * under-read any page with a back catalogue on its first pass. Six is sixty.
 * The horizon still ends the walk early for every account whose rules have
 * closed, so the higher ceiling costs nothing in the common case.
 */
const SC_MAX_PAGES_FACEBOOK = 6;

async function fetchScrapeCreators(
  platform: Platform,
  handle: string,
  opts: FetchOptions
): Promise<AccountFeed> {
  if (!hasScrapeKey()) throw new ProviderUnavailable("SCRAPECREATORS_API_KEY is not set");

  const userId = opts.userId ?? null;
  if (!userId) throw new ProviderUnavailable("no account owner to bill the scrape to");
  if (!createServiceClient()) {
    throw new ProviderUnavailable("usage logging is not set up, so scraping is switched off");
  }

  const source = opts.source ?? "sync";

  // the cron no longer counts against the person's daily cap, so it is checked
  // only for the button. see `creditsUsedToday`.
  if (source === "manual") {
    const cap = await dailyCapFor(userId);
    if (cap != null && (await creditsUsedToday(userId)) >= cap) {
      throw new Error("today's scraping limit is used up, it resets at midnight utc");
    }
  }

  // what is left on the provider account, and what the cron is allowed to have
  // spent this month. both refuse this account rather than the run: the message
  // lands on `deal_accounts.last_sync_error`, which is where somebody looking at
  // a stale number is already looking.
  const floor = await balanceFloorError(source);
  if (floor) throw new Error(floor);

  if (source === "sync") {
    const overBudget = await syncBudgetError(userId);
    if (overBudget) throw new Error(overBudget);
  }

  const since = cutoff(opts.horizonDays);
  const maxPages =
    opts.maxPages ?? (platform === "facebook" ? SC_MAX_PAGES_FACEBOOK : SC_MAX_PAGES);
  const channelId = platform === "youtube" && opts.accountId?.startsWith("UC") ? opts.accountId : null;

  const videos: FetchedVideo[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let calls = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const result =
      platform === "tiktok"
        ? await fetchTiktokVideos({ handle, cursor })
        : platform === "instagram"
          ? await fetchInstagramReels({ handle, cursor })
          : platform === "facebook"
            ? await fetchFacebookReels({ pageUrl: profileUrl("facebook", handle), cursor })
            : await fetchYoutubeShorts({ handle, channelId, cursor });

    calls += 1;

    if (!result.ok) {
      await logUsage({
        userId,
        userEmail: null,
        endpoint: result.endpoint,
        platform,
        targetId: opts.targetId ?? null,
        creditsCharged: 0,
        creditsRemaining: null,
        cached: false,
        ok: false,
        statusCode: result.status,
        error: result.error,
        durationMs: result.durationMs,
        source,
      });
      // a page that fails after earlier pages landed keeps what it already has:
      // a partial read is a real reading, and throwing it away costs the credits
      // twice. only a first-page failure is a failed sync.
      if (page === 0) throw new Error(`${platform}: ${result.error}`);
      break;
    }

    const parsed: ScrapePage =
      platform === "tiktok"
        ? normalizeTiktok(result.body)
        : platform === "instagram"
          ? normalizeInstagram(result.body)
          : platform === "facebook"
            ? normalizeFacebook(result.body)
            : normalizeYoutube(result.body);

    await logUsage({
      userId,
      userEmail: null,
      endpoint: result.endpoint,
      platform,
      targetId: opts.targetId ?? null,
      creditsCharged: parsed.creditsCharged,
      creditsRemaining: parsed.creditsRemaining,
      cached: parsed.creditsCharged === 0,
      ok: true,
      statusCode: result.status,
      error: null,
      durationMs: result.durationMs,
      source,
    });

    let reachedHorizon = false;
    for (const post of parsed.posts) {
      const canonical = parsePostUrl(post.postUrl);
      const id = canonical?.videoId ?? post.platformPostId;
      if (!id || seen.has(id)) continue;

      if (post.postedAt && new Date(post.postedAt).getTime() < since) {
        reachedHorizon = true;
        continue;
      }

      seen.add(id);
      videos.push({
        platformVideoId: id,
        url: canonical?.canonicalUrl ?? post.postUrl,
        caption: post.title,
        thumbnailUrl: post.thumbnailUrl,
        postedAt: post.postedAt,
        // null upstream means "the platform did not say", which is not the same
        // as zero — but the videos table and the bonus math are integers, and
        // treating silence as zero is what every provider here already does.
        views: post.views ?? 0,
        likes: post.likes ?? 0,
        comments: post.comments ?? 0,
        shares: post.shares ?? 0,
      });
    }

    // instagram hands back a max_id on the last page as well as every page
    // before it, so `hasMore` alone spends one extra credit on an empty page for
    // every small account, every night. an empty page is the end of the account.
    if (parsed.posts.length === 0) break;
    if (reachedHorizon || !parsed.hasMore || !parsed.nextCursor) break;
    cursor = parsed.nextCursor;
  }

  return {
    // youtube is the only one of the three whose stable id is worth caching: it
    // saves the handle resolve on the next run. tiktok's secUid and instagram's
    // pk are not on these responses at all.
    platformAccountId: channelId,
    videos,
    apiCalls: calls,
  };
}

// ------------------------------------------------------------------ dispatch

type Json = unknown;

/**
 * Which provider answers for a platform, in order of preference.
 *
 * Cheapest first, always. YouTube's official Data API is free and effectively
 * unlimited for this workload, so it wins whenever its key exists. RapidAPI is
 * flat rate, so it beats a per-credit provider on the other two. scrapecreators
 * is metered and therefore last — and, with none of the other keys set, it is
 * what every deploy today actually runs on.
 *
 * A provider whose key is missing is skipped. A provider that HAS its key and
 * fails is the answer: the error propagates instead of falling through, because
 * retrying the same read against a second provider bills twice for one number.
 */
const CHAIN: Record<Platform, { key: () => boolean; fetch: Fetcher }[]> = {
  youtube: [
    { key: () => Boolean(YT_KEY()), fetch: fetchYouTube },
    { key: hasScrapeKey, fetch: (h, o) => fetchScrapeCreators("youtube", h, o) },
  ],
  tiktok: [
    { key: () => Boolean(RAPID_KEY()), fetch: fetchTikTok },
    { key: hasScrapeKey, fetch: (h, o) => fetchScrapeCreators("tiktok", h, o) },
  ],
  instagram: [
    { key: () => Boolean(RAPID_KEY()), fetch: fetchInstagram },
    { key: hasScrapeKey, fetch: (h, o) => fetchScrapeCreators("instagram", h, o) },
  ],
  facebook: [
    // one rung, not two: rapidapi is not subscribed for facebook. the sister
    // project's `facebook-scraper3` client is the flat-rate rung that goes in
    // front of this one if that ever changes, exactly where rapidapi already
    // sits for tiktok and instagram.
    { key: hasScrapeKey, fetch: (h, o) => fetchScrapeCreators("facebook", h, o) },
  ],
};

type Fetcher = (handle: string, opts: FetchOptions) => Promise<AccountFeed>;

export function fetchAccountFeed(
  platform: Platform,
  handle: string,
  opts: FetchOptions
): Promise<AccountFeed> {
  const pick = CHAIN[platform].find((p) => p.key());
  if (!pick) {
    throw new ProviderUnavailable(
      `no ${platform} key is set (SCRAPECREATORS_API_KEY covers every platform here)`
    );
  }
  return pick.fetch(handle, opts);
}

/** Which platforms can actually be pulled with the keys this deploy has. */
export function availablePlatforms(): Record<Platform, boolean> {
  const out = {} as Record<Platform, boolean>;
  for (const platform of Object.keys(CHAIN) as Platform[]) {
    out[platform] = CHAIN[platform].some((p) => p.key());
  }
  return out;
}
