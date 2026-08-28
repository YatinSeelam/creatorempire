// The app's small pictures: the glyph set and the brand mark.
//
// The landing illustrations, the tick, the social marks and the face
// placeholders all went with the marketing page they were drawn for. What is
// left is used inside the app: paths, because a 20px glyph has to take
// `currentColor` and sit on the text baseline, which a png cannot do.

import Image from "next/image";
import { BASE_PATH } from "@/lib/base-path";

type ArtProps = { className?: string };

/**
 * The account page's icon set. Same drawing language as the big art above —
 * one stroke weight, no fills — but drawn on a 24 box so they hold up at
 * 20-24px next to a line of text.
 *
 * Keyed by name rather than exported one by one, so the copy in content.ts can
 * name its own icon and the page never grows a switch statement.
 */
export const glyphs = {
  /** a seat, for "your spot is held" */
  seat: "M7 20v-2M17 20v-2M6 18h12a1 1 0 0 0 1-1v-3H5v3a1 1 0 0 0 1 1ZM7 14V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v8",
  /** scissors, for the editor */
  editor:
    "M6.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8.7 7.3 19 19M8.7 16.7 19 5",
  /** a handshake reduced to two arms, for a brand deal */
  deals: "M3 11h3l3 3 2-2 4 4M21 11h-3l-4-4-3 2M8 14l-2 2M16 16l2 2",
  /** calendar, for a date on the account receipt */
  calendar:
    "M4 8h16M8 3v3M16 3v3M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM8 12h2M8 16h2M14 12h2",
  /** a card, for what they are paying */
  card: "M3 9h18M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM6 14h4",
  /** a speech bubble, for talking to a person */
  chat: "M20 12a7 7 0 0 1-7 7H8l-4 3v-4.6A7 7 0 0 1 6 6.9 7 7 0 0 1 11 5h2a7 7 0 0 1 7 7Z",
  /** a shield, for the guarantee and for stripe */
  shield: "M12 3l7 3v5c0 4.2-2.8 7.7-7 10-4.2-2.3-7-5.8-7-10V6l7-3Z",
  /** a padlock, for the seat coming off the board */
  lock: "M8 10V7a4 4 0 1 1 8 0v3M6 10h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z",

  // ---- the b2b page (/mentorships) ----
  // A mentor skims this page in about twenty seconds, so every tile leads with a
  // picture and follows with four words. These are drawn at the same weight as
  // the set above so the two pages never look like two products.

  /** a banknote, for money owed and money paid */
  money: "M3 8h18v9H3V8ZM12 15a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  /** a film strip, for scripts and cuts */
  content: "M4 6h16v12H4V6ZM4 10h16M9 6v4M15 6v4",
  /** a paper plane, for posting */
  posting: "M21 4 3 11l7 3 3 7 8-17ZM10 14l4-6",
  /** two people, for clients and for a roster of students */
  clients:
    "M9 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5M16.5 11.2a3 3 0 0 0 0-6M18 19.5c0-2.2-1-3.8-2.5-4.6",
  /** an open book, for courses */
  courses:
    "M12 7c-1.6-1.3-4-2-7-2v12c3 0 5.4.7 7 2 1.6-1.3 4-2 7-2V5c-3 0-5.4.7-7 2ZM12 7v12",
  /** a spark, for a brand deal landing in front of a student */
  opportunity:
    "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8",
  /** a palette, for their logo and colours */
  brand:
    "M12 20a8 8 0 1 1 8-8c0 2-1.6 3-3.2 3H15a2 2 0 0 0-1.4 3.4c.5.6.1 1.6-.6 1.6ZM8.5 9.5h.01M12 8h.01M15.5 9.5h.01M7.5 13h.01",
  /** a globe, for their own domain */
  domain:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.4 3.4 5.6 3.4 9S14.2 18.6 12 21c-2.2-2.4-3.4-5.6-3.4-9S9.8 5.4 12 3Z",
  /** a browser window, for the landing page we build them */
  page: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM3 9h18M6.5 7h.01M9 7h.01",
  /** a chart going up, for what a graduate is worth */
  growth: "M4 19V5M4 19h16M8 15l3-4 3 2 4-6",
  /** a dollar in a circle, for anything about money coming in */
  dollar:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 6.6v10.8M14.6 9.4c0-1-1.2-1.7-2.6-1.7s-2.6.8-2.6 1.8 1 1.5 2.6 1.9 2.6.9 2.6 1.9-1.2 1.8-2.6 1.8-2.6-.7-2.6-1.7",
  /** a tick in a circle, for a fact rather than a list item */
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8.1 12.2l2.7 2.7 5.1-5.3",
  /** a building, for a student who starts an agency */
  agency:
    "M4 20V6l7-3v17M11 20h9V10l-9-3M7 9h.4M7 12.5h.4M7 16h.4M14.5 12.5h.4M17.5 12.5h.4M14.5 16h.4M17.5 16h.4",
  /** a cube, for a student who builds software */
  saas: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3ZM4 7.5l8 4.5 8-4.5M12 12v9",
  /** a camera, for a student who stays a creator */
  creator:
    "M15 7h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-2h3L15 7ZM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4",
  /** a phone, for the calls that do not scale */
  phone:
    "M8 3.5 10 8l-2 1.6a11 11 0 0 0 6.4 6.4L16 14l4.5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.7 2 2 0 0 1 5 3.5h3Z",
  /** a clock, for month four */
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 2",
  /** a sheet of paper, for the notion doc that is not a system */
  doc: "M6 3h8l4 4v14H6V3ZM14 3v4h4M9.5 12h5M9.5 16h5",
  /** an open door, for the student who walks */
  exit: "M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M11 8l-4 4 4 4M7 12h9",
} as const;

export type GlyphName = keyof typeof glyphs;

/** One icon from the set above. */
export function Glyph({
  name,
  className = "size-5",
}: {
  name: GlyphName;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d={glyphs[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The logo mark. public/logo.png is the artwork — it is already transparent, so
 * it renders directly. public/logo-mark.png is that same file cropped square and
 * centred on the tile (logo.png leaves a lot of empty room around it, which made
 * the mark render tiny at nav sizes) and downscaled to 512.
 *
 * public/logo.svg and app/icon.svg are the same bitmap wrapped in an <svg>, so
 * every surface shows one identical mark. Regenerate all three from logo.png if
 * the artwork changes.
 */
export function Mark({ className = "size-8" }: ArtProps) {
  return (
    <Image
      // basePath by hand: next/image leaves `src` alone. see lib/base-path.ts
      src={`${BASE_PATH}/logo-mark.png`}
      alt="creator empire"
      width={512}
      height={512}
      priority
      className={`shrink-0 ${className}`}
    />
  );
}
