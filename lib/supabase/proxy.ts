import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { slugFromHost } from "@/lib/org";
import { authCookieDomain, authCookiePrefix } from "@/lib/supabase/cookie-domain";

/**
 * Kept in step with PATH_HEADER in lib/request-path.ts, and written out rather
 * than imported for the same reason REF_COOKIE below is: that module reaches
 * for `next/headers`, which has no business being pulled into a proxy that runs
 * on every single request.
 */
const PATH_HEADER = "x-pathname";

/**
 * Routes that require a signed-in user. Everything else is public.
 *
 * This only checks that somebody is logged in. Being entitled to the tracker
 * is a second question, asked in app/(dash)/layout.tsx by `requireViewer()`
 * where a database round trip is affordable: admin, or a paid subscription, or
 * a seat on an org. /founder is narrower again and gates itself.
 *
 * `/agency` and `/flow` are here because they live under (dash) too. A path
 * missing from this list is not open — the layout still turns a stranger away —
 * but it is turned away one render later and without the `?next=` that brings
 * them back to where they were going.
 *
 * `/editing` and `/editors` are deliberately absent while EDITING_ENABLED in
 * lib/editing.ts is false: their layouts 404 before doing anything, and a
 * protected entry would bounce a stranger to a login page for a group that is
 * not there, which is louder than the 404. Put both back when the flag flips.
 * The flag is not imported here because this runs on every single request.
 */
const PROTECTED = [
  "/account",
  "/dashboard",
  "/deals",
  "/social",
  "/tools",
  "/portfolio",
  "/settings",
  "/agency",
  "/flow",
  "/founder",
  "/join",
  "/editing",
  "/notifications",
];

/**
 * Refreshes the auth token on every request and writes it back to both the
 * request (so server components see it) and the response (so the browser
 * replaces the old one).
 */
/**
 * The request's own path, handed forward to the server components.
 *
 * App router gives a server component no way to ask what url it is rendering,
 * and `loadWorkspace()` genuinely needs it: typing /agency has to switch the
 * rail into that agency the same way the picker does, or the page renders
 * "Vanguard Media" with the creator account's nav beside it. `lib/request-path`
 * is the other end, and owns the header's name.
 *
 * Snapshotted at call time rather than once at the top, because the supabase
 * cookie handler mutates `request.cookies` before rebuilding the response and
 * a `Headers` copy taken before that would carry the OLD auth cookie forward,
 * which is a random-logout bug of exactly the kind the warning below is about.
 */
function forward(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  return headers;
}

/**
 * The pages where signing in starts or lands. On these the purge below runs
 * for every `sb-*` cookie the request carries, not only duplicated ones.
 */
const AUTH_ENTRY = ["/login", "/sign-up", "/join", "/auth"];

/**
 * Stale host-only session cookies, and why the proxy deletes them.
 *
 * The auth cookies were widened from host-only (`www.creatorempire.app`) to
 * `.creatorempire.app` so one sign-in covers the product and every tenant
 * subdomain. A browser that signed in before that still holds the host-only
 * copies, and nothing ever removes them: a Set-Cookie with a Domain attribute
 * is a different cookie from one without, so every refresh, sign-out and
 * removal the app has done since only ever touched the domain-wide one.
 *
 * Two real failures come out of that, both seen in production on 2026-08-18:
 *
 *   1. "PKCE code verifier not found in storage" on the google callback. With
 *      a stale host-only `sb-<ref>-auth-token` in the jar, the browser client
 *      on /login never writes the code-verifier cookie at all (reproduced
 *      against www with playwright: stale token present, no verifier written;
 *      jar clean, verifier written), so the callback has nothing to exchange.
 *   2. `refresh_token_already_used` / "possible abuse attempt" storms in the
 *      auth logs. Both copies ride on every request; whichever side reads the
 *      old one refreshes with a refresh token that has already been rotated,
 *      gotrue treats that as reuse and revokes the whole session family, and
 *      the person is signed out for no reason they can see.
 *
 * The fix is a host-only deletion: `Set-Cookie: <name>=; Max-Age=0; Path=/`
 * with NO Domain attribute deletes exactly the host-only cookie and leaves the
 * `.creatorempire.app` one alone. Safe to send when there is nothing to delete.
 * Only on hosts where the app writes domain-wide cookies (`authCookieDomain`
 * returns one), because on localhost and previews host-only IS the real
 * session and deleting it would sign everybody out on every request.
 *
 * When: on the auth entry pages for every `sb-*` name the request carries
 * (the person is signing in, a host-only session there is stale by
 * definition, and the login page has to be clean BEFORE the google click
 * writes the verifier); everywhere else only for a name that appears twice in
 * the Cookie header, which is the one observable sign of a host-only copy
 * sitting next to the domain-wide one. Nothing on production writes host-only
 * `sb-*` cookies any more, so a duplicate always means the older, host-only
 * one is the stale one.
 */
function purgeStaleHostOnlyCookies(
  request: NextRequest,
  response: NextResponse,
  domain: string | undefined,
  pathname: string
) {
  if (!domain) return;
  const raw = request.headers.get("cookie");
  if (!raw) return;

  const seen = new Map<string, number>();
  for (const part of raw.split(";")) {
    const name = part.slice(0, part.indexOf("=")).trim();
    if (name.startsWith("sb-")) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  if (seen.size === 0) return;

  const onAuthEntry = AUTH_ENTRY.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  for (const [name, count] of seen) {
    if (!onAuthEntry && count < 2) continue;
    // no `domain` on purpose: that is what makes this the host-only cookie.
    response.cookies.set({
      name,
      value: "",
      maxAge: 0,
      path: "/",
      secure: true,
      sameSite: "lax",
    });
  }
}

/**
 * `sb-*` cookies belonging to a DIFFERENT supabase api hostname than the one
 * this deploy is pointed at.
 *
 * supabase-js names its cookies after the first label of the api host, so the
 * same project reached at auth.creatorempire.app and at
 * qtcwdvaoxrfojzaktwyg.supabase.co writes `sb-auth-*` and
 * `sb-qtcwdvaoxrfojzaktwyg-*`. Move an environment between the two — which is
 * exactly what `.env` and `.env.local` disagreeing does on a dev machine — and
 * the browser keeps the old name forever, because nothing in the app ever
 * writes to it again to expire it.
 *
 * A leftover `sb-<other>-auth-token` is not harmless. It is the same failure
 * the host-only purge below was written for: with a stale auth token in the
 * jar, the browser client on /login never writes the pkce code verifier, and
 * the google callback comes back "code verifier not found in storage", which
 * the login page renders as "that sign-in did not finish in this browser".
 *
 * Unlike that purge this is safe on every host including localhost, and runs
 * on every request rather than only the auth pages: a cookie for another
 * project ref is never this deploy's session, whatever page it turns up on.
 * Deleted twice where a cookie domain applies, since a Set-Cookie with a
 * Domain attribute and one without are two different cookies.
 */
function purgeForeignRefCookies(
  request: NextRequest,
  response: NextResponse,
  domain: string | undefined
) {
  const prefix = authCookiePrefix(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!prefix) return;

  const raw = request.headers.get("cookie");
  if (!raw) return;

  const stale = new Set<string>();
  for (const part of raw.split(";")) {
    const name = part.slice(0, part.indexOf("=")).trim();
    if (name.startsWith("sb-") && !name.startsWith(prefix)) stale.add(name);
  }

  for (const name of stale) {
    response.cookies.set({ name, value: "", maxAge: 0, path: "/" });
    if (domain) response.cookies.set({ name, value: "", maxAge: 0, path: "/", domain });
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request: { headers: forward(request) } });

  // with fluid compute, never hoist this client into a module-level variable.
  // a new one per request.
  // one login for the product and every tenant subdomain. see cookie-domain.ts.
  const domain = authCookieDomain(request.headers.get("host"));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(domain ? { cookieOptions: { domain } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request: { headers: forward(request) },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  // do not put code between createServerClient and getClaims. anything in
  // between makes random logouts very hard to trace.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const { pathname } = request.nextUrl;

  // a tenant host's front door is the dashboard, not the product's marketing
  // page: acme.creatorempire.app belongs to klypr, and showing our landing page on
  // their address is the one thing a white label must never do. A stranger
  // bounces off the /dashboard entry below into /login, on the tenant host,
  // where the login paints the tenant's own name.
  // an auth code that landed on the front door instead of /auth/callback.
  // supabase only honours `emailRedirectTo` / `redirectTo` when the exact url
  // is on the project's redirect allow-list; anything else (a dev machine, a
  // tenant subdomain, a preview) falls back to the Site URL, which is `/`,
  // and the confirmation link that was pasted into the browser landed on the
  // marketing page with `?code=` in the bar and nobody signed in. Forwarding
  // it here means the door works whatever the allow-list says: the callback
  // swaps the code for a session and sends them on to /account.
  if (
    pathname === "/" &&
    (request.nextUrl.searchParams.has("code") ||
      request.nextUrl.searchParams.has("token_hash"))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    if (!url.searchParams.has("next")) url.searchParams.set("next", "/dashboard");
    return NextResponse.redirect(url);
  }

  if (pathname === "/" && slugFromHost(request.headers.get("host"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // invite links used to live under /agency/join, inside the member gate that
  // a fresh invitee cannot pass. the page moved to /join; mail already sent
  // still carries the old path, so it is forwarded rather than broken.
  if (pathname.startsWith("/agency/join/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace("/agency/join/", "/join/");
    return NextResponse.redirect(url);
  }

  // the back office moved from /admin to /founder on 2026-08-18: "admin" is an
  // agency's own workspace role now, and the product's role is founder. old
  // bookmarks and the usage alert email's link still say /admin, so they are
  // forwarded rather than 404'd. /admin itself is not in PROTECTED on purpose:
  // it never renders, it only redirects, and /founder is.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.replace(/^\/admin/, "/founder");
    return NextResponse.redirect(url, 308);
  }

  if (!user && PROTECTED.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  purgeForeignRefCookies(request, supabaseResponse, domain);
  purgeStaleHostOnlyCookies(request, supabaseResponse, domain, pathname);

  // return supabaseResponse as-is. building a fresh NextResponse here without
  // copying its cookies over desyncs the browser and kills the session.
  return supabaseResponse;
}
