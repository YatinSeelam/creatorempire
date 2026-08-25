/**
 * The one public origin, read from everywhere that has to print an absolute
 * url: metadataBase, the sitemap, robots, canonical tags, json-ld.
 *
 * Order of truth: NEXT_PUBLIC_SITE_URL (set it in vercel to
 * https://www.creatorempire.app), else the production hostname vercel injects, else
 * localhost. `www` is canonical (see CLAUDE.md), and the fallback says so
 * rather than the bare apex, so a deploy that forgot the env var still writes
 * canonicals pointing at the host that actually serves the site.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "production"
    ? "https://www.creatorempire.app"
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
).replace(/\/+$/, "");

/** absolute url for a path, so json-ld and the sitemap never disagree. */
export function absoluteUrl(path = "/") {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
