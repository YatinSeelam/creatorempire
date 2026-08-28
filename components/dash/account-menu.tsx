"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { brand } from "@/lib/content";
import type { Viewer } from "@/lib/viewer";
import { Avatar } from "./avatar";
import { BASE_PATH } from "@/lib/base-path";

/**
 * The account row at the foot of the rail, and the menu it opens.
 *
 * The row itself is a picture and a name. The email used to sit under it and
 * was the widest string in the whole app: a 224px rail truncated
 * `yatinsaireddyseelam@gmail.com` down to `yatinsaireddyseel…`, which is a line
 * that costs a line of height and answers nothing. It is still worth showing —
 * an app you can be signed into twice needs to say which account you are on —
 * so it moved into the menu, where there is room to print all of it.
 *
 * Everything here is a real destination. A menu item that does nothing is worse
 * than an absent one, so "add account" goes to the same place the workspace
 * picker's Create does and help opens a mail to the one address the product
 * publishes.
 */
export function AccountMenu({
  viewer,
  size = "rail",
}: {
  viewer: Viewer;
  /**
   * `rail` is the fixed column: a full-width row that opens upward, because
   * there is nothing but the bottom of the window below it. `bar` is the mobile
   * header: the picture alone, opening downward off the right edge.
   */
  size?: "rail" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // pointerdown, not click: a click listener fires after the trigger's own
  // handler has already toggled, so pressing an open trigger would close and
  // reopen inside one frame. Same reasoning as the workspace picker.
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
            ? // on-rail-strong, not inherited ink: this row sits in the bottom
              // left corner of the rail, whose colour a white-label org sets,
              // and a dark one made the name unreadable against it.
              "flex w-full min-w-0 items-center gap-2.5 rounded-pill px-3 py-1.5 text-left text-on-rail-strong transition-colors hover:bg-rail-hover"
            : "rounded-full transition-opacity hover:opacity-80"
        }
      >
        <Avatar viewer={viewer} />
        {rail && (
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold tracking-[-0.01em]">
            {viewer.name}
          </span>
        )}
        <span className="sr-only">Account menu, {viewer.email}</span>
      </button>

      {open && (
        <div
          role="menu"
          /* wider than the 224px rail on purpose: this is where the full email
             is printed, and a menu that had to truncate it would be repeating
             the problem it exists to fix. the rail is `fixed` with no clipping,
             so the overhang lands cleanly over the page. */
          className={`absolute z-50 w-[268px] rounded-card border border-line bg-paper py-1.5 shadow-[0_18px_50px_rgb(64_48_38_/_0.16)] ${
            rail ? "bottom-full left-0 mb-2" : "right-0 top-[46px]"
          }`}
        >
          <div className="flex items-center gap-3 px-3 pb-3 pt-2">
            <Avatar viewer={viewer} className="size-10 text-[15px]" />
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-bold leading-tight tracking-[-0.01em]">
                {viewer.name}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-ink-50">
                {viewer.email}
              </span>
            </span>
          </div>

          <a href={`mailto:${brand.contactEmail}`} role="menuitem" className={ITEM}>
            <QuestionCircle />
            Get help
          </a>

          {/* a form, not a link. signing out is a state change, and a GET that
              changes state gets fired by every link prefetcher there is. */}
          <form action={`${BASE_PATH}/auth/sign-out`} method="post" className="mt-1.5 border-t border-line pt-1.5">
            <button type="submit" role="menuitem" className={`${ITEM} w-full`}>
              <SignOut />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
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
