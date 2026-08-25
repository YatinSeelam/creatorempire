"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The founder section's rooms. This used to be three rows in the rail, which put
 * staff plumbing next to a creator's own day. One rail row, tabs under it.
 *
 * Same pill shape as the usage page's date range, on purpose: both are "which
 * slice am I looking at", and two different-looking answers to the same question
 * is how a section starts reading as several pages bolted together.
 */
const TABS = [
  { href: "/founder", label: "People" },
  { href: "/founder/agencies", label: "Agencies" },
  { href: "/founder/usage", label: "Usage" },
  { href: "/founder/editors", label: "Editors" },
  { href: "/founder/access", label: "Access" },
];

export function FounderTabs() {
  const pathname = usePathname();

  // People owns /founder and every person under it. The other two are plain
  // prefixes, and neither nests inside the other, so exactly one lights up.
  const isActive = (href: string) =>
    href === "/founder"
      ? pathname === "/founder" || pathname.startsWith("/founder/people")
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {TABS.map((t) => {
        const on = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`rounded-pill px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
              on
                ? "bg-flame text-on-accent"
                : "border border-line text-ink-70 hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
