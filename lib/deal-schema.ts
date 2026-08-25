/**
 * The deal's field contract. One definition, four consumers.
 *
 * `lib/portfolio-schema.ts` already proves the pattern in this repo and this is
 * the same idea applied to the money side: nothing outside this file invents a
 * field name, a label, an enum value or a length cap. That single definition is
 * read by
 *
 *   1. the forms in `components/dash/deal-forms.tsx` (labels, hints, options),
 *   2. `normalizeDealDraft()` below, which is the only place a raw value becomes
 *      a row-shaped one,
 *   3. later, the json schema of the AI's `propose_deal` tool,
 *   4. later, the AI's own field descriptions (`ai` on each spec).
 *
 * The point of keeping those four married is not tidiness. When they drift, an
 * AI starts proposing values the form cannot render or the database rejects,
 * and the failure shows up as a constraint violation three layers away from the
 * cause.
 *
 * The other half of the contract is `DealDraft`. A draft is a whole deal —
 * brand, terms and the accounts it posts from — validated but not yet written.
 * The form builds one out of a FormData, and an AI proposal will build the same
 * one out of json. Both then hand it to `applyDealDraft()` in
 * `lib/deal-intake.ts`, which is the single write path. That is what "flow
 * proposes, a human applies, and the apply is the same server action the UI
 * calls" means in code: there is only one door.
 *
 * Pure and client-safe on purpose. It imports types and parsers, never a
 * database client, so the browser can hold it without dragging `next/headers`
 * into the bundle.
 */

import { findBrand } from "@/lib/brand-catalog";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@/lib/deals";
import { parseHandle } from "@/lib/ingest/urls";
import { parseCentsOrZero, parseCount } from "@/lib/money";

/* ------------------------------------------------------------------ options */

/**
 * Every enum the deal side has, in one place, in the order a human reads them.
 * `as const` matters: the option lists are what both the `<select>` and the
 * server's `oneOf()` check are built from, so a value can only exist in one.
 */
export const DEAL_STATUS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
] as const;

export const FLAT_FEE_KIND = [
  { value: "one_time", label: "One time" },
  { value: "per_video", label: "Per video" },
  { value: "per_month", label: "Per month (retainer)" },
] as const;

export const PAY_CYCLE = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "weekly", label: "Weekly" },
  { value: "one_time", label: "One time" },
] as const;

export const RULE_KIND = [
  { value: "milestone", label: "View tiers (X views pays $Y)" },
  { value: "cpm", label: "CPM (paid per 1,000 views)" },
  { value: "per_video", label: "Flat, per video posted" },
] as const;

export const WINDOW_KIND = [
  { value: "forever", label: "Forever, every view counts" },
  { value: "since_post", label: "First N days of each video" },
  { value: "absolute", label: "Fixed campaign dates" },
] as const;

export const TIER_MODE = [
  { value: "add", label: "Add onto base pay" },
  { value: "replace", label: "Replace base pay" },
] as const;

/** Read as the tail of "3 videos ___", so the labels carry the article. */
export const POSTING_PERIOD = [
  { value: "day", label: "a day" },
  { value: "week", label: "a week" },
  { value: "month", label: "a month" },
] as const;

export const VIEW_COUNTING = [
  { value: "per_video", label: "Each post on its own" },
  { value: "highest", label: "Highest platform" },
  { value: "combined", label: "Combine platforms" },
] as const;

export const PLATFORM_OPTIONS = PLATFORMS.map((p) => ({
  value: p as string,
  label: PLATFORM_LABEL[p],
}));

/** The placeholder each platform's handle box shows, so the shape is obvious. */
export const PLATFORM_HANDLE_HINT: Record<Platform, string> = {
  tiktok: "candle.official",
  instagram: "candle",
  youtube: "candlehq",
  facebook: "candlehq",
};

/** The value union behind an option list, so `pick` stays honestly typed. */
const values = <T extends readonly { value: string }[]>(list: T): readonly T[number]["value"][] =>
  list.map((o) => o.value);

/* ----------------------------------------------------------- the registry */

export type FieldSpec = {
  label: string;
  hint?: string;
  kind: "text" | "textarea" | "date" | "url" | "money" | "count" | "enum";
  /** what the stored integer counts, for anything numeric. */
  unit?: "cents" | "days" | "views" | "videos";
  /** character cap for text, value cap for a count. */
  max?: number;
  min?: number;
  options?: readonly { value: string; label: string }[];
  example?: string;
  /** what a model is told this field means. one sentence, no jargon. */
  ai: string;
  /** how much damage a wrong value does. `money` never auto-applies. */
  risk: "safe" | "review" | "money";
};

export const BRAND_FIELDS = {
  name: {
    label: "Brand",
    hint: "The company, not the campaign. One Candle, however many deals.",
    kind: "text",
    max: 120,
    example: "Candle",
    ai: "The brand's name as the creator says it. Never a campaign name.",
    risk: "review",
  },
  website: {
    label: "Website",
    kind: "url",
    max: 500,
    example: "https://candle.com",
    ai: "The brand's homepage, if it was mentioned.",
    risk: "safe",
  },
  contact_name: {
    label: "Contact",
    hint: "Who you actually talk to.",
    kind: "text",
    max: 120,
    example: "Priya",
    ai: "The person at the brand the creator deals with.",
    risk: "safe",
  },
  contact_email: {
    label: "Contact email",
    kind: "text",
    max: 200,
    example: "priya@candle.com",
    ai: "That person's email, only if stated verbatim.",
    risk: "safe",
  },
} as const satisfies Record<string, FieldSpec>;

export const DEAL_FIELDS = {
  name: {
    label: "Campaign name",
    hint: "What you call this run of work with the brand.",
    kind: "text",
    max: 120,
    example: "Summer launch",
    ai: "The name of this run of work. Default to 'Campaign' if none was given.",
    risk: "review",
  },
  status: {
    label: "Status",
    kind: "enum",
    options: DEAL_STATUS,
    example: "active",
    ai: "Where the deal stands. A deal being set up but not signed is 'draft', and a draft earns nothing.",
    risk: "review",
  },
  started_on: {
    label: "Starts",
    kind: "date",
    example: "2026-08-01",
    ai: "The first day of the deal, as a YYYY-MM-DD day key. Never a timestamp.",
    risk: "review",
  },
  ends_on: {
    label: "Ends",
    hint: "Leave empty if it is open ended.",
    kind: "date",
    example: "2026-11-30",
    ai: "The last day, or null when the deal is open ended.",
    risk: "review",
  },
  flat_fee_cents: {
    label: "Flat fee",
    hint: "What is owed before a single view is counted.",
    kind: "money",
    unit: "cents",
    example: "75000",
    ai: "The guaranteed pay, written in DOLLARS the way a rate sheet writes it. $750 is 750. The server multiplies by 100, so sending 75000 books a $75,000 deal.",
    risk: "money",
  },
  flat_fee_kind: {
    label: "Charged",
    hint: "Per video multiplies by what you post.",
    kind: "enum",
    options: FLAT_FEE_KIND,
    example: "one_time",
    ai: "How the flat fee repeats: once, per video posted, or per month as a retainer.",
    risk: "money",
  },
  posting_quota: {
    label: "Videos you post",
    hint: "The deliverable, not a guess. Empty if there is no agreed number.",
    kind: "count",
    unit: "videos",
    min: 0,
    max: 1000,
    example: "2",
    ai: "How many videos the deal asks for inside one period, as a whole number. Always paired with posting_period. 0 or null means no agreed number, which is not the same as zero videos.",
    risk: "review",
  },
  posting_period: {
    label: "Every",
    kind: "enum",
    options: POSTING_PERIOD,
    example: "day",
    ai: "The unit posting_quota is counted per: day, week or month. Store the creator's own unit and never convert it — '4 a week' is stored as 4 and week, never as 0.57 and day.",
    risk: "review",
  },
  min_views_for_base: {
    label: "Min views for base",
    hint: "A per-video fee only pays once the video clears this. Empty means it always pays.",
    kind: "count",
    unit: "views",
    min: 0,
    example: "2000",
    ai: "Views a video has to reach before the per-video base fee is owed at all. 0 or null means the base fee always pays. Only meaningful when flat_fee_kind is per_video.",
    risk: "money",
  },
  pay_cycle: {
    label: "Pay cycle",
    kind: "enum",
    options: PAY_CYCLE,
    example: "monthly",
    ai: "How often the brand pays out.",
    risk: "review",
  },
  cycle_anchor_on: {
    label: "Cycle starts",
    hint: "First day of one pay period. A 16th to 15th deal stores the 16th. Empty means calendar months.",
    kind: "date",
    example: "2026-08-16",
    ai: "The first day of any one pay period, as a YYYY-MM-DD day key. Sets where monthly cycles break (the 16th means 16th to 15th) and which week a weekly or biweekly cycle starts. Null means calendar months.",
    risk: "review",
  },
  net_days: {
    label: "Terms",
    hint: "Net 30 means they pay 30 days after you invoice.",
    kind: "count",
    unit: "days",
    min: 0,
    max: 180,
    example: "30",
    ai: "Days between invoice and payment. 'net 30' is 30.",
    risk: "review",
  },
  contract_url: {
    label: "Contract link",
    kind: "url",
    max: 500,
    example: "https://drive.google.com/…",
    ai: "A link to the signed contract, if one was given.",
    risk: "safe",
  },
  notes: {
    label: "Notes",
    hint: "Deliverables, who the contact is, anything you will forget.",
    kind: "textarea",
    max: 2000,
    ai: "Anything the structured fields cannot hold. Never put money terms only here.",
    risk: "safe",
  },
} as const satisfies Record<string, FieldSpec>;

export const ACCOUNT_FIELDS = {
  platform: {
    label: "Platform",
    kind: "enum",
    options: PLATFORM_OPTIONS,
    example: "tiktok",
    ai: "One of tiktok, instagram, youtube, facebook. Nothing else is tracked.",
    risk: "review",
  },
  handle: {
    label: "Handle or profile link",
    hint: "Paste the profile url if that is easier, it gets read either way.",
    kind: "text",
    max: 200,
    example: "candle.official",
    ai: "The account handle without the @. A profile url is accepted and read down to the handle.",
    risk: "review",
  },
} as const satisfies Record<string, FieldSpec>;

/**
 * The bonus side. A rule is written on its own form rather than as part of the
 * draft, so these are labels and AI descriptions only — `addRule` in
 * `app/(dash)/deals/actions.ts` is what parses them.
 */
export const RULE_FIELDS = {
  kind: {
    label: "Bonus type",
    kind: "enum",
    options: RULE_KIND,
    example: "milestone",
    ai: "How the bonus is shaped: view tiers, a CPM, or a flat amount per video.",
    risk: "money",
  },
  tier_mode: {
    label: "How it pays",
    hint: "Replace is the usual one on a tier sheet: $30 a video, or $150 once it hits 50k.",
    kind: "enum",
    options: TIER_MODE,
    example: "replace",
    ai: "'replace' means a video that earns this bonus is not also owed the base fee. 'add' stacks the bonus on top. Default to 'add' unless the brand said the tier is the whole payment.",
    risk: "money",
  },
  view_counting: {
    label: "View counting",
    hint: "For one cut posted to several platforms. Videos are tied together by their content group tag.",
    kind: "enum",
    options: VIEW_COUNTING,
    example: "combined",
    ai: "How the same cut posted to several platforms is counted: 'per_video' pays each post on its own views, 'highest' pays only the best performing post, 'combined' totals the views across platforms and pays once.",
    risk: "money",
  },
  tiers: {
    label: "View tiers",
    hint: "Views on the left, what it pays on the right. Only the highest tier reached pays.",
    kind: "text",
    unit: "views",
    example: "50000 = 150",
    ai: "The tier table as views to DOLLARS, the way the rate sheet writes it: 50000 views pays 150, not 15000. Tiers never stack: a video at 60k on a 10k/50k sheet earns the 50k amount, not both.",
    risk: "money",
  },
} as const satisfies Record<string, FieldSpec>;

/* --------------------------------------------------------------- the draft */

export type DraftAccount = { platform: Platform; handle: string };

/**
 * A whole deal, validated, not yet written.
 *
 * `brand.id` set means attach to a brand that already exists and leave it
 * alone. `brand.id` null means create one from `brand.name`. Both are never
 * true at once, which is the one thing that stops a form with a stale hidden
 * field from forking a creator's Candle in two.
 */
export type DealDraft = {
  brand: {
    id: string | null;
    name: string;
    logoKey: string | null;
    /** a creator's own uploaded mark. set, it beats any catalogue match. */
    logoUrl: string | null;
    website: string | null;
  };
  deal: {
    name: string;
    status: (typeof DEAL_STATUS)[number]["value"];
    started_on: string | null;
    ends_on: string | null;
    flat_fee_cents: number;
    flat_fee_kind: (typeof FLAT_FEE_KIND)[number]["value"];
    min_views_for_base: number;
    posting_quota: number;
    posting_period: (typeof POSTING_PERIOD)[number]["value"];
    pay_cycle: (typeof PAY_CYCLE)[number]["value"];
    cycle_anchor_on: string | null;
    net_days: number;
    contract_url: string | null;
    notes: string | null;
  };
  accounts: DraftAccount[];
};

/** Everything arrives loose: form strings from a browser, json from a model. */
export type DealDraftInput = {
  brand_id?: unknown;
  brand_name?: unknown;
  brand_logo_key?: unknown;
  brand_logo_url?: unknown;
  brand_website?: unknown;
  name?: unknown;
  status?: unknown;
  started_on?: unknown;
  ends_on?: unknown;
  flat_fee?: unknown;
  flat_fee_kind?: unknown;
  posting_quota?: unknown;
  posting_period?: unknown;
  min_views_for_base?: unknown;
  pay_cycle?: unknown;
  cycle_anchor_on?: unknown;
  net_days?: unknown;
  contract_url?: unknown;
  notes?: unknown;
  accounts?: { platform?: unknown; handle?: unknown }[];
};

/* ----------------------------------------------------------------- parsing */

const str = (value: unknown, max: number): string | null => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};

const day = (value: unknown): string | null => {
  const out = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out)) return null;
  // a well formed string that is not a real day ("2026-02-31") would be taken
  // by postgres as a date error, which surfaces as a raw pg message.
  const parsed = new Date(`${out}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== out
    ? null
    : out;
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const out = String(value ?? "");
  return (allowed as readonly string[]).includes(out) ? (out as T) : fallback;
};

/** A link someone pasted without the scheme is still a link they meant. */
const link = (value: unknown, max: number): string | null => {
  const raw = str(value, max);
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
};

/**
 * An explicit `ok` rather than "the error field is empty". A failure message is
 * a string, and a string can legally be "", so truthiness on the error is not a
 * discriminant TypeScript can narrow on and not one a reader should trust either.
 */
export type DealResult = { ok: true; deal: DealDraft["deal"] } | { ok: false; error: string };
export type DraftResult = { ok: true; draft: DealDraft } | { ok: false; error: string };

/**
 * The terms half, on its own, because create and edit both write it and a
 * second copy of these rules is how the two drift apart.
 *
 * Every failure returns a sentence a creator can act on rather than a database
 * error, and nothing is silently coerced where the coercion could cost money:
 * a flat fee that will not parse is an error, not a zero.
 */
export function normalizeDeal(raw: DealDraftInput): DealResult {
  const flatFee = parseCentsOrZero(raw.flat_fee);
  if (flatFee === null) return { ok: false, error: "The flat fee has to be a number." };

  const startedOn = day(raw.started_on);
  const endsOn = day(raw.ends_on);
  if (startedOn && endsOn && endsOn < startedOn) {
    return { ok: false, error: "The deal ends before it starts." };
  }

  // net_days carries a `between 0 and 180` check in the schema, so an out of
  // range value is caught here as a sentence instead of there as a constraint name.
  const netDaysRaw = String(raw.net_days ?? "").trim();
  const netDays = netDaysRaw ? parseCount(netDaysRaw) : 30;
  if (netDays === null || netDays > 180) {
    return { ok: false, error: "Terms are a whole number of days, up to 180." };
  }

  // empty is "no floor", which is the common case, so it coerces to zero. junk
  // is an error rather than a zero: a floor that silently vanished would pay a
  // base fee on every video the creator meant to exclude.
  const minViewsRaw = String(raw.min_views_for_base ?? "").trim();
  const minViewsForBase = minViewsRaw ? parseCount(minViewsRaw) : 0;
  if (minViewsForBase === null) {
    return { ok: false, error: "Min views for base has to be a whole number." };
  }

  // empty is "no agreed number", which is how every deal written before this
  // field existed reads and how a one-off with no set deliverable reads too.
  // junk is an error rather than a zero, on the same rule as the view floor: a
  // cadence that silently vanished takes the forecast built on it with it.
  const quotaRaw = String(raw.posting_quota ?? "").trim();
  const postingQuota = quotaRaw ? parseCount(quotaRaw) : 0;
  if (postingQuota === null || postingQuota > DEAL_FIELDS.posting_quota.max) {
    return { ok: false, error: "Videos you post has to be a whole number, up to 1,000." };
  }

  return {
    ok: true,
    deal: {
      name: str(raw.name, DEAL_FIELDS.name.max) ?? "Campaign",
      status: pick(raw.status, values(DEAL_STATUS), "active"),
      started_on: startedOn,
      ends_on: endsOn,
      flat_fee_cents: flatFee,
      flat_fee_kind: pick(raw.flat_fee_kind, values(FLAT_FEE_KIND), "one_time"),
      min_views_for_base: minViewsForBase,
      posting_quota: postingQuota,
      posting_period: pick(raw.posting_period, values(POSTING_PERIOD), "day"),
      pay_cycle: pick(raw.pay_cycle, values(PAY_CYCLE), "monthly"),
      cycle_anchor_on: day(raw.cycle_anchor_on),
      net_days: netDays,
      contract_url: link(raw.contract_url, DEAL_FIELDS.contract_url.max),
      notes: str(raw.notes, DEAL_FIELDS.notes.max),
    },
  };
}

export type BrandColumns = {
  name: string;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  logo_key: string | null;
  logo_url: string | null;
};

export type BrandResult = { ok: true; brand: BrandColumns } | { ok: false; error: string };

/** The brand's own fields, for the panel that edits one after the fact. */
export function normalizeBrand(raw: {
  name?: unknown;
  website?: unknown;
  contact_name?: unknown;
  contact_email?: unknown;
  logo_key?: unknown;
  logo_url?: unknown;
}): BrandResult {
  const name = str(raw.name, BRAND_FIELDS.name.max);
  if (!name) return { ok: false, error: "The brand needs a name." };

  const logoKey = str(raw.logo_key, 60);

  return {
    ok: true,
    brand: {
      name,
      website: link(raw.website, BRAND_FIELDS.website.max),
      contact_name: str(raw.contact_name, BRAND_FIELDS.contact_name.max),
      contact_email: str(raw.contact_email, BRAND_FIELDS.contact_email.max),
      // an unknown key would render as a missing image forever, so it is
      // dropped rather than stored.
      logo_key: logoKey && findBrand(logoKey) ? logoKey : null,
      // the creator's own uploaded mark. it goes through the same url check as
      // a website, so a broken string becomes "no logo" rather than a 404 tile.
      logo_url: link(raw.logo_url, 600),
    },
  };
}

/** The brand, the terms and the accounts: everything one deal needs to exist. */
export function normalizeDealDraft(raw: DealDraftInput): DraftResult {
  const brandId = str(raw.brand_id, 40);
  const brandName = str(raw.brand_name, BRAND_FIELDS.name.max);

  if (!brandId && !brandName) return { ok: false, error: "Pick a brand or type a new one." };

  const terms = normalizeDeal(raw);
  if (!terms.ok) return { ok: false, error: terms.error };

  const seen = new Set<string>();
  const accounts: DraftAccount[] = [];

  for (const entry of raw.accounts ?? []) {
    const rawHandle = str(entry.handle, ACCOUNT_FIELDS.handle.max);
    if (!rawHandle) continue;

    const platform = pick<Platform>(entry.platform, PLATFORMS, "tiktok");
    const handle = parseHandle(rawHandle, platform);
    if (!handle) {
      return {
        ok: false,
        error: `"${rawHandle}" does not read as a ${PLATFORM_LABEL[platform]} handle or profile link.`,
      };
    }

    // the same account twice would trip the unique index as a 23505 the moment
    // the deal is written, which reads as a mystery.
    const key = `${platform}:${handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    accounts.push({ platform, handle });
  }

  // a key the catalogue does not know would render as a missing image forever,
  // so an unrecognised one is dropped rather than stored.
  const logoKey = str(raw.brand_logo_key, 60);
  const logoUrl = link(raw.brand_logo_url, 600);

  return {
    ok: true,
    draft: {
      brand: {
        id: brandId,
        // an existing brand keeps its own name; this is only read on a create.
        name: brandName ?? "",
        logoKey: logoKey && findBrand(logoKey) ? logoKey : null,
        logoUrl,
        website: link(raw.brand_website, BRAND_FIELDS.website.max),
      },
      deal: terms.deal,
      accounts,
    },
  };
}

/**
 * FormData → the same loose shape an AI proposal arrives in, so both go through
 * one `normalizeDealDraft`. The account fields are named per platform rather
 * than as a repeating group because the new-deal form offers exactly the three
 * it tracks, and a fixed three needs no client side row management.
 */
export function readDealForm(formData: FormData): DealDraftInput {
  return {
    brand_id: formData.get("brand_id"),
    brand_name: formData.get("brand_name"),
    brand_logo_key: formData.get("brand_logo_key"),
    brand_logo_url: formData.get("brand_logo_url"),
    brand_website: formData.get("brand_website"),
    name: formData.get("name"),
    status: formData.get("status"),
    started_on: formData.get("started_on"),
    ends_on: formData.get("ends_on"),
    flat_fee: formData.get("flat_fee"),
    flat_fee_kind: formData.get("flat_fee_kind"),
    posting_quota: formData.get("posting_quota"),
    posting_period: formData.get("posting_period"),
    min_views_for_base: formData.get("min_views_for_base"),
    pay_cycle: formData.get("pay_cycle"),
    cycle_anchor_on: formData.get("cycle_anchor_on"),
    net_days: formData.get("net_days"),
    contract_url: formData.get("contract_url"),
    notes: formData.get("notes"),
    accounts: PLATFORMS.map((platform) => ({
      platform,
      handle: formData.get(`account_${platform}`),
    })),
  };
}
