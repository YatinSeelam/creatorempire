"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  createEditJob,
  deleteDealAsset,
  recordDealAsset,
  type EditingState,
} from "@/app/(dash)/editing/actions";
import { BrandMark } from "@/components/dash/brand-mark";
import { Dropzone, type UploadRow, type UploadedFile } from "@/components/dropzone";
import { Note } from "@/components/dash/form";
import {
  BUCKET,
  fileFamily,
  humanSize,
  type DealAsset,
  type JobFileKind,
} from "@/lib/editing-files";
import { createClient } from "@/lib/supabase/client";
import {
  creditsLabel,
  jobCredits,
  TIER_HINT,
  TIER_LABEL,
  tierForKind,
  turnaroundHours,
  turnaroundShort,
  VIDEO_KINDS,
  type JobTier,
  type VideoKind,
} from "@/lib/credits";
import { EDITOR_MARKET_ENABLED } from "@/lib/editing";
import type { LinkItem } from "@/lib/editing";

const empty: EditingState = {};

/** what the picker draws. mirrors `DealOption` in lib/editing-server.ts, which
 *  is where it is built; kept as its own name because this file is a client
 *  component and importing a server module for a type drags the module with
 *  it. */
export type PickerDeal = {
  id: string;
  label: string;
  brandName: string;
  name: string;
  logo: string;
};

const STEPS = ["the job", "the brief", "review"] as const;

const BRIEF_MAX = 2000;

/** Whether the Drive tile can open google's picker or is just a paste field.
 *  Worked out here rather than imported from `drive-picker.tsx`: that module is
 *  `"use client"`, and a non-component export from one does not cross the client
 *  boundary. `NEXT_PUBLIC_` vars are inlined at build time, so this is the same
 *  answer with no boundary to cross. */
// this deploy never talks to google drive. no picker, no gapi script, no
// client id. a drive link can still be pasted like any other url.
const drivePickerReady = false;

/** a file uploaded before the job exists. `path` already points at an object
 *  in the bucket; posting the form is what ties it to the job. */
type Staged = UploadedFile & { kind: JobFileKind };

/**
 * Posting a batch, in three steps beside a running summary.
 *
 * One `<form>`, not three. Every step stays mounted and the inactive ones are
 * hidden with a class rather than the `hidden` attribute, so the browser posts
 * the whole thing in one go and stepping back and forth cannot drop what was
 * typed. A step per form would mean either a draft row per abandoned attempt or
 * state marooned in a parent, and this form is short enough that neither is
 * worth it.
 *
 * Cards on the left, a summary rail on the right. The rail has been in and out
 * of this form twice, and the version that works is the narrow one: it carries
 * ONLY what changes the price (how many, what kind, how fast), the total, and
 * the button that leaves the step. Every earlier rail restated the brand deal
 * and the brief as well, which are on screen a few inches to its left, and then
 * had to stand as tall as a form whose body is one textarea — so most of it was
 * empty paper and the price was the only line anybody read.
 *
 * Putting the button there is the other half. A footer per card put the one
 * control somebody is looking for at the bottom of whichever card happened to
 * be tallest, so it moved every time a dropzone filled up. In the rail it is in
 * the same place on all three steps, next to the number it is about to spend.
 *
 * The split across the steps is raw material, then direction. Step one is the
 * job and the footage: what is being made and the video to make it out of. Step
 * two is everything about how it should come back — the brief, examples of it,
 * and the brand's kit. References and logos were on step one for a while, which
 * left four blocks and a page of scroll there while step two was a textarea and
 * a lot of empty paper; a reference video and a logo are both instructions, and
 * neither is footage to be cut.
 *
 * References and brand assets are both marked needed, and neither is enforced.
 * A hard gate on "upload a logo" would block a reaction video that genuinely
 * has no brand material, and a form that refuses to continue for a reason the
 * person disagrees with is a form they abandon. What both of them actually cost
 * when they are missing is a revision round, so the cards say so and the
 * decision stays with the creator.
 *
 * Only used for posting. Editing an existing job keeps the plain column in
 * editing-forms.tsx, because a job somebody is amending has no steps to walk:
 * they came to change one field.
 */
export function NewJobWizard({
  deals,
  balance,
  userId,
}: {
  deals: PickerDeal[];
  balance: number;
  /** the folder uploads land in before the job has an id: `user/<userId>/`. */
  userId: string;
}) {
  const [state, action] = useActionState(createEditJob, empty);
  const [step, setStep] = useState(0);

  // a job is for a brand deal. "not tied to a deal" came off the picker: it
  // was the default, so it was what most jobs got, and a job with no deal has
  // no brand to stamp on it, no shelf to pull logos from, and nothing for the
  // editor to read about who the client is. the server still accepts a null
  // deal, because jobs created before this exist and the edit form still
  // offers it; the NEW job form simply does not.
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [videos, setVideos] = useState(1);
  const [kind, setKind] = useState<VideoKind>("standard");
  const [rush, setRush] = useState(false);
  const [brief, setBrief] = useState("");

  // files already in the bucket, waiting for the job that will own them.
  const [staged, setStaged] = useState<Staged[]>([]);
  // the picked deal's shelf, and a nonce to pull it again after a write.
  const [shelf, setShelf] = useState<DealAsset[]>([]);
  const [shelfNonce, setShelfNonce] = useState(0);
  // a doc is either for this batch or for every batch this brand ever gets.
  const [docScope, setDocScope] = useState<"job" | "brand">("job");
  // what the drive picker handed back. lifted because it is written from the
  // picker and drawn in the strip below it, which are two different places.
  const [footageLinks, setFootageLinks] = useState<LinkItem[]>([]);
  // only used on a deploy with no google cloud project, where the picker cannot
  // exist and a plain paste field takes its place.
  const [pastedLink, setPastedLink] = useState("");
  // the footage dropzone's own queue, drawn as tiles in the strip below it
  // rather than as a text list inside the box. one place, with a bar on it.
  const [queue, setQueue] = useState<UploadRow[]>([]);
  // the brand kit's own upload queue, plus a way in for a drive import.
  const [assetQueue, setAssetQueue] = useState<UploadRow[]>([]);
  // the asset dropzone's "take these files", so a drive import can hand its
  // downloads straight to the uploader that already exists.
  const assetIntake = useRef<((files: File[]) => void) | null>(null);
  // whatever google last said went wrong, in place of the sharing note.
  const [driveNote, setDriveNote] = useState<string | null>(null);

  const folder = `user/${userId}`;
  const canShelf = Boolean(dealId);

  const stage = (kind: JobFileKind) => async (file: UploadedFile) => {
    setStaged((prev) => [...prev, { ...file, kind }]);
  };

  const toShelf = (kind: "asset" | "doc") => async (file: UploadedFile) => {
    const res = await recordDealAsset({ dealId, kind, ...file });
    if (res?.error) return res;
    setShelfNonce((n) => n + 1);
  };

  async function unstage(path: string) {
    setStaged((prev) => prev.filter((f) => f.path !== path));
    // the row was never written, so the object is the only thing to undo.
    await createClient().storage.from(BUCKET).remove([path]);
  }

  async function offShelf(asset: DealAsset) {
    setShelf((prev) => prev.filter((a) => a.id !== asset.id));
    const body = new FormData();
    body.set("asset_id", asset.id);
    await deleteDealAsset(body);
    setShelfNonce((n) => n + 1);
  }

  // the shelf is read straight from the browser rather than through an action:
  // it is one rls-scoped select and a batch of signed urls, and doing it here
  // is what lets the panel refill the moment a different deal is picked.
  useEffect(() => {
    let alive = true;

    void (async () => {
      if (!dealId) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("deal_assets")
        .select("*")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false });

      const rows = (data ?? []) as Omit<DealAsset, "signedUrl">[];
      if (rows.length === 0) {
        if (alive) setShelf([]);
        return;
      }

      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(
          rows.map((r) => r.path),
          3600
        );
      const urlBy = new Map<string, string>();
      for (const item of signed ?? []) {
        if (item.path && item.signedUrl) urlBy.set(item.path, item.signedUrl);
      }

      if (alive) {
        setShelf(rows.map((row) => ({ ...row, signedUrl: urlBy.get(row.path) ?? null })));
      }
    })();

    return () => {
      alive = false;
    };
  }, [dealId, shelfNonce]);

  const stagedOf = (kind: JobFileKind) => staged.filter((f) => f.kind === kind);
  const shelfOf = (kind: "asset" | "doc") => shelf.filter((a) => a.kind === kind);

  const tier = tierForKind(kind);
  const credits = jobCredits(tier, rush, videos);
  const perVideo = tier + (rush ? 1 : 0);
  // free with the market off: there is no board, no editor being hired through
  // us, and nothing to pay for. the wallet is never read and never short.
  const short = EDITOR_MARKET_ENABLED && balance < credits;
  const dealLabel = deals.find((d) => d.id === dealId)?.label ?? "no deal yet";

  return (
    <form
      action={action}
      className="mx-auto grid w-full min-w-0 max-w-[1200px] items-start gap-x-6 gap-y-5 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      {/* what the post reads to tie the uploads to the job it is about to
          create. a json blob rather than a field per file: the count is not
          known until somebody drops a folder on the page. */}
      {/* the object urls are stripped: they mean nothing outside this tab and
          the server would ignore them anyway. */}
      <input
        type="hidden"
        name="staged_files"
        value={JSON.stringify(
          staged.map(({ preview: _preview, ...file }) => file)
        )}
      />

      {/* the title and the three steps on one line. the breadcrumb above says
          where you are in the app; this says what you are doing, and putting
          the stepper beside it rather than under it keeps the first card at
          the top of the page instead of a hundred pixels down it. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 lg:col-span-2">
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em]">create a job</h1>
        <div className="min-w-[280px] flex-1">
          <Stepper step={step} onGo={setStep} />
        </div>
      </div>

      {/* the steps. every one stays mounted and the inactive ones are hidden,
          so the form posts in one go and a dropzone mid-upload is never torn
          out from under itself by a step change. */}
      <div className="flex min-w-0 flex-col gap-5">
        <div className={step === 0 ? "flex flex-col gap-5" : "hidden"}>
          <Panel title="job details">
            {/* four across again, and this time it fits. the row used to need
                about 880px against a ~900px column, which is why the turnaround
                toggle kept clipping into edit type; dropping "not tied to a
                deal" took the picker's second line away and "everything else"
                became "full edit", which is ~90px between them. two-by-two
                below xl, one column on a phone. */}
            <div className="grid grid-cols-1 items-end gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(200px,1fr)_auto_auto_auto]">
              <Field label="brand deal">
                <DealPicker
                  deals={deals}
                  value={dealId}
                  onChange={(next) => {
                    // cleared here rather than in the effect: the old brand's
                    // files must not sit under the new brand's name for a
                    // frame.
                    setShelf([]);
                    setDealId(next);
                  }}
                />
              </Field>

              <Field label="number of videos">
                <div className="flex items-center">
                  <Step
                    onClick={() => setVideos((n) => Math.max(1, n - 1))}
                    label="one fewer"
                  >
                    −
                  </Step>
                  <input
                    name="video_count"
                    inputMode="numeric"
                    value={videos}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setVideos(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 1);
                    }}
                    className="h-12 w-[58px] border-y border-line bg-paper text-center text-[15.5px] font-bold tabular-nums outline-none focus:border-flame"
                  />
                  <Step
                    onClick={() => setVideos((n) => Math.min(50, n + 1))}
                    label="one more"
                  >
                    +
                  </Step>
                </div>
              </Field>

              <Field label="edit type">
                <Toggle>
                  {VIDEO_KINDS.map((k) => (
                    <Choice
                      key={k.value}
                      on={kind === k.value}
                      onClick={() => setKind(k.value)}
                    >
                      {k.label}
                      {EDITOR_MARKET_ENABLED && <Sub>${k.tier}</Sub>}
                    </Choice>
                  ))}
                </Toggle>
                <input type="hidden" name="video_kind" value={kind} />
              </Field>

              <Field label="turnaround">
                <Toggle>
                  <Choice on={!rush} onClick={() => setRush(false)}>
                    {turnaroundShort(false)}
                  </Choice>
                  <Choice on={rush} onClick={() => setRush(true)}>
                    {turnaroundShort(true)}
                    {EDITOR_MARKET_ENABLED && <Sub>+1</Sub>}
                  </Choice>
                </Toggle>
                {/* the checkbox is gone, so post the value the action reads. */}
                <input type="hidden" name="rush" value={rush ? "1" : "0"} />
              </Field>
            </div>
          </Panel>

          {/*
            The videos to edit. Both ways of handing them over, at once.

            Two rewrites got this wrong in the same way. First it was a raw
            footage / brand assets tab pair, where both tabs held the same
            dropzone one word apart, so the fastest path through the form was
            dropping a whole shoot into the brand's permanent shelf. Then it was
            source tiles — upload / drive / another link — which fixed that and
            introduced a new lie: it made an EITHER-OR out of something nobody
            does either-or. A shoot is four clips on this laptop plus the b-roll
            the client left in a drive folder, and a radio button says pick one.

            So there is no switch here at all. The dropzone is the card, the link
            row sits under a rule, and both post. That is fewer controls than
            either earlier version and it is the only one that can express what
            people actually have.
          */}
          <Panel title="the videos to edit">
            {/*
              Two boxes, same size, side by side.

              Three rewrites made this a choice — a tab pair, then source tiles,
              then a dropzone with a link field bolted under it — and every one
              was wrong in the same way: nobody picks one. The interviews are on
              this laptop and the b-roll is in the folder the client shared. So
              both are offered at once, and they are the same shape at the same
              size, because two halves of one question that look different read
              as a thing and an afterthought.

              The paste field is gone with them. It was a third way to say what
              these two already say, it needed a label column and an "add
              another", and what it produced — a url and a name — is exactly
              what the picker produces. Whatever comes back from either box
              lands in the one strip below.
            */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Dropzone
                fill
                silent
                onQueue={setQueue}
                folder={folder}
                label="drop videos here"
                hint="mp4, mov or folders · up to 500 MB each"
                accept="video/*,image/*,audio/*"
                browseLabel="browse files"
                onUploaded={stage("footage")}
              />

              {drivePickerReady ? (
                null
              ) : (
                /* no google cloud project on this deploy, so the picker cannot
                   exist. one paste field in the same box rather than nothing,
                   because a creator whose footage is in drive still has to be
                   able to hand it over. */
                <div className="flex h-full flex-col justify-center rounded-xl border border-dashed border-line bg-shell px-5 py-7 text-center">
                  <p className="text-[15px] font-bold tracking-[-0.01em]">
                    or paste a link
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-ink-50">
                    drive, dropbox, frame.io
                  </p>
                  <input
                    value={pastedLink}
                    onChange={(e) => setPastedLink(e.target.value)}
                    onBlur={() => {
                      const url = pastedLink.trim();
                      if (!url) return;
                      setPastedLink("");
                      setFootageLinks((prev) =>
                        prev.some((r) => r.url === url)
                          ? prev
                          : [...prev, { url, label: "" }]
                      );
                    }}
                    placeholder="paste a share link anyone can open"
                    className={`${shell} mt-3 h-11 w-full px-4 text-center text-[14px]`}
                  />
                </div>
              )}
            </div>

            {driveNote && (
              <p className="mt-3 text-[12.5px] font-semibold text-flame-dark">
                {driveNote}
              </p>
            )}

            {/* one strip, both sources. an uploaded clip and a drive folder are
                both "a thing the editor gets", and two lists in two places is
                how somebody loses count of what they actually attached. */}
            <AttachStrip
              files={stagedOf("footage")}
              links={footageLinks}
              queue={queue}
              onRemoveFile={unstage}
              onRemoveLink={(url: string) =>
                setFootageLinks((prev) => prev.filter((r) => r.url !== url))
              }
            />

            {/* the links post as the same repeated pairs `readLinks` has always
                read. no visible field means no visible field, not no value. */}
            {footageLinks
              .filter((row) => row.url.trim())
              .map((row) => (
                <span key={row.url}>
                  <input type="hidden" name="footage_url" value={row.url} />
                  <input type="hidden" name="footage_label" value={row.label} />
                </span>
              ))}
          </Panel>
        </div>

        {/*
          Step two: the direction.

          References and brand assets used to sit under the footage, which put
          four blocks and a page of scroll on step one while step two was a
          textarea and a lot of empty paper. The split that fixes it is also the
          truer one: step one is the job and the RAW MATERIAL, step two is what
          you want back — the brief, examples of it, and the brand's kit. A
          reference video and a logo are both instructions about how the cut
          should look; neither is footage to be cut.
        */}
        <div className={step === 1 ? "flex flex-col gap-5" : "hidden"}>
          <Panel title="the brief">
            <div className="relative">
              <textarea
                name="brief"
                maxLength={BRIEF_MAX}
                rows={7}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="what the videos are for, what to keep, where the hook is, the look you want and the format."
                className={`${shell} w-full resize-y px-3.5 py-3 pb-8 text-[14.5px] leading-[1.6]`}
              />
              <span className="pointer-events-none absolute bottom-4 right-3.5 text-[12px] tabular-nums text-ink-50">
                {brief.length} / {BRIEF_MAX}
              </span>
            </div>
          </Panel>

          {/*
            Brand assets, with the footage card's treatment.

            This was a compact dropzone squeezed into half a row next to
            references, on the reasoning that logos go over once per brand. That
            got the importance backwards. The brief is words and the references
            are two urls, but the brand kit is a PILE — a logo, two fonts, a
            music bed, six product shots — and half of it is already sitting in
            a drive folder the brand sent over. So it gets the full width and
            both doors: drop them, or pick the folder.
          */}
          <Panel title="brand assets" need>
            <p className="-mt-1 text-[13px] leading-[1.45] text-ink-50">
              logos, fonts, music, product shots. not the videos to edit.
              {canShelf && " kept on the brand deal, so every batch for it has them."}
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Dropzone
                fill
                silent
                onQueue={setAssetQueue}
                intakeRef={assetIntake}
                folder={canShelf ? `bank/${dealId}` : folder}
                label="drop brand assets here"
                hint="logos, fonts, music, product shots"
                accept="image/*,audio/*,video/*"
                browseLabel="browse files"
                onUploaded={canShelf ? toShelf("asset") : stage("asset")}
              />

              {/*
                Drive IMPORTS here, where the footage box links.

                A logo the editor cannot open is not a logo, and `drive.file`
                shares nothing with their google account — so a link to the
                brand's folder is a link that works for exactly one person.
                These are small files, so pulling the bytes through the browser
                and into the deal's own shelf costs nothing and means the kit
                sits with the brand rather than behind somebody's permissions. A
                500MB shoot is the opposite trade, which is why the footage box
                still hands over a url.
              */}
              {drivePickerReady ? (
                null
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-shell px-5 py-7 text-center">
                  <p className="text-[15px] font-bold tracking-[-0.01em]">
                    or drag the folder in
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-ink-50">
                    google drive picking is not switched on for this deploy
                  </p>
                </div>
              )}
            </div>

            <AttachStrip
              files={stagedOf("asset")}
              links={[]}
              queue={assetQueue}
              onRemoveFile={unstage}
              onRemoveLink={() => {}}
            />

            <ShelfList
              items={shelfOf("asset")}
              onRemove={offShelf}
              note="already on this brand deal. these ride along on their own."
            />
          </Panel>

          {/* the two small ones share a row. a doc brief is the same brief in
              another form and most people do not have one, so it stops taking a
              card's worth of the page to say so. */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* not optional. an editor with no example of the thing being asked
                for guesses, and the guess comes back as a revision round, which
                costs a day and a credit. */}
            <Panel title="references" need>
              <p className="-mt-1 mb-3 text-[13px] leading-[1.45] text-ink-50">
                one or two that look like what you want back.
              </p>
              <Links
                name="reference"
                urlPlaceholder="https://www.tiktok.com/..."
                labelPlaceholder="style, pacing"
                addLabel="+ add reference"
                stack
              />
            </Panel>

            <Panel
              title="the brief as a doc"
              tabs={
                <div className="flex flex-wrap items-center gap-2">
                  <Scope on={docScope === "job"} onClick={() => setDocScope("job")}>
                    this batch
                  </Scope>
                  <Scope
                    on={docScope === "brand"}
                    onClick={() => setDocScope("brand")}
                    disabled={!canShelf}
                  >
                    every batch
                  </Scope>
                </div>
              }
            >
              <p className="-mt-1 mb-3 text-[13px] leading-[1.45] text-ink-50">
                optional. if you already wrote it somewhere, hand that over
                instead of retyping it.
              </p>
              <Dropzone
                compact
                hideDone
                folder={docScope === "brand" ? `bank/${dealId}` : folder}
                label="drop a pdf, a doc, a script"
                disabled={docScope === "brand" && !canShelf}
                disabledNote="pick a brand deal on the job step to keep a doc on it."
                browseLabel="browse files"
                onUploaded={docScope === "brand" ? toShelf("doc") : stage("doc")}
              />
              <StagedList files={stagedOf("doc")} onRemove={unstage} />
              <ShelfList
                items={shelfOf("doc")}
                onRemove={offShelf}
                note="on this brand deal, on every batch"
              />
            </Panel>
          </div>
        </div>

        <div className={step === 2 ? "flex flex-col gap-5" : "hidden"}>
          <Panel
            title="review"
            hint={
              EDITOR_MARKET_ENABLED
                ? "cancel before an editor claims it and the credits come back."
                : "post it, then send your editor the link. nothing is charged."
            }
          >
            <dl className="divide-y divide-line">
              <Line label="brand deal" value={dealLabel} />
              <Line label="videos" value={String(videos)} />
              <Line label="kind" value={TIER_LABEL[tier]} />
              <Line
                label="turnaround"
                value={`${turnaroundHours(rush)} hours${rush ? " · rush" : ""}`}
              />
              <Line
                label="brief"
                value={
                  brief.trim()
                    ? `${brief.trim().slice(0, 80)}${brief.length > 80 ? "..." : ""}`
                    : "nothing written yet"
                }
              />
              <Line
                label="uploaded"
                value={
                  staged.length === 0
                    ? "nothing, links only"
                    : `${staged.length} file${staged.length === 1 ? "" : "s"}`
                }
              />
              {shelf.length > 0 && (
                <Line
                  label="from the brand"
                  value={`${shelf.length} file${shelf.length === 1 ? "" : "s"} on the deal`}
                />
              )}
            </dl>

            {/* what the editor treats as included at this tier. it used to sit
                in the rail, where it was read before the kind had been
                picked. */}
            <p className="mt-3.5 text-[12.5px] leading-[1.45] text-ink-50">
              {TIER_HINT[tier]}
            </p>
          </Panel>
        </div>
      </div>

      {/*
        The summary rail.

        It came back, and this time it is not four fields restated: it is the
        one thing that is true on every step and cannot be read off any of them
        — what this batch costs — plus the button that leaves the step. A footer
        per card put that button at the bottom of whichever card happened to be
        tallest; here it is in the same place on all three, next to the number
        it is about to spend.
      */}
      <Summary
        step={step}
        videos={videos}
        tier={tier}
        rush={rush}
        credits={credits}
        perVideo={perVideo}
        balance={balance}
        short={short}
        state={state}
        onBack={() => setStep((n) => Math.max(0, n - 1))}
        onNext={() => setStep((n) => Math.min(2, n + 1))}
      />
    </form>
  );
}

/* ------------------------------------------------------------ the pieces */

const shell =
  "rounded-xl border border-line bg-paper outline-none transition-colors focus:border-flame focus-within:border-flame";

/** A field's name. Sentence case and quiet, not the uppercase tracked caps the
 *  rest of the dashboard uses: this form is six labels stacked over six
 *  controls, and caps on every one of them shouts louder than the values. */
const fieldLabel = "text-[13px] font-medium text-ink-50";

function Stepper({ step, onGo }: { step: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex shrink-0 items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < step;
        const here = i === step;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              // only backwards. jumping ahead to review before there is a
              // brief to review is a step that can only disappoint.
              onClick={() => i < step && onGo(i)}
              disabled={i > step}
              className={`flex min-w-0 items-center gap-2 text-left ${i < step ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                  here || done
                    ? "bg-flame text-on-accent"
                    : "border border-line text-ink-50"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`truncate text-[13.5px] tracking-[-0.01em] ${
                  here ? "font-extrabold text-ink" : "font-semibold text-ink-50"
                }`}
              >
                {label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className={`h-px flex-1 ${done ? "bg-flame" : "bg-line"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One card on a step.
 *
 * No footer any more. Every card used to carry the price and the button that
 * left the step, which meant the one control somebody is looking for moved
 * down the page as the card above it grew. That job belongs to the rail, so
 * this is a heading, an optional control on the same line, and a body.
 */
function Panel({
  title,
  hint,
  need,
  tabs,
  children,
}: {
  title: string;
  hint?: string;
  /** part of a complete job, not an extra. says so on the heading. */
  need?: boolean;
  /** a switch that belongs to this card, sat on the heading line */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-paper px-5 py-5 shadow-card sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em]">{title}</h2>
        {need && (
          <span className="rounded-pill bg-ember px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-flame-dark">
            needed
          </span>
        )}
        {hint && (
          <p className="min-w-0 flex-1 text-[13px] leading-[1.45] text-ink-50">{hint}</p>
        )}
        {tabs && <div className="ml-auto shrink-0">{tabs}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * The brand deal, as a list of brands rather than a native `<select>`.
 *
 * A select cannot hold an image, and a creator running five deals recognises
 * the square before they have read a word of the name. It also cannot be
 * styled: the grey OS menu that dropped out of the old one was the one piece of
 * chrome on the page that belonged to no design at all.
 *
 * The value posts from a hidden input, so the server action reads `deal_id`
 * exactly as it always did.
 */
function DealPicker({
  deals,
  value,
  onChange,
}: {
  deals: PickerDeal[];
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const picked = deals.find((d) => d.id === value) ?? null;

  return (
    <div className="relative">
      <input type="hidden" name="deal_id" value={value} />
      <button
        type="button"
        aria-expanded={open}
        disabled={deals.length === 0}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-12 w-full items-center gap-2.5 rounded-xl border bg-paper pl-2 pr-3 text-left transition-colors ${
          open ? "border-flame" : "border-line hover:border-flame/45"
        }`}
      >
        {picked ? (
          <BrandMark name={picked.brandName} logo={picked.logo} size="sm" />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-line text-ink-50">
            <FolderMark />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-bold tracking-[-0.01em]">
            {picked ? picked.brandName : "no deals yet"}
          </span>
          {picked && (
            <span className="block truncate text-[12px] font-medium text-ink-50">
              {picked.name}
            </span>
          )}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`size-4 shrink-0 text-ink-50 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <>
          {/* a full-screen catcher rather than a document listener: it closes on
              the same click that lands anywhere else, with nothing to unbind. */}
          <button
            type="button"
            aria-label="close the deal picker"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute left-0 top-[calc(100%+6px)] z-30 max-h-[300px] w-full min-w-[280px] overflow-y-auto rounded-xl border border-line bg-paper p-1.5 shadow-card">
            {deals.map((d) => (
              <DealRow
                key={d.id}
                on={value === d.id}
                onClick={() => {
                  onChange(d.id);
                  setOpen(false);
                }}
                title={d.brandName}
                sub={d.name}
                mark={<BrandMark name={d.brandName} logo={d.logo} size="sm" />}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DealRow({
  on,
  onClick,
  title,
  sub,
  mark,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
  mark: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors ${
        on ? "bg-ember" : "hover:bg-shell"
      }`}
    >
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold tracking-[-0.01em]">
          {title}
        </span>
        <span className="block truncate text-[12px] font-medium text-ink-50">{sub}</span>
      </span>
    </button>
  );
}

/** the deal picker's empty state: a dashed square where a brand mark goes. */
function FolderMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}


/**
 * What the batch is and what it costs, in a rail that follows the page down.
 *
 * The three lines above the total are the settings that MOVE the total, and
 * nothing else: brand deal and brief are on screen a few inches to the left and
 * restating them was what made the old rail mostly empty paper. Sticky from
 * `lg`, because from there the form is a column beside it and the price is the
 * one thing that should never scroll away from the button that spends it.
 */
function Summary({
  step,
  videos,
  tier,
  rush,
  credits,
  perVideo,
  balance,
  short,
  state,
  onBack,
  onNext,
}: {
  step: number;
  videos: number;
  tier: JobTier;
  rush: boolean;
  credits: number;
  perVideo: number;
  balance: number;
  short: boolean;
  state: EditingState;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <aside className="lg:sticky lg:top-4">
      <div className="rounded-2xl border border-line bg-paper px-6 py-5 shadow-card">
        <h2 className="text-[18px] font-extrabold tracking-[-0.02em]">job summary</h2>

        <ul className="mt-4 space-y-3">
          <SumLine glyph={<FilmMark />}>
            {videos} video{videos === 1 ? "" : "s"}
          </SumLine>
          <SumLine glyph={<CutMark />}>{TIER_LABEL[tier]}</SumLine>
          <SumLine glyph={<ClockMark />}>
            {turnaroundHours(rush)} hour delivery
          </SumLine>
        </ul>

        {EDITOR_MARKET_ENABLED && (
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-extrabold tracking-[-0.01em]">total</span>
            <span
              className={`text-[22px] font-extrabold tabular-nums tracking-[-0.02em] ${
                short ? "text-flame-dark" : "text-flame"
              }`}
            >
              {creditsLabel(credits)}
            </span>
          </div>
          {/* the sum, not just the total. the per-video number is what a
              creator compares against what they would pay anywhere else. */}
          <p className="mt-1.5 flex items-baseline justify-between gap-3 text-[13px] tabular-nums text-ink-50">
            <span>
              {videos} × ${perVideo}
            </span>
            <span className={short ? "font-bold text-flame-dark" : ""}>
              {creditsLabel(balance)} left
            </span>
          </p>
        </div>
        )}

        {short && (
          <p className="mt-3 rounded-xl bg-ember px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-flame-dark">
            not enough credits for this job.{" "}
            <Link href="/editing/credits" className="font-semibold underline">
              top up first
            </Link>
            , then come back and post it.
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          {step < 2 ? (
            <button
              type="button"
              onClick={onNext}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-pill bg-flame text-[14.5px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
            >
              {step === 0 ? "continue to the brief" : "continue to review"}
              <Arrow />
            </button>
          ) : (
            <PostButton />
          )}

          {step > 0 && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-11 w-full items-center justify-center rounded-pill border border-line text-[14px] font-bold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark"
            >
              back
            </button>
          )}
        </div>

        {(state.error ?? state.ok) && (
          <p className="mt-3 text-center">
            <Note state={state} />
          </p>
        )}
      </div>
    </aside>
  );
}

function SumLine({ glyph, children }: { glyph: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 text-[14.5px] font-semibold">
      <span className="shrink-0 text-ink-50">{glyph}</span>
      {children}
    </li>
  );
}

/** The submit, full width in the rail. `Submit` from form.tsx is `shrink-0`
 *  with its own padding, which is right on a footer row and wrong here. */
function PostButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 w-full items-center justify-center rounded-pill bg-flame text-[14.5px] font-bold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
    >
      {pending ? "posting" : "post the job"}
    </button>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="size-[17px]" aria-hidden="true">
      <path
        d="M5 12h13M12.5 6.2 18.5 12l-6 5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FilmMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" />
    </svg>
  );
}

function CutMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="6" cy="18" r="2.6" />
        <circle cx="6" cy="6" r="2.6" />
        <path d="M8.2 16.4 19 5.5M8.2 7.6 19 18.5" />
      </g>
    </svg>
  );
}

function ClockMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <circle cx="12" cy="12" r="8.4" />
        <path d="M12 7.4V12l3 2" />
      </g>
    </svg>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className={`${fieldLabel} mb-1.5`}>{label}</p>
      {children}
    </div>
  );
}

/** A two-up segmented control, the height of the inputs beside it. */
function Toggle({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-12 items-center gap-1 rounded-xl border border-line bg-paper p-1">
      {children}
    </div>
  );
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-full items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13.5px] font-bold tracking-[-0.01em] transition-colors ${
        on ? "bg-flame text-on-accent" : "text-ink-50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** The price hanging off a choice, quieter than the word it follows. */
function Sub({ children }: { children: ReactNode }) {
  return (
    <span className="text-[12px] font-semibold tabular-nums opacity-70">
      {children}
    </span>
  );
}

function Step({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-12 items-center justify-center border border-line bg-paper text-[18px] font-bold text-ink-70 transition-colors first:rounded-l-xl last:rounded-r-xl hover:text-flame"
    >
      {children}
    </button>
  );
}

/** the two-way switch on the doc uploader. not a checkbox: "for the brand" is
 *  a different destination, not an extra setting on the same one. */
function Scope({
  on,
  onClick,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`rounded-pill border px-3 py-1 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        on ? "border-flame bg-ember text-flame-dark" : "border-line text-ink-50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Everything of one kind the editor gets, in one strip.
 *
 * An uploaded clip and a drive folder are both "a thing the editor gets", and
 * splitting them into a list under the dropzone and a list under the picker is
 * how somebody loses count of what they actually attached. Same tile, same
 * size, one row that wraps.
 */
function AttachStrip({
  files,
  links,
  queue,
  onRemoveFile,
  onRemoveLink,
}: {
  files: Staged[];
  links: LinkItem[];
  /** what is still going up, or failed. finished rows are in `files`. */
  queue: UploadRow[];
  onRemoveFile: (path: string) => void;
  onRemoveLink: (url: string) => void;
}) {
  const real = links.filter((row) => row.url.trim());
  const busy = queue.filter((row) => row.status !== "done");
  if (files.length === 0 && real.length === 0 && busy.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-wrap gap-2.5">
      {/* in flight first, because it is the thing that is changing. the tile is
          the same tile it becomes when it lands, so nothing jumps: the bar
          drains off it and the × appears. */}
      {busy.map((row) => (
        <Tile
          key={row.key}
          name={row.name}
          note={
            row.status === "failed"
              ? (row.error ?? "failed")
              : row.status === "waiting"
                ? "queued"
                : `${row.pct}%`
          }
          bad={row.status === "failed"}
        >
          <QueueThumb row={row} />
        </Tile>
      ))}

      {files.map((file) => (
        <Tile
          key={file.path}
          name={file.name}
          note={humanSize(file.size)}
          onRemove={() => onRemoveFile(file.path)}
        >
          <Thumb file={file} />
        </Tile>
      ))}

      {real.map((row) => (
        <Tile
          key={row.url}
          name={row.label || hostOf(row.url)}
          note="link"
          onRemove={() => onRemoveLink(row.url)}
        >
          <span className="flex size-full items-center justify-center bg-paper">
            <LinkGlyph />
          </span>
        </Tile>
      ))}
    </ul>
  );
}

/** "drive.google.com" out of a url, for a link nobody named. `URL` throws on
 *  anything it does not like, and a pasted string is exactly that. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

function Tile({
  name,
  note,
  bad,
  onRemove,
  children,
}: {
  name: string;
  note: string;
  bad?: boolean;
  /** left out while a file is still going up: there is nothing to remove yet
   *  and no way to abort the request. */
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <li className="group/tile relative w-[104px]">
      <span
        className={`relative block aspect-[4/5] overflow-hidden rounded-xl border bg-shell ${
          bad ? "border-flame" : "border-line"
        }`}
      >
        {children}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`remove ${name}`}
            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-pill bg-ink/60 text-paper opacity-0 transition-opacity hover:bg-ink group-hover/tile:opacity-100 focus-visible:opacity-100"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
              <path
                d="m6 6 12 12M18 6 6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </span>
      <span className="mt-1.5 block truncate text-[12.5px] font-semibold" title={name}>
        {name}
      </span>
      <span
        className={`block truncate text-[11.5px] tabular-nums ${
          bad ? "font-semibold text-flame-dark" : "text-ink-50"
        }`}
        title={note}
      >
        {note}
      </span>
    </li>
  );
}

/**
 * A tile that is still filling up.
 *
 * The frame is drawn from the picked file's own `object:` url, so it is there
 * before a byte has gone out — the point being that you can see WHICH clip is
 * at 40%, not just that something is. Everything above the fill line is dimmed
 * and the flame rises through it, which is the whole animation: no spinner, no
 * second copy of the word "uploading" anywhere on the page.
 */
function QueueThumb({ row }: { row: UploadRow }) {
  const family = fileFamily({ name: row.name });
  const pct = row.status === "failed" ? 100 : row.pct;

  return (
    <>
      {row.preview && family === "video" ? (
        <video
          src={`${row.preview}#t=0.6`}
          muted
          playsInline
          preload="metadata"
          className="size-full object-cover"
        />
      ) : row.preview && family === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.preview} alt="" className="size-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center text-[12px] font-bold uppercase tracking-[0.08em] text-ink-50">
          {family}
        </span>
      )}

      {/* the unfilled part is the veil. it retreats downward as the bar rises,
          so the picture arriving IS the progress. */}
      <span
        className={`absolute inset-x-0 top-0 transition-[height] duration-200 ${
          row.status === "failed" ? "bg-flame/25" : "bg-paper/70"
        }`}
        style={{ height: `${100 - pct}%` }}
      />
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-line/70">
        <span
          className={`block h-full transition-[width] duration-200 ${
            row.status === "failed" ? "bg-flame-dark" : "bg-flame"
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-ink-50" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M10.5 13.5a3.4 3.4 0 0 0 5 .3l2.4-2.4a3.4 3.4 0 0 0-4.8-4.8l-1.4 1.4" />
        <path d="M13.5 10.5a3.4 3.4 0 0 0-5-.3l-2.4 2.4a3.4 3.4 0 0 0 4.8 4.8l1.4-1.4" />
      </g>
    </svg>
  );
}

/**
 * What has landed, as poster frames rather than a list of filenames.
 *
 * Four clips off one shoot are four near-identical names and four different
 * first frames, so the frame is the only thing on the row that answers "is that
 * the right one". The preview is the browser's own `object:` url for the file
 * that was just picked, so this costs no request: the bucket is private and the
 * alternative was a signed url per tile for a picture only this session looks
 * at.
 *
 * Removing one takes the object back out of storage, because nothing else ever
 * will: no row was written, so an abandoned form would leave it orphaned
 * forever.
 */
function StagedList({
  files,
  onRemove,
}: {
  files: Staged[];
  onRemove: (path: string) => void;
}) {
  if (files.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-wrap gap-2.5">
      {files.map((file) => (
        <li key={file.path} className="group/tile relative w-[104px]">
          <span className="relative block aspect-[4/5] overflow-hidden rounded-xl border border-line bg-shell">
            <Thumb file={file} />
            <button
              type="button"
              onClick={() => onRemove(file.path)}
              aria-label={`remove ${file.name}`}
              className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-pill bg-ink/60 text-paper opacity-0 transition-opacity hover:bg-ink group-hover/tile:opacity-100 focus-visible:opacity-100"
            >
              <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden="true">
                <path
                  d="m6 6 12 12M18 6 6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </span>
          <span className="mt-1.5 block truncate text-[12.5px] font-semibold" title={file.name}>
            {file.name}
          </span>
          <span className="block text-[11.5px] text-ink-50">{humanSize(file.size)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One tile's picture.
 *
 * A muted `<video>` with a `#t=` media fragment is how the rest of the product
 * draws a clip's poster frame (`ClipThumb` in autoposting does the same), and
 * it works on an `object:` url exactly as it does on a signed one. An image is
 * an image. Anything else — a pdf brief, a font file — has no frame to show, so
 * it gets its family word on the shell rather than a broken box.
 */
function Thumb({ file }: { file: Staged }) {
  const family = fileFamily(file);

  if (file.preview && family === "video") {
    return (
      <video
        src={`${file.preview}#t=0.6`}
        muted
        playsInline
        preload="metadata"
        className="size-full object-cover"
      />
    );
  }

  if (file.preview && family === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={file.preview} alt="" className="size-full object-cover" />;
  }

  return (
    <span className="flex size-full items-center justify-center text-[12px] font-bold uppercase tracking-[0.08em] text-ink-50">
      {family}
    </span>
  );
}

/** what is already on the brand deal. shown here rather than only on the deal
 *  page so the answer to "did I upload the logo yet" is on the screen where the
 *  question comes up. */
function ShelfList({
  items,
  onRemove,
  note,
}: {
  items: DealAsset[];
  onRemove: (asset: DealAsset) => void;
  note: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="mt-2">
      <p className="text-[12px] text-ink-50">{note}</p>
      <ul className="mt-1 space-y-1.5">
        {items.map((asset) => (
          <li key={asset.id} className="flex min-w-0 items-baseline gap-2 text-[13px]">
            <span className="shrink-0 text-ink-50">{fileFamily(asset)}</span>
            {asset.signedUrl ? (
              <a
                href={asset.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate font-semibold text-ink-70 underline decoration-line underline-offset-2 transition-colors hover:text-flame-dark"
              >
                {asset.name}
              </a>
            ) : (
              <span className="truncate font-semibold text-ink-70">{asset.name}</span>
            )}
            <span className="shrink-0 text-ink-50">{humanSize(asset.size_bytes)}</span>
            <button
              type="button"
              onClick={() => onRemove(asset)}
              className="ml-auto shrink-0 font-semibold text-ink-50 transition-colors hover:text-flame"
            >
              remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13.5px] text-ink-50">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[14px] font-bold">{value}</dd>
    </div>
  );
}

/**
 * A growable list of url + label rows, posting as repeated `<name>_url` /
 * `<name>_label` pairs the server zips back together. Controlled on purpose:
 * removing a middle row from uncontrolled inputs leaves the old defaultValues
 * sitting in the wrong rows.
 */
function Links({
  label,
  name,
  urlPlaceholder,
  labelPlaceholder = "what it is",
  hint,
  withLabel = true,
  addLabel = "+ add another link",
  stack,
  rows: outer,
  onRows,
}: {
  label?: string;
  name: string;
  urlPlaceholder: string;
  labelPlaceholder?: string;
  hint?: string;
  /** the second, narrower field. off where a url is the whole answer. */
  withLabel?: boolean;
  addLabel?: string;
  /** url over label instead of beside it, for a half-width card. */
  stack?: boolean;
  /** lift the rows when something outside has to write into them, like the
   *  drive picker. left out, the list owns its own. */
  rows?: LinkItem[];
  onRows?: (next: LinkItem[]) => void;
}) {
  const [own, setOwn] = useState<LinkItem[]>([{ url: "", label: "" }]);
  const rows = outer ?? own;
  const setRows = (next: LinkItem[]) => (onRows ? onRows(next) : setOwn(next));

  const set = (i: number, patch: Partial<LinkItem>) =>
    setRows(rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <div>
      {(label ?? hint) && (
        <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
          {label && <span className={fieldLabel}>{label}</span>}
          {hint && <span className="text-[12px] text-ink-50">{hint}</span>}
        </p>
      )}
      <div className={stack ? "space-y-2.5" : "space-y-2"}>
        {rows.map((row, i) => (
          <div
            key={i}
            className={
              stack
                ? "flex flex-col gap-2"
                : "flex flex-wrap items-center gap-2"
            }
          >
            <input
              name={`${name}_url`}
              value={row.url}
              onChange={(e) => set(i, { url: e.target.value })}
              placeholder={urlPlaceholder}
              className={`${shell} h-12 min-w-[200px] flex-1 px-4 text-[14.5px]`}
            />
            {withLabel ? (
              <input
                name={`${name}_label`}
                value={row.label}
                onChange={(e) => set(i, { label: e.target.value })}
                placeholder={labelPlaceholder}
                className={`${shell} h-12 px-4 text-[14.5px] ${stack ? "w-full" : "w-[200px]"}`}
              />
            ) : (
              // still posted. `readLinks` zips urls to labels by index, so a
              // missing input would shift every later row's label onto the
              // wrong url the moment one list had them and another did not.
              <input type="hidden" name={`${name}_label`} value={row.label} />
            )}
            {/* add sits on the last row, remove on every other one. one slot
                at the end of the row either way, so the column of controls
                does not shuffle sideways as rows come and go. */}
            {i === rows.length - 1 ? (
              <button
                type="button"
                onClick={() => setRows([...rows, { url: "", label: "" }])}
                className={`whitespace-nowrap px-1 text-[13.5px] font-bold text-flame transition-colors hover:text-flame-dark ${
                  stack ? "self-start" : "shrink-0"
                }`}
              >
                {addLabel}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className={`whitespace-nowrap px-1 text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-flame-dark ${
                  stack ? "self-start" : "shrink-0"
                }`}
              >
                remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
