import type { ReactNode } from "react";
import type { ToolSlug } from "@/lib/tools";

/**
 * One line glyph per tool, same drawing language as the nav and art.tsx: single
 * stroke weight, round caps, no fills. Every tile behind them is the same
 * ember, so the glyph is the only thing telling two cards apart — each one has
 * to read at 26px without its label.
 *
 * Keyed by ToolSlug on purpose. Add a tool without a glyph and this stops
 * compiling instead of rendering an empty tile.
 */
const toolGlyphs: Record<ToolSlug, ReactNode> = {
  // a month grid with a tick in it: the plan, and the day that got done
  workflow: (
    <>
      <rect x="3" y="4.6" width="18" height="16.4" rx="3" />
      <path d="M3 9.4h18M8 2.6v3.6M16 2.6v3.6" />
      <path d="m9 15.2 2.1 2.1 3.9-4" />
    </>
  ),

  // three stacked cards fanned out: one cut becoming many
  variations: (
    <>
      <rect x="3.4" y="7.6" width="10.5" height="13" rx="2.4" />
      <path d="M7.4 4.8h7.2a2.4 2.4 0 0 1 2.4 2.4v10.4" />
      <path d="M11 2.6h6.6a2.4 2.4 0 0 1 2.4 2.4v10" />
    </>
  ),

  // a waveform: audio, without drawing a microphone
  transcriber: <path d="M4 9.5v5M8 6v12M12 8.5v7M16 5v14M20 10v4" />,

  // an envelope with the flap open and a dot leaving it: mail that carries one
  // short thing out, which is the whole tool. not a padlock or a key, because
  // the codes are the product and the passwords are the filing cabinet.
  "account-emails": (
    <>
      <rect x="2.8" y="5.4" width="18.4" height="13.2" rx="3" />
      <path d="m3.6 8.4 8.4 5.1 8.4-5.1" />
    </>
  ),

  // a head and shoulders with a rising bar behind: a profile plus its numbers
  "profile-scraper": (
    <>
      <circle cx="9.2" cy="8.4" r="3.4" />
      <path d="M3.6 19.6c.7-3.2 2.8-4.9 5.6-4.9s4.9 1.7 5.6 4.9" />
      <path d="M17.4 13.6v6M20.8 9.4v10.2" />
    </>
  ),

  // a clock face over a paper plane's tail: a send with a time on it. the three
  // linked circles the Social rail row used to wear are gone with that row, and
  // they would be wrong here anyway — this card is about when things fire, not
  // about a network.
  autoposting: (
    <>
      <path d="M20.6 3.6 3.9 9.4l6.3 2.8 2.8 6.3z" />
      <circle cx="6.9" cy="17.4" r="3.9" />
      <path d="M6.9 15.4v2l1.3.8" />
    </>
  ),

  // the same phone the nav draws for My Portfolio. deliberately identical:
  // this card and that nav row open the same page, and giving one of them its
  // own shape would read as two different places.
  "my-portfolio": (
    <>
      <rect x="6" y="2.8" width="12" height="18.4" rx="3" />
      <path d="M9.5 9h5M9.5 12.5h5M9.5 16h3" />
    </>
  ),

};

export function ToolGlyph({
  slug,
  className = "size-[26px]",
}: {
  slug: ToolSlug;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {toolGlyphs[slug]}
      </g>
    </svg>
  );
}
