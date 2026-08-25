import Image from "next/image";
import type { ReactNode } from "react";
import { FacePlaceholder, landingArt } from "./art";

/**
 * The picture inside each core-offer block.
 *
 * Drawn in markup, like `HeroShot`, and for the same reason: the page sells a
 * dashboard, a deal flow and a room, and four empty grey wells said none of it.
 * The wells were empty because an earlier hand-drawn set was deleted for being
 * four different heights that had to be redrawn every time a screen moved.
 * These are built not to repeat that: every panel is `h-full`, so the card's
 * height comes from the copy beside it and never from the picture, and every
 * panel is made of the same three parts (a tinted well, white rows, ember
 * chips) rather than four bespoke drawings.
 *
 * Nothing here reads the database. It is marketing art: a live query would show
 * the first visitor of the month an empty dashboard.
 *
 * The escape hatch is `image.src` on the offer in lib/content.ts. Set it and
 * core-offers renders the real screenshot instead and never calls this.
 */
export function OfferShot({ kind }: { kind: string }) {
  const shot = SHOTS[kind] ?? SHOTS.deals;
  return (
    <div
      aria-hidden="true"
      // A black mat, not the shell tint the wells started on. The white rows
      // inside are the picture; a light frame around them made the whole panel
      // one soft grey shape and the rows disappeared into it. bg-ink is the
      // near-black already on the guarantee band, so this borrows a surface the
      // page has rather than inventing a second dark.
      className="flex h-full w-full flex-col gap-2.5 overflow-hidden rounded-[16px] bg-ink p-3.5 sm:p-4"
    >
      {shot}
    </div>
  );
}

/** A white row inside a well. */
function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[12px] border border-line bg-paper px-3 py-2.5 ${className}`}
    >
      {children}
    </div>
  );
}

/** The little ember pill every panel uses for a state. */
function Chip({ children, live }: { children: ReactNode; live?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-pill px-2 py-[3px] text-[10.5px] font-extrabold ${
        live ? "bg-live-soft text-live" : "bg-ember text-flame"
      }`}
    >
      {children}
    </span>
  );
}

/** A grey bar standing in for a line of text. */
function Bar({ w = "w-full" }: { w?: string }) {
  return <span className={`block h-[7px] rounded-pill bg-line ${w}`} />;
}

const SHOTS: Record<string, ReactNode> = {
  // a placed deal: who it is with, what it pays, what was agreed before filming
  deals: (
    <>
      <Row className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-ember text-[13px] font-extrabold text-flame">
          S
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-extrabold">Skincare brand</span>
          <span className="block text-[11px] text-ink-50">3 clips, 30 seconds</span>
        </span>
        <Chip live>Placed</Chip>
      </Row>

      <Row className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 text-[11.5px] font-semibold text-ink-50">
          Your rate
        </span>
        <span className="text-[20px] font-extrabold tabular-nums tracking-[-0.03em]">
          $750
        </span>
      </Row>

      <Row className="flex flex-1 flex-col justify-center gap-2">
        <span className="flex items-center gap-2">
          <Chip>Rate agreed</Chip>
          <Chip>Brief sent</Chip>
        </span>
        <Bar w="w-4/5" />
        <Bar w="w-3/5" />
      </Row>
    </>
  ),

  // the app: the month's money, and the chart the old drawn panel used
  dashboard: (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Row>
          <span className="block text-[11px] text-ink-50">This month</span>
          <span className="block text-[17px] font-extrabold tabular-nums tracking-[-0.03em]">
            $3,250
          </span>
        </Row>
        <Row>
          <span className="block text-[11px] text-ink-50">Owed to you</span>
          <span className="block text-[17px] font-extrabold tabular-nums tracking-[-0.03em]">
            $980
          </span>
        </Row>
      </div>

      <Row className="flex min-h-0 flex-1 flex-col gap-2.5">
        <span className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-extrabold">Views by video</span>
          <Chip>Auto pulled</Chip>
        </span>
        {/* fill, not intrinsic size: the file is 900x459 and at this column
            width that alone is taller than the copy in the block beside it. */}
        <span className="relative min-h-0 flex-1">
          <Image
            src={landingArt.miniChart.src}
            alt=""
            fill
            sizes="(max-width: 1024px) 90vw, 420px"
            className="object-contain object-bottom opacity-90"
          />
        </span>
      </Row>
    </>
  ),

  // the room: three people talking, and the call that is booked
  community: (
    <>
      <Row className="flex flex-1 flex-col justify-center gap-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex items-center gap-2.5">
            <FacePlaceholder index={i} className="size-7" />
            <span className="min-w-0 flex-1 space-y-1.5">
              <Bar w={i === 1 ? "w-3/5" : "w-4/5"} />
              <Bar w={i === 1 ? "w-2/5" : "w-1/2"} />
            </span>
          </span>
        ))}
      </Row>

      <Row className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-extrabold">Group call</span>
          <span className="block text-[11px] text-ink-50">
            Thursday, 11am ET
          </span>
        </span>
        <Chip live>Booked</Chip>
      </Row>
    </>
  ),

  // the cuts: a clip, the price of one, and what came back
  editing: (
    <>
      <div className="relative flex flex-1 items-center justify-center rounded-[12px] border border-line bg-ember">
        <span className="flex size-11 items-center justify-center rounded-full bg-flame text-on-accent shadow-[0_10px_24px_-12px_rgba(236,90,41,0.9)]">
          <svg viewBox="0 0 24 24" className="ml-[2px] size-[18px]" fill="currentColor">
            <path d="M8 5.6v12.8a.8.8 0 0 0 1.22.68l10.2-6.4a.8.8 0 0 0 0-1.36L9.22 4.92A.8.8 0 0 0 8 5.6Z" />
          </svg>
        </span>
        <span className="absolute inset-x-3 bottom-3 h-[6px] overflow-hidden rounded-pill bg-paper/70">
          <span className="block h-full w-2/3 rounded-pill bg-flame" />
        </span>
      </div>

      <Row className="flex items-center gap-2.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-extrabold">Cut 01</span>
          <span className="block text-[11px] text-ink-50">Back in 36 hours</span>
        </span>
        <Chip>From $1</Chip>
      </Row>
    </>
  ),
};
