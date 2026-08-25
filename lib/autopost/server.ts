import "server-only";

/**
 * The autopost feature's server half: the profile a creator owns, the queue of
 * posts, and the reconcile pass that keeps the queue honest.
 *
 * Reconcile happens on page load rather than on a cron, deliberately. The rows
 * in flight at any moment are the handful this creator scheduled, the check is
 * one status call per row, and a creator looking at the queue is the exact
 * moment stale state matters. A cron earns its place when posts need to
 * advance while nobody is looking (webhooks, notifications); nothing shown
 * today does.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTOPOST_PLATFORMS,
  connectedOf,
  createManagedProfile,
  getJobStatus,
  getProfile,
  listFacebookPages,
  whiteLabelLink,
  type AutopostPlatform,
  type FacebookPage,
  type JobStatus,
  type PublishResult,
} from "@/lib/autopost/upload-post";
import { emailForUser, notificationHtml, sendEmail } from "@/lib/email/send";
import { parseHandle } from "@/lib/ingest/urls";
import { onBooks, type DealScope } from "@/lib/workspace";

export type SocialProfile = {
  user_id: string;
  /** the deal these connections belong to. one profile per (creator, deal). */
  deal_id: string;
  upload_post_username: string;
  /** platform → handle, as last refreshed. */
  connected: Record<string, string>;
  /** which facebook Page a post goes to. null when facebook is not connected,
   *  or when several pages are and nobody has picked yet. */
  facebook_page_id: string | null;
  last_checked_at: string | null;
};

const PROFILE_SELECT =
  "user_id, deal_id, upload_post_username, connected, facebook_page_id, last_checked_at";

export type SocialPost = {
  id: string;
  user_id: string;
  deal_id: string | null;
  caption: string;
  platforms: AutopostPlatform[];
  video_url: string;
  scheduled_for: string | null;
  status: "scheduled" | "processing" | "posted" | "partial" | "failed" | "canceled";
  job_id: string | null;
  request_id: string | null;
  results: { platform: string; success: boolean; url: string | null; error: string | null }[];
  error: string | null;
  created_at: string;
  /** when the owner was emailed about this row reaching a terminal status.
   *  null means nobody has been told yet. */
  notified_at: string | null;
};

const POST_SELECT =
  "id, user_id, deal_id, caption, platforms, video_url, scheduled_for, status, job_id, request_id, results, error, created_at, notified_at";

/**
 * The managed-profile username for one deal. Deterministic, so creating it
 * twice lands on the same profile and a 409 upstream is success.
 *
 * The deal id alone would be unique — it is a uuid — but the creator prefix is
 * what makes the Upload-Post dashboard readable when something needs chasing by
 * hand up there. Prefixed `ugc_` so the profiles read as ours.
 */
export function usernameFor(userId: string, dealId: string): string {
  return `ugc_${userId.replace(/-/g, "").slice(0, 8)}_${dealId.replace(/-/g, "")}`;
}

/**
 * The profile row for one deal, created on both sides on first touch: upstream
 * first, ours second, so a row in our table always has a profile behind it.
 */
export async function ensureProfile(
  db: SupabaseClient,
  userId: string,
  dealId: string
): Promise<SocialProfile> {
  const { data: existing } = await db
    .from("social_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (existing) return existing as SocialProfile;

  const username = usernameFor(userId, dealId);
  await createManagedProfile(username);

  const { data, error } = await db
    .from("social_profiles")
    .upsert(
      { user_id: userId, deal_id: dealId, upload_post_username: username },
      { onConflict: "user_id,deal_id" }
    )
    .select(PROFILE_SELECT)
    .single();

  if (error || !data) throw new Error(error?.message ?? "could not save the profile");
  return data as SocialProfile;
}

/**
 * Where a creator lands when they come back from Upload-Post.
 *
 * `from` is an enum rather than a url, and the path is built here. The value
 * reaches this function from a browser, and it ends up as a redirect target on
 * our own domain handed to a third party: taking a string would be an open
 * redirect with extra steps.
 */
export type ConnectOrigin = "social" | "deal";

export function connectReturnPath(origin: ConnectOrigin, dealId: string): string {
  // "social" is the composer, which is a tab on the deal now rather than a page
  // under its own rail row. The enum values stay as they are: they are internal
  // names for two places to come back to, not urls, and that is the whole point
  // of them being an enum.
  return origin === "deal"
    ? `/deals/${dealId}/edit#accounts`
    : `/tools/autoposting?deal=${dealId}`;
}

/** The connect URL for one deal, back to the page the button was pressed on —
 *  they connected something, they should land where it now shows. */
export async function connectUrl(
  db: SupabaseClient,
  userId: string,
  dealId: string,
  origin: ConnectOrigin = "social"
): Promise<string> {
  const profile = await ensureProfile(db, userId, dealId);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return whiteLabelLink(
    profile.upload_post_username,
    `${site}${connectReturnPath(origin, dealId)}`
  );
}

/**
 * Pull what is actually connected from Upload-Post and cache it on the row.
 * The cache is for display; publishing does not read it.
 *
 * Scoped to the deal, which it was not: the update matched on `user_id` alone,
 * so refreshing one brand's profile wrote its handles onto every other brand's
 * row. A creator with two deals then saw whichever they opened last on both.
 */
export async function refreshProfile(
  db: SupabaseClient,
  profile: SocialProfile
): Promise<{ profile: SocialProfile; facebookPages: FacebookPage[] }> {
  const upstream = await getProfile(profile.upload_post_username).catch(() => null);
  if (!upstream) return { profile, facebookPages: [] };

  const connected = connectedOf(upstream);

  // one page is not a question worth asking, so it is settled here. none or
  // several stays null and the composer asks. dropping facebook clears it, so
  // reconnecting a different page can never post to the old one. the lookup
  // happens at most once per request: it is handed back below rather than
  // asked for again by whoever called this.
  let facebookPageId = profile.facebook_page_id;
  let facebookPages: FacebookPage[] = [];
  if (!connected.facebook) {
    facebookPageId = null;
  } else if (!facebookPageId) {
    facebookPages = await listFacebookPages(profile.upload_post_username).catch(() => []);
    facebookPageId = facebookPages.length === 1 ? facebookPages[0].id : null;
  }

  const checkedAt = new Date().toISOString();
  await db
    .from("social_profiles")
    .update({ connected, facebook_page_id: facebookPageId, last_checked_at: checkedAt })
    .eq("user_id", profile.user_id)
    .eq("deal_id", profile.deal_id);

  return {
    profile: { ...profile, connected, facebook_page_id: facebookPageId, last_checked_at: checkedAt },
    facebookPages,
  };
}

/**
 * Posting and tracking are the same account, so connecting one is adding the
 * other.
 *
 * The two halves used to be kept by hand on two pages: /social held what was
 * connected for posting, the deal held the handles the scraper reads, and
 * nothing tied them together. Connecting an instagram on /social left the deal
 * with no instagram to track, and a deal with a tiktok typed in showed "not
 * linked" on /social. Same account, two places, either one silently empty.
 *
 * So a connection now writes the tracking row it implies:
 *
 * - platform with no row     → insert it, source 'oauth', handle from the login.
 * - row we created ('oauth') → update the handle if the login now says a
 *                              different one, because the login is the truth.
 * - row somebody typed in    → left exactly alone. a hand-typed handle is a
 *                              deliberate statement and this is not the place to
 *                              overrule it.
 *
 * Never the other way round: adding a handle on the deal cannot connect an
 * account, because connecting means logging in on the platform's own page.
 * Tracking without posting is a first-class state, and it is the state every
 * creator who does not want autoposting lives in.
 */
export async function attachConnectedAccounts(
  db: SupabaseClient,
  userId: string,
  dealId: string,
  connected: Record<string, string>
): Promise<void> {
  const wanted = AUTOPOST_PLATFORMS.map((platform) => {
    const raw = String(connected[platform] ?? "").trim();
    // connectedOf falls back to the literal "connected" when upstream exposes no
    // username at all. that is a state, not a handle, and it passes every shape
    // check parseHandle makes — so it is rejected by name. the cost of being
    // wrong is that somebody actually called @connected types their handle in by
    // hand; the cost of not doing it is the scraper being pointed at a word.
    const handle = raw.toLowerCase() === "connected" ? null : parseHandle(raw, platform);
    return { platform, handle };
  }).filter((w): w is { platform: AutopostPlatform; handle: string } => Boolean(w.handle));

  if (wanted.length === 0) return;

  const { data: rows } = await db
    .from("deal_accounts")
    .select("id, platform, handle, source")
    .eq("deal_id", dealId);

  const existing = new Map(
    ((rows ?? []) as { id: string; platform: string; handle: string; source: string }[]).map(
      (r) => [r.platform, r] as const
    )
  );

  for (const { platform, handle } of wanted) {
    const row = existing.get(platform);

    if (!row) {
      // a race with the same reconcile running twice loses to the unique key on
      // (deal_id, platform), which is the right outcome: one of them wins and
      // neither has to check first.
      await db
        .from("deal_accounts")
        .insert({ user_id: userId, deal_id: dealId, platform, handle, source: "oauth" })
        .then(() => undefined, () => undefined);
      continue;
    }

    if (row.source === "oauth" && row.handle.toLowerCase() !== handle.toLowerCase()) {
      await db.from("deal_accounts").update({ handle }).eq("id", row.id);
    }
  }
}

/** How stale a cached connection list may be before a page re-reads upstream.
 *  Long enough that a render pass does not double-call, short enough that coming
 *  back from the connect page shows what was just connected. */
const CONNECTION_TTL_MS = 20_000;

export type Connections = {
  /** platform → handle, as Upload-Post last reported it. */
  connected: Record<string, string>;
  lastCheckedAt: string | null;
  /** false when UPLOAD_POST_API_KEY is unset: connecting is off, not broken. */
  configured: boolean;
};

/**
 * What this deal has connected for posting, refreshed if the cache is stale, and
 * reconciled into the deal's tracked accounts either way.
 *
 * The one entry point both sides use, so /social and the deal's own settings
 * cannot disagree about what is connected. It never creates a profile: a deal
 * nobody has pressed connect on has no row and no upstream call, and reads as
 * "nothing connected" rather than costing a request to find that out.
 */
export async function loadConnections(
  db: SupabaseClient,
  userId: string,
  dealId: string
): Promise<Connections> {
  const configured = Boolean(process.env.UPLOAD_POST_API_KEY);

  const { data } = await db
    .from("social_profiles")
    .select(PROFILE_SELECT)
    .eq("user_id", userId)
    .eq("deal_id", dealId)
    .maybeSingle();

  let profile = (data as SocialProfile | null) ?? null;
  if (!profile) return { connected: {}, lastCheckedAt: null, configured };

  const age = profile.last_checked_at
    ? Date.now() - new Date(profile.last_checked_at).getTime()
    : Infinity;

  if (configured && age > CONNECTION_TTL_MS) {
    // loadConnections has no picker to show, so the pages refreshProfile may
    // have looked up are not its concern: only the profile half is kept.
    const refreshed = await refreshProfile(db, profile).catch(() => null);
    if (refreshed) profile = refreshed.profile;
  }

  await attachConnectedAccounts(db, userId, dealId, profile.connected ?? {}).catch(() => {});

  return {
    connected: profile.connected ?? {},
    lastCheckedAt: profile.last_checked_at,
    configured,
  };
}

/* ------------------------------------------------------------------ statuses */

type Patch = {
  status?: SocialPost["status"];
  results?: SocialPost["results"];
  error?: string | null;
  notified_at?: string | null;
};

function resultsOf(status: JobStatus): SocialPost["results"] {
  return (status.results ?? []).map((r) => ({
    platform: r.platform ?? "unknown",
    success: r.success === true,
    url: r.post_url ?? r.url ?? null,
    error: r.error_message ?? r.message ?? null,
  }));
}

/** completed → posted/partial/failed by how many platforms made it. */
function settle(results: SocialPost["results"], wanted: number): SocialPost["status"] {
  const ok = results.filter((r) => r.success).length;
  if (ok === 0) return "failed";
  return ok < wanted ? "partial" : "posted";
}

/**
 * One post's next state, from a status poll. 'not_found' is indeterminate —
 * their status endpoint momentarily losing a job is not a failed post, a
 * lesson the sister project's engine learned in production — so it changes
 * nothing and the next load asks again.
 */
function patchFor(post: SocialPost, status: JobStatus): Patch | null {
  const s = (status.status ?? "").toLowerCase();

  if (s === "completed") {
    const results = resultsOf(status);
    return { status: settle(results, post.platforms.length), results, error: null };
  }
  if (s === "failed") {
    const results = resultsOf(status);
    return {
      status: "failed",
      results,
      error: results.find((r) => r.error)?.error ?? "the post failed upstream",
    };
  }
  // a scheduled row whose slot has passed is now processing on their side;
  // reflect that so the queue reads honestly while it uploads.
  if (post.status === "scheduled" && ["processing", "in_progress"].includes(s)) {
    return { status: "processing" };
  }
  return null;
}

const TERMINAL: SocialPost["status"][] = ["posted", "partial", "failed"];

/** third-party error text lands in an html body, so it is escaped here rather
 *  than trusted. the platform names are ours; the messages are not. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One line per platform, honest about every one of them.
 *
 * A partial post is the case this exists for: two platforms live and one
 * refused is not "posted" and not "failed", and an email that only reported the
 * winners would be how somebody finds out a week later.
 */
function outcomeLines(post: SocialPost): string[] {
  return post.platforms.map((platform) => {
    const result = post.results?.find((r) => r.platform === platform);
    if (!result) return `${esc(platform)}: no outcome came back`;
    if (result.success) {
      return result.url
        ? `${esc(platform)}: <a href="${esc(result.url)}" style="color:#f97316;">${esc(result.url)}</a>`
        : `${esc(platform)}: live`;
    }
    return `${esc(platform)}: ${esc(result.error ?? "did not go out")}`;
  });
}

/**
 * Tell the owner their post landed, or did not.
 *
 * Best effort by construction: it runs after the row was already written, and
 * `sendEmail` never throws. A mailbox being down must not roll back a status
 * the creator can see on the page.
 */
async function notifyOutcome(db: SupabaseClient, post: SocialPost): Promise<void> {
  try {
    const to = await emailForUser(db, post.user_id, "notify_posts");
    if (!to) return;

    const failed = post.status === "failed";
    const caption = post.caption.trim().slice(0, 80);
    const lines = [
      ...(caption ? [`"${esc(caption)}${post.caption.trim().length > 80 ? "..." : ""}"`] : []),
      ...outcomeLines(post),
    ];

    await sendEmail({
      to,
      subject: failed ? "a post did not go out" : "your post is live",
      html: notificationHtml({
        heading: failed ? "a post did not go out" : "your post is live",
        lines,
        cta: { label: "see your queue", url: "https://www.creatorempire.app/social" },
      }),
    });
  } catch {
    // a courtesy on top of work that already finished
  }
}

/**
 * Ask upstream about every row still in flight and fold the answers in.
 * Serial on purpose: it is rarely more than two rows, and a burst of parallel
 * status calls is how a rate limit finds you.
 *
 * This is also where the outcome email is sent, because this is the only place
 * a row reaches a terminal status while nobody is necessarily watching. It runs
 * on page load, so `notified_at` is what stops a second render sending a second
 * copy: it goes into the same update that writes the status, so there is no
 * window where the row is terminal and unmarked, and it is set whether or not
 * the send worked. A flaky mailbox costs one missed email, never a repeat on
 * every refresh.
 */
export async function reconcilePosts(
  db: SupabaseClient,
  posts: SocialPost[]
): Promise<SocialPost[]> {
  const out: SocialPost[] = [];

  for (const post of posts) {
    const pending = post.status === "scheduled" || post.status === "processing";
    const ref = post.job_id
      ? ({ jobId: post.job_id } as const)
      : post.request_id
        ? ({ requestId: post.request_id } as const)
        : null;

    if (!pending || !ref) {
      out.push(post);
      continue;
    }

    const status = await getJobStatus(ref).catch(() => null);
    const patch = status ? patchFor(post, status) : null;

    if (!patch) {
      out.push(post);
      continue;
    }

    // terminal for the first time: mark it told in the same statement that
    // makes it terminal, so two page loads racing cannot both send.
    const announce =
      Boolean(patch.status) &&
      TERMINAL.includes(patch.status as SocialPost["status"]) &&
      !post.notified_at;
    if (announce) patch.notified_at = new Date().toISOString();

    const { error } = await db.from("social_posts").update(patch).eq("id", post.id);
    const next = { ...post, ...patch } as SocialPost;

    // a write that did not land leaves the row untouched, so it is still
    // pending and the next load reconciles it again. emailing here would be
    // announcing a status nobody stored.
    if (!error && announce) await notifyOutcome(db, next);

    out.push(next);
  }

  return out;
}

/**
 * What a fresh publish response means for the row. Three shapes come back:
 * sync per-platform results (row is born terminal), a request_id (async, poll
 * it), or a job_id (scheduled, their scheduler owns it).
 */
export function rowFromPublish(
  result: PublishResult,
  platformCount: number
): {
  status: SocialPost["status"];
  job_id: string | null;
  request_id: string | null;
  results: SocialPost["results"];
} {
  if (result.job_id) {
    return { status: "scheduled", job_id: result.job_id, request_id: null, results: [] };
  }
  if (result.request_id) {
    return { status: "processing", job_id: null, request_id: result.request_id, results: [] };
  }

  const results = Object.entries(result.results ?? {}).map(([platform, r]) => ({
    platform,
    success: r.success === true,
    url: r.post_url ?? r.url ?? null,
    error: r.error ?? null,
  }));

  // no job, no request id and no per-platform results is a shape the api does
  // not promise. a row born "processing" with nothing to poll would sit in the
  // queue forever, so it fails loudly instead and nothing upstream was lost:
  // there is no id because there is no upstream job.
  if (results.length === 0) {
    return {
      status: "failed",
      job_id: null,
      request_id: null,
      results: [
        {
          platform: "all",
          success: false,
          url: null,
          error: result.message ?? "the posting service returned no outcome",
        },
      ],
    };
  }

  return {
    status: settle(results, platformCount),
    job_id: null,
    request_id: null,
    results,
  };
}

/* -------------------------------------------------------------- page loader */

export type AutopostData = {
  /** null until the first connect click creates it. */
  profile: SocialProfile | null;
  posts: SocialPost[];
  configured: boolean;
  /** only non-empty when facebook is connected, several pages exist and none has
   *  been picked. the composer turns this into one select and nothing else. */
  facebookPages: FacebookPage[];
};

/** One deal's connections and its own queue. Nothing here crosses deals. */
export async function loadAutopost(
  db: SupabaseClient,
  userId: string,
  dealId: string
): Promise<AutopostData> {
  const configured = Boolean(process.env.UPLOAD_POST_API_KEY);

  const [{ data: profileRow }, { data: postRows }] = await Promise.all([
    db
      .from("social_profiles")
      .select(PROFILE_SELECT)
      .eq("user_id", userId)
      .eq("deal_id", dealId)
      .maybeSingle(),
    db
      .from("social_posts")
      .select(POST_SELECT)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  let profile = (profileRow as SocialProfile | null) ?? null;
  let posts = (postRows ?? []) as SocialPost[];
  // refreshProfile below is the only place that looks up facebook pages: it
  // hands back what it found so this never asks upstream a second time for
  // the same answer in the same request.
  let facebookPages: FacebookPage[] = [];

  if (configured && profile) {
    // both passes talk to upload-post and both survive it being down: the page
    // then shows the cache, which is the whole reason the cache exists.
    const refreshed = await refreshProfile(db, profile).catch(() => null);
    if (refreshed) {
      profile = refreshed.profile;
      facebookPages = refreshed.facebookPages;
    }
    posts = await reconcilePosts(db, posts).catch(() => posts);
  }

  if (profile) {
    // connecting an account for posting is adding it to the deal. doing it here
    // rather than only on the deal's page means it lands the moment upload-post
    // reports the connection, whichever page the creator was standing on.
    await attachConnectedAccounts(db, userId, dealId, profile.connected ?? {}).catch(() => {});
  }

  // no fallback lookup here on purpose: the only state that needs an answer
  // (facebook connected, no page picked) requires a profile row and
  // `configured`, and that is exactly the condition refreshProfile just ran
  // under above. there is nothing left for a second call to cover.
  return { profile, posts, configured, facebookPages };
}

/* ------------------------------------------------------------- the deal list */

export type AutopostDeal = {
  dealId: string;
  dealName: string;
  status: string;
  brand: { name: string; logo_key: string | null; logo_url: string | null };
  /** platform → handle for this deal's own profile. empty means not connected. */
  connected: Record<string, string>;
  /** scheduled or mid-flight right now. */
  queued: number;
  posted: number;
  /** the soonest thing still due to fire. */
  nextAt: string | null;
  /** the last thing sent from this deal, scheduled or not. */
  lastAt: string | null;
};

/**
 * Every deal with the state of its own posting, for the picker.
 *
 * Three queries, no upstream calls: the list is a menu, and a page that reads
 * Upload-Post once per deal to render a menu would take a second per brand to
 * paint. The cached `connected` blob is what the rows show and the deal's own
 * page is where a live refresh happens, which is the same bargain the queue
 * already makes.
 */
export async function loadAutopostDeals(
  db: SupabaseClient,
  userId: string,
  /** whose books: the creator's own or the agency seat they switched into. */
  scope: DealScope
): Promise<AutopostDeal[]> {
  const [{ data: dealRows }, { data: profileRows }, { data: postRows }] = await Promise.all([
    db
      .from("deals")
      .select("id, name, status, brand:brands(name, logo_key, logo_url)")
      .filter(...onBooks(scope))
      .order("created_at", { ascending: false }),
    db.from("social_profiles").select("deal_id, connected").eq("user_id", userId),
    db
      .from("social_posts")
      .select("deal_id, status, scheduled_for, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const connectedBy = new Map<string, Record<string, string>>();
  for (const p of profileRows ?? []) {
    if (!p.deal_id) continue; // the pre-per-deal row. belongs to no brand.
    connectedBy.set(p.deal_id as string, (p.connected ?? {}) as Record<string, string>);
  }

  const statsBy = new Map<string, { queued: number; posted: number; nextAt: string | null; lastAt: string | null }>();
  const now = Date.now();
  for (const post of postRows ?? []) {
    const key = post.deal_id as string | null;
    if (!key) continue;
    const s = statsBy.get(key) ?? { queued: 0, posted: 0, nextAt: null, lastAt: null };

    if (post.status === "scheduled" || post.status === "processing") s.queued += 1;
    if (post.status === "posted" || post.status === "partial") s.posted += 1;

    const fires = post.scheduled_for as string | null;
    if (
      post.status === "scheduled" &&
      fires &&
      new Date(fires).getTime() > now &&
      (!s.nextAt || fires < s.nextAt)
    ) {
      s.nextAt = fires;
    }
    // rows arrive newest first, so the first one seen is the latest
    if (!s.lastAt) s.lastAt = post.created_at as string;

    statsBy.set(key, s);
  }

  return (dealRows ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      name: string;
      status: string;
      brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
    };
    const s = statsBy.get(r.id) ?? { queued: 0, posted: 0, nextAt: null, lastAt: null };

    return {
      dealId: r.id,
      dealName: r.name,
      status: r.status,
      brand: r.brand ?? { name: "unknown", logo_key: null, logo_url: null },
      connected: connectedBy.get(r.id) ?? {},
      ...s,
    };
  });
}
