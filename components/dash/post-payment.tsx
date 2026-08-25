"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { setPostPayment } from "@/app/(dash)/deals/actions";
import type { CutPay } from "@/lib/deals";
import { money, moneyExact } from "@/lib/money";

/**
 * The Payment cell, and the editor behind it.
 *
 * The number in the column IS the button. A row of forty posts cannot carry a
 * forty-deep column of "Edit" links beside the amounts, and the amount is the
 * thing somebody is looking at when they decide it is wrong — so that is where
 * the click goes.
 *
 * Everything about the row's money is settled here in one dialog rather than
 * across a button and a menu: an amount, and whether the post counts at all.
 * Those two decisions contradict each other often enough (setting a price on a
 * post you just excluded) that splitting them across two submits would let a
 * creator save a state the totals then disagree with.
 *
 * position: fixed, not absolute. The posts table lives inside a Panel that clips
 * to its own corners, and an absolutely positioned dialog would be cut off by it
 * however high the z-index went.
 */
export function PostPayment({
  dealId,
  videoIds,
  title,
  pay,
  perPost = true,
}: {
  dealId: string;
  /** every post of the cut. the amount is written to all of them. */
  videoIds: string[];
  title: string;
  pay: CutPay;
  /**
   * Whether this deal pays anything per post at all.
   *
   * False on a one-off fee or a retainer with no bonus rule: the money is owed
   * for the deal or for the month, and there is no share of it that belongs to
   * one cut. The column then reads "-" rather than $0, because a deal owing $750
   * whose every row said $0.00 is the single loudest way this page has of
   * looking broken while being right. Setting an amount by hand is still the way
   * to split such a fee across posts, so the cell stays a button either way.
   */
  perPost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(setPostPayment, {});

  // the dialog closes on the action reporting a write, not on the click that
  // submitted it: closing first would hide the one place an error can be read.
  //
  // Done by comparing state during render rather than in an effect, which is the
  // pattern the rest of this app uses for "react to a value changing" — an effect
  // would paint the open dialog for a frame after the save and cascade a second
  // render. The comparison is on the object, not on `state.ok`: two saves in a
  // row return the same string and a fresh object, so identity is the only thing
  // that reliably says "this is a new answer".
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const edited = pay.overrideCents !== null;
  // nothing per post, nothing set by hand: there is no number here to show.
  const blank = !perPost && !edited && !pay.ignored;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          pay.ignored
            ? "Not counted. Click to put it back in."
            : blank
              ? "This deal's fee is owed for the deal, not per post. Click to give this one its own amount."
              : "Click to set a custom amount or ignore this post"
        }
        className={`flex h-8 w-full items-center justify-end gap-1.5 rounded-pill px-2 text-[13.5px] font-semibold tabular-nums transition-colors ${
          pay.ignored
            ? "text-ink-50 hover:bg-shell"
            : edited
              ? "bg-ember text-flame-dark hover:bg-ember"
              : pay.payCents > 0
                ? "hover:bg-shell"
                : "text-ink-50 hover:bg-shell"
        }`}
      >
        {blank ? <span className="text-ink-50">-</span> : money(pay.payCents)}
        {/* only the hand-set rows carry a mark. a pencil on every row is the
            column of buttons this design exists to avoid. */}
        {edited && (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3 shrink-0">
            <path
              d="M4 20h4L19 9l-4-4L4 16v4Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <span className="sr-only">Edit what this post pays</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-ink/35"
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-label="Post payment"
            className="relative w-full max-w-[420px] overflow-hidden rounded-card border border-line bg-paper text-left shadow-[0_30px_70px_-30px_rgb(16_16_16/0.5)]"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <span
                aria-hidden="true"
                className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-ember text-[15px] font-bold text-flame"
              >
                $
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold tracking-[-0.015em]">Post payment</h2>
                <p className="mt-0.5 truncate text-[13px] text-ink-50">{title}</p>
              </div>
            </div>

            <form action={action} className="px-5 py-4">
              {videoIds.map((id) => (
                <input key={id} type="hidden" name="video_id" value={id} />
              ))}
              <input type="hidden" name="deal_id" value={dealId} />

              {/* what the rules say, so the amount being replaced is on screen
                  next to the field replacing it. */}
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-shell px-3.5 py-3">
                <span className="text-[13.5px] text-ink-50">
                  {pay.baseCents === null
                    ? "The deal's own amount"
                    : `Base ${money(pay.baseCents)} · bonus ${money(pay.bonusCents)}`}
                </span>
                <span className="shrink-0 text-[14px] font-bold tabular-nums">
                  {moneyExact(pay.computedCents)}
                </span>
              </div>

              <label className="mt-4 block">
                <span className="text-[13.5px] font-semibold">Set payment amount</span>
                <span className="mt-1.5 flex h-11 items-center gap-1.5 rounded-xl border border-line bg-paper px-3 focus-within:border-flame">
                  <span aria-hidden="true" className="text-[14px] font-semibold text-ink-50">
                    $
                  </span>
                  <input
                    name="amount"
                    inputMode="decimal"
                    autoFocus
                    defaultValue={
                      pay.overrideCents === null
                        ? ""
                        : (pay.overrideCents / 100).toFixed(2).replace(/\.00$/, "")
                    }
                    placeholder={`Default (${moneyExact(pay.computedCents)})`}
                    className="w-full min-w-0 bg-transparent text-[14px] font-medium tabular-nums placeholder:font-normal placeholder:text-ink-50 focus:outline-none"
                  />
                </span>
                <span className="mt-1.5 block text-[12.5px] text-ink-50">
                  Leave it blank to go back to what the deal pays.
                </span>
              </label>

              <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line px-3.5 py-3">
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">Ignore this post</span>
                  <span className="mt-0.5 block text-[12.5px] text-ink-50">
                    Leave it out of the deal&apos;s views and totals
                  </span>
                </span>
                {/* a real checkbox under a drawn switch: it submits itself, it is
                    reachable by keyboard, and it needs no state up here. */}
                <input
                  type="checkbox"
                  name="ignore"
                  defaultChecked={pay.ignored}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="relative h-6 w-11 shrink-0 rounded-full bg-line transition-colors peer-checked:bg-flame peer-focus-visible:ring-2 peer-focus-visible:ring-flame/40 after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-paper after:transition-transform after:content-[''] peer-checked:after:translate-x-5"
                />
              </label>

              {state.error && (
                <p className="mt-3 text-[13px] font-semibold text-flame-dark">{state.error}</p>
              )}

              <div className="mt-4 flex items-center gap-2">
                <Save />
                {edited && (
                  <button
                    type="submit"
                    name="reset"
                    value="on"
                    className="h-10 shrink-0 rounded-pill px-3 text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-ink"
                  >
                    Reset to default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="ml-auto h-10 shrink-0 rounded-pill px-3 text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/** Separate so `useFormStatus` reads the form it sits inside. */
function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-10 shrink-0 rounded-pill bg-flame px-5 text-[13.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
    >
      {pending ? "Saving" : "Save"}
    </button>
  );
}
