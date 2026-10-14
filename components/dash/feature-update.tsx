"use client";

/**
 * The one-time "what's new" card.
 *
 * Shown once per browser (a localStorage flag keyed on the feature), never
 * while a founder is viewing as somebody, and closed for good by either
 * button. A storage that throws (private mode, blocked site data) shows
 * nothing rather than nagging on every page.
 *
 * To announce the next feature, change `FEATURE` and the copy. A new key is
 * a new card; the old one stays dismissed.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

const FEATURE = "autopost-cover-picker";
const KEY = `ce:feature-update:${FEATURE}`;

export function FeatureUpdate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // through a tick, so nothing reads the store during render.
    const t = setTimeout(() => {
      try {
        if (!window.localStorage.getItem(KEY)) setOpen(true);
      } catch {
        // no storage, no card.
      }
    }, 600);
    return () => clearTimeout(t);
  }, []);

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(KEY, new Date().toISOString());
    } catch {
      // closing still closes; it just may ask again next visit.
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-update-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] overflow-hidden rounded-card border border-line bg-paper shadow-xl"
      >
        <Strip />
        <div className="p-5">
          <span className="inline-flex rounded-pill bg-flame px-2 py-0.5 text-[11px] font-bold text-on-accent">
            feature update
          </span>
          <h2
            id="feature-update-title"
            className="mt-2.5 text-[20px] font-bold leading-[1.2] tracking-[-0.02em] text-ink"
          >
            pick your own thumbnail
          </h2>
          <p className="mt-2 text-[14px] leading-[1.55] text-ink-70">
            the autoposter can now set which frame each video opens on. on the captions
            step, tap a clip&apos;s thumbnail, pick the frame, and it goes out as the cover
            on tiktok and instagram reels.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Link
              href="/tools/autoposting"
              onClick={close}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-flame px-4 text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90"
            >
              try it
            </Link>
            <button
              type="button"
              onClick={close}
              className="inline-flex h-10 items-center justify-center rounded-[10px] border border-line px-4 text-[14px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** a picture of the feature: a strip of frames with one picked. */
function Strip() {
  const tones = [0.18, 0.3, 0.55, 0.38, 0.24];
  return (
    <div className="flex items-end justify-center gap-2 bg-shell px-5 pb-4 pt-6">
      {tones.map((t, i) => {
        const picked = i === 2;
        return (
          <div
            key={i}
            className={`relative aspect-[9/16] rounded-[8px] ${
              picked ? "w-[64px] ring-2 ring-flame ring-offset-2 ring-offset-shell" : "w-[44px]"
            }`}
            style={{
              background: `linear-gradient(160deg, color-mix(in srgb, var(--color-flame) ${Math.round(
                t * 100
              )}%, var(--color-ink)), var(--color-ink))`,
            }}
          >
            {picked && (
              <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-flame px-1.5 text-[10px] font-bold text-on-accent">
                cover
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
