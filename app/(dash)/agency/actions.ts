"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { notificationHtml, sendEmail } from "@/lib/email/send";
import {
  AGENCY_BRAND_HREF,
  AGENCY_HREF,
  AGENCY_PEOPLE_HREF,
  canManage,
  customDomainProblem,
  INVITE_ROLES,
  inviteLink,
  isHex,
  ORG_FEATURES,
  ROLE_LABEL,
  slugProblem,
  TENANT_ROOT,
  toSlug,
  type OrgFeatures,
  type OrgRole,
} from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { attachDomain, detachDomain, verifyDomain } from "@/lib/vercel-domains";
import { PERSONAL, WS_COOKIE } from "@/lib/workspace";

/**
 * Every write the white-label layer makes. Plain functions taking form data,
 * scoped by rls, exactly like the rest of the product's actions — which is also
 * what lets the Flow agent operate them later without a second api.
 *
 * Nothing here checks a role in app code. `orgs_update_owner` and
 * `org_invites_manage` are the check, so a forged form post gets the same answer
 * a forged fetch does.
 */

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

/**
 * Back to the page that submitted, carrying what went wrong.
 *
 * The target is passed in rather than always being /agency: the section is
 * three pages now, and answering a failed invite by dropping somebody onto the
 * roster with a red line at the top of it makes them hunt for the form again.
 */
function back(note: string, to: string = AGENCY_HREF): never {
  redirect(`${to}?note=${encodeURIComponent(note)}`);
}

/**
 * The branding screen's only write, one field at a time.
 *
 * It answers rather than redirecting, because the form autosaves. A redirect is
 * the right shape for a submit button — it proves the round trip happened by
 * moving you — and the wrong shape for a colour picker, where navigating on
 * every drag of the hue slider would throw away the field's focus, the scroll
 * position and the rest of the form's unsaved state several times a second.
 *
 * Nothing here checks a role, the same as everything else in this file:
 * `orgs_update_owner` is the check, so an admin calling this from a console
 * gets the same answer an admin posting the form does.
 */
export async function saveBrandingPatch(input: {
  orgId: string;
  patch: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createClient();

  if (!input?.orgId) return { ok: false, message: "No workspace to save." };

  const patch = brandingPatch(input.patch ?? {});
  if ("message" in patch) return { ok: false, message: patch.message };
  // a form that debounces can flush a round of edits that changed nothing.
  if (Object.keys(patch.values).length === 0) return { ok: true };

  const { error } = await supabase
    .from("orgs")
    .update({ ...patch.values, updated_at: new Date().toISOString() })
    .eq("id", input.orgId);

  if (error) return { ok: false, message: error.message };

  // the skin is painted by the dash layout, so every screen in the group is
  // stale after this, not just the branding page.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Everything this action is willing to write, and what it insists each one is.
 *
 * The whitelist is the important half. An action that takes an object and hands
 * it to `update()` writes whatever it is given, and `orgs` has an `owner_id` on
 * it — one forged call from an admin's session and the workspace belongs to
 * somebody else, with rls perfectly happy because the row was theirs to update.
 * Unknown keys are dropped in silence rather than refused, because the only
 * caller that sends one is not a caller we owe an explanation to.
 */
const BRANDING_KEYS = [
  "name",
  "logo_url",
  "accent_hex",
  "rail_hex",
  "support_email",
  // custom_domain is deliberately absent: it has side effects on the vercel
  // project and its own action (saveCustomDomain) with a button.
  "features",
] as const;

/**
 * Install (or remove) the agency's own Flow key.
 *
 * Deliberately NOT part of `BRANDING_KEYS`. That list feeds an update built from
 * a patch object, and a write-only column has to be the only thing its statement
 * touches: `.update({...patch, flow_api_key})` returning a row would need SELECT
 * on every column named, and the whole point of this one is that nothing holding
 * a session can select it.
 *
 * There is no read anywhere in the app to pair with this. `flow_key_set_at` is
 * what the page renders, stamped by a trigger, and the key itself is only ever
 * read by the server with the service client at the moment a turn is billed.
 *
 * An empty field is how you take a key back off, which the trigger normalises to
 * null so "installed" stays a null check rather than a length check.
 */
export async function saveFlowKey(form: FormData): Promise<never> {
  const supabase = await createClient();

  const orgId = text(form, "org_id");
  if (!orgId) back("No workspace to save.", AGENCY_BRAND_HREF);

  const key = text(form, "flow_api_key");

  // a paste that picked up the surrounding line is the common typo, and the
  // error it causes is a 401 from anthropic three screens away from here.
  if (key && /\s/.test(key)) {
    back("That key has a space in it. Paste just the key.", AGENCY_BRAND_HREF);
  }
  if (key && key.length > 300)
    back("That does not look like a key.", AGENCY_BRAND_HREF);

  // rls (`orgs_update_owner`) is the permission check, not this call.
  const { error } = await supabase
    .from("orgs")
    .update({ flow_api_key: key })
    .eq("id", orgId);

  if (error) back(error.message, AGENCY_BRAND_HREF);

  revalidatePath(AGENCY_BRAND_HREF);
  back(key ? "Key installed." : "Key removed.", AGENCY_BRAND_HREF);
}

/**
 * The agency's own address, and the vercel side of making it answer.
 *
 * Its own action rather than a key on the autosaving form: attaching a domain
 * to the project is a network call with side effects, and a field that flushed
 * on every 600ms pause attached "app.acm" and "app.acme.c" on the way to the
 * real value. This is a Save button. The column is written first (rls,
 * `orgs_update_owner`, is the permission), then the old domain comes off the
 * project and the new one goes on. Vercel refusing does not undo the write:
 * the column is a lookup key that is right either way, and the page shows the
 * domain as not attached so it can be saved again once the conflict is fixed.
 */
export async function saveCustomDomain(form: FormData): Promise<never> {
  const supabase = await createClient();

  const orgId = text(form, "org_id");
  if (!orgId) back("No workspace to save.", AGENCY_BRAND_HREF);

  const parsed = customDomainProblem(text(form, "custom_domain"));
  if ("message" in parsed) back(parsed.message, AGENCY_BRAND_HREF);
  const next = parsed.value;

  const { data: current } = await supabase
    .from("orgs")
    .select("custom_domain")
    .eq("id", orgId)
    .maybeSingle();
  const prev = (current?.custom_domain as string | null) ?? null;

  const { data: written, error } = await supabase
    .from("orgs")
    .update({ custom_domain: next, updated_at: new Date().toISOString() })
    .eq("id", orgId)
    .select("id");

  if (error) {
    back(
      error.code === "23505"
        ? `${next} is already another workspace's domain.`
        : error.message,
      AGENCY_BRAND_HREF
    );
  }
  if (!written || written.length === 0)
    back("Only the owner can change the domain.", AGENCY_BRAND_HREF);

  if (prev && prev !== next) await detachDomain(prev);

  let note = next ? `${next} saved.` : "Domain cleared. you are back on your creator empire address.";
  if (next && next !== prev) {
    const attached = await attachDomain(next);
    if (!attached.ok) note = `${next} saved, but ${attached.message}`;
  }

  revalidatePath("/", "layout");
  back(note, AGENCY_BRAND_HREF);
}

/** Ask vercel to look at the dns again. Safe to press as often as they like. */
export async function checkCustomDomain(form: FormData): Promise<never> {
  const domain = text(form, "custom_domain").toLowerCase();
  if (domain) await verifyDomain(domain);
  revalidatePath(AGENCY_BRAND_HREF);
  back("Checked. If a record is still listed below, dns has not caught up yet.", AGENCY_BRAND_HREF);
}

/**
 * The branding page's own form post.
 *
 * `saveBrandingPatch` is the other caller and takes an object, because the
 * feature switches and the colour picker are client controls that flush a patch
 * as you change them. The white-label form is a plain `<form action=>` and hands
 * over FormData, so it needs this door rather than that one — and it had been
 * importing a `saveBranding` that did not exist, which made the Save button a
 * no-op: an undefined action posts the form to itself and writes nothing.
 *
 * Only the fields the form actually renders are read. `features` is deliberately
 * not among them: it lives on its own screen, and building a patch from a form
 * that never showed a switch would clear every one of them.
 */
export async function saveBranding(form: FormData): Promise<never> {
  const orgId = text(form, "org_id");
  if (!orgId) back("No workspace to save.", AGENCY_BRAND_HREF);

  const result = await saveBrandingPatch({
    orgId,
    patch: {
      name: text(form, "name"),
      logo_url: text(form, "logo_url"),
      accent_hex: text(form, "accent_hex"),
      support_email: text(form, "support_email"),
    },
  });

  back(result.ok ? "Branding saved." : result.message, AGENCY_BRAND_HREF);
}

function brandingPatch(
  raw: Record<string, unknown>
): { values: Record<string, unknown> } | { message: string } {
  const values: Record<string, unknown> = {};

  for (const key of BRANDING_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];

    if (key === "features") {
      const features = readFeatures(value);
      if (!features) return { message: "That is not a set of switches." };
      values.features = features;
      continue;
    }

    // everything else on the list is text or null. an empty string is not the
    // same as "leave it alone" — it is how every one of these is cleared.
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (typeof value !== "string" && value !== null && value !== undefined)
      return { message: "That value is not something we can store." };

    if (key === "name") {
      if (!trimmed) return { message: "The workspace needs a name." };
      values.name = trimmed;
      continue;
    }

    if (key === "accent_hex" || key === "rail_hex") {
      // an empty colour is "use the product's palette", which is a real choice
      // and has to be storable. Anything else has to be a hex or it never
      // reaches the style attribute it would be interpolated into.
      if (trimmed && !isHex(trimmed))
        return { message: "A colour has to be a hex, like #ec5a29." };
      values[key] = trimmed || null;

      // the dark and soft steps are derived from the accent unless someone sets
      // them, so a new accent has to clear the old pair or the hover colour
      // stays the last brand's.
      if (key === "accent_hex") {
        values.accent_dark_hex = null;
        values.accent_soft_hex = null;
      }
      continue;
    }

    values[key] = trimmed || null;
  }

  return { values };
}

/**
 * `{ "<feature key>": false }` and nothing else.
 *
 * Keys are checked against ORG_FEATURES rather than stored as sent, because
 * this column is read by `featureOn()` on every render of the rail and a
 * typo'd key would sit in there forever switching nothing off. `true` is kept
 * where it is sent even though absent already means on: the form drops those
 * itself, and rewriting somebody's stored object is not this function's job.
 */
function readFeatures(value: unknown): OrgFeatures | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;

  const known = new Set(ORG_FEATURES.map((f) => f.key));
  const out: OrgFeatures = {};

  for (const [key, on] of Object.entries(value as Record<string, unknown>)) {
    if (!known.has(key)) return null;
    if (typeof on !== "boolean") return null;
    out[key] = on;
  }

  return out;
}

export async function inviteMember(form: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const orgId = text(form, "org_id");
  const email = text(form, "email").toLowerCase();
  const role = text(form, "role") as OrgRole;

  if (!orgId) back("No workspace to invite them to.", AGENCY_PEOPLE_HREF);
  if (!email.includes("@"))
    back("That does not look like an email address.", AGENCY_PEOPLE_HREF);
  // owner is not invitable: `orgs.owner_id` is the permission and an invite
  // never moves it, so the seat would be an admin the rail lies to.
  if (!(INVITE_ROLES as readonly string[]).includes(role))
    back("Pick a role.", AGENCY_PEOPLE_HREF);

  // an expired invite for the same address is still "pending" as far as the
  // unique index is concerned (accepted_at is null), so re-inviting somebody
  // whose link ran out was refused with "already has an invite waiting" for a
  // link that no longer worked. dead ones for this email go first; a live one
  // still comes back as the 23505 below, which is the right answer for that.
  await supabase
    .from("org_invites")
    .delete()
    .eq("org_id", orgId)
    .ilike("email", email)
    .is("accepted_at", null)
    .lt("expires_at", new Date().toISOString());

  // `select` after the insert so the link can go in the mail. rls scopes it
  // to orgs this person manages, and the token is the row's default.
  const { data: invite, error } = await supabase
    .from("org_invites")
    .insert({ org_id: orgId, email, role, invited_by: user.id })
    .select("token, org:orgs(name, slug, custom_domain)")
    .single();

  if (error) {
    back(
      error.code === "23505"
        ? `${email} already has an invite waiting.`
        : error.message,
      AGENCY_PEOPLE_HREF
    );
  }

  // the link, mailed. best effort and never the reason an invite fails: with
  // no RESEND_API_KEY the send is a no-op and the copy button on the roster
  // page is still the way in. minted on the same host the page mints it on.
  // the embed is a to-one join; supabase types it as an array either way.
  const org = (invite?.org ?? null) as unknown as {
    name: string;
    slug: string;
    custom_domain: string | null;
  } | null;
  let mailed = false;
  if (invite?.token && org) {
    const host = (await headers()).get("host");
    const url = inviteLink(org, invite.token, host);
    mailed = await sendEmail({
      to: email,
      subject: `${org.name} invited you to their workspace`,
      html: notificationHtml({
        heading: `you're invited to ${org.name}`,
        lines: [
          `${org.name} runs their creators on creator empire and made you a ${ROLE_LABEL[role].toLowerCase()} seat.`,
          "sign in with this exact email address, or create an account on it, and press join. your deals stay yours either way.",
          "the link works for 14 days.",
        ],
        cta: { label: "open the invite", url },
      }),
    });
  }

  revalidatePath(AGENCY_PEOPLE_HREF);
  back(
    mailed
      ? `Invite sent to ${email}. The link is below too if they miss it.`
      : `Invite ready for ${email}. Copy the link below and send it to them.`,
    AGENCY_PEOPLE_HREF
  );
}

export async function cancelInvite(form: FormData) {
  const supabase = await createClient();
  const id = text(form, "invite_id");

  const { error } = await supabase.from("org_invites").delete().eq("id", id);
  if (error) back(error.message, AGENCY_PEOPLE_HREF);

  revalidatePath(AGENCY_PEOPLE_HREF);
  back("Invite cancelled.", AGENCY_PEOPLE_HREF);
}

/**
 * Take someone off the roster.
 *
 * Their deals, videos and payouts are untouched — the org never owned them, it
 * only had a read. That is the whole point of not putting an `org_id` on those
 * tables, and it means removing somebody in error costs one re-invite rather
 * than a restore.
 */
export async function removeMember(form: FormData) {
  const supabase = await createClient();

  const orgId = text(form, "org_id");
  const userId = text(form, "user_id");

  const { data, error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .select("user_id");

  if (error) back(error.message, AGENCY_PEOPLE_HREF);
  // rls answers an admin (or a forged form) with zero rows, not an error.
  // saying "removed" over a seat that is still there is the one lie this
  // page could tell, so the count is checked.
  if (!data || data.length === 0)
    back(
      "Only the owner can remove somebody from the roster.",
      AGENCY_PEOPLE_HREF
    );

  revalidatePath(AGENCY_PEOPLE_HREF);
  back("Removed from the roster.", AGENCY_PEOPLE_HREF);
}

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_org_invite", {
    p_token: token,
  });

  // errors go back to the join page, which knows how to print them. sending
  // them to /agency bounced a creator with no agency into the create screen.
  if (error) back(error.message, `/join/${token}`);

  revalidatePath("/", "layout");

  // where you land depends on what the seat is. an admin now runs a roster,
  // so the roster. a creator got a reader on their numbers, not a new screen,
  // so home is home rather than a section they cannot open.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: seat } = user
    ? await supabase
        .from("org_members")
        .select("role")
        .eq("org_id", orgId as string)
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  // either way, switch into the workspace they just joined. landing on your
  // own unbranded dashboard after accepting an agency's invite reads as the
  // invite having done nothing; the cookie is what makes the agency's paint
  // and modules show up even away from its subdomain.
  (await cookies()).set(WS_COOKIE, orgId as string, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  if (seat && canManage(seat.role as OrgRole)) redirect(AGENCY_HREF);
  redirect("/dashboard");
}

/**
 * Delete the whole workspace. Owner only, and rls (`orgs_delete_owner`) is the
 * check, not this function: an admin's session deletes zero rows and is told
 * so. The fks cascade the seats and the invites away with the org; nobody's
 * deals move an inch, because the org never owned them, it only had a read.
 */
export async function deleteAgency(form: FormData) {
  const supabase = await createClient();

  const orgId = text(form, "org_id");
  const orgName = text(form, "org_name");
  const confirm = text(form, "confirm_name");

  if (!orgId) back("Nothing to delete.", AGENCY_BRAND_HREF);

  // the two-step: type the name. UX only, and deliberately case-insensitive;
  // the permission lives in the delete policy below, not in this string.
  if (!confirm || confirm.toLowerCase() !== orgName.toLowerCase()) {
    back("Type the workspace name exactly to confirm.", AGENCY_BRAND_HREF);
  }

  const { data, error } = await supabase
    .from("orgs")
    .delete()
    .eq("id", orgId)
    .select("id");

  if (error) back(error.message, AGENCY_BRAND_HREF);
  if (!data || data.length === 0) {
    back("Only the owner can delete a workspace.", AGENCY_BRAND_HREF);
  }

  // the cookie still names a workspace that no longer exists; put them back on
  // their own account rather than letting the fallback decide.
  (await cookies()).set(WS_COOKIE, PERSONAL, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Move a seat between admin and creator. Owner only, by the update policy on
 * `org_members`; the owner row itself is never a target. rls answers anyone
 * else with zero rows, so the count is checked rather than trusted.
 */
export async function setMemberRole(form: FormData) {
  const supabase = await createClient();

  const orgId = text(form, "org_id");
  const userId = text(form, "user_id");
  const role = text(form, "role") as OrgRole;

  if (!(INVITE_ROLES as readonly string[]).includes(role))
    back("Pick a role.", AGENCY_PEOPLE_HREF);

  const { data, error } = await supabase
    .from("org_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .neq("role", "owner")
    .select("user_id");

  if (error) back(error.message, AGENCY_PEOPLE_HREF);
  if (!data || data.length === 0)
    back("Only the owner can change somebody's role.", AGENCY_PEOPLE_HREF);

  revalidatePath(AGENCY_PEOPLE_HREF);
  revalidatePath(AGENCY_HREF);
  back(`Now ${ROLE_LABEL[role].toLowerCase()}.`, AGENCY_PEOPLE_HREF);
}
