"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

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

export function Select({
  label,
  name,
  options,
  defaultValue,
  onChange,
  hint,
  className = "",
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  /** for a caller that has to draw something else differently, not for state.
   *  the select stays uncontrolled either way. */
  onChange?: (value: string) => void;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className={shell}>
        <select
          name={name}
          defaultValue={defaultValue}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          className={`${control} cursor-pointer`}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
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
