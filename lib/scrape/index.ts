/**
 * The only thing the app imports. Detect, check the rail, spend exactly one
 * call, write down what it cost, hand back something the page can render.
 *
 * Server only: it reaches for the service key and the provider key. The page
 * calls it from a server action or a route handler, never from the browser.
 */

import {
  fetchFacebookReels,
  fetchInstagramReels,
  fetchTiktokVideos,
  fetchYoutubeShorts,
  SC_ENDPOINT,
  type ScFetch,
} from "./scrapecreators";
import {
  normalizeFacebook,
  normalizeInstagram,
  normalizeTiktok,
  normalizeYoutube,
} from "./normalize";
import { apiKey } from "@/lib/api-keys";
import { createServiceClient } from "@/lib/supabase/service";
import { creditsUsedToday, dailyCapFor, logUsage } from "./usage";
import { detectProfile } from "./detect";
import type { DetectedProfile, Platform, ScrapeOutcome, ScrapePage } from "./types";

export * from "./types";
export { detectProfile } from "./detect";
export { creditsUsedToday, dailyCapFor, getPricing } from "./usage";

type Reason = Extract<ScrapeOutcome, { ok: false }>["reason"];

function fail(reason: Reason, error: string, retryable = false): ScrapeOutcome {
  return { ok: false, reason, error, retryable };
}

/**
 * A status code to something a creator can act on. No jargon, no status
 * numbers: "402" means nothing to the person who pasted a link, and the one
 * thing they need to know is whether waiting helps.
 */
function explain(status: number | null): { reason: Reason; error: string; retryable: boolean } {
  switch (status) {
    case 401:
      return {
        reason: "not_configured",
        error: "the scraper key is not working, an admin needs to look at it",
        retryable: false,
      };
    case 402:
      return {
        reason: "no_credits",
        error: "the scrapecreators account is out of credits",
        retryable: false,
      };
    case 403:
      return {
        reason: "blocked",
        error: "that profile is private or the platform blocked the request",
        retryable: false,
      };
    case 404:
      return { reason: "not_found", error: "could not find that profile", retryable: false };
    case 429:
      return {
        reason: "rate_limited",
        error: "too many requests, give it a minute",
        retryable: true,
      };
    case 400:
      return {
        reason: "provider_error",
        error: "the scraper did not understand that profile link",
        retryable: false,
      };
    case null:
      return {
        reason: "network",
        error: "could not reach the scraper, try again in a moment",
        retryable: true,
      };
    default:
      return {
        reason: "provider_error",
        error: "the scraper had a problem on its end, try again in a bit",
        retryable: true,
      };
  }
}

function fetchFor(
  profile: DetectedProfile,
  cursor: string | null,
  key: string
): Promise<ScFetch> {
  switch (profile.platform) {
    case "tiktok":
      return fetchTiktokVideos({ handle: profile.handle, cursor, key });
    case "instagram":
      return fetchInstagramReels({ handle: profile.handle, cursor, key });
    case "youtube":
      return fetchYoutubeShorts({
        handle: profile.handle,
        channelId: profile.channelId,
        cursor,
        key,
      });
    case "facebook":
      // the one endpoint that wants the page url rather than the handle, and
      // detectProfile has already built the tidy form of it.
      return fetchFacebookReels({ pageUrl: profile.profileUrl, cursor, key });
  }
}

function normalizeFor(platform: Platform, body: unknown): ScrapePage {
  switch (platform) {
    case "tiktok":
      return normalizeTiktok(body);
    case "instagram":
      return normalizeInstagram(body);
    case "youtube":
      return normalizeYoutube(body);
    case "facebook":
      return normalizeFacebook(body);
  }
}

/**
 * One page of one profile, for one click.
 *
 * The refusals in front of the request all happen before any money moves, and
 * they return without touching the ledger: the ledger means "what we spent",
 * and a row for a call that never went out makes the admin page's totals a lie.
 */
export async function scrapeProfilePage(args: {
  inputUrl: string;
  cursor?: string | null;
  userId: string;
  userEmail: string | null;
  targetId?: string | null;
}): Promise<ScrapeOutcome> {
  const profile = detectProfile(args.inputUrl);
  if (!profile) {
    return fail("bad_url", "that is not a tiktok, instagram, youtube or facebook profile link");
  }

  // the workspace's key first, the deploy's env second. resolved here rather
  // than tested inside the client, because whether scraping is configured is a
  // question about the person the scrape belongs to, not about the deploy.
  const key = await apiKey("scrapecreators", args.userId);
  if (!key) {
    return fail(
      "not_configured",
      "scraping is not set up yet, add a scrapecreators key in settings"
    );
  }

  // deliberate: no service client means no ledger, and no ledger means credits
  // get spent with nothing recording it. an untracked bill is the one failure
  // this tool exists to prevent, so it refuses to run rather than run blind.
  if (!createServiceClient()) {
    return fail("not_configured", "usage logging is not set up, so scraping is switched off");
  }

  // the rail goes in front of the request, not around it. checking after the
  // call would report the cap having already blown past it.
  const cap = await dailyCapFor(args.userId);
  if (cap != null) {
    const used = await creditsUsedToday(args.userId);
    if (used >= cap) {
      return fail(
        "daily_cap",
        "you have hit today's scraping limit, it resets at midnight utc"
      );
    }
  }

  // exactly one upstream request per click. no internal paging loop, no second
  // call to the profile endpoint for a follower count, no per-post lookups.
  // paging is the caller passing the cursor back on the next click, so the
  // person spending the credits is the one deciding to spend them.
  const cursor = args.cursor ?? null;
  const result = await fetchFor(profile, cursor, key);

  if (!result.ok) {
    const { reason, error, retryable } = explain(result.status);
    await logUsage({
      userId: args.userId,
      userEmail: args.userEmail,
      endpoint: result.endpoint,
      platform: profile.platform,
      targetId: args.targetId ?? null,
      // a failed call bills nothing on every documented code, but this is read
      // rather than assumed everywhere else, so it stays 0 only because there
      // is no body to read it from.
      creditsCharged: 0,
      creditsRemaining: null,
      cached: false,
      ok: false,
      statusCode: result.status,
      error: result.error,
      durationMs: result.durationMs,
    });
    return fail(reason, error, retryable);
  }

  const page = normalizeFor(profile.platform, result.body);

  await logUsage({
    userId: args.userId,
    userEmail: args.userEmail,
    endpoint: SC_ENDPOINT[profile.platform],
    platform: profile.platform,
    targetId: args.targetId ?? null,
    creditsCharged: page.creditsCharged,
    creditsRemaining: page.creditsRemaining,
    // the provider bills 0 for a hit it served from its own cache, so the flag
    // is derived from the charge rather than from a header it does not send.
    cached: page.creditsCharged === 0,
    ok: true,
    statusCode: result.status,
    error: null,
    durationMs: result.durationMs,
  });

  return { ok: true, ...page };
}
