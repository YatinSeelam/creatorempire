import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

/**
 * /robots.txt. Open by default: the marketing pages, every published portfolio
 * and every editor page are meant to be found, by google and by the ai
 * crawlers alike (chatgpt, perplexity and claude all answer "is X worth it"
 * questions now, and a creator asking one about a mentorship should get told
 * about the guarantee).
 *
 * What is closed is anybody's private desk. Those routes already carry
 * `robots: { index: false }` in their metadata, and the (dash) group bounces
 * a stranger to /login anyway, but a crawler that never fetches them is a
 * crawler that spends its budget on the pages we want ranked.
 *
 * `/r/` is the referral redirect: a 302 through to signup with a code, and a
 * crawled one would attach a click nobody made.
 */
const PRIVATE = [
  "/api/",
  "/auth/",
  "/account",
  "/founder",
  "/admin",
  "/agency",
  "/checkout",
  "/dashboard",
  "/deals",
  "/docs",
  "/earn",
  "/editing",
  "/editors/apply",
  "/editors/library",
  "/editors/market",
  "/editors/profile",
  "/editors/settings",
  "/editors/payouts",
  "/flow",
  "/join/",
  "/modules",
  "/new",
  "/perks",
  "/portfolio",
  "/r/",
  "/settings",
  "/social",
  "/tools",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/").replace(/\/$/, ""),
  };
}
