import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The dashboard's primitives. Everything inside the app shell is built from
 * these so the padding, radius and border stay identical on every screen.
 */

/**
 * The one column width in the app, shared by Page, DashBar and the handful of
 * screens that build their own shell.
 *
 * It used to be 1040px, and on a 1512px laptop that threw away 200px: the rail
 * takes 224, the layout's padding takes 48, and 1240px of usable width was being
 * squeezed into 1040 with a 100px void down each side. The bar is full bleed, so
 * the void was visible as a page title sitting 100px to the left of the cards
 * under it — the thing that read as broken rather than as breathing room.
 *
 * 1920 is a guard, not a layout: no laptop or 1080p monitor reaches it, so the
 * content simply fills its padding the way stan's does. It only engages on a
 * 2560px display and up, where a table 2300px wide stops being readable.
 *
 * Every user of this also needs the layout's padding around it, which is why the
 * class carries no px of its own.
 */
export const column = "mx-auto w-full max-w-[1920px]";

/**
 * The centred column every page without its own bar sits in. This used to live
 * in the (dash) layout, but a page with a top bar has to reach both edges and a
 * child cannot escape a max-width its parent set. The layout gives padding now,
 * the page decides its own width.
 */
export function Page({
  children,
  className = "",
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Fit the viewport instead of growing past it, from `lg` up.
   *
   * For a page whose whole job is to be read at a glance — the dashboard, a
   * deal's numbers — a window scrollbar means the answer is partly below the
   * fold and nobody has agreed which half. Filling the screen turns that into
   * panels that scroll inside their own frames, so the shape of the page never
   * moves and only the lists inside it do.
   *
   * The height is not written here. `.page-fill` is what globals.css hangs
   * `main:has()` off, so the shell becomes exactly one viewport tall and this
   * takes what is left of it. Subtracting the bar's pixels by hand is what used
   * to leave a window scrollbar under a page that already scrolls its lists.
   *
   * Below `lg` the class does nothing and the page scrolls normally: a single
   * column of four stat cards and five panels does not fit at any height.
   */
  fill?: boolean;
}) {
  const FILL = "page-fill lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden";

  return (
    <div className={`${column} ${fill ? FILL : ""} ${className}`}>{children}</div>
  );
}

/**
 * The bar at the top of a page: where you are on the left, the one thing you do
 * from here on the right.
 *
 * A full-bleed rule under it, except where a page turns it off. It separates a
 * title strip from a wall of cards, which is worth a line; /dashboard is the one
 * page where it is not, because a greeting is not a section heading and the
 * stat cards under it are already four hard edges asking for attention.
 *
 * Drawn as a pseudo-element rather than a `border-b` so it costs no height.
 * Two things downstream measure this bar (Split's sticky offset and the
 * portfolio's preview well), and a border would have moved both by a pixel.
 * Unlike the rules inside a card it is deliberately NOT inset: it is the edge
 * of a strip that reaches both sides, not a divider between two rows.
 *
 * It scrolls away with the page. Nothing in this app is worth freezing a strip
 * of screen for, and a bar that stays while the form under it moves reads as
 * two pages stacked. Only the portfolio's phone is pinned, because the point of
 * it is watching it change as you type.
 *
 * min-h is what keeps every bar the same height: 56px is the tallest control
 * it carries (a 36px pill) inside its 10px padding, and a bar holding only a
 * title would otherwise come out ten pixels shorter on the next page along.
 *
 * `-mt-7` eats the layout's 28px of top padding so the bar owns the whole
 * strip and its rule can reach the window's edge.
 *
 * The 16px of `pt-4` is only there when the rule is not. The rule is what
 * makes the strip read as its own band; without one the title was sitting
 * 10px off the top of the window with nothing under it, so the padding does
 * that job instead. It is 16 rather than any other number because it lines the
 * greeting up with the rail's wordmark: the rail is `py-6` around an `h-10`
 * row, so its word centres 44px down, and 16 plus half of 56 is the same 44.
 *
 * `children` is for anything that has to sit absolutely inside the bar, like
 * the portfolio's copied toast. `relative` stays on the header rather than the
 * inner column, so those keep positioning against the full width.
 *
 * The negative margins are still what let the bar reach both edges, which is
 * what the `relative` above positions against. Its contents do not: they sit in
 * the same `column` the body does, so the title is always directly above the
 * first card. A bar whose contents reached the edge while the body was centred
 * is what made the old 1040px page look mis-set.
 */
export function DashBar({
  lead,
  right,
  rule = true,
  children,
}: {
  lead: ReactNode;
  right?: ReactNode;
  /** off on /dashboard, where the strip is a greeting rather than a heading. */
  rule?: boolean;
  children?: ReactNode;
}) {
  // shrink-0 because on a filling page this is a flex child of `main`, and a
  // bar that gave up pixels to the list under it would move the one fixed thing
  // on the screen.
  return (
    <header
      className={`relative -mx-5 -mt-7 mb-7 shrink-0 px-5 sm:-mx-6 sm:px-6 ${
        rule
          ? "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-line"
          : "pt-4"
      }`}
    >
      <div className={`${column} flex min-h-[56px] items-center justify-between gap-4 py-2.5`}>
        {lead}
        {children}
        {right}
      </div>
    </header>
  );
}

/**
 * A wide column with something pinned beside it: the portfolio's form and its
 * phone, a tool's inputs and its result.
 *
 * `lg:items-start` is load bearing. Flex children stretch by default, which
 * makes the aside as tall as the form and gives position:sticky nothing left to
 * travel inside, so it silently does nothing.
 *
 * `--bar-offset` is not a gap someone liked the look of, it is exactly where
 * the aside already starts: DashBar's 56px minimum plus the 28px under it,
 * declared once in globals.css. Sticking at its own starting line means it is
 * pinned from the first pixel of scroll instead of drifting up 84px and then
 * catching, which reads as the preview sliding around while you work.
 *
 * Every page that uses Split draws the bar's rule, so 84 is the right number
 * for all of them. /dashboard is the one bar that is taller, and it has nothing
 * pinned beside it.
 */
export function Split({
  children,
  aside,
}: {
  children: ReactNode;
  aside: ReactNode;
}) {
  return (
    <div className="lg:flex lg:items-start lg:gap-8">
      <div className="min-w-0 lg:flex-1">{children}</div>
      <aside className="mt-8 flex justify-center lg:sticky lg:top-[var(--bar-offset)] lg:mt-0 lg:w-[400px] lg:shrink-0">
        {aside}
      </aside>
    </div>
  );
}

/**
 * The one type scale for a page's name. Every bar reads from it — the
 * portfolio's h1, the tools grid's h1 and the last crumb on a tool page — so
 * "Tools" and "My Portfolio" cannot come out at two different sizes.
 */
export const barTitle = "text-[22px] font-bold tracking-[-0.02em] sm:text-[24px]";

/**
 * Where you are, and the way back. `size="lg"` sets the whole trail at
 * barTitle, so a tool page reads "← Tools / Transcriber" as one heading with
 * the part you came from greyed out, rather than a small crumb bolted to a big
 * title. The last item is where you are and is never a link.
 */
export function Crumbs({
  trail,
  size = "sm",
}: {
  trail: { label: string; href?: string }[];
  size?: "sm" | "lg";
}) {
  const last = trail.length - 1;
  const big = size === "lg";
  const type = big ? barTitle : "text-[15px] font-semibold sm:text-[16px]";

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex min-w-0 items-center ${big ? "gap-2 sm:gap-2.5" : "gap-1.5 sm:gap-2"}`}
    >
      {trail.map((c, i) => (
        <span
          key={c.label}
          className={`flex min-w-0 items-center ${big ? "gap-2 sm:gap-2.5" : "gap-1.5 sm:gap-2"}`}
        >
          {i > 0 && (
            <span aria-hidden="true" className={`${type} font-normal text-line`}>
              /
            </span>
          )}

          {c.href && i !== last ? (
            <Link
              href={c.href}
              className={`inline-flex shrink-0 items-center gap-2 text-ink-50 transition-colors hover:text-flame ${type}`}
            >
              {i === 0 && (
                <svg
                  viewBox="0 0 24 24"
                  className={big ? "size-6 shrink-0" : "size-[17px] shrink-0"}
                  aria-hidden="true"
                >
                  <path
                    d="M19 12H5m0 0 6-6m-6 6 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
              {c.label}
            </Link>
          ) : big && i === last ? (
            <h1 className={`truncate ${barTitle}`}>{c.label}</h1>
          ) : (
            <span
              aria-current={i === last ? "page" : undefined}
              className={`truncate ${type}`}
            >
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function PageHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
          {title}
        </h1>
        {sub && (
          <p className="mt-2 text-[14.5px] leading-[1.6] text-ink-50">{sub}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/**
 * A hairline that stops where the padding does instead of running into the
 * card's own border on both sides.
 *
 * Drawn as a pseudo-element rather than a real border because the element it
 * belongs to already owns the horizontal padding, and a `border-b` paints on
 * the outside of that box — there is no way to inset one. The card's rounded
 * corner is the reason it matters: a rule that reaches the edge meets the
 * curve at a tangent and reads as a crack across the card.
 *
 * `RULE_UNDER`/`RULE_OVER` want a positioned ancestor. Add `relative` unless
 * the element is already `sticky` or `absolute`, where adding it would fight
 * the position it needs.
 */
const RULE_UNDER =
  "after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-line sm:after:inset-x-6";
const RULE_OVER =
  "before:pointer-events-none before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-line sm:before:inset-x-6";

export function Panel({
  title,
  sub,
  action,
  toolbar,
  footer,
  padded = true,
  className = "",
  scroll = false,
  flush = false,
  clip = true,
  children,
}: {
  title?: string;
  /** One quiet line under the title. What the panel is for, not what is in it. */
  sub?: string;
  action?: ReactNode;
  /**
   * A strip between the header and the body, pinned like the header is.
   *
   * Where a list's search and filters go. Inside the body they would scroll
   * away with the rows, and the whole point of a filter is to be reachable when
   * the thing you are looking for is not.
   */
  toolbar?: ReactNode;
  /**
   * A strip pinned under the body, outside whatever `scroll` is doing to it.
   *
   * This is where a list's own controls belong — a pager, the forms that add to
   * it. Inside the body they scroll away with the rows, which for a pager means
   * the control that moves the list is only reachable by moving the list.
   */
  footer?: ReactNode;
  padded?: boolean;
  className?: string;
  /**
   * No rule under the title, and the action sits next to it rather than being
   * pushed to the far edge.
   *
   * The default header is right for a panel whose body is a list of rows: the
   * rule is what stops the first row reading as part of the header. It is wrong
   * for a panel holding one composed thing, where it draws a full-width line
   * across the card and leaves the count stranded a screen away from the title
   * it belongs to.
   */
  flush?: boolean;
  /**
   * Let the body scroll inside the panel rather than growing the page.
   *
   * Only means anything inside a `<Page fill>`, where the panel has been given
   * a height to fit into. The header stays put and the list under it moves,
   * which is what lets a dashboard hold twelve deals without the panel beside
   * it being pushed off screen. `min-h-0` is the load-bearing part: a flex
   * child defaults to its content's height and would refuse to shrink, so the
   * overflow would never trigger and the panel would simply grow.
   */
  scroll?: boolean;
  /**
   * Keep the card's corners cutting whatever reaches them. True is right for
   * almost every panel: a list of rows, a scroller, a toolbar strip all paint to
   * the card's edge and would square off its radius without it.
   *
   * It has to come off for a panel whose header holds a popover. `overflow:
   * hidden` clips an absolutely positioned descendant no matter how high its
   * z-index goes, so the earnings period picker opened and was cut in half by
   * the bottom of its own card. Only turn it off on a panel whose body does not
   * reach the corners, which is what makes it safe there — a padded body and no
   * `scroll`.
   */
  clip?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-paper shadow-card ${clip ? "overflow-hidden" : ""} ${scroll ? "flex min-h-0 flex-col" : ""} ${className}`}
    >
      {title && (
        <header
          className={`relative flex shrink-0 items-center px-5 sm:px-6 ${
            flush
              ? "gap-2.5 pb-1.5 pt-4"
              : `justify-between gap-4 ${RULE_UNDER} ${sub ? "py-3.5" : "py-4"}`
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-[-0.015em]">{title}</h2>
            {sub && <p className="mt-0.5 text-[12.5px] text-ink-50">{sub}</p>}
          </div>
          {action}
        </header>
      )}
      {toolbar && (
        <div className={`relative shrink-0 px-5 py-3 sm:px-6 ${RULE_UNDER}`}>{toolbar}</div>
      )}
      <div
        className={`${padded ? "px-5 py-5 sm:px-6" : ""} ${scroll ? "no-scrollbar min-h-0 flex-1 overflow-y-auto" : ""}`}
      >
        {children}
      </div>
      {footer && <div className={`relative shrink-0 ${RULE_OVER}`}>{footer}</div>}
    </section>
  );
}

/**
 * A Panel that folds. Native details/summary, so it works from a server
 * component with no client state, and the whole header is the click target.
 * `open` is only the initial state, the browser owns it after that.
 */
export function FoldPanel({
  title,
  action,
  padded = true,
  open = false,
  className = "",
  children,
}: {
  title: string;
  action?: ReactNode;
  padded?: boolean;
  open?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className={`group overflow-hidden rounded-card border border-line bg-paper shadow-card ${className}`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-shell sm:px-6 [&::-webkit-details-marker]:hidden">
        <h2 className="text-[15px] font-bold tracking-[-0.015em]">{title}</h2>
        <span className="flex min-w-0 items-center gap-4">
          {action}
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-ink-50 transition-transform group-open:rotate-180"
            aria-hidden="true"
          >
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className={`relative ${RULE_OVER} ${padded ? "px-5 py-5 sm:px-6" : ""}`}>
        {children}
      </div>
    </details>
  );
}

/**
 * A disclosure that looks like the rest of the app rather than a browser
 * default. Lives here because the deal's numbers page and its settings page both
 * hang forms off one, and two copies is how they stop matching.
 */
export function Reveal({
  label,
  open = false,
  children,
}: {
  label: string;
  /** Start open. For the case where the fold is the only thing to do here: an
   *  empty list under a "+ Add" nobody has clicked yet reads as a dead end. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      className={`group relative px-5 py-4 first:before:hidden sm:px-6 ${RULE_OVER}`}
    >
      <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink-50 transition-colors hover:text-ink">
        <span className="group-open:hidden">+ {label}</span>
        <span className="hidden group-open:inline">− {label}</span>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
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

/**
 * Which way a number moved, as a chip. The label is already formatted by the
 * caller — a percentage where there was a baseline to move against, the raw
 * move where there was not — because only the page knows which of its numbers
 * is a count, a view total or money.
 *
 * Flat is drawn as a rise on purpose. Nothing moving is not a warning, and a
 * third grey tone next to a green and an orange one is a colour nobody can read
 * the meaning of at chip size.
 */
export function Trend({ dir, label }: { dir: "up" | "down"; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-[3px] text-[11.5px] font-bold tabular-nums ${
        dir === "up" ? "bg-live-soft text-live" : "bg-ember text-flame-dark"
      }`}
    >
      <svg
        viewBox="0 0 10 8"
        aria-hidden="true"
        className={`w-[7px] shrink-0 ${dir === "down" ? "rotate-180" : ""}`}
      >
        <path d="M5 0 10 8H0z" fill="currentColor" />
      </svg>
      {label}
    </span>
  );
}

/**
 * One number, read at a glance.
 *
 * The label is ink rather than grey and carries a mark: four cards in a row are
 * told apart by their icon before any of the words are read, and the grey was
 * doing the opposite job to the note under the value, which is the line that is
 * genuinely secondary.
 */
export function Stat({
  label,
  value,
  note,
  icon,
  trend,
  detail,
}: {
  label: string;
  value: string;
  note?: string;
  /** an 18px <Glyph>, sitting left of the label. */
  icon?: ReactNode;
  /** the week-over-week move, top right. */
  trend?: { dir: "up" | "down"; label: string };
  /**
   * Where the number came from, for anybody who wants to know.
   *
   * A stat is one number and a line, and the working behind it used to need a
   * panel of its own further down the page — which meant the explanation sat
   * nowhere near the figure it explains and was on screen whether or not
   * anybody wanted it. Given this, the card becomes a `<details>`: the face is
   * unchanged and shut by default, and the working opens under the number it
   * belongs to.
   */
  detail?: ReactNode;
}) {
  const face = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="shrink-0 text-ink-70">{icon}</span>}
          <p className="truncate text-[13px] font-semibold">{label}</p>
        </div>
        {trend ? (
          <Trend {...trend} />
        ) : detail ? (
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-ink-50 transition-transform group-open:rotate-180"
            aria-hidden="true"
          >
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </div>
      <p className="mt-2.5 text-[29px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      {note && <p className="mt-2 text-[12.5px] leading-[1.45] text-ink-50">{note}</p>}
    </>
  );

  if (!detail) {
    return (
      <div className="rounded-card border border-line bg-paper px-5 py-[18px] shadow-card">
        {face}
      </div>
    );
  }

  return (
    <details className="group overflow-hidden rounded-card border border-line bg-paper shadow-card">
      <summary className="cursor-pointer list-none px-5 py-[18px] transition-colors hover:bg-shell [&::-webkit-details-marker]:hidden">
        {face}
      </summary>
      <div className="border-t border-line px-5 py-4">{detail}</div>
    </details>
  );
}

/**
 * A panel with nothing in it yet.
 *
 * The mark is what stops an empty panel reading as a broken one: a centred tile
 * and a bold line say "this is where X will be", where a grey paragraph pinned
 * to the left edge reads as an error message that failed to load.
 */
export function Empty({
  icon,
  title,
  line,
  action,
}: {
  icon?: ReactNode;
  title: string;
  line?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-10 text-center">
      {icon && (
        <span className="mx-auto mb-3.5 flex size-11 items-center justify-center rounded-xl border border-line bg-shell text-ink-50">
          {icon}
        </span>
      )}
      <p className="text-[15px] font-bold tracking-[-0.015em]">{title}</p>
      {line && (
        <p className="mx-auto mt-1 max-w-[42ch] text-[13.5px] leading-[1.5] text-ink-50">{line}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}


/**
 * The label strip over a list of rows, and the one place a table's columns are
 * named. Sentence case at 12.5px rather than letterspaced micro-caps: the labels
 * sit under a 15px panel title, so they only have to be quieter than it, and
 * uppercase 10px with 0.14em of tracking is the single strongest tell that a
 * screen was generated from a spreadsheet rather than designed.
 *
 * `sticky` is free when the panel does not scroll and load bearing when it does.
 */
export function Cols({ children }: { children: ReactNode }) {
  return (
    <div
      className={`sticky top-0 z-10 hidden items-center gap-4 bg-paper px-5 py-3 text-[12.5px] font-semibold text-ink-70 sm:flex sm:px-6 ${RULE_UNDER}`}
    >
      {children}
    </div>
  );
}

const dotTones = {
  live: "bg-flame",
  draft: "bg-line",
  paused: "bg-ink-50",
  ended: "bg-line",
};

/**
 * Status as a dot and a word, not a pill.
 *
 * A row already carried a status pill next to two or three platform pills, and
 * four filled capsules on one line is pill soup: every one of them shouts at the
 * same volume, so none of them reads. A 6px dot puts the state in the row's
 * margin where it can be scanned down the column, and leaves the pill for the
 * one thing per row that is genuinely a tag.
 */
export function Dot({
  tone,
  children,
}: {
  tone: keyof typeof dotTones;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-50">
      <span className={`size-1.5 shrink-0 rounded-full ${dotTones[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

const chipTones = {
  live: "border-live-line bg-live-soft text-live",
  warm: "border-line bg-ember text-flame",
  quiet: "border-line bg-shell text-ink-50",
};

/**
 * Status as a chip, for a table that gives status its own column.
 *
 * This is the exception {@link Dot} argues for rather than a contradiction of
 * it. Dot exists because a status pill sat inline with three platform pills and
 * four filled capsules on one line all shout at the same volume. Once the
 * platforms are marks and the status has a column of its own, the row carries
 * exactly one capsule and the shape earns its ink back: a chip holds its
 * position down the column where a bare word drifts with its own length.
 *
 * The dot is `bg-current`, so the mark and the word can never come out of a
 * different palette by hand.
 */
export function StatusChip({
  tone,
  children,
}: {
  tone: keyof typeof chipTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-[3px] text-[12px] font-semibold tracking-[-0.005em] ${chipTones[tone]}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Flat row used by the deal, post and setting lists. */
export function Row({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 last:after:hidden sm:px-6 ${RULE_UNDER} ${className}`}
    >
      {children}
    </div>
  );
}
