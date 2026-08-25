import { cache } from "react";
import { headers } from "next/headers";
import { brandLogo } from "@/lib/brand-catalog";
import { createClient } from "@/lib/supabase/server";
import { flatFeeCents, type Deal } from "@/lib/deals";
import {
  DEFAULT_MICROS_PER_CREDIT,
  flowCostMicros,
  type FlowUsageTotals,
} from "@/lib/usage-pricing";
import {
  ORG_COLS,
  ORGS_ENABLED,
  slugFromHost,
  type Org,
  type OrgBrand,
  type OrgDealRow,
  type OrgInvite,
  type OrgMember,
  type OrgModule,
  type OrgRole,
  type RosterRow,
} from "@/lib/org";

/**
 * The org's reads. Rls does the scoping, here as everywhere else in this app.
 *
 * Two of these use a client carrying `x-org-view: 1`, which is what makes the
 * `*_org_read` policies fire. Nothing outside this file may create that client:
 * the product never filters `user_id` in app code, so a page that carried the
 * header would quietly show a manager their whole roster's deals in place of
 * their own.
 */

/**
 * The org whose branding this request should paint, or null for the product's
 * own skin. For the doors OUTSIDE the member gate: login, sign-up, /join.
 * Inside (dash) the skin comes from `loadWorkspace()`, which also knows which
 * account you switched into.
 *
 * The host and nothing else. A creator on acme.ugcflows.com sees acme, and
 * www.ugcflows.com is always the product. The old membership fallback ("the
 * one org you belong to") is gone: it painted an agency owner's own login page
 * in their agency's colours, and it is exactly the bug lib/workspace.ts was
 * written to replace.
 *
 * Read through `org_brand_for_host`, a definer function that returns only the
 * branding columns, because the tenant's row is not otherwise readable by the
 * person this page exists for: an invitee is signed in and not yet a member,
 * so the anon branding policy did not apply and the member policy did not
 * either, and the join page wore our name on their address.
 */
export async function loadBrand(): Promise<OrgBrand | null> {
  // the whole layer is off (ORGS_ENABLED in lib/org.ts). returning early keeps
  // the product's own skin AND saves every page in the group a round trip.
  if (!ORGS_ENABLED) return null;

  const host = (await headers()).get("host");
  const slug = slugFromHost(host);
  const bare = host ? host.split(":")[0].toLowerCase() : null;
  // the product's own hosts have no tenant, and no slug means no lookup at all
  // for the overwhelmingly common case: www with nobody's paint on it.
  if (!slug && (!bare || bare === "localhost" || bare.endsWith(".vercel.app")))
    return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("org_brand_for_host", {
    p_slug: slug,
    p_domain: slug ? null : bare,
  });

  // a deploy running ahead of the migration paints the product's own skin
  // rather than failing the login page.
  if (error) return null;
  const row = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  return (row as OrgBrand | null) ?? null;
}

/** Every org the signed-in person belongs to, with their role in each. */
export async function loadMyOrgs(): Promise<{ org: Org; role: OrgRole }[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("org_members")
    .select(`role, org:orgs(${ORG_COLS})`)
    .order("joined_at", { ascending: true });

  return (data ?? [])
    .map((row) => {
      const r = row as unknown as { role: OrgRole; org: Org | null };
      return r.org ? { org: r.org, role: r.role } : null;
    })
    .filter((r): r is { org: Org; role: OrgRole } => r !== null);
}

/**
 * The org's books: the roster with the money, and the deals the money comes
 * from. One read for both, because the overview draws both off the same rows
 * and two loaders would read the same tables twice.
 *
 * Same arithmetic as `loadDeals`, grouped by creator instead of listed by deal,
 * and read through the widened client. It is deliberately the same code path:
 * a roster whose totals disagreed with the creator's own /deals page by a rule
 * or a rounding is worse than no roster, and the way that happens is a second
 * implementation of the fee.
 *
 * Only the deals on THIS org's books. A creator's personal deals, and their
 * deals for some other agency, are not this agency's business: the org read
 * policies no longer return them at all, and the `org_id` filter here is what
 * keeps two rosters run by the same manager from bleeding into each other.
 */
export const loadOrgBooks = cache(
  async (orgId: string): Promise<{ roster: RosterRow[]; deals: OrgDealRow[] }> => {
    const supabase = await createClient({ orgView: true });

    const [members, deals, rollups, earnings, payouts] = await Promise.all([
      supabase
        .from("org_members")
        .select("user_id, role, joined_at")
        .eq("org_id", orgId)
        .order("joined_at", { ascending: true }),
      supabase
        .from("deals")
        .select("*, brand:brands(name, logo_key, logo_url)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      supabase.from("deal_rollup").select("*"),
      supabase.rpc("deal_earnings"),
      supabase
        .from("payouts")
        .select("deal_id, flat_cents, bonus_cents, adjust_cents, status"),
    ]);

    if (members.error) throw new Error(members.error.message);

    const seats = (members.data ?? []) as {
      user_id: string;
      role: OrgRole;
      joined_at: string;
    }[];

    // profiles is keyed on `id`, and its own org policy is what makes this
    // readable. A member with no profile row still gets a line, named by their id,
    // because a roster that silently drops people is a roster nobody trusts.
    const { data: profileRows } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url")
      .in(
        "id",
        seats.length > 0
          ? seats.map((s) => s.user_id)
          : ["00000000-0000-0000-0000-000000000000"]
      );

    const profileBy = new Map(
      (profileRows ?? []).map((p) => [
        p.id as string,
        {
          name: (p.full_name as string | null) ?? null,
          email: (p.email as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null,
        },
      ])
    );
    const nameOf = (userId: string) => {
      const p = profileBy.get(userId);
      return p?.name?.trim() || p?.email?.split("@")[0] || "Unnamed creator";
    };

    const earned = (earnings.data ?? []) as {
      deal_id: string;
      bonus_cents: number;
      base_videos: number;
    }[];
    const bonusBy = new Map(
      earned.map((r) => [r.deal_id, Number(r.bonus_cents ?? 0)])
    );
    const baseVideosBy = new Map(
      earned.map((r) => [r.deal_id, Number(r.base_videos ?? 0)])
    );

    const rollupBy = new Map(
      (rollups.data ?? []).map((r) => [
        r.deal_id as string,
        {
          videoCount: Number(r.video_count ?? 0),
          totalViews: Number(r.total_views ?? 0),
          lastPostedAt: (r.last_posted_at as string | null) ?? null,
        },
      ])
    );

    const paidBy = new Map<string, number>();
    for (const p of payouts.data ?? []) {
      if (p.status !== "paid") continue;
      const total =
        Number(p.flat_cents) + Number(p.bonus_cents) + Number(p.adjust_cents);
      paidBy.set(
        p.deal_id as string,
        (paidBy.get(p.deal_id as string) ?? 0) + total
      );
    }

    const blank = () => ({
      deals: 0,
      liveDeals: 0,
      videos: 0,
      views: 0,
      earnedCents: 0,
      owedCents: 0,
      lastPostedAt: null as string | null,
    });

    const totals = new Map<string, ReturnType<typeof blank>>(
      seats.map((s) => [s.user_id, blank()])
    );

    const dealRows: OrgDealRow[] = [];

    // `Deal` deliberately has no `user_id`: the product never filters on it and
    // typing it in would invite app code to start. The roster is the one place
    // that genuinely needs it, because rls has handed back several people's rows
    // on purpose and grouping them is the whole job, so it is widened here rather
    // than on the shared type.
    for (const row of (deals.data ?? []) as unknown as (Deal & {
      user_id: string;
      created_at: string;
      brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
    })[]) {
      // a deal filed under this org by someone no longer seated on it (the
      // release trigger should have cleared it, but belt and braces). Only
      // count it against a seat on THIS org.
      const bucket = totals.get(row.user_id);
      if (!bucket) continue;

      const roll = rollupBy.get(row.id) ?? {
        videoCount: 0,
        totalViews: 0,
        lastPostedAt: null,
      };
      const bonus = bonusBy.get(row.id) ?? 0;
      const flat = flatFeeCents(row, baseVideosBy.get(row.id) ?? 0);
      const earnedCents = flat + bonus;
      const owedCents = Math.max(0, earnedCents - (paidBy.get(row.id) ?? 0));

      bucket.deals += 1;
      if (row.status === "active") bucket.liveDeals += 1;
      bucket.videos += roll.videoCount;
      bucket.views += roll.totalViews;
      bucket.earnedCents += earnedCents;
      bucket.owedCents += owedCents;
      if (
        roll.lastPostedAt &&
        (!bucket.lastPostedAt || roll.lastPostedAt > bucket.lastPostedAt)
      ) {
        bucket.lastPostedAt = roll.lastPostedAt;
      }

      dealRows.push({
        id: row.id,
        user_id: row.user_id,
        creatorName: nameOf(row.user_id),
        brandName: row.brand?.name ?? "Unknown brand",
        brandLogo: row.brand ? brandLogo(row.brand) : "",
        name: row.name,
        status: row.status,
        videos: roll.videoCount,
        views: roll.totalViews,
        earnedCents,
        owedCents,
        lastPostedAt: roll.lastPostedAt,
        created_at: row.created_at,
      });
    }

    const roster = seats.map((seat) => {
      const p = profileBy.get(seat.user_id);
      return {
        user_id: seat.user_id,
        role: seat.role,
        joined_at: seat.joined_at,
        name: nameOf(seat.user_id),
        email: p?.email ?? null,
        avatar_url: p?.avatar_url ?? null,
        ...(totals.get(seat.user_id) ?? blank()),
      };
    });

    return { roster, deals: dealRows };
  }
);

/** The roster, with the money. See `loadOrgBooks`. */
export async function loadRoster(orgId: string): Promise<RosterRow[]> {
  return (await loadOrgBooks(orgId)).roster;
}

/** One member's last-30-day usage: scraper credits and ai flow activity. */
export type MemberUsage = {
  scrapeCredits: number;
  flowTurns: number;
  /** input + output tokens across those turns. */
  flowTokens: number;
  /** what this member cost over the window, scrapes plus ai, in micro dollars. */
  micros: number;
};

export type RosterUsage = {
  byUser: Map<string, MemberUsage>;
  totalCredits: number;
  totalFlowTurns: number;
  /** combined cost in micro-dollars: credits at the default rate + flow tokens priced per model. */
  totalMicros: number;
};

/**
 * What the roster is using, per member, over the last 30 days.
 *
 * Same widened client as `loadRoster`: the `*_org_read` policies on the two
 * usage tables are what hand back other people's rows. Two batched selects for
 * the whole roster, grouped in js, never one per member. A deploy running ahead
 * of those policies gets errors back, and errors here mean zeros, not a 500:
 * usage is a garnish on the roster, not a reason it fails to load.
 */
export async function loadRosterUsage(userIds: string[]): Promise<RosterUsage> {
  const empty: RosterUsage = {
    byUser: new Map(),
    totalCredits: 0,
    totalFlowTurns: 0,
    totalMicros: 0,
  };
  if (userIds.length === 0) return empty;

  const supabase = await createClient({ orgView: true });
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // `range` lifts the default 1000-row cap; past 10k rows a month the tail is
  // dropped rather than paged, which for a garnish is the right trade.
  const [scrapes, flows] = await Promise.all([
    supabase
      .from("api_usage_events")
      .select("user_id, credits_charged")
      .in("user_id", userIds)
      .gte("created_at", since)
      .range(0, 9999),
    supabase
      .from("ai_usage_events")
      .select(
        "user_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens"
      )
      .in("user_id", userIds)
      .gte("created_at", since)
      .range(0, 9999),
  ]);

  const byUser = new Map<string, MemberUsage>();
  const bucketFor = (id: string): MemberUsage => {
    let u = byUser.get(id);
    if (!u) {
      u = { scrapeCredits: 0, flowTurns: 0, flowTokens: 0, micros: 0 };
      byUser.set(id, u);
    }
    return u;
  };

  let totalCredits = 0;
  for (const row of scrapes.error ? [] : (scrapes.data ?? [])) {
    const r = row as { user_id: string; credits_charged: number | null };
    const credits = Number(r.credits_charged ?? 0);
    if (!(credits > 0)) continue;
    const b = bucketFor(r.user_id);
    b.scrapeCredits += credits;
    b.micros += Math.round(credits * DEFAULT_MICROS_PER_CREDIT);
    totalCredits += credits;
  }

  // token piles are grouped per (member, model) before pricing, so the
  // per-row rounding inside flowCostMicros happens once per pile, not per turn.
  const piles = new Map<string, FlowUsageTotals & { model: string; user: string }>();
  let totalFlowTurns = 0;
  for (const row of flows.error ? [] : (flows.data ?? [])) {
    const r = row as {
      user_id: string;
      model: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
    };
    const input = Number(r.input_tokens ?? 0);
    const output = Number(r.output_tokens ?? 0);

    const bucket = bucketFor(r.user_id);
    bucket.flowTurns += 1;
    bucket.flowTokens += input + output;
    totalFlowTurns += 1;

    const model = r.model ?? "";
    const key = `${r.user_id} ${model}`;
    let pile = piles.get(key);
    if (!pile) {
      pile = {
        model,
        user: r.user_id,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      };
      piles.set(key, pile);
    }
    pile.input_tokens += input;
    pile.output_tokens += output;
    pile.cache_read_tokens += Number(r.cache_read_tokens ?? 0);
    pile.cache_write_tokens += Number(r.cache_write_tokens ?? 0);
  }

  let flowMicros = 0;
  for (const pile of piles.values()) {
    const cost = flowCostMicros(pile.model, pile);
    bucketFor(pile.user).micros += cost;
    flowMicros += cost;
  }

  return {
    byUser,
    totalCredits,
    totalFlowTurns,
    totalMicros:
      Math.round(totalCredits * DEFAULT_MICROS_PER_CREDIT) + flowMicros,
  };
}

const MODULE_COLS =
  "id, org_id, title, blurb, video_url, link_url, body, position, published, created_at";

/**
 * An agency's own training shelf.
 *
 * No org filter and no published filter in app code on purpose: `org_modules`
 * carries both in its policies (the roster reads published rows of orgs it is
 * in, managers read their drafts too), so the same call serves the creator's
 * /modules and the owner's /agency/modules and cannot drift between them.
 * Passing an orgId narrows a manager who runs two agencies to the one they are
 * looking at.
 */
export async function loadModules(orgId?: string): Promise<OrgModule[]> {
  const supabase = await createClient();

  let query = supabase.from("org_modules").select(MODULE_COLS);
  if (orgId) query = query.eq("org_id", orgId);

  const { data, error } = await query
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  // the table lands with a migration, and this app applies those by hand — a
  // deploy that runs ahead of one shows an empty shelf rather than a 500.
  if (error) return [];
  return (data ?? []) as OrgModule[];
}

/**
 * Whether an org has anything on its shelf, for the rail.
 *
 * A count with `head: true` rather than `loadModules().length` because this
 * runs in the (dash) layout on every single page in the app, and the answer it
 * needs is one bit. Selecting six columns of every module to find out whether
 * there is at least one is the kind of thing that only shows up as a slow app
 * six months later.
 *
 * Counts PUBLISHED rows only: an owner who has written one draft should not get
 * a Modules row on their roster's rail promising a shelf with nothing on it.
 */
export async function hasPublishedModules(orgId: string): Promise<boolean> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("org_modules")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("published", true);

  // same reasoning as loadModules: migrations here are applied by hand, so a
  // deploy running ahead of one hides the row rather than breaking every page.
  if (error) return false;
  return (count ?? 0) > 0;
}

/** Pending invites for an org. Accepted ones are history, not a list. */
export async function loadInvites(orgId: string): Promise<OrgInvite[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("org_invites")
    .select("id, email, role, token, expires_at, created_at")
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  // stamped here rather than in the page, so the row says whether its link
  // still works and the render never has to ask what time it is.
  const now = Date.now();
  return (data ?? []).map((row) => ({
    ...(row as Omit<OrgInvite, "expired">),
    expired: new Date(row.expires_at as string).getTime() < now,
  }));
}

/** The seats, without the money. For the places that only need names. */
export async function loadMembers(orgId: string): Promise<OrgMember[]> {
  const roster = await loadRoster(orgId);
  return roster.map(
    ({ user_id, role, joined_at, name, email, avatar_url }) => ({
      user_id,
      role,
      joined_at,
      name,
      email,
      avatar_url,
    })
  );
}
