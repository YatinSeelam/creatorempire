import Link from "next/link";

/**
 * A slug that matches nothing, or matches a portfolio still in draft.
 *
 * Deliberately wearing Creator Empire's own chrome rather than a creator's
 * theme: there is no portfolio here, so there is no theme to read, and a
 * stranger who mistyped a handle should land somewhere that explains itself.
 */
export default function PortfolioNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
        404
      </p>

      <h1 className="mt-3 text-[clamp(1.6rem,5vw,2.2rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
        No portfolio here
      </h1>

      <p className="mt-3 max-w-[40ch] text-[15px] leading-[1.6] text-ink-50">
        The link is either wrong, or the creator has not published their page
        yet.
      </p>

      <Link
        href="/"
        className="mt-7 inline-flex items-center rounded-md bg-ink px-5 py-2.5 text-[14px] font-bold text-paper transition-colors hover:bg-ink/85"
      >
        Back to Creator Empire
      </Link>
    </main>
  );
}
