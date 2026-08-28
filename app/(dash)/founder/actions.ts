"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AccessLevel } from "@/lib/access-levels";
import { CE_ORG_ID } from "@/lib/org";
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
 * What somebody is allowed to do here, set from the one list that shows them.
 *
 * There used to be an Access tab: its own page, its own list of email
 * addresses, and no way to tell which of them was the person you were looking
 * at on People. Two lists of the same human beings is one list too many, so
 * the control moved onto the row.
 *
 * Three states, and each one writes exactly the rows `lib/access.ts`
 * `isEntitled` reads. Nothing else is touched:
 *
 *   founder    a row on `admin_emails` with role 'founder'. Their seat, if
 *              they hold one, is left alone: the platform role and a seat on
 *              the workspace are different facts and a founder is usually both.
 *   student    no grant, and a seat on the workspace with role 'creator'.
 *   no access  neither. They keep their account and everything in it; they
 *              land on /account the next time they load a page.
 *
 * The grant is written with the caller's own session, so the database's guards
 * are the check: you cannot change your own row, and the last founder cannot be
 * demoted or deleted. The SEAT needs the service key, because sessions are
 * granted select/delete/update(role) on `org_members` and never insert — the
 * only other way in is `accept_org_invite`, which needs a token somebody was
 * sent. An owner seat is never written by this at all: the workspace owner is
 * pinned by trigger and removing them would leave the programme ownerless.
 */
export type AccessState = { error?: string; ok?: string };

const LEVELS: readonly AccessLevel[] = ["none", "student", "founder"];

export async function setAccess(formData: FormData): Promise<AccessState> {
  const { user } = await requireFounder("/founder");

  const userId = String(formData.get("user_id") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const raw = String(formData.get("level") ?? "");
  const level = (LEVELS as readonly string[]).includes(raw)
    ? (raw as AccessLevel)
    : null;

  if (!level) return { error: "pick an access level." };
  if (!email) return { error: "no email on that account, so there is nothing to set." };
  // the database refuses this for the grant half and says so; the seat half has
  // no such guard, and a founder removing their own seat mid-click is the one
  // way to lock yourself out of the programme side.
  if (email === (user.email ?? "").toLowerCase())
    return { error: "you cannot change your own access." };
  // a seat needs somebody to seat. an address with no account can be put on the
  // founder list (it waits for them) but cannot hold one.
  if (!userId && level === "student")
    return {
      error: "they have to sign in once first. invite them from invites & roles.",
    };

  const supabase = await createClient();

  // 1. the grant. founder is the only one worth writing: the 'creator' grant
  //    opens nothing on this deploy (a seat does), so it is never handed out.
  if (level === "founder") {
    const { error } = await supabase
      .from("admin_emails")
      .upsert({ email, role: "founder", added_by: user.id }, { onConflict: "email" });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("admin_emails").delete().eq("email", email);
    if (error) return { error: error.message };
  }

  // 2. the seat. nothing to do for an address nobody has signed up on yet.
  if (userId) {
    const seatError = await setSeat(userId, level);
    if (seatError) return { error: seatError };
  }

  revalidatePath("/founder");
  if (userId) revalidatePath(`/founder/people/${userId}`);
  return {
    ok:
      level === "none"
        ? `${email} is out.`
        : `${email} is a ${level}.`,
  };
}

/**
 * Give or take the workspace seat, on the service client.
 *
 * Returns a message rather than throwing, because every caller of this is a
 * picker that has to put itself back where it was and say why.
 */
async function setSeat(userId: string, level: AccessLevel): Promise<string | null> {
  const service = createServiceClient();
  if (!service) return "SUPABASE_SECRET_KEY is not set, so seats cannot be changed.";

  const { data: seat } = await service
    .from("org_members")
    .select("role")
    .eq("org_id", CE_ORG_ID)
    .eq("user_id", userId)
    .maybeSingle();

  // the owner is the workspace. never demoted, never removed, not from here.
  if (seat?.role === "owner") return null;

  if (level === "student") {
    if (!seat) {
      const { error } = await service
        .from("org_members")
        .insert({ org_id: CE_ORG_ID, user_id: userId, role: "creator" });
      return error ? error.message : null;
    }
    if (seat.role !== "creator") {
      const { error } = await service
        .from("org_members")
        .update({ role: "creator" })
        .eq("org_id", CE_ORG_ID)
        .eq("user_id", userId);
      return error ? error.message : null;
    }
    return null;
  }

  if (level === "none" && seat) {
    const { error } = await service
      .from("org_members")
      .delete()
      .eq("org_id", CE_ORG_ID)
      .eq("user_id", userId);
    return error ? error.message : null;
  }

  // founder: the seat is theirs to keep, whatever it is.
  return null;
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
