"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The three writes a person gets on their own bell.
 *
 * No route lives in this folder, only these. They are called from the rail,
 * which is mounted in both shells, so they cannot sit under /editing or
 * /settings without one half of the app reaching across into the other's
 * segment.
 *
 * Every one runs on the session client. The table's update grant is scoped to
 * `read_at` alone and the policies are `user_id = auth.uid()`, so none of these
 * needs to prove anything beyond being signed in — a tampered id simply matches
 * no row.
 */

/** Tapped a row. Marking read is idempotent, so no status check. */
export async function markNotificationRead(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").slice(0, 40);
  if (!id) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  revalidatePath("/", "layout");
}

/** Clears the count without opening anything. */
export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  revalidatePath("/", "layout");
}

/** Throws the history away. Delete rather than hide: nothing here is a record. */
export async function clearNotifications(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("notifications").delete().eq("user_id", user.id);

  revalidatePath("/", "layout");
}
