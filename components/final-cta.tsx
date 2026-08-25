import { finalCta, pricing } from "@/lib/content";
import { CheckMark } from "./art";
import { Section } from "./section";
import { Arrow } from "./ui";

/**
 * The last band. It exists because otherwise the page ends on the faq, and a
 * page that ends on an unanswered question ends on a shrug.
 *
 * Same ask, same words, no new argument. Anything that needed saying has been
 * said four screens ago; this is only here so the reader who scrolled the whole
 * thing does not have to scroll back up to act on it.
 *
 * Three things changed about how it looks, and each fixed something real:
 *
 * 1. It is a black CARD on the shell, the same shape the guarantee band uses,
 *    not the paper-to-ember gradient inside a thin flame border it had before.
 *    That was the lightest surface on a page whose other bands now run flame
 *    and near black, so the close was the quietest thing on the page.
 *    A card and not a full-bleed black band on purpose: full bleed ran into the
 *    black footer with no seam and the two read as one enormous dark slab.
 * 2. The headline is `finalCta.title`, not `brand.tagline`. The footer prints
 *    the tagline a few hundred pixels below this, and the old version showed
 *    the identical sentence twice on one screen.
 *
 * One centred column, not three across. The old row put the button in the
 * middle with three ticks and a decorative drawing to the right of it, so the
 * one thing the band is for was competing with filler either side. Stacked, the
 * ask is the widest thing in the band and the ticks are a footnote under it.
 */
export function FinalCta() {
  return (
    <Section id="start">
      <div className="rounded-card bg-ink px-6 py-11 sm:px-9 sm:py-14">
        {/* the card runs the full 1440 column; the words inside it do not. a
            centred headline set across a 1300px card is one long line with no
            shape to it. */}
        <div className="mx-auto flex max-w-[720px] flex-col items-center text-center">
          <h2 className="text-balance-tight text-[clamp(1.9rem,4vw,2.9rem)] font-extrabold leading-[1.08] tracking-[-0.04em] text-white">
            {finalCta.title}
          </h2>

          <p className="mt-4 max-w-[46ch] text-[16px] leading-[1.6] text-white/60 sm:text-[17px]">
            {finalCta.sub}
          </p>

          <a
            href={pricing.startUrl}
            className="group mt-8 flex min-h-[56px] w-full max-w-[340px] items-center justify-center gap-2.5 rounded-pill bg-flame px-8 text-[16.5px] font-semibold text-on-accent no-underline shadow-[0_16px_34px_-14px_rgba(236,90,41,0.9)] transition-colors hover:bg-flame-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame sm:w-auto sm:max-w-none"
          >
            Get Creator Empire
            <Arrow />
          </a>

          <p className="mt-3.5 text-[13px] font-semibold text-white/45">
            {finalCta.note}
          </p>

          {/* the three points, in a row rather than a column. they are the four
            core offers in three words each, not new claims, so they read as a
            single line of reassurance under the button instead of a list the
            reader is expected to work through. */}
          <ul className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 border-t border-white/10 pt-7">
            {finalCta.points.map((p) => (
              <li key={p} className="flex items-center gap-2.5">
                <CheckMark className="size-[18px]" />
                <span className="text-[13.5px] font-semibold text-white/70">
                  {p}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
