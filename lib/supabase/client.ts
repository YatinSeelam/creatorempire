import { createBrowserClient } from "@supabase/ssr";
import { authCookieDomain } from "@/lib/supabase/cookie-domain";

/** Supabase client for client components. Reads the session from cookies. */
export function createClient() {
  // scoped to `.ugcflows.com` on production hosts so the session a tenant
  // subdomain writes is the same one www reads, matching the proxy exactly.
  const domain =
    typeof window === "undefined"
      ? undefined
      : authCookieDomain(window.location.host);

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    domain ? { cookieOptions: { domain } } : {}
  );
}
