import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Orange pill with the arrow. The one loud element on the page.
 *
 * An external href (the stripe payment link) opens in a new tab so the page
 * stays behind checkout. An in-page anchor scrolls like normal.
 */
/**
 * Sizing lives here rather than in a caller's `className`, because two padding
 * utilities of the same specificity are resolved by stylesheet order, not by
 * the order they appear in the class string. A caller passing `px-6` next to
 * the base `px-7` silently loses.
 */
const sizes = {
  // sm is the nav button, which shares a 320px-wide bar with the mark and the
  // menu toggle. it gives back padding and a half point of type on the
  // smallest screens and takes it straight back at sm.
  sm: "px-4 py-2.5 text-[13.5px] sm:px-5 sm:text-[14px]",
  md: "px-6 py-3.5 text-[15px] sm:px-7",
  lg: "px-7 py-4 text-[15.5px] sm:px-8 sm:text-[16px]",
};

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  size?: keyof typeof sizes;
  className?: string;
}) {
  const base =
    "group inline-flex items-center gap-2.5 rounded-pill font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-flame";
  const styles =
    variant === "primary"
      ? "bg-flame text-on-accent shadow-[0_1px_0_0_rgba(0,0,0,0.12)] ring-1 ring-flame-dark/30 hover:bg-flame-dark"
      : "text-ink hover:text-flame";
  const classes = `${base} ${sizes[size]} ${styles} ${className}`;

  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
      >
        {children}
        <Arrow />
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
      <Arrow />
    </Link>
  );
}

export function Arrow() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
      aria-hidden="true"
    >
      <path
        d="M3 10h13M11 5l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

