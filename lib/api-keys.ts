import { cache } from "react";
import { CE_ORG_ID } from "@/lib/org";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The provider keys a workspace can bring its own of.
 *
 * These are the five the product actually spends money through. Anything else
 * in the env — supabase, the site url, the cron secret, resend — is the
 * deploy's own plumbing and is not a thing a creator pastes into a settings
 * page, so it is deliberately not here.
 */
export const KEY_PROVIDERS = [
  "scrapecreators",
  "upload_post",
  "apify",
  "rapidapi",
  "youtube",
] as const;

export type KeyProvider = (typeof KEY_PROVIDERS)[number];

/** What each one is called on screen, and what it buys. */
export const KEY_LABEL: Record<KeyProvider, { name: string; what: string; where: string }> = {
  scrapecreators: {
    name: "scrapecreators",
    what: "reads views on tiktok, instagram, youtube and facebook",
    where: "scrapecreators.com",
  },
  upload_post: {
    name: "upload-post",
    what: "posts and schedules the cuts",
    where: "upload-post.com",
  },
  apify: {
    name: "apify",
    what: "the older scraper, only where scrapecreators has no endpoint",
    where: "apify.com",
  },
  rapidapi: {
    name: "rapidapi",
    what: "flat rate tiktok and instagram, used before scrapecreators when set",
    where: "rapidapi.com",
  },
  youtube: {
    name: "youtube data api",
    what: "youtube views, free inside google's daily quota",
    where: "console.cloud.google.com",
  },
};

/**
 * The env var each one falls back to.
 *
 * Read at call time, never at import: a module level `process.env.X` is
 * evaluated once when the file is first required, which on a long lived server
 * means a key set later in the process is never seen. It also makes the value
 * untestable.
 */
const ENV_NAME: Record<KeyProvider, string> = {
  scrapecreators: "SCRAPECREATORS_API_KEY",
  upload_post: "UPLOAD_POST_API_KEY",
  apify: "APIFY_TOKEN",
  rapidapi: "RAPIDAPI_KEY",
  youtube: "YOUTUBE_API_KEY",
};

function fromEnv(provider: KeyProvider): string | null {
  const raw = process.env[ENV_NAME[provider]];
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * The key to call a provider with, for the person the work belongs to.
 *
 * Order is workspace first, env second. That is what makes this white label:
 * a deploy ships with whatever keys its env carries and a programme that
 * pastes its own takes over without anybody touching the deploy. It also means
 * nothing that works today stops working — an env-only install never notices
 * this exists.
 *
 * The read goes through the SERVICE client, because `read_api_credential` is
 * granted to `service_role` and to nothing else. A session cannot read a key
 * back however hard it asks, which is the property worth having: the settings
 * form can replace a key and can never show one.
 *
 * No service client, or no row, is not an error here — it is "fall back to the
 * env". The metered paths have their own rail in front of them and say so in
 * their own words.
 */
export const apiKey = cache(
  async (provider: KeyProvider, userId: string | null): Promise<string | null> => {
    if (userId) {
      const service = createServiceClient();
      if (service) {
        const { data, error } = await service.rpc("read_api_credential", {
          p_user: userId,
          p_provider: provider,
          // this deploy is one org, so the answer is that org's key and never
          // the first seat a founder happens to hold.
          p_org: CE_ORG_ID || null,
        });
        if (error) {
          console.error(`[api-keys] ${provider} read failed`, error.message);
        } else if (typeof data === "string" && data.trim()) {
          return data.trim();
        }
      }
    }

    return fromEnv(provider);
  }
);

/** Whether a key exists at all, without pulling the secret into the caller. */
export async function hasApiKey(
  provider: KeyProvider,
  userId: string | null
): Promise<boolean> {
  return (await apiKey(provider, userId)) !== null;
}
