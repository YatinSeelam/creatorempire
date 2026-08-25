"use client";

import { useState } from "react";
import { brandColor } from "@/lib/portfolio-schema";
import { onAccent } from "@/lib/portfolio-theme";

/**
 * One brand on the client wall.
 *
 * A tile, not a logo in a box. The old shape was a 68px white card with the
 * name printed underneath it, which meant a row of five brands cost two rows of
 * height, most of it empty, and every card was mostly white space around a
 * 40px mark. Mark and name on one line reads as a list of brands at any width
 * and drops to two columns on a phone without becoming a wall of nothing.
 *
 * The mark is white behind a logo and the brand's colour behind an initial.
 * Half the files in the catalogue are PNGs with a white background baked in, so
 * anything but white leaves them looking like stickers; a brand with no file at
 * all gets its colour, which is a mark rather than an absence.
 *
 * It is a client component for exactly one reason: `onError`. A logo url can
 * outlive the file behind it — a catalogue entry gets pulled, a storage object
 * is deleted — and a broken `img` renders its alt text, so the page ends up
 * printing the brand's name inside a box that already has the name next to it.
 * Falling back to the initial makes that failure invisible.
 */
export function BrandTile({
  name,
  logoUrl,
  color,
  strong,
}: {
  name: string;
  logoUrl: string;
  color: string;
  /** the weight class for the surrounding theme's font. */
  strong: string;
}) {
  const [broken, setBroken] = useState(false);
  const showLogo = Boolean(logoUrl) && !broken;
  const fill = brandColor(name, color);

  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[14px] border border-[var(--pf-line)] bg-[var(--pf-panel)] px-2.5 py-2.5 @2xl:gap-3 @2xl:px-3 @2xl:py-3">
      <span
        className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[10px] @2xl:size-10"
        style={
          showLogo
            ? { background: "#ffffff" }
            : { background: fill, color: onAccent(fill) }
        }
      >
        {showLogo ? (
          // catalogue paths and storage urls both, so no domain to whitelist
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            // onError alone is not enough. The markup is server-rendered, so a
            // dead url has usually already failed by the time React hydrates
            // and attaches the handler — the event fired at nobody and the
            // broken-image glyph stayed on the page. An image that finished
            // loading with no intrinsic width is one that failed, and this is
            // the only moment left to ask.
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setBroken(true);
            }}
            className="size-full object-contain p-[3px]"
          />
        ) : (
          <span className={`text-[14px] leading-none ${strong}`}>
            {(name.trim() || "?").charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      <span
        className={`min-w-0 flex-1 truncate text-[13px] tracking-[-0.01em] text-[var(--pf-text)] @2xl:text-[13.5px] ${strong}`}
      >
        {name}
      </span>
    </div>
  );
}
