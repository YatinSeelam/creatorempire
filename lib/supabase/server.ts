import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { authCookieDomain } from "@/lib/supabase/cookie-domain";

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Server components can't write cookies, so the `setAll` throw is swallowed —
 * the proxy is what actually refreshes and persists the token.
 *
 * `adminView` opts the request into the `*_admin_read` policies, which are
 * otherwise inert. Do not pass it from anything a creator sees: the product
 * reads through this client and never filters `user_id` itself, so a page that
 * carries the header shows every creator's rows rather than the signed-in
 * one's. Use `requireFounderView()` instead of setting it by hand.
 *
 * `orgView` is the same mechanism for the white-label roster: it opts into the
 * `*_org_read` policies, which widen the read from "my rows" to "my rows plus
 * every row belonging to a member of an org I manage". Same warning applies and
 * for the same reason — a coach who also runs their own deals would find the
 * roster's brands mixed into their own /deals list. Only /agency passes it, via
 * `requireOrgView()`.
 */
export async function createClient({ adminView = false, orgView = false } = {}) {
  const [cookieStore, hdrs] = await Promise.all([cookies(), headers()]);

  // the actions that write a session themselves (the auth callback's code
  // exchange, view-as) must scope it the same way the proxy does, or the swap
  // writes a host-only cookie next to the domain-wide one and the two fight.
  const domain = authCookieDomain(hdrs.get("host"));

  const extraHeaders: Record<string, string> = {};
  if (adminView) extraHeaders["x-admin-view"] = "1";
  if (orgView) extraHeaders["x-org-view"] = "1";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(Object.keys(extraHeaders).length > 0
        ? { global: { headers: extraHeaders } }
        : {}),
      ...(domain ? { cookieOptions: { domain } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a server component. safe to ignore, the proxy
            // already refreshed the session for this request.
          }
        },
      },
    }
  );
}
