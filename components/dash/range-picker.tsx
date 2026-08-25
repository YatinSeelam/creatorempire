"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EARNINGS_RANGES, type EarningsRange } from "@/lib/earnings-range";

/**
 * The earnings period picker: presets in a track, plus a custom window.
 *
 * One grey track with a white chip on the active item, rather than the row of
 * loose pills this replaced. The track is what makes it read as one control
 * with one answer — loose pills read as five separate buttons, and on a panel
 * header sitting next to a title they looked like navigation rather than a
 * filter.
 *
 * A client component only because of Custom. The presets are still plain
 * navigation and would have worked as links; a popover with two date fields and
 * an outside-click to close is not something a server component can do, and
 * splitting the control in two so half of it could stay server-rendered would
 * mean two different things that both look like chips in the same track.
 *
 * The window lives in the url (`?range=custom&from=…&to=…`), not in state, so
 * the page stays a server render, the numbers are computed where the data is,
 * and a period someone is looking at can be pasted to somebody else.
 */
export function RangePicker({
  active,
  from,
  to,
}: {
  active: EarningsRange;
  /** the window the server actually read, echoed back so the popover opens on
   *  what is on screen rather than on empty fields. */
  from: string | null;
  to: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to);
  const box = useRef<HTMLDivElement>(null);

  // a popover that only closes by pressing its own button is a popover people
  // leave open. escape and a click anywhere else both mean "done looking".
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (key: EarningsRange) => {
    setOpen(false);
    router.push(`/dashboard?range=${key}`);
  };

  const apply = () => {
    setOpen(false);
    const params = new URLSearchParams({ range: "custom" });
    if (start) params.set("from", start);
    if (end) params.set("to", end);
    router.push(`/dashboard?${params}`);
  };

  const chip = (on: boolean) =>
    `flex h-7 shrink-0 items-center rounded-pill px-3 text-[12.5px] font-semibold transition-colors ${
      on
        ? "bg-paper text-ink shadow-[0_1px_3px_rgb(16_16_16/0.14)]"
        : "text-ink-50 hover:text-ink"
    }`;

  return (
    <div className="relative" ref={box}>
      {/* scrolls sideways rather than wrapping: a control that becomes two rows
          changes the height of the panel header it sits in, which shifts every
          panel beside it on a page that is not allowed to scroll. */}
      <div className="no-scrollbar flex max-w-full items-center gap-0.5 overflow-x-auto rounded-pill bg-shell p-1">
        {EARNINGS_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => go(r.key)}
            aria-pressed={active === r.key}
            className={chip(active === r.key)}
          >
            {r.label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={chip(active === "custom")}
        >
          custom
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="custom period"
          // 340 rather than 268: two native date inputs side by side each need
          // room for mm/dd/yyyy AND the browser's own calendar button, and at
          // 268 chrome truncated the year to "08/01/202".
          className="absolute right-0 top-full z-30 mt-2 w-[340px] rounded-card border border-line bg-paper p-4 shadow-[0_20px_44px_-28px_rgb(16_16_16/0.45)]"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="From" value={start} max={end} onChange={setStart} />
            <Field label="To" value={end} min={start} onChange={setEnd} />
          </div>

          <p className="mt-2.5 text-[11.5px] leading-[1.45] text-ink-50">
            Leave From empty to count everything up to the end date.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={apply}
              className="h-9 flex-1 rounded-pill bg-ink text-[13px] font-bold text-white transition-opacity hover:opacity-90"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="h-9 rounded-pill px-3 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-50">
        {label}
      </span>
      <input
        type="date"
        value={value}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full min-w-0 rounded-xl border border-line bg-shell px-2 py-2 text-[13px] font-medium focus:border-flame focus:outline-none"
      />
    </label>
  );
}
