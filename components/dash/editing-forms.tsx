"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import {
  postJobComment,
  recordDealAsset,
  recordDeliveredCut,
  recordJobFile,
  requestRevisions,
  updateEditJob,
  type EditingState,
} from "@/app/(dash)/editing/actions";
import { Area, Field, Label, Note, Select, Submit } from "@/components/dash/form";
import { Dropzone } from "@/components/dropzone";
import {
  creditsLabel,
  jobCredits,
  TIER_HINT,
  TIER_LABEL,
  tierForKind,
  VIDEO_KINDS,
  type VideoKind,
} from "@/lib/credits";
import type { EditJob, LinkItem } from "@/lib/editing";

const empty: EditingState = {};

/** Same drawing language as form.tsx, for the inputs it has no primitive for. */
const shell =
  "flex items-center rounded-xl border border-line bg-shell px-3.5 focus-within:border-flame";
const control =
  "w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none";

export type PickerDeal = { id: string; label: string };

/**
 * A growable list of url + label rows, posting as repeated `<name>_url` /
 * `<name>_label` pairs the server zips back together. Controlled on purpose:
 * removing a middle row from uncontrolled inputs leaves the old defaultValues
 * sitting in the wrong rows.
 */
function LinksField({
  label,
  name,
  urlPlaceholder,
  hint,
  initial,
}: {
  label: string;
  name: string;
  urlPlaceholder: string;
  hint?: string;
  initial?: LinkItem[];
}) {
  const [rows, setRows] = useState<LinkItem[]>(
    initial?.length ? initial : [{ url: "", label: "" }]
  );

  const set = (i: number, patch: Partial<LinkItem>) =>
    setRows(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  const remove = (i: number) =>
    setRows(rows.length > 1 ? rows.filter((_, j) => j !== i) : [{ url: "", label: "" }]);

  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1.5 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`${shell} min-w-0 flex-1`}>
              <input
                name={`${name}_url`}
                value={row.url}
                onChange={(e) => set(i, { url: e.target.value })}
                placeholder={urlPlaceholder}
                inputMode="url"
                aria-label={`${label} link ${i + 1}`}
                className={control}
              />
            </div>
            <div className={`${shell} w-[150px] shrink-0`}>
              <input
                name={`${name}_label`}
                value={row.label}
                onChange={(e) => set(i, { label: e.target.value })}
                placeholder="what it is"
                aria-label={`${label} link ${i + 1} label`}
                className={control}
              />
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${label.toLowerCase()} link ${i + 1}`}
              className="shrink-0 text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setRows([...rows, { url: "", label: "" }])}
        className="mt-2 text-[13px] font-semibold text-ink-70 transition-colors hover:text-ink"
      >
        + Add another link
      </button>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}
    </div>
  );
}

/**
 * One section of the job form. Three of these carry the whole thing, because a
 * flat run of fifteen fields hides the only question that changes the price.
 */
function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-bold tracking-[-0.015em]">{title}</h3>
      <p className="mt-0.5 text-[13px] text-ink-50">{hint}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/**
 * The fields create and edit share, so the two can never drift. The server
 * parses both submits through the same `readJobForm`, this is just the shape
 * on screen.
 *
 * A job is a BATCH, not a video: "5 cuts for Candle, same edit" is one row
 * with one brief, one claim and one clock. The form is built around that
 * number, because a creator who cannot see it posts five jobs and pays five
 * claims for work one editor would have done in one sitting.
 *
 * There is no pay field. The rate comes from one question, what kind of
 * videos: a reaction is 1 credit each, everything else is 2, rush adds 1.
 * Editing an existing job never re-prices it, because the credits were spent
 * when it was posted.
 */
function JobFields({
  job,
  deals,
  balance,
}: {
  job?: EditJob;
  deals: PickerDeal[];
  balance?: number;
}) {
  const priced = !job; // only a new job is being priced
  // an existing job keeps whatever it was priced at, so the picker opens on
  // the kind that matches its frozen tier rather than resetting to reaction.
  const [kind, setKind] = useState<VideoKind>(
    job && job.tier === 1 ? "reaction" : "standard"
  );
  const [rush, setRush] = useState(false);
  const [videos, setVideos] = useState(job?.video_count ?? 1);

  const tier = tierForKind(kind);
  const credits = jobCredits(tier, rush, videos);
  const short = priced && balance !== undefined && balance < credits;
  // the number the batch is actually priced off. 1 credit = $1 of editor pay,
  // so this is also what an editor sees per cut when they read the board.
  const perVideo = tier + (rush ? 1 : 0);

  return (
    <div className="space-y-6">
      <Block
        title="What the job is"
        hint="One brand deal, one set of instructions. Five cuts for the same brand is one job, not five."
      >
        {/* no title box. a job is "the next batch for Candle", and a field
            that only ever gets the brand's name typed into it is a field
            worth deleting. the brand names it and a counter separates
            batches, resolved server side where the existing ones are known. */}
        <Select
          label="Brand deal"
          name="deal_id"
          options={[
            { value: "", label: "not tied to a deal" },
            ...deals.map((d) => ({ value: d.id, label: d.label })),
          ]}
          defaultValue={job?.deal_id ?? ""}
          hint={
            job
              ? "Moves the finished cuts to another brand. The name this batch already has does not change."
              : "Names this batch and puts the brand's logo on the board. A second batch for the same brand is numbered, so Candle is followed by Candle 2."
          }
        />

        {/* the number that decides the price, the claim and the workload, so it
            sits above the brief rather than buried under it. no due date
            beside it: the turnaround IS the deadline, 24h from the moment an
            editor claims it, and a date typed here could only disagree with
            the clock the market actually runs. */}
        <Field
          label="How many videos in this batch"
          name="video_count"
          type="number"
          value={String(videos)}
          onChange={(v: string) => {
            const n = parseInt(v, 10);
            setVideos(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 1);
          }}
          hint="Every video in a batch shares one brief, one editor and one 36 hour clock that starts when it is claimed. If a set needs different instructions, post it as a second job."
        />

        {/* style and format used to sit under here as two more boxes. they
            were a third place to write the same instruction, so the brief is
            the only place now. */}
        <Area
          label="Script / brief"
          name="brief"
          rows={6}
          defaultValue={job?.brief ?? ""}
          placeholder="Paste the script if there is one, then tell the editor how to cut it: what the videos are for, what to keep, where the hook is, the look you want and the format."
        />
      </Block>

      <Block
        title="What the editor works from"
        hint="Links here for the whole batch. Once the job is posted you can upload the videos and the assets to it directly."
      >
        <LinksField
          label="Video links"
          name="footage"
          urlPlaceholder="https://drive.google.com/..."
          initial={job?.footage_links}
          hint="Where the raw videos live. Drive, Dropbox, anything with a link."
        />

        <LinksField
          label="References"
          name="reference"
          urlPlaceholder="https://www.tiktok.com/..."
          initial={job?.reference_links}
          hint="Links only. Videos that already look like what you want back."
        />
      </Block>

      {priced ? (
        <Block
          title="What it costs"
          hint="Priced per video and spent when you post. Cancel before an editor claims it and the credits come straight back."
        >
          {/* one question, two answers. the four "does it need b-roll" boxes
              that used to live here were ticked on essentially every job, so
              they priced nothing and just made the form longer. */}
          <div>
            <Label>What kind of videos</Label>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {VIDEO_KINDS.map((k) => (
                <button
                  type="button"
                  key={k.value}
                  onClick={() => setKind(k.value)}
                  aria-pressed={kind === k.value}
                  className={`rounded-card border px-4 py-3 text-left transition-colors ${
                    kind === k.value
                      ? "border-flame bg-ember"
                      : "border-line bg-shell hover:border-ink-50"
                  }`}
                >
                  <span
                    className={`flex items-baseline justify-between gap-2 text-[14.5px] font-bold ${
                      kind === k.value ? "text-flame-dark" : "text-ink"
                    }`}
                  >
                    {k.label}
                    <span className="tabular-nums">${k.tier}</span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-ink-50">
                    {k.blurb}
                  </span>
                </button>
              ))}
            </div>
            <input type="hidden" name="video_kind" value={kind} />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink-70">
            <input
              type="checkbox"
              name="rush"
              checked={rush}
              onChange={(e) => setRush(e.target.checked)}
              className="accent-flame"
            />
            Rush it (6h turnaround, +1 credit per video)
          </label>

          {/* -------------------------------------------------- the price */}
          <div className="rounded-card border border-line bg-shell px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                  This batch costs
                </p>
                {/* the sum, not just the total: the per-video number is what a
                    creator compares against what they would pay elsewhere. */}
                <p className="mt-1 text-[24px] font-extrabold tabular-nums tracking-[-0.02em]">
                  {videos} video{videos === 1 ? "" : "s"} x ${perVideo} ={" "}
                  {creditsLabel(credits)}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-50">
                  {TIER_LABEL[tier]}
                  {rush ? " · rush" : ""} · {TIER_HINT[tier]}
                </p>
              </div>
              {balance !== undefined && (
                <div className="text-right">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                    Your balance
                  </p>
                  <p
                    className={`mt-1 text-[20px] font-bold tabular-nums ${
                      short ? "text-flame-dark" : ""
                    }`}
                  >
                    {creditsLabel(balance)}
                  </p>
                </div>
              )}
            </div>
            {short && (
              <p className="mt-3 border-t border-line pt-3 text-[13.5px] text-flame-dark">
                Not enough credits for this job.{" "}
                <Link href="/editing/credits" className="font-semibold underline">
                  Top up first
                </Link>
                , then come back and post it.
              </p>
            )}
          </div>
        </Block>
      ) : (
        <Block
          title="What it cost"
          hint="Frozen when the job was posted. Edits change the brief, never the price."
        >
          <div className="rounded-card border border-line bg-shell px-5 py-3.5 text-[13.5px] text-ink-50">
            <b className="font-bold text-ink">{creditsLabel(job.credits)}</b> for{" "}
            {job.video_count} video{job.video_count === 1 ? "" : "s"} (
            {TIER_LABEL[job.tier]}
            {job.is_rush ? " · rush" : ""}). Changing the count here does not re-price
            the batch, so post a second job for videos this one never paid for.
          </div>
        </Block>
      )}
    </div>
  );
}

/** The offer, editable only while the job is open. Same fields as create. */
export function EditJobForm({ job, deals }: { job: EditJob; deals: PickerDeal[] }) {
  const [state, action] = useActionState(updateEditJob, empty);

  return (
    <form action={action}>
      <input type="hidden" name="job_id" value={job.id} />
      <JobFields job={job} deals={deals} />
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Submit pendingLabel="Saving">Save the job</Submit>
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * Send a delivered cut back. The scope choice is the revisions policy on
 * screen: brief-conformance fixes are unlimited, a change of mind gets the
 * one included round and the server counts it on the job.
 */
export function RevisionForm({ job }: { job: EditJob }) {
  const [state, action] = useActionState(requestRevisions, empty);
  const [scope, setScope] = useState<"brief" | "direction">("brief");
  const directionUsed = job.change_rounds >= 1;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="job_id" value={job.id} />
      <input type="hidden" name="scope" value={scope} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setScope("brief")}
          aria-pressed={scope === "brief"}
          className={`rounded-pill border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
            scope === "brief"
              ? "border-flame bg-ember text-flame-dark"
              : "border-line text-ink-50 hover:text-ink"
          }`}
        >
          Doesn&apos;t match the brief
        </button>
        <button
          type="button"
          onClick={() => setScope("direction")}
          aria-pressed={scope === "direction"}
          disabled={directionUsed}
          className={`rounded-pill border px-3.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            scope === "direction"
              ? "border-flame bg-ember text-flame-dark"
              : "border-line text-ink-50 hover:text-ink"
          }`}
        >
          {directionUsed ? "Direction change used" : "I want something different"}
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field
          label="What to change"
          name="note"
          placeholder={
            scope === "brief"
              ? "Point at the line in the brief that was missed"
              : "The new direction, in one or two lines"
          }
          hint={
            scope === "brief"
              ? "Brief fixes are free and unlimited. The job is not done until it matches."
              : "One direction change is included per job. After that, a new direction is a new job."
          }
        />
        <div className="pb-[22px]">
          <Submit tone="line" pendingLabel="Sending">
            Request revisions
          </Submit>
        </div>
      </div>
      <Note state={state} />
    </form>
  );
}

/**
 * The upload half of the files panel: say what the file is, then drop it.
 *
 * Three piles, not one. The videos an editor cuts, the material they cut with,
 * and the words they read first all get sorted by somebody either way, and it
 * should not be the editor opening nineteen unsorted files. References are
 * links on the job form, so there is nothing to upload under that word.
 *
 * The second switch is the one that matters: an asset or a doc can go on THIS
 * batch or on the brand deal, and on the deal it shows up on every batch that
 * brand ever gets without being uploaded again. Footage never has that choice,
 * because raw video is the one thing that is genuinely per batch.
 */
export function JobAssetUploader({
  jobId,
  dealId,
}: {
  jobId: string;
  dealId: string | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"footage" | "asset" | "doc">("footage");
  const [toBrand, setToBrand] = useState(false);

  const canBrand = Boolean(dealId) && kind !== "footage";
  const brand = canBrand && toBrand;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["footage", "Videos to edit"],
            ["asset", "Assets"],
            ["doc", "Docs"],
          ] as const
        ).map(([k, label]) => (
          <button
            type="button"
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-pill border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              kind === k
                ? "border-flame bg-ember text-flame-dark"
                : "border-line text-ink-50 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}

        {canBrand && (
          <label className="ml-1 flex cursor-pointer items-center gap-2 text-[13px] text-ink-70">
            <input
              type="checkbox"
              checked={toBrand}
              onChange={(e) => setToBrand(e.target.checked)}
              className="size-4 accent-flame"
            />
            keep on the brand deal
          </label>
        )}
      </div>

      <Dropzone
        folder={brand ? `bank/${dealId}` : `${jobId}/assets`}
        label={
          kind === "footage"
            ? "Drop the videos"
            : kind === "doc"
              ? "Drop the docs"
              : "Drop the assets"
        }
        hint={
          brand
            ? "Kept on the brand deal. Every batch for it gets these without another upload."
            : kind === "footage"
              ? "The raw videos for this batch. Files or a whole folder, up to 500 MB each."
              : kind === "doc"
                ? "The script, the SOP, the brand guidelines. Anything read before cutting."
                : "B-roll, music, sfx, product shots, logos. Anything that goes on top of the cut."
        }
        onUploaded={(file) =>
          brand && dealId
            ? recordDealAsset({ dealId, kind, ...file })
            : recordJobFile({ jobId, kind, ...file })
        }
        onDone={() => router.refresh()}
      />
    </div>
  );
}

/** The post box at the bottom of the thread. */
export function CommentForm({ jobId }: { jobId: string }) {
  const [state, action] = useActionState(postJobComment, empty);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="job_id" value={jobId} />
      <div className="min-w-0 flex-1">
        <Area
          label="Say something"
          name="body"
          rows={2}
          placeholder="Notes, questions, timestamps."
        />
      </div>
      <div className="pb-[2px]">
        <Submit size="sm" pendingLabel="Sending">
          Send
        </Submit>
      </div>
      <div className="w-full">
        <Note state={state} />
      </div>
    </form>
  );
}

/**
 * The creator filing the cut their editor sent back.
 *
 * On this deploy the editor has no login: they read the batch off a handoff
 * link and send the finished file back over whatever chat they already use. So
 * the delivery is a creator upload, and `recordDeliveredCut` does everything
 * the editor's own delivery did — a file row, a versioned deliverable, the flip
 * to delivered — off the same object.
 *
 * The folder is `<job>/assets`, not `<job>/cuts`: cuts is the prefix storage
 * only lets a claimed editor write to, and there is no claimed editor here.
 */
export function DeliveredCutUploader({ jobId }: { jobId: string }) {
  const router = useRouter();

  return (
    <Dropzone
      folder={`${jobId}/assets`}
      accept="video/*"
      label="Drop the finished cut"
      hint="What came back from your editor. Every drop is a new version, so v2 goes here too."
      onUploaded={(file) => recordDeliveredCut({ jobId, ...file })}
      onDone={() => router.refresh()}
    />
  );
}
