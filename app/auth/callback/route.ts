import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimPendingInvite } from "@/lib/invite-claim";
import { safeNext as sameOriginPath } from "@/lib/safe-next";
import { SITE_URL } from "@/lib/site-url";

/**
 * Where google and the email confirmation link both land.
 *
 * Google (and the default confirm email) come back with `?code=`, which is the
 * pkce code we swap for a session. A magic-link style template instead sends
 * `token_hash` + `type`, so both are handled here rather than in two routes.
 *
 * Every redirect out of here is built on SITE_URL rather than the request's own
 * origin or `x-forwarded-host`. In production this app is served through a
 * rewrite on www.ugcflows.com, so both of those read as the internal vercel
 * host and would drop somebody who just signed in onto a url that is not the
 * one their session cookie was written for. SITE_URL carries the base path too,
 * so `${SITE_URL}/dashboard` is the whole answer and nothing here has to know
 * about the prefix. On localhost it is http://localhost:3000, which is what the
 * origin used to be anyway.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  // supabase forwards its own failures here rather than to an error page
  const providerError =
    searchParams.get("error_description") || searchParams.get("error");

  if (!providerError && (code || (tokenHash && type))) {
    const supabase = await createClient();

    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! });

    if (!error) {
      // a seat is claimed here, on the one request where a session has just
      // come into existence, so somebody the programme added lands on the
      // dashboard rather than on the "not on the roster" page. no-ops when
      // there is no invite waiting.
      await claimPendingInvite(supabase);

      const response = NextResponse.redirect(`${SITE_URL}${next}`);
      return response;
    }

    return NextResponse.redirect(
      `${SITE_URL}/login?error=${encodeURIComponent(friendly(error.message))}`
    );
  }

  return NextResponse.redirect(
    `${SITE_URL}/login?error=${encodeURIComponent(
      providerError || "That sign-in link is invalid or has expired."
    )}`
  );
}

/**
 * The one supabase error worth rewording. "PKCE code verifier not found in
 * storage" plus a paragraph about SSR frameworks is the message a creator saw
 * on the login page in production. It means the browser that finished the
 * flow did not have the cookie the browser that started it wrote: an email
 * link opened in another browser, or (the case that actually happened) a
 * stale host-only session cookie that stopped the verifier being written at
 * all. lib/supabase/proxy.ts now clears those on the login page, so "try
 * again from here" is true, and the email case has a password fallback.
 */
function friendly(message: string): string {
  if (/code verifier/i.test(message)) {
    return "That sign-in did not finish in this browser. Try again from here, and if you just confirmed your email, sign in with your password below.";
  }
  return message;
}

/** Only allow same-site paths through, an open redirect here is a real one. */
function safeNext(value: string | null) {
  return sameOriginPath(value, "/dashboard");
}
