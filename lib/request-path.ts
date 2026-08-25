import { headers } from "next/headers";

/**
 * The url the current request is rendering, handed forward by the proxy.
 *
 * App router gives a server component no way to ask what path it is on, and
 * `loadWorkspace()` genuinely needs one: typing /agency has to switch the rail
 * into that agency the same way the picker does, or the page says "Vanguard
 * Media" while the nav beside it is still the creator account and the picker is
 * still ticking "Creator account".
 *
 * The name is written out at BOTH ends rather than imported across, because the
 * two ends run in different worlds: importing the proxy from a server component
 * would drag `next/server` and a supabase ssr client into every page's module
 * graph, and importing this file from the proxy would drag `next/headers` into
 * middleware that runs on every request. Same trade the proxy already makes for
 * REF_COOKIE. Change one, change the other.
 */
export const PATH_HEADER = "x-pathname";

/**
 * Empty string when the header is missing, which is the honest answer rather
 * than a guess. The proxy's matcher skips static assets, and a route reached
 * some other way (a direct render in a test, a future runtime that does not run
 * middleware) simply gets "no path" and falls back to cookie behaviour.
 */
export async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "";
}
