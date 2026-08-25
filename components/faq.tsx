import { capacity, faq, pricing } from "@/lib/content";
import { Section, SectionHeading } from "./section";
import { Arrow } from "./ui";

/**
 * Two columns of cards on a desktop, one on a phone.
 *
 * It was one column, on the reasoning that an odd number of questions leaves a
 * ragged edge and a reader has to pick a column to start in. That held at 7
 * questions. At 14 it does not: one column was a 2000px scroll of near
 * identical rows, and the count is even, so the split is clean at 7 and 7.
 *
 * `items-start` is load bearing. Grid cells stretch by default, so an opened
 * answer would drag its neighbour's card to the same height and leave it a
 * closed row with a slab of empty inside it.
 *
 * The closing block is the point of the band. It is the last thing above the
 * footer, and a page that ends on an unanswered question ends on a shrug.
 */
export function Faq() {
  const left = capacity.cap - capacity.taken;

  return (
    <Section id="faq">
      <SectionHeading title={faq.title} />

      <div className="mx-auto mt-9 grid w-full max-w-[1280px] items-start gap-2.5 sm:mt-11 lg:grid-cols-2 lg:gap-x-4">
        {faq.items.map((item) => (
          <details
            key={item.q}
            className="group rounded-[14px] border border-line bg-paper transition-colors hover:border-flame/30 open:border-flame/40"
          >
            {/* The padding belongs to the summary, not the details: on the
                details it looked identical and was dead space, so a tap two
                pixels above the question toggled nothing.

                Three ways of hiding the disclosure triangle, because no one of
                them covers every browser: list-none for chrome and firefox,
                marker:hidden for the newer spec, and the -webkit-details-marker
                pseudo for safari, which ignores both. */}
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15px] font-bold tracking-[-0.015em] marker:hidden [&::-webkit-details-marker]:hidden sm:px-6 sm:py-[18px] sm:text-[16.5px]">
              {item.q}
              <span className="relative size-4 shrink-0 text-flame">
                <span className="absolute left-0 top-1/2 h-[2px] w-4 -translate-y-1/2 rounded bg-current" />
                <span className="absolute left-1/2 top-0 h-4 w-[2px] -translate-x-1/2 rounded bg-current transition-transform duration-200 group-open:rotate-90 group-open:opacity-0" />
              </span>
            </summary>
            <p className="px-5 pb-5 text-[14.5px] leading-[1.65] text-ink-70 sm:px-6 sm:pb-[18px] sm:text-[15px]">
              {item.a}
            </p>
          </details>
        ))}
      </div>

      {/* the last ask. same two facts as the offer card's meter, said shorter,
          because by here the price has already been read once. */}
      <div className="mx-auto mt-10 w-full max-w-[780px] rounded-[18px] border border-flame/50 bg-paper px-6 py-7 text-center sm:mt-12 sm:px-8">
        <p className="text-[19px] font-extrabold tracking-[-0.025em] sm:text-[21px]">
          {faq.closing.title}
        </p>
        <p className="mx-auto mt-2 max-w-[44ch] text-[14px] leading-[1.6] text-ink-70">
          {faq.closing.sub}{" "}
          <span className="font-semibold text-ink">{left} spots left.</span>
        </p>
        <a
          href={pricing.startUrl}
          className="group mx-auto mt-5 flex min-h-[50px] w-full max-w-[300px] items-center justify-center gap-2.5 rounded-pill bg-flame text-[15px] font-semibold text-on-accent no-underline shadow-[0_10px_24px_-14px_rgba(236,90,41,0.9)] transition-colors hover:bg-flame-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame"
        >
          {faq.closing.cta}
          <Arrow />
        </a>
      </div>
    </Section>
  );
}
