/**
 * The line icons the dash uses outside the rail.
 *
 * Drawn here rather than pulled from an icon package for the same reason
 * `platform-glyph` is: a handful of 24px marks is a few hundred bytes against a
 * dependency, and they have to inherit both size and colour from whatever they
 * are dropped into. One `viewBox`, one stroke weight, one cap style, so a row of
 * them reads as one set instead of four fonts.
 *
 * Size is the caller's job (`className="size-[18px]"`), colour is inherited.
 */

const paths = {
  /** a deal: a clip with a play in it. the videos are the deal. */
  deal: (
    <>
      <rect x="2.75" y="5" width="18.5" height="14" rx="4" />
      <path d="m10.4 9.6 4.6 2.4-4.6 2.4z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.25" y="4.75" width="17.5" height="16" rx="4" />
      <path d="M3.5 9.5h17M8 3v3.4M16 3v3.4" />
    </>
  ),
  /** views: what the number counts is somebody watching. */
  eye: (
    <>
      <path d="M2.4 12S6 5.75 12 5.75 21.6 12 21.6 12 18 18.25 12 18.25 2.4 12 2.4 12Z" />
      <circle cx="12" cy="12" r="3.15" />
    </>
  ),
  money: (
    <>
      <circle cx="12" cy="12" r="9.1" />
      <path d="M14.4 9.4a2.6 2.6 0 0 0-2.4-1.35c-1.4 0-2.4.8-2.4 1.9 0 2.6 5 1.4 5 4.1 0 1.15-1.05 1.95-2.6 1.95a2.7 2.7 0 0 1-2.5-1.4M12 6.5v11" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3 1.9" />
    </>
  ),
} as const;

export type GlyphName = keyof typeof paths;

export function Glyph({
  name,
  className = "size-[18px]",
}: {
  name: GlyphName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * The row's own menu. Three dots rather than a word, because it sits at the end
 * of eight columns that are all numbers and a labelled button there would read
 * as a ninth.
 */
export function Dots({ className = "size-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`} fill="currentColor">
      <circle cx="12" cy="5.5" r="1.55" />
      <circle cx="12" cy="12" r="1.55" />
      <circle cx="12" cy="18.5" r="1.55" />
    </svg>
  );
}
