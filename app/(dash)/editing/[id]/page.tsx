import { notFound } from "next/navigation";
import { Crumbs, DashBar, FoldPanel, Page, Panel, Pill } from "@/components/dash/ui";
import { Submit } from "@/components/dash/form";
import {
  DeliveredCutUploader,
  EditJobForm,
  JobAssetUploader,
} from "@/components/dash/editing-forms";
import { BrandMark } from "@/components/dash/brand-mark";
import { HandoffLinkBox } from "@/components/dash/handoff-link";
import { CutPlayer, type PlayerCut } from "@/components/dash/cut-player";
import { JobStepper, type Step } from "@/components/dash/job-stepper";
import { JobTrail } from "@/components/editors/job-chat";
import { RatingInput } from "@/components/editors/rating-input";
import { approveEditJob, cancelEditJob, deleteEditJob, deleteJobFile } from "../actions";
import { brandLogo } from "@/lib/brand-catalog";
import { TIER_LABEL } from "@/lib/credits";
import { fileFamily, humanSize, isImageFile } from "@/lib/editing-files";
import {
  bundleLabel,
  JOB_STATUS_LABEL,
  type JobStatus,
  type LinkItem,
} from "@/lib/editing";
import { linkIsLive } from "@/lib/editing-handoff";
import { loadDealOptions, loadEditJob } from "@/lib/editing-server";
import { ago, shortDate } from "@/lib/money";

/**
 * One batch, from the creator's side.
 *
 * Two columns. LEFT is the work: the cut playing, the box the finished cut gets
 * filed into, and the decision under it. RIGHT is the one person on the other
 * end of this job — the editor, who has no account here and reads the whole
 * batch off a handoff link.
 *
 * There is no editor profile panel, no thread and no client review tab any
 * more. This deploy hires nobody and nobody signs a cut off through us: the
 * creator already has an editor, the link is how the batch reaches them, and
 * whatever they say back they say in the chat they already share. What is left
 * is the link, and the cut that comes back.
 *
 * Everything read once rather than acted on — the brief, the file shelf, the
 * job's own settings, cancelling — folds.
 */

const statusTone: Record<JobStatus, "flame" | "ink" | "quiet" | "line"> = {
  open: "line",
  claimed: "quiet",
  delivered: "flame",
  revisions: "quiet",
  approved: "ink",
  cancelled: "quiet",
};

const LABEL = "text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50";

/** One block of links out of the brief: footage or references. */
function LinkList({ label, items }: { label: string; items: LinkItem[] }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[13.5px] text-ink-50">None yet.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.map((link, i) => (
            <li key={i} className="flex min-w-0 items-baseline gap-2">
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-flame-dark"
              >
                {link.label || link.url}
              </a>
            </li>
          ))}
        </ul>
      )}
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

  const { job, deliverables, files, dealAssets, events, dealLabel, handoffLink } =
    detail;
  const open = job.status === "open";
  const cancelled = job.status === "cancelled";
  const reviewable = job.status === "delivered" || job.status === "revisions";
  // the job's settings form only exists while open, so the picker is only
  // loaded then.
  const deals = open ? await loadDealOptions() : [];

  // ------------------------------------------------------------- the stepper
  //
  // four steps, and the middle two are the whole product: send the link, file
  // what comes back. nothing on this page waits on us.
  const handedOff = Boolean(handoffLink && linkIsLive(handoffLink));
  const delivered = deliverables.length > 0;
  const approved = Boolean(job.approved_at);
  const done = [true, handedOff, delivered, approved];
  const active = done.indexOf(false);

  const stepLabels = [
    "Brief posted",
    handedOff ? "Link is live" : "Send it to your editor",
    delivered ? "Cut filed" : "Waiting on the cut",
    approved ? "Approved" : "Your call",
  ];
  const stepNotes = [
    shortDate(job.created_at),
    handedOff
      ? handoffLink?.views
        ? `opened ${handoffLink.views} time${handoffLink.views === 1 ? "" : "s"}`
        : "not opened yet"
      : "the link is off",
    delivered
      ? `${deliverables.length} cut${deliverables.length === 1 ? "" : "s"} filed`
      : "upload it when it lands",
    approved ? shortDate(job.approved_at as string) : "mark it done",
  ];
  const steps: Step[] = stepLabels.map((label, i) => ({
    label,
    // a cancelled job is not mid-flight, so nothing on it is "now".
    state: done[i] ? "done" : !cancelled && i === active ? "now" : "todo",
    note: stepNotes[i],
  }));

  // -------------------------------------------------------------- the player
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

  return (
    <>
      <DashBar
        lead={
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark
              name={job.brand_name ?? job.title}
              logo={brandLogo({ logo_key: job.brand_logo_key, logo_url: job.brand_logo_url })}
              size="md"
            />
            <div className="min-w-0">
              {job.brand_name && (
                <p className="truncate text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                  {job.brand_name}
                </p>
              )}
              <Crumbs
                size="lg"
                trail={[{ label: "Editing", href: "/editing" }, { label: job.title }]}
              />
            </div>
          </div>
        }
        right={
          <div className="flex shrink-0 items-center gap-2">
            <Pill tone="flame">{bundleLabel(job)}</Pill>
            <Pill tone={statusTone[job.status]}>{JOB_STATUS_LABEL[job.status]}</Pill>
          </div>
        }
      />

      <Page className="space-y-6">
        {/* where it is, on one rail, instead of four dates that all read the same */}
        <JobStepper steps={steps} />

        <div className="grid min-w-0 gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          {/* ==================================================== the work */}
          <div className="min-w-0 space-y-5">
            {playerCuts.length > 0 ? (
              <CutPlayer cuts={playerCuts} />
            ) : (
              <Panel title="The cut">
                <p className="py-6 text-center text-[13.5px] text-ink-50">
                  {cancelled
                    ? "This job was cancelled. Nothing came back."
                    : handedOff
                      ? "Nothing filed yet. When your editor sends the cut back, drop it in below."
                      : "Nothing filed yet. Send the handoff link to your editor to start."}
                </p>
              </Panel>
            )}

            {/* the manual delivery. the editor on the other end of a handoff
                link has no login, so the cut comes back over whatever chat they
                already use and this is where it gets filed. every drop is a new
                version, so v2 goes through the same box. */}
            {!cancelled && !approved && (
              <Panel
                title={playerCuts.length > 0 ? "File another version" : "File the cut"}
                action={
                  <span className="text-[13px] text-ink-50">
                    {playerCuts.length > 0
                      ? `v${playerCuts.length + 1} next`
                      : "when it comes back"}
                  </span>
                }
              >
                <DeliveredCutUploader jobId={job.id} />
              </Panel>
            )}

            {reviewable && (
              <Panel
                title="Approve this cut"
                sub="Closes the batch out. Paying your editor is between you and them."
              >
                <form action={approveEditJob} className="space-y-4">
                  <input type="hidden" name="job_id" value={job.id} />

                  <div className="rounded-card border border-line bg-shell px-4 py-4">
                    <RatingInput />
                  </div>

                  <Submit pendingLabel="Approving">Approve</Submit>
                </form>
              </Panel>
            )}

            <FoldPanel
              title="The brief"
              // worth having open while nobody is cutting yet, because it is
              // still the thing you would be editing. closed once it is out of
              // your hands and the page is about what came back.
              open={!handedOff}
            >
              <div className="space-y-4">
                {/* a job is a batch, not one cut, and every other number on this
                    page reads wrong until that is the first thing seen. */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-[20px] font-extrabold tracking-[-0.02em]">
                    {bundleLabel(job)}
                  </p>
                  <span className="text-[13px] text-ink-50">
                    one link, one editor, the whole batch
                  </span>
                </div>

                {job.brief ? (
                  <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65] text-ink-70">
                    {job.brief}
                  </p>
                ) : (
                  <p className="text-[13.5px] text-ink-50">
                    No brief written. The title is the whole ask.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="flame">
                    {TIER_LABEL[job.tier]}
                    {job.is_rush ? " · rush" : ""}
                  </Pill>
                  {dealLabel && <Pill tone="quiet">{dealLabel}</Pill>}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <LinkList label="Video links" items={job.footage_links} />
                  <LinkList label="References" items={job.reference_links} />
                </div>
              </div>
            </FoldPanel>

            <FoldPanel
              title="Files"
              open={files.length === 0 && !handedOff}
              action={
                <span className="text-[13px] text-ink-50">
                  {files.length > 0
                    ? `${files.length} file${files.length === 1 ? "" : "s"}`
                    : "everything here shows up on the link"}
                </span>
              }
            >
              <div className="space-y-4">
                <JobAssetUploader jobId={job.id} dealId={job.deal_id} />

                {/* the brand deal's shelf, read live off the deal rather than
                    copied onto this job. it is here rather than in its own panel
                    because the editor looking for the logo looks under Files. */}
                {dealAssets.length > 0 && (
                  <div className="rounded-xl border border-line bg-shell px-4 py-3.5">
                    <p className="text-[13px] font-bold tracking-[-0.01em]">
                      From the brand deal
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-50">
                      Uploaded once, on every batch for this brand.
                    </p>
                    <ul className="mt-2.5 space-y-2">
                      {dealAssets.map((asset) => (
                        <li
                          key={asset.id}
                          className="flex min-w-0 items-baseline gap-2 text-[13.5px]"
                        >
                          <span className="shrink-0 text-[12.5px] text-ink-50">
                            {fileFamily(asset)}
                          </span>
                          <span className="truncate font-semibold">{asset.name}</span>
                          <span className="shrink-0 text-[12.5px] text-ink-50">
                            {humanSize(asset.size_bytes)}
                          </span>
                          {asset.signedUrl && (
                            <a
                              href={asset.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-auto shrink-0 text-[13px] font-semibold text-ink-70 transition-colors hover:text-flame-dark"
                            >
                              open
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {files.length === 0 ? (
                  <p className="text-[13.5px] text-ink-50">
                    Nothing uploaded yet. Links in the brief work too, this is for the
                    actual files.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {files.map((file) => (
                      <li key={file.id} className="flex min-w-0 items-center gap-3">
                        {isImageFile(file) && file.signedUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={file.signedUrl}
                            alt=""
                            className="size-11 shrink-0 rounded-lg border border-line object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[14px] font-semibold">
                              {file.name}
                            </span>
                            {/* "footage" is the word the column uses, "video" is
                                the word a person uses */}
                            <Pill tone={file.kind === "cut" ? "flame" : "quiet"}>
                              {file.kind === "footage" ? "video" : file.kind}
                            </Pill>
                          </div>
                          <p className="mt-0.5 text-[12.5px] text-ink-50">
                            {[humanSize(file.size_bytes), ago(file.created_at)]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        {file.signedUrl && (
                          <a
                            href={file.signedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-[13px] font-semibold text-ink-70 transition-colors hover:text-flame-dark"
                          >
                            {isImageFile(file) ? "open" : "watch"}
                          </a>
                        )}
                        <form action={deleteJobFile}>
                          <input type="hidden" name="file_id" value={file.id} />
                          <input type="hidden" name="job_id" value={job.id} />
                          <button
                            type="submit"
                            className="shrink-0 text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame"
                          >
                            Delete
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </FoldPanel>

            {/* -------------------------------------------- open-only edits */}
            {open && (
              <>
                <FoldPanel
                  title="The job"
                  action={
                    <span className="text-[13px] text-ink-50">
                      changes show on the link straight away
                    </span>
                  }
                >
                  <EditJobForm job={job} deals={deals} />
                </FoldPanel>

                <FoldPanel title="Close it">
                  <div className="space-y-4">
                    <form action={cancelEditJob} className="flex flex-wrap items-center gap-4">
                      <input type="hidden" name="job_id" value={job.id} />
                      <p className="min-w-0 flex-1 text-[13.5px] text-ink-50">
                        Cancel turns the handoff link off and keeps the job on your
                        list.
                      </p>
                      <Submit tone="line" size="sm" pendingLabel="Cancelling">
                        Cancel job
                      </Submit>
                    </form>
                    <form action={deleteEditJob} className="flex flex-wrap items-center gap-4">
                      <input type="hidden" name="job_id" value={job.id} />
                      <p className="min-w-0 flex-1 text-[13.5px] text-ink-50">
                        Delete removes the job, its files and its link for good. Only an
                        open job can go.
                      </p>
                      <Submit tone="line" size="sm" pendingLabel="Deleting">
                        Delete this job
                      </Submit>
                    </form>
                  </div>
                </FoldPanel>
              </>
            )}
          </div>

          {/* ================================================== the editor */}
          <div className="min-w-0 space-y-5">
            <Panel
              title="Your editor"
              action={
                <span className="text-[13px] text-ink-50">
                  {handedOff ? "link is live" : "link is off"}
                </span>
              }
            >
              <div className="space-y-5">
                <div>
                  <p className="mb-3 text-[13px] leading-[1.6] text-ink-50">
                    Send them this. It opens the whole batch on one page: the
                    brief, the videos, the assets, the brand&apos;s kit, all
                    downloadable. No account, no login.
                  </p>
                  <HandoffLinkBox jobId={job.id} link={handoffLink} />
                </div>

                <div className="space-y-2 border-t border-line pt-4">
                  <p className={LABEL}>How it comes back</p>
                  <p className="text-[13px] leading-[1.6] text-ink-50">
                    Delivery is manual. Your editor sends the finished cut back
                    the way they always do and you file it on the left. Anything
                    you upload here shows up on their link straight away, so a
                    missing asset does not need a new link.
                  </p>
                </div>
              </div>
            </Panel>

            <JobTrail events={events} viewerId={job.user_id} />
          </div>
        </div>
      </Page>
    </>
  );
}
