"use client";

import { useState } from "react";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/client";
import { SITE_URL } from "@/lib/site-url";

/**
 * The one door: google.
 *
 * This deploy has no self serve signup and no passwords. a person is either on
 * the creator empire roster (their google email holds a seat) or they are not,
 * and a password would only add a second thing to lose. the flow bounces
 * through /auth/callback with a pkce code, same as before.
 */
export function AuthForm({
  next = "/dashboard",
  initialError = "",
}: {
  next?: string;
  initialError?: string;
}) {
  // `next` is a redirect target a stranger typed into the url. the last check
  // belongs where the navigation happens.
  const dest = safeNext(next, "/dashboard");
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  async function onGoogle() {
    setError("");
    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // SITE_URL, never window.location.origin. in production this app is
        // served through a rewrite at www.ugcflows.com/creatorempire, so the
        // origin alone drops the prefix and supabase refuses a url that is not
        // on the allow list. SITE_URL already carries the path.
        redirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(dest)}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError(error.message);
      setPending(false);
    }
    // on success the browser is already navigating to google, leave it pending
  }

  return (
    <div className="mt-6">
      {/* one filled button, because there is exactly one way in. the G sits on
          its own white tile so it stays legible on the black. */}
      <button
        type="button"
        onClick={onGoogle}
        disabled={pending}
        className="flex h-11 w-full items-center justify-center gap-2.5 rounded-md bg-ink text-[13.5px] font-bold text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
      >
        <span className="flex size-[22px] items-center justify-center rounded-[4px] bg-white">
          <GoogleG />
        </span>
        {pending ? "opening google" : "continue with google"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-ink bg-shell px-3 py-2 text-[12.5px] leading-[1.5]"
        >
          {error}
        </p>
      )}

      <p className="mt-4 text-[11.5px] leading-[1.55] text-ink-50">
        no account is made here on its own.
      </p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 18 18" className="size-[14px]" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
