import Link from "next/link";
import { brand, type LegalDoc } from "@/lib/content";

/**
 * The shell both legal pages render through. They are the same page with
 * different words, so the layout lives here once and the pages stay dumb.
 *
 * It used to sit inside the marketing nav and footer. Those went with the
 * landing page: the footer's links were Pricing, Reviews, FAQ and two
 * mentorship pages, none of which exist on this deploy, and a legal page whose
 * every navigation option is a 404 is worse than one with none. What is left is
 * the mark, the words, and one way back into the app.
 *
 * Prose is capped at ~68ch. Legal text is read line by line, not scanned, and a
 * full-width paragraph of it is unreadable.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className="min-h-dvh bg-shell">
      <div className="mx-auto w-full max-w-[68ch] px-5 py-12">
        <Link
          href="/"
          className="flex w-fit items-center gap-2 text-[14px] font-bold tracking-[-0.01em]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="size-6 rounded-md object-cover" />
          {brand.wordmark}
        </Link>

        <header className="mt-10 border-b border-line pb-8">
          <h1 className="text-[clamp(1.7rem,4vw,2.3rem)] font-extrabold leading-[1.1] tracking-[-0.035em]">
            {doc.title}
          </h1>
          <p className="mt-3 text-[13px] text-ink-50">last updated {doc.updated}</p>
        </header>

        <div className="divide-y divide-line">
          {doc.sections.map((section) => (
            <section key={section.heading} className="py-8">
              <h2 className="text-[17px] font-bold tracking-[-0.02em]">{section.heading}</h2>
              <div className="mt-4 space-y-4">
                {section.body.map((paragraph, i) => (
                  <p key={i} className="text-[15px] leading-[1.7] text-ink-70">
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <Link
          href="/dashboard"
          className="mt-10 inline-flex h-8 items-center rounded-md bg-ink px-4 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink/85"
        >
          back to the app
        </Link>
      </div>
    </div>
  );
}
