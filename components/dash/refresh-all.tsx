"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { refreshEverything, type RefreshState } from "@/app/(dash)/deals/actions";
import type { RefreshQuota } from "@/lib/deals";
import { shortDate } from "@/lib/money";

/**
 * The manual refresh, and the confirmation in front of it.
 *
 * Accounts pull themselves every few days because a daily pass over everybody's
 * roster is most of the scraper bill. This is the way to have today's number
 * today, and it is rationed, so it cannot be a button that just runs: somebody
 * clicking it twice to see whether it worked would spend a third of the month.
 *
 * The dialog exists to say three things before the spend, in this order: what
 * this does, that it costs one of a fixed few, and how many are left after it.
 * The count is also on the trigger itself, so the price is legible before the
 * click rather than only after it.
 *
 * The number shown is the server's, re-read on every page load. It is never the
 * authority: `claim_manual_refresh()` in the database is, and it takes the
 * refresh under a per-person lock, so two tabs racing cannot both spend the last
 * one.
 */
export function RefreshAll({
  quota,
  /** "bar" is the page header pill. "wide" fills a card footer or an empty state. */
  variant = "bar",
}: {
  quota: RefreshQuota;
  variant?: "bar" | "wide";
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<RefreshState, FormData>(refreshEverything, {});

  // a database without the migration answers with no reset date. that is "count
  // unknown", not "none left" — the button still works and the claim is still
  // what decides, so hiding the count is the honest render.
  const known = quota.resetsOn !== null;

  // the action's own answer wins once there is one: the page's copy was read
  // before the spend and the reply is what actually happened.
  const remaining = state.remaining ?? quota.remaining;
  const resetsOn = state.resetsOn ?? quota.resetsOn;
  const spent = known && remaining <= 0;

  // close on the reply, not on the click that sent it. closing first would hide
  // the one place the result can be read.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok || state.error) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const back = resetsOn ? shortDate(resetsOn) : "the 1st";

  return (
    <>
      <div className={variant === "wide" ? "flex flex-col gap-2" : "flex items-center gap-2.5"}>
        {/* the result sits beside the button rather than inside the dialog,
            because by the time there is one the dialog is gone and the thing
            worth reading is on the page the numbers just changed. */}
        {(state.ok || state.error) && (
          <p
            className={`text-[12.5px] leading-[1.45] ${
              state.error ? "text-flame" : "text-ink-50"
            } ${variant === "bar" ? "hidden max-w-[42ch] md:block" : ""}`}
          >
            {state.error ?? state.ok}
          </p>
        )}

        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={spent}
          title={
            spent
              ? `No refreshes left. ${quota.quota} more on ${back}.`
              : "Pull fresh numbers for every account now"
          }
          className={`flex h-9 shrink-0 items-center gap-2 rounded-pill border border-line bg-paper px-4 text-[13.5px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame disabled:cursor-not-allowed disabled:border-line disabled:text-ink-50 disabled:hover:text-ink-50 ${
            variant === "wide" ? "w-full justify-center" : ""
          }`}
        >
          <RefreshIcon />
          Refresh now
          {known && (
            <span
              className={`rounded-pill px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ${
                spent ? "bg-shell text-ink-50" : "bg-ember text-flame-dark"
              }`}
            >
              {remaining}
            </span>
          )}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/35"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Refresh every account"
            className="relative w-full max-w-[440px] overflow-hidden rounded-card border border-line bg-paper text-left shadow-[0_30px_70px_-30px_rgb(16_16_16/0.5)]"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ember text-flame"
              >
                <RefreshIcon />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold tracking-[-0.015em]">
                  Refresh every account?
                </h2>
                <p className="mt-0.5 text-[13px] text-ink-50">
                  This pulls all of them right now.
                </p>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-[13.5px] leading-[1.6] text-ink-70">
                Your accounts already refresh themselves, on their own, for free,
                more often while a video is new. This is for when you need
                today&apos;s numbers today.
              </p>

              {known ? (
                <div className="mt-3.5 rounded-2xl bg-shell px-3.5 py-3">
                  <p className="text-[13.5px] font-semibold leading-[1.5]">
                    You get {quota.quota} a month. This uses one.
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-ink-50">
                    {remaining === 1
                      ? `That is your last one until ${back}.`
                      : `${remaining - 1} left after this, then ${quota.quota} more on ${back}.`}
                  </p>
                </div>
              ) : (
                <p className="mt-3.5 rounded-2xl bg-shell px-3.5 py-3 text-[13px] leading-[1.5] text-ink-50">
                  Manual refreshes are limited each month. This uses one.
                </p>
              )}

              <p className="mt-3 text-[12.5px] leading-[1.5] text-ink-50">
                A big roster can take a minute. Leave this page open.
              </p>

              <form action={action} className="mt-4 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-10 items-center rounded-pill border border-line px-4 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <Confirm last={known && remaining === 1} />
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Split out so `useFormStatus` can see the form it belongs to.
 *
 * The running state counts seconds rather than promising an estimate, because
 * nothing on the client knows how many accounts there are: the count lives
 * behind rls and the action is what discovers it. A ticking number is the
 * honest version of "this takes a while" — it says the sweep is alive, which is
 * the actual question somebody staring at a spinner for a minute has. The
 * reply then says what it really took.
 */
function Confirm({ last }: { last: boolean }) {
  const { pending } = useFormStatus();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!pending) return;
    // measured from a timestamp rather than counted up, so a throttled tab
    // reports the real wait instead of however many ticks it was awake for.
    const startedAt = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [pending]);

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-10 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
    >
      {pending
        ? `Pulling every account${elapsed > 2 ? `, ${elapsed}s` : ""}`
        : last
          ? "Use my last one"
          : "Use one refresh"}
    </button>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 0 0-14-4.5L4 9M4 13a8 8 0 0 0 14 4.5L20 15" />
      <path d="M4 5v4h4M20 19v-4h-4" />
    </svg>
  );
}
