import { fit } from "@/lib/content";
import { LandingArt } from "./art";
import { Section, SectionHeading } from "./section";

/**
 * The qualifier, and it sits between the goods and the price on purpose.
 *
 * It is the same decision as the guarantee, said the other way round. We can
 * promise a creator who already films will land a deal in 30 days. We cannot
 * promise it to somebody learning the job on our clock, so we do not take them,
 * and saying that out loud makes the promise above it readable rather than
 * suspicious.
 *
 * The no column is deliberately as long as the yes column. A for/not-for pair
 * where the nos are an afterthought is just more selling.
 *
 * One card, split down the middle by a rule with VS on it. The split IS the
 * band — this reader is on one side of it or the other — and two lists sitting
 * side by side with nothing between them read as one list in two columns. The
 * drawings on the outside edges carry no argument; they are there because the
 * two lists at 1120px would otherwise run to both edges of the card.
 */
export function Fit() {
  return (
    // full flame, like the four-up band. the card inside is still white, so
    // nothing in the two lists had to change colour — the green tick and the
    // ember cross are reading off paper either way.
    <Section id="fit" className="bg-flame">
      <SectionHeading title={fit.title} invert />

      <div className="mt-8 grid gap-8 rounded-card border border-line bg-paper p-5 shadow-card sm:mt-10 sm:p-7 lg:grid-cols-[0.34fr_1fr_auto_1fr_0.34fr] lg:items-center lg:gap-7 lg:p-8">
        <LandingArt
          name="creator"
          className="mx-auto hidden h-auto w-full max-w-[152px] lg:block"
        />

        <Column label={fit.forLabel} lines={fit.forList} kind="yes" />

        {/* the rule and its badge. hidden under lg, where the two columns are
            stacked and a vertical divider would be pointing at nothing. */}
        <div className="relative hidden self-stretch lg:flex lg:items-center">
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line"
          />
          <span className="relative flex size-11 items-center justify-center rounded-full border border-line bg-paper text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-flame">
            vs
          </span>
        </div>

        <Column label={fit.notLabel} lines={fit.notList} kind="no" />

        <LandingArt
          name="growthBars"
          className="mx-auto hidden h-auto w-full max-w-[116px] lg:block"
        />
      </div>
    </Section>
  );
}

function Column({
  label,
  lines,
  kind,
}: {
  label: string;
  lines: string[];
  kind: "yes" | "no";
}) {
  return (
    // self-start, not centred: the two lists rarely wrap to the same height, and
    // centring each one inside its own grid cell is what stops the two headings
    // from lining up with each other.
    <div className="lg:self-start">
      <p
        className={`text-[11.5px] font-extrabold uppercase tracking-[0.14em] ${
          kind === "yes" ? "text-live" : "text-flame-dark"
        }`}
      >
        {label}
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <Mark kind={kind} />
            {/* full ink and semibold, not the ink-70 body weight the rest of
                the page uses. this card is the only white object on a flame
                band, so it is read at a glance rather than in sequence, and
                grey 14px inside it looked like a footnote on a poster. */}
            <span className="text-[15px] font-semibold leading-[1.5] text-ink">
              {line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Green for the yes, flame-dark for the no.
 *
 * The no is deliberately NOT a second red. `--color-live` is the one green in
 * the product and the ember/flame-dark pair is what everything negative already
 * wears (see app/globals.css), so this row uses the two that exist rather than
 * introducing a third hue that a white-label org would then have to keep in
 * step with the first two.
 */
function Mark({ kind }: { kind: "yes" | "no" }) {
  return (
    <span
      className={`mt-[2px] flex size-[19px] shrink-0 items-center justify-center rounded-[6px] ${
        kind === "yes" ? "bg-live-soft text-live" : "bg-ember text-flame-dark"
      }`}
    >
      <svg viewBox="0 0 12 12" className="size-[10px]" aria-hidden="true">
        <path
          d={kind === "yes" ? "M2.5 6.4l2.4 2.4L9.6 3.6" : "M3.4 3.4l5.2 5.2M8.6 3.4l-5.2 5.2"}
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
