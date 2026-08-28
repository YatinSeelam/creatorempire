"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { brand } from "@/lib/content";
import { AGENCY_HREF, AGENCY_PEOPLE_HREF, type OrgRole } from "@/lib/org";
import type { Viewer } from "@/lib/viewer";
import { AccountMenu } from "./account-menu";
import { BASE_PATH } from "@/lib/base-path";

/**
 * The rail. One workspace, so there is no picker at the top: the logo and the
 * name, then the few rows this programme actually has.
 *
 * A student gets their own work: dashboard, deals, the scheduler, the
 * portfolio.
 * Somebody who runs the programme gets the students and the door. Nothing
 * else lives on this rail, and nothing is switched on or off by a setting.
 */

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

const DealsIcon = (
  <>
    <rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2.4" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M5.9 12h.01M18.1 12h.01" />
  </>
);

const SchedulerIcon = (
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.8h17M8 3.4v3.2M16 3.4v3.2" />
    <path d="M10.6 13.2v4.2l3.4-2.1z" />
  </>
);

const StudentsIcon = (
  <>
    <circle cx="9" cy="8.2" r="3.1" />
    <path d="M3.4 19.4c.6-3 2.8-4.7 5.6-4.7s5 1.7 5.6 4.7" />
    <path d="M16.2 5.5a2.9 2.9 0 0 1 0 5.6M17.9 19.4c-.2-1.2-.5-2.3-1.1-3.1" />
    <path d="M20.6 12.9c.7.7 1.2 1.7 1.4 2.9" />
  </>
);

const InviteIcon = (
  <>
    <circle cx="10" cy="8.5" r="3.2" />
    <path d="M4.2 19.5c.6-3.1 2.9-4.8 5.8-4.8 1.1 0 2.1.2 3 .7" />
    <path d="M18 14v6M15 17h6" />
  </>
);

const FounderIcon = (
  <>
    <path d="M4 17.5 5.5 8l4.5 3.5L12 6l2 5.5L18.5 8 20 17.5z" />
    <path d="M4.5 20h15" />
  </>
);

const PortfolioIcon = (
  <>
    <rect x="3" y="6.5" width="18" height="13.5" rx="2.5" />
    <path d="M9 6.5V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    <path d="M3 12h18" />
  </>
);

const SettingsIcon = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8l1.4 2.4 2.7-.6.6 2.7 2.4 1.4-1 2.6 1 2.6-2.4 1.4-.6 2.7-2.7-.6L12 21.2l-1.4-2.4-2.7.6-.6-2.7-2.4-1.4 1-2.6-1-2.6 2.4-1.4.6-2.7 2.7.6z" />
  </>
);

export type NavRow = {
  href: string;
  label: string;
  icon: ReactNode;
  /** a quiet word after the label. only "soon" so far, on a row not open yet. */
  badge?: string;
};

const studentRows: NavRow[] = [
  { href: "/dashboard", label: "Dashboard", icon: HomeIcon },
  { href: "/deals", label: "Deals", icon: DealsIcon },
  { href: "/tools/autoposting", label: "Scheduler", icon: SchedulerIcon },
  { href: "/portfolio", label: "Portfolio", icon: PortfolioIcon },
];

const adminRows: NavRow[] = [
  { href: AGENCY_HREF, label: "Students", icon: StudentsIcon },
  { href: AGENCY_PEOPLE_HREF, label: "Invites & roles", icon: InviteIcon },
];

const founderRow: NavRow = { href: "/founder", label: "Founder", icon: FounderIcon };
const settingsRow: NavRow = { href: "/settings", label: "Settings", icon: SettingsIcon };

function NavLink({
  row,
  active,
  compact = false,
}: {
  row: NavRow;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={row.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-[10px] font-semibold tracking-[-0.01em] transition-colors ${
        compact ? "h-9 shrink-0 px-3 text-[13.5px]" : "h-10 px-3 text-[14.5px]"
      } ${
        active
          ? "bg-flame text-on-accent shadow-[0_1px_3px_var(--color-glow)]"
          : "text-on-rail hover:bg-rail-hover hover:text-on-rail-strong"
      }`}
    >
      <Icon>{row.icon}</Icon>
      <span className="truncate">{row.label}</span>
      {row.badge && (
        <span
          className={`ml-auto shrink-0 rounded-pill px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${
            active ? "bg-on-accent/20 text-on-accent" : "bg-rail-hover text-on-rail/80"
          }`}
        >
          {row.badge}
        </span>
      )}
    </Link>
  );
}

function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="px-3 pb-1 pt-4 text-[10.5px] font-bold uppercase tracking-[0.12em] text-on-rail/70">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

function Logo({ small = false }: { small?: boolean }) {
  return (
    <Link
      href="/"
      className="flex min-w-0 items-center gap-2.5 text-on-rail-strong"
      aria-label={brand.name}
    >
      <Image
        // next/image does not prefix `src` with basePath, only the optimiser
        // endpoint it points at, so a bare /logo.png is a 404 under the
        // /creatorempire prefix. same for every other public file below.
        src={`${BASE_PATH}/logo.png`}
        alt=""
        width={small ? 32 : 36}
        height={small ? 32 : 36}
        priority
        className={`shrink-0 rounded-[10px] object-cover shadow-[0_1px_3px_rgb(0_0_139_/_0.25)] ${
          small ? "size-8" : "size-9"
        }`}
      />
      <span className="truncate text-[15px] font-extrabold tracking-[-0.02em]">
        {brand.name}
      </span>
    </Link>
  );
}

export function SideNav({
  viewer,
  isFounder = false,
  agencyRole = null,
}: {
  viewer: Viewer;
  /** on `admin_emails`. the only thing that earns the Founder row. */
  isFounder?: boolean;
  /** owner or admin of the programme gets the admin rows instead of the student ones. */
  agencyRole?: OrgRole | null;
}) {
  const pathname = usePathname();

  // the editing row is gone with the feature: the section, its pages and the
  // marketplace behind it are deleted, so a row wearing a `soon` chip would be
  // pointing at nothing. this list is the whole rail.
  const work = studentRows;

  // everyone gets the work rows. running the programme adds a second group
  // rather than swapping the first out: an owner posts and edits too.
  const rows = agencyRole ? [...work, ...adminRows] : work;
  const tail = [...(isFounder ? [founderRow] : []), settingsRow];
  const all = [...rows, ...tail];

  const hit = all
    .filter((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const isActive = (href: string) => hit?.href === href;

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-[232px] flex-col border-r border-rail-line bg-rail px-3 py-5 lg:flex">
        <div className="flex items-center gap-1 px-1">
          <span className="min-w-0 flex-1">
            <Logo />
          </span>
        </div>

        <nav className="mt-7 flex flex-col">
          <Group label={agencyRole ? "work" : undefined}>
            {work.map((l) => (
              <NavLink key={l.href} row={l} active={isActive(l.href)} />
            ))}
          </Group>
          {agencyRole && (
            <Group label="programme">
              {adminRows.map((l) => (
                <NavLink key={l.href} row={l} active={isActive(l.href)} />
              ))}
            </Group>
          )}
        </nav>

        <div className="mt-auto flex flex-col gap-1 pt-6">
          {tail.map((l) => (
            <NavLink key={l.href} row={l} active={isActive(l.href)} />
          ))}
          <div className="mt-2 border-t border-rail-line pt-3">
            <AccountMenu viewer={viewer} />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-50 border-b border-rail-line bg-rail/95 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <Logo small />
          </span>
          <AccountMenu viewer={viewer} size="bar" />
        </div>
        <nav className="flex gap-1.5 overflow-x-auto px-3 pb-3">
          {all.map((l) => (
            <NavLink key={l.href} row={l} active={isActive(l.href)} compact />
          ))}
        </nav>
      </header>
    </>
  );
}
