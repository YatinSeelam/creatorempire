"use server";

import { revalidatePath } from "next/cache";
import { notifyClientVerdict } from "@/lib/editing-notify";
import type { ReviewVerdict } from "@/lib/editing-review";
import { push } from "@/lib/notify-server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ReviewState = { error?: string; ok?: string };

const REFUSALS: Record<string, string> = {
  closed: "this review is closed. ask whoever sent you the link.",
  body_required: "write a line first so they know what you mean.",
  too_many: "that is a lot of notes in one hour. take a breath and try again.",
  bad_verdict: "something went wrong. reload and try again.",
  missing: "this link does not open any more.",
};

/**
 * The only write an anonymous link holder gets.
 *
 * Everything that decides whether it is allowed lives in `review_link_say`,
 * which is security definer and checks the token, the job's status, the body
 * and the rate limit itself. This action is the postman: it carries the form
 * over, then tells the creator what was said.
 */
export async function leaveVerdict(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  const token = String(formData.get("token") ?? "").trim();
  const raw = String(formData.get("verdict") ?? "");
  const verdict: ReviewVerdict =
    raw === "approved" || raw === "changes" || raw === "comment"
      ? raw
      : "comment";

  if (!token) return { error: "this link does not open any more." };

  const name = String(formData.get("name") ?? "").trim().slice(0, 80) || null;
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000) || null;
  const cut = String(formData.get("deliverable") ?? "").trim() || null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_link_say", {
    p_token: token,
    p_verdict: verdict,
    p_name: name,
    p_body: body,
    p_deliverable: cut,
  });

  if (error) return { error: "could not send that. try again in a moment." };

  const payload = (data ?? {}) as Record<string, unknown>;
  if (payload.ok !== true) {
    return { error: REFUSALS[String(payload.reason ?? "")] ?? REFUSALS.missing };
  }

  // best effort from here down: the note is already saved, and a ping that
  // fails must never look to the reviewer like their feedback did not land.
  try {
    await ping(String(payload.job_id ?? ""), verdict, name, body);
  } catch (err) {
    console.error("[review] notify failed", err instanceof Error ? err.message : err);
  }

  revalidatePath(`/review/${token}`);
  return {
    ok:
      verdict === "approved"
        ? "sent. they have your sign-off."
        : verdict === "changes"
          ? "sent. they have your changes."
          : "sent.",
  };
}

/**
 * Tell the creator. Needs the job's owner and title, which an anonymous caller
 * has no read on by design, so this is the service client's job. With no
 * service key set the discord ping still goes out and the mail does not.
 */
async function ping(
  jobId: string,
  verdict: ReviewVerdict,
  name: string | null,
  body: string | null
): Promise<void> {
  if (!jobId) return;
  const service = createServiceClient();
  if (!service) return;

  const { data: job } = await service
    .from("edit_jobs")
    .select("id, user_id, title, brand_name")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;

  const title = (job.title as string) ?? "an edit";
  const who = name?.trim() || "your client";

  await Promise.all([
    notifyClientVerdict({
      jobId: job.id as string,
      ownerId: job.user_id as string,
      jobTitle: title,
      brandName: (job.brand_name as string | null) ?? null,
      verdict,
      reviewerName: name,
      body,
    }),
    // the bell too, not instead: the discord ping is the staff feed and the
    // email is behind a toggle, so this is the only one that is always on and
    // always the creator's own.
    push({
      userId: job.user_id as string,
      kind:
        verdict === "approved"
          ? "client_approved"
          : verdict === "changes"
            ? "client_changes"
            : "client_note",
      title:
        verdict === "approved"
          ? `${who} approved ${title}`
          : verdict === "changes"
            ? `${who} asked for changes on ${title}`
            : `${who} left a note on ${title}`,
      body:
        body ??
        (verdict === "approved" ? "approve it to release the editor's payout." : null),
      href: `/editing/${job.id as string}`,
      subject: job.id as string,
    }),
  ]);
}
