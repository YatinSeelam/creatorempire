"use server";

/**
 * Every write the editor side makes. All of it runs as the signed-in user
 * against RLS, so the only thing an action proves is that somebody is signed
 * in; `editor_id` and `author_id` come off the session, never off the form.
 * Money is cents end to end, same as everywhere else in the app.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  asLinkItems,
  asReelClips,
  asStringList,
  normalizeHandle,
  safeUrl,
  type EditorStatus,
} from "@/lib/editing";
import { COUNTRIES } from "@/lib/countries";
import { notifyJobClaimed, notifyJobReopened } from "@/lib/editing-notify";
import { push } from "@/lib/notify-server";
import { money, parseCents, parseCount } from "@/lib/money";
import { canAutoSend, paypalConfigured, sendPayout } from "@/lib/payouts/paypal";
import {
  createAccountLink,
  createExpressAccount,
  createLoginLink,
  getAccount,
  sendTransfer,
  stripeConnectConfigured,
} from "@/lib/payouts/stripe-connect";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { turnaroundHours } from "@/lib/credits";

export type EditorActionState = { error?: string; ok?: string };

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const text = (value: FormDataEntryValue | null, max: number): string | null => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};

/** "capcut, premiere,, davinci" → ["capcut", "premiere", "davinci"]. */
const commaList = (value: FormDataEntryValue | null, max: number): string[] =>
  String(value ?? "")
    .split(",")
    .map((s) => s.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, max);

// links go through safeUrl from lib/editing: scheme-less input is read as
// https, anything that is not http(s) is dropped rather than stored.

/**
 * A photo url is only trusted when we minted it, for this person.
 *
 * The picker uploads to the public `portfolio` bucket under the uploader's own
 * uid and puts the url it got back in a hidden field, which means the value
 * arriving here is a string a hand-edited form could have written. Anything
 * that is not our storage under THEIR folder comes back null, and a null is
 * "leave whatever photo they already have alone" rather than an error: an
 * editor who signed in with google already has a picture, and the edit form
 * submits it back untouched every time they change a phone number.
 */
function ownAvatarUrl(value: string | null, userId: string): string | null {
  if (!value) return null;
  // trimmed, because the env var has carried a trailing space before now.
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const mine = `${base}/storage/v1/object/public/portfolio/${userId}/`;
  return value.startsWith(mine) ? value : null;
}

/** two words. see the wizard for why a bare `name` was not enough. */
const isFullName = (value: string) => /\S\s+\S/.test(value.trim());

// -------------------------------------------------------------------- apply

/**
 * The application. Two writes, in this order:
 *
 *  1. `editor_applications` — the answers staff read. Contact details live here
 *     rather than on `editors` because `editors` goes public the moment a
 *     portfolio is published, and a phone number must not.
 *  2. `editors` — the free portfolio, seeded with what the form already knows
 *     so /editors/profile opens with the name and software filled in. It is
 *     also where the name and the photo LIVE: `editor_applications` is a
 *     snapshot of a form, `editors` is who this person is, and a job's stamp
 *     (see the 20260821260000 migration) reads the second one.
 *  3. `profiles` — the same name and photo again, because that is the table
 *     the rest of the product reads and two identities is none.
 *
 * Both of those are best effort: an application that landed is the thing that
 * matters. An `editors` row that already exists is updated on name and photo
 * only, never replaced, because it may carry a handle, a bio and a reel this
 * form has never heard of.
 *
 * Re-applying updates in place rather than upserting. `user_id` is not granted
 * for UPDATE, so an `on conflict do update` naming it would be refused by the
 * column grant before any policy got a look.
 */
export async function submitEditorApplication(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const name = text(formData.get("name"), 80);
  if (!name) return { error: "tell us your name." };
  if (!isFullName(name)) return { error: "first and last name, not a handle." };

  // null means "nothing new was uploaded", which is fine if they already have
  // one. what they end up with is resolved against the existing row below.
  const uploadedAvatar = ownAvatarUrl(text(formData.get("avatar_url"), 600), user.id);

  const phone = text(formData.get("phone"), 40);
  if (!phone) return { error: "add a phone number so we can reach you." };

  // the wizard requires these on its own screens; re-checked here so the
  // edit form and a hand-rolled post play by the same rules.
  const country = text(formData.get("country"), 80);
  if (!country) return { error: "pick your country." };
  const timezone = text(formData.get("timezone"), 80);
  if (!timezone) return { error: "pick your time zone." };
  const languages = text(formData.get("languages"), 160);
  if (!languages) return { error: "tell us what languages you speak." };

  const perDayRaw = text(formData.get("videos_per_day"), 10);
  const videos_per_day = perDayRaw ? parseCount(perDayRaw) : null;
  if (perDayRaw && (videos_per_day === null || videos_per_day > 100)) {
    return { error: "videos a day has to be a whole number, 100 or under." };
  }

  const hoursRaw = text(formData.get("hours_per_week"), 10);
  const hours_per_week = hoursRaw ? parseCount(hoursRaw) : null;
  if (hoursRaw && (hours_per_week === null || hours_per_week > 168)) {
    return { error: "hours a week has to be a whole number, 168 or under." };
  }

  const portfolioRaw = text(formData.get("portfolio_url"), 500);
  const portfolio_url = portfolioRaw ? safeUrl(portfolioRaw) : null;
  if (portfolioRaw && !portfolio_url) {
    return { error: "that portfolio link does not look like a url." };
  }

  const software = commaList(formData.get("software"), 20);

  const answers = {
    name,
    email: text(formData.get("email"), 160) ?? user.email ?? null,
    phone,
    discord: text(formData.get("discord"), 80),
    location: text(formData.get("location"), 80),
    country,
    timezone,
    languages,
    portfolio_url,
    software,
    videos_per_day,
    hours_per_week,
    weekends: formData.get("weekends") === "on",
    experience: text(formData.get("experience"), 400),
    note: text(formData.get("note"), 1000),
  };

  const [{ data: existing }, { data: portfolioRow }] = await Promise.all([
    supabase
      .from("editor_applications")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle(),
    // `editors.avatar_url` is where a photo lives. reading it first is what
    // lets a re-application keep the one they already have.
    supabase
      .from("editors")
      .select("user_id, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const avatar_url =
    uploadedAvatar || (portfolioRow?.avatar_url as string | null) || null;
  if (!avatar_url) return { error: "add a photo of yourself." };

  const { error } = existing
    ? await supabase
        .from("editor_applications")
        .update(answers)
        .eq("user_id", user.id)
    : await supabase
        .from("editor_applications")
        .insert({ user_id: user.id, ...answers });

  if (error) return { error: error.message };

  // the free portfolio, and the only place a name and a face are stored. an
  // existing row is updated on those two columns ONLY: it may already carry a
  // handle, a bio and a reel this form knows nothing about, and re-applying to
  // fix a phone number must not empty any of that.
  if (portfolioRow) {
    await supabase
      .from("editors")
      .update({ name, avatar_url })
      .eq("user_id", user.id);
  } else {
    await supabase.from("editors").insert({
      user_id: user.id,
      handle: "",
      name,
      avatar_url,
      location: answers.location,
      software,
      links: portfolio_url ? [{ url: portfolio_url, label: "portfolio" }] : [],
    });
  }

  // one identity, not two. `profiles` is what the rest of the product reads,
  // and a google display name like "Vintage Mercenary" next to a real name on
  // the editor row is the founder having to guess which is the person. best
  // effort: the application landing is what matters.
  await supabase
    .from("profiles")
    .update({ full_name: name, avatar_url })
    .eq("id", user.id);

  revalidatePath("/editors");
  revalidatePath("/editors/settings");
  return { ok: "your editor account is live." };
}

// -------------------------------------------------------------------- claim

/** The rpc's raise messages, turned into sentences an editor can act on. */
const CLAIM_ERRORS: [string, string][] = [
  ["no editor profile", "set up your editor profile first."],
  ["profile paused", "your profile is paused. flip it to active before claiming."],
  ["own job", "this one is yours. you cannot claim your own job."],
  ["already claimed", "somebody beat you to this one."],
  [
    "tier locked",
    "full-edit jobs unlock at the proven tier: 10 approved jobs with a 90% on-time rate. keep clearing $1 jobs.",
  ],
  [
    "claim cap",
    "you are at your claim limit. deliver or release something before taking more.",
  ],
];

/**
 * The claim goes through `claim_edit_job`, which takes a row lock and checks
 * everything in one transaction: profile active, not your own job, the tier
 * gate, the concurrent claim cap, then first-lock-wins. Two editors hitting
 * the button at once resolve in the database, and the loser gets a sentence.
 * The sla clock (24h, 6h rush) starts inside the rpc.
 */
export async function claimJob(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const id = text(formData.get("job_id"), 40);
  if (!id) return { error: "missing job." };

  const { error } = await supabase.rpc("claim_edit_job", { p_job: id });
  if (error) {
    const friendly = CLAIM_ERRORS.find(([key]) => error.message.includes(key));
    return { error: friendly ? friendly[1] : error.message };
  }

  // tell the channel it is gone, so it stops advertising work nobody can take.
  // best effort and after the fact: the claim already landed.
  const [{ data: job }, { data: me }] = await Promise.all([
    supabase
      .from("edit_jobs")
      .select("user_id, title, brand_name, is_rush")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("editor_applications")
      .select("name")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (job) {
    const editorName = String(me?.name ?? "an editor");
    await Promise.all([
      notifyJobClaimed({
        title: String(job.title),
        editorName,
        hours: turnaroundHours(job.is_rush),
        brand_name: job.brand_name as string | null,
      }),
      // the creator posted this and walked away. the bell is the only thing
      // that tells them somebody picked it up without an email being on.
      push({
        userId: String(job.user_id),
        kind: "job_claimed",
        title: `${editorName} claimed ${String(job.title)}`,
        body: `first cut due in ${turnaroundHours(job.is_rush)} hours`,
        href: `/editing/${id}`,
        subject: id,
      }),
    ]);
  }

  revalidatePath("/editors");
  revalidatePath("/editors/market");
  redirect(`/editors/jobs/${id}`);
}

/**
 * Hand a claim back. Free inside the first two hours; after that it still
 * works but records a late-release strike, which the rpc decides, not the
 * client's clock. Either way beats letting the sla expire.
 */
export async function releaseClaim(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const id = text(formData.get("job_id"), 40);
  if (!id) return { error: "missing job." };

  const { data: job } = await supabase
    .from("edit_jobs")
    .select("user_id, title, brand_name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.rpc("release_edit_job", { p_job: id });
  if (error) {
    return {
      error: error.message.includes("only a claimed job")
        ? "only a job still in edit can be released."
        : error.message.includes("not your job")
          ? "this is not your claim."
          : error.message,
    };
  }

  if (job) {
    await Promise.all([
      notifyJobReopened({
        title: String(job.title),
        reason: "released",
        brand_name: job.brand_name as string | null,
      }),
      // flame tone: the job went backwards and the creator's clock restarted.
      push({
        userId: String(job.user_id),
        kind: "job_released",
        title: `${String(job.title)} is back on the board`,
        body: "the editor handed the claim back. somebody else can take it.",
        href: `/editing/${id}`,
        subject: id,
      }),
    ]);
  }

  revalidatePath("/editors");
  revalidatePath("/editors/market");
  redirect("/editors/market");
}

// ---------------------------------------------------------------- workspace

/**
 * Ring the creator's bell for a delivery.
 *
 * Shared by both cut paths — a pasted link and an uploaded file — because they
 * are the same event to the person receiving it, and the only thing that ever
 * differs is which of the two wrote the deliverable row.
 */
async function tellCreatorDelivered(
  job: { id: string; user_id: string; title: string },
  version: number
): Promise<void> {
  await push({
    userId: String(job.user_id),
    kind: "cut_delivered",
    title: `cut v${version} is in for ${String(job.title)}`,
    body: "watch it, then approve it or send it back.",
    href: `/editing/${job.id}`,
    subject: String(job.id),
  });
}

/**
 * A cut is three writes: the deliverable, the status flip to delivered, and a
 * status event on the timeline. Version numbers just count up, revisions
 * included, so "v3" always means the third link the creator ever got.
 */
export async function sendCut(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const jobId = text(formData.get("job_id"), 40);
  const rawUrl = text(formData.get("url"), 500);
  if (!jobId) return { error: "missing job." };
  if (!rawUrl) return { error: "paste the link to the cut." };

  const { data: job } = await supabase
    .from("edit_jobs")
    .select("id, user_id, title, status, editor_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.editor_id !== user.id) return { error: "this is not your job." };
  if (!["claimed", "revisions", "delivered"].includes(job.status as string)) {
    return { error: "this job is not taking cuts right now." };
  }

  const { count } = await supabase
    .from("edit_job_deliverables")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  const version = (count ?? 0) + 1;

  const cutUrl = safeUrl(rawUrl);
  if (!cutUrl) return { error: "that link does not look like a url." };

  const { error } = await supabase.from("edit_job_deliverables").insert({
    job_id: jobId,
    editor_id: user.id,
    url: cutUrl,
    note: text(formData.get("note"), 1000),
    version,
  });
  if (error) return { error: error.message };

  const { error: statusError } = await supabase
    .from("edit_jobs")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("editor_id", user.id);
  if (statusError) return { error: statusError.message };

  await supabase.from("edit_job_events").insert({
    job_id: jobId,
    author_id: user.id,
    kind: "status",
    body: `sent cut v${version}`,
  });

  await tellCreatorDelivered(job, version);

  revalidatePath(`/editors/jobs/${jobId}`);
  revalidatePath("/editors");
  return { ok: `cut v${version} sent.` };
}

/**
 * The upload path of sendCut. The browser already put the file in the bucket
 * (storage RLS only lets a job's claimed editor write under `<job>/cuts/`);
 * this records it and then does exactly what sendCut does for a link: a
 * deliverable row, the flip to delivered, a status event. The deliverable's
 * url is the storage sentinel, never an http link, and the pages resolve it
 * to a signed url at render.
 */
export async function recordCutFile(input: {
  jobId: string;
  kind: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const jobId = String(input.jobId ?? "").slice(0, 40);
  const path = String(input.path ?? "").slice(0, 300);
  if (!jobId || !path.startsWith(`${jobId}/cuts/`)) {
    return { error: "that upload does not belong to this job." };
  }

  const { data: job } = await supabase
    .from("edit_jobs")
    .select("id, user_id, title, status, editor_id")
    .eq("id", jobId)
    .maybeSingle();

  if (!job || job.editor_id !== user.id) return { error: "this is not your job." };
  if (!["claimed", "revisions", "delivered"].includes(job.status as string)) {
    return { error: "this job is not taking cuts right now." };
  }

  const name = String(input.name ?? "").slice(0, 200) || "cut";

  const { error: fileError } = await supabase.from("edit_job_files").insert({
    job_id: jobId,
    uploader_id: user.id,
    kind: "cut",
    path,
    name,
    mime: String(input.mime ?? "").slice(0, 100) || null,
    size_bytes: Number.isFinite(input.size) ? Math.max(0, Math.round(input.size)) : null,
  });
  if (fileError) return { error: fileError.message };

  const { count } = await supabase
    .from("edit_job_deliverables")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  const version = (count ?? 0) + 1;

  const { error } = await supabase.from("edit_job_deliverables").insert({
    job_id: jobId,
    editor_id: user.id,
    // the sentinel, not a url: resolved to a signed url wherever it renders.
    url: `storage://editing-assets/${path}`,
    note: name,
    version,
  });
  if (error) {
    // the delivery never landed, so the file row goes too; the client then
    // removes the object and nothing half-exists.
    await supabase.from("edit_job_files").delete().eq("path", path);
    return { error: error.message };
  }

  const { error: statusError } = await supabase
    .from("edit_jobs")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("editor_id", user.id);
  if (statusError) return { error: statusError.message };

  await supabase.from("edit_job_events").insert({
    job_id: jobId,
    author_id: user.id,
    kind: "status",
    body: `sent cut v${version}`,
  });

  await tellCreatorDelivered(job, version);

  revalidatePath(`/editors/jobs/${jobId}`);
  revalidatePath("/editors");
  return {};
}

export async function postComment(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const jobId = text(formData.get("job_id"), 40);
  const body = text(formData.get("body"), 2000);
  if (!jobId) return { error: "missing job." };
  if (!body) return { error: "write something first." };

  const { error } = await supabase.from("edit_job_events").insert({
    job_id: jobId,
    author_id: user.id,
    kind: "comment",
    body,
  });
  if (error) return { error: error.message };

  revalidatePath(`/editors/jobs/${jobId}`);
  return { ok: "posted." };
}

// ------------------------------------------------------------------ profile

export type SaveProfileResult =
  | { ok: true; handle: string }
  | { ok: false; error: string };

/**
 * The profile editor holds the whole document in state and posts all of it,
 * portfolio-style, so there is no partial-save path to reason about. Nothing
 * from the client is trusted: every field is re-read and clamped here, and
 * `verified` is never written because a trigger owns it.
 */
export async function saveEditorProfile(input: unknown): Promise<SaveProfileResult> {
  const { supabase, user } = await authed();
  if (!user) return { ok: false, error: "your session expired. sign in again." };

  const doc =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const str = (v: unknown, max: number): string =>
    typeof v === "string" ? v.trim().slice(0, max) : "";

  const rawHandle = str(doc.handle, 60);
  let handle = "";
  if (rawHandle) {
    const normalized = normalizeHandle(rawHandle);
    if (!normalized) {
      return {
        ok: false,
        error: "handles are 3 to 30 characters: letters, numbers and dashes.",
      };
    }
    handle = normalized;
  }

  const published = doc.published === true;
  if (published && !handle) {
    return { ok: false, error: "pick a handle before you publish." };
  }

  const name = str(doc.name, 80);
  if (published && !name) {
    return { ok: false, error: "add your name before you publish." };
  }

  // rate and turnaround travel as the raw strings the fields hold, so a typo
  // gets a sentence instead of silently becoming zero.
  const rateRaw = str(doc.rate, 20);
  const rate_cents = rateRaw ? parseCents(rateRaw) : null;
  if (rateRaw && rate_cents === null) {
    return { ok: false, error: "the rate has to be a dollar amount." };
  }

  const turnRaw = str(doc.turnaround, 10);
  const turnaround_hours = turnRaw ? parseCount(turnRaw) : null;
  if (turnRaw && turnaround_hours === null) {
    return { ok: false, error: "turnaround has to be a whole number of hours." };
  }

  const status: EditorStatus = doc.status === "paused" ? "paused" : "active";

  const row = {
    user_id: user.id,
    handle,
    published,
    name: name || null,
    headline: str(doc.headline, 120) || null,
    location: str(doc.location, 80) || null,
    avatar_url: safeUrl(str(doc.avatar_url, 500)) ?? null,
    bio: str(doc.bio, 2000) || null,
    skills: asStringList(doc.skills).map((s) => s.slice(0, 40)).slice(0, 20),
    software: asStringList(doc.software).map((s) => s.slice(0, 40)).slice(0, 20),
    links: asLinkItems(doc.links)
      .map((l) => ({ url: l.url, label: l.label.slice(0, 60) }))
      .slice(0, 10),
    reel: asReelClips(doc.reel)
      .map((c) => ({
        url: c.url,
        title: c.title.slice(0, 80),
        platform: c.platform.slice(0, 30),
      }))
      .slice(0, 12),
    rate_cents,
    turnaround_hours,
    status,
  };

  // upsert rather than update so a profile saved before the join row exists
  // still lands. the conflict target is the pk, so a 23505 out of this can
  // only be the unique index on the handle.
  const { error } = await supabase
    .from("editors")
    .upsert(row, { onConflict: "user_id" });

  if (error) {
    return {
      ok: false,
      error:
        error.code === "23505"
          ? "that handle is taken. try another."
          : error.message,
    };
  }

  // keep `profiles` in step, same reason as the application action: one
  // identity. only the fields that were actually filled in, because clearing a
  // portfolio field is not a request to forget who somebody is. best effort.
  const mirror: Record<string, string> = {};
  if (row.name) mirror.full_name = row.name;
  if (row.avatar_url) mirror.avatar_url = row.avatar_url;
  if (Object.keys(mirror).length) {
    await supabase.from("profiles").update(mirror).eq("id", user.id);
  }

  revalidatePath("/editors/settings");
  revalidatePath("/editors");
  // the public page lives at /e/<handle> and is cached there.
  if (handle) revalidatePath(`/e/${handle}`);
  return { ok: true, handle };
}

// ------------------------------------------------------------------ payouts

/**
 * Where the money goes. Its own table rather than a column on `editors`
 * because that table has a public read policy and a paypal address must
 * never ride along to /e/<handle>. RLS keeps it to the owner and staff.
 */
export async function saveEditorPayoutDetails(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const allowed = ["stripe", "paypal", "venmo", "cashapp", "wise", "other"] as const;
  const rawMethod = String(formData.get("method") ?? "");
  const method = (allowed as readonly string[]).includes(rawMethod)
    ? rawMethod
    : "paypal";

  // stripe is the one method with no address to type: the destination is the
  // connected account, and it comes from stripe rather than from this form.
  // `address` stays a column on the row so the founder still sees something,
  // and `claim_payout_batch` ignores it entirely when the method is stripe.
  const address =
    method === "stripe"
      ? "stripe connect"
      : text(formData.get("address"), 200);
  if (!address) return { error: "add the address the money goes to." };

  const { error } = await supabase
    .from("editor_payout_details")
    .upsert({ user_id: user.id, method, address }, { onConflict: "user_id" });
  if (error) return { error: error.message };

  revalidatePath("/editors");
  revalidatePath("/editors/payouts");
  return { ok: "saved. payouts go there now." };
}

// ------------------------------------------------------------ stripe connect

/**
 * Copy the live state of a connected account into our row.
 *
 * Called from two places on purpose. The `account.updated` webhook is the one
 * that catches a verification finishing hours later, and the return route calls
 * it the moment somebody comes back from onboarding, so the button stops saying
 * "finish setting up" without waiting on a webhook that may not be subscribed
 * yet. Writing with the service client because `editor_stripe_accounts` grants
 * no write to `authenticated` at all: a row that decides where money goes must
 * not be reachable from a session.
 */
export async function syncStripeAccount(
  userId: string,
  accountId: string
): Promise<void> {
  const admin = createServiceClient();
  if (!admin) return;

  const result = await getAccount(accountId);
  if (!result.ok) {
    console.error("[stripe connect] could not read account", accountId, result.error);
    return;
  }

  const account = result.data;
  await admin
    .from("editor_stripe_accounts")
    .update({
      country: account.country ?? null,
      details_submitted: Boolean(account.details_submitted),
      payouts_enabled: Boolean(account.payouts_enabled),
      transfers_active: account.capabilities?.transfers === "active",
      disabled_reason: account.requirements?.disabled_reason ?? null,
      requirements_due: account.requirements?.currently_due ?? [],
    })
    .eq("user_id", userId)
    .eq("account_id", accountId);
}

/**
 * Start or resume stripe onboarding, and send them to stripe's own screens.
 *
 * The account is created once and kept. An account link is minted per click
 * because stripe's are single use and expire in minutes, so there is nothing
 * worth storing and a stale one is worse than none.
 *
 * The country comes off their application, not off this form. It decides which
 * service agreement the account is created under and it cannot be changed after
 * the fact, so letting somebody pick it at the moment they want money would be
 * the one place in the flow where guessing is rewarded.
 */
export async function startStripeOnboarding(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  void formData;
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };
  if (!stripeConnectConfigured()) {
    return { error: "stripe is not switched on yet. use paypal for now." };
  }

  const admin = createServiceClient();
  if (!admin) return { error: "payouts are not configured. tell us and we will fix it." };

  const { data: existing } = await supabase
    .from("editor_stripe_accounts")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let accountId = (existing?.account_id as string | undefined) ?? null;

  if (!accountId) {
    const { data: application } = await supabase
      .from("editor_applications")
      .select("country")
      .eq("user_id", user.id)
      .maybeSingle();

    const countryName = String(application?.country ?? "").trim().toLowerCase();
    const iso = COUNTRIES.find((c) => c.name === countryName)?.iso;
    if (!iso) {
      return {
        error:
          "we need your country before stripe will open. fix your application and come back.",
      };
    }

    const created = await createExpressAccount({ email: user.email ?? null, country: iso });
    if (!created.ok) {
      // stripe refuses an unsupported country here with a real sentence, which
      // is worth showing: it is the honest answer for brazil and nepal.
      return { error: `stripe could not open an account: ${created.error}` };
    }

    accountId = created.data.id;

    const { error: linkError } = await admin.from("editor_stripe_accounts").insert({
      user_id: user.id,
      account_id: accountId,
      country: created.data.country ?? iso,
    });
    if (linkError) {
      // the account exists at stripe but we could not remember it. saying so is
      // better than minting a second one on the next press.
      console.error("[stripe connect] account created but not stored", accountId, linkError.message);
      return { error: "we opened your stripe account but could not save it. try again." };
    }
  }

  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  const link = await createAccountLink({
    accountId,
    refreshUrl: `${site}/editors/payouts/stripe`,
    returnUrl: `${site}/editors/payouts/stripe`,
  });
  if (!link.ok) return { error: `stripe would not open onboarding: ${link.error}` };

  redirect(link.data.url);
}

/** the express dashboard, for changing a bank account after the fact. */
export async function openStripeDashboard(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  void formData;
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const { data: row } = await supabase
    .from("editor_stripe_accounts")
    .select("account_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const accountId = row?.account_id as string | undefined;
  if (!accountId) return { error: "connect stripe first." };

  const link = await createLoginLink(accountId);
  if (!link.ok) return { error: link.error };

  redirect(link.data.url);
}

/** Turn a raise message from the claim rpc into something an editor can act on. */
const PAYOUT_ERRORS: [string, string][] = [
  ["no payout address", "save where the money should go first, then cash out."],
  ["nothing owed", "nothing owed to pay out yet."],
  ["payout already in flight", "a payout is already going out. give it a minute."],
  [
    "over the automatic limit",
    "that is more than we send automatically. we will pay it by hand today.",
  ],
  ["stripe not connected", "connect stripe first, then cash out."],
  [
    "stripe not ready",
    "stripe still has to verify you. finish setting up and we will tell you the moment it clears.",
  ],
];

/**
 * Cash out. This one really sends the money.
 *
 * The order is the whole safety argument, and it is claim, send, settle:
 *
 *  1. `claim_payout_batch` locks the editor, checks the address and the cap,
 *     sums what is owed and stamps those rows with a new batch id. After this
 *     the money is spoken for and a second press cannot claim it again.
 *  2. PayPal is called with the batch id as its idempotency key, so even a
 *     retry that reaches them twice pays once.
 *  3. `settle_payout_batch` marks everything paid.
 *
 * A refusal releases the claim so they can try again. A timeout deliberately
 * does NOT: when we cannot tell whether the money left, the batch stays in
 * flight for a human to resolve, because paying twice cannot be undone and a
 * stuck payout can.
 */
export async function requestPayout(
  _prev: EditorActionState,
  formData: FormData
): Promise<EditorActionState> {
  void formData;
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_payout_batch",
    { p_max_cents: 50_000 }
  );

  if (claimError) {
    const friendly = PAYOUT_ERRORS.find(([key]) => claimError.message.includes(key));
    return { error: friendly ? friendly[1] : claimError.message };
  }

  // the rpc's columns are prefixed because the bare names collide with the
  // columns it reads. flattened here so the rest of this reads normally.
  const row = (claimed as
    | { out_batch_id: string; out_cents: number; out_method: string; out_address: string }[]
    | null)?.[0];
  if (!row) return { error: "could not start the payout. try again." };

  const batch = {
    batch_id: row.out_batch_id,
    amount_cents: Number(row.out_cents),
    method: row.out_method,
    address: row.out_address,
  };

  const dollars = money(batch.amount_cents);

  // ------------------------------------------------------------ stripe rail
  //
  // Same three steps and the same asymmetry as the paypal path below: a
  // definite refusal releases the claim, an unknown outcome never does. The
  // batch uuid is the Idempotency-Key, which is why the claim happened first.
  //
  // `address` here is the connected account id, put there by the claim rpc from
  // `editor_stripe_accounts` after checking payouts_enabled. It is never
  // whatever is typed in the address box.
  if (batch.method === "stripe") {
    if (!stripeConnectConfigured()) {
      await supabase.rpc("fail_payout_batch", {
        p_batch: batch.batch_id,
        p_error: "stripe credentials missing",
      });
      revalidatePath("/editors");
      revalidatePath("/editors/payouts");
      return {
        error: "stripe payouts are not switched on yet. nothing was taken from your balance.",
      };
    }

    const transfer = await sendTransfer({
      amountCents: batch.amount_cents,
      destination: batch.address,
      idempotencyKey: batch.batch_id,
      description: "creator empire editing payout",
    });

    if (!transfer.ok) {
      if (transfer.error.startsWith("unknown:")) {
        return {
          error:
            "we could not confirm that went through. do not press again, we are checking it now.",
        };
      }
      await supabase.rpc("fail_payout_batch", {
        p_batch: batch.batch_id,
        p_error: transfer.error,
      });
      revalidatePath("/editors");
      revalidatePath("/editors/payouts");
      return { error: `stripe refused it: ${transfer.error}` };
    }

    const { error: settleError } = await supabase.rpc("settle_payout_batch", {
      p_batch: batch.batch_id,
      p_ref: transfer.data.id,
    });
    if (settleError) {
      // the money HAS left. never release the claim here.
      console.error("[payout] transferred but not settled", batch.batch_id, settleError.message);
      return {
        ok: `${dollars} is on its way. your balance will catch up shortly.`,
      };
    }

    revalidatePath("/editors");
    revalidatePath("/editors/payouts");
    // deliberately not "in your bank": a transfer lands in their stripe
    // balance, and stripe pays that out on its own schedule.
    return {
      ok: `sent. ${dollars} is in your stripe balance and stripe pays it to your bank next.`,
    };
  }

  // No human fallback on purpose. If we cannot send it we say so and put the
  // money straight back, rather than promising somebody will do it by hand:
  // a promise nobody is watching is worse than a clear no.
  if (!canAutoSend(batch.method) || !paypalConfigured()) {
    await supabase.rpc("fail_payout_batch", {
      p_batch: batch.batch_id,
      p_error: canAutoSend(batch.method)
        ? "paypal credentials missing"
        : `${batch.method} has no automatic rail`,
    });
    revalidatePath("/editors");
    revalidatePath("/editors/payouts");
    return {
      error: canAutoSend(batch.method)
        ? "payouts are not switched on yet. nothing was taken from your balance."
        : `we can only send to paypal or venmo right now. switch your method and cash out again.`,
    };
  }

  const sent = await sendPayout({
    senderBatchId: batch.batch_id,
    email: batch.address,
    amountCents: batch.amount_cents,
    note: "your creator empire editing payout",
  });

  if (!sent.ok) {
    // "unknown" means the request never came back cleanly, so we cannot say
    // whether paypal took it. leave the batch in flight on purpose.
    if (sent.error.startsWith("unknown:")) {
      return {
        error:
          "we could not confirm that went through. do not press again, we are checking it now.",
      };
    }
    await supabase.rpc("fail_payout_batch", {
      p_batch: batch.batch_id,
      p_error: sent.error,
    });
    revalidatePath("/editors");
    revalidatePath("/editors/payouts");
    return { error: `paypal refused it: ${sent.error}` };
  }

  const { error: settleError } = await supabase.rpc("settle_payout_batch", {
    p_batch: batch.batch_id,
    p_ref: sent.batchId,
  });
  if (settleError) {
    // the money HAS left. never release the claim here, or the next press
    // pays it a second time. it needs a human, not a retry.
    console.error("[payout] sent but not settled", batch.batch_id, settleError.message);
    return {
      ok: `${dollars} is on its way to paypal. your balance will catch up shortly.`,
    };
  }

  revalidatePath("/editors");
  revalidatePath("/editors/payouts");
  return { ok: `sent. ${dollars} is on its way to ${batch.address}.` };
}
