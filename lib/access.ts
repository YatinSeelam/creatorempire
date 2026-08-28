import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getBilling } from "@/lib/billing";
import { claimPendingInvite } from "@/lib/invite-claim";
import { createClient } from "@/lib/supabase/server";
import { CE_ORG_ID, type OrgRole } from "@/lib/org";

/**
 * Who is allowed into `(dash)`, and on whose ticket.
 *
 * Until now the answer was "a founder", and `requireFounder()` in the layout
 * was the whole product's front door. That was correct while the only account
 * was mine. It is not correct once someone pays, and it is not correct at all
 * once a mentorship buys the app for its roster: those creators never pay us
 * directly and never appear on `admin_emails`, so both existing checks say no.
 *
 * Four ways in, and they are genuinely different people:
 *
 *   founder - `admin_emails` with role 'founder'. the people who build the
 *             product. sees every workspace, reaches /founder. NOT an agency
 *             role: an agency's own "admin" (lib/org.ts, `org_members.role`)
 *             is admin of exactly that workspace and nothing here.
 *   creator - `admin_emails` with role 'creator'. somebody we handed the
 *             tracker to: the dashboard, deals and tools, and nothing that
 *             belongs to running the business. They never pay and hold no
 *             seat, so before this row existed every gate turned them away.
 *   paid    - a `subscriptions` row that is active or past_due. a solo creator.
 *   seated  - a row in `org_members`. someone a mentorship invited.
 *
 * A seat is not a subscription and must not be checked as one. The org pays,
 * the creator does not, and asking a student for a card is the fastest way to
 * lose the account that bought the seats.
 *
 * `requireFounder()` stays exactly as it is and keeps guarding /founder. This is a
 * wider door beside it, not a replacement for it.
 */

export type Membership = { org_id: string; role: OrgRole };

export type Access = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  /**
   * on `admin_emails`. the platform's founder role: the only thing that opens
   * /founder and the only thing that can hand a workspace a custom tool. the
   * table and the rpc keep their old "admin" names on purpose (see the
   * 20260818200000 migration); every screen and every identifier says founder.
   */
  isFounder: boolean;
  /**
   * granted a seat at the product without paying for one: `admin_emails` with
   * role 'creator'. Opens `(dash)` and nothing else. A founder is not one of
   * these, they are the wider grant.
   */
  isGrantedCreator: boolean;
  /** their own stripe subscription, active or recovering. */
  paid: boolean;
  /** every org they hold a seat on, with the role they hold it as. */
  memberships: Membership[];
  /**
   * one of the three reads behind this object failed — not "came back empty",
   * failed. A rotated token, a postgrest timeout, a cold pool at the far edge
   * of a function's budget.
   *
   * Every field above still fails closed, which is right: nothing opens on a
   * read we could not make. But "not entitled" and "we could not tell" are
   * different sentences, and only the first one may be shown to a person. See
   * `requireViewer()`.
   */
  readFailed: boolean;
};

/**
 * The grant, with one retry.
 *
 * This single rpc is the whole of a granted creator's entitlement: they hold no
 * subscription and no seat, so one failed round trip is the difference between
 * their dashboard and a page telling them they never paid. A transient failure
 * here was the reported bug — it landed every time somebody autoposted, because
 * an autopost revalidates three paths and re-runs this gate while an upstream
 * upload is still holding the request open.
 *
 * The retry is deliberately not a loop. If two calls in a row fail the problem
 * is not transient and `failed` is the honest answer.
 */
async function readGrant(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ role: string | null; failed: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc("my_granted_role");
    if (!error) return { role: (data as string | null) ?? null, failed: false };
    // logged, not swallowed. the old version discarded this error, so the only
    // trace of an ejected creator was the creator telling us.
    console.error("[access] my_granted_role failed", {
      attempt,
      message: error.message,
    });
  }
  return { role: null, failed: true };
}

/**
 * The reads behind every gate below, done once per request.
 *
 * `cache()` is what makes calling `requireViewer()` in the layout AND again in
 * a page free. Pages do call it again on purpose: a layout cannot hand anything
 * to its children, and "the layout already checked" is not a check.
 *
 * The client here is the ordinary one. Nothing in this file may pass
 * `adminView` or `orgView` — those widen the read past the signed-in user and
 * belong to `requireFounderView()` and `lib/org-server.ts` respectively.
 */
const load = cache(async (): Promise<Access | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const [granted, billing, seats] = await Promise.all([
    // one round trip for both questions: 'founder', 'creator', or null.
    readGrant(supabase),
    getBilling(supabase, user.id),
    // `.eq("user_id", ...)` is load bearing, not belt and braces: the read
    // policy on org_members hands an owner or admin every seat on the orgs
    // they manage, not just their own. Without the filter an owner who had
    // invited one admin got that admin's row in this list too, the
    // role map in lib/workspace.ts kept whichever came back last, and the
    // owner was an "admin" of their own workspace: no Branding row on the
    // rail, bounced off /agency/branding. their seat, and only their seat.
    supabase.from("org_members").select("org_id, role").eq("user_id", user.id),
  ]);

  if (seats.error) {
    console.error("[access] org_members read failed", seats.error.message);
  }

  return {
    supabase,
    user,
    // a failed rpc comes back null, which is "granted nothing" and therefore
    // neither a founder nor a creator. never "let them in".
    isFounder: granted.role === "founder",
    isGrantedCreator: granted.role === "creator",
    paid: billing.paid,
    memberships: (seats.data ?? []) as Membership[],
    readFailed: granted.failed || billing.unreadable || Boolean(seats.error),
  };
});

/**
 * Signed in and entitled to the tracker. The gate for the whole `(dash)` group.
 *
 * The redirect is deliberately the same `/account?denied=1` the admin gate has
 * always used: that page already knows how to render a price and a checkout
 * button, so someone who signed up and never paid lands on the one screen that
 * can fix it rather than on a wall.
 */
export async function requireViewer(next = "/dashboard"): Promise<Access> {
  const access = await load();

  if (!access) redirect(`/login?next=${encodeURIComponent(next)}`);

  if (!isEntitled(access)) {
    // "we could not read your entitlement" is not "you have not paid", and the
    // pay page can only say the second one. Sending a failed read there told a
    // creator who does hold a grant that their account was never on a plan, and
    // then trapped them: /account offers no way back to the dashboard, so /new
    // was the only door left. Throw instead — the error boundary says try
    // again, which is true, and the next render succeeds.
    if (access.readFailed) {
      throw new Error("ACCESS_UNREADABLE");
    }

    // last stop before the door shuts: an invite written to this email seats
    // them here and now. this is the case where the programme adds somebody
    // who is ALREADY signed in — the callback ran before the invite existed,
    // so without this they would have to sign out and back in to collect a
    // seat that is already theirs. `load()` is cached for this request and
    // would keep saying no, so the answer is a redirect: the next request
    // reads the seat that now exists.
    if (await claimPendingInvite(access.supabase)) {
      redirect(next);
    }

    redirect("/account?denied=1");
  }

  return access;
}

/**
 * The four doors, in one place so nothing checks three of them by accident.
 *
 * `lib/lowticket/access.ts` used to inline its own copy and left the granted
 * creator out, which bounced somebody who was already inside `(dash)` back to
 * the kit's offer page.
 */
export function isEntitled(access: Access): boolean {
  // this deploy is one workspace: a founder of the platform, or a seat on
  // the creator empire org. a subscription or a seat somewhere else on the
  // shared database buys nothing here.
  return (
    access.isFounder ||
    access.memberships.some((m) => m.org_id === CE_ORG_ID)
  );
}

/**
 * Signed in, entitled or not. The gate for the ONE page inside (dash) that
 * exists to make you entitled: /new, where an agency owner names a workspace.
 *
 * An agency owner never pays a creator plan and holds no seat until they own
 * something, so `requireViewer()` turned them away from the only door that
 * could let them in and they stopped on the pricing page. The workspace they
 * create seats them (the `orgs` insert trigger writes the owner row) and the
 * next page load passes `requireViewer()` on its own. Nothing else in the group
 * may use this: it opens no data, only the form.
 */
export async function requireSignedIn(next = "/dashboard"): Promise<Access> {
  const access = await load();
  if (!access) redirect(`/login?next=${encodeURIComponent(next)}`);
  return access;
}

/** Same question, no redirect. For deciding whether to render a link. */
export async function loadAccess(): Promise<Access | null> {
  return load();
}

/**
 * Their role on one org, or null if they hold no seat on it.
 *
 * Takes the memberships already loaded rather than querying, so a page that has
 * an `Access` never pays for this. An org id that is not theirs returns null,
 * which is the same answer as "not a member" on purpose: a caller should not be
 * able to tell the difference between an org that rejected them and one that
 * does not exist.
 */
export function roleInOrg(
  access: Access,
  orgId: string | null | undefined
): OrgRole | null {
  if (!orgId) return null;
  return access.memberships.find((m) => m.org_id === orgId)?.role ?? null;
}
