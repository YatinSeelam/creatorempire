import Link from "next/link";
import { EditingRequests } from "@/components/dash/editing-requests";
import { DashBar, Page, barTitle } from "@/components/dash/ui";
import { creditsLabel } from "@/lib/credits";
import { loadCreditBalance } from "@/lib/credits-server";
import { loadEditJobs } from "@/lib/editing-server";

export const dynamic = "force-dynamic";

/**
 * The creator's side of editing: every batch they have posted, and where each
 * one has got to.
 *
 * The list itself is a client component because the status tabs filter what is
 * already on the page. Everything a creator has posted is one read and rarely
 * more than a screenful, so filtering it in the browser is instant and the
 * server does not get asked again to hide four rows.
 */
export default async function EditingPage() {
  const [rows, balance] = await Promise.all([loadEditJobs(), loadCreditBalance()]);

  return (
    <>
      <DashBar
        lead={<h1 className={barTitle}>Editing</h1>}
        right={
          <div className="flex shrink-0 items-center gap-2.5">
            <Link
              href="/editing/credits"
              className="flex h-9 items-center rounded-pill border border-line px-5 text-[14px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              {creditsLabel(balance)}
            </Link>
            <Link
              href="/editing/new"
              className="flex h-9 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
            >
              Post a job
            </Link>
          </div>
        }
      />

      <Page fill className="space-y-6">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-paper px-5 py-16 text-center shadow-card lg:min-h-0 lg:flex-1">
            <p className="text-[17px] font-extrabold tracking-[-0.02em]">
              no edit jobs yet
            </p>
            <p className="mx-auto mt-2 max-w-[48ch] text-[14px] leading-[1.6] text-ink-50">
              record the footage, post the whole batch here with one brief, and
              an editor picks it up. they cut, you review, you download the
              finished videos.
            </p>
            <Link
              href="/editing/new"
              className="mt-6 inline-flex h-11 items-center rounded-pill bg-flame px-6 text-[14.5px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
            >
              post your first job
            </Link>
          </div>
        ) : (
          <EditingRequests rows={rows} />
        )}
      </Page>
    </>
  );
}
