import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";
import { Section } from "./section";
import type { LegalDoc } from "@/lib/content";
import { isSignedIn } from "@/lib/session";

/**
 * The shell both legal pages render through. They are the same page with
 * different words, so the layout lives here once and the pages stay dumb.
 *
 * Prose is capped at ~68ch instead of the 1120px the marketing bands use.
 * Legal text is read line by line, not scanned, and a full-width paragraph of
 * it is unreadable.
 */
export async function LegalPage({ doc }: { doc: LegalDoc }) {
  const signedIn = await isSignedIn();

  return (
    <>
      <SiteNav signedIn={signedIn} />
      <main>
        <Section>
          <div className="mx-auto w-full max-w-[68ch]">
            <header className="border-b border-line pb-8">
              <h1 className="text-balance-tight text-[clamp(1.9rem,4vw,2.6rem)] font-extrabold leading-[1.1] tracking-[-0.035em]">
                {doc.title}
              </h1>
              <p className="mt-3 text-[14px] text-ink-50">
                Last updated {doc.updated}
              </p>
            </header>

            <div className="divide-y divide-line">
              {doc.sections.map((section) => (
                <section key={section.heading} className="py-8">
                  <h2 className="text-[18px] font-bold tracking-[-0.02em] sm:text-[19px]">
                    {section.heading}
                  </h2>
                  <div className="mt-4 space-y-4">
                    {section.body.map((paragraph, i) => (
                      <p
                        key={i}
                        className="text-[15.5px] leading-[1.7] text-ink-70"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
