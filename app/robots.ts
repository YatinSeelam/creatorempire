import type { MetadataRoute } from "next";

/**
 * /robots.txt. Closed, all of it.
 *
 * This deploy is one workspace behind a login. There is no marketing page, no
 * public portfolio and no signup, so there is no url here a crawler is meant to
 * reach — and the roster is not something to hand to a search index. It used to
 * be open with a list of private prefixes carved out, which was the right shape
 * for ugc flows and the wrong one for this.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
