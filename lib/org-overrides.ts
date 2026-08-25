/**
 * What a founder configured for one workspace that the product does not give
 * everybody. `org_overrides` is a key/value shelf per org, written only by a
 * founder (the platform role, `admin_emails`) and read by the workspace's own
 * members. Two kinds of key are wired today, and the third one an agency asks
 * for is a row here, not a migration:
 *
 *   tool.<slug>        true. the workspace has the custom tool `<slug>` from
 *                      `customTools` in lib/tools.ts. a real entitlement: the
 *                      shelf shows the card only to people seated on a granted
 *                      workspace, and the route 404s for everyone else.
 *   portfolio.footer   { label, url }. the public portfolio of every creator
 *                      seated on the workspace signs off with this instead of
 *                      the product's own mark.
 *   portfolio.badge    "acme creator". a small line under the creator's name
 *                      on the same page.
 *
 * Anything else a founder puts here is read by whatever they build to read
 * it: `overrideValue(overrides, key)` is the accessor, and the raw list on
 * /founder/agencies/<id> is where it is set.
 *
 * This file is the pure half (keys, parsers), safe in a client bundle. The
 * reads live in lib/org-overrides-server.ts: the member-side ones there use
 * the ordinary client and rls hands back the caller's own workspaces' rows;
 * the founder-side loaders that see every workspace are in lib/founder.ts
 * behind `requireFounderView()`.
 */

export type OrgOverride = {
  org_id: string;
  key: string;
  value: unknown;
  set_by: string | null;
  set_at: string;
};

export const TOOL_KEY_PREFIX = "tool.";
export const PORTFOLIO_FOOTER_KEY = "portfolio.footer";
export const PORTFOLIO_BADGE_KEY = "portfolio.badge";

export function toolKey(slug: string): string {
  return `${TOOL_KEY_PREFIX}${slug}`;
}

/** The slug out of a `tool.<slug>` key, or null for any other key. */
export function toolSlugFromKey(key: string): string | null {
  return key.startsWith(TOOL_KEY_PREFIX) ? key.slice(TOOL_KEY_PREFIX.length) : null;
}

/** Keys the founder page draws its own controls for. Everything else is "other". */
export function isKnownKey(key: string): boolean {
  return (
    key.startsWith(TOOL_KEY_PREFIX) ||
    key === PORTFOLIO_FOOTER_KEY ||
    key === PORTFOLIO_BADGE_KEY
  );
}

/** A tool grant is `true` and nothing else: a founder who typed "yes" has not granted it. */
export function isGranted(value: unknown): boolean {
  return value === true;
}

export type PortfolioFooter = { label: string; url: string };

/** `portfolio.footer` as a value the page can render, or null when it is not one. */
export function asPortfolioFooter(value: unknown): PortfolioFooter | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const label = typeof v.label === "string" ? v.label.trim() : "";
  const url = typeof v.url === "string" ? v.url.trim() : "";
  if (!label) return null;
  // http(s) only. a javascript: url in a footer link is a portfolio that
  // attacks the brand reading it.
  if (url && !/^https?:\/\//i.test(url)) return { label, url: "" };
  return { label, url };
}

/** `portfolio.badge` as one trimmed line, or null. */
export function asPortfolioBadge(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const line = value.trim().slice(0, 60);
  return line || null;
}

/** One value out of a list of rows. `undefined` when the key is not set. */
export function overrideValue(rows: OrgOverride[], key: string): unknown {
  return rows.find((r) => r.key === key)?.value;
}

/**
 * What a creator's public portfolio picks up from the workspace they sit on.
 * The shape `public.portfolio_agency_for(user)` returns, parsed. `null` when
 * the creator is on no workspace with portfolio setup, which is what makes the
 * page they had exactly the page they keep.
 */
export type PortfolioAgency = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  footer: PortfolioFooter | null;
  badge: string | null;
};

export function asPortfolioAgency(value: unknown): PortfolioAgency | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.name !== "string" || typeof v.slug !== "string") return null;
  const overrides =
    v.overrides && typeof v.overrides === "object" ? (v.overrides as Record<string, unknown>) : {};
  const footer = asPortfolioFooter(overrides[PORTFOLIO_FOOTER_KEY]);
  const badge = asPortfolioBadge(overrides[PORTFOLIO_BADGE_KEY]);
  if (!footer && !badge) return null;
  return {
    id: v.id,
    name: v.name,
    slug: v.slug,
    logoUrl: typeof v.logo_url === "string" ? v.logo_url : null,
    footer,
    badge,
  };
}
