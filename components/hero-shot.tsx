import Image from "next/image";
import { hero } from "@/lib/content";
import { Glyph } from "./art";

/**
 * The picture beside the fold: the dashboard, with the weekly call overlapping
 * one corner of it.
 *
 * It is DRAWN rather than screenshotted, and that is a deliberate exception to
 * the rule the core-offer blocks follow. Those blocks fell back to hand built
 * pictures of the product and it went badly, because there were four of them,
 * they were four different heights and every one had to be re-drawn whenever a
 * screen moved. This is one picture, in one place, and the fold cannot ship
 * empty: a landing page selling a dashboard has to show the dashboard.
 *
 * The escape hatch is `hero.shot.src`. Set it and this whole component is
 * skipped for the real file, so the drawing is a placeholder with a shelf life,
 * not a second implementation of the product.
 *
 * Every number in here comes from lib/content.ts. Nothing about the app is read
 * at runtime: this is marketing art, and a fold that queried the database would
 * show the first visitor of the month a dashboard with nothing in it.
 */
export function HeroShot() {
  return (
    <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
      {/* The warm wash behind the card. It is what stops a white panel on a
          near-white shell from looking like a hole in the page. aria-hidden and
          pointer-events-none so it is scenery in every sense. */}
      <div
        aria-hidden="true"
        // inset-x, not -inset-x: bled 4px past both screen edges on a 390px
        // phone. the hero's overflow-hidden clipped it so nothing scrolled, but
        // it put a band of ember hard against the edge of the display.
        className="pointer-events-none absolute inset-x-2 -inset-y-8 -z-10 rounded-[50%] bg-ember/70 blur-2xl sm:-inset-x-6"
      />

      {hero.shot.src ? (
        <Image
          src={hero.shot.src}
          alt={hero.shot.alt}
          width={1100}
          height={860}
          priority
          className="w-full rounded-[18px] border border-line shadow-[0_30px_70px_-38px_rgba(64,48,38,0.55)]"
        />
      ) : (
        <Drawn />
      )}
    </div>
  );
}

/** The dashboard, drawn. Nothing in here is interactive on purpose. */
function Drawn() {
  const s = hero.shot;

  return (
    /**
     * The tilt is desktop only and it is small. It exists so the panel reads as
     * an object sitting on the page rather than as a second column of layout;
     * at the stacked widths there is no column beside it to be distinguished
     * from, and a tilted card on a phone just looks broken.
     *
     * aria-hidden across the whole thing: it is a picture of a screen, and read
     * aloud it is forty numbers with no sentence between them. The alt text on
     * the real screenshot says what it shows; here the sr-only line does.
     */
    <>
      <span className="sr-only">{s.alt}</span>

      <div
        aria-hidden="true"
        className="relative rounded-[18px] border border-line bg-paper p-3 shadow-[0_30px_70px_-38px_rgba(64,48,38,0.55)] sm:p-4 lg:-rotate-[1.2deg]"
      >
        <div className="flex gap-3 sm:gap-4">
          {/* the app rail, at the size it reads as a rail and no smaller. the
              marks are the same glyphs the product uses, which is the only
              reason a row of five grey icons means anything. */}
          <div className="hidden w-11 shrink-0 flex-col items-center gap-4 rounded-[12px] bg-shell py-3 sm:flex">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-ink text-[13px] font-extrabold text-white">
              U
            </span>
            {(["growth", "money", "content", "posting", "chat"] as const).map(
              (n, i) => (
                <span
                  key={n}
                  className={`flex size-7 items-center justify-center rounded-[8px] ${
                    i === 0 ? "bg-ember text-flame" : "text-ink-50"
                  }`}
                >
                  <Glyph name={n} className="size-[17px]" />
                </span>
              ),
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold tracking-[-0.02em] sm:text-[17px]">
              {s.title}
            </p>

            {/* four tiles, two across on a phone. four across at that width
                gives every value a column narrower than the value itself. */}
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {s.tiles.map((t) => (
                <li key={t.label} className="rounded-[10px] bg-shell px-2.5 py-2">
                  <span className="block text-[10.5px] font-medium text-ink-50">
                    {t.label}
                  </span>
                  <span className="mt-0.5 block text-[15px] font-extrabold tabular-nums tracking-[-0.03em] sm:text-[16px]">
                    {t.value}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[12.5px] font-bold text-ink-70">
              {s.dealsTitle}
            </p>

            {/* The right inset is what the call card overlaps. Without it the
                card lands on the amount and the status chip, which are the two
                things in this picture worth reading, and a mock of a dashboard
                with the money covered up is a mock of nothing. The inset only
                exists at lg, because under it the card is hidden. */}
            <ul className="mt-2 flex flex-col lg:pr-[190px]">
              {s.deals.map((d) => (
                <li
                  key={d.brand}
                  className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold">
                      {d.brand}
                    </span>
                    <span className="block text-[10.5px] text-ink-50">
                      {d.when}
                    </span>
                  </span>
                  <span className="text-[12.5px] font-extrabold tabular-nums">
                    {d.amount}
                  </span>
                  <span
                    className={`rounded-pill px-2 py-0.5 text-[10px] font-extrabold ${
                      d.paid
                        ? "bg-live-soft text-live"
                        : "bg-ember text-flame-dark"
                    }`}
                  >
                    {d.paid ? s.paidLabel : s.pendingLabel}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-3 pb-1 text-center lg:pr-[190px]">
              <span className="inline-block rounded-pill border border-line px-3.5 py-1.5 text-[11.5px] font-bold text-ink-70">
                {s.moreLabel}
              </span>
            </p>
          </div>
        </div>
      </div>

      <CallCard />
    </>
  );
}

/**
 * The weekly call, overlapping the dashboard's bottom right corner.
 *
 * Hidden under lg rather than stacked. The whole point of it is the overlap —
 * two objects, one in front of the other, saying the offer is a product AND a
 * room. Dropped into a phone column it is a third card of copy above the button
 * and the fold already has enough of those. lg and not sm because the strip it
 * sits in is `lg:pr-[190px]` on the table, and below that breakpoint there is
 * no strip, so the card would be back on top of the money.
 */
function CallCard() {
  const c = hero.call;

  return (
    <div
      aria-hidden="true"
      className="absolute -bottom-5 -right-3 hidden w-[196px] rounded-[14px] border border-line bg-paper p-2.5 shadow-[0_22px_50px_-26px_rgba(64,48,38,0.55)] lg:block"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden rounded-[10px] bg-ember">
        {c.thumb ? (
          <Image
            src={c.thumb}
            alt=""
            fill
            sizes="196px"
            className="object-cover"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-paper/90 shadow-card">
            <svg viewBox="0 0 12 12" className="ml-0.5 size-3 text-flame">
              <path d="M2.5 1.5 10 6l-7.5 4.5V1.5Z" fill="currentColor" />
            </svg>
          </span>
        </span>
      </div>

      <p className="mt-2.5 text-[13px] font-extrabold tracking-[-0.02em]">
        {c.title}
      </p>
      {c.lines.map((l) => (
        <p key={l} className="text-[11.5px] leading-[1.45] text-ink-50">
          {l}
        </p>
      ))}
      <p className="mt-2.5">
        <span className="inline-block rounded-pill bg-flame px-3 py-1 text-[11px] font-bold text-on-accent">
          {c.ctaLabel}
        </span>
      </p>
    </div>
  );
}
