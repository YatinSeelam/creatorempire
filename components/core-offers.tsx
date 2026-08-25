import Image from "next/image";
import { brand, coreOffers, offer, pricing, whatYouGet } from "@/lib/content";
import type { CoreOffer } from "@/lib/content";
import { OfferGlyph, SoonChip } from "./offer-icons";
import { OfferShot } from "./offer-shots";
import { Section, SectionHeading } from "./section";
import { Arrow } from "./ui";

/**
 * The middle of the page, and the part that has to do the selling.
 *
 * Two moves, in this order. First a four-up grid: the whole offer in four lines
 * so somebody scrolling fast still gets it. Then the same four things opened
 * all the way up, one block each, alternating sides.
 *
 * Every block is the SAME SHAPE: a number, a name, one lede and four one-line
 * points, with one picture beside it. The shape is the rule (lib/content.ts
 * states it above `coreOffers`), because four blocks of four different lengths
 * stacked down one column read as broken layout rather than as varied content.
 *
 * The picture is an empty well until real art lands. `image.src` is null on all
 * four, and setting src plus alt in lib/content.ts fills it with no code change
 * here. Nothing is drawn in the meantime: this used to fall back to four hand
 * built pictures of the product, which were four different heights, took the
 * copy's own tokens and had to be re-drawn every time a screen moved.
 */
export function CoreOffers() {
  return (
    <>
      {/* THE MAP. four cards, one line each, and the price of each thing on its
          own. this is the whole offer at a glance; the blocks under it are the
          territory. it runs full flame, the one band on the page that is not the
          page's own colour, so the four white cards lift off it. */}
      <Section id="inside" className="bg-flame">
        {/* the title, and nothing under it. the lede that used to sit
            here ("no course, no upsells") is an argument, and the four cards
            directly below it are the same argument with numbers on. a reader
            given both reads the paragraph and skims the cards, which is the
            wrong way round. */}
        <SectionHeading title={whatYouGet.title} invert />

        <ul className="mt-9 grid gap-3.5 sm:mt-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {coreOffers.map((o) => (
            <li
              key={o.key}
              className="flex flex-col items-center rounded-card border border-line bg-paper p-5 text-center shadow-card"
            >
              <OfferGlyph kind={o.key === "editing" ? "editor" : o.key} size={44} />

              <h3 className="mt-4 text-[16px] font-extrabold tracking-[-0.02em] sm:text-[17px]">
                {o.label}
                {/* a parenthetical, not the grey chip the deep block wears. at
                    this size the chip was a second object competing with the
                    value pill three lines under it. */}
                {o.soon && (
                  <span className="font-semibold text-ink-50">
                    {" "}
                    ({offer.soonLabel})
                  </span>
                )}
              </h3>
              <p className="mt-1.5 max-w-[24ch] text-[14px] leading-[1.55] text-ink-70">
                {o.short}
              </p>

              {/* the value pill is the point of this row. the blocks below argue
                  for each thing; this says what it is worth in four characters,
                  which is the only argument a fast scroller reads. */}
              <p className="mt-auto pt-4">
                <span className="inline-block rounded-pill bg-ink px-3 py-1.5 text-[12px] font-extrabold tabular-nums text-white">
                  {o.value}+ value
                </span>
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {/* THE TERRITORY. the same four things opened all the way up, one card
          each, the picture alternating sides so the eye has to travel. */}
      <Section id="how">
        <SectionHeading title="What you actually get" />

        <div className="mt-9 flex flex-col gap-3.5 sm:mt-12 sm:gap-4">
          {coreOffers.map((o, i) => (
            <Block key={o.key} offer={o} flip={i % 2 === 1} />
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center gap-3 sm:mt-12">
          <a
            href={pricing.startUrl}
            className="group flex min-h-[54px] w-full max-w-[340px] items-center justify-center gap-2.5 rounded-pill bg-flame px-8 text-[16px] font-semibold text-on-accent no-underline shadow-[0_12px_28px_-14px_rgba(236,90,41,0.9)] transition-colors hover:bg-flame-dark sm:w-auto sm:max-w-none"
          >
            {brand.ctaLabel}
            <Arrow />
          </a>
          <p className="text-[13px] font-medium text-ink-50">{whatYouGet.ctaNote}</p>
        </div>
      </Section>
    </>
  );
}

/**
 * One core offer, opened all the way up, inside its own card.
 *
 * The grid does NOT centre its two columns. It stretches them, so the picture
 * is exactly as tall as the words beside it and the card is exactly as tall as
 * the words. Centring left a band of empty card above and below the copy on
 * every one of these — the copy is short and the picture had a height of its
 * own, so the taller of the two set the card and the shorter floated in it.
 */
function Block({ offer: o, flip }: { offer: CoreOffer; flip: boolean }) {
  return (
    <div className="grid gap-6 rounded-card border border-line bg-paper p-5 shadow-card sm:p-7 lg:min-h-[420px] lg:grid-cols-2 lg:gap-10 lg:p-8">
      <div className={flip ? "lg:order-2" : ""}>
        {/* the number is the loud thing, not a chip around it. a filled pill
            here competed with the value pills a band above. */}
        <p className="text-[16px] font-extrabold tabular-nums tracking-[-0.02em] text-flame">
          {o.index}
        </p>

        <h3 className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[26px] font-extrabold leading-[1.1] tracking-[-0.035em] sm:text-[32px]">
          {o.label}
          {o.soon && <SoonChip label={offer.soonLabel} />}
        </h3>

        {/* one sentence and four lines, the same shape in all four blocks. the
            value pill that used to sit under them is already on this offer's
            card one band up, and having it twice was one of the reasons four
            cards came out four different heights. */}
        <p className="mt-3.5 max-w-[44ch] text-[17px] leading-[1.5] text-ink sm:text-[18px]">
          {o.lede}
        </p>

        <ul className="mt-5 flex flex-col gap-3.5">
          {o.points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <Tick />
              <span className="text-[15.5px] leading-[1.45] text-ink-70 sm:text-[16px]">
                {p}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className={flip ? "lg:order-1" : ""}>
        <Visual offer={o} />
      </div>
    </div>
  );
}

function Tick() {
  return (
    <span className="mt-[2px] flex size-[19px] shrink-0 items-center justify-center rounded-full bg-flame text-on-accent">
      <svg viewBox="0 0 12 12" className="size-[11px]" aria-hidden="true">
        <path
          d="M2.5 6.4l2.4 2.4L9.6 3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * The block's picture, or the well it will sit in.
 *
 * `h-full` is what keeps the four cards the same height: the grid stretches
 * this column to whatever the copy beside it needs, so the well is never the
 * thing deciding how tall a card is. The min-height is for the stacked layout
 * under lg, where there is no column beside it to take a height from.
 *
 * With no file set it draws the panel in `OfferShot` rather than sitting empty.
 * A grey well on a live page reads as a picture that failed to load; the drawn
 * panel is a placeholder that still shows the thing being sold.
 */
function Visual({ offer: o }: { offer: CoreOffer }) {
  if (!o.image.src) {
    return (
      // The panel is absolutely positioned inside the well on purpose. Left in
      // flow it has an intrinsic height — the chart alone is 900x459 — and the
      // grid hands the card whichever column is taller, so one block came out
      // half a screen taller than the three around it. Out of flow it can only
      // fill the space the copy beside it already asked for.
      <div className="relative h-full min-h-[260px] w-full sm:min-h-[300px]">
        <span className="sr-only">{o.image.alt}</span>
        <div className="absolute inset-0">
          <OfferShot kind={o.key} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[260px] w-full overflow-hidden rounded-[16px] bg-ink sm:min-h-[320px]">
      <Image
        src={o.image.src}
        alt={o.image.alt}
        fill
        sizes="(max-width: 1024px) 100vw, 520px"
        className="object-cover"
      />
    </div>
  );
}
