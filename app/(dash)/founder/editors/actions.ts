"use server";

/**
 * Moving an application along. One write, and it is an rpc rather than an
 * update: `status` is not granted to `authenticated` on any path, so
 * `set_editor_application_status` (security definer, admin-checked inside) is
 * the only thing that can change it. The requireFounder here is the second lock,
 * not the only one.
 */

import { revalidatePath } from "next/cache";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/editing";
import { requireFounder } from "@/lib/supabase/founder";

export type FounderActionState = { error?: string; ok?: string };

export async function setApplicationStatus(
  _prev: FounderActionState,
  formData: FormData
): Promise<FounderActionState> {
  const { supabase } = await requireFounder("/founder/editors");

  const userId = String(formData.get("user_id") ?? "").slice(0, 40);
  const status = String(formData.get("status") ?? "") as ApplicationStatus;

  if (!userId) return { error: "missing applicant." };
  if (!APPLICATION_STATUSES.includes(status)) return { error: "unknown status." };

  const { error } = await supabase.rpc("set_editor_application_status", {
    p_user: userId,
    p_status: status,
  });
  if (error) return { error: error.message };

  revalidatePath("/founder/editors");
  return { ok: "saved." };
}

/**
 * The platform paying an editor out BY HAND. Same shape as the status move: an
 * rpc with the admin check inside (`mark_editor_payout_paid`), because editors
 * have no update path on their own payouts and the creator already paid in
 * credits at post time.
 *
 * This is the escape hatch, not the normal path. Editors cash out themselves
 * and a rail sends it; this button exists for the ones no rail reaches (Brazil
 * and Nepal cannot use Connect, and PayPal needs credentials that are not set).
 * The rpc refuses while an automated batch is in flight for the same row, so
 * pressing it cannot double up with a payout that is already moving. That
 * refusal is the one error worth surfacing here rather than swallowing: a
 * founder who thinks this failed silently sends the money twice.
 */
export async function markEditorPayoutPaid(formData: FormData): Promise<void> {
  const { supabase } = await requireFounder("/founder/editors");

  const payoutId = String(formData.get("payout_id") ?? "").slice(0, 40);
  if (!payoutId) return;

  const { error } = await supabase.rpc("mark_editor_payout_paid", {
    p_id: payoutId,
    p_via: "manual",
    p_ref: null,
  });
  if (error) {
    console.error("[founder] mark paid refused", payoutId, error.message);
    throw new Error(
      error.message.includes("already in flight")
        ? "A payout is already going out for this one. Wait for it to land, then check whether it still needs paying."
        : error.message
    );
  }

  revalidatePath("/founder/editors");
}
