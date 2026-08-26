import Link from "next/link";
import { brand } from "@/lib/content";
import { Mark } from "./art";

/**
 * The header for signed-in pages.
 *
 * The only bar left outside the dashboard. It used to be one of a pair, held
 * pixel for pixel in step with the landing page's nav so walking from one to
 * the other did not feel like changing sites. There is no landing page now, so
 * there is nothing to stay in step with: the mark, the wordmark and sign out.
 */
export function AccountNav({ showDashboard = false }: { showDashboard?: boolean }) {
  return (
    <header className="relative z-30">
      <div className="mx-auto flex h-[58px] w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:h-[62px] sm:px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 text-[18px] font-extrabold tracking-[-0.02em] no-underline sm:text-[19px]"
        >
          <Mark className="size-8" />
          {/* same rule as the landing bar: the word drops under 380px and the
              mark carries the brand on its own */}
          <span className="hidden min-[380px]:inline">{brand.wordmark}</span>
        </Link>

        <nav className="flex items-center gap-5 sm:gap-7" aria-label="Account">
          {showDashboard && (
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-flame no-underline transition-colors hover:text-flame-dark"
            >
              Dashboard
            </Link>
          )}

          {/* a form, not a link. signing out is a state change and a GET that
              changes state gets fired by every link prefetcher there is. */}
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="flex min-h-[44px] items-center text-sm font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
