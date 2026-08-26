import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  DeliveredCutUploader,
  EditJobForm,
  JobAssetUploader,
} from "@/components/dash/editing-forms";
import { BrandMark } from "@/components/dash/brand-mark";
import { HandoffLinkBox } from "@/components/dash/handoff-link";
import { CutPlayer, type PlayerCut } from "@/components/dash/cut-player";
import { JobStepper, type Step } from "@/components/dash/job-stepper";
import { approveEditJob, cancelEditJob, deleteEditJob, deleteJobFile } from "../actions";
import { brandLogo } from "@/lib/brand-catalog";
import { TIER_LABEL } from "@/lib/credits";
import { humanSize, isImageFile } from "@/lib/editing-files";
import { JOB_STATUS_LABEL, type JobStatus, type LinkItem } from "@/lib/editing";
import { linkIsLive } from "@/lib/editing-handoff";
import { loadDealOptions, loadEditJob } from "@/lib/editing-server";
import { ago, shortDate } from "@/lib/money";

/**
 * One batch, from the creator's side.
 *
 * The page is three things in order of how often they are wanted: the LINK,
 * which is the whole product and is one row; the CUT, watched or filed; and
 * everything you set once and read rarely, folded down the side.
 *
 * It used to be six equal cards down a column with a paragraph of explanation
 * in each — a panel that said the same sentence as the panel above it, a
 * sixty-pixel progress rail restating four dates, and a rating for an editor
 * who does not have an account here. All of that is gone. What is left is
 * hairline borders, right angles, one black button per decision, and no
 * sentence that the control beside it already says.
 *
 * Local chrome rather than Panel/DashBar on purpose: those are rounded cards
 * with shadows and a 24px title, which is the older half of the app.
 */

const statusChip: Record<JobStatus, string> = {
  open: "border-line text-ink-50",
  claimed: "border-line text-ink",
  delivered: "border-ink text-ink",
  revisions: "border-line text-ink",
  approved: "border-ink bg-ink text-paper",
  cancelled: "border-line text-ink-50 line-through",
};

const CAPS = "text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-50";
const chip = "rounded-md border px-2 py-0.5 text-[11.5px] font-semibold";
const dark =
  "inline-flex h-8 shrink-0 items-center rounded-md bg-ink px-4 text-[12.5px] font-bold text-paper transition-colors hover:bg-ink/85";
const quiet =
  "inline-flex h-8 shrink-0 items-center rounded-md border border-line px-3 text-[12px] font-semibold text-ink-50 transition-colors hover:text-ink";

/** A square section with a hairline head. */
function Card({
  title,
  meta,
  children,
  pad = true,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="rounded-lg border border-line bg-paper">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-bold tracking-[-0.01em]">{title}</h2>
        {meta && <span className="shrink-0 text-[11.5px] text-ink-50">{meta}</span>}
      </header>
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

/** The same frame, closed. Everything read once rather than acted on. */
function Fold({
  title,
  meta,
  open = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group rounded-lg border border-line bg-paper">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-[13px] font-bold tracking-[-0.01em]">{title}</h2>
        <span className="flex min-w-0 items-center gap-2.5">
          {meta && <span className="truncate text-[11.5px] text-ink-50">{meta}</span>}
          <svg
            viewBox="0 0 24 24"
            className="size-3.5 shrink-0 text-ink-50 transition-transform group-open:rotate-180"
            aria-hidden="true"
          >
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

/** One block of links out of the brief: footage or references. */
function LinkList({ label, items }: { label: string; items: LinkItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={CAPS}>{label}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((link, i) => (
          <li key={i} className="min-w-0">
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-[12.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              {link.label || link.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadEditJob(id);
  if (!detail) notFound();

  const { job, deliverables, files, dealAssets, dealLabel, handoffLink } = detail;
  const open = job.status === "open";
  const cancelled = job.status === "cancelled";
  const reviewable = job.status === "delivered" || job.status === "revisions";
  // the settings form only exists while open, so the picker is only loaded then.
  const deals = open ? await loadDealOptions() : [];

  const handedOff = Boolean(handoffLink && linkIsLive(handoffLink));
  const delivered = deliverables.length > 0;
  const approved = Boolean(job.approved_at);
  const done = [true, handedOff, delivered, approved];
  const active = done.indexOf(false);

  const steps: Step[] = [
    { label: "brief posted", note: shortDate(job.created_at) },
    {
      label: handedOff ? "link is live" : "send the link",
      note: handedOff
        ? handoffLink?.views
          ? `opened ${handoffLink.views}×`
          : "not opened yet"
        : "it is switched off",
    },
    {
      label: delivered ? "cut filed" : "waiting on the cut",
      note: delivered
        ? `${deliverables.length} version${deliverables.length === 1 ? "" : "s"}`
        : "upload it when it lands",
    },
    {
      label: approved ? "approved" : "your call",
      note: approved ? shortDate(job.approved_at as string) : "mark it done",
    },
  ].map((s, i) => ({
    ...s,
    // a cancelled job is not mid-flight, so nothing on it is "now".
    state: done[i] ? "done" : !cancelled && i === active ? "now" : "todo",
  }));

  // a cut is written as two rows in one action off one storage path: the
  // deliverable (the url, the version) and the file (the name a person typed,
  // the size). joining them on that path is what puts a readable filename under
  // the player instead of the uuid the object is actually stored as.
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const playerCuts: PlayerCut[] = deliverables.map((cut) => {
    const row = cut.storagePath ? fileByPath.get(cut.storagePath) : undefined;
    return {
      ...cut,
      fileName: row?.name || cut.note || "the cut",
      sizeBytes: row?.size_bytes ?? null,
    };
  });

  const sent = files.filter((f) => f.kind !== "cut");

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4">
      {/* ------------------------------------------------------- the toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/editing"
            aria-label="back to editing"
            className="shrink-0 text-ink-50 transition-colors hover:text-ink"
          >
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path
                d="M19 12H5m0 0 6-6m-6 6 6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <BrandMark
            name={job.brand_name ?? job.title}
            logo={brandLogo({ logo_key: job.brand_logo_key, logo_url: job.brand_logo_url })}
            size="xs"
          />
          <h1 className="truncate text-[15px] font-bold tracking-[-0.01em]">
            {job.title}
          </h1>
          <span className="truncate text-[12px] text-ink-50">
            {job.video_count} video{job.video_count === 1 ? "" : "s"} ·{" "}
            {TIER_LABEL[job.tier]}
            {job.is_rush ? " · rush" : ""}
            {dealLabel ? ` · ${dealLabel}` : ""}
          </span>
        </div>

        <span className={`${chip} ${statusChip[job.status]}`}>
          {JOB_STATUS_LABEL[job.status]}
        </span>
      </div>

      <JobStepper steps={steps} />

      {/* ---------------------------------------------------------- the link */}
      <Card title="the link" meta="no login, downloads included">
        <HandoffLinkBox jobId={job.id} link={handoffLink} />
      </Card>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.6fr_1fr] lg:items-start">
        {/* ==================================================== the work */}
        <div className="min-w-0 space-y-4">
          {playerCuts.length > 0 && <CutPlayer cuts={playerCuts} />}

          {/* the manual delivery. the editor has no login, so the cut comes
              back over whatever chat they already use and this files it. every
              drop is a new version. */}
          {!cancelled && !approved && (
            <Card
              title={playerCuts.length > 0 ? "another version" : "the cut"}
              meta={playerCuts.length > 0 ? `v${playerCuts.length + 1} next` : undefined}
            >
              <DeliveredCutUploader jobId={job.id} />
            </Card>
          )}

          {reviewable && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-3">
              <p className="min-w-0 flex-1 text-[12.5px] text-ink-50">
                happy with it? approving closes the batch out.
              </p>
              <form action={approveEditJob}>
                <input type="hidden" name="job_id" value={job.id} />
                <button type="submit" className={dark}>
                  approve
                </button>
              </form>
            </div>
          )}

          {cancelled && (
            <p className="rounded-lg border border-line bg-shell px-4 py-3 text-[12.5px] text-ink-50">
              cancelled. the link is off and nothing came back.
            </p>
          )}
        </div>

        {/* ================================================= set once, read rarely */}
        <div className="min-w-0 space-y-3">
          <Fold title="the brief" open={!handedOff}>
            <div className="space-y-3">
              {job.brief ? (
                <p className="whitespace-pre-wrap text-[12.5px] leading-[1.6] text-ink-70">
                  {job.brief}
                </p>
              ) : (
                <p className="text-[12.5px] text-ink-50">
                  nothing written. the title is the whole ask.
                </p>
              )}
              <LinkList label="video links" items={job.footage_links} />
              <LinkList label="references" items={job.reference_links} />
            </div>
          </Fold>

          <Fold
            title="files"
            meta={sent.length > 0 ? `${sent.length} sent` : "nothing yet"}
            open={sent.length === 0 && !handedOff}
          >
            <div className="space-y-3">
              <JobAssetUploader jobId={job.id} dealId={job.deal_id} />

              {sent.length > 0 && (
                <ul className="space-y-2">
                  {sent.map((file) => (
                    <li key={file.id} className="flex min-w-0 items-center gap-2.5">
                      {isImageFile(file) && file.signedUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={file.signedUrl}
                          alt=""
                          className="size-8 shrink-0 rounded-md border border-line object-cover"
                        />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-shell text-[9px] font-bold uppercase tracking-[0.06em] text-ink-50">
                          {file.kind === "footage" ? "vid" : file.kind.slice(0, 3)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold">
                          {file.name}
                        </span>
                        <span className="block text-[11px] text-ink-50">
                          {[humanSize(file.size_bytes), ago(file.created_at)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      {file.signedUrl && (
                        <a
                          href={file.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-[11.5px] font-semibold text-ink-50 transition-colors hover:text-ink"
                        >
                          open
                        </a>
                      )}
                      <form action={deleteJobFile}>
                        <input type="hidden" name="file_id" value={file.id} />
                        <input type="hidden" name="job_id" value={job.id} />
                        <button
                          type="submit"
                          className="shrink-0 text-[11.5px] font-semibold text-ink-50 transition-colors hover:text-ink"
                        >
                          delete
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              {/* the brand deal's shelf, read live off the deal rather than
                  copied onto this job, so fixing a wrong logo fixes every
                  future batch. it shows on the link like everything else. */}
              {dealAssets.length > 0 && (
                <div className="border-t border-line pt-3">
                  <p className={CAPS}>on every batch for this brand</p>
                  <ul className="mt-1.5 space-y-1">
                    {dealAssets.map((asset) => (
                      <li
                        key={asset.id}
                        className="flex min-w-0 items-baseline gap-2 text-[12.5px]"
                      >
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {asset.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-50">
                          {humanSize(asset.size_bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Fold>

          {open && (
            <>
              <Fold title="the job" meta="edits show on the link">
                <EditJobForm job={job} deals={deals} />
              </Fold>

              <Fold title="close it">
                <div className="space-y-3">
                  <form action={cancelEditJob} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="job_id" value={job.id} />
                    <p className="min-w-0 flex-1 text-[12px] text-ink-50">
                      cancel turns the link off, keeps the job.
                    </p>
                    <button type="submit" className={quiet}>
                      cancel
                    </button>
                  </form>
                  <form action={deleteEditJob} className="flex flex-wrap items-center gap-3">
                    <input type="hidden" name="job_id" value={job.id} />
                    <p className="min-w-0 flex-1 text-[12px] text-ink-50">
                      delete removes the job, its files and its link.
                    </p>
                    <button type="submit" className={quiet}>
                      delete
                    </button>
                  </form>
                </div>
              </Fold>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
