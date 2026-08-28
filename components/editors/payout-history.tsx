"use client";

import { useMemo, useState } from "react";
import { Picker } from "@/components/dash/form";
import { EmptyMoneyArt } from "@/components/editors/empty-art";
import { money } from "@/lib/money";

export type PayoutRow = {
  id: string;
  amount_cents: number;
  status: string;
  memo: string | null;
  created_at: string;
  paid_at: string | null;
  paid_via: string | null;
  /**
   * Set while the row is inside a batch a rail is sending. `fail_payout_batch`
   * nulls it on the way back into the owed pool, so due + a batch id means in
   * flight and nothing else does.
   */
  batch_id: string | null;
};

/** due, in a batch, or settled. The only three things a row can be. */
type State = "pending" | "processing" | "paid";
type Tab = "all" | State;

function stateOf(r: PayoutRow): State {
  if (r.status === "paid") return "paid";
  return r.batch_id ? "processing" : "pending";
}

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "all" },
  { value: "pending", label: "pending" },
  { value: "processing", label: "processing" },
  { value: "paid", label: "paid" },
];

const TONE: Record<State, string> = {
  pending: "bg-ember text-flame",
  processing: "bg-ember text-flame-dark",
  paid: "bg-live-soft text-live",
};

/** What an editor calls the rail, not what the column stores. */
const RAIL: Record<string, string> = {
  stripe: "bank or card",
  paypal: "paypal",
  venmo: "venmo",
  manual: "sent by hand",
};

/** The day a row is filed under: when it was paid, else when it was earned. */
function dayOf(r: PayoutRow) {
  return new Date(r.paid_at ?? r.created_at);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The editor's own ledger.
 *
 * Rows arrive newest first from the caller, which is the read that knows
 * whether it sorted on paid_at or created_at, so this never re-sorts and cannot
 * disagree with the list it was handed. It only ever hides rows.
 *
 * The two controls answer different questions and both are worth having: the
 * tabs are "where is my money", the month is "what did i earn in may". Neither
 * one is a substitute for the other, which is why the mock has both.
 */
export function PayoutHistory({ rows }: { rows: PayoutRow[] }) {
  const [tab, setTab] = useState<Tab>("all");
  const [month, setMonth] = useState("all");

  // months that actually have rows, newest first. a picker offering an empty
  // april is a picker that can only disappoint.
  const months = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const d = dayOf(r);
      const key = monthKey(d);
      if (!seen.has(key)) {
        seen.set(
          key,
          d.toLocaleDateString(undefined, { month: "long", year: "numeric" })
        );
      }
    }
    return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (tab !== "all" && stateOf(r) !== tab) return false;
        if (month !== "all" && monthKey(dayOf(r)) !== month) return false;
        return true;
      }),
    [rows, tab, month]
  );

  return (
    // the page fills the viewport, so this is the block that takes what is left
    // and moves its own rows under a header that stays put.
    <section className="flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-card lg:min-h-0 lg:flex-1">
      {/* no heading. the card is under a page called payouts, and "recent
          payouts" over a tab reading "all" was the third time the screen said
          the same word. the tabs are the heading.

          the rule is inside the padding rather than run to the card's edges:
          it separates the tabs from the rows, and a full-bleed line reads as a
          second card boundary a few pixels under the first. */}
      <header className="shrink-0 px-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pt-4">
          <div className="flex items-center gap-5 overflow-x-auto">
            {TABS.map((t) => {
              const on = tab === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  aria-current={on ? "page" : undefined}
                  className={`-mb-px shrink-0 border-b-2 pb-3 text-[14px] tracking-[-0.01em] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-flame ${
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

          {months.length > 1 && (
            <label className="relative mb-3 shrink-0">
              <span className="sr-only">filter by month</span>
              <Calendar className="pointer-events-none absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-ink-50" />
              <Picker
                value={month}
                onChange={setMonth}
                ariaLabel="filter by month"
                options={[
                  { value: "all", label: "every month" },
                  ...months.map(([key, label]) => ({ value: key, label })),
                ]}
                triggerClass="flex h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-[10px] border border-line bg-paper pl-10 pr-3 text-[14px] font-semibold outline-none transition-colors focus:border-ink"
              />
            </label>
          )}
        </div>
      </header>

      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {shown.length === 0 ? (
          <Empty everHad={rows.length > 0} />
        ) : (
          shown.map((r) => <Line key={r.id} row={r} />)
        )}
      </div>
    </section>
  );
}

function Line({ row }: { row: PayoutRow }) {
  const day = dayOf(row);
  const state = stateOf(row);

  return (
    // the rule between rows is inset the same way the tabs' is: padding on the
    // outer element, border on the inner one, so no line in this card ever
    // touches its edge.
    <div className="px-5 [&:last-child>div]:border-b-0 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3.5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line text-ink-50">
          <Calendar className="size-[17px]" />
        </span>

        <div className="w-[112px] shrink-0">
          <p className="text-[13.5px] font-bold tracking-[-0.01em]">
            {day.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-50">
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </p>
        </div>

        <div className="min-w-[140px] flex-1">
          <p className="truncate text-[13.5px] font-bold tracking-[-0.01em]">
            {/* the rail, once one has carried it. before that the row has not
                picked a rail yet and saying "paypal" would be a guess. */}
            {row.paid_via ? (RAIL[row.paid_via] ?? row.paid_via) : "not sent yet"}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-ink-50">
            {row.memo ?? "edit job"}
          </p>
        </div>

        <p className="shrink-0 text-[14.5px] font-extrabold tabular-nums tracking-[-0.01em]">
          {money(row.amount_cents)}
        </p>

        <span
          className={`w-[92px] shrink-0 rounded-pill px-3 py-1 text-center text-[12.5px] font-bold ${TONE[state]}`}
        >
          {state}
        </span>
      </div>
    </div>
  );
}

/**
 * Two empty states again, for the same reason the board has two. Nothing ever
 * earned gets the drawing; a month or a tab with nothing in it is your own
 * doing and gets a sentence, because the drawing would read as "you have never
 * been paid" to somebody who has.
 */
function Empty({ everHad }: { everHad: boolean }) {
  if (everHad) {
    return (
      <p className="px-5 py-14 text-center text-[14px] text-ink-50 sm:px-6">
        nothing in that view. try another month, or all.
      </p>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-14 text-center">
      <EmptyMoneyArt />
      <h3 className="mt-6 text-[17px] font-extrabold tracking-[-0.02em]">
        no payouts yet
      </h3>
      <p className="mt-2 text-[13.5px] text-ink-50">
        your payouts will appear here once you start earning.
      </p>
    </div>
  );
}

function Calendar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3.6" y="5.2" width="16.8" height="15.2" rx="3" />
        <path d="M3.6 10h16.8M8.4 3.6v3.2M15.6 3.6v3.2" />
      </g>
    </svg>
  );
}

