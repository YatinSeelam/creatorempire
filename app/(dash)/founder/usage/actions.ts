"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/supabase/founder";

/**
 * The writes behind the usage page: the per-person daily cap, and nothing else.
 * Pricing used to be editable here too; it moved into code
 * (`lib/usage-pricing.ts`) because the honest outcome of a rate form was that
 * nobody filled it in and every dollar figure read "not set".
 *
 * Both actions call `requireFounder()` again before they touch anything: a server
 * action is its own entry point, reachable by anyone who can guess its id, so
 * "the page already checked" is not a check. Row level security says the same
 * thing a second time underneath.
 */

export type UsageActionState = { error?: string; ok?: string };

/**
 * A whole number, where an empty field is a real answer rather than a mistake.
 * Blank means "no value", which is how a cap says unlimited, so the states have
 * to stay apart.
 */
type WholeResult = { ok: true; value: number | null } | { ok: false };

function parseWholeOrBlank(input: unknown): WholeResult {
  const text = String(input ?? "")
    .trim()
    .replace(/[,\s]/g, "");
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false };

  const n = Number(text);
  if (!Number.isSafeInteger(n)) return { ok: false };
  return { ok: true, value: n };
}

/** Postgres codes turned into something a person can act on. */
function readable(error: { code?: string; message: string }): string {
  if (error.code === "42501")
    return "You do not have permission to change this.";
  if (error.code === "23503") return "That account no longer exists.";
  return error.message;
}

export async function setUserCap(
  _prev: UsageActionState,
  formData: FormData
): Promise<UsageActionState> {
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!userId) return { error: "Pick who the cap is for." };

  const parsed = parseWholeOrBlank(formData.get("daily_credit_cap"));
  if (!parsed.ok) return { error: "The cap has to be a whole number of credits." };

  const note = String(formData.get("note") ?? "").trim();

  const { supabase } = await requireFounder("/founder/usage");

  // a row with a null cap is not the same as no row: null is "unlimited, on
  // purpose, for this person", no row is "whatever the default happens to be".
  const { error } = await supabase.from("api_user_limits").upsert(
    {
      user_id: userId,
      daily_credit_cap: parsed.value,
      note: note || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) return { error: readable(error) };

  revalidatePath("/founder/usage");
  return {
    ok:
      parsed.value === null
        ? "Saved. That person has no daily cap at all."
        : `Saved. ${parsed.value} credits a day.`,
  };
}

export async function clearUserCap(
  _prev: UsageActionState,
  formData: FormData
): Promise<UsageActionState> {
  const userId = String(formData.get("user_id") ?? "").trim();
  if (!userId) return { error: "Nothing to remove." };

  const { supabase } = await requireFounder("/founder/usage");

  const { error } = await supabase
    .from("api_user_limits")
    .delete()
    .eq("user_id", userId);

  if (error) return { error: readable(error) };

  revalidatePath("/founder/usage");
  return { ok: "Override removed. They are back on the default." };
}
