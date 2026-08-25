/**
 * The campaign board's shared vocabulary: types, the words each code maps to,
 * and the handful of formatters both views need.
 *
 * Nothing in here touches supabase. It is imported by a server page, a server
 * action and a client component, so it has to stay free of `use server` (which
 * would forbid the non-function exports) and of anything node-only.
 */

export const DEAL_STATUSES = ["instant", "comp", "v_comp", "need_info", "paused"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const PAY_MODELS = ["per_video", "retainer", "cpm"] as const;
export type PayModel = (typeof PAY_MODELS)[number];

export const VIRALITIES = ["great", "okay", "bad"] as const;
export type Virality = (typeof VIRALITIES)[number];

export const CONTACT_PLATFORMS = ["discord", "insta", "phone #"] as const;
export type ContactPlatform = (typeof CONTACT_PLATFORMS)[number];

export type Contact = { platform: ContactPlatform; value: string };

export type CampaignManager = {
  id: string;
  name: string;
  contacts: Contact[];
  referrals: number;
  /** yyyy-mm-dd, or null for never */
  last_contacted: string | null;
};

export type CampaignDeal = {
  id: string;
  name: string;
  status: DealStatus;
  base_pay: string;
  posting_freq: string;
  pay_model: PayModel;
  pay_amount: number | null;
  posting_per_day: number | null;
  posting_unlimited: boolean;
  virality: Virality | null;
  formats: string;
  notes: string;
  how_to_connect: string;
  who_runs_it: string;
  sort_order: number | null;
};

/** One end of a link, denormalised for whichever view is rendering it. */
export type DealManagerLink = { deal_id: string; manager_id: string };

/**
 * The browsable subset `campaign_catalog()` hands a member: the terms, never
 * the staff working notes (notes, how_to_connect, who_runs_it, virality, the
 * managers). The rpc excludes need_info and paused rows, but the type keeps the
 * full status union so a row is renderable whatever the function returns.
 */
export type CatalogDeal = Pick<
  CampaignDeal,
  | "id"
  | "name"
  | "status"
  | "base_pay"
  | "posting_freq"
  | "pay_model"
  | "pay_amount"
  | "posting_per_day"
  | "posting_unlimited"
  | "formats"
>;

export const REQUEST_STATUSES = ["pending", "approved", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

// ------------------------------------------------------------------ wording

/**
 * How hard it is to get placed, easiest first. This is the board's whole
 * ordering, so the array is the display order as well as the list of valid
 * values.
 *
 * Tones borrow the two the product already has rather than inventing a third:
 * green is "you can walk in", warm is "you have to be good", and the parked
 * tiers are quiet. A white-label org repainting the flame repaints the hard
 * tiers with it, which is the correct behaviour: green stays green because
 * "this one is open" must not become whatever colour a client picked.
 */
export const STATUS_META: Record<
  DealStatus,
  { label: string; chip: string; dot: string }
> = {
  instant: {
    label: "instant in",
    chip: "border-live-line bg-live-soft text-live",
    dot: "bg-live",
  },
  comp: {
    label: "competitive",
    chip: "border-line bg-shell text-ink-70",
    dot: "bg-ink-50",
  },
  v_comp: {
    label: "very competitive",
    chip: "border-line bg-ember text-flame-dark",
    dot: "bg-flame",
  },
  need_info: {
    label: "need info",
    chip: "border-dashed border-line bg-paper text-ink-50",
    dot: "bg-line",
  },
  paused: {
    label: "paused",
    chip: "border-line bg-shell text-ink-50",
    dot: "bg-line",
  },
};

export const VIRALITY_META: Record<Virality, { label: string; chip: string }> = {
  great: { label: "great", chip: "border-live-line bg-live-soft text-live" },
  okay: { label: "okay", chip: "border-line bg-shell text-ink-70" },
  bad: { label: "bad", chip: "border-line bg-ember text-flame-dark" },
};

export const PAY_MODEL_LABEL: Record<PayModel, string> = {
  per_video: "per video",
  retainer: "monthly retainer",
  cpm: "cpm",
};

/**
 * The chip on a contact. Discord is the accent because it is what almost every
 * row actually is; a phone number is the one worth spotting down the column, so
 * it gets the green.
 */
export const CONTACT_TONE: Record<ContactPlatform, string> = {
  discord: "border-line bg-ember text-flame-dark",
  insta: "border-line bg-shell text-ink-70",
  "phone #": "border-live-line bg-live-soft text-live",
};

// --------------------------------------------------------------- the board

/**
 * Which section a deal sits in.
 *
 * CPM is not a status, it is a pay model, and it deliberately outranks the
 * status when the two disagree. The board has always kept the cpm campaigns
 * together because "how it pays" is the question you are asking when you look at
 * one, not "how hard is it to get in" — a $3 cpm you can walk into and a $5 cpm
 * you cannot are the same kind of decision.
 */
export type Section = DealStatus | "cpm";

export const SECTION_ORDER: Section[] = [
  "instant",
  "comp",
  "v_comp",
  "cpm",
  "need_info",
  "paused",
];

export const SECTION_META: Record<Section, { label: string; chip: string; dot: string }> = {
  ...STATUS_META,
  cpm: { label: "cpm", chip: "border-line bg-shell text-ink-70", dot: "bg-ink-50" },
};

export function sectionOf(d: CampaignDeal): Section {
  return d.pay_model === "cpm" ? "cpm" : d.status;
}

/** Never-ranked rows float to the top, then hand rank, then name. */
export function byBoardOrder(a: CampaignDeal, b: CampaignDeal): number {
  const ra = a.sort_order ?? -1;
  const rb = b.sort_order ?? -1;
  return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
}

// ------------------------------------------------------------- formatting

/**
 * What the pay column reads.
 *
 * The free text wins whenever there is any, because it is what the board
 * actually says and it carries the ranges and qualifiers the number cannot
 * ("$20-$60 PV", "$3-$5 cpm only"). The structured amount is the fallback for a
 * row typed in through the form, and the sort key either way.
 */
export function payLabel(
  d: Pick<CampaignDeal, "base_pay" | "pay_amount" | "pay_model">
): string {
  if (d.base_pay.trim()) return d.base_pay.trim();
  if (d.pay_amount == null) return "";
  const n = Number(d.pay_amount);
  const amount = `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  return d.pay_model === "cpm"
    ? `${amount} CPM`
    : d.pay_model === "retainer"
      ? `${amount} MR`
      : `${amount} PV`;
}

export function postingLabel(
  d: Pick<CampaignDeal, "posting_freq" | "posting_unlimited" | "posting_per_day">
): string {
  if (d.posting_freq.trim()) return d.posting_freq.trim();
  if (d.posting_unlimited) return "unlimited";
  return d.posting_per_day != null ? `${d.posting_per_day}/day` : "";
}

/**
 * The pay badge a member sees: how a campaign pays, in three words or fewer.
 *
 * The model column is the primary answer, but half the boards write the cpm
 * into the free text ("$35 PV + $1 cpm"), so a cpm mention there upgrades a
 * base model to "base + cpm" rather than being lost.
 */
export function payBadge(d: Pick<CampaignDeal, "pay_model" | "base_pay">): string {
  if (d.pay_model === "cpm") return /base|\bpv\b|\/video/i.test(d.base_pay) ? "base + cpm" : "cpm";
  if (/cpm/i.test(d.base_pay)) return "base + cpm";
  if (d.pay_model === "retainer") return "retainer";
  return "base pay";
}

/** Sort key for pay. null sorts last in either direction. */
export function paySort(d: CampaignDeal): number | null {
  if (d.pay_amount != null) return Number(d.pay_amount);
  const m = d.base_pay.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Sort key for posting. unlimited is the most you can post, so it is the top. */
export function postingSort(d: CampaignDeal): number | null {
  if (d.posting_unlimited || /unlimited/i.test(d.posting_freq)) return Infinity;
  if (d.posting_per_day != null) return d.posting_per_day;
  const m = d.posting_freq.match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/**
 * "jul 21", or "jul 21 '25" once it is not this year.
 *
 * Split by hand rather than through `new Date`, which reads a bare yyyy-mm-dd as
 * utc midnight and then renders it in local time. West of greenwich that is the
 * evening before, so every date on the page would be a day early.
 */
export function shortDay(iso: string, today = new Date()): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const year = y === today.getFullYear() ? "" : ` '${String(y).slice(2)}`;
  return `${MONTHS[m - 1]} ${d}${year}`;
}

/** Local yyyy-mm-dd. `toISOString` would hand back utc and skip or repeat a day. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ------------------------------------------------------------- coercion

/**
 * Postgres hands `contacts` back as whatever json is in the column. Anything
 * that is not a {platform, value} pair with a known platform is dropped rather
 * than rendered, because these strings go straight into the page.
 */
export function toContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  const out: Contact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { platform, value } = item as Record<string, unknown>;
    if (typeof platform !== "string" || typeof value !== "string") continue;
    if (!(CONTACT_PLATFORMS as readonly string[]).includes(platform)) continue;
    const v = value.trim();
    if (v) out.push({ platform: platform as ContactPlatform, value: v });
  }
  return out;
}

/**
 * Split a bare url out of free text so notes can carry a working link.
 *
 * The board's notes hold scheme-less links ("lovable-ugc.lovable.app/#",
 * "mediamaxxing.com/"), so a plain `https?://` match would find none of them. A
 * token counts as a link when it has a dot with a letter after it and no space,
 * which is what a domain is and what a sentence is not.
 */
export function linkify(text: string): { text: string; href: string | null }[] {
  return text
    .split(/(\s+)/)
    .filter((p) => p !== "")
    .map((part) => {
      const bare = part.replace(/[.,;:)]+$/, "");
      const isLink =
        /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(bare) &&
        /\.[a-z]{2,}/i.test(bare);
      if (!isLink) return { text: part, href: null };
      return {
        text: part,
        href: bare.startsWith("http") ? bare : `https://${bare}`,
      };
    });
}
