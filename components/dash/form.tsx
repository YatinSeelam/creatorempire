"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal, useFormStatus } from "react-dom";

/**
 * The form primitives, lifted out of settings-controls so every form in the app
 * has the same border, radius and focus ring. Same drawing language as ui.tsx:
 * shell fill, line border, ink on focus.
 */

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
      {children}
    </span>
  );
}

const shell =
  "mt-1.5 flex items-center rounded-md border border-line bg-shell px-3.5 focus-within:border-ink";
const control =
  "w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none";

export function Field({
  label,
  name,
  defaultValue = "",
  value,
  onChange,
  onBlur,
  placeholder = "",
  prefix,
  suffix,
  type = "text",
  hint,
  required,
  className = "",
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  /**
   * Hand a `value` in and the field becomes controlled, which is what an
   * autosaving form needs: it has to see every keystroke to debounce on it, and
   * it has to be able to put the old value back when the server refuses one.
   *
   * Optional, and absent is the normal case. Every other form in the product
   * posts to a server action and reads nothing back until it does, so an
   * uncontrolled input is both simpler and the only one that survives a
   * hydration mismatch with its typed contents intact. Sharing one component
   * across both is what keeps a single border, radius and focus ring in the
   * app rather than a second hand-rolled input beside it that drifts.
   */
  value?: string;
  onChange?: (value: string) => void;
  /** where an autosaving caller flushes, so leaving a field always writes it. */
  onBlur?: () => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  type?: "text" | "date" | "url" | "number";
  hint?: string;
  required?: boolean;
  className?: string;
}) {
  // react warns loudly if both arrive, and switching between them mid-life
  // remounts the input under the cursor. One or the other, decided by the
  // caller, for the whole life of the field.
  const controlled = value !== undefined;

  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className={shell}>
        {prefix && <span className="pr-1 text-[14.5px] text-ink-50">{prefix}</span>}
        <input
          // `number` and `url` are declared by the caller for what they mean,
          // not for what the browser does with them. Both are rendered as text
          // with a keyboard hint instead, because the native versions blank the
          // field rather than submit what was typed: a number input hands the
          // server "" for "abc", which parses to zero and silently wipes a
          // saved fee, and a url input refuses a scheme-less link the server is
          // perfectly happy to read. Validation belongs on the server, where it
          // can say what was wrong.
          type={type === "date" ? "date" : "text"}
          name={name}
          defaultValue={controlled ? undefined : defaultValue}
          value={controlled ? value : undefined}
          onChange={controlled ? (e) => onChange?.(e.target.value) : undefined}
          onBlur={onBlur}
          placeholder={placeholder}
          required={required}
          inputMode={type === "number" ? "decimal" : type === "url" ? "url" : undefined}
          className={control}
        />
        {suffix && <span className="pl-1 text-[13.5px] text-ink-50">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------- the picker */

function Chev({ open, className = "size-4" }: { open?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className={`shrink-0 text-ink-50 transition-transform duration-150 ${open ? "rotate-180" : ""} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

/**
 * The dropdown, drawn by us.
 *
 * A native `<select>` hands its menu to the operating system, and on macOS that
 * is a grey popover with a system-blue row that ignores every token in
 * globals.css. It was the one control in the product that never matched the
 * rest of it. This is the listbox pattern instead: a button, a hidden input so
 * a plain form post still carries the value with no javascript on the server
 * side of it, and a panel.
 *
 * The panel is `position: fixed` inside a portal on `<body>`, not absolute
 * beside the trigger, because these sit inside cards, folds and scrolling
 * tables that clip their own overflow. Fixed means it has to be re-measured
 * when anything moves, so `place()` is bound on the capture phase: a scrolling
 * inner container does not bubble its scroll, and without capture the panel
 * would hang in mid air beside a trigger that had left.
 *
 * Focus never leaves the trigger. The active row is announced with
 * `aria-activedescendant` rather than by moving focus into the list, which is
 * what keeps Escape, Tab and the form's own submit behaving normally.
 */
export function Picker({
  options,
  value,
  defaultValue,
  onChange,
  name,
  placeholder = "",
  disabled = false,
  ariaLabel,
  labelId,
  triggerClass,
  chevronClass,
  minPanelWidth = 168,
}: {
  options: readonly { value: string; label: string }[];
  /** hand a `value` in and it is controlled; leave it out and it keeps its own. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** when set, a hidden input posts under this name. */
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  labelId?: string;
  /** replaces the default trigger look entirely, for the pill and inline ones. */
  triggerClass?: string;
  chevronClass?: string;
  minPanelWidth?: number;
}) {
  const id = useId();
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const typed = useRef({ q: "", at: 0 });

  const val = value ?? inner;
  const current = options.find((o) => o.value === val) ?? null;
  const at = () => {
    const i = options.findIndex((o) => o.value === val);
    return i < 0 ? 0 : i;
  };

  const place = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // flip up only when there is genuinely no room below and more above, so a
    // dropdown near the fold does not open off the bottom of the window.
    const up = below < 232 && r.top > below;
    setBox({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up });
  }, []);

  const pick = (v: string) => {
    if (v !== val) {
      if (value === undefined) setInner(v);
      onChange?.(v);
    }
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    place();
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", away);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", away);
    };
  }, [open, place]);

  // keep the highlighted row in view while arrowing down a long list.
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (last < 0) return;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setActive(at());
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(options[active].value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(last, a + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(last);
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    // type-to-jump, the one thing a native select does that people miss.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const q = (now - typed.current.at < 700 ? typed.current.q : "") + e.key.toLowerCase();
      typed.current = { q, at: now };
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      {name && <input type="hidden" name={name} value={val} />}
      <button
        ref={trigger}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-labelledby={labelId}
        aria-controls={open ? `${id}-list` : undefined}
        aria-activedescendant={open ? `${id}-o${active}` : undefined}
        onClick={() => {
          setActive(at());
          setOpen((v) => !v);
        }}
        onKeyDown={onKey}
        className={
          triggerClass ??
          `${control} flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-default disabled:opacity-60`
        }
      >
        <span className={`truncate ${current ? "" : "font-normal text-ink-50/70"}`}>
          {current?.label ?? placeholder}
        </span>
        <Chev open={open} className={chevronClass} />
      </button>

      {open &&
        box &&
        createPortal(
          <div
            ref={panel}
            id={`${id}-list`}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              left: box.left,
              top: box.top,
              minWidth: Math.max(box.width, minPanelWidth),
              transform: box.up ? "translateY(-100%)" : undefined,
              transformOrigin: box.up ? "bottom" : "top",
              zIndex: 80,
            }}
            className="max-h-60 animate-[pop_120ms_ease-out] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper py-1 shadow-[0_18px_44px_rgba(0,0,0,0.16)]"
          >
            {options.map((o, i) => (
              <button
                key={o.value}
                data-i={i}
                id={`${id}-o${i}`}
                type="button"
                role="option"
                aria-selected={o.value === val}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[14px] ${
                  i === active ? "bg-ember" : ""
                } ${o.value === val ? "font-bold text-flame-dark" : "font-medium text-ink-70"}`}
              >
                <span className="truncate">{o.label}</span>
                {o.value === val && (
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden
                    className="size-3.5 shrink-0 text-flame"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4 10.5 4 4 8-9" />
                  </svg>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  value,
  onChange,
  hint,
  className = "",
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  /** as on Field: hand a value in and it becomes controlled. */
  value?: string;
  onChange?: (value: string) => void;
  hint?: string;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={className}>
      <span id={id}>
        <Label>{label}</Label>
      </span>
      {/* the shell is the same one Field draws, so a select and a text field
          sitting side by side in a grid line up to the pixel. */}
      <div className={shell}>
        <Picker
          name={name}
          labelId={id}
          options={options}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange}
        />
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

export function Area({
  label,
  name,
  defaultValue = "",
  placeholder = "",
  rows = 3,
  hint,
  className = "",
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className={`${shell} items-start`}>
        <textarea
          name={name}
          rows={rows}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={`${control} resize-y`}
        />
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

/** A row of checkboxes that all post under one name, for `platforms`. */
export function CheckRow({
  label,
  name,
  options,
  values,
  hint,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  /** which boxes start ticked. Uncontrolled after that, like every other field
   *  here: the form is read once, on submit. */
  values?: readonly string[];
  hint?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-shell px-3.5 py-2 text-[14px] font-semibold has-checked:border-ink has-checked:bg-ink has-checked:text-paper"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={values?.includes(o.value)}
              className="accent-[var(--color-ink)]"
            />
            {o.label}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

export function Submit({
  children = "Save",
  pendingLabel,
  tone = "flame",
  size = "lg",
  disabled = false,
}: {
  children?: ReactNode;
  pendingLabel?: string;
  /** `ghost` is for a button that repeats on every row of a list, where a
   *  border on each one draws a column of boxes down the table.
   *
   *  `flame` is the filled one and it paints INK now, not the navy the name
   *  remembers. The name is left alone because it is typed at a few dozen call
   *  sites and renaming it changes no pixel; what a filled button looks like is
   *  decided here, once. */
  tone?: "flame" | "line" | "ghost";
  size?: "lg" | "sm" | "xs";
  /** For a submit the form cannot honour yet, like a post with no video on it.
   *  The server still checks: this only saves the round trip. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  const look =
    tone === "flame"
      ? "bg-ink text-paper hover:bg-ink/85"
      : tone === "ghost"
        ? "text-ink-50 hover:bg-shell hover:text-ink"
        : "border border-line text-ink-70 hover:text-ink";
  const box =
    size === "lg"
      ? "h-11 px-6 text-[14.5px]"
      : size === "xs"
        ? "h-7 px-2.5 text-[12px]"
        : "h-9 px-4 text-[13.5px]";

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`shrink-0 rounded-md font-semibold transition-colors disabled:opacity-60 ${look} ${box}`}
    >
      {pending ? (pendingLabel ?? "Working") : children}
    </button>
  );
}

/**
 * A submit for the one press that cannot be taken back.
 *
 * Two states, not a browser `confirm()`: the first press arms it and the second
 * one does it, with a way out sitting next to the armed button. `confirm()` is
 * a dialog some browsers suppress, it cannot say which deal it is about, and it
 * reads as a bug rather than as a question.
 *
 * This exists because deleting a deal used to be behind a closed fold, and a
 * fold is a gate by accident — one that disappears the moment the panel is
 * opened for another reason. When the delete moved out onto the page it lost
 * the only thing standing between a stray click and a deal with its accounts,
 * rules, videos and every snapshot behind them gone for good.
 */
export function ConfirmSubmit({
  children,
  confirmLabel,
  pendingLabel,
  tone = "line",
  size = "sm",
}: {
  children?: ReactNode;
  /** what the armed button says. Name the thing: "Delete Candle for good". */
  confirmLabel: ReactNode;
  pendingLabel?: string;
  tone?: "flame" | "line" | "ghost";
  size?: "lg" | "sm" | "xs";
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`shrink-0 rounded-md font-semibold transition-colors ${
          tone === "ghost"
            ? "text-ink-50 hover:bg-shell hover:text-ink"
            : "border border-line text-ink-70 hover:text-ink"
        } ${size === "xs" ? "h-7 px-2.5 text-[12px]" : "h-9 px-4 text-[13.5px]"}`}
      >
        {children ?? "Delete"}
      </button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-2">
      <Submit tone="flame" size={size} pendingLabel={pendingLabel}>
        {confirmLabel}
      </Submit>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="shrink-0 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
      >
        Cancel
      </button>
    </span>
  );
}

/** The one place a form says what happened. Error in flame, success quiet. */
export function Note({ state }: { state: { error?: string; ok?: string } }) {
  if (!state.error && !state.ok) return null;
  return (
    <span className={`text-[13.5px] ${state.error ? "text-flame-dark" : "text-ink-50"}`}>
      {state.error ?? state.ok}
    </span>
  );
}
