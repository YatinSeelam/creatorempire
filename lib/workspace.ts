import { cache } from "react";
import { redirect } from "next/navigation";
import { loadAccess } from "@/lib/access";
import {
  canManage,
  CE_ORG_ID,
  ORG_COLS,
  ORGS_ENABLED,
  type Org,
  type OrgBrand,
  type OrgRole,
} from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/**
 * Which account you are operating as.
 *
 * One login, two kinds of thing to be. Your creator account is your own deals
 * and your own money. An agency is somebody else's roster that you run. They
 * are not two halves of one screen, and the version that treated them as one
 * was the bug: a creator who happened to own an agency got that agency's logo
 * and colour painted over their own dashboard, plus a "Roster" row wedged into
 * a nav that was otherwise all about their own work.
 *
 * So: a switcher, exactly like the account picker in cloudflare or vercel. The
 * rail's whole nav swaps with it, the skin swaps with it, and /agency belongs
 * to the agency half only.
 *
 * The switcher lists agencies you OWN OR MANAGE as destinations, and the
 * rosters you sit on as a plain creator underneath them. Switching into a seat
 * does not open a roster (there is nothing a creator seat can manage); it
 * paints the dashboard with that agency's branding and surfaces its modules,
 * which is what being on a white-label roster means.
 */

/** Names the agency being administered, or `personal`. Not a permission. */
export const WS_COOKIE = "ugcf_ws";
export const PERSONAL = "personal";

export type Agency = {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
  /** the full row, so a page that has the agency never re-reads it. */
  org: Org;
};

/** A roster you sit on without managing it. Switching in changes the paint, not the nav. */
export type Seat = { id: string; name: string; role: OrgRole; logo: string | null };

export type Workspace = {
  /** the agency you switched into, or null for your own creator account. */
  agency: Agency | null;
  /** every agency you own or manage. what the switcher offers under "personal". */
  agencies: Agency[];
  /** rosters you hold a plain creator seat on. */
  seats: Seat[];
  /** the seat you switched into, if any. it carries branding, never a roster. */
  seatBrand: Org | null;
  /** what the app paints. null is the product's own flame palette. */
  brand: OrgBrand | null;
  /**
   * whose books every deal read is scoped to. null is the creator's own
   * account; an org id is the agency switched into (its roster) or the seat
   * switched into (the creator's deals for that agency, and nothing else).
   * `deals.org_id` is the column, `dealScope()` below is how a read asks.
   */
  scopeOrgId: string | null;
};

const EMPTY: Workspace = {
  agency: null,
  agencies: [],
  seats: [],
  seatBrand: null,
  brand: null,
  scopeOrgId: null,
};

export const loadWorkspace = cache(async (): Promise<Workspace> => {
  if (!ORGS_ENABLED) return EMPTY;

  const access = await loadAccess();
  // no seat anywhere is the overwhelmingly common case, and it costs nothing:
  // `loadAccess` already read `org_members` for the gate, so this is a check on
  // an array rather than a round trip.
  if (!access || access.memberships.length === 0) return EMPTY;

  const supabase = await createClient();
  // never `*` here: `flow_api_key` is write-only and a wildcard select is a
  // permission error once the grants say so (and was the key riding into the
  // branding page's client props before they did).
  const { data } = await supabase
    .from("orgs")
    .select(ORG_COLS)
    .in(
      "id",
      access.memberships.map((m) => m.org_id)
    );

  const orgs = (data ?? []) as Org[];
  const roleBy = new Map(access.memberships.map((m) => [m.org_id, m.role]));

  const agencies: Agency[] = orgs
    .filter((o) => canManage(roleBy.get(o.id) ?? null))
    .map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      role: roleBy.get(o.id) as OrgRole,
      org: o,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const seats: Seat[] = orgs
    .filter((o) => !canManage(roleBy.get(o.id) ?? null))
    .map((o) => ({
      id: o.id,
      name: o.name,
      role: roleBy.get(o.id) as OrgRole,
      logo: o.logo_url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // this deploy IS one workspace. there is no cookie, no host and no switcher:
  // everyone here is being the creator empire org, and the only question left
  // is which side of it. an owner or admin gets the roster (the agency half),
  // a creator seat gets the dashboard painted in the org's colours and scoped
  // to the org's books. a founder with no seat is handled by the founder gate
  // and reads through /founder; here they simply have no workspace.
  const home = orgs.find((o) => o.id === CE_ORG_ID) ?? null;
  if (!home) return EMPTY;

  const role = roleBy.get(home.id) ?? null;
  const agency = agencies.find((a) => a.id === home.id) ?? null;
  const seatBrand = agency === null && !canManage(role) ? home : null;

  return {
    agency,
    agencies,
    seats,
    seatBrand,
    brand: home,
    scopeOrgId: home.id,
  };
});

/**
 * Whose books a deal read is about.
 *
 * The creator's own account and the seat they hold on an agency are two
 * separate ledgers. This is the one place a read asks which one it is on, so
 * "personal" and "acme" cannot drift into meaning slightly different things in
 * two files. Cheap: `loadWorkspace` is cache()d per request.
 */
export type DealScope = { orgId: string | null };

export const dealScope = cache(async (): Promise<DealScope> => {
  const ws = await loadWorkspace();
  return { orgId: ws.scopeOrgId };
});

/**
 * The scope as a `.filter()` argument list. `col` is the org column on the
 * table being read, or an embedded path (`deal.org_id`) when the table hangs
 * off deals through an `!inner` join. Spread it: `q.filter(...onBooks(scope))`.
 *
 * A tuple rather than a function that takes the query builder, because a
 * generic over PostgrestFilterBuilder sends tsc into "type instantiation is
 * excessively deep" on the untyped client, and the builder's own `filter` is
 * the one method that does both `is null` and `eq` in one call.
 */
export function onBooks(
  scope: DealScope,
  col = "org_id"
): [column: string, operator: "is" | "eq", value: string | null] {
  return scope.orgId === null ? [col, "is", null] : [col, "eq", scope.orgId];
}

/**
 * The agency the /agency routes are about.
 *
 * The cookie's pick, or the only one they manage. That fallback is what makes a
 * typed url work: the switcher always sets the cookie before it sends anybody
 * here, so the only way to arrive without one is by hand, and answering that
 * with a redirect to "create a workspace" when they already have one would be
 * a lie.
 */
export async function agencyOrFirst(): Promise<Agency | null> {
  const { agency, agencies } = await loadWorkspace();
  return agency ?? agencies[0] ?? null;
}

/** The gate on the whole agency section. Manage nothing, make one. */
export async function requireAgency(): Promise<Agency> {
  const agency = await agencyOrFirst();
  if (!agency) redirect("/dashboard");
  return agency;
}
