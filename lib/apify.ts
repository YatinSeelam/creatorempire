/**
 * Apify, used for one job: resolving a post url to the video file behind it.
 *
 * `run-sync-get-dataset-items` starts an actor, waits for it, and returns the
 * dataset in the same response, so there is no run id to poll and no webhook to
 * receive. That is the only reason this is a few dozen lines rather than a
 * queue: the caller is a creator standing in front of a spinner having pressed
 * Import, and the whole thing has to finish inside one request.
 *
 * It is deliberately not general. Three actors for the portfolio importer, and
 * `callActor` underneath them for the transcriber's two (lib/transcribe/apify.ts).
 *
 * Server only: it reads APIFY_TOKEN.
 */

import type { ImportPlatform } from "@/lib/portfolio-embed";

const BASE = "https://api.apify.com/v2/acts";

/**
 * The actor per platform, and the input each one wants.
 *
 * Actor ids use `~` rather than `/` in a url path, which is Apify's own
 * convention and the single easiest thing to get wrong here.
 *
 * YouTube is the reason this file exists at all. The other provider covers
 * TikTok and Instagram and has no working single-video endpoint for YouTube, so
 * before this a YouTube link could only ever be an iframe.
 */
const ACTORS: Record<ImportPlatform | "youtube", { id: string; input: (url: string) => unknown }> = {
  youtube: {
    id: "streamers~youtube-shorts-scraper",
    input: (url) => ({ startUrls: [{ url }], maxResults: 1, downloadSubtitles: false }),
  },
  tiktok: {
    id: "clockworks~tiktok-scraper",
    input: (url) => ({
      postURLs: [url],
      resultsPerPage: 1,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
    }),
  },
  instagram: {
    id: "apify~instagram-scraper",
    input: (url) => ({ directUrls: [url], resultsType: "posts", resultsLimit: 1 }),
  },
};

/** A run that waits on the actor cannot use the default 30s: a cold actor
 *  spends most of that starting up. 120s is the ceiling a creator will sit
 *  through, and past it the import fails rather than hangs. */
const TIMEOUT_MS = 120_000;

/** Both names are in the wild: the code was written against `APIFY_TOKEN`,
 *  every environment we actually deploy to spells it `APIFY_API_KEY`, and the
 *  mismatch made the import silently answer "apify not configured" everywhere.
 *  Read both rather than pick a winner and break the other. */
const apifyToken = () =>
  process.env.APIFY_TOKEN || process.env.APIFY_API_KEY || "";

export function hasApifyToken(): boolean {
  return Boolean(apifyToken());
}

export type ApifyRun =
  | { ok: true; items: unknown[] }
  | { ok: false; error: string; status: number | null };

/**
 * Run one actor against one url and hand back its dataset items.
 *
 * The token goes in the `Authorization` header rather than the `?token=` query
 * parameter Apify's docs suggest. Same auth, but a query string ends up in
 * proxy logs, error messages and anything that echoes a failing url back, and a
 * token that grants a whole Apify account is not something to leave lying in a
 * log line.
 */
export async function runActor(
  platform: ImportPlatform | "youtube",
  url: string
): Promise<ApifyRun> {
  const actor = ACTORS[platform];
  return callActor(actor.id, actor.input(url));
}

/**
 * The same run-sync call for any actor. `runActor` above stays the importer's
 * entry point; the transcriber calls this directly with its own actors, so the
 * auth, timeout and error shape live once.
 */
export async function callActor(actorId: string, input: unknown): Promise<ApifyRun> {
  const token = apifyToken();
  if (!token) return { ok: false, error: "apify not configured", status: null };

  const endpoint = `${BASE}/${actorId}/run-sync-get-dataset-items?timeout=115`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      return { ok: false, error: `apify ${res.status}`, status: res.status };
    }

    const body = await res.json();
    return { ok: true, items: Array.isArray(body) ? body : [] };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "apify timed out" : "apify unreachable",
      status: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The video and cover urls out of whichever actor ran.
 *
 * Every actor names these differently and each one has changed its field names
 * at least once, so the read is a list of candidates per field rather than a
 * path: whichever key is present and looks like a url wins, and a missing one
 * is a sentence for the creator rather than a crash.
 */
export function mediaFromItem(item: unknown): { videoUrl: string; posterUrl: string } {
  const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;

  const pick = (keys: string[]) => {
    for (const key of keys) {
      const value = row[key];
      if (typeof value === "string" && /^https:\/\//i.test(value)) return value;
    }
    return "";
  };

  return {
    videoUrl: pick([
      "videoUrl",
      "video_url",
      "downloadUrl",
      "mediaUrl",
      "videoPlayUrl",
      "url_video",
    ]),
    posterUrl: pick([
      "thumbnailUrl",
      "displayUrl",
      "coverUrl",
      "thumbnail",
      "covers",
      "previewImageUrl",
    ]),
  };
}
