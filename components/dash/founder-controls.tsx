"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addFounder,
  removeFounder,
  setGrantRole,
  type FounderActionState,
} from "@/app/(dash)/founder/access/actions";

const empty: FounderActionState = {};

/**
 * Grant somebody access, as one of the two roles. Creator is the default
 * because it is the one handed out often and the narrow one: the dashboard,
 * deals and tools, nothing that runs the business.
 */
export function AddFounderForm() {
  const [state, action] = useActionState(addFounder, empty);

  return (
    <form action={action}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          aria-label="Email address"
          className="h-[48px] flex-1 rounded-2xl border border-line bg-shell px-4 text-[15px] placeholder:text-ink-50/70 focus:border-flame focus:outline-none"
        />
        <select
          name="role"
          defaultValue="creator"
          aria-label="Role"
          className="h-[48px] shrink-0 cursor-pointer rounded-2xl border border-line bg-shell px-4 text-[15px] focus:border-flame focus:outline-none"
        >
          <option value="creator">creator</option>
          <option value="founder">founder</option>
        </select>
        <Submit label="Grant access" pending="Adding" />
      </div>

      {state.error && <Note tone="bad">{state.error}</Note>}
      {state.ok && <Note tone="good">{state.ok}</Note>}
    </form>
  );
}

/** Flip one person between the two grants. One button, it says the target. */
export function RoleSwitchForm({
  email,
  role,
  disabled,
}: {
  email: string;
  role: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(setGrantRole, empty);
  const next = role === "founder" ? "creator" : "founder";

  if (disabled) return null;

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="role" value={next} />
      {state.error && (
        <span className="text-[13px] text-flame-dark">{state.error}</span>
      )}
      <SwitchButton next={next} />
    </form>
  );
}

function SwitchButton({ next }: { next: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-flame disabled:opacity-60"
    >
      {pending ? "Changing" : `Make ${next}`}
    </button>
  );
}

export function RemoveFounderForm({
  email,
  disabled,
}: {
  email: string;
  disabled?: boolean;
}) {
  const [state, action] = useActionState(removeFounder, empty);

  if (disabled) {
    return <span className="text-[13.5px] text-ink-50">That&rsquo;s you</span>;
  }

  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="email" value={email} />
      {state.error && (
        <span className="text-[13px] text-flame-dark">{state.error}</span>
      )}
      <RemoveButton />
    </form>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={busy}
      className="h-[48px] shrink-0 rounded-pill bg-flame px-6 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-70"
    >
      {busy ? pending : label}
    </button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-flame-dark disabled:opacity-60"
    >
      {pending ? "Removing" : "Remove"}
    </button>
  );
}

function Note({
  tone,
  children,
}: {
  tone: "good" | "bad";
  children: React.ReactNode;
}) {
  return (
    <p
      role="status"
      className={`mt-3 text-[13.5px] leading-[1.55] ${
        tone === "bad" ? "text-flame-dark" : "text-ink-70"
      }`}
    >
      {children}
    </p>
  );
}
