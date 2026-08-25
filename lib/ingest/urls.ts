/**
 * URL → (platform, video id, handle). Shared by the paste-a-link form and the
 * sync layer, so a video added by hand and the same video found by a sync
 * collide on the same `platform_video_id` and merge instead of doubling up.
 *
 * Short links (vm.tiktok.com, youtu.be) are handled where they can be read off
 * the path. A tiktok share link whose id is only resolvable by following a
 * redirect returns `needsResolve`, and the caller decides whether one network
 * hop is worth it.
 */

import type { Platform } from "@/lib/deals";

export type ParsedUrl = {
  platform: Platform;
  /** null when the id can only be had by following a redirect. */
  videoId: string | null;
  handle: string | null;
  /** the stable form of the url, so the db never holds two spellings of one video. */
  canonicalUrl: string;
  needsResolve: boolean;
};

/** Path segments facebook owns. None of them is ever a page, and reading
 *  `facebook.com/watch` as the page "watch" is a confident wrong answer that
 *  points the scraper at nothing. */
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
  "profile.php",
  "story.php",
  "login",
  "help",
  "policies",
]);

function hostOf(raw: string): URL | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    return new URL(text.startsWith("http") ? text : `https://${text}`);
  } catch {
    return null;
  }
}

export function parsePostUrl(raw: string): ParsedUrl | null {
  const url = hostOf(raw);
  if (!url) return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  // ---------------------------------------------------------------- tiktok
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const handle = segments.find((s) => s.startsWith("@"))?.slice(1) ?? null;
    const videoAt = segments.indexOf("video");
    const id = videoAt >= 0 ? segments[videoAt + 1] : null;

    if (id && /^\d+$/.test(id)) {
      return {
        platform: "tiktok",
        videoId: id,
        handle,
        canonicalUrl: `https://www.tiktok.com/@${handle ?? "unknown"}/video/${id}`,
        needsResolve: false,
      };
    }

    // vm.tiktok.com/XXXX and tiktok.com/t/XXXX are redirects to the real url.
    const shortCode = host.startsWith("vm.") ? segments[0] : segments[0] === "t" ? segments[1] : null;
    if (shortCode) {
      return {
        platform: "tiktok",
        videoId: null,
        handle,
        canonicalUrl: url.toString(),
        needsResolve: true,
      };
    }
    return null;
  }

  // ------------------------------------------------------------- instagram
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    const kinds = new Set(["p", "reel", "reels", "tv"]);
    const at = segments.findIndex((s) => kinds.has(s));
    const code = at >= 0 ? segments[at + 1] : null;
    if (!code) return null;

    // a url can be /{handle}/reel/{code}, which is where the handle hides.
    const handle = at > 0 ? segments[0] : null;

    return {
      platform: "instagram",
      videoId: code,
      handle,
      canonicalUrl: `https://www.instagram.com/reel/${code}/`,
      needsResolve: false,
    };
  }

  // --------------------------------------------------------------- youtube
  if (host === "youtu.be") {
    const id = segments[0];
    return id
      ? {
          platform: "youtube",
          videoId: id,
          handle: null,
          canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
          needsResolve: false,
        }
      : null;
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    const shortsAt = segments.indexOf("shorts");
    const id = shortsAt >= 0 ? segments[shortsAt + 1] : url.searchParams.get("v");
    const handle = segments.find((s) => s.startsWith("@"))?.slice(1) ?? null;
    return id
      ? {
          platform: "youtube",
          videoId: id,
          handle,
          canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
          needsResolve: false,
        }
      : null;
  }

  // -------------------------------------------------------------- facebook
  if (host === "fb.watch") {
    // a share shortener. the reel id only exists on the far side of a redirect.
    return segments[0]
      ? {
          platform: "facebook",
          videoId: null,
          handle: null,
          canonicalUrl: url.toString(),
          needsResolve: true,
        }
      : null;
  }

  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com") {
    // the three shapes a facebook video url comes in, all carrying the same
    // numeric id: /reel/{id}, /{page}/videos/{id}, /watch/?v={id}.
    const after = (segment: string): string | null => {
      const at = segments.indexOf(segment);
      return at >= 0 ? (segments[at + 1] ?? null) : null;
    };
    const id = after("reel") ?? after("videos") ?? after("video") ?? url.searchParams.get("v");

    if (id && /^\d+$/.test(id)) {
      // only the /{page}/videos/{id} shape carries the page name.
      const owner =
        segments[1] === "videos" || segments[1] === "video" ? (segments[0] ?? null) : null;
      return {
        platform: "facebook",
        videoId: id,
        handle: owner && !FB_RESERVED.has(owner.toLowerCase()) ? owner : null,
        canonicalUrl: `https://www.facebook.com/reel/${id}`,
        needsResolve: false,
      };
    }

    // /share/r/{code} and /share/v/{code} redirect to the real reel url.
    if (segments[0] === "share" && segments[2]) {
      return {
        platform: "facebook",
        videoId: null,
        handle: null,
        canonicalUrl: url.toString(),
        needsResolve: true,
      };
    }

    return null;
  }

  return null;
}

/** Follows a vm.tiktok.com short link far enough to read the real video id. */
export async function resolveShortLink(raw: string): Promise<ParsedUrl | null> {
  try {
    const res = await fetch(raw, {
      redirect: "follow",
      method: "HEAD",
      signal: AbortSignal.timeout(8_000),
    });
    return parsePostUrl(res.url);
  } catch {
    return null;
  }
}

/** The link a creator hands over. Used to seed an account from a profile url. */
export function parseHandle(raw: string, platform: Platform): string | null {
  const text = raw.trim().replace(/^@+/, "");
  if (!text) return null;

  // A slash is the only honest signal that this is a link. A dot is not:
  // "candle.official" is an ordinary tiktok handle, and treating it as a
  // hostname parsed it to a url with an empty path and rejected the whole
  // thing — which is to say every dotted handle, including the one the form
  // shows as its own placeholder.
  const url = text.includes("/") ? hostOf(text) : null;
  if (!url) return /^[A-Za-z0-9._-]{1,64}$/.test(text) ? text : null;

  const segments = url.pathname.split("/").filter(Boolean);

  if (platform === "facebook") {
    // /profile.php?id=1234 is a page with no vanity url, and that numeric id is
    // the page. this is the one place a query string is worth reading.
    const id = url.searchParams.get("id");
    if (url.pathname.replace(/\/+$/, "") === "/profile.php" && id && /^\d+$/.test(id)) {
      return id;
    }
    const owner = segments[0]?.replace(/^@+/, "") ?? null;
    if (!owner || FB_RESERVED.has(owner.toLowerCase())) return null;
    return /^[A-Za-z0-9._-]{1,64}$/.test(owner) ? owner : null;
  }

  if (platform === "youtube") {
    // @handle, /c/name, /channel/UC..., /user/name — all of them are the account.
    const at = segments.find((s) => s.startsWith("@"));
    if (at) return at.slice(1);
    const known = ["channel", "c", "user"];
    const idx = segments.findIndex((s) => known.includes(s));
    return idx >= 0 ? (segments[idx + 1] ?? null) : (segments[0] ?? null);
  }

  const first = segments[0]?.replace(/^@+/, "") ?? null;
  return first && /^[A-Za-z0-9._-]{1,64}$/.test(first) ? first : null;
}
