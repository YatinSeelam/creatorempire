import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { apiKey } from "@/lib/api-keys";
import { listScheduledJobs, type ScheduledJob } from "@/lib/autopost/upload-post";
import {
  CHECKING_ERROR,
  CHECKING_MS,
  NOT_BOOKED_ERROR,
  fileOfUrl,
  fileOnSchedule,
  landedJob,
} from "@/lib/autopost/landed";

/** When the look is asked again: the job only appears on their schedule once
 *  they have fetched the clip, which can be after our publish gave up. */
const LOOKS_MS = [0, 8_000, 20_000, 40_000];

/**
 * After a scheduled publish that did not answer: the job it booked anyway, or
 * null. Looked for again on `LOOKS_MS` while `until` allows. Any failure is
 * null, and the caller then writes a row that says it is being checked.
 */
export async function findLandedJob(
  db: SupabaseClient,
  input: {
    username: string;
    scheduledIso: string;
    caption: string;
    videoUrl: string;
    key: string | null;
    until: number;
  }
): Promise<string | null> {
  const files = [fileOfUrl(input.videoUrl)].filter((f): f is string => Boolean(f));
  const started = Date.now();
  for (const at of LOOKS_MS) {
    if (at > 0) {
      if (started + at > input.until) break;
      const wait = started + at - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const jobs = (await listScheduledJobs(input.key)).filter(
        (j) => j.profile_username === input.username && j.job_id
      );
      if (jobs.length === 0) continue;
      const known = await heldJobs(db, jobs);
      if (!known) continue;
      const found = landedJob(jobs, { ...input, known, files });
      if (found) return found;
    } catch {
      // a listing that failed is no answer; the next look, or the check, has it.
    }
  }
  return null;
}

async function heldJobs(db: SupabaseClient, jobs: ScheduledJob[]): Promise<Set<string> | null> {
  const ids = jobs.map((j) => j.job_id).filter((j): j is string => Boolean(j));
  if (ids.length === 0) return new Set();
  const { data, error } = await db.from("social_posts").select("job_id").in("job_id", ids);
  if (error) return null;
  return new Set(((data ?? []) as { job_id: string | null }[]).map((r) => r.job_id ?? ""));
}

type CheckingRow = {
  id: string;
  user_id: string;
  deal_id: string;
  caption: string | null;
  video_url: string | null;
  scheduled_for: string | null;
  created_at: string;
};

/**
 * Every row still "being checked": its booking found BY FILE and its job id
 * written, or, past `CHECKING_MS` with its clip nowhere on their schedule,
 * settled as never booked. It only records what exists upstream; it never
 * sends, cancels or moves anything. Runs on the five minute cron for everyone
 * and on the scheduler's page load for one student.
 */
export async function resolveCheckingPosts(
  db: SupabaseClient,
  opts: { userId?: string; limit?: number } = {}
): Promise<{ checked: number; found: number; notBooked: number }> {
  let query = db
    .from("social_posts")
    .select("id, user_id, deal_id, caption, video_url, scheduled_for, created_at")
    .eq("status", "scheduled")
    .is("job_id", null)
    .is("request_id", null)
    .eq("error", CHECKING_ERROR)
    .order("created_at", { ascending: true })
    .limit(opts.limit ?? 200);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return { checked: 0, found: 0, notBooked: 0 };
  const rows = data as CheckingRow[];

  // one profile per (creator, deal) on this deploy
  const { data: profiles } = await db
    .from("social_profiles")
    .select("user_id, deal_id, upload_post_username")
    .in("deal_id", [...new Set(rows.map((r) => r.deal_id))]);
  const nameOf = new Map(
    ((profiles ?? []) as { user_id: string; deal_id: string; upload_post_username: string }[]).map(
      (p) => [`${p.user_id}|${p.deal_id}`, p.upload_post_username]
    )
  );

  // one listing per key: a workspace can bring its own upload-post account
  const groups = new Map<string, { key: string | null; rows: CheckingRow[] }>();
  for (const row of rows) {
    const key = await apiKey("upload_post", row.user_id).catch(() => null);
    const g = groups.get(key ?? "") ?? { key, rows: [] };
    g.rows.push(row);
    groups.set(key ?? "", g);
  }

  let found = 0;
  let notBooked = 0;
  for (const { key, rows: group } of groups.values()) {
    let jobs: ScheduledJob[];
    try {
      jobs = await listScheduledJobs(key);
    } catch {
      continue;
    }
    const known = await heldJobs(db, jobs);
    if (!known) continue;

    for (const row of group) {
      const username = nameOf.get(`${row.user_id}|${row.deal_id}`);
      if (!username || !row.scheduled_for) continue;
      const files = [fileOfUrl(row.video_url)].filter((f): f is string => Boolean(f));
      const job = landedJob(jobs, {
        username,
        scheduledIso: new Date(row.scheduled_for).toISOString(),
        caption: String(row.caption ?? ""),
        known,
        files,
      });
      // by file or not at all on this path: the words are what a retry shares.
      const listed = job ? jobs.find((j) => j.job_id === job) : null;
      if (job && listed?.source_filename) {
        const { data: moved } = await db
          .from("social_posts")
          .update({ job_id: job, error: null })
          .eq("id", row.id)
          .is("job_id", null)
          .eq("error", CHECKING_ERROR)
          .select("id");
        if (moved && moved.length > 0) {
          known.add(job);
          found += 1;
        }
        continue;
      }
      const old = Date.parse(row.created_at) < Date.now() - CHECKING_MS;
      const passed = Date.parse(row.scheduled_for) < Date.now();
      // a clip that IS on their schedule (held by another row, or two at one
      // minute) is not "never booked", whatever else it is.
      if ((old || passed) && !fileOnSchedule(jobs, username, files)) {
        const { data: settled } = await db
          .from("social_posts")
          .update({ status: "failed", error: NOT_BOOKED_ERROR })
          .eq("id", row.id)
          .is("job_id", null)
          .eq("error", CHECKING_ERROR)
          .select("id");
        if (settled && settled.length > 0) notBooked += 1;
      }
    }
  }
  return { checked: rows.length, found, notBooked };
}
