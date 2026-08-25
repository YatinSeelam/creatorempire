import { guarantee } from "@/lib/content";
import { LandingArt } from "./art";
import { Section } from "./section";

/**
 * The risk reversal, directly under the price.
 *
 * One ink card on the page's shell, and the only dark thing between the nav and
 * the testimonials. It used to be a full-bleed ember wash, which worked when
 * the bands either side of it were alternating paper and shell — now that the
 * whole page is one colour, a second wash would just be a stripe. A card that
 * inverts is the one block a scroller cannot read past, and inverting it costs
 * nothing structurally: same four columns, same order.
 *
 * No button. The band above asks and the band below asks; a third ask wedged
 * between them is a page apologising for its price rather than standing on it.
 *
 * The conditions sit BESIDE the promise as five ticks rather than under it as
 * a paragraph. They have to be printed — a guarantee with no conditions is one
 * somebody claims after doing nothing — but as a block of prose under the
 * promise they read as small print, which is the one thing a risk reversal
 * must never read as.
 */
export function Guarantee() {
  return (
    // Pulled up tight under the price. The risk reversal is the answer to the
    // number above it, and a full band gap between the two read as a subject
    // change. Negative margin rather than a padding override: Section's py is a
    // shorthand and a pt- utility beside it wins or loses on stylesheet order.
    <Section id="guarantee" className="-mt-10 sm:-mt-20">
      <div className="relative overflow-hidden rounded-card bg-ink px-6 py-8 text-white sm:px-9 sm:py-10 lg:px-11">
        <div className="grid items-center gap-8 lg:grid-cols-[auto_1fr_auto_auto] lg:gap-11">
          <LandingArt
            name="guaranteeBadge"
            className="h-auto w-[104px] shrink-0 sm:w-[128px]"
          />

          <div>
            <h2 className="max-w-[17ch] text-[clamp(1.5rem,3vw,2.05rem)] font-extrabold leading-[1.12] tracking-[-0.035em]">
              {guarantee.title}
            </h2>
            <p className="mt-3 max-w-[46ch] text-[14px] leading-[1.6] text-white/65">
              {guarantee.promise}
            </p>
            {/* the record, on its own. it is the strongest line in the band and
                it was reading as a footnote inside the conditions. */}
            <p className="mt-3.5 w-fit rounded-pill bg-flame/20 px-3 py-1.5 text-[12.5px] font-bold text-flame">
              {guarantee.proof}
            </p>
          </div>

          <ul className="flex flex-col gap-2.5">
            {guarantee.steps.map((s) => (
              <li key={s} className="flex items-center gap-2.5">
                <Tick />
                <span className="text-[13.5px] leading-[1.45] text-white/75">{s}</span>
              </li>
            ))}
          </ul>

          {/* drawn, not a file: the art set has no shield and this is one shape.
              it is the last thing on the widest row and the first to drop. */}
          <ShieldArt className="hidden w-[104px] shrink-0 text-white/10 xl:block" />
        </div>
      </div>
    </Section>
  );
}

function Tick() {
  return (
    <span className="flex size-[17px] shrink-0 items-center justify-center rounded-full bg-flame text-on-accent">
      <svg viewBox="0 0 12 12" className="size-[10px]" aria-hidden="true">
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

/** A shield with a tick in it. Two outlines so it still reads at 100px. */
function ShieldArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M60 6l50 20v40c0 32-20 58-50 68C30 124 10 98 10 66V26L60 6Z" />
        <path d="M60 22l36 14.5V66c0 24.5-14.5 44.5-36 52.5C38.5 110.5 24 90.5 24 66V36.5L60 22Z" />
        <path d="M42 68l13 13 24-26" />
      </g>
    </svg>
  );
}
