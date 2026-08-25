/**
 * Orgs: the white-label tenant layer.
 *
 * A brand or a mentorship runs a roster of creators and wants the tracker under
 * their own name. An org is those two things together — who is on the roster,
 * and what the app looks like to them.
 *
 * The membership half is in the database (`orgs`, `org_members`, `org_invites`
 * and the `*_org_read` policies beside every `own_rows`). This file is the shape
 * of it in the app, plus the whole of the theming, which is deliberately small:
 * one accent colour and a logo. See `themeVars` for why it is only one.
 */

/**
 * The whole white-label layer, off. Hidden rather than deleted, the same way
 * the editing market is: the tables, the policies, /agency, the invite flow and
 * the theming all stay exactly as they are and this one const is the switch.
 *
 * Everything reachable from outside reads it: the Roster row in
 * components/dash/side-nav.tsx, app/(dash)/agency via its layout, and
 * `loadBrand()` in lib/org-server.ts, which returns null while it is false so
 * no page pays for the lookup and no accent is ever overridden.
 *
 * A const rather than an env var on purpose: it is a product decision, not a
 * per-deploy one, and the dead branches drop out of the bundle.
 */
export const ORGS_ENABLED = true;

/**
 * The one workspace this deploy is. Every read is scoped to its books, the
 * gate is a seat on it, and the shell wears its paint. Set it on vercel to the
 * org's id in the shared supabase project (select id from orgs where slug =
 * 'creator-empire'). With it unset nothing is a member and the gate is closed,
 * which is the safe failure.
 */
export const CE_ORG_ID = (process.env.NEXT_PUBLIC_CE_ORG_ID ?? "").trim();

/**
 * The three seats a workspace hands out, and none of them is the platform's
 * "founder": that role is `admin_emails` (see lib/access.ts) and it sits above
 * every workspace. In here:
 *
 *   owner    the agency's own founder. one per workspace, pinned by trigger.
 *   admin    runs THIS workspace: roster, invites, modules. admin of exactly
 *            one workspace, and it grants nothing anywhere else. this is what
 *            "manager" was called until 2026-08-18; the value in the database
 *            is `admin` now too.
 *   creator  a seat. their own work under the agency's paint.
 */
export const ORG_ROLES = ["owner", "admin", "creator"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * The roles an invite can hand out. Owner is not one of them.
 *
 * `orgs.owner_id` is what every owner permission actually reads (branding,
 * the flow key, deleting the workspace: `orgs_update_owner`, `orgs_delete_owner`)
 * and an invite never moves it. So an "owner" seat handed out by invite was an
 * admin wearing the wrong label: the rail drew Branding for them and the
 * database refused every write on it. One owner per workspace, by construction,
 * and the `org_invites_role_check` constraint refuses it too.
 */
export const INVITE_ROLES = [
  "admin",
  "creator",
] as const satisfies readonly OrgRole[];

/**
 * Every column of `orgs` a session may read. `flow_api_key` is deliberately
 * absent: it is write-only (UPDATE granted, never SELECT), so a `select("*")`
 * anywhere in the app is a permission error waiting to happen — and before the
 * grants were tightened it was the key riding into the branding page's props.
 * Read `orgs` through this list and nothing else.
 */
export const ORG_COLS =
  "id, slug, name, logo_url, wordmark_url, favicon_url, accent_hex, accent_dark_hex, accent_soft_hex, rail_hex, features, support_email, custom_domain, flow_key_set_at, owner_id";

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  creator: "Student",
};

export const ROLE_NOTE: Record<OrgRole, string> = {
  owner: "Everything an admin can do, plus roles and removing people.",
  admin: "Runs the programme: students, invites and the numbers. Changes no deal.",
  creator: "A student. Works their deals inside the programme; their personal deals stay off these books.",
};

/** An admin's read is read-only by design, so this is the whole permission model. */
export function canManage(role: OrgRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canBrand(role: OrgRole | null): boolean {
  return role === "owner";
}

export type Org = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  wordmark_url: string | null;
  favicon_url: string | null;
  accent_hex: string | null;
  accent_dark_hex: string | null;
  accent_soft_hex: string | null;
  /** the rail's own colour. null derives it from the accent, as it always did. */
  rail_hex: string | null;
  /** `{ "<feature key>": false }`. absent means on. See ORG_FEATURES. */
  features: OrgFeatures | null;
  support_email: string | null;
  custom_domain: string | null;
  /**
   * When the agency's own Flow key was installed, or null for never.
   *
   * The readable half of a write-only column. `orgs.flow_api_key` is granted
   * UPDATE and never SELECT, so this stamp — set by a trigger, not by the app —
   * is the only way a screen can say whether a key is there.
   */
  flow_key_set_at: string | null;
  owner_id: string;
};

/** What the theming actually needs. Anon can read exactly these columns. */
export type OrgBrand = Pick<
  Org,
  | "id"
  | "slug"
  | "name"
  | "logo_url"
  | "wordmark_url"
  | "favicon_url"
  | "accent_hex"
  | "accent_dark_hex"
  | "accent_soft_hex"
  | "rail_hex"
  | "features"
  | "custom_domain"
>;

/** One module on an agency's own shelf. Shown to their roster at /modules. */
export type OrgModule = {
  id: string;
  org_id: string;
  title: string;
  blurb: string | null;
  video_url: string | null;
  link_url: string | null;
  body: string | null;
  position: number;
  published: boolean;
  created_at: string;
};

export type OrgMember = {
  user_id: string;
  role: OrgRole;
  joined_at: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
};

/** A roster line: one creator and the money coming off their deals. */
export type RosterRow = OrgMember & {
  deals: number;
  liveDeals: number;
  videos: number;
  views: number;
  earnedCents: number;
  owedCents: number;
  lastPostedAt: string | null;
};

/** One deal on the org's books: whose it is, what it is, what it has done. */
export type OrgDealRow = {
  id: string;
  user_id: string;
  creatorName: string;
  brandName: string;
  /** resolved logo path, "" when the brand has none. */
  brandLogo: string;
  name: string;
  status: string;
  videos: number;
  views: number;
  earnedCents: number;
  owedCents: number;
  lastPostedAt: string | null;
  created_at: string;
};

export type OrgInvite = {
  id: string;
  email: string;
  role: OrgRole;
  token: string;
  expires_at: string;
  created_at: string;
  /** past `expires_at` at read time. `accept_org_invite` refuses these. */
  expired: boolean;
};

// ----------------------------------------------------------------- features

/**
 * What an agency is allowed to switch off for its roster.
 *
 * Stored as `{ key: false }` and nothing else — absent means on. That direction
 * is the whole design: a feature that ships next month is on for every existing
 * org without a backfill, and an org that never opened this screen has an empty
 * object rather than a snapshot of the product as it was the day they signed up.
 *
 * Dashboard and Settings are deliberately not in here. One is where every link
 * in the app eventually points and the other is where you change your password;
 * an agency that turned either off would be filing a support ticket the same
 * afternoon.
 */
export type OrgFeatures = Record<string, boolean>;

export type FeatureDef = {
  key: string;
  label: string;
  note: string;
  /** `nav` is a whole rail row, `tool` is one card inside /tools. */
  group: "nav" | "tool";
};

export const ORG_FEATURES: FeatureDef[] = [
  {
    key: "nav.flow",
    label: "Flow",
    note: "the ai assistant and its panel. off removes the rail row and the corner button.",
    group: "nav",
  },
  {
    // this used to hide a rail row. the row is gone and posting is a tab on the
    // deal, so the switch hides that tab instead. same meaning, same key: an
    // agency that already turned it off keeps the setting it chose.
    key: "nav.social",
    label: "Posting",
    note: "the composer and the queue on each deal. tracking views still works without it.",
    group: "nav",
  },
  {
    key: "nav.tools",
    label: "Tools",
    note: "the whole tools shelf. switch off single tools below instead if you only want some.",
    group: "nav",
  },
  {
    key: "nav.modules",
    label: "Modules",
    note: "your own training, the shelf you fill in on the modules page.",
    group: "nav",
  },
  {
    key: "nav.earn",
    label: "Earn",
    note: "the referral programme. most agencies turn this one off.",
    group: "nav",
  },
  {
    key: "nav.perks",
    label: "Perks",
    note: "the discounts shelf.",
    group: "nav",
  },
  {
    key: "tool.variations",
    label: "Variations",
    note: "hook and demo combinations, rendered out.",
    group: "tool",
  },
  {
    key: "tool.transcriber",
    label: "Transcriber",
    note: "a video link in, the script out.",
    group: "tool",
  },
  {
    key: "tool.account-emails",
    label: "Account Emails",
    note: "a fresh signup address per account, with the codes landing in the app.",
    group: "tool",
  },
  {
    key: "tool.profile-scraper",
    label: "Profile Scraper",
    note: "anyone's recent posts with the numbers attached.",
    group: "tool",
  },
  {
    key: "tool.autoposting",
    label: "Autoposting",
    note: "every posting account across every deal, in one list.",
    group: "tool",
  },
  {
    key: "tool.my-portfolio",
    label: "My Portfolio",
    note: "the public page a creator sends a brand.",
    group: "tool",
  },
];

/**
 * On unless the org said otherwise.
 *
 * Reading it this way rather than `features[key] === true` is what makes the
 * absent-means-on rule hold, and it is also why a null features column (an org
 * created before this shipped) behaves as "everything on" rather than
 * "everything off", which would blank the rail for every existing tenant.
 */
export function featureOn(
  features: OrgFeatures | null | undefined,
  key: string
): boolean {
  return features?.[key] !== false;
}

/** The tools grid's filter, keyed the same way the switches are. */
export function toolFeatureKey(slug: string): string {
  return `tool.${slug}`;
}

// ------------------------------------------------------------------ theming

/**
 * The product's own palette, and the fallback for every org that has not set
 * one. Kept in sync with the `@theme` block in app/globals.css by hand, because
 * a css custom property cannot be read back out at build time on the server.
 */
export const DEFAULT_ACCENT = "#ec5a29";

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Never interpolate an unvalidated string into a style attribute. */
export function isHex(value: string | null | undefined): value is string {
  return typeof value === "string" && HEX.test(value);
}

function toRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((n) =>
      Math.round(Math.min(255, Math.max(0, n)))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** Toward black. What a hover and a pressed state are made of. */
export function darken(hex: string, amount = 0.16): string {
  return toHex(
    toRgb(hex).map((n) => n * (1 - amount)) as [number, number, number]
  );
}

/** Toward white. The tint a pill or a callout sits on. */
export function lighten(hex: string, amount = 0.9): string {
  return toHex(
    toRgb(hex).map((n) => n + (255 - n) * amount) as [number, number, number]
  );
}

/**
 * White or near-black, whichever stays readable on the accent.
 *
 * An org will pick a yellow eventually, and every primary button in the product
 * is white text on the accent. Relative luminance decides it rather than a
 * guess, so a light brand colour flips the label to ink instead of shipping a
 * button nobody can read.
 */
export function onAccent(hex: string): string {
  const [r, g, b] = toRgb(hex).map((n) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#101010" : "#ffffff";
}

/**
 * The org's palette as the four custom properties the app already paints from.
 *
 * This is the entire theming surface and that is the point. Every accented
 * pixel in the product — the primary button, the rail's active pill, the owed
 * column, the focus ring — reads `--color-flame`, `--color-flame-dark` or
 * `--color-ember`, so overriding three values re-skins the whole app with no
 * per-component work and no second stylesheet to keep in step.
 *
 * Letting an org set the greys as well is the version of this feature that
 * always ships broken: paper, shell, ink and line are load bearing for contrast
 * against each other, and a tenant picking six colours picks at least one pair
 * that cannot be read. They get the accent and their logo, which is what a
 * white-label is actually recognised by.
 *
 * Returns `null` when the org has no accent, so the caller renders no style
 * attribute at all and the stylesheet's own values stand.
 */
export function themeVars(
  brand: Pick<
    Org,
    "accent_hex" | "accent_dark_hex" | "accent_soft_hex" | "rail_hex"
  > | null
): Record<string, string> | undefined {
  if (!brand || !isHex(brand.accent_hex)) return undefined;

  const accent = brand.accent_hex;
  const dark = isHex(brand.accent_dark_hex)
    ? brand.accent_dark_hex
    : darken(accent);
  const soft = isHex(brand.accent_soft_hex)
    ? brand.accent_soft_hex
    : lighten(accent);

  // the rail is a stronger tint than a card's ember, so it is derived from the
  // accent separately rather than reusing the soft one and going flat. Setting
  // `rail_hex` takes it over outright, which is the only way out of the failure
  // this had: an agency picking black got a 78%-lightened black, which is a
  // grey slab down the left of the app and reads as an unstyled page.
  const rail = isHex(brand.rail_hex) ? brand.rail_hex : lighten(accent, 0.78);
  const railLine = isHex(brand.rail_hex)
    ? darken(rail, 0.08)
    : lighten(accent, 0.62);

  return {
    "--color-flame": accent,
    "--color-flame-dark": dark,
    "--color-ember": soft,
    "--color-rail": rail,
    "--color-rail-line": railLine,
    "--color-glow": `${dark}4d`,
    // white text on a mid orange is fine and on a pale brand yellow is not.
    "--color-on-accent": onAccent(accent),
    // the rail carries the nav labels and the account row in the bottom left
    // corner, so a dark rail has to flip its own text the same way a button
    // does. Every rail-only colour in globals.css reads from these.
    ...railInk(rail),
  };
}

/**
 * The rail's own text colours, flipped off the rail rather than the accent.
 *
 * Two levels because the rail has two: a resting nav label and the name in the
 * account row are quiet, the hovered label and the workspace wordmark are not.
 * On a pale rail they stay the greys the stylesheet already ships; on a dark one
 * they go white at two opacities, because a flat white for both loses the
 * hierarchy that made the rail readable in the first place.
 */
function railInk(rail: string): Record<string, string> {
  const light = onAccent(rail) === "#ffffff";
  return {
    "--color-on-rail": light ? "#ffffffbf" : "#3d3b38",
    "--color-on-rail-strong": light ? "#ffffff" : "#101010",
    "--color-rail-hover": light ? "#ffffff26" : "#10101014",
  };
}

/**
 * The org a hostname belongs to: `acme.ugcflows.com` → `acme`.
 *
 * Returns null for the product's own hosts, so ugcflows.com and a preview
 * deployment never accidentally resolve to a tenant. A custom domain is not
 * handled here — it has no slug in it, so it is a table lookup.
 */
const OWN_HOSTS = new Set(["ugcflows.com", "www.ugcflows.com", "localhost"]);

/** The domain tenants are subdomains of. */
export const TENANT_ROOT = "ugcflows.com";

/** Where everything lives until a tenant has an address of its own. */
export const PRODUCT_HOST = "www.ugcflows.com";

/**
 * Whether `<slug>.ugcflows.com` actually answers in production.
 *
 * It does not yet: there is no `*.ugcflows.com` record at cloudflare and the
 * wildcard is not attached to the vercel project, so every address this file
 * built (`https://klypr.ugcflows.com/join/…`) resolved to nothing. An invite
 * link that does not open is worse than one on the product's own host, so
 * until this is true the tenant address falls back to PRODUCT_HOST everywhere
 * except a dev machine, where `<slug>.localhost` needs no dns at all.
 *
 * To flip it: cloudflare → dns → `*` CNAME `cname.vercel-dns.com` (dns only),
 * vercel → ugcflows project → domains → add `*.ugcflows.com`, then set this
 * true. `/join` and the accept flow work on either host either way; what the
 * flag changes is which host the links are minted on and whether the login
 * page wears the agency's paint on the way in.
 */
export const TENANT_SUBDOMAINS_LIVE = false;

export function slugFromHost(host: string | null): string | null {
  if (!host) return null;
  const name = host.split(":")[0].toLowerCase();
  if (OWN_HOSTS.has(name) || name.endsWith(".vercel.app")) return null;

  const parts = name.split(".");

  // `acme.localhost` is the dev equivalent, and it is not a hack: every current
  // browser resolves the whole .localhost tld to the loopback with no hosts file
  // and no dns. Without it there is no way to open a tenant on a dev machine at
  // all, which is what made the address on the branding page read as broken —
  // it was correct, and correct only on production.
  if (parts.length === 2 && parts[1] === "localhost") return parts[0];

  if (parts.length < 3) return null;
  if (!name.endsWith(`.${TENANT_ROOT}`)) return null;

  const slug = parts[0];
  return slug === "www" ? null : slug;
}

/**
 * The host an org's creators sign in on, for the environment this is running in.
 *
 * Derived from the host of the request asking rather than hardcoded, so the
 * address shown on the branding page is one that actually opens: `acme.localhost:3000`
 * in dev, `acme.ugcflows.com` in production. A custom domain wins over both,
 * because once it is set it IS the address.
 *
 * A preview deployment is the one case with no answer — you cannot put a
 * subdomain in front of a vercel preview host — so it falls back to production,
 * which is at least a real address rather than a dead one.
 */
export function tenantHost(
  org: { slug: string; custom_domain?: string | null },
  requestHost?: string | null
): string {
  if (org.custom_domain) return org.custom_domain;

  const raw = (requestHost ?? "").toLowerCase();
  const [name, port] = raw.split(":");

  if (name === "localhost" || name.endsWith(".localhost")) {
    return `${org.slug}.localhost${port ? `:${port}` : ""}`;
  }

  // see TENANT_SUBDOMAINS_LIVE: a subdomain nothing answers on is a dead link.
  if (!TENANT_SUBDOMAINS_LIVE) return PRODUCT_HOST;

  return `${org.slug}.${TENANT_ROOT}`;
}

/** Whether the address `tenantHost` gives back is the org's own, or ours. */
export function hasOwnHost(
  org: { custom_domain?: string | null },
  requestHost?: string | null
): boolean {
  if (org.custom_domain) return true;
  const name = (requestHost ?? "").toLowerCase().split(":")[0];
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  return TENANT_SUBDOMAINS_LIVE;
}

/** The same address as something you can click. */
export function tenantUrl(
  org: { slug: string; custom_domain?: string | null },
  requestHost?: string | null
): string {
  const host = tenantHost(org, requestHost);
  const scheme =
    host.startsWith("localhost") || host.includes(".localhost")
      ? "http"
      : "https";
  return `${scheme}://${host}`;
}

// --------------------------------------------------------------- addresses

/** Slugs end up in DNS and in other people's bookmarks, so they are strict. */
export function toSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Subdomains nobody may claim as a workspace address.
 *
 * A slug becomes `<slug>.ugcflows.com` the moment the wildcard resolves, so an
 * org named "www" would sit on the product's own front door and one named
 * "mail" or "api" would shadow infrastructure. Checked at create time rather
 * than in DNS, because by DNS time the row already exists. Lives here rather
 * than beside `createOrg` because /founder mints workspaces too, and two lists
 * is how one of them stops being checked.
 */
export const RESERVED_SLUGS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "founder",
  "auth",
  "mail",
  "email",
  "smtp",
  "imap",
  "ftp",
  "cdn",
  "static",
  "assets",
  "help",
  "docs",
  "blog",
  "status",
  "support",
  "billing",
  "pay",
  "stripe",
  "webhooks",
  "dev",
  "staging",
  "test",
  "preview",
  "vercel",
  "supabase",
  "dashboard",
  "login",
  "signup",
  "join",
  "ugcflows",
  // the b2b landing page these customers arrive through
  "mentorship",
  "mentorships",
]);

/**
 * Why a slug cannot be a workspace address, or null when it can. The same
 * three answers whoever is creating the workspace, so the owner and /founder
 * cannot disagree about what "taken" or "reserved" means.
 */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3)
    return "That name is too short to make a web address from.";
  if (RESERVED_SLUGS.has(slug))
    return `${slug}.${TENANT_ROOT} is reserved. Pick another address.`;
  return null;
}

/**
 * A custom domain we could plausibly serve, lowercased, or null for "clear it".
 * Returns a message when the value cannot be stored: our own hosts, because a
 * tenant naming `www.ugcflows.com` or another agency's subdomain as its domain
 * would win the host lookup for everyone arriving there; and anything that is
 * not shaped like a hostname, because a value with a scheme or a path in it is
 * a tenant that never resolves and nobody can see why.
 */
export function customDomainProblem(
  value: string
): { value: string | null } | { message: string } {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return { value: null };

  if (
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      host
    )
  ) {
    return {
      message:
        "A domain looks like app.example.com, nothing before or after it.",
    };
  }
  if (host === TENANT_ROOT || host.endsWith(`.${TENANT_ROOT}`)) {
    return {
      message: `${TENANT_ROOT} addresses are ours. Your subdomain is already yours without this.`,
    };
  }
  return { value: host };
}

/**
 * The agency section. One place, so links cannot drift.
 *
 * Three routes rather than one page, because they are three different jobs:
 * the numbers, the seats, and the paint. The version of this that stacked all
 * three onto /agency put an invite form and a colour picker underneath a
 * performance table, which is the sort of screen you scroll past rather than
 * use.
 */
export const AGENCY_HREF = "/agency";
export const AGENCY_PEOPLE_HREF = "/agency/people";
export const AGENCY_BRAND_HREF = "/agency/branding";
/** Where an agency writes its own training. The roster reads it at MODULES_HREF. */
export const AGENCY_MODULES_HREF = "/agency/modules";
export const MODULES_HREF = "/modules";

export function inviteLink(
  org: { slug: string; custom_domain?: string | null },
  token: string,
  requestHost?: string | null
): string {
  // /join lives OUTSIDE the member gate: an invitee has no seat until they
  // accept, and the old /agency/join path bounced them off the gate into the
  // pricing screen. the proxy forwards the old path for links already sent.
  //
  // minted on the agency's OWN address, so the whole journey — the invite,
  // the login it bounces through, the dashboard it lands on — happens under
  // the agency's name. the auth cookie is scoped to `.ugcflows.com`
  // (lib/supabase/cookie-domain.ts), which is what makes that one journey
  // instead of a second sign-in.
  return `${tenantUrl(org, requestHost)}/join/${token}`;
}
