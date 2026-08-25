import Link from "next/link";
import { notFound } from "next/navigation";
import { Crumbs, DashBar, FoldPanel, Page, Panel, Pill } from "@/components/dash/ui";
import { Submit } from "@/components/dash/form";
import {
  CommentForm,
  EditJobForm,
  JobAssetUploader,
  RevisionForm,
} from "@/components/dash/editing-forms";
import { BrandMark } from "@/components/dash/brand-mark";
import { ClientNoteRow, ReviewLinkBox } from "@/components/dash/client-review";
import { CutPlayer, type PlayerCut } from "@/components/dash/cut-player";
import { JobConversation } from "@/components/dash/job-conversation";
import { JobStepper, type Step } from "@/components/dash/job-stepper";
import { JobThread, JobTrail } from "@/components/editors/job-chat";
import { RatingInput } from "@/components/editors/rating-input";
import { approveEditJob, cancelEditJob, deleteEditJob, deleteJobFile } from "../actions";
import { brandLogo } from "@/lib/brand-catalog";
import { creditsLabel, turnaroundShort, TIER_LABEL } from "@/lib/credits";
import { fileFamily, humanSize, isImageFile } from "@/lib/editing-files";
import {
  bundleLabel,
  JOB_STATUS_LABEL,
  jobTotalCents,
  payLabel,
  type JobStatus,
  type LinkItem,
} from "@/lib/editing";
import { reviewerName, VERDICT_LABEL, VERDICT_TONE } from "@/lib/editing-review";
import { loadDealOptions, loadEditJob } from "@/lib/editing-server";
import { ago, money, shortDate } from "@/lib/money";

/**
 * One batch, from the creator's side.
 *
 * This page used to be nine panels stacked down one column: four date cards, the
 * brief, files, the editor, a list of deliverables, the client review, the
 * approve form, the payout, the chat and the trail. Everything was the same
 * width and the same weight, so the two things somebody actually opens it to do
 * — watch the cut, and answer whoever is waiting — were the fifth and eighth
 * things down.
 *
 * It is two columns now. LEFT is the work: the cut, playing, and the decision
 * under it. RIGHT is the talking, and the talking has exactly two sides that are
 * not the same person — the EDITOR who cuts it, and the CAMPAIGN MANAGER who
 * signs it off through a link with no login. Those are one panel with two tabs,
 * each holding everything you can do with that person: the editor's tab carries
 * the thread AND the revision request, the manager's carries their link AND
 * their notes AND the button that forwards one to the editor.
 *
 * Everything read once rather than acted on — the brief, the file shelf, the
 * offer, cancelling — folds.
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

  const {
    job,
    deliverables,
    files,
    dealAssets,
    events,
    editor,
    payout,
    dealLabel,
    reviewLink,
    clientNotes,
  } = detail;
  const open = job.status === "open";
  const cancelled = job.status === "cancelled";
  const reviewable = job.status === "delivered" || job.status === "revisions";

  // the manager's inbox: unhandled first, everything else as history. the newest
  // approval is what the approve strip leans on.
  const openNotes = clientNotes.filter((n) => !n.handled_at);
  const handledNotes = clientNotes.filter((n) => n.handled_at);
  const clientSignOff = clientNotes.find((n) => n.verdict === "approved");
  // the offer form only exists while open, so the picker is only loaded then.
  const deals = open ? await loadDealOptions() : [];

  const editorName = editor?.name || editor?.handle || "the editor";
  // loadEditJob only ever returns a row whose user_id is the signed-in user, so
  // the job's owner IS the viewer here. The thread needs an id to pick its side.
  const viewerId = job.user_id;
  const messageCount = events.filter((e) => e.kind === "comment").length;

  // ------------------------------------------------------------- the stepper
  const claimed = Boolean(job.claimed_at);
  // a job sitting in `revisions` HAS a cut, but the cut is not the state of
  // play — it went back. so that step un-completes rather than the next one
  // lighting up and asking for a call nobody can make yet.
  const delivered = deliverables.length > 0 && job.status !== "revisions";
  const approved = Boolean(job.approved_at);
  const done = [true, claimed, delivered, approved];
  const active = done.indexOf(false);

  const stepLabels = [
    "Brief posted",
    claimed ? "Editor on it" : "Waiting for an editor",
    job.status === "revisions" ? "Changes with editor" : "Cut delivered",
    approved ? "Approved" : "Your call",
  ];
  const stepNotes = [
    shortDate(job.created_at),
    claimed ? editorName : "open on the board",
    delivered
      ? `${deliverables.length} cut${deliverables.length === 1 ? "" : "s"}`
      : job.sla_at
        ? `due ${shortDate(job.sla_at)}`
        : `${turnaroundShort(job.is_rush)} once claimed`,
    approved
      ? shortDate(job.approved_at as string)
      : payout
        ? `${money(payout.amount_cents)} ${payout.status}`
        : "pay locks here",
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
        {/* where it is, on one rail, instead of four dates that all read Aug 22 */}
        <JobStepper steps={steps} />

        <div className="grid min-w-0 gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start">
          {/* ==================================================== the work */}
          <div className="min-w-0 space-y-5">
            {playerCuts.length > 0 ? (
              <CutPlayer cuts={playerCuts} />
            ) : (
              <Panel title="The cut">
                <p className="py-6 text-center text-[13.5px] text-ink-50">
                  {open
                    ? "Nothing back yet. This is on the board, first editor to claim it starts cutting."
                    : cancelled
                      ? "This job was cancelled. Nothing came back."
                      : `Nothing back yet. ${editorName} has it, cuts land here versioned.`}
                </p>
              </Panel>
            )}

            {/* the money action, on its own, directly under the thing it is a
                verdict on. asking for changes is NOT here — that is a message
                to the editor and it lives in the editor's tab with the rest of
                what you say to them. */}
            {reviewable && (
              <Panel
                title="Approve this cut"
                sub={`Releases ${money(jobTotalCents(job))} to ${editorName}, out of credits you already spent.`}
              >
                <form action={approveEditJob} className="space-y-4">
                  <input type="hidden" name="job_id" value={job.id} />

                  {clientSignOff && (
                    <p className="rounded-card border border-line bg-ember px-4 py-3 text-[13.5px] leading-[1.6] text-flame-dark">
                      {reviewerName(clientSignOff)} approved this{" "}
                      {ago(clientSignOff.created_at)}. Your tap is the one that pays.
                    </p>
                  )}

                  <div className="rounded-card border border-line bg-shell px-4 py-4">
                    <RatingInput />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Submit pendingLabel="Approving">Approve</Submit>
                    <p className="min-w-0 flex-1 text-[12.5px] text-ink-50">
                      A delivered cut left sitting approves itself after 48 hours.
                    </p>
                  </div>
                </form>
              </Panel>
            )}

            <FoldPanel
              title="The brief"
              // worth having open while nobody is cutting yet, because it is
              // still the thing you would be editing. closed once it is out of
              // your hands and the page is about what came back.
              open={!claimed}
              action={<span className="text-[13px] text-ink-50">{payLabel(job)}</span>}
            >
              <div className="space-y-4">
                {/* a job is a batch, not one cut, and every other number on this
                    page reads wrong until that is the first thing seen. */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="text-[20px] font-extrabold tracking-[-0.02em]">
                    {bundleLabel(job)}
                  </p>
                  <span className="text-[13px] text-ink-50">
                    one claim, one editor, the whole batch
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
                  {job.credits > 0 && (
                    <Pill tone="flame">
                      {creditsLabel(job.credits)} · {TIER_LABEL[job.tier]}
                      {job.is_rush ? " · rush" : ""}
                    </Pill>
                  )}
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
              open={files.length === 0 && !claimed}
              action={
                <span className="text-[13px] text-ink-50">
                  {files.length > 0
                    ? `${files.length} file${files.length === 1 ? "" : "s"}`
                    : "private to you and the editor"}
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
                  title="The offer"
                  action={
                    <span className="text-[13px] text-ink-50">
                      editable until somebody claims it
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
                        Cancel takes it off the board, keeps the job on your list, and
                        refunds the credits it spent.
                      </p>
                      <Submit tone="line" size="sm" pendingLabel="Cancelling">
                        Cancel job
                      </Submit>
                    </form>
                    <form action={deleteEditJob} className="flex flex-wrap items-center gap-4">
                      <input type="hidden" name="job_id" value={job.id} />
                      <p className="min-w-0 flex-1 text-[13.5px] text-ink-50">
                        Delete refunds the credits and removes it and its thread for
                        good. Only an open job can go.
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

          {/* ================================================ the talking */}
          <div className="min-w-0 space-y-5">
            <JobConversation
              editorLabel={editor ? editorName : "Editor"}
              editorCount={messageCount}
              managerCount={openNotes.length}
              // open on whichever side is actually waiting for something.
              initial={openNotes.length > 0 ? "manager" : "editor"}
              editor={
                <div className="space-y-5">
                  {editor ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {editor.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={editor.avatar_url}
                          alt=""
                          className="size-10 shrink-0 rounded-full border border-line object-cover"
                        />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-shell text-[15px] font-bold text-ink-50">
                          {editorName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-[14.5px] font-bold tracking-[-0.015em]">
                            {editorName}
                          </p>
                          {editor.verified && <Pill tone="flame">verified</Pill>}
                        </div>
                        {editor.headline && (
                          <p className="mt-0.5 truncate text-[12.5px] text-ink-50">
                            {editor.headline}
                          </p>
                        )}
                      </div>
                      {editor.published && editor.handle && (
                        <Link
                          href={`/e/${editor.handle}`}
                          className="shrink-0 rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink"
                        >
                          Profile
                        </Link>
                      )}
                    </div>
                  ) : (
                    <p className="text-[13.5px] leading-[1.6] text-ink-50">
                      {open
                        ? "Nobody has claimed this yet. Open jobs sit on every editor's board, first claim wins."
                        : "No editor attached."}
                    </p>
                  )}

                  <div className="border-t border-line pt-4">
                    <JobThread
                      events={events}
                      viewerId={viewerId}
                      otherLabel={editorName}
                    />
                  </div>

                  <div className="border-t border-line pt-4">
                    <CommentForm jobId={job.id} />
                  </div>

                  {/* the revision request, in the editor's tab, because it is a
                      message to the editor. it used to be a separate panel four
                      cards away from the thread it is part of. */}
                  {job.status === "delivered" && (
                    <div className="space-y-3 border-t border-line pt-4">
                      <p className={LABEL}>Ask for changes instead</p>
                      <RevisionForm job={job} />
                    </div>
                  )}
                </div>
              }
              manager={
                <div className="space-y-5">
                  {cancelled ? (
                    <p className="text-[13.5px] text-ink-50">
                      This job was cancelled, so there is nothing to review.
                    </p>
                  ) : (
                    <>
                      <div>
                        <p className={LABEL}>Their link</p>
                        <p className="mb-3 mt-1 text-[13px] leading-[1.6] text-ink-50">
                          Whoever signs this off watches the cuts here and says approve
                          or changes. No account, no login, and they never see what you
                          paid.
                        </p>
                        <ReviewLinkBox jobId={job.id} link={reviewLink} />
                      </div>

                      {openNotes.length > 0 && (
                        <div className="space-y-3 border-t border-line pt-4">
                          <p className={LABEL}>Waiting on you</p>
                          {openNotes.map((note) => (
                            <ClientNoteRow
                              key={note.id}
                              jobId={job.id}
                              note={note}
                              canForward={job.status === "delivered"}
                              directionUsed={job.change_rounds >= 1}
                            />
                          ))}
                        </div>
                      )}

                      {reviewLink && clientNotes.length === 0 && (
                        <p className="border-t border-line pt-4 text-[13.5px] text-ink-50">
                          Nothing back from them yet.
                        </p>
                      )}

                      {handledNotes.length > 0 && (
                        <div className="space-y-3 border-t border-line pt-4">
                          <p className={LABEL}>Already dealt with</p>
                          <ul className="space-y-2.5">
                            {handledNotes.map((note) => (
                              <li key={note.id} className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13.5px] font-bold tracking-[-0.015em]">
                                    {reviewerName(note)}
                                  </span>
                                  <Pill tone={VERDICT_TONE[note.verdict]}>
                                    {VERDICT_LABEL[note.verdict]}
                                  </Pill>
                                  <span className="text-[12.5px] text-ink-50">
                                    {ago(note.created_at)}
                                  </span>
                                </div>
                                {note.body && (
                                  <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink-70">
                                    {note.body}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              }
            />

            {payout && (
              <Panel
                title="Payout"
                action={<span className="text-[13px] text-ink-50">frozen at approval</span>}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[22px] font-extrabold tabular-nums tracking-[-0.02em]">
                    {money(payout.amount_cents)}
                  </p>
                  <Pill tone={payout.status === "paid" ? "flame" : "quiet"}>
                    {payout.status}
                  </Pill>
                </div>
                <p className="mt-1 text-[12.5px] leading-[1.6] text-ink-50">
                  {payout.memo ?? "edit job"} · logged {shortDate(payout.created_at)}
                  {payout.paid_at ? ` · paid ${shortDate(payout.paid_at)}` : ""} · the
                  platform pays the editor, you already paid in credits
                </p>
              </Panel>
            )}

            <JobTrail events={events} viewerId={viewerId} />
          </div>
        </div>
      </Page>
    </>
  );
}
