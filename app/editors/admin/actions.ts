"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The payout queue's one write: everything an editor is owed becomes paid in
 * one click, after the founder has sent the money by hand. Founder-gated the
 * same self-contained way the roster page is, and the actual flip happens in
 * `mark_editor_payout_paid`, which re-checks `am_i_admin()` inside the
 * definer, so this action proves nothing rls does not re-prove.
 */
export async function markEditorPaid(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: isFounder } = await supabase.rpc("am_i_admin");
  if (!isFounder) return;

  const editorId = String(formData.get("editor_id") ?? "").slice(0, 40);
  const via = String(formData.get("via") ?? "").slice(0, 40) || null;
  if (!editorId) return;

  const db = await createClient({ adminView: true });
  const { data: due } = await db
    .from("editor_payouts")
    .select("id")
    .eq("editor_id", editorId)
    .eq("status", "due");

  for (const row of due ?? []) {
    await db.rpc("mark_editor_payout_paid", {
      p_id: (row as { id: string }).id,
      p_via: via,
      p_ref: null,
    });
  }

  // the money went out, so the editor's raised hand comes down with it.
  await db
    .from("editor_payout_details")
    .update({ payout_requested_at: null })
    .eq("user_id", editorId);

  revalidatePath("/editors/admin");
}
