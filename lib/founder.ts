import { accessOf, ACCESS_LEVELS, type AccessLevel } from "@/lib/access-levels";
import { CE_ORG_ID, ORG_COLS, type Org, type OrgInvite, type OrgRole } from "@/lib/org";
import { isGranted, toolSlugFromKey, type OrgOverride } from "@/lib/org-overrides";
import { getPricing } from "@/lib/scrape/usage";
import { requireFounderView } from "@/lib/supabase/founder";
import { flowCostMicros } from "@/lib/usage-pricing";

/**
 * The reads behind /founder. Staff-only, and they say so twice: `requireFounder()`
 * runs here, and the `*_admin_read` policies added in 20260809070000 are what
 * actually let the rows out. Neither one is decoration: drop the policies and
 * these queries come back empty rather than erroring, which is the failure mode
 * that looks like "nobody has done anything yet".
 *
 * Read only. There is no writer in this file and there should not be one: an
 * admin looking at a creator's deal is a different thing from an admin editing
 * it, and only the first has been asked for.
 */

/** One row of `public.admin_people`, the roster view. */
export type Person = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
  niche: string | null;
  created_at: string;
  is_admin: boolean;
  /** their row on `admin_emails`, exactly. null when they hold no grant. */
  grant_role: "founder" | "creator" | null;
  /** their seat on the one workspace, or null when they hold none. */
  seat_role: OrgRole | null;
  portfolio_slug: string | null;
  portfolio_published: boolean;
  deal_count: number;
  video_count: number;
  tracked_views: number;
  last_posted_at: string | null;
  scraped_post_count: number;
  scraped_views: number;
  social_post_count: number;
  transcript_count: number;
  edit_job_count: number;
  credits_spent: number;
  last_call_at: string | null;
  /** the four below are computed by the loaders, not columns on the view. */
  flow_turns: number;
  flow_micros: number;
  scrape_micros: number;
  spend_micros: number;
};

/**
 * Everything a person has made, from the three places it can come from, in one
 * shape. The point of the admin view is "what has this creator actually
 * produced", and answering that from three tables the reader has to hold in
 * their head separately is not answering it.
 *
 * - `tracked` is a video on a deal, so it has real money attached to its views.
 * - `pulled` came out of the profile scraper, so it is public numbers off a
 *   handle and is not necessarily theirs at all.
 * - `posted` went out through our own autoposter.
 *
 * The chip on each card keeps that distinction visible, because a scraped post
 * and a tracked one look identical once they are both a thumbnail with a number
 * under it.
 */
export type UgcSource = "tracked" | "pulled" | "posted";

export type UgcItem = {
  key: string;
  source: UgcSource;
  platform: string;
  title: string;
  url: string | null;
  thumbnail: string | null;
  views: number | null;
  likes: number | null;
  postedAt: string | null;
  /** status or handle. whatever the row has that a number does not say. */
  note: string | null;
};

/** One account signed up for a deal, shown on the deal's row. */
export type DealAccountRef = {
  platform: string;
  handle: string;
  active: boolean;
};

export type PersonDeal = {
  id: string;
  name: string | null;
  status: string;
  brand: string | null;
  flat_fee_cents: number | null;
  flat_fee_kind: string | null;
  started_on: string | null;
  ends_on: string | null;
  /** which accounts this deal posts and tracks on, per platform. */
  accounts: DealAccountRef[];
};

/**
 * What one person's product usage adds up to, one group per thing that costs
 * or produces something. Every dollar figure is micro-dollars, priced by the
 * constants in `lib/usage-pricing.ts`, so nothing here can read "not set".
 */
export type PersonUsage = {
  scrape: { credits: number; micros: number; calls: number; profiles: number };
  flow: { turns: number; tokensIn: number; tokensOut: number; micros: number };
  emails: {
    addresses: number;
    accounts: number;
    /** [platform, count] sorted busiest first, for "3 tiktok, 2 instagram". */
    byPlatform: [string, number][];
    codes: number;
  };
  transcripts: number;
};

export type PersonDetail = {
  person: Person;
  ugc: UgcItem[];
  /** how many items were left off the end of `ugc`. */
  ugcHidden: number;
  usage: PersonUsage;
  deals: PersonDeal[];
  subscription: { status: string; current_period_end: string | null } | null;
};

/** How much of somebody's back catalogue one page prints. */
const UGC_LIMIT = 60;

/** How far back into each source we read before merging. */
const SOURCE_LIMIT = 120;

/**
 * How many flow ledger rows one read adds up. PostgREST hands back 1,000 by
 * default, which would silently under-price anyone chatty; this caps loudly at
 * a number the chat will not reach for a long while. Past it, move the rollup
 * into a view.
 */
const FLOW_EVENT_LIMIT = 10_000;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)) || 0;

/**
 * Every count on the view is a bigint or a numeric, and postgrest is allowed to
 * hand either back as a json string once it is bigger than a double can hold
 * exactly. Coercing here means no caller ever has to wonder, and `fmt()` on a
 * string does not blow the page up six months from now.
 */
function toPerson(row: Record<string, unknown>): Person {
  return {
    user_id: String(row.user_id),
    email: (row.email as string) ?? null,
    full_name: (row.full_name as string) ?? null,
    avatar_url: (row.avatar_url as string) ?? null,
    handle: (row.handle as string) ?? null,
    niche: (row.niche as string) ?? null,
    created_at: String(row.created_at),
    is_admin: row.is_admin === true,
    // both are stitched on by the loaders: `admin_people` knows whether there
    // is a grant, not which one, and knows nothing about seats at all.
    grant_role: null,
    seat_role: null,
    portfolio_slug: (row.portfolio_slug as string) ?? null,
    portfolio_published: row.portfolio_published === true,
    deal_count: num(row.deal_count),
    video_count: num(row.video_count),
    tracked_views: num(row.tracked_views),
    last_posted_at: (row.last_posted_at as string) ?? null,
    scraped_post_count: num(row.scraped_post_count),
    scraped_views: num(row.scraped_views),
    social_post_count: num(row.social_post_count),
    transcript_count: num(row.transcript_count),
    edit_job_count: num(row.edit_job_count),
    credits_spent: num(row.credits_spent),
    last_call_at: (row.last_call_at as string) ?? null,
    flow_turns: 0,
    flow_micros: 0,
    scrape_micros: 0,
    spend_micros: 0,
  };
}

/**
 * What to call somebody. Google fills `full_name`, an email signup fills
 * nothing, and the local part of an address is still better than a uuid.
 */
export function personName(p: {
  full_name: string | null;
  email: string | null;
}): string {
  return (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Account";
}

export function personInitial(p: {
  full_name: string | null;
  email: string | null;
}): string {
  return personName(p).charAt(0).toUpperCase() || "?";
}

/** Everything they have made, wherever it came from. */
export function totalPosts(p: Person): number {
  return (
    num(p.video_count) + num(p.scraped_post_count) + num(p.social_post_count)
  );
}

/** Tracked views and scraped views are different numbers about the same thing. */
export function totalViews(p: Person): number {
  return num(p.tracked_views) + num(p.scraped_views);
}

/** Sorted newest first, with anything undated at the back rather than the top. */
function byRecency(a: UgcItem, b: UgcItem) {
  if (a.postedAt && b.postedAt) return a.postedAt < b.postedAt ? 1 : -1;
  if (a.postedAt) return -1;
  if (b.postedAt) return 1;
  return (b.views ?? 0) - (a.views ?? 0);
}

/** A flow ledger row, the shape `flowCostMicros` prices. */
type FlowRow = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

export { accessOf, ACCESS_LEVELS };
export type { AccessLevel };

/** One row of `admin_emails`. The email is the key: there may be no account. */
export type Grant = { email: string; role: string; created_at: string };

/**
 * Every grant on the platform, whether or not anybody has signed up on it.
 *
 * Read separately from the roster so the People page can show the leftovers:
 * an access grant written against an address that has never signed in has no
 * profile row and would otherwise be a permission nobody can see or take back.
 */
export async function loadGrants(): Promise<Grant[]> {
  const { supabase } = await requireFounderView("/founder");

  const { data } = await supabase
    .from("admin_emails")
    .select("email, role, created_at")
    .order("created_at", { ascending: true });

  return (data ?? []).map((g) => ({
    email: String(g.email).toLowerCase(),
    role: String(g.role ?? "founder"),
    created_at: String(g.created_at),
  }));
}

/**
 * The whole roster, newest signup first, each person carrying what they have
 * cost: scrape credits priced by `getPricing()` plus every flow turn priced by
 * `flowCostMicros()`. One batched read of the flow ledger, rolled up in js, so
 * the roster is a fixed number of queries however many people there are.
 *
 * The grant and the seat ride along because the list is where access is now
 * changed. Both are tiny reads on this deploy (one workspace, a handful of
 * founders) and doing them here is what stops the page asking per row.
 */
export async function loadPeople(): Promise<Person[]> {
  const { supabase } = await requireFounderView("/founder");

  const [{ data }, { data: flowRows }, { data: grantRows }, { data: seatRows }, pricing] =
    await Promise.all([
    supabase
      .from("admin_people")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_usage_events")
      .select(
        "user_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens"
      )
      .limit(FLOW_EVENT_LIMIT),
    supabase.from("admin_emails").select("email, role"),
    // the one workspace. an empty CE_ORG_ID would match nothing, which is the
    // right answer for a deploy that has not been pointed at a workspace yet.
    supabase.from("org_members").select("user_id, role").eq("org_id", CE_ORG_ID),
    getPricing(),
  ]);

  const grants = new Map<string, string>();
  for (const g of (grantRows ?? []) as { email: string; role: string }[]) {
    grants.set(String(g.email).toLowerCase(), String(g.role ?? "founder"));
  }

  const seats = new Map<string, OrgRole>();
  for (const s of (seatRows ?? []) as { user_id: string; role: OrgRole }[]) {
    seats.set(s.user_id, s.role);
  }

  const flow = new Map<string, { turns: number; micros: number }>();
  for (const r of (flowRows ?? []) as (FlowRow & { user_id: string })[]) {
    const micros = flowCostMicros(r.model, r);
    const roll = flow.get(r.user_id);
    if (roll) {
      roll.turns += 1;
      roll.micros += micros;
    } else {
      flow.set(r.user_id, { turns: 1, micros });
    }
  }

  return (data ?? []).map((row) => {
    const p = toPerson(row);
    const f = flow.get(p.user_id);
    p.flow_turns = f?.turns ?? 0;
    p.flow_micros = f?.micros ?? 0;
    p.scrape_micros = p.credits_spent * pricing.microsPerCredit;
    p.spend_micros = p.scrape_micros + p.flow_micros;
    p.grant_role =
      (grants.get((p.email ?? "").toLowerCase()) as Person["grant_role"]) ?? null;
    p.seat_role = seats.get(p.user_id) ?? null;
    return p;
  });
}

/**
 * One person, everything about them. Null when there is no profile with that id,
 * which the page turns into a 404 rather than an empty shell.
 */
export async function loadPerson(userId: string): Promise<PersonDetail | null> {
  const { supabase } = await requireFounderView("/founder");

  const { data: person } = await supabase
    .from("admin_people")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!person) return null;

  const [
    { data: videos },
    { data: scraped },
    { data: posted },
    { data: deals },
    { data: dealAccounts },
    { count: targetCount },
    { count: callCount },
    { data: subscription },
    { data: flowRows },
    { count: emailCount },
    { data: emailAccounts },
    { count: codeCount },
    pricing,
  ] = await Promise.all([
    supabase
      .from("videos")
      .select(
        "id, platform, url, caption, thumbnail_url, views, likes, posted_at, counts"
      )
      .eq("user_id", userId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(SOURCE_LIMIT),
    supabase
      .from("scrape_posts")
      .select(
        "id, platform, post_url, title, thumbnail_url, views, likes, posted_at"
      )
      .eq("user_id", userId)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(SOURCE_LIMIT),
    supabase
      .from("social_posts")
      .select("id, caption, platforms, video_url, status, scheduled_for, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SOURCE_LIMIT),
    supabase
      .from("deals")
      .select(
        "id, name, status, flat_fee_cents, flat_fee_kind, started_on, ends_on, brands(name)"
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("deal_accounts")
      .select("deal_id, platform, handle, active")
      .eq("user_id", userId)
      .order("platform"),
    supabase
      .from("scrape_targets")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("api_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("ai_usage_events")
      .select(
        "model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens"
      )
      .eq("user_id", userId)
      .limit(FLOW_EVENT_LIMIT),
    supabase
      .from("account_emails")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase
      .from("account_email_accounts")
      .select("platform")
      .eq("user_id", userId),
    supabase
      .from("account_email_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    getPricing(),
  ]);

  const items: UgcItem[] = [
    ...(videos ?? []).map((v): UgcItem => ({
      key: `tracked:${v.id}`,
      source: "tracked",
      platform: v.platform,
      title: (v.caption ?? "").trim() || "Untitled",
      url: v.url,
      thumbnail: v.thumbnail_url,
      views: num(v.views),
      likes: num(v.likes),
      postedAt: v.posted_at,
      // a video with `counts` off is still theirs, it just does not pay, and
      // that is exactly the kind of thing an admin is looking at this page for.
      note: v.counts === false ? "excluded from bonus" : null,
    })),
    ...(scraped ?? []).map((s): UgcItem => ({
      key: `pulled:${s.id}`,
      source: "pulled",
      platform: s.platform,
      title: (s.title ?? "").trim() || "Untitled",
      url: s.post_url,
      thumbnail: s.thumbnail_url,
      views: num(s.views),
      likes: num(s.likes),
      postedAt: s.posted_at,
      note: null,
    })),
    ...(posted ?? []).map((p): UgcItem => ({
      key: `posted:${p.id}`,
      source: "posted",
      platform: (p.platforms ?? []).join(", ") || "unknown",
      title: (p.caption ?? "").trim() || "No caption",
      url: p.video_url,
      thumbnail: null,
      views: null,
      likes: null,
      postedAt: p.scheduled_for ?? p.created_at,
      note: p.status,
    })),
  ].sort(byRecency);

  // which accounts hang off which deal, so the deal row can name them.
  const accountsByDeal = new Map<string, DealAccountRef[]>();
  for (const a of dealAccounts ?? []) {
    const list = accountsByDeal.get(a.deal_id) ?? [];
    list.push({ platform: a.platform, handle: a.handle, active: a.active });
    accountsByDeal.set(a.deal_id, list);
  }

  // the flow ledger, priced row by row so a model change reprices only itself.
  let flowTurns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let flowMicros = 0;
  for (const r of (flowRows ?? []) as FlowRow[]) {
    flowTurns += 1;
    tokensIn += num(r.input_tokens);
    tokensOut += num(r.output_tokens);
    flowMicros += flowCostMicros(r.model, r);
  }

  const byPlatform = new Map<string, number>();
  for (const a of emailAccounts ?? []) {
    const k = (a.platform || "other").toLowerCase();
    byPlatform.set(k, (byPlatform.get(k) ?? 0) + 1);
  }

  const p = toPerson(person);
  p.flow_turns = flowTurns;
  p.flow_micros = flowMicros;
  p.scrape_micros = p.credits_spent * pricing.microsPerCredit;
  p.spend_micros = p.scrape_micros + p.flow_micros;

  // what they are allowed to do, read exactly rather than inferred from the
  // view's `is_admin`, which is true for any grant and cannot tell the two
  // apart. Two one-row reads, after the batch, because both key off `p.email`.
  const [grant, seat] = await Promise.all([
    p.email
      ? supabase
          .from("admin_emails")
          .select("role")
          .eq("email", p.email.toLowerCase())
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", CE_ORG_ID)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  p.grant_role = (grant.data?.role as Person["grant_role"]) ?? null;
  p.seat_role = (seat.data?.role as OrgRole) ?? null;

  return {
    person: p,
    ugc: items.slice(0, UGC_LIMIT),
    ugcHidden: Math.max(0, items.length - UGC_LIMIT),
    usage: {
      scrape: {
        credits: p.credits_spent,
        micros: p.scrape_micros,
        calls: callCount ?? 0,
        profiles: targetCount ?? 0,
      },
      flow: {
        turns: flowTurns,
        tokensIn,
        tokensOut,
        micros: flowMicros,
      },
      emails: {
        addresses: emailCount ?? 0,
        accounts: (emailAccounts ?? []).length,
        byPlatform: [...byPlatform.entries()].sort((a, b) => b[1] - a[1]),
        codes: codeCount ?? 0,
      },
      transcripts: p.transcript_count,
    },
    deals: (deals ?? []).map((d): PersonDeal => {
      // postgrest hands an embedded to-one back as an object, and as an array on
      // the older shape. taking both keeps this from breaking on a client bump.
      const brand = Array.isArray(d.brands) ? d.brands[0] : d.brands;
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        brand: (brand as { name?: string } | null)?.name ?? null,
        flat_fee_cents: d.flat_fee_cents,
        flat_fee_kind: d.flat_fee_kind,
        started_on: d.started_on,
        ends_on: d.ends_on,
        accounts: accountsByDeal.get(d.id) ?? [],
      };
    }),
    subscription: subscription ?? null,
  };
}

// ------------------------------------------------------------------ agencies
//
// every workspace, seen from above. the founder is the one role that sits over
// all of them: who owns each, who sits on it and as what, and the shelf only a
// founder can fill (custom tool grants, portfolio setup, anything else in
// `org_overrides`). all read behind `requireFounderView()`, which is what the
// `orgs_admin_read` / `org_members_admin_read` / `org_overrides_admin_read`
// policies answer to.

export type AgencyPerson = {
  user_id: string;
  role: OrgRole;
  joined_at: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type AgencySummary = {
  org: Org;
  created_at: string;
  owner: AgencyPerson | null;
  /** owner + admins + creators, in that order, then by joined_at. */
  people: AgencyPerson[];
  counts: { owners: number; admins: number; creators: number };
  /** slugs of custom tools granted, registered or not. */
  toolGrants: string[];
  overrideCount: number;
};

export type AgencyDetail = AgencySummary & {
  invites: OrgInvite[];
  overrides: OrgOverride[];
};

const ROLE_ORDER: Record<OrgRole, number> = { owner: 0, admin: 1, creator: 2 };

function sortPeople(a: AgencyPerson, b: AgencyPerson): number {
  return (
    ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
    a.joined_at.localeCompare(b.joined_at)
  );
}

/**
 * Every workspace with its roster and its founder shelf, newest first.
 *
 * Three batched reads however many workspaces there are: orgs, every seat,
 * every override, plus one profiles read for the names. Grouped in js. A
 * deploy running ahead of the `org_overrides` migration gets an error on that
 * one read and it means "no overrides", not a broken page: the shelf is a
 * garnish on the roster.
 */
export async function loadAgencies(): Promise<AgencySummary[]> {
  const { supabase } = await requireFounderView("/founder/agencies");

  const [{ data: orgRows }, { data: seatRows }, overridesRes] = await Promise.all([
    supabase
      .from("orgs")
      .select(`${ORG_COLS}, created_at`)
      .order("created_at", { ascending: false }),
    supabase.from("org_members").select("org_id, user_id, role, joined_at"),
    supabase.from("org_overrides").select("org_id, key, value, set_by, set_at"),
  ]);

  const orgs = (orgRows ?? []) as (Org & { created_at: string })[];
  if (orgs.length === 0) return [];

  const seats = (seatRows ?? []) as {
    org_id: string;
    user_id: string;
    role: OrgRole;
    joined_at: string;
  }[];
  const overrides = (overridesRes.data ?? []) as OrgOverride[];

  const userIds = [...new Set([...seats.map((s) => s.user_id), ...orgs.map((o) => o.owner_id)])];
  const { data: profileRows } =
    userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, email, avatar_url")
          .in("id", userIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null; avatar_url: string | null }[] };
  const profiles = new Map(
    (profileRows ?? []).map((p) => [
      p.id as string,
      p as { id: string; full_name: string | null; email: string | null; avatar_url: string | null },
    ])
  );

  const person = (s: { user_id: string; role: OrgRole; joined_at: string }): AgencyPerson => {
    const p = profiles.get(s.user_id);
    return {
      user_id: s.user_id,
      role: s.role,
      joined_at: s.joined_at,
      full_name: p?.full_name ?? null,
      email: p?.email ?? null,
      avatar_url: p?.avatar_url ?? null,
    };
  };

  return orgs.map(({ created_at, ...org }) => {
    const people = seats
      .filter((s) => s.org_id === org.id)
      .map(person)
      .sort(sortPeople);
    const mine = overrides.filter((o) => o.org_id === org.id);
    return {
      org,
      created_at,
      // the owner row is the seat pinned to `owner`; if the trigger has not
      // written it yet (it always has), fall back to the column so the page
      // still names them.
      owner:
        people.find((p) => p.user_id === org.owner_id) ??
        (profiles.has(org.owner_id)
          ? person({ user_id: org.owner_id, role: "owner", joined_at: created_at })
          : null),
      people,
      counts: {
        owners: people.filter((p) => p.role === "owner").length,
        admins: people.filter((p) => p.role === "admin").length,
        creators: people.filter((p) => p.role === "creator").length,
      },
      toolGrants: mine
        .filter((o) => isGranted(o.value))
        .map((o) => toolSlugFromKey(o.key))
        .filter((s): s is string => s !== null)
        .sort(),
      overrideCount: mine.length,
    };
  });
}

/** One workspace, everything the founder page shows. Null when there is no such org. */
export async function loadAgency(orgId: string): Promise<AgencyDetail | null> {
  const summary = (await loadAgencies()).find((a) => a.org.id === orgId) ?? null;
  if (!summary) return null;

  const { supabase } = await requireFounderView("/founder/agencies");
  const [{ data: inviteRows }, overridesRes] = await Promise.all([
    supabase
      .from("org_invites")
      .select("id, email, role, token, expires_at, created_at")
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("org_overrides")
      .select("org_id, key, value, set_by, set_at")
      .eq("org_id", orgId)
      .order("key", { ascending: true }),
  ]);

  const now = Date.now();
  return {
    ...summary,
    invites: (inviteRows ?? []).map((row) => ({
      ...(row as Omit<OrgInvite, "expired">),
      expired: new Date(row.expires_at as string).getTime() < now,
    })),
    overrides: (overridesRes.data ?? []) as OrgOverride[],
  };
}
