"use server";

import { apiKey } from "@/lib/api-keys";
import { revalidatePath } from "next/cache";
import { MAX_CAPTION } from "@/lib/autopost/limits";
import {
  DEFAULT_OPTIONS,
  normalizeTag,
  withDefaults,
  type PostOptions,
} from "@/lib/autopost/plan";
import {
  ensureProfile,
  loadConnections,
  postingProblem,
  rowFromPublish,
} from "@/lib/autopost/server";
import { autopostPrefix } from "@/lib/autopost/source";
import { VARIATIONS_BUCKET, VARIATIONS_URL_PREFIX } from "@/lib/variations/model";
import {
  AUTOPOST_PLATFORMS,
  UploadPostError,
  cancelScheduledJob,
  editScheduledJob,
  publishVideo,
  type AutopostPlatform,
} from "@/lib/autopost/upload-post";
import { BUCKET, STORAGE_URL_PREFIX, isStorageUrl } from "@/lib/editing-files";
import { createClient } from "@/lib/supabase/server";
import { currentTz } from "@/lib/tz-server";
import { instantOf, wallClock } from "@/lib/tz";

export type BatchState = { error?: string; ok?: string; scheduled?: number };

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/**
 * How soon a post may go out.
 *
 * This was a flat five minutes, on the reasoning that upstream rejects a
 * shorter lead anyway. Upload-Post owns the schedule — nothing in this app
 * fires a post — so what it will accept as a SCHEDULE is theirs to say, but
 * "publish this now" is a different call entirely: leave `scheduled_date` off
 * the payload and it goes immediately. That is the honest answer to "post it
 * now", and it is why the floor could come down.
 *
 * So there are three windows rather than one lead:
 *
 * - at or inside `NOW_WINDOW_MS`, including a minute or two already past, the
 *   post is published NOW. Nothing is handed to their scheduler, so their
 *   minimum lead never comes into it.
 * - beyond that it is a scheduled post, and `MIN_LEAD_MS` is one minute rather
 *   than five, because a minute out is a real thing to want and their
 *   scheduler is being given a time it can honour.
 * - further back than `PAST_GRACE_MS` is a mistake, not an intention. A batch
 *   whose first row still says 8am at four in the afternoon should say so
 *   rather than quietly firing the lot.
 */
const MIN_LEAD_MS = 60_000;
const NOW_WINDOW_MS = 2 * 60_000;
const PAST_GRACE_MS = 60 * 60_000;

/** How long a cut's signed url has to outlive the moment it is minted.
 *
 *  Upload-Post fetches the video when the post FIRES, not when it is scheduled,
 *  so a one hour signature (what every other page in the product mints) would
 *  be dead by then for anything scheduled past this afternoon. 90 days is
 *  comfortably past the far end of a batch and is no wider a hole than the
 *  autopost bucket, which is public. */
const SIGN_SECONDS = 90 * 86_400;

function revalidateAll(dealId: string | null): void {
  revalidatePath("/tools/autoposting");
  if (dealId) revalidatePath(`/deals/${dealId}`);
  revalidatePath("/deals");
  revalidatePath("/social");
}

/* ------------------------------------------------------------------ the batch */

export type BatchPost = {
  /** clip id, only used to report which row failed */
  clipId: string;
  /** the deliverable's url, or a public autopost bucket url for an upload */
  ref: string;
  name: string;
  source: "editor" | "upload" | "variation";
  caption: string;
  /** `YYYY-MM-DD`, the creator's own day */
  day: string;
  /** minutes from midnight, the creator's own clock */
  min: number;
};

export type BatchInput = {
  dealId: string;
  platforms: string[];
  hashtags: string[];
  options: PostOptions;
  posts: BatchPost[];
};

/**
 * One run of the wizard: every clip goes upstream and gets a row.
 *
 * Sent one at a time, on purpose. Upload-Post is one request per post whatever
 * we do, and a `Promise.all` over nine of them is a burst that gets rate
 * limited into a batch that is half scheduled with no way to tell which half.
 * Serial is slower and the failure is legible: everything before the break is
 * scheduled and recorded, and the message names what is left.
 *
 * The batch is NOT transactional and cannot be. The moment a post is accepted
 * upstream it exists whether or not our insert lands, so the insert follows the
 * publish and a failure there is reported as "it went out, the record did not"
 * rather than being retried into a double post.
 */
export async function scheduleBatch(input: BatchInput): Promise<BatchState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "your session expired. sign in again." };

  const dealId = String(input.dealId ?? "").trim();
  if (!dealId) return { error: "pick a brand deal first." };

  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { error: "that deal is gone." };

  const asked = (input.platforms ?? [])
    .map(String)
    .filter((p): p is AutopostPlatform => (AUTOPOST_PLATFORMS as readonly string[]).includes(p));
  if (asked.length === 0) return { error: "pick at least one platform." };

  // a batch goes to whatever subset of the four this deal has actually
  // connected. nobody needs all four: a deal with a tiktok and an instagram
  // posts to those two, and a facebook nobody logged in on is dropped here
  // rather than sent upstream to fail the whole post. checked on the server
  // because the wizard's list is a cache and a login can lapse after the page
  // loaded.
  const live = await loadConnections(supabase, user.id, dealId).catch(() => null);
  const isLive = (p: AutopostPlatform) => Boolean(String(live?.connected?.[p] ?? "").trim());
  const platforms = live ? asked.filter(isLive) : asked;
  const skipped = asked.filter((p) => !platforms.includes(p));
  if (platforms.length === 0) {
    return {
      error:
        asked.length === 1
          ? `${asked[0]} is not connected on this deal. connect it first.`
          : "none of those accounts are connected on this deal. connect one first.",
    };
  }

  const posts = (input.posts ?? []).slice(0, 100);
  if (posts.length === 0) return { error: "pick at least one clip." };

  const hashtags = (input.hashtags ?? []).map(normalizeTag).filter(Boolean).slice(0, 30);
  const options = withDefaults(input.options ?? DEFAULT_OPTIONS);

  const profile = await ensureProfile(supabase, user.id, dealId).catch((err) => err);
  if (!profile || !("upload_post_username" in profile)) {
    return { error: postingProblem(profile).toLowerCase() };
  }

  // the plan is a wall clock in the creator's zone; this is where it becomes
  // an instant. see lib/tz.ts for why the zone is a cookie.
  const tz = await currentTz();

  // one batch id for the whole run, so cancelling "that batch" is one filter.
  const batchId = crypto.randomUUID();
  let done = 0;

  for (const post of posts) {
    const caption = String(post.caption ?? "").trim().slice(0, MAX_CAPTION);
    const when = instantOf(String(post.day), Number(post.min), tz);
    if (Number.isNaN(when.getTime())) {
      return stopHere(done, "one of the times did not read. check the schedule step.");
    }
    const lead = when.getTime() - Date.now();
    if (lead < -PAST_GRACE_MS) {
      return stopHere(done, "that time has already gone. pick a new one on the schedule step.");
    }
    // "now" is the absence of a scheduled_date, not a scheduled_date of now.
    const immediate = lead <= NOW_WINDOW_MS;
    if (!immediate && lead < MIN_LEAD_MS) {
      return stopHere(done, "that is too soon to schedule. leave a minute, or set it to now.");
    }

    const video = await publicVideoUrl(supabase, user.id, String(post.ref ?? ""));
    if ("error" in video) return stopHere(done, video.error);

    let result;
    try {
      result = await publishVideo({
        key: postKey,
        username: profile.upload_post_username,
        platforms,
        caption,
        videoUrl: video.url,
        scheduledDate: immediate ? undefined : when.toISOString(),
        facebookPageId: profile.facebook_page_id,
        options,
      });
    } catch (err) {
      return stopHere(
        done,
        err instanceof UploadPostError ? err.message : "posting failed before it started."
      );
    }

    const row = rowFromPublish(result, platforms.length);
    const bornTerminal = row.status !== "scheduled" && row.status !== "processing";

    const { error } = await supabase.from("social_posts").insert({
      user_id: user.id,
      deal_id: dealId,
      batch_id: batchId,
      caption,
      hashtags,
      platforms,
      options,
      video_url: video.url,
      video_name: String(post.name ?? "").slice(0, 200) || null,
      // the column's check constraint is ('editor', 'upload') and a rendered
      // variation is neither — but the question this records is "did the
      // creator hand us this file, or did it come out of the product", and a
      // variation is the second. widening the constraint for a third word
      // nothing branches on would be a migration for a label.
      source_kind: post.source === "upload" ? "upload" : "editor",
      source_ref: String(post.ref ?? "").slice(0, 400) || null,
      // what actually happened, not what the form said: a post sent now is
      // recorded as now, so the queue does not show it as still to come.
      scheduled_for: (immediate ? new Date() : when).toISOString(),
      notified_at: bornTerminal ? new Date().toISOString() : null,
      ...row,
    });
    if (error) {
      return stopHere(done, "it went out, but saving the record failed. reload the page.");
    }

    done += 1;
  }

  revalidateAll(dealId);
  const note =
    skipped.length > 0 ? ` ${skipped.join(" and ")} skipped, not connected on this deal.` : "";
  return {
    ok: `${done} post${done === 1 ? "" : "s"} scheduled.${note}`,
    scheduled: done,
  };

  function stopHere(count: number, message: string): BatchState {
    revalidateAll(dealId);
    return {
      error:
        count === 0
          ? message
          : `${count} post${count === 1 ? "" : "s"} scheduled, then it stopped: ${message}`,
      scheduled: count,
    };
  }
}

/**
 * A url Upload-Post can actually fetch when the post fires.
 *
 * Four shapes reach here. Something already in our public autopost bucket goes
 * through untouched. An editor's cut in the private editing bucket, and a
 * rendered variation in the variations bucket, are each signed for long enough
 * to outlive the schedule — which is the whole reason both are carried as
 * sentinels rather than urls: a link minted when the picker drew the tile would
 * be hours stale by the time Upload-Post fetches the file. Anything else has to
 * be an ordinary http link somebody pasted, and it is passed through as typed,
 * exactly like the single-post composer's Drive path.
 */
async function publicVideoUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  ref: string
): Promise<{ url: string } | { error: string }> {
  const raw = ref.trim();
  if (!raw) return { error: "one of the clips has no file behind it." };

  if (raw.startsWith(autopostPrefix())) {
    // our own uploader minted it, and the path is scoped to this creator.
    return raw.includes(`/autopost/${userId}/`)
      ? { url: raw }
      : { error: "that upload does not belong to you." };
  }

  if (isStorageUrl(raw)) {
    const path = raw.slice(STORAGE_URL_PREFIX.length);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGN_SECONDS);
    if (error || !data?.signedUrl) {
      return { error: "could not get a link to that cut. open the job and check it." };
    }
    return { url: data.signedUrl };
  }

  if (raw.startsWith(VARIATIONS_URL_PREFIX)) {
    const path = raw.slice(VARIATIONS_URL_PREFIX.length);
    const { data, error } = await supabase.storage
      .from(VARIATIONS_BUCKET)
      .createSignedUrl(path, SIGN_SECONDS);
    if (error || !data?.signedUrl) {
      return { error: "could not get a link to that variation. re-render it and try again." };
    }
    return { url: data.signedUrl };
  }

  if (/^https?:\/\//i.test(raw)) return { url: raw };
  return { error: "that clip's link is not something we can post from." };
}

/* -------------------------------------------------------------- one post ops */

/**
 * Drag a scheduled post to a new slot.
 *
 * Upstream first: their scheduler owns when it fires, and a row moved locally
 * that they still hold at the old time is a post that goes out at the time the
 * calendar no longer shows.
 */
export async function movePost(
  postId: string,
  day: string,
  min: number | null
): Promise<BatchState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "your session expired. sign in again." };

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id, job_id, status, scheduled_for")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "that post is gone." };
  if (post.status !== "scheduled") return { error: "that one has already gone out." };

  // month view drags carry no time: keep the minute it already had, read in
  // the creator's own zone so the post stays at "9am" and not at 9am utc.
  const tz = await currentTz();
  const current = post.scheduled_for ? new Date(post.scheduled_for) : new Date();
  const minute = min ?? wallClock(current, tz).min;
  const when = instantOf(day, minute, tz);

  // moving one is always a re-schedule upstream, never a publish, so it keeps
  // the scheduled floor with no "now" window in front of it.
  if (when.getTime() < Date.now() + MIN_LEAD_MS) {
    return { error: "that is too soon. leave at least a minute." };
  }

  if (post.job_id) {
    try {
      await editScheduledJob(post.job_id, { scheduledDate: when.toISOString() }, postKey);
    } catch (err) {
      return {
        error: err instanceof UploadPostError ? err.message : "could not move it upstream.",
      };
    }
  }

  const { error } = await supabase
    .from("social_posts")
    .update({ scheduled_for: when.toISOString() })
    .eq("id", postId);
  if (error) return { error: "moved upstream but not saved. reload the page." };

  revalidateAll(post.deal_id as string | null);
  return { ok: "moved." };
}

/**
 * Take a post off the schedule.
 *
 * A live one is cancelled upstream first and kept as a `canceled` row, which is
 * the honest record. A terminal one is only a row in a list, so it is deleted:
 * nothing is unpublished by this and the planner should not pretend otherwise.
 */
export async function dropPost(postId: string): Promise<BatchState> {
  const { supabase, user } = await authed();
  // the workspace's own upload-post key when it has pasted one, the deploy's
  // env otherwise. resolved once per action rather than per post.
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "your session expired. sign in again." };

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id, job_id, status")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "that post is gone." };

  const live = post.status === "scheduled" || post.status === "processing";

  if (live) {
    if (post.job_id) {
      try {
        await cancelScheduledJob(post.job_id, postKey);
      } catch (err) {
        return {
          error:
            err instanceof UploadPostError ? err.message : "could not cancel it upstream.",
        };
      }
    }
    await supabase.from("social_posts").update({ status: "canceled" }).eq("id", postId);
    revalidateAll(post.deal_id as string | null);
    return { ok: "cancelled." };
  }

  await supabase.from("social_posts").delete().eq("id", postId);
  revalidateAll(post.deal_id as string | null);
  return { ok: "removed from the list. it stays up on the platform." };
}

/**
 * Put a cancelled post back on the schedule.
 *
 * Cancelling is not deleting, and this is the half that makes that true. The
 * row survived the cancel with everything the batch step wrote on it — clip,
 * caption, tags, platforms, options — so bringing it back is a fresh upstream
 * job off the same row rather than building the batch again.
 *
 * It is a NEW job id on purpose: the old one was cancelled at upload-post and
 * cannot be revived, so anything else would leave a row pointing at a job that
 * will never fire. The clip is re-resolved through `publicVideoUrl` for the
 * same reason the queue re-signs its posters: the stored `video_url` of an
 * editor's cut was signed when the batch went out and is long dead by now.
 *
 * Only a cancelled post comes back. A posted one is already out in the world
 * and a failed one has an outcome worth reading before it is retried.
 */
export async function restorePost(
  postId: string,
  day: string,
  min: number
): Promise<BatchState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const postKey = await apiKey("upload_post", user.id);

  const { data: post } = await supabase
    .from("social_posts")
    .select(
      "id, deal_id, caption, hashtags, platforms, options, video_url, source_ref, status"
    )
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "that post is gone." };
  if (post.status !== "canceled") {
    return {
      error:
        post.status === "scheduled" || post.status === "processing"
          ? "that one is already on the schedule."
          : "only a cancelled post can go back on. schedule a new batch for this clip.",
    };
  }
  if (!post.deal_id) return { error: "that post has no brand on it any more." };

  const platforms = (post.platforms ?? []).filter((p: string) =>
    AUTOPOST_PLATFORMS.includes(p as AutopostPlatform)
  ) as AutopostPlatform[];
  if (platforms.length === 0) return { error: "that post has no platforms on it." };

  const tz = await currentTz();
  const when = instantOf(day, min, tz);
  if (Number.isNaN(when.getTime())) return { error: "that time did not read." };
  if (when.getTime() < Date.now() + MIN_LEAD_MS) {
    return { error: "that is too soon. leave at least a minute." };
  }

  const profile = await ensureProfile(supabase, user.id, post.deal_id as string).catch(
    (err) => err
  );
  if (!profile || !("upload_post_username" in profile)) {
    return { error: postingProblem(profile).toLowerCase() };
  }

  const video = await publicVideoUrl(
    supabase,
    user.id,
    String(post.source_ref ?? post.video_url ?? "")
  );
  if ("error" in video) return { error: video.error };

  let result;
  try {
    result = await publishVideo({
      key: postKey,
      username: profile.upload_post_username,
      platforms,
      caption: String(post.caption ?? ""),
      videoUrl: video.url,
      scheduledDate: when.toISOString(),
      facebookPageId: profile.facebook_page_id,
      options: withDefaults(post.options as PostOptions | null),
    });
  } catch (err) {
    return {
      error:
        err instanceof UploadPostError ? err.message : "could not put it back on the schedule.",
    };
  }

  const row = rowFromPublish(result, platforms.length);
  const bornTerminal = row.status !== "scheduled" && row.status !== "processing";

  const { error } = await supabase
    .from("social_posts")
    .update({
      ...row,
      video_url: video.url,
      scheduled_for: when.toISOString(),
      error: null,
      // it is a new outcome to announce, so the old "we told them" stamp goes
      // with the old job.
      notified_at: bornTerminal ? new Date().toISOString() : null,
    })
    .eq("id", postId);
  if (error) {
    return { error: "it is back on upstream but the record did not save. reload the page." };
  }

  revalidateAll(post.deal_id as string);
  return { ok: "back on the schedule." };
}

/**
 * Rename a post.
 *
 * `video_name` is what the batch migration always called "what to call the clip
 * on screen", and until now it was only ever whatever the file happened to be
 * called when it was picked. Two takes off a phone arrive as `IMG_0870.mov` and
 * `IMG_0871.mov`, which is not a name anybody can plan a week against, so the
 * card takes one.
 *
 * The caption is deliberately NOT touched. That is the text that goes out on
 * the platform, and a label on a planner card must never quietly rewrite a
 * post. Clearing the name puts the card back on the caption.
 */
export async function renamePost(postId: string, name: string): Promise<BatchState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  // the same 200 the batch step stores a filename under, so a rename can never
  // be refused by a column a schedule was allowed to write.
  const clean = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "that post is gone." };

  const { error } = await supabase
    .from("social_posts")
    .update({ video_name: clean || null })
    .eq("id", postId);
  if (error) return { error: "could not rename it. try again." };

  revalidateAll(post.deal_id as string | null);
  return { ok: clean ? "renamed." : "name cleared." };
}

/**
 * Delete a post, for good.
 *
 * `dropPost` is the reversible half: it cancels upstream and KEEPS the row as
 * `canceled`, so the plan somebody built — the clip, the caption, the tags, the
 * platform set — survives being taken off the schedule. This is the other
 * answer, for a post that should not be on the planner at all.
 *
 * A live one is cancelled upstream FIRST and nothing is deleted if that fails,
 * because deleting the only record of a post that still fires is how something
 * goes out that nothing on the calendar can explain.
 *
 * Nothing is ever unpublished by it: a posted row says so as it goes. The clip
 * itself stays in storage, since the same file can be on more than one post and
 * a delete here is about the schedule, not about the footage.
 */
export async function deletePost(postId: string): Promise<BatchState> {
  const { supabase, user } = await authed();
  const postKey = await apiKey("upload_post", user?.id ?? null);
  if (!user) return { error: "your session expired. sign in again." };

  const { data: post } = await supabase
    .from("social_posts")
    .select("id, deal_id, job_id, status")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "that post is gone." };

  const status = String(post.status ?? "");
  const live = status === "scheduled" || status === "processing";

  if (live && post.job_id) {
    try {
      await cancelScheduledJob(post.job_id as string, postKey);
    } catch (err) {
      return {
        error:
          err instanceof UploadPostError
            ? err.message
            : "could not cancel it upstream, so nothing was deleted.",
      };
    }
  }

  const { error } = await supabase.from("social_posts").delete().eq("id", postId);
  if (error) return { error: "could not delete that one. try again." };

  revalidateAll(post.deal_id as string | null);
  return {
    ok:
      status === "posted" || status === "partial"
        ? "deleted. it stays up on the platform."
        : "deleted.",
  };
}

/* ------------------------------------------------------------------- presets */

/** The tag list and platform settings this brand always uses. Saved once, read
 *  by every new batch on the deal. */
export async function savePostPreset(
  dealId: string,
  hashtags: string[],
  options: PostOptions
): Promise<BatchState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "your session expired. sign in again." };

  const clean = (hashtags ?? []).map(normalizeTag).filter(Boolean).slice(0, 30);

  const { error } = await supabase.from("deal_post_presets").upsert(
    {
      deal_id: dealId,
      user_id: user.id,
      hashtags: clean,
      options: withDefaults(options),
    },
    { onConflict: "deal_id" }
  );
  if (error) return { error: "could not save that preset." };

  revalidatePath("/tools/autoposting");
  return { ok: "saved as this brand's preset." };
}
