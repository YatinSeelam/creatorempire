/**
 * Where a batch is, as four marks on a rail.
 *
 * This replaced a row of four Stat cards reading Posted / Claimed / Delivered /
 * Approved as dates. On a job that moved through all four in one afternoon that
 * row said "Aug 22" four times, which is a table of facts and not an answer to
 * the only question the top of the page is asked: is this waiting on me.
 *
 * A step carries its date as the quiet line under it, so nothing was lost —
 * the date stopped being the headline, which is the whole change.
 *
 * Server component. `now` is drawn filled and numbered because a step nobody
 * has reached yet and a step happening right now are the same shape otherwise.
 */

export type StepState = "done" | "now" | "todo";

export type Step = {
  label: string;
  state: StepState;
  /** the date it happened, or what is being waited on. one short line. */
  note?: string;
};

function Mark({ state, index }: { state: StepState; index: number }) {
  if (state === "done") {
    return (
      <span
        className="flex size-[22px] shrink-0 items-center justify-center rounded-full border border-live-line bg-live-soft text-live"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="size-[13px]">
          <path
            d="m5 13 4 4L19 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11.5px] font-bold tabular-nums ${
        state === "now"
          ? "bg-flame text-on-accent"
          : "border border-line bg-shell text-ink-50"
      }`}
      aria-hidden="true"
    >
      {index + 1}
    </span>
  );
}

export function JobStepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col gap-3.5 sm:flex-row sm:items-center sm:gap-0">
      {steps.map((step, i) => (
        <li
          key={step.label}
          className="flex min-w-0 items-center gap-2.5 sm:flex-1 sm:last:flex-none"
        >
          <Mark state={step.state} index={i} />
          <span className="min-w-0">
            <span
              className={`block truncate text-[13.5px] leading-[1.35] tracking-[-0.01em] ${
                step.state === "todo"
                  ? "font-semibold text-ink-50"
                  : "font-bold text-ink"
              }`}
            >
              {step.label}
            </span>
            {step.note && (
              <span className="block truncate text-[12px] text-ink-50">{step.note}</span>
            )}
          </span>
          {/* the rail between two marks. it only exists on the row layout —
              stacked, the marks are already reading top to bottom. */}
          {i < steps.length - 1 && (
            <span className="mx-3 hidden h-px min-w-5 flex-1 bg-line sm:block" aria-hidden="true" />
          )}
        </li>
      ))}
    </ol>
  );
}
