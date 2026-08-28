import { DashBar, Page, Panel, Pill, barTitle } from "@/components/dash/ui";

/**
 * What /editing renders while EDITING_ENABLED is off.
 *
 * A 404 was the old answer and it was the wrong one for a row that is still on
 * the rail: a student who clicks Editing and gets "this page does not exist"
 * reads it as the app being broken, and the next thing they do is ask whether
 * their deals are gone too. This says the feature is not open yet, in the
 * product's own chrome, which is a different sentence and the true one.
 *
 * Deliberately not a route file. Living beside the layout that renders it keeps
 * it out of the router, so there is no second url that outlives the flag and
 * has to be remembered when the feature opens: flipping EDITING_ENABLED deletes
 * every path to this page.
 *
 * It promises no date. A screen that says "next month" ages into a lie on its
 * own, and nothing here is load bearing enough to be worth that.
 */
export function EditingSoon() {
  return (
    <>
      <DashBar
        lead={
          <span className="flex items-center gap-2.5">
            <h1 className={barTitle}>Editing</h1>
            <Pill tone="quiet">soon</Pill>
          </span>
        }
      />

      <Page className="max-w-[720px]">
        <Panel>
          <div className="px-1 py-6 text-center sm:py-9">
            <span
              aria-hidden="true"
              className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-line bg-shell text-ink-50"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="6.2" cy="6.6" r="2.4" />
                <circle cx="6.2" cy="17.4" r="2.4" />
                <path d="M8.3 7.9 20 16.2M8.3 16.1 20 7.8M13.4 12l-1.7 1.2" />
              </svg>
            </span>

            <p className="text-[19px] font-extrabold tracking-[-0.02em]">
              editing is not open yet
            </p>
            <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[1.6] text-ink-50">
              we are building the half where you hand a batch of raw clips to an
              editor, watch the cuts come back and sign them off without any of
              it living in a group chat. it is not ready for real work, so it is
              not switched on.
            </p>

            <ul className="mx-auto mt-6 grid max-w-[30rem] gap-2.5 text-left">
              <Line>post a batch of raw clips against a brief</Line>
              <Line>one link your editor opens, no login on their side</Line>
              <Line>cuts come back on a clock you can see</Line>
              <Line>approve or send back, and the deal picks the video up</Line>
            </ul>

            <p className="mt-7 text-[13px] text-ink-50">
              everything else on the rail works as normal. this row will light up
              on its own when it opens.
            </p>
          </div>
        </Panel>
      </Page>
    </>
  );
}

/** One thing that will be here, ticked. */
function Line({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[13.5px] leading-[1.5] text-ink-70">
      <svg
        viewBox="0 0 24 24"
        className="mt-[3px] size-4 shrink-0 text-flame"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
      {children}
    </li>
  );
}
