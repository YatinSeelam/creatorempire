import Link from "next/link";
import { EditingRequests } from "@/components/dash/editing-requests";
import { loadEditJobs } from "@/lib/editing-server";

export const dynamic = "force-dynamic";

/**
 * Every batch a creator has going, and the link for each one.
 *
 * The list is a client component because the tabs filter what is already on the
 * page. Everything a creator has posted is one read and rarely more than a
 * screenful, so filtering it in the browser is instant and the server does not
 * get asked again to hide four rows.
 */
export default async function EditingPage() {
  const rows = await loadEditJobs();
  const live = rows.filter((r) => r.link?.live).length;

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-bold tracking-[-0.01em]">editing</h1>
          <span className="text-[12px] text-ink-50">
            {rows.length} batch{rows.length === 1 ? "" : "es"} · {live} link
            {live === 1 ? "" : "s"} live
          </span>
        </div>
        <Link
          href="/editing/new"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-ink px-3 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink/85"
        >
          <span aria-hidden="true">+</span> batch
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-line bg-paper px-4 py-12 text-center">
          <p className="text-[13.5px] font-bold">no batches yet</p>
          <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] leading-[1.55] text-ink-50">
            drop the footage, write one brief, and send your editor the link.
            everything they need is on one page, no login.
          </p>
          <Link
            href="/editing/new"
            className="mt-4 inline-flex h-8 items-center rounded-md bg-ink px-4 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink/85"
          >
            new batch
          </Link>
        </div>
      ) : (
        <EditingRequests rows={rows} />
      )}
    </div>
  );
}
