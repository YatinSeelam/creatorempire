"use client";

import { useState } from "react";
import type { Viewer } from "@/lib/viewer";

/**
 * Whoever is signed in, as a circle.
 *
 * Its own file rather than a private helper in the rail, because the rail's
 * footer row and the account menu that opens off it both draw one, and the menu
 * cannot import from the rail without the two files importing each other.
 *
 * `broken` is the whole reason this is a client component. A google avatar url
 * is a signed cdn link that expires, so the picture on a long-lived session
 * eventually 404s and an `<img>` with no handler leaves a torn-page icon in the
 * corner of the app. Falling back to the initial keeps the circle a circle.
 */
export function Avatar({
  viewer,
  className = "size-8",
}: {
  viewer: Viewer;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = viewer.avatarUrl;

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink text-[12px] font-bold text-white ${className}`}
    >
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="size-full object-cover"
        />
      ) : (
        viewer.initial
      )}
    </span>
  );
}
