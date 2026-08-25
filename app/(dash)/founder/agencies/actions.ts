"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  isKnownKey,
  PORTFOLIO_BADGE_KEY,
  PORTFOLIO_FOOTER_KEY,
  toolKey,
} from "@/lib/org-overrides";
import { customTool } from "@/lib/tools";
import { requireFounderView } from "@/lib/supabase/founder";

/**
 * The founder shelf for one workspace: everything a founder can hand an
 * agency that the product does not give everybody. Every action re-checks
 * the founder gate for itself (a server action is its own entry point) and
 * writes through the FOUNDER VIEW client (`x-admin-view: 1`), not the ordinary
 * one. The `org_overrides_admin_*` write policies say `private.is_admin()` and
 * refuse anyone else, but a delete or an update with a WHERE clause also has to
 * pass a SELECT policy on the rows it touches, and the ordinary client's only
 * select policy is "my own workspaces": a founder revoking a grant on a
 * workspace they do not sit on deleted zero rows and reported success. The
 * founder-view read policy is what makes every workspace's rows visible here.
 *
 * Every write lands as a redirect back to the agency page with a note, the
 * same shape as createOrgFor: these are plain forms, no client state.
 */

const KEY_RE = /^[a-z][a-z0-9_.-]{0,79}$/;

function agencyPath(orgId: string) {
  return `/founder/agencies/${orgId}`;
}

function done(orgId: string, note: string): never {
  revalidatePath(agencyPath(orgId));
  revalidatePath("/founder/agencies");
  // the tools shelf and every custom tool route read the grants: a change here
  // has to reach a creator's next page load, not their next deploy.
  revalidatePath("/tools");
  redirect(`${agencyPath(orgId)}?note=${encodeURIComponent(note)}`);
}

async function write(
  orgId: string,
  key: string,
  value: unknown
): Promise<string | null> {
  const { supabase } = await requireFounderView("/founder/agencies");
  const { data, error } = await supabase
    .from("org_overrides")
    .upsert({ org_id: orgId, key, value }, { onConflict: "org_id,key" })
    .select("key");
  if (error) return error.message;
  // zero rows back is rls saying no, quietly. say it out loud.
  return (data ?? []).length === 0 ? "the database refused the write." : null;
}

/** Removes the row. A key that was not set is not an error: the shelf ends up the same. */
async function remove(orgId: string, key: string): Promise<string | null> {
  const { supabase } = await requireFounderView("/founder/agencies");
  const { error } = await supabase
    .from("org_overrides")
    .delete()
    .eq("org_id", orgId)
    .eq("key", key);
  return error ? error.message : null;
}

const text = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();

/** Switch a registered custom tool on for one workspace. */
export async function grantTool(formData: FormData) {
  const orgId = text(formData, "org_id");
  const slug = text(formData, "slug");
  if (!orgId) redirect("/founder/agencies");
  // the registry is what makes a page a tool. a grant for a slug that is not in
  // `customTools` would be a card pointing at a 404, so it is refused here too.
  if (!customTool(slug)) done(orgId, `${slug || "that"} is not a registered custom tool.`);
  const err = await write(orgId, toolKey(slug), true);
  done(orgId, err ? `could not switch ${slug} on: ${err}` : `${slug} is on for this workspace.`);
}

/** Switch it off again. The row goes, so the shelf and the route both close. */
export async function revokeTool(formData: FormData) {
  const orgId = text(formData, "org_id");
  const slug = text(formData, "slug");
  if (!orgId) redirect("/founder/agencies");
  const err = await remove(orgId, toolKey(slug));
  done(orgId, err ? `could not switch ${slug} off: ${err}` : `${slug} is off for this workspace.`);
}

/**
 * The portfolio setup: a footer (label + url) and a badge line. Blank fields
 * clear their key, so the whole thing can be undone from the same form.
 * The `portfolio_agency_for` rpc only names a workspace that has at least one
 * portfolio.* row, so clearing both puts every creator's page back exactly.
 */
export async function savePortfolioSetup(formData: FormData) {
  const orgId = text(formData, "org_id");
  if (!orgId) redirect("/founder/agencies");

  const label = text(formData, "footer_label").slice(0, 60);
  const rawUrl = text(formData, "footer_url");
  const badge = text(formData, "badge").slice(0, 60);

  let url = rawUrl;
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (url && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url)) {
    done(orgId, "the footer link has to be a web address, like https://acme.com.");
  }

  const errs: string[] = [];
  const footerErr = label
    ? await write(orgId, PORTFOLIO_FOOTER_KEY, { label, url })
    : await remove(orgId, PORTFOLIO_FOOTER_KEY);
  if (footerErr) errs.push(footerErr);
  const badgeErr = badge
    ? await write(orgId, PORTFOLIO_BADGE_KEY, badge)
    : await remove(orgId, PORTFOLIO_BADGE_KEY);
  if (badgeErr) errs.push(badgeErr);

  // portfolios are public pages with a minute of cache: they pick this up on
  // their own. nothing to revalidate by slug from here.
  done(
    orgId,
    errs.length
      ? `portfolio setup did not save: ${errs.join("; ")}`
      : label || badge
        ? "portfolio setup saved. every creator on this workspace gets it on their public page."
        : "portfolio setup cleared."
  );
}

/**
 * Anything else, by hand. A key and a json value, for whatever a founder
 * builds next for this workspace: the reader is `overrideValue()` in
 * lib/org-overrides.ts. The known keys have their own controls above and are
 * refused here, so there is exactly one form per meaning.
 */
export async function setOverride(formData: FormData) {
  const orgId = text(formData, "org_id");
  const key = text(formData, "key");
  const raw = text(formData, "value");
  if (!orgId) redirect("/founder/agencies");

  if (!KEY_RE.test(key)) {
    done(orgId, "a key is lowercase letters, digits, dots, dashes or underscores, up to 80, starting with a letter.");
  }
  if (isKnownKey(key)) {
    done(orgId, `${key} has its own control on this page. set it there.`);
  }

  let value: unknown = true;
  if (raw) {
    try {
      value = JSON.parse(raw);
    } catch {
      // a bare word is the common case and it is a string, not a syntax error.
      value = raw;
    }
  }

  const err = await write(orgId, key, value);
  done(orgId, err ? `could not set ${key}: ${err}` : `${key} set.`);
}

export async function deleteOverride(formData: FormData) {
  const orgId = text(formData, "org_id");
  const key = text(formData, "key");
  if (!orgId) redirect("/founder/agencies");
  const err = await remove(orgId, key);
  done(orgId, err ? `could not remove ${key}: ${err}` : `${key} removed.`);
}
