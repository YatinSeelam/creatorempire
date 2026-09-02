/**
 * Pulling a clip off a platform and into our own storage.
 *
 * The alternative was the platform's embed, and the embed is not a player, it
 * is a card: an avatar, a "View profile" button, the clip letterboxed in the
 * middle, and a "View more on Instagram" bar under it. On a portfolio that is
 * somebody else's branding wrapped around your work, sitting between a brand
 * and the thing they came to watch. Cropping it down to the video is possible
 * and was tried; it is a pile of pixel constants that break the day either
 * platform reflows its card.
 *
 * So a link is resolved to the actual file once, on demand, and the file is
 * copied into the portfolio bucket. From then on it is an mp4 we host, playing
 * in a plain `<video>` with our own controls, and it is identical in every way
 * to a clip the creator uploaded by hand — same bucket, same path shape, same
 * two fields on the document. Nothing downstream knows the difference.
 *
 * The copy is the point, not a shortcut. Both platforms hand back signed cdn
 * urls that expire in hours, so storing one and pointing at it would produce a
 * portfolio that plays today and 403s next week.
 *
 * One credit per import, on the same ledger as the profile scraper, so the cost
 * of this shows up in the same place as everything else. It is a button a
 * creator presses, never something that happens on paste, because the credits
 * are finite and a portfolio is edited far more often than it is filled in.
 *
 * Server only: it reads SCRAPECREATORS_API_KEY.
 */

import { hasApifyToken, mediaFromItem, runActor } from "@/lib/apify";
import { fetchInstagramPost, fetchTiktokPost, SC_ENDPOINT } from "@/lib/scrape/scrapecreators";
import { logUsage } from "@/lib/scrape/usage";
import type { ClipSource } from "@/lib/portfolio-embed";
import { capBytes } from "@/lib/upload-limits";

export { importable } from "@/lib/portfolio-embed";

/** 60MB, clamped to whatever storage will actually accept, which is the same
 *  pair of numbers lib/portfolio-upload.ts enforces on a browser upload. A UGC
 *  clip is single-digit megabytes; anything at this size is not one. */
const MAX_BYTES = capBytes(60 * 1024 * 1024);

export type ClipMedia = {
  /** a signed cdn url, live for hours. download it, do not store it. */
  videoUrl: string;
  /** the platform's own cover, same warning. "" when it has none. */
  posterUrl: string;
};

type Json = Record<string, unknown>;

const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});

/** the first usable string in a `url_list`, which is how every tiktok media
 *  field is shaped: several cdn mirrors of the same file. */
function firstUrl(v: unknown): string {
  const list = obj(v).url_list;
  if (!Array.isArray(list)) return "";
  const hit = list.find((u) => typeof u === "string" && u.startsWith("https"));
  return typeof hit === "string" ? hit : "";
}

/**
 * Ask the provider for the file behind a post.
 *
 * Both shapes are read defensively and neither is trusted to be there: a
 * private account, a deleted post and a photo carousel all answer 200 with a
 * body that simply has no video in it, and that is a sentence for the creator
 * rather than a thrown error.
 */
export async function resolveClipMedia(
  source: ClipSource,
  who: { userId: string; email: string | null }
): Promise<{ ok: true; media: ClipMedia } | { ok: false; error: string }> {
  // YouTube has no scrapecreators single-video endpoint that returns a file, so
  // it is Apify or nothing. The other two try scrapecreators first because it
  // is one billed call with a known shape, and fall back to Apify when it comes
  // back empty — an actor run is slower and costs more, so it is the second
  // answer rather than the first.
  if (source.platform === "youtube") {
    const viaApify = await resolveWithApify(source);
    return viaApify.ok
      ? viaApify
      : {
          ok: false,
          error: hasApifyToken()
            ? "That YouTube video could not be imported."
            : "YouTube imports need APIFY_TOKEN set on the server.",
        };
  }

  const res =
    source.platform === "instagram"
      ? await fetchInstagramPost(source.url)
      : await fetchTiktokPost(source.url);

  const endpoint =
    source.platform === "instagram" ? SC_ENDPOINT.instagramPost : SC_ENDPOINT.tiktokPost;

  const body = res.ok ? obj(res.body) : {};

  // logged before anything is decided: the credit is spent either way, and a
  // wall of failures here is worth seeing on the usage page.
  await logUsage({
    userId: who.userId,
    userEmail: who.email,
    endpoint,
    platform: source.platform,
    targetId: null,
    creditsCharged: typeof body.credits_charged === "number" ? body.credits_charged : 1,
    creditsRemaining:
      typeof body.credits_remaining === "number" ? body.credits_remaining : null,
    cached: false,
    ok: res.ok,
    statusCode: res.ok ? res.status : res.status,
    error: res.ok ? null : res.error,
    durationMs: res.durationMs,
  });

  if (!res.ok) {
    return {
      ok: false,
      error:
        res.status === 404
          ? "That post could not be found. Check the link is public."
          : "Could not reach that post. Try again in a minute.",
    };
  }

  let media: ClipMedia;

  if (source.platform === "instagram") {
    const m = obj(obj(body.data).xdt_shortcode_media);
    media = {
      videoUrl: typeof m.video_url === "string" ? m.video_url : "",
      posterUrl: typeof m.display_url === "string" ? m.display_url : "",
    };
  } else {
    const video = obj(obj(body.aweme_detail).video);
    media = {
      // play_addr before download_addr: the download one carries the burned-in
      // watermark, and a portfolio wants the clean cut.
      videoUrl: firstUrl(video.play_addr) || firstUrl(video.play_addr_h264),
      posterUrl: firstUrl(video.origin_cover) || firstUrl(video.cover),
    };
  }

  if (!media.videoUrl) {
    // one more try on a different provider before telling a creator their own
    // post cannot be imported. the shapes above go stale without warning.
    const viaApify = await resolveWithApify(source);
    if (viaApify.ok) return viaApify;

    return {
      ok: false,
      error:
        "No video on that post. Photo posts and private accounts cannot be imported.",
    };
  }

  return { ok: true, media };
}

/** One actor run, reduced to the same two urls. Silent when Apify is not
 *  configured, because it is a fallback for two of the three platforms and a
 *  deploy without the token should still import TikTok and Instagram. */
async function resolveWithApify(
  source: ClipSource
): Promise<{ ok: true; media: ClipMedia } | { ok: false }> {
  if (!hasApifyToken()) return { ok: false };

  const run = await runActor(source.platform, source.url);
  if (!run.ok) return { ok: false };

  for (const item of run.items) {
    const media = mediaFromItem(item);
    if (media.videoUrl) return { ok: true, media };
  }
  return { ok: false };
}

export type Downloaded = {
  bytes: ArrayBuffer;
  contentType: string;
};

/**
 * What may be stored, by what we asked for — never by what the cdn said.
 *
 * The bucket is public and served from our own origin, so a stored object's
 * content type is a stored XSS primitive: a cdn answering `text/html` or
 * `image/svg+xml` to a request we made for a clip would get that served back
 * to every visitor of the portfolio under our domain. The upstream header is
 * only ever used to pick between members of this list, and anything outside it
 * falls back to the type we were expecting in the first place.
 */
const ALLOWED_TYPES: Record<"video" | "poster", { types: string[]; fallback: string }> = {
  video: { types: ["video/mp4", "video/webm", "video/quicktime"], fallback: "video/mp4" },
  poster: { types: ["image/jpeg", "image/png", "image/webp"], fallback: "image/jpeg" },
};

/**
 * Pull a signed cdn url down to bytes.
 *
 * `content-length` is checked before the body is read, and the read is capped
 * again afterwards, because a cdn is free to omit the header and a portfolio
 * bucket is not the place to find out how big a file was by storing it.
 */
export async function download(
  url: string,
  kind: "video" | "poster"
): Promise<Downloaded | null> {
  // the cdn urls come out of the provider's json, but a url is a url: a
  // redirect or a poisoned field must not turn this into a fetcher of
  // arbitrary schemes or of our own network.
  if (!/^https:\/\//i.test(url)) return null;

  let res: Response;
  try {
    res = await fetch(url, {
      // both cdns serve a 403 to a request with no browser-shaped headers
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        accept: "*/*",
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return null;

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

  // The upstream header only gets to choose between the types we were already
  // willing to store. It never gets to name one, because the bucket is public
  // and served from our origin, so `text/html` or `image/svg+xml` coming back
  // from a cdn would be a stored XSS on every visitor of the portfolio.
  const rule = ALLOWED_TYPES[kind];
  const declaredType = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const contentType =
    declaredType && rule.types.includes(declaredType) ? declaredType : rule.fallback;

  return { bytes, contentType };
}

