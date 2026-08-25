import type { MetadataRoute } from "next";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { EDITOR_HIRING_ENABLED, EDITOR_MARKET_ENABLED } from "@/lib/editing";
import { absoluteUrl } from "@/lib/site-url";

/**
 * /sitemap.xml. Two kinds of url in it:
 *
 *   1. the public pages, listed by hand. a route
 *      is only in here if a stranger is meant to land on it from google. the
 *      dashboard, /docs, /account, /join and the auth routes are all somebody's
 *      own desk and are kept out (and robots.ts disallows them as well).
 *   2. every published creator portfolio (ugcflows.com/<slug>) and every
 *      published editor page (/e/<handle>). those are the pages that actually
 *      earn links: a creator drops theirs in a bio, a brand searches the name.
 *      read through a plain anon client so RLS only surfaces `published` rows,
 *      the same rule the pages themselves apply.
 *
 * Any failure to read the tables collapses to "no dynamic urls" rather than a
 * 500: a sitemap that is missing rows is a smaller problem than one google
 * cannot fetch at all, and this file, like the portfolio route, can reach
 * production a few minutes before its schema.
 */

// google ignores <priority> and <changefreq> almost entirely, but bing and the
// smaller crawlers still read them, and they cost nothing.
const STATIC: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/editors", priority: 0.6, changeFrequency: "weekly" },
  { path: "/sign-up", priority: 0.5, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
];

function anon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createAnonClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function portfolioUrls(): Promise<MetadataRoute.Sitemap> {
  const supabase = anon();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("portfolios")
      .select("slug, updated_at")
      .eq("published", true)
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error || !data) return [];
    return data
      .filter((r) => typeof r.slug === "string" && r.slug.length >= 3)
      .map((r) => ({
        url: absoluteUrl(`/${r.slug}`),
        lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
        changeFrequency: "monthly" as const,
        priority: 0.5,
      }));
  } catch {
    return [];
  }
}

async function editorUrls(): Promise<MetadataRoute.Sitemap> {
  // the same gate the /e/<handle> route applies: with both flags off the page
  // 404s, so listing it would only hand google a dead url.
  if (!EDITOR_MARKET_ENABLED && !EDITOR_HIRING_ENABLED) return [];
  const supabase = anon();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("editors")
      .select("handle, updated_at")
      .eq("published", true)
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error || !data) return [];
    return data
      .filter((r) => typeof r.handle === "string" && r.handle.length > 0)
      .map((r) => ({
        url: absoluteUrl(`/e/${r.handle}`),
        lastModified: r.updated_at ? new Date(r.updated_at) : undefined,
        changeFrequency: "monthly" as const,
        priority: 0.4,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [portfolios, editors] = await Promise.all([portfolioUrls(), editorUrls()]);

  return [
    ...STATIC.map((s) => ({
      url: absoluteUrl(s.path),
      lastModified: now,
      changeFrequency: s.changeFrequency,
      priority: s.priority,
    })),
    ...portfolios,
    ...editors,
  ];
}
