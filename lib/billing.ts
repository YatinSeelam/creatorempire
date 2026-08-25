import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a signed-in person has paid, and what to say about it.
 *
 * The row lives in `public.subscriptions`, which nobody but the stripe webhook
 * can write (see the migration for why it is not a column on profiles). This
 * reads it with the caller's own session, so the select-own policy is the only
 * thing standing between one account and another's billing state.
 */
export type Billing = {
  /** paid and current. the whole page branches on this. */
  paid: boolean;
  status: "inactive" | "active" | "past_due" | "canceled";
  /** the day the first payment cleared, already formatted for display. */
  paidOn: string | null;
  /**
   * the read itself failed — a 401 on a rotated token, a timeout, postgrest
   * down. NOT the same as "no row", even though both render as unpaid.
   *
   * `paid: false` stays the safe answer for anything that opens a door. But a
   * gate that turns somebody away has to know the difference, because
   * "you have not paid" is a lie when the truth is "we could not ask". See
   * lib/access.ts: an unreadable state must never redirect to the pay page.
   */
  unreadable: boolean;
};

const NONE: Billing = {
  paid: false,
  status: "inactive",
  paidOn: null,
  unreadable: false,
};

export async function getBilling(
  supabase: SupabaseClient,
  userId: string
): Promise<Billing> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, paid_at")
    .eq("user_id", userId)
    .maybeSingle();

  // no row means they have never checked out. so does a failed request, and
  // that is the right way round: an unreadable billing state must never render
  // as "you are paid". the `unreadable` flag is what lets a caller tell the
  // two apart without ever flipping `paid` on a guess.
  if (error) return { ...NONE, unreadable: true };
  if (!data) return NONE;

  const status = (data.status ?? "inactive") as Billing["status"];

  return {
    unreadable: false,
    // past_due still counts as in. stripe retries a failed card for days and
    // locking someone out of their own confirmation page over a retry is worse
    // than showing it to somebody whose card is about to recover.
    paid: status === "active" || status === "past_due",
    status,
    paidOn: data.paid_at ? formatDay(data.paid_at) : null,
  };
}

/** en-US and UTC explicitly. This renders on the server, so the visitor's
 *  locale is not available and guessing it would mismatch on hydration. */
function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
