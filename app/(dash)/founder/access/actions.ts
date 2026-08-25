"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FounderActionState = { error?: string; ok?: string };

/**
 * Add and remove run as the signed-in user, so row level security is what
 * actually decides whether they are allowed. No service role key is involved
 * and no founder check is duplicated in JS that could drift from the policy.
 *
 * The database also refuses to remove the last founder, or to let you remove
 * yourself, so there is no way to lock everyone out of the dashboard.
 */
export async function addFounder(
  _prev: FounderActionState,
  formData: FormData
): Promise<FounderActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (!email) return { error: "Enter an email address." };

  // two grants, one list. anything that is not the founder word is a creator,
  // so a tampered form can only ever grant the narrower of the two.
  const role = formData.get("role") === "founder" ? "founder" : "creator";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("admin_emails")
    .insert({ email, role, added_by: user?.id ?? null });

  if (error) {
    if (error.code === "23505") return { error: `${email} is already on the list.` };
    // rls rejects the write with a row-level-security error rather than a 403
    if (error.code === "42501")
      return { error: "You do not have permission to grant access." };
    return { error: error.message };
  }

  revalidatePath("/founder/access");
  return { ok: `${email} is now a ${role}.` };
}

/**
 * Move somebody between the two grants. The database decides whether this is
 * allowed: only a founder can see or write this table at all, and dropping the
 * last founder to creator is refused by the same rule that refuses deleting
 * them.
 */
export async function setGrantRole(
  _prev: FounderActionState,
  formData: FormData
): Promise<FounderActionState> {
  const email = String(formData.get("email") ?? "").toLowerCase();
  const role = formData.get("role") === "founder" ? "founder" : "creator";
  if (!email) return { error: "Nothing to change." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("admin_emails")
    .update({ role })
    .eq("email", email);

  if (error) return { error: error.message };

  revalidatePath("/founder/access");
  return { ok: `${email} is now a ${role}.` };
}

export async function removeFounder(
  _prev: FounderActionState,
  formData: FormData
): Promise<FounderActionState> {
  const email = String(formData.get("email") ?? "").toLowerCase();
  if (!email) return { error: "Nothing to remove." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("admin_emails")
    .delete()
    .eq("email", email);

  if (error) return { error: error.message };

  revalidatePath("/founder/access");
  return { ok: `${email} is no longer a founder.` };
}
