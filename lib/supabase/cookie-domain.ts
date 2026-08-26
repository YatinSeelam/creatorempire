import { SITE_URL } from "@/lib/site-url";

/**
 * Hosts a Domain attribute must never be set on.
 *
 * `vercel.app` is a public suffix: a cookie scoped to `.vercel.app` is refused
 * by every browser and the session vanishes with no error anywhere. This deploy
 * runs on a vercel host until a custom domain is attached, so the guard is not
 * hypothetical.
 */
const NEVER_WIDEN = new Set(["vercel.app", "localhost", "now.sh"]);

/** This deploy's own apex, from SITE_URL. "" when it is one nobody may widen to. */
function apex(): string {
  try {
    const host = new URL(SITE_URL).hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".") || NEVER_WIDEN.has(host)) return "";
    // `foo.vercel.app` reduces to `vercel.app`, which the set above catches.
    const suffix = host.split(".").slice(-2).join(".");
    if (NEVER_WIDEN.has(suffix)) return "";
    return host;
  } catch {
    return "";
  }
}

/**
 * The auth cookie's Domain attribute, or undefined for a host-only cookie.
 *
 * A session cookie scoped to `www.example.com` does not reach `example.com` or
 * any subdomain of it, so a deploy served on more than one host would ask for a
 * second login. Widening to `.<apex>` is what makes one sign-in cover them all.
 *
 * The apex is read off this deploy's own SITE_URL. It used to be the literal
 * `ugcflows.com`, which is a different product on a different project: the
 * branch never matched here, so the widening never happened and the comment
 * describing it was about somebody else's hosts.
 *
 * Everything else keeps the default host-only cookie. A Domain attribute the
 * browser refuses to store (public suffixes, mismatched hosts) silently drops
 * the session, which is a far worse failure than a second sign-in.
 *
 * Pure on purpose: the proxy imports this and must not pull in next/headers.
 */
export function authCookieDomain(
  host: string | null | undefined
): string | undefined {
  const name = (host ?? "").split(":")[0].toLowerCase();
  const root = apex();
  if (!root) return undefined;
  if (name === root || name.endsWith(`.${root}`)) return `.${root}`;
  return undefined;
}

/**
 * The cookie-name prefix supabase writes this project's session under.
 *
 * supabase-js derives its storage key from the FIRST LABEL of the api
 * hostname: `sb-${hostname.split(".")[0]}-auth-token`. So the same project
 * reached through its custom auth domain and through its supabase.co address
 * writes two different cookie names: `sb-auth-*` for a custom auth domain,
 * `sb-xgiifxrxmtyklwglpewb-*` for the default one.
 *
 * That is the whole reason this exists. Point a dev machine at one url, then
 * the other, and the browser is left holding a session cookie under a name
 * nothing will ever write to again. A stale `sb-*-auth-token` in the jar is
 * not inert: it is what stops the browser client writing the pkce code
 * verifier at all, which surfaces as "code verifier not found in storage" on
 * the google callback and reads on screen as "that sign-in did not finish in
 * this browser".
 *
 * Returns "" when the url is unreadable, which the caller treats as "purge
 * nothing" rather than "purge everything".
 */
export function authCookiePrefix(url: string | undefined): string {
  try {
    // the env value has been known to carry a trailing space.
    const host = new URL((url ?? "").trim()).hostname;
    const ref = host.split(".")[0];
    return ref ? `sb-${ref}-` : "";
  } catch {
    return "";
  }
}
