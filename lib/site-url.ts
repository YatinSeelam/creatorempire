/**
 * The one public origin, read from everywhere that has to print an absolute
 * url: metadataBase, the sitemap, robots, canonical tags, json-ld.
 *
 * Order of truth: NEXT_PUBLIC_SITE_URL, else the production hostname vercel
 * injects, else localhost.
 *
 * The production fallback is the real domain: www.trycreatorempire.com, live
 * on 2026-08-28 and the address this product is known by. It was the vercel
 * host before that, and https://www.creatorempire.app before THAT, which never
 * resolved at all — the whole point of a fallback is to keep a deploy that
 * forgot the env var writing canonicals at the host that actually serves the
 * site, and naming a dead domain did the opposite.
 *
 * The vercel host still answers and is still a fine place to check a build. It
 * is not what goes in a canonical tag, an og:url or an email.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_ENV === "production"
    ? "https://www.trycreatorempire.com"
    : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
).replace(/\/+$/, "");

/** absolute url for a path, so json-ld and the sitemap never disagree. */
export function absoluteUrl(path = "/") {
  return path.startsWith("http") ? path : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
