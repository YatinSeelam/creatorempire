/**
 * The apify path for the transcriber, used when RAPIDAPI_KEY is not set.
 *
 * Two actors, both pay-per-result and both returning the words directly, so
 * this path never needs deepgram:
 *
 * - tiktok / instagram / facebook reels → `tictechid~anoxvanzi-Transcriber`.
 *   Takes the post url, returns the transcript and nothing else, so the
 *   caption, handle, cover and playable file come from lib/transcribe/media.ts
 *   alongside it (one scrapecreators credit), with tiktok's free oEmbed behind
 *   that for a deploy with no scrapecreators key.
 * - youtube → `starvibe~youtube-video-transcript`. Returns title, channel,
 *   thumbnail and the plain transcript in one call, no oEmbed needed.
 *
 * Everything here returns null rather than throwing, same contract as
 * lib/transcribe/sources.ts: the caller turns null into one sentence.
 */

import { callActor } from "@/lib/apify";
import type { ParsedUrl } from "@/lib/ingest/urls";
import { fetchClipMeta, type Who } from "./media";
import type { ScrapedPost } from "./sources";

const REELS_ACTOR = "tictechid~anoxvanzi-Transcriber";
const YT_ACTOR = "starvibe~youtube-video-transcript";

const OEMBED_TIMEOUT_MS = 8_000;

type Row = Record<string, unknown>;

const str = (row: Row, key: string): string | null => {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** The actor answers with timestamps unless told not to; we tell it not to,
 *  and strip any that arrive anyway so a script never reads `[6.48s - 7.38s]`. */
function stripTimestamps(text: string): string {
  return text
    .replace(/\[\s*\d+(?:\.\d+)?s\s*-\s*\d+(?:\.\d+)?s\s*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Free, unauthenticated, and the only metadata source that costs nothing. */
async function oembed(url: string): Promise<{ title: string | null; author: string | null; thumbnail: string | null }> {
  const empty = { title: null, author: null, thumbnail: null };
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return empty;
    const json = (await res.json()) as Row;
    return {
      title: str(json, "title"),
      author: str(json, "author_name"),
      thumbnail: str(json, "thumbnail_url"),
    };
  } catch {
    return empty;
  }
}

export async function apifyFetchPost(
  parsed: ParsedUrl,
  who: Who | null
): Promise<ScrapedPost | null> {
  return parsed.platform === "youtube" ? apifyYouTube(parsed) : apifyReel(parsed, who);
}

async function apifyReel(parsed: ParsedUrl, who: Who | null): Promise<ScrapedPost | null> {
  // all three in parallel: the actor is the slow one and the other two are a
  // credit and a free redirect, so neither is worth waiting on serially.
  const [run, meta, tk] = await Promise.all([
    callActor(REELS_ACTOR, { urls: [parsed.canonicalUrl], include_timestamps: false }),
    fetchClipMeta(parsed, who),
    parsed.platform === "tiktok"
      ? oembed(parsed.canonicalUrl)
      : Promise.resolve({ title: null, author: null, thumbnail: null }),
  ]);
  if (!run.ok) {
    console.error("[transcribe.apify_reel_failed]", run.error);
    return null;
  }

  const item = (run.items.find(
    (it) => it && typeof it === "object" && (it as Row).status === "success"
  ) ?? null) as Row | null;
  if (!item) return null;

  const transcript = str(item, "transcript");

  return {
    platform: parsed.platform,
    post_url: parsed.canonicalUrl,
    caption: meta.caption ?? tk.title,
    creator_handle: meta.creator_handle ?? parsed.handle ?? tk.author,
    video_url: meta.video_url,
    thumbnail_url: meta.thumbnail_url ?? tk.thumbnail,
    transcript: transcript ? stripTimestamps(transcript) : "",
    // the actor answered, it just heard nothing. that is a clip with no talking
    // in it, and it is a different sentence from "we could not read that post".
    silent: !transcript,
  };
}

async function apifyYouTube(parsed: ParsedUrl): Promise<ScrapedPost | null> {
  const run = await callActor(YT_ACTOR, {
    youtube_url: parsed.canonicalUrl,
    language: "en",
    include_transcript_text: true,
  });
  if (!run.ok) {
    console.error("[transcribe.apify_youtube_failed]", run.error);
    return null;
  }

  const item = (run.items[0] ?? null) as Row | null;
  if (!item || item.status !== "success") return null;

  const transcript = str(item, "transcript_text");

  return {
    platform: "youtube",
    silent: !transcript,
    post_url: parsed.canonicalUrl,
    caption: str(item, "title"),
    creator_handle: str(item, "channel_name"),
    // youtube media urls are not playable by anyone but youtube; the workspace
    // renders the embed iframe off post_url instead. Same as the rapidapi path.
    video_url: null,
    thumbnail_url:
      str(item, "thumbnail") ??
      (parsed.videoId ? `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg` : null),
    transcript: transcript ?? "",
  };
}
