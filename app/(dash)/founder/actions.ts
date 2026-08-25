"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { slugProblem, TENANT_ROOT, toSlug } from "@/lib/org";
import { requireFounder } from "@/lib/supabase/founder";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * "view as": a real session swap, not a header trick. The admin's own session
 * is stashed in an httpOnly cookie, a one-time magic link is minted for the
 * target and verified server-side, and from that point every request runs as
 * the student, rls included. `ugcf_viewas` only carries the banner's name and
 * is never a permission; the way back is possession of `ugcf_admin_return`.
 */

const RETURN_COOKIE = "ugcf_admin_return";
const VIEWAS_COOKIE = "ugcf_viewas";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  // long on purpose. the swapped session does not expire when these do, so a
  // short ttl here meant the banner and the way back vanished after two hours
  // while the admin silently stayed signed in as the student. the cookies must
  // outlive any plausible impersonation, and exiting deletes them anyway.
  maxAge: 60 * 60 * 24 * 30,
};

async function clearViewAsCookies() {
  const store = await cookies();
  store.delete(RETURN_COOKIE);
  store.delete(VIEWAS_COOKIE);
}

export async function startViewAs(formData: FormData) {
  await requireFounder("/founder");

  const userId = String(formData.get("user_id") ?? "").trim();
  if (!userId) redirect("/founder?viewas_error=missing+user");

  const service = createServiceClient();
  if (!service) {
    // a deploy without the secret key cannot mint sessions. say so, don't crash.
    redirect("/founder?viewas_error=SUPABASE_SECRET_KEY+is+not+set");
  }

  const { data: target, error: userError } =
    await service.auth.admin.getUserById(userId);
  const email = target?.user?.email;
  if (userError || !email) {
    redirect("/founder?viewas_error=no+auth+user+with+an+email+for+that+id");
  }

  // the banner's name: profile full name when there is one, email otherwise.
  const { data: profile } = await service
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  const displayName = profile?.full_name?.trim() || email;

  // stash the ADMIN's current session before anything overwrites it.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login?next=%2Ffounder");

  const store = await cookies();
  store.set(
    RETURN_COOKIE,
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }),
    COOKIE_OPTS
  );
  store.set(VIEWAS_COOKIE, displayName, COOKIE_OPTS);

  // mint a one-time token for the target and consume it here, server-side.
  // no link is ever sent; verifyOtp writes the student's session cookies over
  // the admin's, which is the actual swap.
  const { data: link, error: linkError } =
    await service.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    await clearViewAsCookies();
    redirect("/founder?viewas_error=could+not+mint+a+login+for+that+user");
  }

  const { error: otpError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (otpError) {
    // never leave the request half-swapped: no stash, no banner, admin intact.
    await clearViewAsCookies();
    redirect("/founder?viewas_error=session+swap+failed");
  }

  redirect("/dashboard");
}

/**
 * Mint an agency workspace for somebody else, owned by them.
 *
 * This is how a b2b customer gets in. The (dash) gate opens for an admin, a
 * paid subscription or a seat on an org, and an agency owner arriving from the
 * mentorships page is none of those: they never pay a creator plan, and the
 * only place a workspace could be made (/new) sits behind the gate they cannot
 * pass. So they signed up, landed on the pricing page, and stopped. Even "view
 * as" could not rescue them, because it lands on the same page.
 *
 * The service client is what makes this possible: `orgs_insert_own` insists
 * `owner_id = auth.uid()`, and the whole point here is that it is not. The
 * insert trigger (`seat_org_owner`) writes their owner seat, which is the row
 * that opens the gate for them the next time they load a page. Nothing else
 * changes hands. They still cannot see any creator's deals until that creator
 * accepts an invite; membership is a lens, not ownership.
 *
 * Requires an existing account: the row needs a real `owner_id`, and a
 * profile row is what tells us there is one. Sign up first, then this.
 */
export async function createOrgFor(formData: FormData) {
  await requireFounder("/founder");

  const userId = String(formData.get("user_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const slug = toSlug(String(formData.get("slug") ?? "").trim() || name);
  const to = `/founder/people/${userId}`;
  const back = (note: string): never =>
    redirect(`${to}?note=${encodeURIComponent(note)}`);

  if (!userId) redirect("/founder");
  if (!name) back("give the workspace a name.");
  const problem = slugProblem(slug);
  if (problem) back(problem.toLowerCase());

  const service = createServiceClient();
  if (!service)
    return back(
      "SUPABASE_SECRET_KEY is not set, so nothing can be made for them."
    );

  const { data: profile } = await service
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) back("no account behind that id. they need to sign up first.");

  const { error } = await service
    .from("orgs")
    .insert({ name, slug, owner_id: userId });

  if (error) {
    back(
      error.code === "23505"
        ? `${slug}.${TENANT_ROOT} is taken. try another address.`
        : error.message
    );
  }

  revalidatePath(to);
  back(
    `${name} is theirs. it shows up in their switcher the next time they load a page.`
  );
}

/**
 * No admin check on purpose: the current session IS the student's, so
 * `requireFounder` would bounce the one person allowed to press this. The
 * permission is holding the httpOnly return cookie, which only startViewAs
 * writes. Anything wrong with it falls through to a clean sign-out.
 */
export async function stopViewAs() {
  const store = await cookies();
  const raw = store.get(RETURN_COOKIE)?.value;
  const supabase = await createClient();

  let tokens: { access_token?: string; refresh_token?: string } | null = null;
  if (raw) {
    try {
      tokens = JSON.parse(raw);
    } catch {
      tokens = null;
    }
  }

  if (tokens?.access_token && tokens.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (!error) {
      await clearViewAsCookies();
      redirect("/founder");
    }
  }

  // missing or dead stash: do not strand them in the student's account.
  await supabase.auth.signOut();
  await clearViewAsCookies();
  redirect("/login");
}
