"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  clearNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/(dash)/notifications/actions";
import { notifGlyph, notifTone, unreadLabel, type Notification } from "@/lib/notify";
import { ago } from "@/lib/money";

/**
 * The bell, mounted in both rails.
 *
 * Lives at the top level of components/ rather than under dash/ or editors/
 * because it is genuinely one control on two shells, and copying it would be
 * the fastest way to end up with a creator's bell and an editor's bell that
 * disagree about what "read" means.
 *
 * The feed is server-rendered and handed in as a prop; this component owns
 * only the open/closed state and the refresh clock. That is deliberate: the
 * rail is in a layout, so the rows are already fetched on every navigation and
 * a client fetch would be a second read of the same thing.
 */

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** How often a parked tab looks again. Also refreshes the moment it is focused. */
const POLL_MS = 60_000;

export function NotifBell({
  rows,
  unread,
  align = "left",
  size = "rail",
}: {
  rows: Notification[];
  unread: number;
  /** which edge the panel hangs off. the rail opens right, the bar opens left. */
  align?: "left" | "right";
  size?: "rail" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // A pointerdown anywhere else closes it, and so does escape. Both are on the
  // document rather than a backdrop element: a backdrop over a fixed rail
  // swallows the first click on every nav row behind it.
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

  // The clock. `router.refresh()` re-runs the layout, which is where the feed
  // is read, so the bell fills without a websocket or a second endpoint. Paused
  // while the panel is open so rows never move under a finger.
  useEffect(() => {
    if (open) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [open, router]);

  const openRow = (row: Notification) => {
    setOpen(false);
    if (!row.read_at) {
      const data = new FormData();
      data.set("id", row.id);
      start(() => {
        void markNotificationRead(data);
      });
    }
    if (row.href) router.push(row.href);
  };

  const dim = size === "bar" ? "size-9" : "size-10";

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={unread > 0 ? `${unread} unread notifications` : "notifications"}
        className={`relative flex ${dim} items-center justify-center rounded-pill text-on-rail transition-colors hover:bg-rail-hover hover:text-on-rail-strong`}
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <g {...s}>
            <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
            <path d="M13.7 18.5a2 2 0 0 1-3.4 0" />
          </g>
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-flame px-1 text-[10.5px] font-extrabold tabular-nums text-on-accent">
            {unreadLabel(unread)}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-[calc(100%+8px)] z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-card border border-line bg-paper shadow-[0_18px_48px_rgb(16_16_16/0.16)] ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-[14px] font-bold tracking-[-0.015em]">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => start(() => void markAllNotificationsRead())}
                className="text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-ink disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13.5px] text-ink-50">
              Nothing yet. Claims, cuts and client sign-offs land here.
            </p>
          ) : (
            <ul className="max-h-[min(26rem,60vh)] overflow-y-auto">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => openRow(row)}
                    className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-shell ${
                      row.read_at ? "" : "bg-ember/40"
                    }`}
                  >
                    <Glyph kind={row.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-bold leading-[1.35] tracking-[-0.01em]">
                        {row.title}
                      </span>
                      {row.body && (
                        <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-70">
                          {row.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-50">
                        {ago(row.created_at)}
                      </span>
                    </span>
                    {!row.read_at && (
                      <span className="mt-1.5 size-2 shrink-0 rounded-pill bg-flame" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line bg-shell px-4 py-3">
            <Link
              href="/settings?tab=notifications"
              onClick={() => setOpen(false)}
              className="text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-flame-dark"
            >
              Get these on your phone
            </Link>
            {rows.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => start(() => void clearNotifications())}
                className="text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-ink disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tone plus one of three marks. No icon set, no per-kind drawing. */
function Glyph({ kind }: { kind: string }) {
  const tone = notifTone(kind);
  const shape = notifGlyph(kind);

  const skin =
    tone === "ink"
      ? "bg-ink text-white"
      : tone === "flame"
        ? "bg-ember text-flame"
        : "bg-shell text-ink-50";

  return (
    <span
      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill ${skin}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-4">
        <g {...s}>
          {shape === "check" && <path d="m6 12.5 4 4 8-9" />}
          {shape === "clock" && (
            <>
              <circle cx="12" cy="12" r="7.5" />
              <path d="M12 8v4.3l2.6 1.7" />
            </>
          )}
          {shape === "dot" && <circle cx="12" cy="12" r="3.2" fill="currentColor" />}
        </g>
      </svg>
    </span>
  );
}
