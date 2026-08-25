import Image from "next/image";
import type { ReactNode } from "react";

/**
 * The four marks the offer wears.
 *
 * These are drawings now, not paths. `public/landing/*.png` is the real art set
 * (line icons on transparent, cropped to their own ink and quantised down to a
 * couple of kilobytes each), and they replaced a hand-written svg set that was
 * only ever a stand-in for them.
 *
 * No tile behind them any more either. The ember square was there to give the
 * old 24-box glyphs some presence on a white card; a drawing this size does not
 * need one, and the tile was the loudest thing in a row of four cards whose job
 * is to be scanned.
 *
 * `width`/`height` are the file's true pixel size. next/image needs the ratio to
 * hold the space before the png lands, so re-measure when a file is replaced.
 */
const ART: Record<string, { src: string; w: number; h: number; alt: string }> = {
  deals: { src: "/landing/icon-deals.png", w: 256, h: 174, alt: "" },
  dashboard: { src: "/landing/growth-bars.png", w: 512, h: 436, alt: "" },
  community: { src: "/landing/icon-community.png", w: 256, h: 230, alt: "" },
  editor: { src: "/landing/icon-editing.png", w: 256, h: 243, alt: "" },
  // unused by the four core offers, kept because the art set has it and a
  // future row (a brief, a rate sheet) is what it is for.
  book: { src: "/landing/icon-book.png", w: 256, h: 192, alt: "" },
};

/** One mark, drawn to fit a box `size` tall. Decorative: the card's own heading
 *  carries the meaning, so the alt is empty on purpose. */
export function OfferGlyph({
  kind,
  size = 44,
}: {
  kind: string;
  size?: number;
}) {
  const art = ART[kind] ?? ART.deals;

  return (
    <span
      className="flex shrink-0 items-end"
      style={{ height: size }}
      aria-hidden="true"
    >
      <Image
        src={art.src}
        alt={art.alt}
        width={art.w}
        height={art.h}
        style={{ height: size, width: "auto" }}
        className="object-contain"
      />
    </span>
  );
}

/** The chip a row wears when the thing is built but still gated off. */
export function SoonChip({ label }: { label: string }) {
  return (
    <span className="inline-block translate-y-[-1px] rounded-pill bg-ember px-2.5 py-[3px] align-middle text-[10px] font-extrabold uppercase tracking-[0.09em] text-flame">
      {label}
    </span>
  );
}

/**
 * The marks down the left of the receipt, one per line item.
 *
 * These are paths rather than files, unlike `OfferGlyph` above. They render at
 * 19px inside a 40px ember tile, which is a size the drawn png set does not
 * survive — a line drawing cropped to its own ink turns to mush at that scale,
 * and it cannot take `currentColor`, so it could not be the flame the tile is
 * tinted for. Anything bigger than this still belongs in the file set.
 */
const STACK: Record<string, ReactNode> = {
  // a placed deal
  deals: (
    <path
      fillRule="evenodd"
      d="M9 3h6a2.5 2.5 0 0 1 2.5 2.5V7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5V5.5A2.5 2.5 0 0 1 9 3Zm.5 4h5V5.5a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 0-.5.5V7Z"
      clipRule="evenodd"
    />
  ),
  // the call every two weeks
  calls: (
    <path d="M7.2 2.8c.9-.5 2 .0 2.5.9l1.3 2.4c.4.8.2 1.8-.5 2.3l-1 .8a10.5 10.5 0 0 0 4.3 4.3l.8-1c.5-.7 1.5-.9 2.3-.5l2.4 1.3c.9.5 1.2 1.6.8 2.5l-.8 1.5c-.6 1-1.8 1.5-2.9 1.2A17.5 17.5 0 0 1 3.6 6.7c-.3-1.1.2-2.3 1.2-2.9l2.4-1Z" />
  ),
  // the app
  dashboard: (
    <>
      <rect x="3" y="13" width="4.4" height="8" rx="1.4" />
      <rect x="9.8" y="8" width="4.4" height="13" rx="1.4" />
      <rect x="16.6" y="3" width="4.4" height="18" rx="1.4" />
    </>
  ),
  // the tools
  tools: (
    <>
      <circle cx="12" cy="12" r="3.4" />
      <path
        d="M12 1.5v3.2M12 19.3v3.2M1.5 12h3.2M19.3 12h3.2M4.6 4.6l2.3 2.3M17.1 17.1l2.3 2.3M19.4 4.6l-2.3 2.3M6.9 17.1l-2.3 2.3"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </>
  ),
  // the room
  community: (
    <>
      <circle cx="9.2" cy="7.8" r="3.4" />
      <circle cx="17" cy="9" r="2.7" />
      <path d="M2.6 19.4c0-3.3 2.9-5.6 6.6-5.6s6.6 2.3 6.6 5.6a.6.6 0 0 1-.6.6H3.2a.6.6 0 0 1-.6-.6Z" />
      <path d="M17.7 13.3c2.4.4 3.9 2.1 3.9 4.4a.6.6 0 0 1-.6.6h-3.4c0-2-.7-3.7-1.9-4.9a7 7 0 0 1 2-.1Z" />
    </>
  ),
  // the cuts
  editor: (
    <path d="M4.6 3.2a1.2 1.2 0 0 1 1.7.4l5.7 9.6 2-3.4a3.9 3.9 0 1 1-1.4 4.9l-.6 1-.6-1a3.9 3.9 0 1 1-1.4-4.9l1 1.7L4.2 4.9a1.2 1.2 0 0 1 .4-1.7ZM7.1 16a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Zm9.8 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z" />
  ),
};

/** One line item's mark, drawn to fit the ember tile it sits in. */
export function StackIcon({
  name,
  className = "size-[19px]",
}: {
  name: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {STACK[name] ?? STACK.deals}
    </svg>
  );
}
