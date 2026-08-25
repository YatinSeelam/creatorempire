"use client";

import { useRef, useState } from "react";

/**
 * A clip's poster frame, everywhere autoposting draws a video.
 *
 * There is no cover column in the database and no render job to make one, so
 * this asks the browser for the frame instead: a muted `<video>` with a
 * `#t=` media fragment on the url, which every current engine honours by
 * seeking there and painting that frame at `preload="metadata"`. That is a few
 * hundred kilobytes of range request per clip and no canvas, no CORS taint, and
 * nothing to store.
 *
 * Hovering plays it. A picker of nine near-identical vertical cuts is the one
 * place where two seconds of motion tells you which one it is and a still frame
 * does not, and it costs nothing until a pointer is actually over the tile.
 *
 * Falls back to the film glyph when there is no playable url (a pasted youtube
 * link, a sentinel that would not sign) or when the element errors, so a dead
 * source reads as "no preview" rather than as a broken page.
 */

const sizes = {
  sm: "h-12 w-9 rounded-[8px]",
  md: "h-[58px] w-11 rounded-[9px]",
  lg: "h-[76px] w-[54px] rounded-[10px]",
  tile: "aspect-[9/16] w-full rounded-xl",
} as const;

export function ClipThumb({
  src,
  size = "sm",
  /** the seconds into the clip the poster frame is taken from */
  at = 0.6,
  className = "",
}: {
  src: string | null;
  size?: keyof typeof sizes;
  at?: number;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [dead, setDead] = useState(false);
  // a source swap (a picker re-ordering, a queue refreshing) has to clear the
  // last one's failure or the tile stays a glyph forever. adjusted in render
  // rather than an effect so the new src's first paint is the new src.
  const [tracked, setTracked] = useState(src);
  if (tracked !== src) {
    setTracked(src);
    setDead(false);
  }

  const shell = `relative flex shrink-0 items-center justify-center overflow-hidden border border-line bg-shell ${sizes[size]} ${className}`;

  if (!src || dead) {
    return (
      <span aria-hidden="true" className={shell}>
        <FilmGlyph />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${shell} group/thumb`}
      onPointerEnter={() => {
        const el = ref.current;
        // a play() that loses a race with an unmount rejects, and an unhandled
        // rejection here would be a console error on every fast mouse pass.
        if (el) void el.play().catch(() => {});
      }}
      onPointerLeave={() => {
        const el = ref.current;
        if (!el) return;
        el.pause();
        el.currentTime = at;
      }}
    >
      <video
        ref={ref}
        src={`${src}#t=${at}`}
        muted
        playsInline
        loop
        preload="metadata"
        onError={() => setDead(true)}
        className="size-full object-cover"
      />
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-ink/10 opacity-100 transition-opacity group-hover/thumb:opacity-0">
        <PlayGlyph />
      </span>
    </span>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-paper drop-shadow" aria-hidden="true">
      <path d="m8 5 12 7-12 7z" fill="currentColor" />
    </svg>
  );
}

function FilmGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-ink-50" aria-hidden="true">
      <rect
        x="3"
        y="4"
        width="18"
        height="16"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor" />
    </svg>
  );
}
