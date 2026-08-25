import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BrandMark } from "@/components/dash/brand-mark";
import { ClaimButton, ReleaseButton } from "@/components/editors/claim-button";
import { toJob } from "@/components/editors/coerce";
import { JobChat, JobTrail } from "@/components/editors/job-chat";
import { CommentForm, SendCutForm } from "@/components/editors/job-forms";
import { EmptyNote, Panel, Pill, PrimaryLink, StatusPill } from "@/components/editors/ui";
import { brandLogo } from "@/lib/brand-catalog";
import {
  bundleLabel,
  EDITING_ENABLED,
  jobTotalCents,
  type JobDeliverable,
  type JobEvent,
  type LinkItem,
} from "@/lib/editing";
import {
  humanSize,
  isImageFile,
  type JobFile,
  loadJobFiles,
  resolveDeliverables,
  loadDealAssets,
} from "@/lib/editing-files";
import {
  reviewerName,
  VERDICT_LABEL,
  VERDICT_TONE,
  type ReviewNote,
} from "@/lib/editing-review";
import { loadReviewNotes } from "@/lib/editing-review-server";
import { ago, money } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { turnaroundShort } from "@/lib/credits";

/**
 * What the creator's own client said on the review link.
 *
 * Shown here unedited on purpose: "make the hook shorter" loses something
 * every time it is retyped by somebody in the middle, and the editor turning
 * the note around is the one who needs the original words.
 *
 * Read only. The client talks to the creator, the creator talks to the editor,
 * and a reply typed here would go to nobody.
 */
function ClientNotes({ notes }: { notes: ReviewNote[] }) {
  return (
    <ul className="space-y-3.5">
      {notes.map((note) => (
        <li
          key={note.id}
          className="border-t border-line pt-3.5 first:border-0 first:pt-0"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold tracking-[-0.015em]">
              {reviewerName(note)}
            </span>
            <Pill tone={VERDICT_TONE[note.verdict]}>
              {VERDICT_LABEL[note.verdict]}
            </Pill>
            {note.version > 0 && note.deliverable_id && (
              <span className="text-[12.5px] text-ink-50">on cut {note.version}</span>
            )}
            <span className="text-[12.5px] text-ink-50">{ago(note.created_at)}</span>
          </div>
          {note.body && (
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-[1.6] text-ink-70">
              {note.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function LinkList({ links, empty }: { links: LinkItem[]; empty: string }) {
  if (links.length === 0) {
    return <p className="text-[13.5px] text-ink-50">{empty}</p>;
  }
  return (
    <ul className="space-y-2">
      {links.map((l, i) => (
        <li key={`${l.url}-${i}`}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-[14px] font-semibold text-flame transition-colors hover:text-flame-dark"
          >
            {l.label || l.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The rows are identical whichever pile they land in, so the split above is
 *  purely about labelling: the section title says what the files are for. */
function FileRows({
  files,
}: {
  files: {
    id: string;
    name: string;
    mime: string | null;
    size_bytes: number | null;
    created_at: string;
    signedUrl: string | null;
  }[];
}) {
  return (
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
            <span className="block truncate text-[14px] font-semibold">
              {file.name}
            </span>
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
              className="shrink-0 text-[13px] font-semibold text-flame transition-colors hover:text-flame-dark"
            >
              {isImageFile(file) ? "open" : "download"}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The workspace: everything about one job, and the two things an editor does
 * to it, sending a cut and talking to the creator. An open job someone else
 * could still take renders as a preview with the claim button instead.
 */
export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // same as the market: the group's layout is open for hiring now, so every
  // job page checks the market's own flag for itself, with the founder's
  // rehearsal bypass while the flag is off.
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!EDITING_ENABLED) {
    const { data: isFounder } = await supabase.rpc("am_i_admin");
    if (!isFounder) notFound();
  }
  if (!user) redirect("/login?next=/editors/market");

  // RLS shows an editor open jobs plus their own, so anything else 404s here
  // without a policy re-check in code.
  const { data: jobRow } = await supabase
    .from("edit_jobs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!jobRow) notFound();

  const job = toJob(jobRow as Record<string, unknown>);
  const mine = job.editor_id === user.id;

  const [{ data: deliverableRows }, { data: eventRows }, files, clientNotes, dealAssets] =
    await Promise.all([
    supabase
      .from("edit_job_deliverables")
      .select("*")
      .eq("job_id", id)
      .order("version", { ascending: true }),
    supabase
      .from("edit_job_events")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    // RLS only hands file rows to the job's two participants, so a browsing
    // editor sizing up an open job simply sees none.
    loadJobFiles(supabase, id),
    // rls hands these to the job's creator and its editor, nobody else, so a
    // browsing editor sizing up an open job simply gets an empty list.
    loadReviewNotes(supabase, id),
    // the brand's shelf. same rls shape: the editor holding a job on this deal
    // can read it, a browsing editor gets nothing.
    loadDealAssets(supabase, job.deal_id),
  ]);

  const deliverables = await resolveDeliverables(
    supabase,
    (deliverableRows ?? []) as JobDeliverable[]
  );
  const events = (eventRows ?? []) as JobEvent[];
  // the creator's uploads; cut files already show as deliverables.
  const footage = files.filter((f) => f.kind === "footage");
  // "reference" is a retired kind: references are links now. the few rows that
  // still carry it are material that goes over the cut, so they sit with assets
  // rather than dropping off the page entirely.
  const assets = files.filter(
    (f) => f.kind === "asset" || f.kind === "reference"
  );
  // the words before the pictures: a doc on this batch, and the brand's own
  // standing one, which is the same doc on every batch it ever sends.
  const docs = files.filter((f) => f.kind === "doc");
  const brandDocs = dealAssets.filter((a) => a.kind === "doc");
  const brandAssets = dealAssets.filter((a) => a.kind === "asset");
  const canCut =
    mine && ["claimed", "revisions", "delivered"].includes(job.status);
  // only the editor holding the job is on a clock, and only while the ball is
  // in their court
  const onTheClock =
    mine && !!job.sla_at && (job.status === "claimed" || job.status === "revisions");
  // one clock reading per request. server component, so "render" is one
  // request and the read is pure for its lifetime.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const hoursLeft = job.sla_at
    ? Math.max(1, Math.round((new Date(job.sla_at).getTime() - now) / 3600_000))
    : 0;
  const overdue = !!job.sla_at && new Date(job.sla_at).getTime() <= now;

  return (
    <div className="space-y-6">
      <nav className="text-[13px] font-semibold text-ink-50">
        <Link
          href={mine ? "/editors" : "/editors/market"}
          className="transition-colors hover:text-flame"
        >
          {mine ? "← your jobs" : "← the market"}
        </Link>
      </nav>

      {/* one block carries the whole identity of the job: whose brand it is,
          what it pays, and how long is left */}
      <header className="rounded-card border border-line bg-paper p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <BrandMark
              name={job.brand_name ?? job.title}
              logo={brandLogo({
                logo_key: job.brand_logo_key,
                logo_url: job.brand_logo_url,
              })}
              size="lg"
            />
            <div className="min-w-0">
              {/* no brand on the row means no eyebrow, never a placeholder */}
              {job.brand_name && (
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-50">
                  {job.brand_name}
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <h1 className="text-[clamp(1.35rem,3.2vw,1.75rem)] font-extrabold leading-[1.15] tracking-[-0.03em]">
                  {job.title}
                </h1>
                <StatusPill status={job.status} />
              </div>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-50">
                <span className="text-[15px] font-bold tracking-[-0.015em] text-ink tabular-nums">
                  {bundleLabel(job)}
                </span>
                <span className="tabular-nums">
                  {money(jobTotalCents(job))} for the batch
                </span>
                {/* nothing is ticking until someone claims it, so the board
                    promises the length of the clock, not a date */}
                {job.status === "open" && (
                  <span>{turnaroundShort(job.is_rush)} once you claim it</span>
                )}
                <span>posted {ago(job.created_at)}</span>
              </p>
            </div>
          </div>
          <div className="shrink-0">
            {job.status === "open" && !mine && (
              <ClaimButton jobId={job.id} size="lg" />
            )}
            {mine && job.status === "claimed" && (
              <ReleaseButton
                jobId={job.id}
                late={
                  !!job.claimed_at &&
                  now - new Date(job.claimed_at).getTime() > 2 * 3600_000
                }
              />
            )}
          </div>
        </div>

        {onTheClock && (
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-[14px] font-semibold text-ink-70">
              {overdue
                ? "past the deadline. deliver now, the sweep runs hourly."
                : `your deadline: ${hoursLeft} hours left`}
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-50">
              miss it and the job goes back on the board and counts against your
              tier.
            </p>
          </div>
        )}
      </header>

      {mine && job.status === "revisions" && (
        <div className="rounded-card border-2 border-flame bg-ember px-5 py-4">
          <p className="text-[15px] font-bold text-flame-dark">
            the creator asked for changes
          </p>
          <p className="mt-1 text-[13.5px] text-flame-dark">
            read the messages, then send a new cut. the next one goes out as v
            {deliverables.length + 1}.
          </p>
        </div>
      )}

      {mine && job.status === "approved" && (
        <p className="rounded-card border border-line bg-paper px-5 py-4 text-[14px] text-ink-70">
          approved{job.approved_at ? ` ${ago(job.approved_at)}` : ""}. the payout
          shows on your{" "}
          <Link href="/editors" className="font-semibold text-flame">
            overview
          </Link>{" "}
          once it is logged.
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        {/* left: what the work is. right: what you do about it. */}
        <div className="space-y-6">
          <Panel title="the brief">
            {job.brief ? (
              <p className="whitespace-pre-wrap text-[14.5px] leading-[1.65] text-ink-70">
                {job.brief}
              </p>
            ) : (
              <p className="text-[13.5px] text-ink-50">
                no written brief. go by the references.
              </p>
            )}
          </Panel>

          <div className="grid gap-6 sm:grid-cols-2">
            <Panel title="raw footage">
              <LinkList
                links={job.footage_links}
                empty="no footage links yet. ask in the messages."
              />
            </Panel>

            <Panel title="references">
              <LinkList
                links={job.reference_links}
                empty="no references on this one."
              />
            </Panel>
          </div>

          {brandDocs.length > 0 && (
            <Panel
              title="how this brand wants it"
              action={
                <span className="text-[13px] text-ink-50">
                  applies to every batch from them
                </span>
              }
            >
              <FileRows files={brandDocs} />
            </Panel>
          )}

          {docs.length > 0 && (
            <Panel title="the brief">
              <FileRows files={docs} />
            </Panel>
          )}

          {footage.length > 0 && (
            <Panel title="videos to edit">
              <FileRows files={footage} />
            </Panel>
          )}

          {assets.length > 0 && (
            <Panel title="assets">
              <FileRows files={assets} />
            </Panel>
          )}

          {brandAssets.length > 0 && (
            <Panel
              title="brand assets"
              action={<span className="text-[13px] text-ink-50">on every batch</span>}
            >
              <FileRows files={brandAssets} />
            </Panel>
          )}

          {/* the house bank, from the one page an editor actually sits on.
              not a copy of the library, a pointer to it: a cut that sounds
              like the others is the point of having a bank at all, and an
              editor who never finds the rail row never uses it. */}
          <Panel
            title="house sound"
            action={<span className="text-[13px] text-ink-50">music and sfx</span>}
          >
            <p className="text-[13.5px] leading-[1.5] text-ink-70">
              every cut for us is built from the same bank. grab the packs once
              and work offline, or pull single files while you cut.
            </p>
            <PrimaryLink href="/editors/library" className="mt-3">
              open the sound library
            </PrimaryLink>
          </Panel>

          {clientNotes.length > 0 && (
            <Panel
              title="the client said"
              action={
                <span className="text-[13px] text-ink-50">
                  straight from the brand
                </span>
              }
            >
              <ClientNotes notes={clientNotes} />
            </Panel>
          )}

          {/* the composer only exists for the editor holding the job; a
              browsing editor reads the thread and nothing else */}
          <JobChat
            events={events}
            viewerId={user.id}
            otherLabel="the creator"
            composer={mine ? <CommentForm jobId={job.id} /> : undefined}
          />
        </div>

        <div className="space-y-6">
          {canCut && (
            <Panel title="send a cut">
              <SendCutForm jobId={job.id} nextVersion={deliverables.length + 1} />
            </Panel>
          )}

          <Panel title="your cuts" padded={false}>
            {deliverables.length === 0 ? (
              <EmptyNote>no cuts sent yet.</EmptyNote>
            ) : (
              <ul>
                {deliverables.map((d) => (
                  <li
                    key={d.id}
                    className="border-b border-line px-5 py-3.5 last:border-b-0 sm:px-6"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        {d.resolvedUrl ? (
                          <a
                            href={d.resolvedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-flame transition-colors hover:text-flame-dark"
                          >
                            cut v{d.version}
                          </a>
                        ) : (
                          <span className="font-semibold text-ink-50">
                            cut v{d.version}
                          </span>
                        )}
                        {d.uploaded && <Pill tone="line">uploaded file</Pill>}
                      </div>
                      <span className="text-[12.5px] text-ink-50">
                        {ago(d.created_at)}
                      </span>
                    </div>
                    {d.note && (
                      <p className="mt-1 text-[13px] leading-[1.55] text-ink-50">
                        {d.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <JobTrail events={events} viewerId={user.id} />
        </div>
      </div>
    </div>
  );
}
