/**
 * Thumbnails, served from our own origin.
 *
 * The scraped urls are live and fetchable — from a server. From a browser they
 * fail: the signed meta and tiktok cdn urls carry a session token from the api
 * call that produced them, the cdns judge a cross-site image request on more
 * than its referer, and a creator with a tracker blocker installed has
 * `cdninstagram.com` on a list before any of that matters. The result is the
 * same either way, a table of empty grey squares, and none of it is something
 * an `<img src>` can be talked out of.
 *
 * Fetching server side and streaming the bytes back makes every thumbnail a
 * same-origin request, which none of those three mechanisms apply to.
 *
 * It is not a general image proxy and must never become one. Three things keep
 * it narrow: a caller has to be signed in, the host has to be on the list
 * below, and the response has to actually be an image. The host is checked
 * again after redirects, because following one is how an allowlist gets walked
 * around.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * The cdns the three providers actually serve covers from. Matched on the
 * registrable suffix with a leading dot, so `cdninstagram.com` and
 * `scontent-sjc6-1.cdninstagram.com` both pass and `cdninstagram.com.evil.dev`
 * does not.
 */
const ALLOWED_HOSTS = [
  // instagram, and the facebook cdn it falls back to
  "cdninstagram.com",
  "fbcdn.net",
  // tiktok, which rotates through several
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokcdn-eu.com",
  "tiktokv.com",
  "ibyteimg.com",
  "byteoversea.com",
  // youtube
  "ytimg.com",
  "ggpht.com",
  "googleusercontent.com",
];

/** 5MB. A cover is tens of kilobytes; anything at this size is not a cover. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A browser's own headers, because that is what these cdns are built to serve.
 * Meta and tiktok both answer a bare datacenter fetch differently from a real
 * request, and the difference is a 403 the table renders as an empty square.
 * Nothing identifying goes with it: no cookies, no auth, no referrer of ours.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * Every refusal, named and logged.
 *
 * This route used to fail silently: a 401, a 403 from the cdn and an expired
 * url all arrived at the browser as the same empty square, which made "why are
 * there no thumbnails" a question nothing on the server could answer. The
 * reason now travels in a header as well as the log, so the next look at it is
 * one request rather than an afternoon.
 */
function refuse(reason: string, status: number): Response {
  console.error("[scrape.thumb.refused]", reason);
  return new Response(reason, {
    status,
    headers: { "Content-Type": "text/plain", "X-Thumb-Error": reason },
  });
}

/** just the host, for a log line that has to survive a url nobody can parse */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "unparseable";
  }
}

function allowed(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? url : null;
}

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("u");
  if (!target) return refuse("missing u", 400);

  const url = allowed(target);
  if (!url) return refuse(`host not allowed: ${hostOf(target)}`, 400);

  // Signed in only. The tool behind this is, and an open fetcher on a public
  // route is worth more to someone else than it is to us.
  //
  // getClaims, not getUser: a table of forty covers is forty of these in one
  // breath, and getUser is a round trip to the auth server every time. Forty
  // at once is a rate limit, and a rate limit here is a page of empty squares
  // that looks exactly like a broken scraper. getClaims verifies the jwt in
  // process, which is the same answer without the traffic. Same call the proxy
  // makes, for the same reason.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return refuse("unauthorized", 401);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // no cookies, no credentials, nothing of ours travels upstream.
      headers: BROWSER_HEADERS,
      referrerPolicy: "no-referrer",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    return refuse(`upstream unreachable: ${(error as Error)?.name ?? "error"}`, 502);
  }

  if (!upstream.ok) return refuse(`upstream ${upstream.status}`, 502);
  // a redirect is the way around an allowlist, so wherever it actually landed
  // has to pass the same check.
  if (!allowed(upstream.url)) return refuse(`redirected off list: ${hostOf(upstream.url)}`, 502);

  const type = upstream.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return refuse(`not an image: ${type || "no type"}`, 502);

  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return refuse("too large", 502);

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return refuse("too large", 502);

  return new Response(body, {
    headers: {
      "Content-Type": type,
      // private, because the url is only reachable by the signed-in user who
      // scraped it. an hour, because these expire in days and re-fetching a
      // dead one costs nothing but a grey square.
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(body.byteLength),
    },
  });
}
