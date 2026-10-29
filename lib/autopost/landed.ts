/**
 * A PUBLISH THAT DID NOT ANSWER MAY HAVE BOOKED ANYWAY (2026-10-29).
 *
 * Upload-Post fetches the clip before it answers `/upload`, and from
 * 2026-10-28 that routinely ran past our 45s. The batch said "Nothing was
 * posted. Try again." and STOPPED, so the rest of the batch was never sent,
 * the student tried again, and the first booking went out on its own with no
 * row able to see or cancel it: nine of those on this deploy the day it was
 * found. So a timed out publish is looked for on their schedule by the FILE it
 * sent, never by its words: a retry sends the same words to the same minute,
 * and on this deploy often the same file too.
 *
 * Pure. The server half is `lib/autopost/landed-server.ts`.
 */

/** What a post whose publish timed out says while it is being looked for.
 *  The row is `scheduled` with no job id; nothing moves, cancels or deletes
 *  it until the check says what exists upstream. */
export const CHECKING_ERROR =
  "upload-post took too long to answer, so we are checking whether it was booked. do not schedule it again.";

/** What it says once its clip is known not to be on their schedule. */
export const NOT_BOOKED_ERROR =
  "upload-post took too long to answer and never booked this one, so nothing will go out. schedule it again.";

/** What a refused move, cancel or delete says about a row being checked. */
export const CHECKING_REFUSAL =
  "still checking with upload-post whether this one was booked. try again in a few minutes.";

/** How long a row is "being checked" before a missing booking means none. */
export const CHECKING_MS = 30 * 60_000;

/** whether a row is the timed out kind: scheduled, no job, the sentence. */
export function isChecking(post: {
  status?: string | null;
  job_id?: string | null;
  error?: string | null;
}): boolean {
  return post.status === "scheduled" && !post.job_id && post.error === CHECKING_ERROR;
}

/** The fields of a listed scheduled job this reads. */
export type ListedJob = {
  job_id?: string | null;
  profile_username?: string | null;
  scheduled_date?: string | null;
  original_scheduled_str?: string | null;
  title?: string | null;
  /** the basename of the video url the job was booked with. */
  source_filename?: string | null;
};

/** The file name Upload-Post records for a video url. Pure. */
export function fileOfUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split(/[?#]/)[0];
  }
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function minuteOf(value: string | null | undefined, zoneless = false): number | null {
  if (!value) return null;
  // their `scheduled_date` is a wall clock with no zone, and it is UTC.
  const text = zoneless && !/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? `${value}Z` : value;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : null;
}

/**
 * The job a timed out publish booked, or null. Same profile, same minute, the
 * same FILE when the job lists one (the words only for a job that lists none),
 * and not a job a row of ours already holds. Exactly one match or nothing: two
 * is a guess, and adopting the wrong one leaves the real orphan firing.
 */
export function landedJob(
  jobs: readonly ListedJob[],
  want: {
    username: string;
    scheduledIso: string;
    caption: string;
    known: ReadonlySet<string>;
    files: readonly string[];
  }
): string | null {
  const minute = minuteOf(want.scheduledIso);
  if (minute === null || !want.username) return null;
  const words = want.caption.trim().slice(0, 60);
  const files = new Set(want.files.filter(Boolean));
  const hits = jobs.filter((j) => {
    if (!j.job_id || want.known.has(j.job_id)) return false;
    if (j.profile_username !== want.username) return false;
    const at = minuteOf(j.original_scheduled_str) ?? minuteOf(j.scheduled_date, true);
    if (at !== minute) return false;
    const file = typeof j.source_filename === "string" ? j.source_filename.trim() : "";
    if (files.size > 0 && file) return files.has(file);
    return String(j.title ?? "").trim().slice(0, 60) === words;
  });
  return hits.length === 1 ? (hits[0].job_id as string) : null;
}

/** whether any job of this profile, held or not, carries one of the files. */
export function fileOnSchedule(
  jobs: readonly ListedJob[],
  username: string,
  files: readonly string[]
): boolean {
  const set = new Set(files.filter(Boolean));
  return jobs.some(
    (j) =>
      j.profile_username === username &&
      typeof j.source_filename === "string" &&
      set.has(j.source_filename)
  );
}
