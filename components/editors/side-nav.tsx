"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { brand } from "@/lib/content";
import { EDITING_ENABLED } from "@/lib/editing";
import type { Viewer } from "@/lib/viewer";
import { Mark } from "../art";
import { NotifBell } from "@/components/notif-bell";
import type { Notification } from "@/lib/notify";
import { EditorAccountMenu } from "./account-menu";

/**
 * The editor side's chrome, a mirror of components/dash/side-nav.tsx rather
 * than a reuse of it: same rail, same pills, same account row, its own map of
 * destinations. Copied on purpose — the two navs will drift apart (editors get
 * payouts pages, creators get tools) and a shared component would make every
 * divergence a prop.
 */

/** One stroke weight for every nav glyph, same drawing language as art.tsx. */
const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden="true">
      <g {...s}>{children}</g>
    </svg>
  );
}

const HomeIcon = (
  <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
);

// the banknote from the creator rail's Deals: the market is where the money
// is, and an editor reads it exactly that way.
const MarketIcon = (
  <>
    <rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.4" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M5.9 12h.01M18.1 12h.01" />
  </>
);

// a card: where the money goes out. deliberately not the banknote the job
// board uses — the board is what a job is worth, this is the rail it travels.
const PayoutsIcon = (
  <>
    <rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.6" />
    <path d="M2.8 10.2h18.4M6.4 14.6h3.6" />
  </>
);

// a waveform. the same five bars the variations tool draws on a sound card, so
// "audio" reads the same on both sides of the product.
const LibraryIcon = (
  <path d="M4 10.5v3M8 7.5v9M12 4.8v14.4M16 8.4v7.2M20 11v2" />
);

const SettingsIcon = (
  <>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 3.6v2.2M12 18.2v2.2M20.4 12h-2.2M5.8 12H3.6M17.9 6.1l-1.6 1.6M7.7 16.3l-1.6 1.6M17.9 17.9l-1.6-1.6M7.7 7.7 6.1 6.1" />
  </>
);

// the market is off (EDITING_ENABLED in lib/editing.ts). the row goes with it,
// same as the creator rail's Editing row, so nothing points at a 404.
//
// `marketOpen` rather than EDITING_ENABLED alone, because this is a client
// component and cannot ask the database whether the viewer is a founder. The
// layout answers that once on the server and passes it down. Without it the
// rail was the one place the founder's rehearsal bypass did not reach, so the
// board was reachable by url and by the desk's button but had no rail row.
//
// Payouts stays up with the market off: an editor with credits from a job that
// already shipped still has money to move, and hiding the page would strand it.
function mainRows(marketOpen: boolean) {
  return [
    { href: "/editors", label: "Dashboard", icon: HomeIcon },
    ...(marketOpen
      ? [{ href: "/editors/market", label: "Job Board", icon: MarketIcon }]
      : []),
    // stays up with the market off, like Payouts and for the same reason: an
    // editor cutting a job that already exists still needs the house sounds.
    { href: "/editors/library", label: "Sound Library", icon: LibraryIcon },
    { href: "/editors/payouts", label: "Payouts", icon: PayoutsIcon },
  ];
}

// settings sits apart from the rest, pinned above the account row: it is the
// thing you go to once and then stop thinking about, not a place you work.
const SETTINGS_ROW = {
  href: "/editors/settings",
  label: "Settings",
  icon: SettingsIcon,
};

function NavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex h-10 items-center gap-3 rounded-pill px-3 text-[15px] font-bold leading-5 tracking-[-0.015em] transition-colors ${
        active
          ? "bg-flame text-on-accent shadow-[0_1px_3px_var(--color-glow)]"
          : "text-ink-70 hover:bg-paper/45 hover:text-ink"
      }`}
    >
      <Icon>{icon}</Icon>
      {label}
    </Link>
  );
}

/**
 * Tinted rail on the left, white pill for the current page, account row pinned
 * to the bottom. Collapses to a top bar under lg. `publicHref` is the
 * editor's live /e/<handle> page, present only once published.
 */
export function EditorSideNav({
  viewer,
  publicHref,
  marketOpen = EDITING_ENABLED,
  notifications = [],
  unreadNotifications = 0,
}: {
  viewer: Viewer;
  publicHref?: string | null;
  /**
   * Whether this viewer may see the board: the market flag, or a founder
   * rehearsing it while the flag is off. Resolved on the server because a
   * client component cannot ask.
   */
  marketOpen?: boolean;
  /** the same bell the creator rail carries. one table, two shells. */
  notifications?: Notification[];
  unreadNotifications?: number;
}) {
  const pathname = usePathname();

  // publicHref is accepted but unused while the portfolio is parked; keeping
  // the prop means the layout does not have to change twice.
  void publicHref;
  const main = mainRows(marketOpen);
  const all = [...main, SETTINGS_ROW];

  // "/editors" is a prefix of every other href here, so unlike the creator
  // rail this cannot be a plain prefix match. Overview owns itself, the job
  // workspaces and the application form; everything else matches its own
  // subtree.
  const isActive = (href: string) =>
    href === "/editors"
      ? pathname === "/editors" ||
        pathname.startsWith("/editors/jobs") ||
        pathname.startsWith("/editors/apply")
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-[224px] flex-col border-r border-rail-line bg-rail px-2 py-6 lg:flex">
        <div className="flex items-center gap-1">
          <Link
            href="/editors"
            className="flex h-10 min-w-0 flex-1 items-center gap-2.5 px-3 text-[19px] font-extrabold tracking-[-0.025em]"
          >
            <Mark className="size-7" />
            <span className="truncate">
              {brand.wordmark} <span className="text-flame">editors</span>
            </span>
          </Link>
          <NotifBell rows={notifications} unread={unreadNotifications} align="left" />
        </div>

        <nav className="mt-8 flex flex-col gap-2">
          {main.map((l) => (
            <NavLink key={l.href} {...l} active={isActive(l.href)} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <NavLink {...SETTINGS_ROW} active={isActive(SETTINGS_ROW.href)} />
          {/* the picture and the name only. the email moved into the menu this
              opens, where it can be printed whole instead of truncated to
              `yatinsaireddyseel…` by a 224px rail. */}
          <div className="mt-1">
            <EditorAccountMenu viewer={viewer} />
          </div>
        </div>
      </aside>

      {/* under lg the rail becomes a bar: wordmark, scrollable links, avatar */}
      <header className="sticky top-0 z-50 border-b border-rail-line bg-rail/95 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <Link
            href="/editors"
            className="flex items-center gap-2.5 text-[17px] font-extrabold tracking-[-0.02em]"
          >
            <Mark className="size-7" />
            <span>
              {brand.wordmark} <span className="text-flame">editors</span>
            </span>
          </Link>
          <span className="flex shrink-0 items-center gap-1">
            <NotifBell
              rows={notifications}
              unread={unreadNotifications}
              align="right"
              size="bar"
            />
            <EditorAccountMenu viewer={viewer} size="bar" />
          </span>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-4 pb-3">
          {all.map((l) => {
            const active = isActive(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-9 shrink-0 items-center gap-2 rounded-pill px-3 text-[13.5px] font-semibold transition-colors ${
                  active
                    ? "bg-flame text-on-accent shadow-[0_1px_3px_var(--color-glow)]"
                    : "text-ink-70"
                }`}
              >
                <Icon>{l.icon}</Icon>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </>
  );
}
