"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { leaveVerdict, type ReviewState } from "@/app/review/actions";

/**
 * The whole reviewer-facing write: a name, a line, and a verdict.
 *
 * Three buttons, one form, and the verdict rides in on the button's own
 * `name`/`value` rather than a radio group. That is deliberate: the reviewer
 * is somebody's brand contact opening a link on their phone between meetings,
 * and "pick a radio then press submit" is one step more than that person will
 * do. Approve is one tap.
 *
 * The name is remembered in localStorage so a second round of feedback does
 * not ask again. It is a convenience, never an identity: the creator knows who
 * they sent the link to, and the app never pretends to.
 */

const NAME_KEY = "ugcf_review_name";

type Cut = { id: string; version: number };

export function VerdictForm({
  token,
  cuts,
  hasCut,
}: {
  token: string;
  cuts: Cut[];
  /** false while the editor has not sent anything yet: nothing to judge. */
  hasCut: boolean;
}) {
  const [state, action] = useActionState<ReviewState, FormData>(leaveVerdict, {});
  const nameRef = useRef<HTMLInputElement>(null);

  // React clears an uncontrolled form after a server action resolves, so the
  // name has to be put back rather than held in state. Keyed on `state` so it
  // runs on mount and again after every send.
  useEffect(() => {
    const field = nameRef.current;
    if (!field || field.value) return;
    try {
      const saved = window.localStorage.getItem(NAME_KEY);
      if (saved) field.value = saved;
    } catch {
      // private mode, or storage is full. the field just starts empty.
    }
  }, [state]);

  // Remembered on the way out, not on the way back: by the time the action
  // resolves the field has already been reset and the typed name is gone.
  const submit = (formData: FormData) => {
    try {
      const typed = String(formData.get("name") ?? "").trim();
      if (typed) window.localStorage.setItem(NAME_KEY, typed);
    } catch {
      // losing it only costs one retype
    }
    action(formData);
  };

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
            Your name
          </span>
          <input
            ref={nameRef}
            name="name"
            defaultValue=""
            placeholder="who is signing off"
            maxLength={80}
            className="w-full rounded-card border border-line bg-paper px-4 py-3 text-[14.5px] outline-none transition-colors placeholder:text-ink-50 focus:border-flame"
          />
        </label>

        {cuts.length > 1 && (
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
              About
            </span>
            <select
              name="deliverable"
              defaultValue=""
              className="w-full rounded-card border border-line bg-paper px-4 py-3 text-[14.5px] outline-none transition-colors focus:border-flame"
            >
              <option value="">the whole batch</option>
              {cuts.map((cut) => (
                <option key={cut.id} value={cut.id}>
                  cut {cut.version}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
          Feedback
        </span>
        <textarea
          name="body"
          rows={4}
          maxLength={2000}
          placeholder="what works, what needs to change, timestamps if you have them"
          className="w-full resize-y rounded-card border border-line bg-paper px-4 py-3 text-[14.5px] leading-[1.6] outline-none transition-colors placeholder:text-ink-50 focus:border-flame"
        />
        <span className="mt-1.5 block text-[12.5px] text-ink-50">
          Needed for changes and notes. Optional if you are approving.
        </span>
      </label>

      <Buttons hasCut={hasCut} />

      {state.error && (
        <p className="text-[13.5px] font-semibold text-flame-dark">{state.error}</p>
      )}
      {state.ok && (
        <p className="text-[13.5px] font-semibold text-live">{state.ok}</p>
      )}
    </form>
  );
}

/**
 * Split out so `useFormStatus` can see the form it belongs to. The clicked
 * button is tracked locally only so the pending label lands on the right one;
 * the value the server reads is the button's own.
 */
function Buttons({ hasCut }: { hasCut: boolean }) {
  const { pending } = useFormStatus();
  const [picked, setPicked] = useState<string | null>(null);
  const busy = pending;

  const label = (key: string, idle: string, working: string) =>
    busy && picked === key ? working : idle;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="submit"
        name="verdict"
        value="approved"
        disabled={busy || !hasCut}
        onClick={() => setPicked("approved")}
        className="rounded-pill bg-ink px-6 py-3 text-[14.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {label("approved", "Approve this", "Sending")}
      </button>

      <button
        type="submit"
        name="verdict"
        value="changes"
        disabled={busy || !hasCut}
        onClick={() => setPicked("changes")}
        className="rounded-pill bg-flame px-6 py-3 text-[14.5px] font-bold text-white transition-colors hover:bg-flame-dark disabled:opacity-40"
      >
        {label("changes", "Ask for changes", "Sending")}
      </button>

      <button
        type="submit"
        name="verdict"
        value="comment"
        disabled={busy}
        onClick={() => setPicked("comment")}
        className="rounded-pill border border-line px-6 py-3 text-[14.5px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-40"
      >
        {label("comment", "Just a note", "Sending")}
      </button>
    </div>
  );
}
