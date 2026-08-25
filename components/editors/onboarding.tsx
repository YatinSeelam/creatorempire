/**
 * The three-step onboarding rail. Server component, no state: the page decides
 * which step you are on from what already exists in the database (application
 * row, portfolio clips), so a refresh can never disagree with reality.
 *
 * `current` is the 0-based active step. Everything before it renders done
 * (tick), the active one is filled, the rest wait their turn.
 */

const STEPS = ["your details", "your portfolio", "take jobs, get paid"] as const;

function Tick() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OnboardingRail({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12.5px] font-bold ${
                  done
                    ? "bg-ember text-flame"
                    : active
                      ? "bg-flame text-on-accent"
                      : "border border-line text-ink-50"
                }`}
              >
                {done ? <Tick /> : i + 1}
              </span>
              <span
                className={`text-[13.5px] font-semibold ${
                  active ? "text-ink" : done ? "text-ink-70" : "text-ink-50"
                }`}
              >
                {label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="h-px w-6 bg-line" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
