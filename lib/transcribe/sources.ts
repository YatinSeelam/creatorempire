/**
 * One pasted link → the video, its cover, and the words in it.
 *
 * This is the single-post twin of lib/ingest/providers.ts, and it deliberately
 * reuses that file's hosts and its one RAPIDAPI_KEY rather than introducing a
 * second billing relationship for the same two platforms.
 *
 * Where the transcript comes from is per platform, and it is not a detail:
 *
 * - youtube already has one. `youtube-transcript3` reads the captions youtube
 *   itself published, which costs one request and no audio processing. A video
 *   with captions off returns nothing and there is no fallback here, because
 *   speech-to-text on a 20 minute upload is a different cost shape entirely.
 * - tiktok and instagram do not, so we hand deepgram the mp4 url the scrape
 *   returned. Deepgram fetches it itself, which is why the url has to be one a
 *   third party can actually read (see the tiktok note below).
 *
 * Everything here returns null rather than throwing on a provider problem. The
 * caller turns that into one sentence a creator can act on.
 */

import { hasApifyToken } from "@/lib/apify";
import type { Platform } from "@/lib/deals";
import { getJson, pickString, withRetry, Spacer } from "@/lib/ingest/http";
import { parsePostUrl, resolveShortLink, type ParsedUrl } from "@/lib/ingest/urls";
import { apifyFetchPost } from "./apify";
import type { Who } from "./media";

const RAPID_KEY = () => process.env.RAPIDAPI_KEY ?? "";
const YT_KEY = () => process.env.YOUTUBE_API_KEY ?? "";

const IG_HOST = "instagram-api-fast-reliable-data-scraper.p.rapidapi.com";
const TT_HOST = "tiktok-api23.p.rapidapi.com";
const YT_TRANSCRIPT_HOST = "youtube-transcript3.p.rapidapi.com";
const YT = "https://www.googleapis.com/youtube/v3";

// A creator pasting a link is watching a spinner, so these are tighter than the
// sync's and retry once rather than three times: a provider that is down will
// still be down in two seconds, and the honest error beats the longer wait.
const TIMEOUT_MS = 15_000;
const igSpacer = new Spacer(1_150);
const ttSpacer = new Spacer(140);

function rapidHeaders(host: string): Record<string, string> {
  return { "x-rapidapi-key": RAPID_KEY(), "x-rapidapi-host": host };
}

export type ScrapedPost = {
  platform: Platform;
  /** the stable long-form url, even when a share link was pasted. */
  post_url: string;
  caption: string | null;
  creator_handle: string | null;
  /** direct mp4 a third party can fetch, or null when only the cover survived. */
  video_url: string | null;
  thumbnail_url: string | null;
  /** already-written words, when the platform publishes them. null means the
   *  caller has to send the audio somewhere. */
  transcript: string | null;
  /** the post read fine and there was simply nothing said in it. distinct from
   *  a null post, which is "we could not read that at all". */
  silent?: boolean;
};

/** Parse the pasted text, following a tiktok share redirect when it needs one. */
export async function parseAnyPostUrl(raw: string): Promise<ParsedUrl | null> {
  const parsed = parsePostUrl(raw);
  if (!parsed) return null;
  if (!parsed.needsResolve) return parsed;
  return resolveShortLink(parsed.canonicalUrl);
}

export async function fetchPost(parsed: ParsedUrl, who: Who | null): Promise<ScrapedPost | null> {
  // rapidapi first when its key exists; otherwise the apify actors, which
  // return the words directly and need no deepgram behind them.
  if (parsed.platform === "youtube") {
    if (!YT_KEY() && !RAPID_KEY() && hasApifyToken()) return apifyFetchPost(parsed, who);
    return fetchYouTubePost(parsed);
  }
  if (!RAPID_KEY() && hasApifyToken()) return apifyFetchPost(parsed, who);
  // the rapidapi path has no facebook fetcher. Without this, a facebook url
  // falls through to the tiktok branch below and gets handed a facebook id,
  // which wastes a request and tells the creator their link is private or
  // deleted. (the apify actor above does handle facebook reels.)
  if (parsed.platform === "facebook") return null;
  if (parsed.platform === "instagram") return fetchInstagramPost(parsed);
  return fetchTikTokPost(parsed);
}

// ----------------------------------------------------------------- instagram

/**
 * `/post?shortcode=` on the same host the sync's profile pull uses.
 *
 * The field lists are long because this provider returns three different
 * shapes for the same post depending on which upstream answered it. A reel
 * comes back flat, an older post comes back in graphql spelling
 * (edge_media_to_caption), and a carousel hides its clips one level down.
 */
async function fetchInstagramPost(parsed: ParsedUrl): Promise<ScrapedPost | null> {
  if (!RAPID_KEY() || !parsed.videoId) return null;

  await igSpacer.wait();
  const payload = await withRetry(
    () =>
      getJson<unknown>(
        `https://${IG_HOST}/post?shortcode=${encodeURIComponent(parsed.videoId!)}`,
        rapidHeaders(IG_HOST),
        TIMEOUT_MS
      ),
    { attempts: 2 }
  ).catch(() => null);
  if (!payload) return null;

  // the post object sits under a different root per shape, so find it first
  // and read every field relative to that.
  const post =
    ["data.xdt_shortcode_media", "data.shortcode_media", "shortcode_media", "post", "data", "result"]
      .map((path) =>
        path.split(".").reduce<unknown>(
          (node, key) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined,
          payload
        )
      )
      .find((node) => node && typeof node === "object") ?? payload;

  const video_url = pickString(post, [
    "video_url",
    "videoUrl",
    "video.url",
    "media.video_url",
    "video_versions.0.url",
    "videos.0.url",
    // carousels keep their clips per item and have no top level video.
    "carousel_media.0.video_versions.0.url",
    "edge_sidecar_to_children.edges.0.node.video_url",
  ]);
  const thumbnail_url = pickString(post, [
    "display_url",
    "displayUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "image_versions2.candidates.0.url",
    "thumbnail_src",
    "carousel_media.0.image_versions2.candidates.0.url",
  ]);

  return {
    platform: "instagram",
    post_url: parsed.canonicalUrl,
    caption: pickString(post, ["caption.text", "caption", "edge_media_to_caption.edges.0.node.text"]),
    creator_handle: pickString(post, ["owner.username", "user.username", "owner.handle"]),
    video_url,
    thumbnail_url,
    transcript: null,
  };
}

// -------------------------------------------------------------------- tiktok

/**
 * Two calls, and the second one is the whole reason this works.
 *
 * `/api/post/detail` carries the caption, cover and author, but its embedded
 * playAddr points at v16-webapp-prime.tiktok.com, which is tiktok's in-browser
 * streaming address and 403s for anyone who is not the originating session. It
 * can neither play in a <video> tag nor be fetched by deepgram. The url from
 * `/api/download/video` is served from a plain cdn host and can be read by
 * both, so it is preferred and playAddr is only a last resort.
 */
async function fetchTikTokPost(parsed: ParsedUrl): Promise<ScrapedPost | null> {
  if (!RAPID_KEY() || !parsed.videoId) return null;

  const get = async (path: string) => {
    await ttSpacer.wait();
    return withRetry(
      () => getJson<unknown>(`https://${TT_HOST}${path}`, rapidHeaders(TT_HOST), TIMEOUT_MS),
      { attempts: 2 }
    ).catch(() => null);
  };

  const [detail, download] = await Promise.all([
    get(`/api/post/detail?videoId=${encodeURIComponent(parsed.videoId)}`),
    get(`/api/download/video?url=${encodeURIComponent(parsed.canonicalUrl)}`),
  ]);

  const item = detail
    ? ((detail as Record<string, unknown>).itemInfo as Record<string, unknown> | undefined)
        ?.itemStruct
    : null;
  if (!item && !download) return null;

  const handle = pickString(item, ["author.uniqueId"]) ?? parsed.handle;
  const video_url =
    pickString(download, ["play", "data.play", "hdplay", "data.hdplay"]) ??
    pickString(download, ["play_watermark", "wmplay", "data.wmplay"]) ??
    pickString(item, ["video.playAddr", "video.downloadAddr"]);

  return {
    platform: "tiktok",
    post_url: handle
      ? `https://www.tiktok.com/@${handle}/video/${parsed.videoId}`
      : parsed.canonicalUrl,
    caption: pickString(item, ["desc"]) ?? pickString(download, ["title", "data.title"]),
    creator_handle: handle,
    video_url,
    thumbnail_url:
      pickString(item, ["video.originCover", "video.cover", "video.dynamicCover"]) ??
      pickString(download, ["cover", "data.cover", "origin_cover", "data.origin_cover"]),
    transcript: null,
  };
}

// ------------------------------------------------------------------- youtube

/**
 * Metadata off the official Data API (1 quota unit of a free 10,000 a day) and
 * the transcript off youtube's own published captions.
 *
 * video_url stays null on purpose: youtube's media urls are not playable in a
 * <video> tag by anyone but youtube, so the workspace renders the standard
 * embed iframe instead and never has an mp4 to hand deepgram.
 */
async function fetchYouTubePost(parsed: ParsedUrl): Promise<ScrapedPost | null> {
  if (!parsed.videoId) return null;

  const [meta, transcript] = await Promise.all([
    YT_KEY()
      ? withRetry(
          () =>
            getJson<unknown>(
              `${YT}/videos?part=snippet&id=${encodeURIComponent(parsed.videoId!)}&key=${YT_KEY()}`,
              {},
              TIMEOUT_MS
            ),
          { attempts: 2 }
        ).catch(() => null)
      : Promise.resolve(null),
    fetchYouTubeTranscript(parsed.videoId),
  ]);

  const found = pickString(meta, ["items.0.id"]);
  // no metadata and no words is nothing worth saving; either one alone is.
  if (!found && !transcript) return null;

  return {
    platform: "youtube",
    post_url: parsed.canonicalUrl,
    caption: pickString(meta, ["items.0.snippet.title"]),
    creator_handle: pickString(meta, ["items.0.snippet.channelTitle"]),
    video_url: null,
    thumbnail_url:
      pickString(meta, [
        "items.0.snippet.thumbnails.maxres.url",
        "items.0.snippet.thumbnails.standard.url",
        "items.0.snippet.thumbnails.high.url",
      ]) ?? `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`,
    transcript,
  };
}

/**
 * `lang=en` is not optional. Without it the provider picks whichever caption
 * track it feels like, and a video with a dozen translations comes back in one
 * nobody asked for. Null means captions are off, not that the call failed.
 */
async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  if (!RAPID_KEY()) return null;

  const payload = await withRetry(
    () =>
      getJson<unknown>(
        `https://${YT_TRANSCRIPT_HOST}/api/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`,
        rapidHeaders(YT_TRANSCRIPT_HOST),
        30_000
      ),
    { attempts: 2 }
  ).catch(() => null);
  if (!payload) return null;

  const segments = (payload as { transcript?: { text?: string }[] }).transcript;
  if (!Array.isArray(segments)) return null;

  const text = segments
    .map((s) => (s?.text ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}
