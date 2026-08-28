"use client";

import { useState, useTransition } from "react";
import { Picker } from "@/components/dash/form";
import { setAccess } from "@/app/(dash)/founder/actions";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-levels";

/**
 * Somebody's access, changed where they are listed.
 *
 * Writes on change rather than behind a Save, because the three states are the
 * whole form: there is nothing else on the row to submit with it, and a picker
 * that needs a second click to mean anything is a picker people leave set to a
 * value that was never written.
 *
 * Optimistic, and it puts itself back. The action answers with a message rather
 * than throwing, so a refusal (your own row, the last founder, no service key)
 * lands as one line under the control and the picker returns to what the
 * database still says.
 */
export function AccessPicker({
  userId,
  email,
  level,
  triggerClass,
}: {
  /** empty for a grant on an address nobody has signed up on yet. */
  userId: string;
  email: string;
  level: AccessLevel;
  /**
   * The border/background/text half of the trigger, when the caller is already
   * painting the row by level and the control has to agree with it. The shape
   * of the button is not negotiable and stays below; only the colours come in.
   */
  triggerClass?: string;
}) {
  const [value, setValue] = useState<AccessLevel>(level);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pick(next: string) {
    const to = next as AccessLevel;
    if (to === value) return;

    const was = value;
    setValue(to);
    setError(null);

    const body = new FormData();
    body.set("user_id", userId);
    body.set("email", email);
    body.set("level", to);

    start(async () => {
      const res = await setAccess(body);
      if (res?.error) {
        setValue(was);
        setError(res.error);
      }
    });
  }

  return (
    <span className="flex min-w-0 flex-col items-end gap-1">
      <Picker
        name="level"
        value={value}
        onChange={pick}
        disabled={pending}
        ariaLabel={`access for ${email}`}
        options={ACCESS_LEVELS}
        minPanelWidth={150}
        triggerClass={`flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${
          triggerClass ??
          (value === "founder"
            ? "border-flame/40 bg-ember text-flame"
            : value === "student"
              ? "border-line bg-paper text-ink-70"
              : "border-line bg-paper text-ink-50")
        }`}
        chevronClass="size-3.5"
      />
      {error && (
        <span className="max-w-[220px] text-right text-[11.5px] leading-[1.4] text-flame-dark">
          {error}
        </span>
      )}
    </span>
  );
}
