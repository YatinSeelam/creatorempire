import Image from "next/image";
import { brand, hero, pricing } from "@/lib/content";
import { isSignedIn } from "@/lib/session";
import { FacePile, Glyph } from "./art";
import { HeroShot } from "./hero-shot";
import { SiteNav } from "./site-nav";
import { ButtonLink } from "./ui";

// async because the bar has to know whether somebody is signed in before it
// renders. this is what makes the landing page dynamic rather than static.
export async function Hero() {
  const signedIn = await isSignedIn();

  return (
    /**
     * The fold: the argument on the left, the product on the right.
     *
     * It used to be one centred column with four decorative chips floating
     * around it. Centred type is the wrong shape for a fold with this much to
     * say — three headline rows, two subhead rows, a button, three facts and a
     * proof line all ragged on both edges, with nothing holding a left margin —
     * and the chips were four fragments of the offer that the four-up grid one
     * band down already says properly. Left-aligned copy against a picture of
     * the dashboard makes the same case with one object instead of five.
     *
     * The column is max-w-[1440px] to line up with SiteNav, which is the same
     * width. At 1280 the headline started a measurable distance left of the
     * logo above it.
     *
     * overflow-hidden is load bearing: the call card is positioned off the
     * dashboard's right edge and would otherwise widen the page.
     */
    // Fills the window minus the promo bar, so the band under it never peeks in
    // at the bottom of the fold. The 47/48px offsets are that bar's rendered
    // height; if its padding or type size changes these have to move with it,
    // which is why the bar is built never to wrap.
    //
    // No cap on it. A capped fold (the old min(100dvh, 780px)) stops filling on
    // any window taller than the cap, and then the next band's heading sits in
    // the first screen, which is the whole thing this is here to prevent.
    <section className="relative flex min-h-[calc(100dvh-47px)] flex-col overflow-hidden sm:min-h-[calc(100dvh-48px)]">
      <SiteNav signedIn={signedIn} />

      <div className="relative mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center px-5 pb-12 pt-6 sm:px-6 sm:pb-14 sm:pt-8">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-14">
          <div className="max-w-[760px]">
            <p className="inline-block rounded-pill border border-line bg-paper px-3.5 py-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-flame sm:text-[11px]">
              {hero.eyebrow}
            </p>

            {/* three fixed rows. each line is its own block so the break never
                moves with the viewport.

                the 1.9rem floor is measured, not picked. the longest line is
                "Your money back" and at 30px it clears a 375px screen's content
                box with the column left-aligned. */}
            <h1 className="mt-5 text-[clamp(2.1rem,5vw,4.6rem)] font-extrabold leading-[1.05] tracking-[-0.042em] sm:mt-6">
              {hero.headline.map((line, i) => (
                <span key={i} className="block">
                  {line.pre}
                  {line.pre && line.accent ? " " : null}
                  {line.accent ? (
                    <span className="text-flame">{line.accent}</span>
                  ) : null}
                  {line.accent && line.post ? " " : null}
                  {line.post}
                </span>
              ))}
            </h1>

            {hero.video.src ? (
              <>
                {/* When there is a vsl, it IS the fold. The subhead comes out:
                    the video says the same thing better, and a reader given
                    both reads neither. */}
                <div className="mt-6 overflow-hidden rounded-[18px] border border-line bg-ink shadow-[0_24px_60px_-30px_rgba(64,48,38,0.5)]">
                  <video
                    className="block aspect-video w-full"
                    src={hero.video.src}
                    poster={hero.video.poster ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                  />
                </div>
                <p className="mt-3 text-[13px] font-medium text-ink-50">
                  {hero.video.caption}
                </p>
              </>
            ) : (
              <p className="mt-5 max-w-[46ch] text-[17px] leading-[1.65] text-ink-70 sm:text-[19.5px] sm:leading-[1.7]">
                {hero.sub}
              </p>
            )}

            <div className="mt-7 sm:mt-8">
              <ButtonLink
                href={pricing.startUrl}
                size="lg"
                // full width on a phone so it is a thumb target, not a chip.
                // justify-center because ButtonLink is a plain inline-flex —
                // stretched without it, the label sits against the left edge.
                className="w-full max-w-[320px] justify-center shadow-[0_14px_30px_-12px_rgba(236,90,41,0.7)] sm:w-auto sm:max-w-none"
              >
                {brand.ctaLabel}
              </ButtonLink>
            </div>

            {/* The floor of the copy column. Three facts, no argument. Stacked
                on a phone, three across from sm, and the dividers only exist in
                the row version — between stacked rows they would be three
                horizontal rules in a fold that has none. */}
            <ul className="mt-8 grid gap-3 rounded-card border border-line bg-paper px-4 py-4 shadow-card sm:mt-9 sm:grid-cols-3 sm:gap-0 sm:px-2">
              {hero.stats.map((s, i) => (
                <li
                  key={s.value}
                  className={`flex items-center gap-2.5 sm:px-3 ${
                    i > 0 ? "sm:border-l sm:border-line" : ""
                  }`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ember text-flame">
                    <Glyph name={s.icon} className="size-[17px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-extrabold tracking-[-0.02em]">
                      {s.value}
                    </span>
                    <span className="block text-[12px] leading-[1.35] text-ink-50">
                      {s.label}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            {/* the count and the claim, on one line with the faces. this is the
                only social proof above the fold and it is a fact with a number
                in it, not a testimonial. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Faces />
              <p className="text-[13.5px] leading-[1.5] text-ink-50 sm:text-[14.5px]">
                <span className="font-extrabold text-ink">
                  {hero.proof.lead}
                </span>
                {". "}
                {hero.proof.rest}
              </p>
            </div>
          </div>

          {/* Under lg this drops below the copy, which is the right order: the
              picture is the evidence and the claim goes first. */}
          <HeroShot />
        </div>
      </div>
    </section>
  );
}

/**
 * The row beside the proof line.
 *
 * Real headshots the day `hero.faces` has any in it. Until then it is
 * `facePlaceholders` drawn stand-ins, the same pile the price band uses. They
 * are obviously illustrations on purpose: a stock photograph here would be a
 * stranger's face attached to a claim about our own creators.
 */
function Faces() {
  if (hero.faces.length > 0) {
    return (
      <span className="flex -space-x-2.5">
        {hero.faces.map((f) => (
          <Image
            key={f.src}
            src={f.src}
            alt={f.alt}
            width={72}
            height={72}
            className="size-9 rounded-full ring-2 ring-paper object-cover"
          />
        ))}
      </span>
    );
  }

  return <FacePile count={hero.facePlaceholders} className="size-9" />;
}
