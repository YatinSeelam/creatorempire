import type { ReactNode } from "react";
import Link from "next/link";
import { JOB_STATUS_LABEL, type JobStatus } from "@/lib/editing";

/**
 * The editor shell's primitives. Same drawing language as the dash (paper
 * cards on a shell ground, line borders, flame accent) but its own copies, so
 * the two dashboards can drift apart without breaking each other.
 */

export function Panel({
  title,
  action,
  padded = true,
  scroll = false,
  className = "",
  children,
}: {
  title?: string;
  action?: ReactNode;
  padded?: boolean;
  /**
   * Scroll the body instead of growing the panel. For the one panel on a
   * page that fills the viewport: the header stays put and the list moves
   * under it, so the shape of the page never changes with the row count.
   */
  scroll?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`overflow-hidden rounded-card border border-line bg-paper shadow-card ${
        scroll ? "flex min-h-0 flex-col" : ""
      } ${className}`}
    >
      {title && (
        // no rule under the header. the card already has an edge and a lift of
        // its own, and a second line inside it cut the panel in half for no
        // information. the title and the block under it are one thing.
        <header className="flex items-center justify-between gap-4 px-5 pb-1 pt-5 sm:px-6">
          <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">{title}</h2>
          {action}
        </header>
      )}
      <div
        className={`${
          padded
            ? title
              ? "px-5 pb-5 pt-3 sm:px-6"
              : "px-5 py-5 sm:px-6"
            : ""
        } ${scroll ? "min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        {children}
      </div>
    </section>
  );
}

const pillTones = {
  flame: "bg-ember text-flame",
  ink: "bg-ink text-white",
  quiet: "bg-shell text-ink-50",
  line: "border border-line text-ink-70",
};

export function Pill({
  tone = "quiet",
  children,
}: {
  tone?: keyof typeof pillTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[12px] font-semibold tracking-[-0.005em] ${pillTones[tone]}`}
    >
      {children}
    </span>
  );
}

/** One chip per job state, worded by lib/editing so both dashboards agree. */
export function StatusPill({ status }: { status: JobStatus }) {
  const tone: keyof typeof pillTones =
    status === "revisions"
      ? "flame"
      : status === "claimed" || status === "delivered"
        ? "ink"
        : status === "open"
          ? "line"
          : "quiet";
  return <Pill tone={tone}>{JOB_STATUS_LABEL[status]}</Pill>;
}

export function Stat({
  label,
  value,
  note,
  size = "sm",
}: {
  label: string;
  value: string;
  note?: string;
  /**
   * `lg` is the editor's own desk, where three numbers are the whole top of
   * the page and have to carry it. `sm` is every list header elsewhere, where
   * a 44px number would outrank the table it is describing.
   */
  size?: "sm" | "lg";
}) {
  const big = size === "lg";
  return (
    <div
      className={`rounded-card border border-line bg-paper shadow-card px-5 ${big ? "py-6" : "py-5"}`}
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
        {label}
      </p>
      <p
        className={`font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
          big ? "mt-3.5 text-[clamp(2rem,4.6vw,2.75rem)]" : "mt-2.5 text-[28px]"
        }`}
      >
        {value}
      </p>
      {note && (
        <p className={`text-[13px] text-ink-50 ${big ? "mt-3" : "mt-2"}`}>{note}</p>
      )}
    </div>
  );
}

/**
 * A number on the money page.
 *
 * The desk's Stat shouts its label in caps, which is right when three of them
 * are the whole top of a page. Here they sit above two more cards and a ledger,
 * so the label is a quiet sentence and the figure does the work.
 *
 * These carried a tinted glyph each for about an hour. They read as emoji
 * rather than as iconography, which is the failure mode of a picture that is
 * decorating a number instead of naming a thing.
 */
export function MoneyStat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper px-5 py-5 shadow-card">
      <p className="text-[13px] text-ink-50">{label}</p>
      <p className="mt-1.5 text-[clamp(1.5rem,2.8vw,1.85rem)] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      {note && <p className="mt-2 text-[12.5px] text-ink-50">{note}</p>}
    </div>
  );
}

/**
 * The centred nothing-here state: a drawing, a line about why, and the one
 * button that fixes it. Distinct from EmptyNote, which is a sentence inside a
 * list that will normally have rows. this is for the panel that owns the page
 * and would otherwise be a white rectangle.
 */
export function EmptyState({
  art,
  title,
  children,
  action,
}: {
  art: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    // min-h-full, not h-full: inside a panel that flexes it centres in whatever
    // height it was given, and on a short window it still grows and scrolls
    // rather than squashing the drawing.
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      {art}
      <h3 className="mt-6 text-[19px] font-extrabold tracking-[-0.02em]">{title}</h3>
      {children && (
        <p className="mt-2 max-w-[34ch] text-[14px] leading-[1.6] text-ink-50">
          {children}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** The badge staff hand out. Read-only everywhere; a trigger guards the column. */
export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-ink px-2.5 py-1 text-[12px] font-semibold text-white">
      <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
        <path
          d="m5 12.5 4.5 4.5L19 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      verified
    </span>
  );
}

/** Flat row for job and payout lists. */
export function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-4 last:border-b-0 sm:px-6 ${className}`}
    >
      {children}
    </div>
  );
}

/** The arrow that trails every "go do the thing" label on this side. */
export function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-[17px] shrink-0 ${className}`}
      aria-hidden="true"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12h13M12.5 6.2 18.5 12l-6 5.8" />
      </g>
    </svg>
  );
}

/** Solid accent pill. The one button on a page that is worth pressing. */
export function PrimaryLink({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2 rounded-pill bg-flame px-6 py-3 text-[15px] font-bold tracking-[-0.01em] text-on-accent transition-colors hover:bg-flame-dark ${className}`}
    >
      {children}
    </Link>
  );
}

/** The quiet twin: accent text in a panel header, no fill. */
export function QuietLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-flame transition-colors hover:text-flame-dark"
    >
      {children}
    </Link>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="px-5 py-6 text-[14px] text-ink-50 sm:px-6">{children}</p>
  );
}
