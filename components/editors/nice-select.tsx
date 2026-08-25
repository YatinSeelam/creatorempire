"use client";

import { useEffect, useRef, useState } from "react";

export type NiceOption = { value: string; label: string };

/**
 * A styled dropdown, because a native <select> pops the operating system's
 * own menu and nothing about that can be themed. Trigger drawn like the Field
 * shell, panel drawn like a card, optional type-to-filter row for long lists
 * (countries). Controlled only; the caller owns the value and, when the form
 * needs to post it, a hidden input.
 */
export function NiceSelect({
  value,
  onChange,
  options,
  placeholder,
  searchable = false,
  buttonClass = "",
  menuClass = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly NiceOption[];
  placeholder: string;
  searchable?: boolean;
  /** extra classes on the trigger, e.g. tighter padding for the dial code. */
  buttonClass?: string;
  /** extra classes on the panel, e.g. a fixed width wider than the trigger. */
  menuClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const current = options.find((o) => o.value === value) ?? null;
  const shown = q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setQ("");
        }}
        className={`mt-1.5 flex w-full items-center justify-between gap-2 rounded-xl border bg-shell px-3.5 py-2.5 text-left text-[14.5px] font-medium transition-colors focus:outline-none ${
          open ? "border-flame" : "border-line"
        } ${buttonClass}`}
      >
        <span className={`truncate ${current ? "" : "font-normal text-ink-50/70"}`}>
          {current?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 20 20"
          className={`size-4 shrink-0 text-ink-50 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-paper shadow-[0_12px_32px_rgba(0,0,0,0.12)] ${menuClass}`}
        >
          {searchable && (
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="type to search"
              className="w-full border-b border-line bg-paper px-3.5 py-2.5 text-[14px] placeholder:text-ink-50/70 focus:outline-none"
            />
          )}
          <ul className="max-h-56 overflow-y-auto py-1">
            {shown.length === 0 && (
              <li className="px-3.5 py-2.5 text-[13.5px] text-ink-50">no match.</li>
            )}
            {shown.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-[14px] transition-colors hover:bg-ember ${
                    o.value === value
                      ? "font-bold text-flame-dark"
                      : "font-medium text-ink-70"
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && <span className="shrink-0 text-flame">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
