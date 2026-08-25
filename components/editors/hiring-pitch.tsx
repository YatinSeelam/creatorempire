import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/editors/ui";
import { role } from "@/lib/hiring";

/**
 * The job post as a page. Server component, no state, one call to action.
 *
 * Shown to a stranger who clicked the link out of a discord server, and again
 * (without the button) above the application form, so the terms an applicant
 * agreed to are still on screen while they answer.
 */

function Tick() {
  return (
    <svg viewBox="0 0 24 24" className="mt-[3px] size-4 shrink-0 text-flame" aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function List({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5 text-[14.5px] leading-[1.5] text-ink-70">
          <Tick />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** The two role panels on their own, so the landing can place them under its hero. */
export function RolePanels() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="what you'll be doing">
        <List items={role.doing} />
        <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-[1.55] text-ink-50">
          {role.notCreative}
        </p>
      </Panel>

      <Panel title="what we care about">
        <List items={role.wanted} />
        <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-[1.55] text-ink-50">
          {role.upside}
        </p>
      </Panel>
    </div>
  );
}

/** The headline block. `action` is the button, absent once you are signed in. */
export function HiringPitch({ action }: { action?: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[clamp(1.7rem,4.2vw,2.4rem)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          {role.title}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[15.5px] leading-[1.6] text-ink-70">
          {role.hook}
        </p>
        {action && <div className="mt-6">{action}</div>}
      </div>

      <RolePanels />
    </div>
  );
}

/** The four steps, numbered. Same list on the landing and above the form. */
export function HiringSteps() {
  return (
    <Panel title="how to apply">
      <ol className="space-y-3">
        {role.steps.map((step, i) => (
          <li key={step} className="flex gap-3 text-[14.5px] leading-[1.5] text-ink-70">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ember text-[12.5px] font-bold text-flame">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-[1.55] text-ink-50">
        {role.closing}
      </p>
    </Panel>
  );
}

/** The button a signed-out visitor clicks. Signup carries them back here. */
export function ApplyCta({ center = false }: { center?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 ${center ? "justify-center text-center" : ""}`}
    >
      <Link
        href="/sign-up?next=/editors"
        className="rounded-pill bg-flame px-7 py-3 text-[15px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
      >
        create your free editor profile
      </Link>
      <span className="text-[13px] text-ink-50">
        free, takes a couple of minutes.{" "}
        <Link href="/login?next=/editors" className="font-semibold text-flame">
          already have an account
        </Link>
      </span>
    </div>
  );
}
