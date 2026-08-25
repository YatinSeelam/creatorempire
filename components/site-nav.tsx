"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { brand, navLinks, pricing } from "@/lib/content";
import { Mark } from "./art";
import { ButtonLink } from "./ui";

/**
 * Quiet-until-hovered links, one semibold current item.
 *
 * The "Product" dropdown that used to hold five section anchors went with the
 * five sections. Three links fit the bar flat, and a menu that opens onto three
 * items charges a click for nothing. If the page ever grows past four sections
 * again, the dropdown is in git history rather than sitting here unused.
 *
 * `signedIn` comes from the server (lib/session.ts) rather than a browser
 * lookup, so the right pair of links is in the first paint instead of swapping
 * in after hydration. A session lasts until they press Sign out — the cookie
 * runs 400 days and the proxy renews the token on every request — so a member
 * who comes back to the marketing page is still signed in, and being asked to
 * sign in again is the bar lying to them.
 */
export function SiteNav({
  signedIn = false,
  links = navLinks,
  ctaLabel,
  ctaHref,
}: {
  signedIn?: boolean;
  /** the b2b page swaps these: a mentor wants the model and the price, not
   *  "Reviews". defaults to the creator page's three anchors. */
  links?: { href: string; label: string }[];
  /** and it swaps the button, because "Get Creator Empire" is the wrong ask on a
   *  page selling a white label deal. both fall back to the creator labels. */
  ctaLabel?: string;
  ctaHref?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The panel closes on the click that opened a destination, not in an effect
  // watching the path. Every link in it is a hash anchor on this same page, so
  // the path never changes and an effect keyed on it would leave the panel
  // sitting over the section it just scrolled to.

  const isCurrent = (href: string) =>
    !href.includes("#") && pathname.startsWith(href);

  return (
    // Transparent and in flow, not sticky. The landing page renders this inside
    // <Hero>, so the drafting grid runs behind it and the bar stops reading as
    // a separate white strip pasted above the hero. On the legal pages there is
    // no grid and transparent just means paper.
    <header className="relative z-30">
      <div className="mx-auto flex h-[58px] w-full max-w-[1440px] items-center justify-between gap-3 px-5 sm:h-[62px] sm:gap-4 sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-[18px] font-extrabold tracking-[-0.02em] no-underline sm:text-[19px]"
        >
          <Mark className="size-8" />
          {/* the word used to drop under 380px because mark + wordmark + cta +
              menu came to ~306px inside a 320px screen's 280px content box. the
              cta is gone from this bar on a phone (see below), so the name fits
              at every width now and the brand never shows up as a mark alone. */}
          {brand.wordmark}
        </Link>

        {/* the creator landing page passes none: its header is the wordmark,
            sign in and the one ask. the mentorship pages still pass their own,
            so the element is skipped rather than deleted. */}
        {links.length > 0 && (
          <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`py-2 text-sm no-underline transition-colors ${
                  isCurrent(l.href)
                    ? "font-semibold text-ink"
                    : "text-ink-70 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex shrink-0 items-center gap-2 sm:gap-5">
          {/* Signed out asks you to sign in; signed in offers the way out. Both
              sit in the same slot so the bar never grows a fourth control. */}
          {signedIn ? (
            <SignOutButton className="hidden text-sm font-semibold text-ink-70 transition-colors hover:text-ink sm:inline-block" />
          ) : (
            <Link
              href="/login"
              className="hidden text-sm font-semibold text-ink-70 no-underline transition-colors hover:text-ink sm:inline"
            >
              Sign in
            </Link>
          )}
          {/* Not on a phone. The promo bar is stuck to the top of the screen
              with the same button in it, and the hero's own button is a
              thumb-wide pill a scroll below: three of the same ask inside the
              first 250px, with this one wide enough to be the loudest thing in
              the bar. There is never a moment on mobile without a visible cta,
              so this bar gives its slot back to the brand. */}
          {/* hidden on a wrapper, not on the button: ButtonLink's base classes
              carry `inline-flex`, and two display utilities of the same
              specificity are resolved by stylesheet order, not class order —
              `hidden` passed in here silently loses to it. */}
          <span className="hidden sm:block">
            {/* /account, not /dashboard: the dashboard is staff only and bounces
                a paying member to /account?denied=1, which is a rude thing to
                do to somebody who clicked their own name. */}
            <ButtonLink
              href={signedIn ? "/account" : ctaHref || pricing.startUrl}
              size="sm"
              className="min-h-[44px]"
            >
              {signedIn ? "My account" : ctaLabel || brand.ctaLabel}
            </ButtonLink>
          </span>

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-label="Menu"
            className="flex size-10 items-center justify-center rounded-full text-ink-70 transition-colors hover:bg-shell hover:text-ink lg:hidden"
          >
            <Chevron open={mobileOpen} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="border-t border-line bg-paper px-5 py-3 lg:hidden"
          // one handler on the panel rather than one per link. every control in
          // here navigates, so any click inside it is a click that should
          // close it, including the sign-out form's submit button.
          onClick={() => setMobileOpen(false)}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block rounded-xl px-1 py-2.5 text-sm no-underline transition-colors ${
                isCurrent(l.href)
                  ? "font-semibold text-ink"
                  : "text-ink-70 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
          {signedIn ? (
            <div className="border-t border-line pb-2 pt-3">
              <Link
                href="/account"
                className="block px-1 pb-2.5 text-sm font-semibold text-ink no-underline"
              >
                My account
              </Link>
              <SignOutButton className="block px-1 text-sm font-semibold text-ink-70 transition-colors hover:text-ink" />
            </div>
          ) : (
            <Link
              href="/login"
              className="block border-t border-line px-1 pb-2 pt-3 text-sm font-semibold text-ink-70 no-underline transition-colors hover:text-ink"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

/**
 * Signing out is a state change, so it is a POST to /auth/sign-out and not a
 * link. A GET would let a prefetch, a link scanner or an <img> on someone
 * else's page end the session for them.
 *
 * text-left is load bearing on the mobile copy: a full width button centres its
 * label by default and would be the only row in that panel not flush left.
 */
function SignOutButton({ className = "" }: { className?: string }) {
  return (
    <form action="/auth/sign-out" method="post" className={className}>
      <button type="submit" className="w-full cursor-pointer text-left">
        Sign out
      </button>
    </form>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className={`size-3.5 transition-transform duration-200 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M19 9l-7 7-7-7"
      />
    </svg>
  );
}
