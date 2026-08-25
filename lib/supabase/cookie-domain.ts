/**
 * The auth cookie's Domain attribute, or undefined for a host-only cookie.
 *
 * Tenants live on subdomains (klypr.ugcflows.com), and a session cookie scoped
 * to www.ugcflows.com never reaches them: signing in on the product and then
 * opening a tenant address would be two separate logins. Widening the cookie
 * to `.ugcflows.com` is what makes one sign-in cover the product and every
 * tenant under it.
 *
 * Every other host — localhost, *.localhost, vercel previews — keeps the
 * default host-only cookie. A Domain attribute the browser refuses to store
 * (public suffixes, mismatched hosts) silently drops the session, which is a
 * far worse failure than a tenant subdomain asking you to sign in again.
 *
 * Pure on purpose: the proxy imports this and must not pull in next/headers.
 */
export function authCookieDomain(
  host: string | null | undefined
): string | undefined {
  const name = (host ?? "").split(":")[0].toLowerCase();
  if (name === "ugcflows.com" || name.endsWith(".ugcflows.com")) {
    return ".ugcflows.com";
  }
  return undefined;
}

/**
 * The cookie-name prefix supabase writes this project's session under.
 *
 * supabase-js derives its storage key from the FIRST LABEL of the api
 * hostname: `sb-${hostname.split(".")[0]}-auth-token`. So the same project
 * reached through its custom auth domain and through its supabase.co address
 * writes two different cookie names — `sb-auth-*` for auth.ugcflows.com,
 * `sb-qtcwdvaoxrfojzaktwyg-*` for the default one.
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
