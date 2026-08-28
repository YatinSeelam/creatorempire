import { DashBar, Page, Panel, Pill, barTitle } from "@/components/dash/ui";

/**
 * What /editing renders. On this deploy that is all it ever renders.
 *
 * A 404 was the old answer and it was the wrong one for a row that is still on
 * the rail: a student who clicks Editing and gets "this page does not exist"
 * reads it as the app being broken, and the next thing they do is ask whether
 * their deals are gone too. This says the section is not open, in the product's
 * own chrome, which is a different sentence and the true one.
 *
 * Deliberately short. An earlier version listed four things the marketplace
 * would do, which is a roadmap, and a roadmap on a section nobody has
 * committed to shipping here is a promise that ages badly. It names no date
 * for the same reason.
 *
 * Deliberately not a route file either. Living beside the layout that renders
 * it keeps it out of the router, so there is no second url that outlives the
 * flag: flipping EDITING_ENABLED deletes every path to this page.
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

      <Page className="max-w-[560px]">
        <Panel>
          <div className="px-1 py-10 text-center">
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
              coming soon
            </p>
            <p className="mx-auto mt-2 max-w-[38ch] text-[14px] leading-[1.6] text-ink-50">
              editing is not part of this dashboard yet. everything else on the
              rail works as normal, and this row will light up on its own if it
              opens.
            </p>
          </div>
        </Panel>
      </Page>
    </>
  );
}
