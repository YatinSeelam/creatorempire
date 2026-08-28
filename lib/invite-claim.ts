import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Seat the signed-in person from an invite written to their email.
 *
 * The token path (`/join/<token>` → `accept_org_invite`) is still the one an
 * emailed link walks. This is the other half: an invite is a message, and a
 * message gets lost, forwarded, opened on a phone that is signed in as
 * somebody else. What the programme actually decided is "this google account
 * is in", and that decision is already in `org_invites`. So the same accept
 * runs on the identity google verified rather than on a secret in a url, and
 * being added to the roster is enough to sign in.
 *
 * Best effort on purpose, like every other read on the way in: a failed rpc is
 * "nothing to claim", never "let them in". The gate that called this is what
 * decides, and it decides off `org_members` either way.
 *
 * Returns the org they were seated on, or null when there was nothing waiting.
 */
export async function claimPendingInvite(supabase: Client): Promise<string | null> {
  const { data, error } = await supabase.rpc("claim_org_invite");

  if (error) {
    console.error("[invite] claim_org_invite failed", error.message);
    return null;
  }

  return (data as string | null) ?? null;
}
