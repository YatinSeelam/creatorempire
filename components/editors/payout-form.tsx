"use client";

import { useActionState, useState } from "react";
import {
  openStripeDashboard,
  requestPayout,
  saveEditorPayoutDetails,
  startStripeOnboarding,
  type EditorActionState,
} from "@/app/editors/actions";

const empty: EditorActionState = {};

const shell =
  "flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame";
const control =
  "w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none";

// only the rails we can actually send down. offering cash app or wise here
// would be offering a payout nothing can pay.
//
// stripe goes to a bank account or a debit card and needs a one-time setup on
// stripe's own screens, which is why picking it swaps the address box for the
// connect panel instead of asking for something to type.
const METHODS = [
  { value: "stripe", label: "bank or card", hint: "via stripe", icon: <Bank /> },
  { value: "paypal", label: "paypal", hint: "email address", icon: <PayPal /> },
  { value: "venmo", label: "venmo", hint: "@handle", icon: <Venmo /> },
];

/**
 * Where approved money gets sent. One method, one address, saved whole.
 *
 * Tiles rather than a dropdown. Three rails is a small enough set to show at
 * once, and which one you are on is the thing this card exists to answer: a
 * select hides the answer behind a click and then looks identical whichever
 * way it is set.
 *
 * Only rails we can actually send down are here. Offering wise or payoneer
 * would be offering a payout nothing can pay.
 */
export function PayoutDetailsForm({
  initial,
}: {
  initial: { method: string; address: string } | null;
}) {
  const [state, action, pending] = useActionState(saveEditorPayoutDetails, empty);
  // controlled so the address box can disappear for stripe, where there is
  // nothing to type: the destination is the connected account.
  const [method, setMethod] = useState(initial?.method ?? "paypal");
  const current = METHODS.find((m) => m.value === method) ?? METHODS[1];

  return (
    <form action={action}>
      {/* the tiles are buttons, so the value the form posts is this input and
          not whichever tile happened to be focused when enter was pressed. */}
      <input type="hidden" name="method" value={method} />

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-wrap gap-2.5">
          {METHODS.map((m) => {
            const on = m.value === method;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                aria-pressed={on}
                className={`flex min-w-[152px] items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                  on
                    ? "border-flame bg-ember"
                    : "border-line bg-paper hover:border-ink-50/40"
                }`}
              >
                <span className={on ? "text-flame" : "text-ink-50"}>{m.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold tracking-[-0.01em]">
                    {m.label}
                  </span>
                  <span className="block truncate text-[12px] text-ink-50">
                    {m.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-w-[240px] flex-1 border-line sm:border-l sm:pl-6">
          {method === "stripe" ? (
            <>
              <p className="text-[12.5px] text-ink-50">where it lands</p>
              <p className="mt-1 text-[14.5px] font-bold">
                your connected stripe account
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-50">
                stripe pays a bank account or a debit card, not a paypal
                balance. save this, then connect below.
              </p>
            </>
          ) : (
            <>
              <label className="text-[12.5px] text-ink-50" htmlFor="payout-address">
                your {current.label} account
              </label>
              <div className={`mt-1.5 ${shell}`}>
                <input
                  id="payout-address"
                  name="address"
                  defaultValue={initial?.address ?? ""}
                  placeholder={
                    method === "venmo" ? "@your-handle" : "you@paypal.com"
                  }
                  className={control}
                />
              </div>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-pill border border-line bg-paper px-5 py-2.5 text-[14px] font-bold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark disabled:opacity-60 sm:self-end"
        >
          {pending ? "saving..." : "save"}
        </button>
      </div>

      {(state.error || state.ok) && (
        <p
          className={`mt-3 text-[13px] ${state.error ? "text-flame-dark" : "text-live"}`}
        >
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}

/** Same 1.7 stroke language as every other glyph on this side. */
const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Bank() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px] shrink-0" aria-hidden="true">
      <g {...s}>
        <path d="M3.4 9.6 12 4.6l8.6 5M4.8 9.6v8M9.6 9.6v8M14.4 9.6v8M19.2 9.6v8M3 19.4h18" />
      </g>
    </svg>
  );
}

function PayPal() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px] shrink-0" aria-hidden="true">
      <g {...s}>
        <path d="M6.6 19.4 9 4.6h5.2a3.6 3.6 0 0 1 0 7.2H9.9" />
        <path d="M11.4 19.4 12 15.6h2.6a3.4 3.4 0 0 0 3.3-2.8" />
      </g>
    </svg>
  );
}

function Venmo() {
  return (
    <svg viewBox="0 0 24 24" className="size-[22px] shrink-0" aria-hidden="true">
      <g {...s}>
        <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.2" />
        <path d="M8.4 8.2c1.6 2 2.4 4.4 2.4 6.6 1.9-2 3-4.2 3-6.1" />
      </g>
    </svg>
  );
}

export type StripeStatus = {
  connected: boolean;
  detailsSubmitted: boolean;
  payoutsEnabled: boolean;
  disabledReason: string | null;
  requirementsDue: number;
};

/**
 * Stripe Connect, in three states and no more.
 *
 * not connected -> connect
 * connected but not payable -> finish, and say what stripe is still waiting on
 * payable -> a quiet line and a way back into stripe's own dashboard
 *
 * The middle state is the one that matters. Stripe verification is not instant
 * in most countries, and an editor who finished the form and sees nothing has
 * no way to tell "we are checking" from "it broke". `payoutsEnabled` is the
 * same flag `claim_payout_batch` refuses on, so this panel and the cash out
 * button can never disagree.
 */
export function StripeConnectPanel({ status }: { status: StripeStatus }) {
  const [connectState, connect, connecting] = useActionState(
    startStripeOnboarding,
    empty
  );
  const [dashState, dashboard, opening] = useActionState(openStripeDashboard, empty);
  const error = connectState.error ?? dashState.error;

  if (status.payoutsEnabled) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-pill bg-ember px-3 py-1 text-[12.5px] font-bold text-flame">
          stripe connected
        </span>
        <span className="text-[13px] text-ink-50">
          cashing out sends it to your stripe balance, and stripe pays your bank
          from there.
        </span>
        <form action={dashboard}>
          <button
            type="submit"
            disabled={opening}
            className="rounded-pill border border-line px-4 py-2 text-[13px] font-semibold text-ink-50 transition-colors hover:border-flame hover:text-flame disabled:opacity-60"
          >
            {opening ? "opening..." : "change bank details"}
          </button>
        </form>
        {error && <p className="w-full text-[13px] text-flame-dark">{error}</p>}
      </div>
    );
  }

  return (
    <form action={connect} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={connecting}
        className="rounded-pill bg-flame px-5 py-2.5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
      >
        {connecting
          ? "opening stripe..."
          : status.connected
            ? "finish setting up stripe"
            : "connect stripe"}
      </button>
      <span className="text-[13px] text-ink-50">
        {!status.connected
          ? "stripe asks for your bank or debit card and your id. we never see any of it."
          : status.disabledReason
            ? `stripe still needs something: ${status.disabledReason.replace(/[._]/g, " ")}`
            : status.requirementsDue > 0
              ? `stripe is waiting on ${status.requirementsDue} more ${status.requirementsDue === 1 ? "detail" : "details"}.`
              : "stripe is checking your details. we will open cash out the moment it clears."}
      </span>
      {error && <p className="w-full text-[13px] text-flame-dark">{error}</p>}
    </form>
  );
}

/**
 * Cash out.
 *
 * The button and nothing else. It used to carry a sentence beside it saying
 * what would happen and where the money would go, which was three things the
 * page already says: the balance is in the tile above it and the rail is in the
 * card below it. What is left is the outcome of the press, which is the one
 * thing nothing else can tell you.
 *
 * There is no pending state to render because there is no queue behind this:
 * the press either sends the money or comes back with a reason.
 */
export function RequestPayoutButton({ dueCents }: { dueCents: number }) {
  const [state, action, pending] = useActionState(requestPayout, empty);

  return (
    <form action={action} className="shrink-0 text-right">
      <button
        type="submit"
        disabled={pending || dueCents <= 0}
        className="rounded-xl bg-flame px-6 py-3 text-[15px] font-bold tracking-[-0.01em] text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-50"
      >
        {pending ? "sending..." : "cash out"}
      </button>
      {(state.error || state.ok) && (
        <p
          className={`mt-2 max-w-[280px] text-[12.5px] ${state.error ? "text-flame-dark" : "text-live"}`}
        >
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}
