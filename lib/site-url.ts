/**
 * The one public origin, read from everywhere that has to print an absolute
 * url: metadataBase, the sitemap, robots, canonical tags, json-ld.
 *
 * Order of truth: NEXT_PUBLIC_SITE_URL, else the production hostname vercel
 * injects, else localhost.
 *
 * The production fallback used to be https://www.creatorempire.app, which is a
 * domain that does not resolve — it is not pointed at this project and answers
 * nothing at all. The whole point of a fallback is to keep a deploy that forgot
 * the env var writing canonicals at the host that actually serves the site, and
 * naming a dead domain did the opposite. It is the vercel host now, which is
 * where this has been served from the whole time. Point it back at a real
 * domain the day one exists.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "production"
    ? "https://creatorempire.vercel.app"
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
).replace(/\/+$/, "");

/** absolute url for a path, so json-ld and the sitemap never disagree. */
export function absoluteUrl(path = "/") {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
