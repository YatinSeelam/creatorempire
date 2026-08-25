import Link from "next/link";
import { brand, capacity, pricing } from "@/lib/content";

/**
 * The strip above the hero. It used to be a countdown to August 28 and a "Save
 * My Spot" pill, which was a clock with an expiry date on it: worth its space
 * for a week, a stale promise stuck to the top of every page after that.
 *
 * What it says now is the scarcity that does not expire. Seats are placed by
 * hand and the group caps at 30, so `capacity` is the fact, and it is the same
 * object the hero meter and the offer card read. Three of them can never
 * disagree about how full the group is.
 *
 * No "use client" any more either. The countdown needed a ticking store; a
 * number out of content.ts renders on the server and ships no javascript.
 *
 * It deliberately never wraps. The hero subtracts this bar's height (47px, 48
 * on sm) to fill the viewport, so a second row here lets the next section peek
 * in under the fold. Padding and type sizes are load bearing for that reason:
 * change one and the hero's two min-heights move with it.
 */
export function PromoBar() {
  const left = capacity.cap - capacity.taken;

  return (
    <Link
      href={pricing.startUrl}
      className="group/bar sticky top-0 z-50 block bg-ink text-white transition-colors hover:bg-black"
    >
      <div className="mx-auto flex w-full max-w-[1440px] items-center justify-center gap-x-2.5 px-3 py-2.5 sm:gap-x-5 sm:px-6">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-flame opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-flame" />
        </span>

        <span className="whitespace-nowrap text-[12.5px] font-semibold tracking-[-0.005em] sm:text-[13.5px]">
          {capacity.spotsLabel(capacity.taken, capacity.cap)}
          {/* the count is the urgent half, so it is the half that survives on a
              phone. the sentence around it is what drops. */}
          <span className="text-white/45"> · {left} left</span>
        </span>

        <span className="shrink-0 whitespace-nowrap rounded-pill bg-flame px-3 py-1 text-[11.5px] font-bold text-on-accent transition-colors group-hover/bar:bg-flame-dark sm:px-3.5 sm:text-[13px]">
          {brand.ctaLabel}
        </span>
      </div>
    </Link>
  );
}
