"use client";

import { useActionState, useOptimistic } from "react";
import { useFormStatus } from "react-dom";
import {
  deleteAccount,
  savePhone,
  saveProfile,
  setNotification,
  type SettingsState,
} from "@/app/(dash)/settings/actions";

const empty: SettingsState = {};

export function ProfileForm({
  fullName,
  handle,
  niche,
  email,
}: {
  fullName: string;
  handle: string;
  niche: string;
  email: string;
}) {
  const [state, action] = useActionState(saveProfile, empty);

  return (
    <form action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="full_name" defaultValue={fullName} placeholder="Your name" />
        <Field
          label="Handle"
          name="handle"
          defaultValue={handle}
          placeholder="yourhandle"
          prefix="@"
        />
        <div>
          <Label>Email</Label>
          {/* auth owns the email. changing it is a confirm-by-link flow, not a
              text field, so it is shown rather than edited. */}
          <p className="mt-1.5 flex h-11 items-center truncate rounded-xl border border-line bg-shell px-3.5 text-[14.5px] font-medium text-ink-50">
            {email}
          </p>
        </div>
        <Field
          label="Niche"
          name="niche"
          defaultValue={niche}
          placeholder="Skincare, home, coffee"
        />
      </div>

      <div className="mt-5 flex items-center gap-4">
        <SaveButton />
        {state.error && (
          <span className="text-[13.5px] text-flame-dark">{state.error}</span>
        )}
        {state.ok && (
          <span className="text-[13.5px] text-ink-50">{state.ok}</span>
        )}
      </div>
    </form>
  );
}

/**
 * One switch, one form, one row write. useOptimistic flips it the instant it
 * is clicked so the toggle doesn't sit still while the round trip happens.
 */
export function NotificationToggle({
  name,
  label,
  note,
  on,
}: {
  name: string;
  label: string;
  note: string;
  on: boolean;
}) {
  const [state, action] = useActionState(setNotification, empty);
  const [optimistic, setOptimistic] = useOptimistic(on);

  return (
    <form
      action={(formData) => {
        setOptimistic(formData.get("next") === "on");
        return action(formData);
      }}
      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <input type="hidden" name="key" value={name} />
      <input type="hidden" name="next" value={optimistic ? "off" : "on"} />

      <div className="min-w-0">
        <p className="text-[14.5px] font-bold tracking-[-0.01em]">{label}</p>
        <p className="mt-0.5 text-[13px] text-ink-50">
          {state.error ?? note}
        </p>
      </div>

      <button
        type="submit"
        role="switch"
        aria-checked={optimistic}
        aria-label={label}
        className={`flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 transition-colors ${
          optimistic ? "bg-flame" : "bg-line"
        }`}
      >
        <span
          className={`size-5 rounded-full bg-white shadow-sm transition-transform ${
            optimistic ? "translate-x-5" : ""
          }`}
        />
      </button>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-pill bg-flame px-6 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-70"
    >
      {pending ? "Saving" : "Save changes"}
    </button>
  );
}

/** Sentence case, not the uppercase eyebrow the stat cards use. Four of those
 *  stacked over four inputs read as four section headings rather than as
 *  labels on the fields under them. */
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] font-medium text-ink-50">{children}</span>;
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  prefix,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  prefix?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 flex h-11 items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame">
        {prefix && <span className="text-[14.5px] text-ink-50">{prefix}</span>}
        <input
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className="h-full w-full bg-transparent text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
        />
      </div>
    </div>
  );
}

/**
 * The last thing on the account tab. Closed by default: a red button that is
 * always on screen gets pressed by accident, and this one cannot be undone. Open,
 * it wants the word typed, and the action checks the word again server side.
 */
export function DeleteAccount({ email }: { email: string }) {
  const [state, action] = useActionState(deleteAccount, empty);

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-ink">Delete account</span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-50">
            Every deal, video, payout, brand, post and portfolio on {email} goes with it. No undo.
          </span>
        </span>
        <span className="shrink-0 rounded-pill border border-line px-4 py-1.5 text-[13px] font-semibold text-ink-50 transition-colors group-open:hidden hover:text-ink">
          Delete…
        </span>
      </summary>

      <form action={action} className="flex flex-wrap items-end gap-3 px-5 pb-5 sm:px-6">
        <label className="min-w-[200px] flex-1">
          <span className="mb-1.5 block text-[12.5px] font-semibold text-ink-70">
            Type <span className="font-mono">delete</span> to confirm
          </span>
          <input
            name="confirm"
            autoComplete="off"
            placeholder="delete"
            className="h-10 w-full rounded-[10px] border border-line bg-paper px-3 text-[14px] outline-none focus:border-flame"
          />
        </label>
        <DeleteButton />
        {state.error && (
          <p className="basis-full text-[13px] text-flame-dark">{state.error}</p>
        )}
      </form>
    </details>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 shrink-0 rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
    >
      {pending ? "Deleting…" : "Delete my account"}
    </button>
  );
}

/**
 * The phone number, and a switch that is honestly off.
 *
 * Texting is not wired. The number is collected anyway because it is the slow
 * half of shipping it: people give it once, and having it already means the
 * day sms goes live is a deploy rather than a campaign asking everybody to
 * come back and type it.
 *
 * The toggle is disabled rather than hidden on purpose. Hidden reads as "this
 * product does not do that"; disabled with the word `soon` on it reads as "not
 * yet", which is what is true, and it is what makes typing the number feel
 * like it is for something.
 */
export function PhoneForm({ phone }: { phone: string }) {
  const [state, action] = useActionState(savePhone, empty);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
            Mobile number
          </span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={phone}
            placeholder="+1 555 010 4477"
            maxLength={24}
            className="w-full rounded-xl border border-line bg-shell px-3.5 py-3 text-[14.5px] outline-none transition-colors placeholder:text-ink-50 focus:border-flame"
          />
        </label>
        <SavePhoneButton />
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-shell px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[14.5px] font-bold tracking-[-0.01em]">
            Text me the urgent ones
          </p>
          <p className="mt-0.5 text-[13px] text-ink-50">
            A claim, a delivered cut, a client sign-off. Not built yet, so leave
            your number and it turns itself on.
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span className="rounded-pill bg-ember px-2.5 py-1 text-[12px] font-semibold text-flame">
            soon
          </span>
          <span
            role="switch"
            aria-checked={false}
            aria-disabled
            aria-label="Text me the urgent ones"
            className="flex h-6 w-11 shrink-0 items-center rounded-pill bg-line p-0.5 opacity-60"
          >
            <span className="size-5 rounded-pill bg-paper shadow-[0_1px_2px_rgb(16_16_16/0.2)]" />
          </span>
        </span>
      </div>

      {state.error && (
        <p className="text-[13.5px] font-semibold text-flame-dark">{state.error}</p>
      )}
      {state.ok && <p className="text-[13.5px] font-semibold text-live">{state.ok}</p>}
    </form>
  );
}

/** The phone form's. Same drawing as `SaveButton`, its own component because
 *  `useFormStatus` only reports the form it is rendered inside — and the two
 *  were wired to each other's form until 2026-08-24, so the profile card asked
 *  to "Save number" under four fields that are not a number. */
function SavePhoneButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 shrink-0 rounded-pill bg-flame px-6 text-[14.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-70"
    >
      {pending ? "Saving" : "Save number"}
    </button>
  );
}
