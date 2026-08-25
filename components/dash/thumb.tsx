"use client";

import { useState } from "react";

/**
 * A platform thumbnail, served through our own origin.
 *
 * Platform cdn urls expire in days, so next/image would cache and optimise
 * something already dead by the time anyone looked twice. A dead one falls to a
 * neutral block rather than the browser's broken glyph.
 *
 * Lives here rather than inside the scraper because the admin view draws the
 * same covers off the same rows, and two copies of the fallback logic is how one
 * of them quietly stops matching.
 */
export function Thumb({
  src,
  fallback,
  className,
}: {
  src: string | null;
  fallback?: string;
  className: string;
}) {
  const [broken, setBroken] = useState(false);

  // a new row can land on this slot while the component stays mounted, and a
  // previous failure must not stick to it. this is the "adjust state when a
  // prop changes" pattern rather than an effect: an effect would paint the old
  // fallback for a frame first, and setState inside one cascades a second
  // render every time the table re-sorts.
  const [seenSrc, setSeenSrc] = useState(src);
  if (seenSrc !== src) {
    setSeenSrc(src);
    setBroken(false);
  }

  if (!src || broken) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center bg-ember text-[12px] font-bold text-flame ${className}`}
      >
        {fallback ?? ""}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // through our own origin, never straight at the cdn. the raw urls are
      // live and fetchable from a server but not from a browser: they carry a
      // session token from the api call that made them, the cdns judge a
      // cross-site image request on more than its referer, and a tracker
      // blocker has cdninstagram.com listed before either of those matters.
      // /api/scrape/thumb makes every one of these same-origin.
      src={`/api/scrape/thumb?u=${encodeURIComponent(src)}`}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`shrink-0 object-cover ${className}`}
    />
  );
}

/**
 * Somebody's face, or the first letter of their email when there isn't one.
 *
 * Straight at the source rather than through /api/scrape/thumb: these are google
 * and supabase-storage urls, both of which a browser can fetch, and the proxy's
 * allowlist exists for expiring platform cdns. Google does rotate the urls, so a
 * dead one still has to fall back to the letter rather than a broken glyph.
 */
export function PersonAvatar({
  src,
  initial,
  className = "size-10",
}: {
  src: string | null;
  initial: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink text-[13px] font-bold text-white ${className}`}
    >
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        initial
      )}
    </span>
  );
}
