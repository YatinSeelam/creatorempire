/**
 * The raw scrapecreators client. It fetches exactly one page and hands back the
 * parsed body, the status and how long it took. It does not normalise, it does
 * not retry across pages, and it never decides what a failure means to a human.
 *
 * Server only. The key has no NEXT_PUBLIC_ prefix, so importing this from a
 * client component is a build error rather than a leak.
 */

import { HttpError, Spacer, getJson, withRetry } from "@/lib/ingest/http";

const BASE = "https://api.scrapecreators.com";

/** The path, without the query string. This is what goes in the ledger's
 *  `endpoint` column: handles and cursors are not worth keeping and a cursor is
 *  long enough to bloat the table on its own. */
export const SC_ENDPOINT = {
  tiktok: "/v3/tiktok/profile/videos",
  instagram: "/v1/instagram/user/reels",
  youtube: "/v1/youtube/channel/shorts",
  facebook: "/v1/facebook/profile/reels",
  /** one post, not a profile. the portfolio importer's endpoints: these are the
   *  only ones that hand back a playable file rather than a view count. */
  tiktokPost: "/v2/tiktok/video",
  instagramPost: "/v1/instagram/post",
  facebookPost: "/v1/facebook/post",
} as const;

/** A tiktok page is ~370KB even with `trim=true`, and a slow one is a slow one,
 *  not a dead one. 12s (the http.ts default) cuts real responses off. */
const TIMEOUT_MS = 20_000;

/**
 * Two people clicking scrape at the same moment must not arrive as a burst.
 * Module scope on purpose: the point is one shared queue per server instance,
 * not one per call.
 */
const spacer = new Spacer(1_100);

export type ScFetch =
  | { ok: true; status: number; body: unknown; durationMs: number; endpoint: string }
  | {
      ok: false;
      /** null when the request never got an answer at all: dns, socket, timeout. */
      status: number | null;
      error: string;
      durationMs: number;
      endpoint: string;
    };

/**
 * The key is handed in now.
 *
 * It used to be read straight off `process.env` here, which is fine while a
 * deploy has exactly one and impossible once a workspace brings its own: this
 * file has no idea whose scrape it is running. The caller does — every one of
 * them resolves it through `lib/api-keys.ts` — so it arrives as an argument
 * and the env is only the fallback for a caller that has nobody to ask about.
 */
async function call(
  endpoint: string,
  params: Record<string, string | null | undefined>,
  apiKey?: string | null
): Promise<ScFetch> {
  const started = Date.now();
  const key = apiKey?.trim() || process.env.SCRAPECREATORS_API_KEY;
  if (!key) {
    return { ok: false, status: null, error: "missing api key", durationMs: 0, endpoint };
  }

  const url = new URL(BASE + endpoint);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }

  try {
    const body = await withRetry(
      async () => {
        await spacer.wait();
        return getJson<unknown>(url.toString(), { "x-api-key": key }, TIMEOUT_MS);
      },
      // two attempts, not three. withRetry already refuses to retry 401/402/403/
      // 404, but a timeout looks transient and may well have been served and
      // billed upstream while we stopped listening. every extra attempt is
      // another credit in that case, so the ceiling stays low deliberately.
      { attempts: 2, baseMs: 600 }
    );
    return { ok: true, status: 200, body, durationMs: Date.now() - started, endpoint };
  } catch (err) {
    const durationMs = Date.now() - started;

    if (err instanceof HttpError) {
      return { ok: false, status: err.status, error: err.message, durationMs, endpoint };
    }

    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      ok: false,
      status: null,
      error: timedOut
        ? `no answer within ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err),
      durationMs,
      endpoint,
    };
  }
}

/** One page of a tiktok profile. `cursor` is the previous page's `max_cursor`. */
export function fetchTiktokVideos(args: {
  handle: string;
  cursor?: string | null;
  key?: string | null;
}): Promise<ScFetch> {
  return call(
    SC_ENDPOINT.tiktok,
    { handle: args.handle, trim: "true", max_cursor: args.cursor },
    args.key
  );
}

/**
 * One post, by its public url, for the portfolio importer.
 *
 * The profile endpoints above answer "what did they post and how did it do".
 * These two answer a different question — "give me the file" — and they are the
 * only calls in the app that exist to fetch media rather than numbers. One
 * credit each, same ledger.
 */
export function fetchTiktokPost(url: string, key?: string | null): Promise<ScFetch> {
  return call(SC_ENDPOINT.tiktokPost, { url }, key);
}

export function fetchInstagramPost(url: string, key?: string | null): Promise<ScFetch> {
  return call(SC_ENDPOINT.instagramPost, { url }, key);
}

/** One page of an instagram account's reels. `cursor` is the previous `max_id`. */
export function fetchInstagramReels(args: {
  handle: string;
  cursor?: string | null;
  key?: string | null;
}): Promise<ScFetch> {
  return call(
    SC_ENDPOINT.instagram,
    { handle: args.handle, trim: "true", max_id: args.cursor },
    args.key
  );
}

/**
 * One page of a facebook page's reels, ten at a time.
 *
 * Two things make it unlike its three siblings. It takes a page URL rather than
 * a handle, because `url` is the endpoint's required parameter. And it paginates
 * on TWO tokens, `next_page_id` and `cursor`, where `ScrapePage.nextCursor` is a
 * single opaque string: the normaliser joins them with a `|` and this splits
 * them again, so nothing outside these two functions has to know.
 *
 * Ten a page against tiktok's thirty five is the cost to keep in mind. It is
 * also why the sync gives facebook its own page budget.
 */
export function fetchFacebookReels(args: {
  pageUrl: string;
  cursor?: string | null;
  key?: string | null;
}): Promise<ScFetch> {
  const raw = args.cursor ?? "";
  const sep = raw.indexOf("|");
  const [nextPageId, cursor] = sep === -1 ? [raw, ""] : [raw.slice(0, sep), raw.slice(sep + 1)];
  return call(
    SC_ENDPOINT.facebook,
    { url: args.pageUrl, next_page_id: nextPageId || null, cursor: cursor || null },
    args.key
  );
}

/** One facebook reel by its url, for the portfolio importer.
 *
 *  Note for anyone reaching for this to read a view count: do not. The provider
 *  documents `view_count` here as sometimes null and sometimes lower than the
 *  public reels badge. The badge number is on the profile reels endpoint, and
 *  under-counting a view is under-paying a bonus. */
export function fetchFacebookPost(url: string, key?: string | null): Promise<ScFetch> {
  return call(SC_ENDPOINT.facebookPost, { url }, key);
}

/**
 * One page of a youtube channel's shorts. Long form lives on a different
 * endpoint and costs its own credit, so it is not fetched here: the tool is
 * shorts-first and a second call per click doubles the bill for content most
 * ugc deals do not pay on.
 */
export function fetchYoutubeShorts(args: {
  handle: string;
  channelId?: string | null;
  cursor?: string | null;
  key?: string | null;
}): Promise<ScFetch> {
  // a UC id is not accepted in `handle`, so the two are mutually exclusive.
  const target = args.channelId
    ? { channelId: args.channelId }
    : { handle: args.handle };

  return call(
    SC_ENDPOINT.youtube,
    { ...target, sort: "newest", continuationToken: args.cursor },
    args.key
  );
}
