import { cache } from "react";
import { notFound } from "next/navigation";
import { loadAccess } from "@/lib/access";
import {
  isGranted,
  TOOL_KEY_PREFIX,
  toolSlugFromKey,
} from "@/lib/org-overrides";
import { customTool } from "@/lib/tools";
import { createClient } from "@/lib/supabase/server";

/**
 * The member-side reads of `org_overrides`. See lib/org-overrides.ts for what
 * the keys mean. Nothing in here widens a read: the client is the ordinary
 * one and rls hands back the caller's own workspaces' rows.
 */

/** A custom tool the signed-in person can open, and the workspaces that give it to them. */
export type ToolGrant = {
  slug: string;
  /** every workspace of theirs that has it. usually one; the card names them. */
  orgs: { id: string; name: string }[];
};

/**
 * The custom tools the signed-in person holds, through any seat on any
 * workspace a founder granted them to. Read through the ordinary client, so
 * rls does the scoping and a founder's own shelf shows their own workspaces'
 * grants, not everyone's. Only slugs that are actually registered in
 * `customTools` come back: a grant for a tool that was later removed from the
 * registry is a stale row, not a card pointing at a 404.
 *
 * Empty for the overwhelmingly common case (no seat anywhere) without a round
 * trip, because `loadAccess()` already knows.
 */
export const loadMyToolGrants = cache(async (): Promise<ToolGrant[]> => {
  const access = await loadAccess();
  if (!access || access.memberships.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_overrides")
    .select("org_id, key, value, org:orgs(id, name)")
    .in(
      "org_id",
      access.memberships.map((m) => m.org_id)
    )
    .like("key", `${TOOL_KEY_PREFIX}%`);

  // a deploy running ahead of the migration has no table: no custom tools,
  // rather than no tools page.
  if (error || !data) return [];

  const by = new Map<string, ToolGrant>();
  for (const raw of data) {
    const row = raw as unknown as {
      org_id: string;
      key: string;
      value: unknown;
      org: { id: string; name: string } | null;
    };
    if (!isGranted(row.value)) continue;
    const slug = toolSlugFromKey(row.key);
    if (!slug || !customTool(slug)) continue;
    const grant = by.get(slug) ?? { slug, orgs: [] };
    grant.orgs.push({ id: row.org_id, name: row.org?.name ?? "a workspace" });
    by.set(slug, grant);
  }

  return [...by.values()].sort((a, b) => a.slug.localeCompare(b.slug));
});

/**
 * The gate at the top of a custom tool's page. Seated on a granted workspace,
 * or a founder (who built it and has to be able to open it without inviting
 * themselves onto every roster). Everyone else gets a 404, not a redirect: a
 * tool you were not given does not exist, and a bounce to /tools would say
 * "you nearly had it".
 *
 * A slug that is not in `customTools` at all is a 404 too, whatever the rows
 * say: the registry is what makes a page a tool.
 */
export async function requireCustomTool(slug: string): Promise<void> {
  if (!customTool(slug)) notFound();
  const access = await loadAccess();
  if (!access) notFound();
  if (access.isFounder) return;
  const grants = await loadMyToolGrants();
  if (!grants.some((g) => g.slug === slug)) notFound();
}
