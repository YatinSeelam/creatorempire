/**
 * The portfolio document: one typed shape, one place.
 *
 * Everything that renders, saves, validates or (later) gets written by an AI
 * brain-dump pass reads this file. The rule is that no other module invents a
 * field name, a label, a length limit or a default — if it is not here, it does
 * not exist. That is what makes the AI pass tractable: hand a model
 * PORTFOLIO_FIELDS and it knows every slot it is allowed to fill, what each one
 * means and how long it can be.
 *
 * The whole thing is stored as one row in `public.portfolios` — scalars as
 * columns, the four lists as jsonb. A portfolio is edited as one document and
 * saved with one button, so one atomic upsert beats four child tables, and an
 * AI that returns a whole document can be validated and written in one shot.
 */

import { absoluteUrl, SITE_URL } from "@/lib/site-url";

/* ------------------------------------------------------------------ pieces */

/** Where a creator can be reached. `website` is here so the row renders the
 *  same way as the rest instead of needing its own branch in the template. */
export const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram", prefix: "@", url: (h: string) => `https://instagram.com/${h}` },
  { key: "tiktok", label: "TikTok", prefix: "@", url: (h: string) => `https://tiktok.com/@${h}` },
  { key: "youtube", label: "YouTube", prefix: "@", url: (h: string) => `https://youtube.com/@${h}` },
  { key: "x", label: "X", prefix: "@", url: (h: string) => `https://x.com/${h}` },
  { key: "linkedin", label: "LinkedIn", prefix: "in/", url: (h: string) => `https://linkedin.com/in/${h}` },
  { key: "website", label: "Website", prefix: "", url: (h: string) => (/^https?:\/\//.test(h) ? h : `https://${h}`) },
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]["key"];

export type PortfolioSocial = {
  platform: SocialPlatform;
  /** the handle only, no @ and no url. the platform supplies both. */
  handle: string;
};

export type PortfolioSkill = {
  id: string;
  /** "Videography", "Content strategy" */
  name: string;
  /** one line on what it means in practice. optional. */
  detail: string;
};

/** One clip on the public page. Capped at MAX_CLIPS — three strong pieces read
 *  better than a wall of average ones, and it keeps storage honest. */
export type PortfolioClip = {
  id: string;
  /** "Morning routine hook" */
  title: string;
  /** who it was for. free text, not a link to the client list. */
  brand: string;
  /** the one number worth saying. "412k views", "3.1% CTR", "" for none. */
  result: string;
  /** an uploaded mp4 in the portfolio bucket, or "". */
  videoUrl: string;
  /** a still, grabbed off the video's first frame at upload time, or "". */
  posterUrl: string;
  /** a tiktok / reel / drive link, for when the file itself is not uploaded. */
  linkUrl: string;
};

/** A brand the creator has worked with. `catalogKey` is set when it was picked
 *  out of the curated list, null when they added it themselves.
 *
 *  `color` is what makes "a brand we have never heard of" a one-tap add rather
 *  than a logo hunt: with no file, the tile draws the brand's initial on its
 *  colour, which reads as a mark instead of as a missing image. "" means pick
 *  one from the name. */
export type PortfolioClient = {
  id: string;
  name: string;
  logoUrl: string;
  color: string;
  catalogKey: string | null;
};

/**
 * The swatches a creator picks a brand's colour from, and the pool a brand with
 * no colour of its own falls into.
 *
 * Deliberately not the accent presets: those dress the page, these sit next to
 * each other in a row and have to stay apart from one another rather than from
 * the background.
 */
export const BRAND_COLORS = [
  "#101828", // ink
  "#b42318", // red
  "#c4320a", // orange
  "#b54708", // amber
  "#3f7008", // olive
  "#067647", // green
  "#0e7090", // cyan
  "#175cd3", // blue
  "#5925dc", // indigo
  "#c11574", // pink
] as const;

/**
 * The colour a brand's tile is drawn in.
 *
 * A chosen colour wins. Without one, the name picks the same swatch every time,
 * so a logo-less wall comes out as a set of distinct marks rather than a row of
 * identical grey squares, and it never changes under a creator who did not
 * touch it.
 */
export function brandColor(name: string, chosen?: string): string {
  if (chosen && HEX.test(chosen)) return chosen;
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return BRAND_COLORS[hash % BRAND_COLORS.length];
}

/* ------------------------------------------------------------------- theme */

/** One template, dressed differently. Everything a creator can change about
 *  how the page looks lives in these three values and nowhere else. */
export type PortfolioTheme = {
  /** hex, `#rrggbb`. the one colour the whole page keys off. */
  accent: string;
  font: FontKey;
  surface: SurfaceKey;
};

export const ACCENT_PRESETS = [
  "#ec5a29", // flame, the product's own
  "#c2410c", // rust
  "#b45309", // amber
  "#166534", // forest
  "#0f766e", // teal
  "#1d4ed8", // cobalt
  "#6d28d9", // violet
  "#be123c", // rose
  "#101010", // ink
] as const;

export const FONTS = [
  { key: "raleway", label: "Raleway", note: "Clean and neutral" },
  { key: "grotesk", label: "Space Grotesk", note: "Modern, a little technical" },
  { key: "serif", label: "Instrument Serif", note: "Editorial" },
  { key: "dm", label: "DM Sans", note: "Soft and friendly" },
] as const;

export type FontKey = (typeof FONTS)[number]["key"];

export const SURFACES = [
  { key: "paper", label: "White" },
  { key: "sand", label: "Warm" },
  { key: "ink", label: "Dark" },
] as const;

export type SurfaceKey = (typeof SURFACES)[number]["key"];

export const DEFAULT_THEME: PortfolioTheme = {
  accent: "#ec5a29",
  font: "raleway",
  surface: "paper",
};

/* -------------------------------------------------------------- the record */

export type Portfolio = {
  /* link */
  slug: string;
  published: boolean;

  /* profile */
  name: string;
  role: string;
  location: string;
  /** "Gen Z", "Millennial", "27". marketing managers ask for it constantly. */
  cohort: string;
  avatarUrl: string;

  /* about */
  about: string;
  background: string;
  skills: PortfolioSkill[];

  /* contact */
  email: string;
  phone: string;
  socials: PortfolioSocial[];

  /* work */
  clips: PortfolioClip[];
  clients: PortfolioClient[];

  /* call to action */
  ctaLabel: string;

  theme: PortfolioTheme;
};

export const MAX_CLIPS = 3;
export const MAX_CLIENTS = 12;
export const MAX_SKILLS = 6;
export const MAX_SOCIALS = SOCIAL_PLATFORMS.length;

/* ------------------------------------------------------------------ limits */

/**
 * Every text field's label, help text and ceiling, in one table.
 *
 * The form renders from it, the validator clamps to it, and the AI pass will be
 * handed it verbatim as the description of what it is allowed to write. A limit
 * changed here changes all three at once.
 */
export const PORTFOLIO_FIELDS = {
  name: { label: "Name", hint: "How brands should address you.", max: 40, placeholder: "Dave Fattizzo" },
  role: { label: "Headline", hint: "What you do, in one line.", max: 70, placeholder: "UGC creator and creative strategist" },
  location: { label: "Location", hint: "City and country. Brands filter on it for in-person shoots.", max: 40, placeholder: "Los Angeles, CA" },
  cohort: { label: "Age or generation", hint: "Tells a brand in one glance whether you match their audience.", max: 20, placeholder: "Gen Z" },
  about: { label: "About", hint: "Who you are, what you shoot, who you help. Two or three sentences.", max: 420, placeholder: "I make short-form that sells. Skincare, wellness and home, mostly." },
  background: { label: "Background", hint: "How you got here. Optional, and it earns its place when it is specific.", max: 420, placeholder: "Started on YouTube in 2015, moved into paid UGC in 2023." },
  email: { label: "Email", hint: "The address on the button. Nothing gets you booked without it.", max: 80, placeholder: "you@email.com" },
  phone: { label: "Phone", hint: "Optional. Only worth adding if you answer it.", max: 24, placeholder: "+1 555 019 2837" },
  ctaLabel: { label: "Button label", hint: "What the button on your page says.", max: 24, placeholder: "Work with me" },
  slug: { label: "Link", hint: "Your address. Letters, numbers and dashes.", max: 32, placeholder: "yourhandle" },
  clipTitle: { label: "Title", hint: "What the clip is.", max: 60, placeholder: "Morning routine hook" },
  clipBrand: { label: "Brand", hint: "Who it was for. Spec work counts, say so.", max: 40, placeholder: "Loop Skincare" },
  clipResult: { label: "Result", hint: "The one number worth saying.", max: 24, placeholder: "412k views" },
  clipLink: { label: "Link", hint: "TikTok, Reel or Drive link, if you would rather not upload.", max: 300, placeholder: "https://tiktok.com/..." },
  skillName: { label: "Skill", hint: "One capability.", max: 34, placeholder: "Content strategy" },
  skillDetail: { label: "Detail", hint: "What it means in practice.", max: 90, placeholder: "Plans that line up with what the brand sells" },
  clientName: { label: "Brand", hint: "The name as the brand writes it.", max: 40, placeholder: "Candle" },
  handle: { label: "Handle", hint: "Just the handle. We add the rest.", max: 40, placeholder: "yourhandle" },
} as const;

/* ---------------------------------------------------------------- defaults */

export function emptyPortfolio(seed?: {
  name?: string;
  email?: string;
  slug?: string;
}): Portfolio {
  return {
    slug: slugify(seed?.slug ?? seed?.name ?? ""),
    published: false,
    name: seed?.name ?? "",
    role: "",
    location: "",
    cohort: "",
    avatarUrl: "",
    about: "",
    background: "",
    skills: [],
    email: seed?.email ?? "",
    phone: "",
    socials: [],
    clips: [],
    clients: [],
    ctaLabel: "Work with me",
    theme: { ...DEFAULT_THEME },
  };
}

/* ------------------------------------------------------------------- slugs */

/**
 * Routes that already exist, plus the ones worth keeping free.
 *
 * The public portfolio lives at the root — `<this deploy>/yourhandle`, see
 * PORTFOLIO_DOMAIN below — because
 * that is the address people actually hand out. A static route always beats a
 * dynamic one in Next, so `/login` is safe either way, but a creator who claims
 * "login" would still get a page they can never reach, and one who claims "api"
 * would be confusing to support forever. Cheaper to refuse the name up front.
 */
export const RESERVED_SLUGS = new Set([
  "account", "admin", "admins", "founder", "api", "app", "assets", "auth", "billing",
  "blog", "calendar", "checkout", "contact", "dashboard", "docs", "help",
  "home", "images", "login", "logout", "me", "mentorship", "mentorships",
  "new", "next", "perks", "portfolio",
  "press", "pricing", "privacy", "public", "search", "settings", "sign-in",
  "sign-up", "signin", "signup", "social", "static", "support", "team", "terms",
  "tools", "ugc-mentorship", "www", "_next",
  // the marketing routes that ship as files under app/. a static segment beats
  // the dynamic one in next's matcher anyway, so this only stops a creator
  // claiming a link that would never resolve to their page.
  "editors", "e", "join", "r", "sitemap.xml", "robots.txt", "llms.txt", "og.png",
  // the rest of this deploy's own first segments. a route group adds no path
  // segment, so (dash)'s children and /<slug> are siblings.
  "agency", "deals", "editing", "notifications", "handoff", "review", "account",
  "auth", "scheduler",
]);

/** Whatever they type becomes a usable path segment as they type it. */
export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, PORTFOLIO_FIELDS.slug.max);
}

/** null when it is fine, otherwise the sentence to show under the field. */
export function slugProblem(slug: string): string | null {
  if (!slug) return "Pick a link before you publish.";
  if (slug.length < 3) return "A bit longer — three characters at least.";
  if (RESERVED_SLUGS.has(slug)) return "That one is taken by the site itself.";
  return null;
}

/**
 * The public address. One place, so the header link, the copy button, the
 * founder's people page and the page's own canonical tag can never drift apart.
 *
 * The host is READ rather than typed. It was typed once, as
 * `creatorempire.app`, and went stale: that domain is not pointed at this
 * project and resolves to nothing, while the deploy has been served from
 * creatorempire.vercel.app the whole time. So every creator was handed an
 * address that answers nothing, on the one screen whose entire job is to print
 * an address somebody can open.
 *
 * SITE_URL is the same value `metadataBase` is built from in app/layout.tsx, so
 * the address printed on a portfolio and the canonical tag on that portfolio
 * now come from one place by construction rather than by two people
 * remembering.
 *
 * NEXT_PUBLIC_SITE_URL is load bearing here: this module is imported by the
 * editor, which is a client component, and the VERCEL_* fallbacks inside
 * site-url only exist on the server. The env var is set on the deploy, so the
 * browser is handed the real host rather than the localhost fallback.
 */
export const PORTFOLIO_DOMAIN = SITE_URL.replace(/^https?:\/\//, "");

export function portfolioUrl(slug: string, domain = PORTFOLIO_DOMAIN) {
  return `${domain}/${slug || "yourhandle"}`;
}

/**
 * The same address with a scheme on it, for an href or the clipboard.
 *
 * Callers used to write `https://${portfolioUrl(slug)}` by hand, which is a
 * second place the address gets assembled and is wrong in development, where
 * the origin is http and on a port.
 */
export function portfolioHref(slug: string) {
  return absoluteUrl(`/${slug || "yourhandle"}`);
}

/* -------------------------------------------------------------- validation */

/** ids only have to be unique inside their own short list. */
export function rowId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * A url that is safe to put in an `href`, or "".
 *
 * `clip.linkUrl` is free text that ends up as the `href` of an anchor on a
 * public page, so `javascript:alert(1)` typed into the editor would be a stored
 * XSS on the creator's own portfolio. Nothing in this product needs a scheme
 * other than http and https here, so the allowlist is those two and everything
 * else becomes empty — which the template already handles, since a clip with no
 * link renders as a tile rather than a link.
 */
const href = (v: unknown, max: number) => {
  const value = str(v, max);
  return /^https?:\/\//i.test(value) ? value : "";
};

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Coerce anything — a database row, a form post, a model's JSON — into a
 * Portfolio with every field present and every limit respected.
 *
 * Never throws. A field it cannot read comes back empty rather than taking the
 * whole document down with it, because half a saved portfolio is worth more to
 * a creator than a failed save, and the AI pass will hand this function some
 * genuinely strange input.
 */
export function normalizePortfolio(input: unknown, seed?: { name?: string; email?: string }): Portfolio {
  const raw = (input ?? {}) as Record<string, unknown>;
  const F = PORTFOLIO_FIELDS;
  const base = emptyPortfolio(seed);

  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const row = (v: unknown) => (v ?? {}) as Record<string, unknown>;

  const theme = row(raw.theme);
  const accent = typeof theme.accent === "string" && HEX.test(theme.accent) ? theme.accent : DEFAULT_THEME.accent;
  const font = FONTS.some((f) => f.key === theme.font) ? (theme.font as FontKey) : DEFAULT_THEME.font;
  const surface = SURFACES.some((s) => s.key === theme.surface) ? (theme.surface as SurfaceKey) : DEFAULT_THEME.surface;

  const seen = new Set<string>();

  return {
    slug: slugify(str(raw.slug, F.slug.max)) || base.slug,
    published: raw.published === true,

    name: str(raw.name, F.name.max) || base.name,
    role: str(raw.role, F.role.max),
    location: str(raw.location, F.location.max),
    cohort: str(raw.cohort, F.cohort.max),
    avatarUrl: href(raw.avatarUrl, 500),

    about: str(raw.about, F.about.max),
    background: str(raw.background, F.background.max),
    skills: list(raw.skills)
      .map((s) => {
        const r = row(s);
        return {
          id: str(r.id, 40) || rowId("sk"),
          name: str(r.name, F.skillName.max),
          detail: str(r.detail, F.skillDetail.max),
        };
      })
      .filter((s) => s.name)
      .slice(0, MAX_SKILLS),

    email: str(raw.email, F.email.max) || base.email,
    phone: str(raw.phone, F.phone.max),
    socials: list(raw.socials)
      .map((s) => {
        const r = row(s);
        return {
          platform: r.platform as SocialPlatform,
          // people paste "@name" and full urls into these. take the handle.
          handle: str(r.handle, F.handle.max).replace(/^@+/, "").replace(/\/+$/, ""),
        };
      })
      // one row per platform. two instagrams is always a mistake.
      .filter((s) => {
        if (!s.handle) return false;
        if (!SOCIAL_PLATFORMS.some((p) => p.key === s.platform)) return false;
        if (seen.has(s.platform)) return false;
        seen.add(s.platform);
        return true;
      })
      .slice(0, MAX_SOCIALS),

    clips: list(raw.clips)
      .map((c) => {
        const r = row(c);
        return {
          id: str(r.id, 40) || rowId("cl"),
          title: str(r.title, F.clipTitle.max),
          brand: str(r.brand, F.clipBrand.max),
          result: str(r.result, F.clipResult.max),
          // all three become an href or a src on a public page, so all three
          // go through the scheme allowlist rather than only the obvious one
          videoUrl: href(r.videoUrl, 500),
          posterUrl: href(r.posterUrl, 500),
          linkUrl: href(r.linkUrl, F.clipLink.max),
        };
      })
      .slice(0, MAX_CLIPS),

    clients: list(raw.clients)
      .map((c) => {
        const r = row(c);
        return {
          id: str(r.id, 40) || rowId("cb"),
          name: str(r.name, F.clientName.max),
          logoUrl: str(r.logoUrl, 500),
          // "" rather than a default, so the tile can tell "they picked ink"
          // from "nobody picked anything" and hash the name for the second one
          color: HEX.test(str(r.color, 7)) ? str(r.color, 7) : "",
          catalogKey: typeof r.catalogKey === "string" ? str(r.catalogKey, 60) || null : null,
        };
      })
      .filter((c) => c.name)
      .slice(0, MAX_CLIENTS),

    ctaLabel: str(raw.ctaLabel, F.ctaLabel.max) || base.ctaLabel,
    theme: { accent, font, surface },
  };
}

/**
 * What a portfolio is still missing, in the order it is worth fixing.
 *
 * Drives the readiness meter in the editor and the guard on the publish toggle.
 * A page with no name and no way to contact anyone is not a portfolio, so those
 * two are required; the rest is advice.
 */
export function portfolioGaps(p: Portfolio): { required: string[]; suggested: string[] } {
  const required: string[] = [];
  const suggested: string[] = [];

  if (!p.name.trim()) required.push("Add your name");
  if (!p.email.trim()) required.push("Add an email brands can reach you at");
  if (slugProblem(p.slug)) required.push("Pick a link for your page");

  if (!p.avatarUrl) suggested.push("Add a photo of yourself");
  if (!p.role.trim()) suggested.push("Write a headline");
  if (!p.about.trim()) suggested.push("Write your about section");
  if (p.clips.length === 0) suggested.push("Add at least one clip");
  if (p.clients.length === 0) suggested.push("Add a brand you have worked with");
  if (p.socials.length === 0) suggested.push("Link a social account");

  return { required, suggested };
}

/** 0 to 100, for the meter. Required items are worth more than nice-to-haves. */
export function portfolioScore(p: Portfolio) {
  const { required, suggested } = portfolioGaps(p);
  const done = (3 - required.length) * 2 + (6 - suggested.length);
  return Math.max(0, Math.round((done / 12) * 100));
}

/* --------------------------------------------------------------- db bridge */

/** The row shape in `public.portfolios`. snake_case, one to one with the
 *  columns, so neither side has to guess what the other calls a field. */
export type PortfolioRow = {
  user_id: string;
  slug: string;
  published: boolean;
  name: string | null;
  role: string | null;
  location: string | null;
  cohort: string | null;
  avatar_url: string | null;
  about: string | null;
  background: string | null;
  email: string | null;
  phone: string | null;
  cta_label: string | null;
  skills: unknown;
  socials: unknown;
  clips: unknown;
  clients: unknown;
  theme: unknown;
};

export function fromRow(row: PortfolioRow, seed?: { name?: string; email?: string }): Portfolio {
  return normalizePortfolio(
    {
      slug: row.slug,
      published: row.published,
      name: row.name,
      role: row.role,
      location: row.location,
      cohort: row.cohort,
      avatarUrl: row.avatar_url,
      about: row.about,
      background: row.background,
      email: row.email,
      phone: row.phone,
      ctaLabel: row.cta_label,
      skills: row.skills,
      socials: row.socials,
      clips: row.clips,
      clients: row.clients,
      theme: row.theme,
    },
    seed
  );
}

export function toRow(p: Portfolio, userId: string): PortfolioRow {
  return {
    user_id: userId,
    slug: p.slug,
    published: p.published,
    name: p.name,
    role: p.role,
    location: p.location,
    cohort: p.cohort,
    avatar_url: p.avatarUrl,
    about: p.about,
    background: p.background,
    email: p.email,
    phone: p.phone,
    cta_label: p.ctaLabel,
    skills: p.skills,
    socials: p.socials,
    clips: p.clips,
    clients: p.clients,
    theme: p.theme,
  };
}
