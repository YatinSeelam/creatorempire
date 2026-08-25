// The page's pictures, in two kinds.
//
// The big illustrations are files now (`landingArt` below, off /public/landing).
// The small marks are still paths, because a tick, a cross and a 20px glyph
// have to take `currentColor` and sit on the text baseline, which a png cannot
// do. Anything bigger than a line of text belongs in the file set.

import Image from "next/image";

type ArtProps = { className?: string };

/**
 * The landing page's illustrations, which are files rather than paths.
 *
 * `public/landing/*.png` is the real art set: line drawings on transparent,
 * cropped to their own ink and quantised to a few kilobytes each. It replaced
 * a hand-written svg set (isometric bars, a stack of clips, a foil seal) that
 * only existed because the art had not arrived yet. Do not draw a replacement
 * in code when one of these will do — two drawing languages on one page is
 * exactly what the svg set cost us.
 *
 * `w`/`h` are each file's true pixel size, which is what next/image needs to
 * hold the space before the png lands. Re-measure when a file is swapped.
 */
export const landingArt = {
  creator: { src: "/landing/creator.png", w: 560, h: 541 },
  growthBars: { src: "/landing/growth-bars.png", w: 512, h: 436 },
  guaranteeBadge: { src: "/landing/guarantee-badge.png", w: 512, h: 501 },
  // no caller today. it was the chart inside the drawn dashboard panel, and
  // that panel is gone now the blocks carry a real picture well instead. left
  // in the registry because the file is part of the art set, not a leftover.
  miniChart: { src: "/landing/mini-chart.png", w: 900, h: 459 },
} as const;

export type LandingArtName = keyof typeof landingArt;

/**
 * One of them, sized by whatever box it is put in. Decorative everywhere it is
 * used, so the alt is empty on purpose: the heading beside each of these
 * already carries the meaning, and a reader hearing "rising bar chart" three
 * times down one page is being read the wallpaper.
 */
export function LandingArt({
  name,
  className = "",
}: {
  name: LandingArtName;
  className?: string;
}) {
  const a = landingArt[name];
  return (
    <Image
      src={a.src}
      alt=""
      width={a.w}
      height={a.h}
      aria-hidden="true"
      className={`object-contain ${className}`}
    />
  );
}

/** Orange tick in a circle. Used anywhere a line is a win. */
export function CheckMark({ className = "size-5" }: ArtProps) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-flame ${className}`}
    >
      <svg viewBox="0 0 12 12" className="size-3 text-white" aria-hidden="true">
        <path
          d="M2.5 6.4l2.4 2.4L9.6 3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

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
      src="/logo-mark.png"
      alt="creator empire"
      width={512}
      height={512}
      priority
      className={`shrink-0 ${className}`}
    />
  );
}

/**
 * The social marks in the footer. Single paths, filled rather than stroked,
 * because a 16px stroked logo reads as a smudge next to the wordmark.
 */
const socialPaths: Record<string, string> = {
  instagram:
    "M12 2.2c3.2 0 3.6 0 4.9.07 1.2.05 1.8.25 2.2.42.6.22 1 .48 1.4.9.43.42.7.82.92 1.4.17.42.37 1.05.42 2.25.06 1.3.07 1.68.07 4.9s0 3.6-.07 4.9c-.05 1.2-.25 1.8-.42 2.2-.22.6-.5 1-.92 1.4-.42.43-.82.7-1.4.92-.42.17-1.05.37-2.25.42-1.3.06-1.68.07-4.9.07s-3.6 0-4.9-.07c-1.2-.05-1.8-.25-2.2-.42-.6-.22-1-.5-1.4-.92a3.9 3.9 0 0 1-.92-1.4c-.17-.42-.37-1.05-.42-2.25C2.21 15.6 2.2 15.2 2.2 12s0-3.6.07-4.9c.05-1.2.25-1.8.42-2.2.22-.6.5-1 .92-1.4.42-.43.82-.7 1.4-.92.42-.17 1.05-.37 2.25-.42C8.4 2.21 8.8 2.2 12 2.2Zm0 1.8c-3.15 0-3.5.01-4.74.07-1.14.05-1.76.24-2.17.4-.55.22-.94.47-1.35.88-.4.4-.66.8-.87 1.35-.16.41-.35 1.03-.4 2.17C2.4 8.9 2.4 9.25 2.4 12s.01 3.1.07 4.34c.05 1.14.24 1.76.4 2.17.21.55.47.94.87 1.35.41.4.8.66 1.35.87.41.16 1.03.35 2.17.4 1.24.06 1.6.07 4.74.07s3.5-.01 4.74-.07c1.14-.05 1.76-.24 2.17-.4.55-.21.94-.47 1.35-.87.4-.41.66-.8.87-1.35.16-.41.35-1.03.4-2.17.06-1.24.07-1.6.07-4.34s-.01-3.1-.07-4.34c-.05-1.14-.24-1.76-.4-2.17a3.6 3.6 0 0 0-.87-1.35 3.6 3.6 0 0 0-1.35-.87c-.41-.16-1.03-.35-2.17-.4C15.5 4.01 15.15 4 12 4Zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8Zm0 1.8a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2Zm5.1-2.4a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z",
  tiktok:
    "M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 1 1 .77-5.06V9.66a5.67 5.67 0 0 0-.77-.05A5.6 5.6 0 1 0 15.46 15V8.9a7.32 7.32 0 0 0 4.28 1.38V7.2a4.3 4.3 0 0 1-3.14-1.38Z",
  youtube:
    "M21.6 7.2a2.5 2.5 0 0 0-1.75-1.77C18.3 5 12 5 12 5s-6.3 0-7.85.43A2.5 2.5 0 0 0 2.4 7.2 26.1 26.1 0 0 0 2 12a26.1 26.1 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.75 1.77C5.7 19 12 19 12 19s6.3 0 7.85-.43a2.5 2.5 0 0 0 1.75-1.77A26.1 26.1 0 0 0 22 12a26.1 26.1 0 0 0-.4-4.8ZM10 15.1V8.9l5.2 3.1-5.2 3.1Z",
  x: "M17.5 3h3.2l-7 8 8.2 10h-6.4l-5-6.1-5.7 6.1H1.6l7.5-8.6L1.2 3h6.6l4.5 5.6L17.5 3Zm-1.1 16.1h1.8L7.7 4.8H5.8l10.6 14.3Z",
};

export function SocialIcon({
  name,
  className = "size-[18px]",
}: {
  name: string;
  className?: string;
}) {
  const d = socialPaths[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/**
 * Stand-ins for creator profile pictures.
 *
 * Drawn, not photographed, and deliberately so: a stock headshot beside "15
 * creators so far" is a stranger's face attached to a claim about our own
 * members. These are obviously illustrations — a head, a shoulder line and a
 * garment, in four tints so a row of them does not read as one avatar stamped
 * five times — which is what a placeholder is supposed to look like.
 *
 * Swap them out by dropping real headshots in /public/faces and passing them
 * through the `avatars` prop on whichever pile is showing.
 */
const faceTints = [
  { skin: "#e8b48f", hair: "#4a342a", top: "#f0a882" },
  { skin: "#d9976a", hair: "#2f2320", top: "#e8caa9" },
  { skin: "#f0c9a8", hair: "#8a5a34", top: "#c9c3bb" },
  { skin: "#a9714b", hair: "#241a17", top: "#f2b39a" },
  { skin: "#f2d3b6", hair: "#5c4632", top: "#d8b7a3" },
];

/** One drawn head, sized by the box it is put in. */
export function FacePlaceholder({
  index = 0,
  className = "size-10",
}: {
  index?: number;
  className?: string;
}) {
  const t = faceTints[index % faceTints.length];

  return (
    <span
      className={`block shrink-0 overflow-hidden rounded-full ring-2 ring-paper ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 40 40" className="size-full">
        <rect width="40" height="40" fill="#f4ece5" />
        <path d="M4 40c0-8.6 7.2-13.6 16-13.6S36 31.4 36 40Z" fill={t.top} />
        <circle cx="20" cy="16.4" r="7.6" fill={t.skin} />
        <path
          d="M12.4 15.6c0-4.3 3.4-7 7.6-7s7.6 2.7 7.6 7c-1.5-2.5-4.2-3.6-7.6-3.6s-6.1 1.1-7.6 3.6Z"
          fill={t.hair}
        />
      </svg>
    </span>
  );
}

/**
 * A row of them, overlapping, with a counter on the end.
 *
 * `more` is the number the counter shows. Pass 0 or leave it off and the
 * counter does not render, which is the shape this takes when the whole group
 * fits in the row.
 */
export function FacePile({
  count = 4,
  more = 0,
  className = "size-10",
}: {
  count?: number;
  more?: number;
  className?: string;
}) {
  return (
    <span className="flex -space-x-2.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <FacePlaceholder key={i} index={i} className={className} />
      ))}
      {more > 0 && (
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-flame text-[12px] font-extrabold text-on-accent ring-2 ring-paper ${className}`}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
