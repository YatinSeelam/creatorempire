// The editing market's clocks, all riding the hourly cron with the service
// key (auth.uid() is null, so the job guard trusts these writes):
//
//   autoApproveDeliveredJobs  a cut sitting `delivered` for 48h approves
//                             itself, because a creator who never opens the
//                             review is not a creator who gets free work
//   warnDueSoonClaims         one email when a claim has 6h left on its sla
//   expireOverdueClaims       a claim past its sla goes back on the board and
//                             the editor takes a claim_expired strike
//   retierEditors             recomputes every editor's tier from the same
//                             math their own desk shows (lib/editing.ts)

import {
  computeEditorStats,
  tierFor,
  type EditJobStrike,
} from "@/lib/editing";
import { notifyJobReopened } from "@/lib/editing-notify";
import { notificationHtml, sendEmail } from "@/lib/email/send";
import type { createServiceClient } from "@/lib/supabase/service";

type Client = NonNullable<ReturnType<typeof createServiceClient>>;

const WINDOW_HOURS = 48;
const WARN_HOURS = 6;

/** Best effort: the editor's login email, for the sla nudges. */
async function editorEmail(db: Client, userId: string): Promise<string | null> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export async function autoApproveDeliveredJobs(
  db: Client
): Promise<{ approved: number }> {
  const edge = new Date(Date.now() - WINDOW_HOURS * 3600_000).toISOString();

  const { data: jobs } = await db
    .from("edit_jobs")
    .select("id, user_id, editor_id, title, pay_kind, pay_cents, video_count")
    .eq("status", "delivered")
    .not("editor_id", "is", null)
    .lt("delivered_at", edge)
    .limit(50);

  let approved = 0;

  for (const job of jobs ?? []) {
    // conditional flip: a creator approving or sending revisions between the
    // select and here turns this into a no-op.
    const { data: updated } = await db
      .from("edit_jobs")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "delivered")
      .select("id");
    if (!updated?.length) continue;

    await db.from("edit_job_events").insert({
      job_id: job.id,
      author_id: job.user_id,
      kind: "status",
      body: "approved automatically after 48 hours",
    });

    // same freeze as approveEditJob: one payout per job, amount computed now
    // and never again.
    const { data: existing } = await db
      .from("editor_payouts")
      .select("id")
      .eq("job_id", job.id)
      .limit(1);
    if (!existing?.length) {
      const total =
        job.pay_kind === "per_video"
          ? Number(job.pay_cents) * Number(job.video_count)
          : Number(job.pay_cents);
      await db.from("editor_payouts").insert({
        job_id: job.id,
        editor_id: job.editor_id,
        user_id: job.user_id,
        amount_cents: total,
        memo: job.title,
      });
    }

    approved += 1;
  }

  return { approved };
}

/**
 * The 6-hours-left nudge. One email per claim, remembered on the row
 * (`sla_warned_at`) in the same update that decides to send, so the hourly
 * cron cannot nag twice.
 */
export async function warnDueSoonClaims(db: Client): Promise<{ warned: number }> {
  const edge = new Date(Date.now() + WARN_HOURS * 3600_000).toISOString();

  const { data: jobs } = await db
    .from("edit_jobs")
    .select("id, editor_id, title, sla_at")
    .eq("status", "claimed")
    .not("editor_id", "is", null)
    .not("sla_at", "is", null)
    .is("sla_warned_at", null)
    .lt("sla_at", edge)
    .gt("sla_at", new Date().toISOString())
    .limit(50);

  let warned = 0;

  for (const job of jobs ?? []) {
    const { data: updated } = await db
      .from("edit_jobs")
      .update({ sla_warned_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "claimed")
      .is("sla_warned_at", null)
      .select("id");
    if (!updated?.length) continue;
    warned += 1;

    const to = await editorEmail(db, job.editor_id as string);
    if (to) {
      await sendEmail({
        to,
        subject: "your edit is due soon",
        html: notificationHtml({
          heading: "the clock is running",
          lines: [
            `**${job.title}** is due in under ${WARN_HOURS} hours.`,
            "deliver it in the workspace, or release the claim so somebody else can. an expired claim counts against you, a released one barely does.",
          ],
          cta: { label: "open the job", url: `https://www.creatorempire.app/editors/jobs/${job.id}` },
        }),
      });
    }
  }

  return { warned };
}

/**
 * The expiry sweep. A claim past its sla goes back on the board exactly as it
 * was posted, the editor takes a `claim_expired` strike, and the timeline
 * says why the job is open again. Conditional flip per row: an editor
 * delivering between the select and here turns their row into a no-op.
 */
export async function expireOverdueClaims(db: Client): Promise<{ expired: number }> {
  const now = new Date().toISOString();

  const { data: jobs } = await db
    .from("edit_jobs")
    .select("id, user_id, editor_id, title, brand_name")
    .eq("status", "claimed")
    .not("editor_id", "is", null)
    .lt("sla_at", now)
    .limit(50);

  let expired = 0;

  for (const job of jobs ?? []) {
    const editorId = job.editor_id as string;
    const { data: updated } = await db
      .from("edit_jobs")
      .update({
        status: "open",
        editor_id: null,
        claimed_at: null,
        sla_at: null,
        sla_warned_at: null,
      })
      .eq("id", job.id)
      .eq("status", "claimed")
      .eq("editor_id", editorId)
      .lt("sla_at", now)
      .select("id");
    if (!updated?.length) continue;
    expired += 1;

    await db.from("edit_job_strikes").insert({
      editor_id: editorId,
      job_id: job.id,
      kind: "claim_expired",
    });

    await db.from("edit_job_events").insert({
      job_id: job.id,
      author_id: job.user_id,
      kind: "status",
      body: "the claim expired, the job is back on the board",
    });

    // the channel advertised this as claimed, so it has to hear it is open.
    await notifyJobReopened({
      title: String(job.title),
      reason: "expired",
      brand_name: job.brand_name as string | null,
    });

    // three strikes in 30 days pauses the account: no more claims until a
    // human turns it back on. paused rather than deleted, because the work
    // history and any money still owed have to survive the ban.
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const { count: strikes } = await db
      .from("edit_job_strikes")
      .select("id", { count: "exact", head: true })
      .eq("editor_id", editorId)
      .eq("kind", "claim_expired")
      .gte("created_at", cutoff);
    const suspended = (strikes ?? 0) >= 3;
    if (suspended) {
      await db.from("editors").update({ status: "paused" }).eq("user_id", editorId);
    }

    const to = await editorEmail(db, editorId);
    if (to) {
      await sendEmail({
        to,
        subject: suspended ? "your editor account is paused" : "your claim expired",
        html: notificationHtml({
          heading: suspended
            ? "three expired claims in 30 days"
            : "the job went back on the board",
          lines: suspended
            ? [
                `the clock on **${job.title}** ran out, and it is your third expired claim this month, so claiming is paused on your account.`,
                "reply to this email if you want it turned back on. anything you are already owed still pays out.",
              ]
            : [
                `the clock on **${job.title}** ran out, so it is open again for other editors.`,
                "three expiries in 30 days pauses your account. if a claim will not fit, release it early instead, that one is free inside two hours.",
              ],
          cta: { label: "back to the market", url: "https://www.creatorempire.app/editors/market" },
        }),
      });
    }
  }

  return { expired };
}

/**
 * Tiers, recomputed from scratch. Same pure math as the editor's own desk
 * (`computeEditorStats` + `tierFor`), run over every editor with the service
 * key; the flag guard on `editors` lets a null-uid write through. Cheap at
 * this scale, so it rides the hourly cron rather than owning a nightly one.
 */
export async function retierEditors(db: Client): Promise<{ changed: number }> {
  const [{ data: editors }, { data: jobs }, { data: strikes }] = await Promise.all([
    db.from("editors").select("user_id, tier"),
    db
      .from("edit_jobs")
      .select("editor_id, status, claimed_at, sla_at, first_delivered_at, revision_count, rating")
      .not("editor_id", "is", null),
    db.from("edit_job_strikes").select("editor_id, kind, created_at"),
  ]);

  const jobsBy = new Map<string, NonNullable<typeof jobs>>();
  for (const j of jobs ?? []) {
    const key = j.editor_id as string;
    const list = jobsBy.get(key) ?? [];
    list.push(j);
    jobsBy.set(key, list);
  }
  const strikesBy = new Map<string, NonNullable<typeof strikes>>();
  for (const s of strikes ?? []) {
    const list = strikesBy.get(s.editor_id) ?? [];
    list.push(s);
    strikesBy.set(s.editor_id, list);
  }

  let changed = 0;

  for (const editor of editors ?? []) {
    const stats = computeEditorStats(
      (jobsBy.get(editor.user_id) ?? []).map((j) => ({
        status: String(j.status) as never,
        claimed_at: j.claimed_at as string | null,
        sla_at: j.sla_at as string | null,
        first_delivered_at: j.first_delivered_at as string | null,
        revision_count: Number(j.revision_count ?? 0),
        rating: (j.rating as number | null) ?? null,
      })),
      (strikesBy.get(editor.user_id) ?? []).map((s) => ({
        kind: s.kind as EditJobStrike["kind"],
        created_at: s.created_at as string,
      }))
    );
    const tier = tierFor(stats);
    if (tier !== Number(editor.tier)) {
      await db.from("editors").update({ tier }).eq("user_id", editor.user_id);
      changed += 1;
    }
  }

  return { changed };
}
