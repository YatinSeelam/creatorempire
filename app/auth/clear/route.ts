import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { BASE_PATH } from "@/lib/base-path";

/**
 * Recovery endpoint: nukes every Supabase auth cookie on each plausible
 * domain/path combination. Visit `/auth/clear` from any browser whose
 * `localhost` cookies got wedged by a redirect loop or an
 * `HTTP 431 Request Header Fields Too Large` error.
 *
 * localhost is shared with the other app in this repo, so two projects' worth
 * of chunked `sb-<ref>-auth-token.N` cookies pile up on the same origin. Once
 * the header is over Node's limit the request never reaches a route, which is
 * why the dev script also raises `--max-http-header-size`.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const nextRaw = url.searchParams.get("next");
  // Only same-origin paths. Otherwise a crafted recovery link with
  // `next=https://evil.com` would bounce the browser off-site.
  const next = safeNext(nextRaw, "/login");
  // safeNext hands back an app path with no prefix on it, and `url.origin` has
  // none either, so the base path goes on by hand or the recovery link bounces
  // to a page the rewrite does not serve.
  const res = NextResponse.redirect(new URL(`${BASE_PATH}${next}`, url.origin));

  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  const apex = host.startsWith("app.") ? host.slice(4) : host;

  const domains = Array.from(
    new Set(
      [undefined, host, `.${host}`, apex, `.${apex}`].filter(
        Boolean
      ) as string[]
    )
  );

  for (const cookie of req.cookies.getAll()) {
    const looksLikeAuth =
      cookie.name.startsWith("sb-") ||
      cookie.name.startsWith("supabase") ||
      cookie.name.includes("auth-token");
    if (!looksLikeAuth) continue;

    for (const domain of domains) {
      res.cookies.set(cookie.name, "", {
        path: "/",
        maxAge: 0,
        ...(domain ? { domain } : {}),
      });
    }
  }

  res.headers.set("Cache-Control", "no-store");
  return res;
}
