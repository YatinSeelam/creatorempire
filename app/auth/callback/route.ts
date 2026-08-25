import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext as sameOriginPath } from "@/lib/safe-next";

/**
 * Where google and the email confirmation link both land.
 *
 * Google (and the default confirm email) come back with `?code=`, which is the
 * pkce code we swap for a session. A magic-link style template instead sends
 * `token_hash` + `type`, so both are handled here rather than in two routes.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
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
      // behind vercel the host header is the internal one, so trust the
      // forwarded host in production only.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const base =
        process.env.NODE_ENV === "development" || !forwardedHost
          ? origin
          : `https://${forwardedHost}`;

      const response = NextResponse.redirect(`${base}${next}`);
      return response;
    }

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(friendly(error.message))}`
    );
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(
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
