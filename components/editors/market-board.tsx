"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { ClaimButton } from "@/components/editors/claim-button";
import { EmptyBoardArt } from "@/components/editors/empty-art";
import { Pill } from "@/components/editors/ui";
import { brandLogo } from "@/lib/brand-catalog";
import { bundleLabel, jobTotalCents, type EditJob } from "@/lib/editing";
import { ago, money } from "@/lib/money";

/**
 * The board's toolbar and grid.
 *
 * Filtering is client side and the whole open board is already in memory, so
 * every keystroke is instant and nothing round trips. That is the right trade
 * while the board is a screen or two of cards; the day it needs paging, the
 * query moves into the url and this becomes a form, and the card below does not
 * change either way.
 *
 * The toolbar renders even on an empty board. It used to be hidden there, which
 * was tidier and wrong: a board you have filtered down to nothing and a board
 * with nothing on it look identical if the controls vanish with the cards, and
 * the second one leaves you thinking the search is broken.
 */

type Tab = "all" | "priority" | "singles" | "bundles";
type Sort = "new" | "pay" | "videos";
type Tier = "any" | "1" | "2";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "all" },
  { value: "priority", label: "priority" },
  { value: "singles", label: "singles" },
  { value: "bundles", label: "bundles" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "new", label: "newest first" },
  { value: "pay", label: "highest paid" },
  { value: "videos", label: "biggest batch" },
];

const TIERS: { value: Tier; label: string }[] = [
  { value: "any", label: "any kind" },
  { value: "1", label: "reactions" },
  { value: "2", label: "full edits" },
];

export function MarketBoard({ jobs }: { jobs: EditJob[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [tier, setTier] = useState<Tier>("any");
  const [sort, setSort] = useState<Sort>("new");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();

    const out = jobs.filter((j) => {
      // priority is the rush flag, and singles/bundles is the batch size. all
      // three are things an editor picks BEFORE they care what the job is,
      // which is why they are tabs and the kind is buried in Filters.
      if (tab === "priority" && !j.is_rush) return false;
      if (tab === "singles" && j.video_count !== 1) return false;
      if (tab === "bundles" && j.video_count < 2) return false;
      if (tier !== "any" && String(j.tier) !== tier) return false;
      if (!needle) return true;
      // brand first: it is what an editor types, and it is the field they
      // decided on before they read a word of the brief.
      return [j.brand_name, j.title, j.brief]
        .filter(Boolean)
        .some((s) => (s as string).toLowerCase().includes(needle));
    });

    // a copy, always: sorting the filtered array in place is fine, sorting the
    // prop is how a server-rendered list starts disagreeing with itself.
    return [...out].sort((a, b) => {
      if (sort === "pay") return jobTotalCents(b) - jobTotalCents(a);
      if (sort === "videos") return b.video_count - a.video_count;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [jobs, q, tab, tier, sort]);

  const narrowed = q.trim() !== "" || tier !== "any" || sort !== "new";

  const clear = () => {
    setQ("");
    setTier("any");
    setSort("new");
  };

  return (
    <div className="space-y-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      <div className="flex flex-wrap items-stretch gap-3">
        <label className="relative min-w-[240px] flex-1">
          <span className="sr-only">search the board</span>
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search a creator, a brand, a keyword"
            className="h-14 w-full rounded-[10px] border border-line bg-paper pl-12 pr-4 text-[14.5px] shadow-card outline-none transition-colors placeholder:text-ink-50 focus:border-flame"
          />
        </label>
        <FiltersButton
          tier={tier}
          setTier={setTier}
          sort={sort}
          setSort={setSort}
        />
      </div>

      {/* tabs, not chips: these four are a single question with one answer, and
          a row of toggles says otherwise. the rule under them is the full width
          of the board so the active tab reads as a tab and not a button. */}
      <div className="flex items-center gap-6 overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const on = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-current={on ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 pb-3 text-[15px] tracking-[-0.01em] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-flame ${
                on
                  ? "border-flame font-extrabold text-ink"
                  : "border-transparent font-semibold text-ink-50 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {narrowed && (
        <p className="text-[13px] text-ink-50 tabular-nums">
          {shown.length} of {jobs.length}{" "}
          <button
            type="button"
            onClick={clear}
            className="font-semibold text-flame transition-colors hover:text-flame-dark"
          >
            clear
          </button>
        </p>
      )}

      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {shown.length === 0 ? (
          <EmptyBoard
            total={jobs.length}
            narrowed={narrowed || tab !== "all"}
            onClear={() => {
              clear();
              setTab("all");
            }}
          />
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((j) => (
              <JobCard key={j.id} job={j} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The frame both empty states share.
 *
 * `h-full` inside the results pane, so on a filled page the box is as tall as
 * whatever is left under the tabs and the gap at the bottom is the layout's own
 * padding rather than a number written here. min-h keeps it a box and not a
 * strip on a short window, where the pane scrolls instead.
 */
const BOX =
  "flex min-h-[440px] flex-col items-center justify-center rounded-xl border border-line bg-paper py-14 text-center shadow-card lg:h-full";

/**
 * Nothing to show, in the two ways that can happen.
 *
 * A board with nothing on it is the product's state and gets the drawing and
 * the rules. A board you filtered down to nothing is your own doing and gets a
 * way back out. Telling those apart is the whole job of this component: the
 * same card for both is how somebody concludes the market is dead when they
 * have simply left `priority` selected.
 */
function EmptyBoard({
  total,
  narrowed,
  onClear,
}: {
  total: number;
  narrowed: boolean;
  onClear: () => void;
}) {
  if (total > 0 && narrowed) {
    return (
      <div className={`${BOX} px-5`}>
        <p className="text-[15px] font-bold tracking-[-0.015em]">
          nothing matches
        </p>
        <p className="mt-1.5 text-[13.5px] text-ink-50">
          there {total === 1 ? "is" : "are"} {total} open right now, just not
          with those filters.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="mt-4 rounded-pill border border-line px-4 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark"
        >
          show everything
        </button>
      </div>
    );
  }

  return (
    <div className={`${BOX} px-6`}>
      <EmptyBoardArt className="mx-auto" />
      <h3 className="mt-6 text-[19px] font-extrabold tracking-[-0.02em]">
        no open jobs right now
      </h3>
      <p className="mt-2 text-[14px] leading-[1.6] text-ink-50">
        new jobs land here the moment a creator posts them.
      </p>
      <ClaimRules />
    </div>
  );
}

/**
 * The rules, opened in place rather than linked.
 *
 * A "view claim rules" link needs a page to point at and there is no page. The
 * rules are four sentences, so they live here behind a disclosure: no route to
 * keep in step with the rpc, and nobody leaves the board to read them.
 *
 * A button rather than a line of text under a rule. The rule was drawing a
 * divider across an empty card to separate nothing from one link, and a bare
 * link floating in that much white space reads as a footnote rather than the
 * one thing there is to press.
 */
function ClaimRules() {
  return (
    <details className="group mt-7 w-full max-w-[46ch]">
      <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-2 rounded-pill border border-line bg-paper px-5 py-2.5 text-[13.5px] font-bold text-ink-70 shadow-card transition-colors hover:border-flame hover:text-flame-dark [&::-webkit-details-marker]:hidden">
        view claim rules
        <svg
          viewBox="0 0 24 24"
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          <path
            d="m7 10 5 5 5-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <ul className="mt-4 space-y-2.5 rounded-xl bg-shell px-5 py-4 text-left text-[13px] leading-[1.55] text-ink-70">
        <li>first claim wins. two people pressing at once resolve in the database, not in chat.</li>
        <li>36 hours to deliver, 18 on a rush job. the clock starts when you claim.</li>
        <li>you can only hold so many at a time. deliver or release one to free a slot.</li>
        <li>releasing late, or letting a claim expire, is a strike. three and claiming stops.</li>
      </ul>
    </details>
  );
}

/**
 * The secondary filters, behind a button.
 *
 * Kind and sort are not what an editor opens the board asking, so they do not
 * get toolbar space; the four tabs do. The dot on the button is what stops this
 * from being a place work goes to hide, since a filter you cannot see is a
 * filter you forget you set.
 */
function FiltersButton({
  tier,
  setTier,
  sort,
  setSort,
}: {
  tier: Tier;
  setTier: (v: Tier) => void;
  sort: Sort;
  setSort: (v: Sort) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const on = tier !== "any" || sort !== "new";

  // pointerdown, not click: a click listener fires after the trigger's own
  // handler has toggled, so pressing an open trigger closes and reopens in one
  // frame. same reasoning as the account menu.
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

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-14 items-center gap-2.5 rounded-[10px] border bg-paper px-6 text-[14.5px] font-bold tracking-[-0.01em] shadow-card transition-colors ${
          open || on ? "border-flame text-ink" : "border-line text-ink-70 hover:text-ink"
        }`}
      >
        <Sliders />
        filters
        {on && <span className="size-1.5 rounded-full bg-flame" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[248px] rounded-xl border border-line bg-paper p-4 shadow-[0_18px_50px_rgb(64_48_38_/_0.16)]"
        >
          <Group label="kind">
            {TIERS.map((t) => (
              <Choice
                key={t.value}
                on={tier === t.value}
                onClick={() => setTier(t.value)}
              >
                {t.label}
              </Choice>
            ))}
          </Group>
          <Group label="sort by" className="mt-4">
            {SORTS.map((s) => (
              <Choice
                key={s.value}
                on={sort === s.value}
                onClick={() => setSort(s.value)}
              >
                {s.label}
              </Choice>
            ))}
          </Group>
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-50">
        {label}
      </p>
      <div className="mt-2 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      onClick={onClick}
      className={`flex items-center justify-between rounded-pill px-3 py-2 text-left text-[13.5px] transition-colors ${
        on ? "bg-ember font-bold text-flame" : "font-semibold text-ink-70 hover:bg-shell"
      }`}
    >
      {children}
      {on && (
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}

function Search() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="pointer-events-none absolute left-4 top-1/2 size-[19px] -translate-y-1/2 text-ink-50"
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m15.5 15.5 3.6 3.6" />
      </g>
    </svg>
  );
}

function Sliders() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
        <circle cx="15" cy="8" r="2.2" />
        <circle cx="9" cy="16" r="2.2" />
      </g>
    </svg>
  );
}

/**
 * One bounty on the board. The brand leads, because an editor scanning this
 * decides on who the work is for before they read a word of the brief, and
 * the bundle line is the only number they actually weigh: this market sells
 * batches, so "$2 each" beats a total they would have to divide themselves.
 */
function JobCard({ job }: { job: EditJob }) {
  const refs = job.reference_links.length;

  return (
    <div className="group flex flex-col rounded-card border border-line bg-paper shadow-card transition-colors hover:border-flame">
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3.5">
          <BrandMark
            name={job.brand_name ?? job.title}
            logo={brandLogo({
              logo_key: job.brand_logo_key,
              logo_url: job.brand_logo_url,
            })}
            size="md"
          />
          <div className="min-w-0 flex-1">
            {/* no fake brand: an unbranded job just goes straight to its title */}
            {job.brand_name && (
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ink-50">
                {job.brand_name}
              </p>
            )}
            <h2 className="mt-0.5 text-[16px] font-bold leading-[1.3] tracking-[-0.015em]">
              {/* the only way into the brief now that the footer is price and
                  claim. group-hover as well as hover, so the whole card reads
                  as the target rather than four words inside it. */}
              <Link
                href={`/editors/jobs/${job.id}`}
                className="transition-colors group-hover:text-flame"
              >
                {job.title}
              </Link>
            </h2>
            <p className="mt-1 text-[12.5px] text-ink-50">
              posted {ago(job.created_at)}
            </p>
          </div>
        </div>

        {job.brief && (
          <p className="mt-3.5 line-clamp-2 text-[13.5px] leading-[1.55] text-ink-70">
            {job.brief}
          </p>
        )}

        {/* mt-auto pins the chips to the bottom of the body, so a one line
            brief and a two line one still line up across the grid */}
        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3.5">
          <Pill tone="line">{job.tier === 1 ? "reaction" : "full edit"}</Pill>
          {job.is_rush && <Pill tone="flame">rush · 18h</Pill>}
          {refs > 0 && (
            <Pill>
              {refs} reference{refs === 1 ? "" : "s"}
            </Pill>
          )}
        </div>
      </div>

      {/* the price sits WITH the button rather than in a tinted box up in the
          middle of the card. that box was a second bordered rectangle inside a
          bordered rectangle, and it split the money away from the one decision
          the money is for. */}
      <div className="flex items-end justify-between gap-3 border-t border-line px-5 py-4">
        <div className="min-w-0">
          <p className="text-[17px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
            {bundleLabel(job)}
          </p>
          <p className="mt-1.5 text-[12.5px] text-ink-50 tabular-nums">
            {money(jobTotalCents(job))} for the batch
          </p>
        </div>
        <ClaimButton jobId={job.id} />
      </div>
    </div>
  );
}
