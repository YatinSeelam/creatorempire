import { capacity, offer, plans, pricing } from "@/lib/content";
import { FacePile } from "./art";
import { StackIcon } from "./offer-icons";
import { Section } from "./section";
import { Arrow } from "./ui";

/**
 * The stack, and the price under it.
 *
 * Two columns, not a centred card. Left is the ask: the pill, the headline with
 * the price in it, the one line that pays for it, the button, and the count of
 * who is already in. Right is the receipt: every line item with a mark and what
 * it is worth, then the total. The reader's eye lands on the ask and the
 * arithmetic is right next to it rather than above it.
 *
 * The price is in the HEADLINE now, not in a row at the foot of the receipt.
 * The receipt's job is the total; a "your price" row under it made the card
 * argue with the heading eight inches to its left, and the reader had to hold
 * two numbers in two places to do the comparison the band exists for.
 *
 * The values are not decoration and they are not invented. Every one is what
 * the same thing costs somewhere else, and the comment above each `value` in
 * lib/content.ts says which comparison it came from: two placed deals at our
 * own floor, the software the dashboard replaces, four coaching calls, the free
 * credits plus what 20 cuts cost at a normal editor's rate. If a number here
 * stops being defensible, cut it rather than round it up. A reader can check a
 * stack, and a total they can check is worth more than a bigger one they
 * cannot.
 */
export function Offer() {
  const plan = plans[0];
  // "One deal pays $750." then "That is your $500 back, and more." Two
  // sentences, so two rows, split on the full stop rather than left to break
  // wherever the column happens to run out.
  const footLines = plan.foot.split(/(?<=\.)\s+/);

  return (
    <Section id="pricing">
      <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.25fr] lg:gap-16">
        {/* the ask */}
        <div>
          {/* the multiple, which used to be a chip inside the receipt's total
              row. It reads as the claim the table is about to prove up here,
              and as a footnote on the answer down there. */}
          <p className="inline-flex items-center gap-2 rounded-pill bg-ember px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.13em] text-flame sm:text-[12px]">
            <Sparkle />
            {offer.multiple} {offer.multipleLabel}
          </p>

          <h2 className="mt-6 max-w-[13ch] text-balance-tight text-[clamp(2rem,4.4vw,3.4rem)] font-extrabold leading-[1.04] tracking-[-0.042em]">
            Everything you get for{" "}
            <span className="text-flame">
              {plan.price}
              {plan.period}
            </span>
          </h2>

          <div className="mt-5 max-w-[36ch] text-[16.5px] leading-[1.55] text-ink-70 sm:text-[19px]">
            {footLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          <a
            href={`${pricing.startUrl}?plan=${plan.id}`}
            className="group mt-8 inline-flex min-h-[58px] items-center justify-center gap-2.5 rounded-pill bg-flame px-9 text-[17px] font-semibold text-on-accent no-underline shadow-[0_14px_32px_-14px_rgba(236,90,41,0.9)] transition-colors hover:bg-flame-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame"
          >
            {plan.cta}
            <Arrow />
          </a>

          {/* who is already in. it replaced the spots meter, which said the same
              number as the bar pinned to the top of the window and said it as a
              progress bar, which is a countdown — this is the same fact told as
              company rather than as pressure. */}
          <div className="mt-7 flex items-center gap-4">
            <Faces />
            <p className="text-[15px] font-bold sm:text-[16px]">
              {capacity.taken} creators so far
            </p>
          </div>
        </div>

        {/* the receipt */}
        <div className="rounded-[22px] border border-line bg-linear-to-b from-paper to-ember/40 p-2.5 shadow-[0_28px_60px_-30px_rgba(64,48,38,0.35)] sm:p-3">
          {/* the total is stated twice on purpose: once up here beside the
              title, where a reader who never gets past the first row still
              sees it, and once at the foot as the answer to the column. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2.5 py-3 sm:px-3.5">
            <h3 className="text-[17px] font-extrabold tracking-[-0.03em] sm:text-[20px]">
              {offer.eyebrow}
            </h3>
            <span className="rounded-pill bg-ember px-3.5 py-1.5 text-[14px] font-extrabold tabular-nums text-flame sm:text-[15px]">
              {offer.total}+
            </span>
          </div>

          {/* one card per line item, not one table with rules in it. six rows
              of hairline-separated text at this width read as terms and
              conditions; six cards read as six things you are being handed.

              two across from sm. six full-width rows made the card taller than
              the column of copy beside it, and a receipt that outruns the thing
              it is pricing reads as the page's main event. */}
          <ul className="grid gap-2 sm:grid-cols-2">
            {offer.stack.map((row) => (
              <li
                key={row.title}
                className="flex h-full items-center gap-3 rounded-[16px] border border-line bg-paper px-3 py-2.5 shadow-card sm:gap-3.5 sm:px-3.5 sm:py-3"
              >
                {/* the tile is the same box either way, drawn mark or chip, so
                    the six names stay on one left edge down the card. */}
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-ember text-flame sm:size-11">
                  {row.soon ? (
                    <span className="text-[9.5px] font-extrabold uppercase tracking-[0.08em]">
                      {offer.soonLabel}
                    </span>
                  ) : (
                    <StackIcon name={row.icon} className="size-[19px]" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-extrabold tracking-[-0.02em] sm:text-[16px]">
                    {row.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-50 sm:text-[13.5px]">
                    {row.sub}
                  </p>
                </div>

                <span className="shrink-0 text-[15px] font-extrabold tabular-nums sm:text-[16.5px]">
                  {row.value}+
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline justify-between gap-4 px-2.5 py-3.5 sm:px-3.5">
            <span className="text-[15px] font-extrabold sm:text-[16.5px]">
              {offer.totalLabel}
            </span>
            <span className="text-[17.5px] font-extrabold tabular-nums sm:text-[20px]">
              {offer.total}+
            </span>
          </div>

          {/* the one row that is not a value. ink, and inset like the rows above
              it rather than run to the card's edges: it is the last card in the
              stack, not a footer bolted under one. */}
          <div className="flex items-center justify-between gap-4 rounded-[16px] bg-ink px-4 py-3.5 sm:px-5 sm:py-4">
            <span className="text-[15px] font-extrabold text-white sm:text-[16.5px]">
              {offer.priceLabel}
            </span>
            <span className="text-[21px] font-extrabold tabular-nums tracking-[-0.03em] text-flame sm:text-[24px]">
              {plan.price}
              {plan.period}
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}

/**
 * The people already in.
 *
 * Drawn stand-ins, not photographs: a stock headshot beside a claim about our
 * own creators is a stranger's face doing the vouching. FacePile is the shared
 * one — the fold uses it too, so the two rows on this page cannot drift into
 * two different treatments. Real headshots replace it in one place.
 */
function Faces() {
  const shown = 4;

  return <FacePile count={shown} more={Math.max(0, capacity.taken - shown)} />;
}

/** The four-point star in the pill. */
function Sparkle() {
  return (
    <svg viewBox="0 0 24 24" className="size-[13px]" fill="currentColor" aria-hidden="true">
      <path d="M12 1.6c.5 4.6 1.4 7.5 3.2 9.2 1.7 1.8 4.6 2.7 9.2 3.2-4.6.5-7.5 1.4-9.2 3.2-1.8 1.7-2.7 4.6-3.2 9.2-.5-4.6-1.4-7.5-3.2-9.2-1.7-1.8-4.6-2.7-9.2-3.2 4.6-.5 7.5-1.4 9.2-3.2C10.6 9.1 11.5 6.2 12 1.6Z" />
    </svg>
  );
}
