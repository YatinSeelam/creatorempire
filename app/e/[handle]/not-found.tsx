import Link from "next/link";

/**
 * A handle that matches nothing, or an editor page still unpublished.
 * Same shape as the creator portfolio's 404: explain, then point home.
 */
export default function EditorNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-20 text-center">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
        404
      </p>

      <h1 className="mt-3 text-[clamp(1.6rem,5vw,2.2rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
        no editor here
      </h1>

      <p className="mt-3 max-w-[40ch] text-[15px] leading-[1.6] text-ink-50">
        the link is either wrong, or this editor has not published their page
        yet.
      </p>

      <Link
        href="/"
        className="mt-7 inline-flex items-center rounded-pill bg-ink px-5 py-2.5 text-[14px] font-bold text-on-accent transition-colors hover:bg-flame"
      >
        back to creator empire
      </Link>
    </main>
  );
}
