"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { brand } from "@/lib/content";
import type { Viewer } from "@/lib/viewer";
import { BASE_PATH } from "@/lib/base-path";

/**
 * The account row at the foot of the editor rail, and the menu it opens.
 *
 * A copy of the creator rail's AccountMenu rather than a reuse of it, same
 * reason the two side-navs are copies: the destinations differ (an editor's
 * settings are not a creator's) and sharing would make every divergence a prop.
 *
 * The email used to print under the name in the rail itself, where a 224px
 * column truncated `yatinsaireddyseelam@gmail.com` down to
 * `yatinsaireddyseel…` — a line of height that answered nothing. It is still
 * worth showing, since you can be signed in as two people, so it moved into the
 * menu where there is room to print all of it.
 */
export function EditorAccountMenu({
  viewer,
  size = "rail",
}: {
  viewer: Viewer;
  /**
   * `rail` is the fixed column: a full-width row that opens upward, because
   * there is nothing below it but the bottom of the window. `bar` is the
   * mobile header: the picture alone, opening down off the right edge.
   */
  size?: "rail" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // pointerdown, not click: a click listener fires after the trigger's own
  // handler has already toggled, so pressing an open trigger would close and
  // reopen inside one frame.
  useEffect(() => {
    if (!open) return;

    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const rail = size === "rail";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          rail
            ? // on-rail-strong, not inherited ink: the rail's colour is set by
              // the org, and a dark ink made the name unreadable on a dark one.
              "flex w-full min-w-0 items-center gap-2.5 rounded-pill px-3 py-1.5 text-left text-on-rail-strong transition-colors hover:bg-rail-hover"
            : "rounded-full transition-opacity hover:opacity-80"
        }
      >
        <EditorAvatar viewer={viewer} />
        {rail && (
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold tracking-[-0.01em]">
            {viewer.name}
          </span>
        )}
        <span className="sr-only">account menu, {viewer.email}</span>
      </button>

      {open && (
        <div
          role="menu"
          /* wider than the 224px rail on purpose: this is where the full email
             is printed, and a menu that truncated it would be repeating the
             problem it exists to fix. the rail is fixed and does not clip. */
          className={`absolute z-50 w-[268px] rounded-card border border-line bg-paper py-1.5 shadow-[0_18px_50px_rgb(64_48_38_/_0.16)] ${
            rail ? "bottom-full left-0 mb-2" : "right-0 top-[46px]"
          }`}
        >
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <EditorAvatar viewer={viewer} className="size-10 text-[15px]" />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold leading-tight tracking-[-0.01em]">
                {viewer.name}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-ink-50">
                {viewer.email}
              </span>
            </span>
          </div>

          <Link
            href="/editors/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={ITEM}
          >
            <Gear />
            settings
          </Link>

          <Link
            href="/editors/payouts"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={ITEM}
          >
            <Card />
            payouts
          </Link>

          <a href={`mailto:${brand.contactEmail}`} role="menuitem" className={ITEM}>
            <QuestionCircle />
            get help
          </a>

          {/* a form, not a link. signing out is a state change, and a GET that
              changes state gets fired by every link prefetcher there is. */}
          <form
            action={`${BASE_PATH}/auth/sign-out`}
            method="post"
            className="mt-1.5 border-t border-line pt-1.5"
          >
            <button type="submit" role="menuitem" className={`${ITEM} w-full`}>
              <SignOut />
              sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * The picture, or the first letter when there is none or it fails to load.
 * Local to this file because the rail's avatar and the menu's are the same
 * drawing at two sizes and nothing else needs it.
 */
export function EditorAvatar({
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

const ITEM =
  "flex items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-semibold text-ink transition-colors hover:bg-shell";

/** Same 1.7 stroke language as the rail's own glyphs. */
const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Gear() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      <g {...s}>
        <circle cx="12" cy="12" r="3.1" />
        <path d="M12 3.6v2.2M12 18.2v2.2M20.4 12h-2.2M5.8 12H3.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6M17.9 17.9l-1.6-1.6M7.7 7.7 6.1 6.1" />
      </g>
    </svg>
  );
}

function Card() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      <g {...s}>
        <rect x="3" y="5.5" width="18" height="13" rx="2.6" />
        <path d="M3 10h18M6.6 14.6h3.4" />
      </g>
    </svg>
  );
}

function QuestionCircle() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      <g {...s}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M9.9 9.6a2.2 2.2 0 1 1 2.9 2.1c-.5.2-.8.6-.8 1.2v.4" />
        <path d="M12 16.4v.01" />
      </g>
    </svg>
  );
}

function SignOut() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      <g {...s}>
        <path d="M14 5.5H6.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H14" />
        <path d="M18.5 12H10M15.5 8.8l3.2 3.2-3.2 3.2" />
      </g>
    </svg>
  );
}
