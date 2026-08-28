"use server";

import { apiKey } from "@/lib/api-keys";
import { revalidatePath } from "next/cache";
import {
  connectUrl,
  ensureProfile,
  postingProblem,
  rowFromPublish,
  type ConnectOrigin,
} from "@/lib/autopost/server";
import {
  AUTOPOST_PLATFORMS,
  UploadPostError,
  cancelScheduledJob,
  editScheduledJob,
  publishVideo,
  type AutopostPlatform,
} from "@/lib/autopost/upload-post";
import { MAX_CAPTION, YOUTUBE_TITLE_MAX } from "@/lib/autopost/limits";
import { autopostPrefix, readLink } from "@/lib/autopost/source";
import { publicUrl } from "@/lib/variations/model";
import { createClient } from "@/lib/supabase/server";

export type PostState = { error?: string; ok?: string };

/**
 * The autopost writes. Same contract as every other action file: runs as the
 * signed-in user, `user_id` off the session, RLS scopes the rows. The only
 * thing that leaves our infrastructure is the caption, the platform list and a
 * public video URL.
 */
async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Under this lead upstream rejects the schedule anyway; failing here is a
 *  sentence instead of a mystery. */
const MIN_LEAD_MS = 5 * 60_000;

/** The composer's own tab, and the deals list, which carries each deal's queue
 *  count in its row. A scheduled post is also a mark on the day it fires, so
 *  the calendar under that tab is stale on the same write. */
function revalidatePosting(dealId: string | null): void {
  if (dealId) revalidatePath(`/deals/${dealId}`);
  revalidatePath("/deals");
  // the cross-deal planner draws every deal's schedule, so any posting write
  // moves a card on it.
  revalidatePath("/social");
}

/**
 * The cut, whichever of the three ways it arrived.
 *
 * Nothing here trusts a url off the form except the one our own uploader minted,
 * and that one is checked against this project's storage host. A variation is
 * sent as an ID and re-read through rls, so the url is built here from a row the
 * signed-in user demonstrably owns rather than taken from the browser: a
 * hand-edited form cannot reach another creator's render, and it cannot post one
 * that has not finished rendering either.
 *
 * A variation is additionally pinned to the deal's own brand. The variations
 * tool banks clips per brand, so posting a Candle cut on the Gymshark deal is a
 * mistake the form should not be able to express — and the accounts it would go
 * out of belong to the other brand.
 */
async function resolveVideo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
  brandId: string | null
): Promise<{ url: string } | { error: string }> {
  // Sending the same cut again: a failed post that has to be retried, or a good
  // one going out on a second day. The client sends the ROW id and never the
  // url, exactly like a render does — the url on a `social_posts` row was
  // already validated once when it was written, and re-reading it through rls
  // is what stops a hand-edited form from turning "post again" into "post
  // anything". No branch on how the original was sourced: an upload, a Drive
  // link and a variation all settled into one public url on the way out.
  const repostId = String(formData.get("repost_id") ?? "").trim();
  if (repostId) {
    const { data: prior } = await supabase
      .from("social_posts")
      .select("id, video_url")
      .eq("id", repostId)
      // scoped to the deal it is being sent from, not just to the person. rls
      // already stops somebody else's post being reused; this stops YOUR post
      // for one brand being sent out under another one, which nothing in the ui
      // can do but a hand-built form could, and would be filed against the
      // wrong deal's earnings forever.
      .eq("deal_id", String(formData.get("deal_id") ?? "").trim())
      .maybeSingle();

    if (!prior?.video_url) return { error: "That post is gone. Pick the cut again." };
    return { url: prior.video_url as string };
  }

  const renderId = String(formData.get("render_id") ?? "").trim();
  if (renderId) {
    const { data: render } = await supabase
      .from("variation_renders")
      .select("id, brand_id, status, output_path")
      .eq("id", renderId)
      .maybeSingle();

    if (!render) return { error: "That variation is gone. Pick another cut." };
    if (render.status !== "done" || !render.output_path) {
      return { error: "That variation has not finished rendering yet." };
    }
    if (brandId && render.brand_id !== brandId) {
      return { error: "That variation belongs to another brand." };
    }

    const url = publicUrl(render.output_path);
    if (!url) return { error: "Could not reach that variation. Try uploading it instead." };
    return { url };
  }

  const link = String(formData.get("video_link") ?? "").trim();
  if (link) {
    const read = readLink(link);
    return read.ok ? { url: read.url } : { error: read.error };
  }

  const uploaded = String(formData.get("video_url") ?? "").trim();
  if (!uploaded.startsWith(autopostPrefix())) return { error: "Pick the cut first." };
  return { url: uploaded };
}

export type ConnectLink = { url: string } | { error: string };

/**
 * Creates the managed profile on first click and hands back the white-label
 * connect url.
 *
 * It returns the url instead of redirecting to it. A server action's
 * `redirect()` can only navigate the tab it was called from, and connecting is
 * a detour on somebody else's site: the creator was mid-way through setting a
 * brand up, and replacing that tab loses the page they were on and drops them
 * back at the deal only if Upload-Post's return url fires. The caller opens a
 * new tab instead and the original page is still sitting there when they come
 * back.
 */
export async function connectLink(
  dealId: string,
  /** which page to come back to. an enum, never a url: the caller is a browser
   *  and the value becomes a redirect target on our domain. */
  origin: ConnectOrigin = "social"
): Promise<ConnectLink> {
  const { supabase, user } = await authed();
  const id = String(dealId ?? "").trim();

  if (!user) return { error: "Your session expired. Sign in again." };
  if (!id) return { error: "Open this from a deal and try again." };

  const from: ConnectOrigin = origin === "deal" ? "deal" : "social";

  try {
    return { url: await connectUrl(supabase, user.id, id, from) };
  } catch (err) {
    // the key being missing or upstream being down is one sentence, but a 4xx
    // is upstream telling the creator something they can act on — the profile
    // cap being the one that actually fires — so it is passed through.
    return { error: postingProblem(err) };
  }
}

export async function schedulePost(_prev: PostState, formData: FormData): Promise<PostState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "Your session expired. Sign in again." };

  // the deal is what decides which set of accounts this goes out of, so it is
  // checked before anything else is read. rls scopes the lookup, so somebody
  // else's deal id simply is not found rather than being refused.
  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return { error: "Open this from a deal and try again." };
  const { data: deal } = await supabase
    .from("deals")
    .select("id, brand_id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { error: "That deal is gone." };

  const caption = String(formData.get("caption") ?? "").trim();
  if (!caption) return { error: "Write the caption first." };
  if (caption.length > MAX_CAPTION) {
    return { error: `Captions cap at ${MAX_CAPTION} characters.` };
  }

  const resolved = await resolveVideo(supabase, formData, deal.brand_id as string | null);
  if ("error" in resolved) return { error: resolved.error };
  const videoUrl = resolved.url;

  const platforms = formData
    .getAll("platforms")
    .map(String)
    .filter((p): p is AutopostPlatform =>
      (AUTOPOST_PLATFORMS as readonly string[]).includes(p)
    );
  if (platforms.length === 0) return { error: "Pick at least one platform." };

  // the composer converts its local datetime to ISO before submit, so this is
  // already UTC. empty means post now.
  const whenRaw = String(formData.get("scheduled_iso") ?? "").trim();
  let scheduledDate: string | undefined;
  if (whenRaw) {
    const when = new Date(whenRaw);
    if (Number.isNaN(when.getTime())) return { error: "That schedule time did not read." };
    if (when.getTime() < Date.now() + MIN_LEAD_MS) {
      return { error: "Schedule at least five minutes out, or post it now." };
    }
    scheduledDate = when.toISOString();
  }

  const profile = await ensureProfile(supabase, user.id, dealId).catch((err) => err);
  if (!profile || !("upload_post_username" in profile)) {
    return { error: postingProblem(profile) };
  }

  // the composer only renders this field in the one state that needs it, so a
  // value here is a deliberate answer to a question we asked.
  const pickedPage = String(formData.get("facebook_page_id") ?? "").trim();
  if (pickedPage && platforms.includes("facebook") && !profile.facebook_page_id) {
    await supabase
      .from("social_profiles")
      .update({ facebook_page_id: pickedPage })
      .eq("user_id", user.id)
      .eq("deal_id", dealId);
    profile.facebook_page_id = pickedPage;
  }

  let result;
  try {
    result = await publishVideo({
      key: postKey,
      username: profile.upload_post_username,
      platforms,
      caption,
      videoUrl,
      scheduledDate,
      facebookPageId: profile.facebook_page_id,
    });
  } catch (err) {
    return {
      error:
        err instanceof UploadPostError
          ? err.message
          : "Posting failed before it started. Try again.",
    };
  }

  const row = rowFromPublish(result, platforms.length);
  // a row that is already finished when it is written was decided while the
  // creator was standing here watching, and the composer says so on the next
  // line. it is stamped notified so the reconciler never emails about it later,
  // days after they read the answer on screen.
  const bornTerminal = row.status !== "scheduled" && row.status !== "processing";
  const { error } = await supabase.from("social_posts").insert({
    user_id: user.id,
    deal_id: dealId,
    caption,
    platforms,
    video_url: videoUrl,
    scheduled_for: scheduledDate ?? null,
    notified_at: bornTerminal ? new Date().toISOString() : null,
    ...row,
  });

  // the post is already upstream at this point; a failed local insert must not
  // read as "nothing happened", so the queue message says the truth.
  if (error) return { error: "It went out, but saving the record failed. Reload the page." };

  revalidatePosting(dealId);
  return {
    ok: scheduledDate
      ? "Scheduled. Upload-Post fires it on time."
      : row.status === "failed"
        ? "Every platform refused it. Open the row for the reason."
        : "Sent. The queue below tracks it.",
  };
}

/**
 * Changes a post that has not fired yet: the words on it, and when it goes.
 *
 * Two mechanisms behind one button, picked by whether Upload-Post's edit
 * endpoint can express the change.
 *
 * `PATCH /uploadposts/schedule/{job_id}` takes `scheduled_date`, `title` and
 * `caption`, and that covers almost every edit. It is also the safe one: the
 * job keeps its id and its slot, and a call that fails changes nothing on
 * either side.
 *
 * What it cannot express is the platform override `publishVideo` sends. A
 * caption over 100 characters on a post that includes YouTube goes out as a
 * trimmed `youtube_title` plus the full text as the description, and patching
 * the title to a 300-character string would leave a job that fails YouTube at
 * fire time, silently, days later. That one case is canceled and sent again
 * instead, because re-sending is the only way to set the override. Same row,
 * new job id.
 *
 * Cancel first, then send. Never the other way round: a send that lands before
 * a cancel that fails is the same cut posted twice and there is no taking that
 * back. A cancel that lands before a send that fails costs the schedule, and
 * the row says exactly that and keeps its cut, so "Send it" out of History
 * puts it back in one press.
 *
 * The cut and the platform list are deliberately not editable here. Either one
 * is a different post rather than an edit of this one, and cancelling and
 * composing again already fills the composer in from the row.
 */
export async function editPost(_state: PostState, formData: FormData): Promise<PostState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = String(formData.get("post_id") ?? "").trim();
  if (!id) return {};

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id, caption, platforms, video_url, scheduled_for, status, job_id")
    .eq("id", id)
    .maybeSingle();

  if (!post) return { error: "That post is not there any more." };
  if (post.status !== "scheduled") {
    return { error: "Too late, that one is already on its way out." };
  }
  if (!post.job_id) {
    return { error: "There is no schedule to change. Cancel it and send it again." };
  }

  const caption = String(formData.get("caption") ?? "").trim();
  if (!caption) return { error: "Write the caption first." };
  if (caption.length > MAX_CAPTION) {
    return { error: `Captions cap at ${MAX_CAPTION} characters.` };
  }

  // the editor converts its wall clock to an instant before submit, same as the
  // composer. empty means "leave the time where it is".
  const whenRaw = String(formData.get("scheduled_iso") ?? "").trim();
  let scheduledFor = post.scheduled_for as string | null;
  if (whenRaw) {
    const when = new Date(whenRaw);
    if (Number.isNaN(when.getTime())) return { error: "That schedule time did not read." };
    if (when.getTime() < Date.now() + MIN_LEAD_MS) {
      return { error: "Schedule at least five minutes out." };
    }
    scheduledFor = when.toISOString();
  }

  const captionChanged = caption !== post.caption;
  const timeChanged = scheduledFor !== post.scheduled_for;
  if (!captionChanged && !timeChanged) return { ok: "Nothing to change." };

  const platforms = (post.platforms ?? []) as AutopostPlatform[];
  /** the one shape their edit endpoint cannot carry. see the note above. */
  const needsResend =
    captionChanged && platforms.includes("youtube") && caption.length > YOUTUBE_TITLE_MAX;

  if (!needsResend) {
    try {
      const kept = await editScheduledJob(
        post.job_id as string,
        {
          scheduledDate: timeChanged && scheduledFor ? scheduledFor : undefined,
          caption: captionChanged ? caption : undefined,
        },
        postKey
      );
      // their 404. the job fired or was pulled while this form was open, so the
      // row on screen is out of date and writing to it would make that worse.
      if (!kept) return { error: "Upload-Post no longer has that job. Reload the queue." };
    } catch (err) {
      return {
        error:
          err instanceof UploadPostError
            ? err.message
            : "Could not reach the posting service. Try again in a minute.",
      };
    }

    await supabase
      .from("social_posts")
      .update({ caption, scheduled_for: scheduledFor })
      .eq("id", id);

    revalidatePosting(post.deal_id as string | null);
    return { ok: timeChanged ? "Saved. It fires on the new time." : "Saved." };
  }

  // the resend path books a fresh job and upstream will not take one inside
  // five minutes, so a slot that close cannot be rewritten this way at all. a
  // patch would have been fine; this shape is not, and saying so beats a
  // cancel that lands followed by a send that cannot.
  const due = scheduledFor ? Date.parse(scheduledFor) : NaN;
  if (!Number.isFinite(due) || due < Date.now() + MIN_LEAD_MS) {
    return {
      error: "That one fires too soon to rewrite the caption. Cancel it and send it again.",
    };
  }

  const profile = await ensureProfile(supabase, user.id, post.deal_id as string).catch(
    (err) => err
  );
  if (!profile || !("upload_post_username" in profile)) {
    return { error: postingProblem(profile) };
  }

  try {
    // false is their 404: nothing left to cancel. the row is scheduled and the
    // slot is still minutes out, so the job cannot have fired — sending again
    // cannot double post.
    await cancelScheduledJob(post.job_id as string, postKey);
  } catch {
    return { error: "Could not reach the posting service. Nothing changed." };
  }

  let result;
  try {
    result = await publishVideo({
      key: postKey,
      username: profile.upload_post_username,
      platforms,
      caption,
      videoUrl: post.video_url as string,
      scheduledDate: scheduledFor as string,
      facebookPageId: profile.facebook_page_id,
    });
  } catch (err) {
    // the old job is gone and the new one never happened. the row keeps its cut
    // and its platforms, so History's "Send it" is a one-press fix, and the
    // caption it goes back out with is the edited one.
    await supabase
      .from("social_posts")
      .update({
        status: "canceled",
        caption,
        job_id: null,
        error: "the schedule was pulled to rewrite the caption and the new one did not go out",
      })
      .eq("id", id);

    revalidatePosting(post.deal_id as string | null);
    return {
      error:
        err instanceof UploadPostError
          ? `${err.message} The old schedule is gone, so send it again from History.`
          : "The old schedule is gone and the new one did not go out. Send it again from History.",
    };
  }

  const row = rowFromPublish(result, platforms.length);
  await supabase
    .from("social_posts")
    .update({ caption, scheduled_for: scheduledFor, error: null, ...row })
    .eq("id", id);

  revalidatePosting(post.deal_id as string | null);
  return { ok: "Saved. It goes out on the new caption." };
}

/**
 * Moves a scheduled post to a new slot. The planner's drag-and-drop.
 *
 * Time only, on purpose: a drop on a calendar says nothing about the caption,
 * and `editPost` already covers the full edit. Upstream's
 * `PATCH /uploadposts/schedule/{job_id}` takes `scheduled_date` on its own, so
 * the job keeps its id and a call that fails moves nothing on either side —
 * no cancel-and-resend needed for a pure reschedule.
 *
 * Plain arguments rather than FormData because the caller is a drop handler,
 * not a form.
 */
export async function reschedulePost(postId: string, scheduledIso: string): Promise<PostState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = String(postId ?? "").trim();
  if (!id) return {};

  const when = new Date(String(scheduledIso ?? "").trim());
  if (Number.isNaN(when.getTime())) return { error: "That slot did not read as a time." };
  if (when.getTime() < Date.now() + MIN_LEAD_MS) {
    return { error: "Schedule at least five minutes out." };
  }
  const scheduledFor = when.toISOString();

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id, scheduled_for, status, job_id")
    .eq("id", id)
    .maybeSingle();

  if (!post) return { error: "That post is not there any more." };
  if (post.status !== "scheduled") {
    return { error: "Too late, that one is already on its way out." };
  }
  if (!post.job_id) {
    return { error: "There is no schedule to move. Cancel it and send it again." };
  }
  if (post.scheduled_for === scheduledFor) return { ok: "Already there." };

  try {
    const kept = await editScheduledJob(post.job_id as string, { scheduledDate: scheduledFor }, postKey);
    // their 404: the job fired or was pulled while the calendar was open, so
    // the card on screen is stale and writing the move would make that worse.
    if (!kept) return { error: "Upload-Post no longer has that job. Reload the page." };
  } catch (err) {
    return {
      error:
        err instanceof UploadPostError
          ? err.message
          : "Could not reach the posting service. Try again in a minute.",
    };
  }

  await supabase.from("social_posts").update({ scheduled_for: scheduledFor }).eq("id", id);

  revalidatePosting(post.deal_id as string | null);
  return { ok: "Moved." };
}

/**
 * Cancels a scheduled post upstream and marks the row.
 *
 * This used to swallow every outcome into one boolean and return void, which
 * gave three silent no-ops on one button: a job upload-post no longer has
 * (404), a row that never got a `job_id`, and their service simply being down.
 * In all three the status stayed `scheduled`, the row stayed in the queue and
 * on the calendar, and the press looked like nothing happened. Worse, the 404
 * never healed: `patchFor` treats a missing job as indeterminate on purpose, so
 * nothing else was ever going to move that row, and every retry 404'd again.
 *
 * A missing job is now decided by the clock, which is the only thing that can
 * tell the two readings apart. Still in the future and they have no job for it:
 * it cannot have fired, so cancelling the row is the truth. Already past due:
 * it may well have gone out, and writing "canceled" over a post that is live on
 * somebody's TikTok is the worse of the two lies, so that one says so and
 * leaves the row alone.
 */
export async function cancelPost(
  _state: PostState,
  formData: FormData
): Promise<PostState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "Sign in again." };

  const id = String(formData.get("post_id") ?? "").trim();
  if (!id) return {};

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, job_id, status, deal_id, scheduled_for")
    .eq("id", id)
    .maybeSingle();

  if (!post) return { error: "That post is not there any more." };
  if (post.status === "canceled") return { ok: "Already canceled." };
  if (post.status !== "scheduled") {
    return { error: "Too late, that one is already on its way out." };
  }

  /** upload-post has no job for this row: a 404, or one we never stored. */
  let lost = !post.job_id;
  if (post.job_id) {
    try {
      // true is a real cancel; false is their 404.
      lost = !(await cancelScheduledJob(post.job_id, postKey));
    } catch {
      return { error: "Could not reach the posting service. Try again in a minute." };
    }
  }

  const due = post.scheduled_for ? Date.parse(post.scheduled_for) : NaN;
  const stillToCome = Number.isFinite(due) && due > Date.now();

  if (lost && !stillToCome) {
    return { error: "That one may already have gone out. Reload to see where it landed." };
  }

  await supabase.from("social_posts").update({ status: "canceled" }).eq("id", id);
  revalidatePosting(post.deal_id as string | null);
  return { ok: "Canceled." };
}

/** Drops a terminal row from the queue. The published posts stay published;
 *  this is queue hygiene, not an unpublish. */
export async function removePost(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = String(formData.get("post_id") ?? "").trim();
  if (!id) return;

  const { data: gone } = await supabase
    .from("social_posts")
    .delete()
    .eq("id", id)
    .in("status", ["posted", "partial", "failed", "canceled"])
    .select("deal_id")
    .maybeSingle();

  revalidatePosting((gone?.deal_id as string | null) ?? null);
}
