import "server-only";

/**
 * Upload-Post API client. Server only — UPLOAD_POST_API_KEY must never reach
 * the browser, so every call routes through here from server actions.
 *
 * The model, and the reason this provider over building three platform apps:
 * one "managed profile" (a username string we generate) per creator. The
 * creator connects their own accounts to it once through a white-label link,
 * the OAuth tokens live on Upload-Post's side, and we publish by passing the
 * username. The username is the only thing we store and it is useless without
 * our API key.
 *
 * Ported from the sister project's client, which has been posting in
 * production for months; trimmed to the three platforms this product tracks
 * and to video, because that is what a UGC deal ships.
 *
 * Auth is `Apikey <key>` in the Authorization header.
 * Docs: https://docs.upload-post.com
 */

import { YOUTUBE_TITLE_MAX } from "@/lib/autopost/limits";
import {
  TIKTOK_PRIVACY,
  YOUTUBE_CATEGORY_ID,
  type PostOptions,
} from "@/lib/autopost/plan";

const BASE_URL = "https://api.upload-post.com/api";

/** What the connect page offers and what `publishVideo` accepts. Upload-Post
 *  supports more; add here when the product tracks them, because a platform
 *  that can be posted to but not read is a bonus rule that never pays. */
export const AUTOPOST_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"] as const;
export type AutopostPlatform = (typeof AUTOPOST_PLATFORMS)[number];

export class UploadPostError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadPostError";
    this.status = status;
  }
}

// social_accounts values are messy per the spec: a details object, a bare
// string, or null — anything non-empty means "connected".
type SocialAccountValue =
  | { username?: string; handle?: string; display_name?: string }
  | string
  | null;

export type UploadPostProfile = {
  username: string;
  social_accounts?: Record<string, SocialAccountValue>;
};

function messageOf(body: unknown): string | null {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === "string") return m;
    if (Array.isArray(m)) return m.map(String).join("; ");
  }
  return null;
}

/**
 * How long any one Upload-Post call may hold the request open.
 *
 * There was no cap at all, and a server action that hangs on an upstream fetch
 * dies at the platform's wall instead of returning: the browser gets a failed
 * action, the revalidations behind it re-run the `(dash)` gate against a
 * request that is already out of budget, and the reads that gate depends on
 * start failing. That is how a slow upload turned into "your account is not on
 * a plan". A timeout here makes the same failure a sentence.
 *
 * The publish call carries a video and gets the long one. Everything else is a
 * small json round trip and has no business taking twenty seconds.
 */
const TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * `apiKey` is handed in by the caller now rather than read off the env here.
 *
 * A workspace can bring its own upload-post account, and this file has no way
 * to know whose post it is sending — every exported function below therefore
 * takes an optional key and passes it through. The env stays as the fallback,
 * so a deploy that has only ever had one key never notices.
 */
async function api<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
  apiKey?: string | null
): Promise<T> {
  const key = apiKey?.trim() || process.env.UPLOAD_POST_API_KEY;
  if (!key) throw new UploadPostError("no upload-post key is configured", 500);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Apikey ${key}`,
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // 504 rather than 500: this is upstream being slow, and the caller's
    // catch already turns an UploadPostError into a message a creator reads.
    const timedOut =
      err instanceof DOMException &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new UploadPostError(
      timedOut
        ? "Upload-Post did not answer in time. Nothing was posted. Try again."
        : `Could not reach Upload-Post: ${(err as Error).message}`,
      504
    );
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // an html error page. the status message below carries it.
  }

  if (!res.ok) {
    throw new UploadPostError(
      messageOf(body) ?? `Upload-Post request failed (${res.status})`,
      res.status
    );
  }
  return body as T;
}

/* ----------------------------------------------------------------- profiles */

/**
 * POST /uploadposts/users. A 409 means the profile already exists, and since
 * the username is deterministic per user that is success, not failure.
 */
export async function createManagedProfile(
  username: string,
  key?: string | null
): Promise<void> {
  try {
    await api(
      "/uploadposts/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      },
      TIMEOUT_MS,
      key
    );
  } catch (err) {
    if (err instanceof UploadPostError && err.status === 409) return;
    throw err;
  }
}

/**
 * POST /uploadposts/users/generate-jwt — the one-time white-label URL the
 * creator opens to OAuth their accounts into the managed profile. Valid ~48h,
 * regenerate freely. `redirectUrl` sends them back to /social after.
 */
export async function whiteLabelLink(
  username: string,
  redirectUrl: string,
  key?: string | null
): Promise<string> {
  // the page is hosted on their domain by design — that is what spares us
  // three platform app approvals — but the title, description and logo are
  // ours, which is as branded as their whitelabel gets. the logo url must be
  // absolute and publicly fetchable, so it points at production even from dev.
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.creatorempire.app";

  const body = await api<{ success: boolean; access_url?: string }>(
    "/uploadposts/users/generate-jwt",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        platforms: AUTOPOST_PLATFORMS,
        logo_image: `${site}/logo.png`,
        connect_title: "Connect your accounts to Creator Empire",
        connect_description:
          "One login per platform, on the platform's own page. Creator Empire posts your approved cuts for you and never sees a password.",
        show_calendar: false,
        redirect_url: redirectUrl,
      }),
    },
    TIMEOUT_MS,
    key
  );
  if (!body.access_url) throw new UploadPostError("Upload-Post returned no connect URL", 502);
  return body.access_url;
}

/** GET /uploadposts/users, filtered to ours. Null when it does not exist. */
export async function getProfile(
  username: string,
  key?: string | null
): Promise<UploadPostProfile | null> {
  const body = await api<{ profiles?: UploadPostProfile[] }>(
    "/uploadposts/users",
    {},
    TIMEOUT_MS,
    key
  );
  return body.profiles?.find((p) => p.username === username) ?? null;
}

/** platform → display handle for everything the profile has connected. */
export function connectedOf(profile: UploadPostProfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [platform, value] of Object.entries(profile.social_accounts ?? {})) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      if (value) out[platform] = value;
      continue;
    }
    out[platform] = value.username ?? value.handle ?? value.display_name ?? "connected";
  }
  return out;
}

export type FacebookPage = { id: string; name: string };

/**
 * GET /uploadposts/facebook/pages: the Pages a profile's connected facebook
 * account manages.
 *
 * A facebook post lands on a Page, not on a person. With exactly one connected
 * Upload-Post infers it; with several it refuses the post and returns a
 * per-platform error listing the available ones. So the choice is made once and
 * kept on the profile row.
 *
 * Field names are read defensively because the response has been seen both
 * ways, and this is ported from the sister project's client which has been
 * doing it in production for months.
 */
export async function listFacebookPages(
  username: string,
  key?: string | null
): Promise<FacebookPage[]> {
  const body = await api<{
    pages?: Record<string, unknown>[];
    data?: Record<string, unknown>[];
  }>(
    `/uploadposts/facebook/pages?profile=${encodeURIComponent(username)}`,
    {},
    TIMEOUT_MS,
    key
  );

  const raw = body.pages ?? body.data ?? [];
  return raw.flatMap((p) => {
    const id = p.page_id ?? p.id;
    const name = p.page_name ?? p.name;
    if (typeof id !== "string" && typeof id !== "number") return [];
    return [{ id: String(id), name: typeof name === "string" ? name : String(id) }];
  });
}

/* --------------------------------------------------------------- publishing */

export type PublishResult = {
  success?: boolean;
  /** per-platform outcomes, when the upload finished synchronously. */
  results?: Record<
    string,
    { success?: boolean; url?: string; post_url?: string; error?: string }
  >;
  /** present when the upload went async: poll it. */
  request_id?: string;
  /** present when the post was scheduled (202): their scheduler owns it. */
  job_id?: string;
  message?: string;
};

/** A caption cut to a YouTube-legal title on a word boundary. YouTube hard
 *  caps titles at 100 chars and an over-long one fails the WHOLE post, a
 *  failure mode the sister project hit in production. */
export function youtubeTitleFor(caption: string): string {
  const t = caption.trim();
  if (t.length <= YOUTUBE_TITLE_MAX) return t;
  const cut = t.slice(0, YOUTUBE_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 60 ? cut.slice(0, space) : cut).trim();
}

/**
 * POST /upload. The video goes by public URL — explicitly supported by the
 * spec — so the bytes never pass through a serverless function's body limit.
 * With `scheduledDate` set (ISO-8601 UTC, future, ≤365d) the response is a
 * 202 with a job_id and Upload-Post's own scheduler fires it.
 */
export function publishVideo(input: {
  username: string;
  platforms: AutopostPlatform[];
  caption: string;
  videoUrl: string;
  scheduledDate?: string;
  /** Which facebook Page receives the post. Required once several are
   *  connected: without it Upload-Post fails the facebook half of the post. */
  facebookPageId?: string | null;
  /** Per-platform settings collected by the batch wizard. Omitted entirely by
   *  the single-post composer, which is why every field below is optional
   *  upstream and the payload without this argument is byte for byte what it
   *  was before options existed. */
  options?: PostOptions | null;
  /** the workspace's own upload-post key, when it has one. */
  key?: string | null;
}): Promise<PublishResult> {
  const form = new FormData();
  form.append("user", input.username);
  for (const p of input.platforms) form.append("platform[]", p);
  form.append("title", input.caption);

  if (input.platforms.includes("youtube") && input.caption.trim().length > YOUTUBE_TITLE_MAX) {
    form.append("youtube_title", youtubeTitleFor(input.caption));
    form.append("youtube_description", input.caption);
  }
  if (input.facebookPageId && input.platforms.includes("facebook")) {
    form.append("facebook_page_id", input.facebookPageId);
  }
  if (input.scheduledDate) form.append("scheduled_date", input.scheduledDate);
  if (input.options) appendOptions(form, input.platforms, input.options);

  form.append("video", input.videoUrl);
  return api<PublishResult>(
    "/upload",
    { method: "POST", body: form },
    UPLOAD_TIMEOUT_MS,
    input.key
  );
}

/**
 * The batch wizard's per-platform settings, as Upload-Post's own form fields.
 *
 * Only fields sent for a platform that is actually in this post, so a tiktok
 * only batch never carries youtube's category. Three shapes worth knowing:
 *
 * - our switches are worded as permissions ("allow comments") and theirs are
 *   worded as prohibitions (`disable_comment`), so every one of them inverts.
 * - youtube wants a numeric category id, not the label a person picked. An
 *   unknown label sends nothing rather than a guess: a bad id fails the youtube
 *   half of the post, days later, on their side.
 * - the AI disclosure is one fact with three wire names: `is_aigc` on tiktok,
 *   `containsSyntheticMedia` on youtube, `is_ai_generated` on instagram.
 *
 * NAMES CHANGED 2026-08-24. This function used to send `tiktok_privacy_level`,
 * `instagram_share_to_feed`, `youtube_privacy_status` and friends. Upload-Post's
 * `/api/upload` reference documents those three platforms' options WITHOUT the
 * platform prefix — `privacy_level`, `share_to_feed`, `privacyStatus`,
 * `categoryId`, `selfDeclaredMadeForKids` — and only keeps a prefix on the
 * per-platform title/description overrides and on facebook, which is prefixed
 * throughout. The prefixed names had never been exercised against a live post
 * from here, so the documented ones win. If a post ever comes back with its
 * settings ignored, this paragraph is the first place to look.
 *
 * `SEND_PLATFORM_OPTIONS` is still the kill switch: flip it to false and the
 * request goes back to exactly the four fields it carried before options
 * existed, with the settings still stored and still drawn on the planner.
 */
const SEND_PLATFORM_OPTIONS = true;

function appendOptions(
  form: FormData,
  platforms: AutopostPlatform[],
  options: PostOptions
): void {
  if (!SEND_PLATFORM_OPTIONS) return;

  if (platforms.includes("tiktok")) {
    const t = options.tiktok;
    form.append("privacy_level", TIKTOK_PRIVACY[t.privacy] ?? "PUBLIC_TO_EVERYONE");
    form.append("disable_comment", String(!t.comments));
    form.append("disable_duet", String(!t.duet));
    form.append("disable_stitch", String(!t.stitch));
    form.append("brand_content_toggle", String(t.branded));
    form.append("brand_organic_toggle", String(t.ownBrand));
    form.append("is_aigc", String(t.aiGenerated));
    // theirs is milliseconds. clamped because a cover past the end of the clip
    // is a rejected post rather than a fallback to frame zero.
    const cover = Math.max(0, Math.round((t.coverSecond || 0) * 1000));
    form.append("cover_timestamp", String(cover));
    // a draft carries no metadata at all on tiktok's side, so sending the rest
    // above is harmless but pointless. their inbox is where it gets written.
    form.append("post_mode", t.draft ? "MEDIA_UPLOAD" : "DIRECT_POST");
  }

  if (platforms.includes("instagram")) {
    const ig = options.instagram;
    form.append("media_type", ig.mediaType === "Story" ? "STORIES" : "REELS");
    form.append("share_to_feed", String(ig.shareToFeed));
    form.append("is_ai_generated", String(ig.aiGenerated));
    const collab = ig.collab.trim().replace(/^@+/, "");
    if (collab) form.append("instagram_collaborators", collab);
    const audio = ig.audioName.trim();
    if (audio) form.append("audio_name", audio);
  }

  if (platforms.includes("youtube")) {
    const yt = options.youtube;
    form.append("privacyStatus", yt.visibility.toLowerCase());
    form.append("selfDeclaredMadeForKids", String(yt.madeForKids));
    form.append("embeddable", String(yt.embeddable));
    form.append("license", yt.license === "Creative Commons" ? "creativeCommon" : "youtube");
    form.append("hasPaidProductPlacement", String(yt.paidPromotion));
    form.append("containsSyntheticMedia", String(yt.aiGenerated));
    const category = YOUTUBE_CATEGORY_ID[yt.category];
    if (category) form.append("categoryId", category);
    for (const tag of yt.tags) {
      const clean = tag.trim().replace(/^#+/, "");
      if (clean) form.append("tags[]", clean);
    }
  }

  if (platforms.includes("facebook")) {
    const fb = options.facebook;
    form.append(
      "facebook_media_type",
      fb.mediaType === "Story" ? "STORIES" : fb.mediaType === "Video" ? "VIDEO" : "REELS"
    );
    form.append("video_state", fb.draft ? "DRAFT" : "PUBLISHED");
  }
}

/* ------------------------------------------------------------------- status */

export type JobStatus = {
  /** pending | queued | processing | in_progress | completed | failed |
   *  not_found. 'failed' is terminal; 'not_found' is indeterminate — a job
   *  their status endpoint has momentarily lost is not a failed post, so
   *  callers must never auto-fail on it. */
  status?: string;
  results?: {
    platform?: string;
    success?: boolean;
    post_url?: string;
    url?: string;
    error_message?: string;
    message?: string;
  }[];
};

/** GET /uploadposts/status — job_id for scheduled posts, request_id for async
 *  immediate uploads. Exactly one. */
export function getJobStatus(
  params: { jobId: string } | { requestId: string },
  key?: string | null
): Promise<JobStatus> {
  const query =
    "jobId" in params
      ? `job_id=${encodeURIComponent(params.jobId)}`
      : `request_id=${encodeURIComponent(params.requestId)}`;
  return api<JobStatus>(`/uploadposts/status?${query}`, {}, TIMEOUT_MS, key);
}

/**
 * PATCH /uploadposts/schedule/{job_id}. The only things their scheduler will
 * change on a job in place: when it fires, and the words on it.
 *
 * Not the media, not the platform list, and none of the platform-specific
 * overrides `publishVideo` sends — `youtube_title` above all. That gap is why
 * the caller has a second path: see `editPost`.
 *
 * `scheduled_date` is read as UTC unless a `timezone` is sent with it, so this
 * always sends the instant with its Z and never sends a zone. The wall clock a
 * creator picked was already turned into an instant on the way in, and handing
 * over both would be two answers to one question.
 *
 * A 404 means the job is gone: fired, or already canceled. Handed back as
 * false the way `cancelScheduledJob` does, because what a missing job means is
 * the caller's row to decide.
 */
export async function editScheduledJob(
  jobId: string,
  patch: { scheduledDate?: string; caption?: string },
  key?: string | null
): Promise<boolean> {
  const body: Record<string, string> = {};
  if (patch.scheduledDate) body.scheduled_date = patch.scheduledDate;
  if (patch.caption !== undefined) {
    // one caption, both fields. `title` is what `publishVideo` sent in the
    // first place; `caption` is what their scheduler hands the platforms that
    // keep a description apart from a title. Sending one and not the other
    // leaves a job saying two different things depending on where it lands.
    body.title = patch.caption;
    body.caption = patch.caption;
  }
  if (Object.keys(body).length === 0) return true;

  try {
    await api(
      `/uploadposts/schedule/${encodeURIComponent(jobId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      TIMEOUT_MS,
      key
    );
    return true;
  } catch (err) {
    if (err instanceof UploadPostError && err.status === 404) return false;
    throw err;
  }
}

/**
 * DELETE /uploadposts/schedule/{job_id}. A 404 means the job already fired or
 * was already canceled — the caller decides what that means for its row.
 */
export async function cancelScheduledJob(
  jobId: string,
  key?: string | null
): Promise<boolean> {
  try {
    await api(
      `/uploadposts/schedule/${encodeURIComponent(jobId)}`,
      { method: "DELETE" },
      TIMEOUT_MS,
      key
    );
    return true;
  } catch (err) {
    if (err instanceof UploadPostError && err.status === 404) return false;
    throw err;
  }
}
