import { createClient } from "@/lib/supabase/server";

/**
 * Is somebody signed in on this request.
 *
 * The marketing bar reads this so a returning member gets their account back
 * instead of a third "Sign in", and it is read on the SERVER on purpose: the
 * browser client would resolve a beat after hydration and the bar would flip
 * from signed out to signed in in front of the person it is wrong about.
 *
 * Claims only. This never asks who they are or whether they paid, because the
 * only decision it feeds is which two links the bar shows.
 *
 * Reading cookies opts the calling page into dynamic rendering. That is the
 * price of a bar that tells the truth, and the proxy already touches every one
 * of these requests anyway.
 */
export async function isSignedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims);
}
