"use client";

import { useState } from "react";
import { fallbackLogo } from "@/lib/brand-catalog";

/**
 * A brand's square. The logo when there is one, its initial when there is not.
 *
 * `contain`, never `cover`: half the marks in the catalogue are wordmarks, and
 * a cropped wordmark reads as a mistake where a small one reads as a logo. The
 * shell tile behind it is what stops a white png from disappearing into a white
 * card and a dark one from floating with no edge.
 *
 * No `next/image`: the sources are a mix of catalogue paths, favicons and
 * uploaded urls, so there is no fixed domain to whitelist and nothing here is
 * big enough for the optimiser to earn its round trip.
 *
 * It is a client component for one reason: `onError`. Some marks are now the
 * brand's own favicon rather than a file in `public/`, and a favicon can be
 * missing on a site that is otherwise fine. A dead one gets a single retry
 * against the other icon service, which serves the apple-touch-icon plenty of
 * sites have when the plain favicon does not exist, and then falls through to
 * the initial. `onError` alone is not enough here: this markup is
 * server-rendered, so a dead url has usually already failed by the time React
 * hydrates and attaches the handler. An image that finished loading with no
 * intrinsic width is one that failed, and the ref is the only moment left to
 * ask.
 */

const sizes = {
  sm: { box: "size-9", type: "text-[13px]", pad: "p-px" },
  md: { box: "size-11", type: "text-[15px]", pad: "p-px" },
  lg: { box: "size-14", type: "text-[19px]", pad: "p-0.5" },
} as const;

/** The site a favicon url stands for, so it can be retried elsewhere. */
function domainOf(logo: string): string | null {
  const s2 = /[?&]domain=([^&]+)/.exec(logo);
  if (s2) return decodeURIComponent(s2[1]);
  return null;
}

export function BrandMark({
  name,
  logo,
  size = "sm",
}: {
  name: string;
  /** "" when the brand has no mark. Never pass a url you have not resolved. */
  logo: string;
  size?: keyof typeof sizes;
}) {
  const s = sizes[size];
  const [attempt, setAttempt] = useState(0);
  // a card that swaps to another brand starts its own attempts over. adjusted
  // during render rather than in an effect, so the new logo's first paint is
  // the new logo and not one frame of the old one's failure.
  const [tracked, setTracked] = useState(logo);
  if (tracked !== logo) {
    setTracked(logo);
    setAttempt(0);
  }

  const retry = domainOf(logo);
  const src = attempt === 0 ? logo : attempt === 1 && retry ? fallbackLogo(retry) : "";

  return (
    <span
      className={`flex ${s.box} shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-shell ${src ? s.pad : ""}`}
      aria-hidden="true"
    >
      {src ? (
        // catalogue paths, favicons and storage urls all at once, so there is
        // no one domain to configure and nothing here is big enough to optimise
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setAttempt((n) => n + 1)}
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setAttempt((n) => n + 1);
          }}
          className="h-full w-full rounded-[inherit] object-contain"
        />
      ) : (
        <span className={`${s.type} font-extrabold text-ink-50`}>
          {(name.trim() || "?").charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
