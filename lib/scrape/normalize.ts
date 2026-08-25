/**
 * Four provider bodies to one `ScrapePage`. Everything platform-specific stops
 * here: past this file a tiktok photo post and a youtube short are the same row.
 *
 * Two habits run through the whole file, both of them scar tissue:
 *
 * 1. every field is read through `pickNumber` / `pickString` with a list of
 *    places it has been seen, never one hard path. the verified instagram
 *    response is flat where the docs say nested, and the shape a provider ships
 *    on a Tuesday is not a thing to bet a page render on.
 * 2. a field that is not there is null, never 0. the difference between "this
 *    reel got no views" and "instagram did not say" is the difference between a
 *    correct payout and an argument with a brand.
 */

import { pickArray, pickNumber, pickString } from "@/lib/ingest/http";
import type { ScrapedAuthor, ScrapedPost, ScrapePage } from "./types";

// --------------------------------------------------------------- small reads

/** One key off an object, without pretending an array or a string is one. */
function field(source: unknown, key: string): unknown {
  return source && typeof source === "object"
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

/**
 * A boolean that the provider may have spelled as a boolean, a 0/1 number or a
 * string. tiktok's `has_more` is a NUMBER, and `has_more === true` silently
 * reads false forever, which looks exactly like a profile with one page.
 */
function flag(source: unknown, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = field(source, key);
    if (value === true || value === 1 || value === "1" || value === "true") return true;
    if (value === false || value === 0 || value === "0" || value === "false") return false;
  }
  return false;
}

/** Unix seconds to iso. A missing or nonsense date stays null: an invented
 *  `posted_at` lands a video inside a bonus window it never earned. */
function unixToIso(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Youtube already sends iso, with a local offset. Re-emitting it as utc means
 *  every platform sorts against every other one without a special case. */
function isoToIso(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Milliseconds to whole seconds. tiktok's `video.duration` and youtube's
 *  `durationMs` are both ms; instagram's `video_duration` is not, and goes
 *  nowhere near this. */
function msToSeconds(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.round(ms / 1_000);
}

function secondsToSeconds(seconds: number | null): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds);
}

/** "1,680,144" to 1680144. Only for strings that are digits and commas: a
 *  "1.7M" would come out as 17 and that is worse than no number at all. */
function commaCount(raw: string | null): number | null {
  if (!raw || !/^[\d,]+$/.test(raw.trim())) return null;
  const digits = raw.replace(/,/g, "");
  return digits ? Number(digits) : null;
}

/** Both credit fields sit at the top level of every 200 body, on all three
 *  endpoints. Charged is read, never assumed: a cached hit is 0 and some calls
 *  bill more than one. */
function credits(body: unknown): Pick<ScrapePage, "creditsCharged" | "creditsRemaining"> {
  return {
    creditsCharged: pickNumber(body, ["credits_charged"]) ?? 0,
    creditsRemaining: pickNumber(body, ["credits_remaining"]),
  };
}

const NO_AUTHOR: ScrapedAuthor = {
  handle: null,
  displayName: null,
  avatarUrl: null,
  followerCount: null,
  postCount: null,
};

// ---------------------------------------------------------------------- tiktok

export function normalizeTiktok(body: unknown): ScrapePage {
  const items = pickArray(body, ["aweme_list"]);

  const author: ScrapedAuthor = items.length
    ? {
        handle: pickString(items[0], ["author.unique_id"])?.toLowerCase() ?? null,
        displayName: pickString(items[0], ["author.nickname"]),
        avatarUrl: pickString(items[0], [
          "author.avatar_medium.url_list.0",
          "author.avatar_larger.url_list.0",
          "author.avatar_thumb.url_list.0",
        ]),
        followerCount: pickNumber(items[0], ["author.follower_count"]),
        postCount: pickNumber(items[0], ["author.aweme_count"]),
      }
    : NO_AUTHOR;

  const posts: ScrapedPost[] = [];
  for (const item of items) {
    const id = pickString(item, ["aweme_id", "id"]);
    if (!id) continue;

    // `image_post_info.images` present means this is a photo carousel. it is a
    // real post with real views, so it is kept, but the ui has to be able to
    // stop calling it a video.
    const isPhotoPost = pickArray(item, ["image_post_info.images"]).length > 0;
    // lowercased to match the canonical profile url detect.ts builds, so the
    // same account never shows up spelled two ways. tiktok does not care.
    const handle =
      pickString(item, ["author.unique_id"])?.toLowerCase() ?? author.handle ?? "unknown";

    posts.push({
      platform: "tiktok",
      platformPostId: id,
      postUrl: `https://www.tiktok.com/@${handle}/${isPhotoPost ? "photo" : "video"}/${id}`,
      title: pickString(item, ["desc"]),
      thumbnailUrl: pickString(item, [
        "video.cover.url_list.0",
        "video.origin_cover.url_list.0",
        "video.dynamic_cover.url_list.0",
      ]),

      views: pickNumber(item, ["statistics.play_count"]),
      likes: pickNumber(item, ["statistics.digg_count"]),
      comments: pickNumber(item, ["statistics.comment_count"]),
      shares: pickNumber(item, ["statistics.share_count"]),
      saves: pickNumber(item, ["statistics.collect_count"]),

      // milliseconds, verified: 110059 is a 110 second video.
      durationSeconds: msToSeconds(pickNumber(item, ["video.duration"])),
      postedAt: unixToIso(pickNumber(item, ["create_time"])),

      isPinned: pickNumber(item, ["is_top"]) === 1,
      // the field is `is_ad`. `is_ads` is the one in half the docs and it does
      // not exist, so it is read second purely as insurance.
      isAd: flag(item, "is_ad", "is_ads"),
      isPhotoPost,
    });
  }

  const hasMore = flag(body, "has_more");
  // max_cursor comes back as a number (ms epoch) and has to go out as a string,
  // because the next request puts it in a query string either way.
  const cursor = pickString(body, ["max_cursor"]);

  return {
    posts,
    author,
    hasMore,
    nextCursor: hasMore && cursor && cursor !== "0" ? cursor : null,
    ...credits(body),
  };
}

// ------------------------------------------------------------------- instagram

export function normalizeInstagram(body: unknown): ScrapePage {
  const items = pickArray(body, ["items"]);

  // with `trim=true` the item is flat: `items[i].play_count`. the published
  // docs describe `items[i].media.play_count`. both are read, in that order, so
  // whichever one the provider is serving today the page still fills in.
  const author: ScrapedAuthor = items.length
    ? {
        handle:
          pickString(items[0], ["user.username", "media.user.username"])?.toLowerCase() ?? null,
        displayName: pickString(items[0], ["user.full_name", "media.user.full_name"]),
        avatarUrl: pickString(items[0], [
          "user.profile_pic_url",
          "media.user.profile_pic_url",
        ]),
        followerCount: pickNumber(items[0], [
          "user.follower_count",
          "media.user.follower_count",
        ]),
        postCount: pickNumber(items[0], ["user.media_count", "media.user.media_count"]),
      }
    : NO_AUTHOR;

  const posts: ScrapedPost[] = [];
  for (const item of items) {
    const id = pickString(item, ["id", "media.id", "pk", "media.pk"]);
    const code = pickString(item, ["code", "media.code"]);
    if (!id && !code) continue;

    posts.push({
      platform: "instagram",
      platformPostId: id ?? code!,
      postUrl: code
        ? `https://www.instagram.com/reel/${code}/`
        : `https://www.instagram.com/${author.handle ?? ""}/`,
      title: pickString(item, ["caption.text", "media.caption.text"]),
      thumbnailUrl: pickString(item, [
        "display_uri",
        "media.display_uri",
        "image_versions2.candidates.0.url",
        "media.image_versions2.candidates.0.url",
      ]),

      views: pickNumber(item, [
        "play_count",
        "media.play_count",
        "ig_play_count",
        "media.ig_play_count",
      ]),
      likes: pickNumber(item, ["like_count", "media.like_count"]),
      comments: pickNumber(item, ["comment_count", "media.comment_count"]),
      // instagram does not report either of these on this endpoint. null, not
      // zero: nobody has said the number is zero.
      shares: null,
      saves: null,

      // seconds here, unlike the other two. a float, so it is rounded.
      durationSeconds: secondsToSeconds(
        pickNumber(item, ["video_duration", "media.video_duration"])
      ),
      postedAt: unixToIso(pickNumber(item, ["taken_at", "media.taken_at"])),

      // a pinned reel carries the pinning account's id in this array.
      isPinned:
        pickArray(item, ["timeline_pinned_user_ids", "media.timeline_pinned_user_ids"]).length > 0,
      isAd: flag(item, "is_ad"),
      isPhotoPost: false,
    });
  }

  // an absent or empty max_id is the end of the account, not an error.
  const cursor = pickString(body, ["max_id"]);

  return {
    posts,
    author,
    hasMore: Boolean(cursor),
    nextCursor: cursor || null,
    ...credits(body),
  };
}

// --------------------------------------------------------------------- youtube

/** "name", "@name" and "/@name" all mean the same account. Anything else is
 *  not a handle and comes back null rather than half a url path. */
function youtubeHandle(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const at = text.lastIndexOf("@");
  const candidate = at >= 0 ? text.slice(at + 1) : text;
  return /^[A-Za-z0-9._-]{1,100}$/.test(candidate) ? candidate.toLowerCase() : null;
}

export function normalizeYoutube(body: unknown): ScrapePage {
  // the shorts endpoint puts everything in `shorts[]` and leaves `videos[]`
  // empty. `videos` is read as a fallback so the same normaliser survives being
  // pointed at the long form endpoint later without a rewrite.
  const shorts = pickArray(body, ["shorts"]);
  const items = shorts.length ? shorts : pickArray(body, ["videos"]);

  const author: ScrapedAuthor = {
    // the handle may arrive bare ("name"), with the at ("@name") or as a path
    // ("/@name"). only an @handle is taken from the path form: a
    // canonicalBaseUrl of "/c/Name" is a legacy vanity url, not a handle, and
    // passing it back as one produces a 404 next page.
    handle: youtubeHandle(
      pickString(body, ["channel.handle", "channels.0.handle", "channel.canonicalBaseUrl"])
    ),
    displayName: pickString(body, ["channel.name", "channel.title", "channels.0.name"]),
    avatarUrl: pickString(body, ["channel.avatar", "channel.thumbnail", "channels.0.thumbnail"]),
    followerCount: pickNumber(body, [
      "channel.subscriberCountInt",
      "channels.0.subscriberCountInt",
    ]),
    // the channel's lifetime upload count is not on this response, and the
    // profile endpoint that has it is another credit for a number no rule pays
    // on. null is the honest answer.
    postCount: null,
  };

  const posts: ScrapedPost[] = [];
  for (const item of items) {
    const id = pickString(item, ["id", "videoId"]);
    if (!id) continue;

    posts.push({
      platform: "youtube",
      platformPostId: id,
      // `url` arrives absolute already, so it is preferred over rebuilding one.
      postUrl: pickString(item, ["url"]) ?? `https://www.youtube.com/shorts/${id}`,
      title: pickString(item, ["title"]),
      thumbnailUrl: pickString(item, ["thumbnail", "thumbnails.0.url"]),

      views:
        pickNumber(item, ["viewCountInt"]) ?? commaCount(pickString(item, ["viewCountText"])),
      likes: pickNumber(item, ["likeCountInt"]),
      comments: pickNumber(item, ["commentCountInt"]),
      shares: null,
      saves: null,

      durationSeconds: msToSeconds(pickNumber(item, ["durationMs"])),
      // already iso with an offset, so it is parsed rather than multiplied.
      postedAt: isoToIso(pickString(item, ["publishDate"])),

      isPinned: false,
      isAd: false,
      isPhotoPost: false,
    });
  }

  const cursor = pickString(body, ["continuationToken"]);

  return {
    posts,
    author,
    hasMore: Boolean(cursor),
    nextCursor: cursor || null,
    ...credits(body),
  };
}

// -------------------------------------------------------------------- facebook

/**
 * Facebook reels. The thinnest of the four bodies: it carries views and nothing
 * else about how a post did.
 *
 * Two things worth knowing before changing anything here.
 *
 * `video_id` is the id, not `post_id`. They are different numbers on the same
 * reel, and `video_id` is the one in the url, which is what `parsePostUrl`
 * canonicalises to. Keying on `post_id` would file the same reel twice.
 *
 * Likes, comments, shares and saves are not in this response at all, so they go
 * out null rather than 0. Nothing in the schema pays on them, and claiming a
 * reel got zero likes when facebook simply did not say is the exact lie the
 * null-not-zero rule exists to prevent.
 */
export function normalizeFacebook(body: unknown): ScrapePage {
  const items = pickArray(body, ["reels"]);

  const author: ScrapedAuthor = items.length
    ? {
        // the author block carries a page url, and the slug on the end of it is
        // the handle everything else in the product is keyed on.
        handle:
          pickString(items[0], ["author.url"])
            ?.split("?")[0]
            .split("/")
            .filter(Boolean)
            .pop()
            ?.toLowerCase() ?? null,
        displayName: pickString(items[0], ["author.name"]),
        avatarUrl: pickString(items[0], [
          "author.image",
          "author.profile_picture_url",
          "author.profile_pic_url",
        ]),
        // this endpoint reports neither, and the profile endpoint that does is
        // another credit for a number nobody is paid on.
        followerCount: null,
        postCount: null,
      }
    : NO_AUTHOR;

  const posts: ScrapedPost[] = [];
  for (const item of items) {
    const id = pickString(item, ["video_id"]);
    if (!id) continue;

    posts.push({
      platform: "facebook",
      platformPostId: id,
      postUrl: pickString(item, ["url"]) ?? `https://www.facebook.com/reel/${id}`,
      title: pickString(item, ["description"]),
      thumbnailUrl: pickString(item, ["thumbnail"]),

      views: pickNumber(item, ["view_count", "play_count"]),
      likes: null,
      comments: null,
      shares: null,
      saves: null,

      durationSeconds: msToSeconds(pickNumber(item, ["play_time_in_ms"])),
      // already iso, re-emitted utc so every platform sorts against every other.
      postedAt: isoToIso(pickString(item, ["creation_time"])),

      isPinned: false,
      isAd: false,
    });
  }

  // two tokens, joined into the one opaque cursor the type carries. this
  // endpoint sends no has_more, so "there is a next page" is "it gave us both".
  const nextPageId = pickString(body, ["next_page_id", "paging.next_page_id"]);
  const cursor = pickString(body, ["cursor", "paging.cursor"]);
  const hasMore = Boolean(nextPageId && cursor);

  return {
    posts,
    author,
    hasMore,
    nextCursor: hasMore ? `${nextPageId}|${cursor}` : null,
    ...credits(body),
  };
}
