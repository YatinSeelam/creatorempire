/**
 * One input box, three platforms, no platform picker. Whatever a person pastes
 * has to come out the other side as (platform, handle) or nothing at all.
 *
 * Why not reuse `lib/ingest/urls.ts`: that file answers "which video is this",
 * and it needs the caller to already know the platform for `parseHandle`. This
 * one answers "which account is this" from the url alone, which is a different
 * question with a different set of edge cases.
 *
 * The rule everywhere below: guess only when the url actually says. A wrong
 * guess costs a credit and shows a stranger's posts, so silence beats a hunch.
 */

import type { DetectedProfile } from "./types";

/** Parses with or without a scheme. Returns null rather than throwing, because
 *  the input is a paste box and half of what lands in it is not a url. */
function toUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

/** Handles are ascii on all three platforms. Anything else is somebody pasting
 *  a search result or a localised path segment. */
const HANDLE = /^[A-Za-z0-9._-]{1,100}$/;

/** A youtube channel id: literal UC then 22 url-safe characters. Checked rather
 *  than assumed, so `/channel/whatever` does not go out as a channelId and come
 *  back 404 having cost a credit. */
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

/** Path segments instagram owns. None of them is ever a person, and treating
 *  `instagram.com/explore` as the account "explore" is exactly the kind of
 *  confident wrong answer that burns credits. */
const IG_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "tv",
  "stories",
  "explore",
  "accounts",
  "direct",
  "about",
  "developer",
  "legal",
  "privacy",
  "terms",
  "s",
  "web",
  "challenge",
  "emails",
  "session",
  "your_activity",
]);

/** Path segments facebook owns. Same job as IG_RESERVED: silence beats a hunch,
 *  because a wrong guess costs a credit and shows a stranger's posts. */
const FB_RESERVED = new Set([
  "reel",
  "reels",
  "watch",
  "share",
  "video",
  "videos",
  "photo",
  "photos",
  "groups",
  "pages",
  "events",
  "marketplace",
  "story.php",
  "login",
  "help",
  "policies",
]);

function tiktok(handle: string): DetectedProfile {
  return {
    platform: "tiktok",
    handle,
    channelId: null,
    profileUrl: `https://www.tiktok.com/@${handle}`,
  };
}

function instagram(handle: string): DetectedProfile {
  return {
    platform: "instagram",
    handle,
    channelId: null,
    profileUrl: `https://www.instagram.com/${handle}/`,
  };
}

function youtube(handle: string, channelId: string | null): DetectedProfile {
  return {
    platform: "youtube",
    handle,
    channelId,
    profileUrl: channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : `https://www.youtube.com/@${handle}`,
  };
}

function facebook(handle: string): DetectedProfile {
  return {
    platform: "facebook",
    handle,
    channelId: null,
    profileUrl: `https://www.facebook.com/${handle}`,
  };
}

/**
 * A pasted profile url to the account behind it, or null.
 *
 * A post url resolves to its author's profile on purpose: somebody who pastes
 * `tiktok.com/@x/video/123` meant the account, and making them go find the
 * profile link is friction with no upside. That only works where the author is
 * written into the path. A bare `instagram.com/reel/abc` carries no handle at
 * all, so it returns null instead of a network hop nobody asked for.
 */
export function detectProfile(raw: string): DetectedProfile | null {
  const url = toUrl(raw);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  // query strings are tracking junk on almost every one of these urls, so the
  // path is what gets read. facebook's /profile.php?id= is the one exception,
  // and it says so where it reads it.
  const segments = url.pathname.split("/").filter(Boolean);

  // ------------------------------------------------------------------ tiktok
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    // the handle is wherever the @ is: /@x, /@x/video/123, /@x/live all give it
    // up. a vm.tiktok.com short link does not, and resolving it is a redirect
    // hop, so it is a null here rather than a surprise fetch.
    const at = segments.find((s) => s.startsWith("@"))?.slice(1) ?? "";
    if (!HANDLE.test(at)) return null;
    return tiktok(at.toLowerCase());
  }

  // --------------------------------------------------------------- instagram
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const first = segments[0]?.replace(/^@+/, "") ?? "";
    // /{handle}/reel/{code} and /{handle}/reels both start with the account, so
    // the same first-segment read covers profile urls and post urls together.
    if (!first || IG_RESERVED.has(first.toLowerCase())) return null;
    if (!HANDLE.test(first)) return null;
    return instagram(first.toLowerCase());
  }

  // ----------------------------------------------------------------- youtube
  if (host === "youtu.be") {
    // youtu.be is a video shortener, so it is only a profile when somebody has
    // typed an @handle into it by hand.
    const first = segments[0] ?? "";
    if (!first.startsWith("@")) return null;
    const handle = first.slice(1);
    return HANDLE.test(handle) ? youtube(handle.toLowerCase(), null) : null;
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const at = segments.find((s) => s.startsWith("@"))?.slice(1);
    if (at) return HANDLE.test(at) ? youtube(at.toLowerCase(), null) : null;

    const kind = segments[0]?.toLowerCase();
    const name = segments[1] ?? "";

    if (kind === "channel") {
      if (!CHANNEL_ID.test(name)) return null;
      // the id goes out as channelId because the api will not take it as a
      // handle. it is also mirrored into `handle` lowercased so the (platform,
      // handle) unique key on scrape_targets still lands on one row per
      // account, whichever url shape the person happened to paste.
      return youtube(name.toLowerCase(), name);
    }

    if (kind === "c" || kind === "user") {
      return HANDLE.test(name) ? youtube(name.toLowerCase(), null) : null;
    }

    // /watch?v=, /shorts/{id}, /playlist and friends name a video, not an
    // account, and there is no author in the path to fall back on.
    return null;
  }

  // ---------------------------------------------------------------- facebook
  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com") {
    // a page with no vanity url is /profile.php?id=1234. that numeric id is the
    // page and facebook.com/1234 resolves to it, so it is a handle here.
    if (url.pathname.replace(/\/+$/, "") === "/profile.php") {
      const id = url.searchParams.get("id") ?? "";
      return /^\d+$/.test(id) ? facebook(id) : null;
    }

    const first = segments[0]?.replace(/^@+/, "") ?? "";
    // /{page}/videos/{id} starts with the account, so one first-segment read
    // covers page urls and post urls together, the same way instagram's does.
    if (!first || FB_RESERVED.has(first.toLowerCase())) return null;
    if (!HANDLE.test(first)) return null;
    return facebook(first.toLowerCase());
  }

  return null;
}
