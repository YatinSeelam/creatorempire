"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { brandLogo } from "@/lib/brand-catalog";
import { bundleLabel, type EditJob, type JobStatus } from "@/lib/editing";
import { shortDate } from "@/lib/money";

export type RequestRow = {
  job: EditJob;
  deliverableCount: number;
  editorName: string | null;
};

/**
 * The creator's list of edit jobs.
 *
 * Four stages, not five. The mock this follows opens with a Draft step and a
 * separate manager review, and neither exists here: a job is posted the moment
 * it is created, and the person who approves a cut is the creator looking at
 * this page. Drawing a Draft node everybody skips, or a review step somebody
 * else owns, would be a progress bar describing a product we do not have.
 *
 * Revisions is not a fifth node either. It is the review node lit differently,
 * because that is what it is: the cut came back and went out again.
 */
const STAGES = ["posted", "claimed", "review", "done"] as const;

/** Which node a status is standing on, and how the trail behind it reads. */
const STAGE_OF: Record<JobStatus, number> = {
  open: 0,
  claimed: 1,
  delivered: 2,
  revisions: 2,
  approved: 3,
  cancelled: 0,
};

type Tone = "ink" | "flame" | "live";

/**
 * One accent and one green, not the mock's four hues.
 *
 * The product has exactly one accent colour and one green, and a white-label
 * org repaints the accent. A blue for one status and a purple for another would
 * be two colours nothing else in the app uses and nobody can rebrand.
 */
const TONE_OF: Record<JobStatus, Tone> = {
  open: "ink",
  claimed: "ink",
  // the two that are waiting on the creator: the only ones worth shouting.
  delivered: "flame",
  revisions: "flame",
  approved: "live",
  cancelled: "ink",
};

const CHIP: Record<Tone, string> = {
  ink: "bg-shell text-ink-70",
  flame: "bg-ember text-flame-dark",
  live: "bg-live-soft text-live",
};

const DOT: Record<Tone, string> = {
  ink: "bg-ink",
  flame: "bg-flame",
  live: "bg-live",
};

const LABEL: Record<JobStatus, string> = {
  open: "in the market",
  claimed: "claimed",
  delivered: "your review",
  revisions: "revisions",
  approved: "completed",
  cancelled: "cancelled",
};

const TABS: { value: "all" | JobStatus; label: string }[] = [
  { value: "all", label: "all" },
  { value: "open", label: "in the market" },
  { value: "claimed", label: "claimed" },
  { value: "delivered", label: "your review" },
  { value: "revisions", label: "revisions" },
  { value: "approved", label: "completed" },
  { value: "cancelled", label: "cancelled" },
];

/** What the row says under its chip, in the words of whoever is holding it. */
function note(row: RequestRow) {
  const { job, editorName, deliverableCount } = row;
  switch (job.status) {
    case "open":
      return "visible to editors";
    case "claimed":
      return editorName ? `${editorName} is on it` : "an editor is on it";
    case "delivered":
      return "waiting on you";
    case "revisions":
      return "back with the editor";
    case "approved":
      return `${deliverableCount} cut${deliverableCount === 1 ? "" : "s"} delivered`;
    default:
      return "no longer running";
  }
}

/** The one thing to press, worded for the state the job is actually in. */
function action(status: JobStatus) {
  if (status === "delivered") return "review cuts";
  if (status === "approved") return "view final";
  return "open request";
}

/**
 * The last thing that actually happened to this job, and when.
 *
 * The column is headed "updated", so it has to be the moving timestamp. It
 * used to print created_at under the word "posted" for every row, which meant
 * an approved job from last week and one approved an hour ago read identically
 * and both claimed to be about their posting.
 */
function stamp(job: EditJob): { at: string; label: string } {
  switch (job.status) {
    case "approved":
      return { at: job.approved_at ?? job.updated_at, label: "approved" };
    case "delivered":
      return { at: job.delivered_at ?? job.updated_at, label: "delivered" };
    case "revisions":
      return {
        at: job.revision_requested_at ?? job.updated_at,
        label: "sent back",
      };
    case "claimed":
      return { at: job.claimed_at ?? job.updated_at, label: "claimed" };
    case "cancelled":
      return { at: job.updated_at, label: "cancelled" };
    default:
      return { at: job.created_at, label: "posted" };
  }
}

export function EditingRequests({ rows }: { rows: RequestRow[] }) {
  const [tab, setTab] = useState<"all" | JobStatus>("all");

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.job.status, (by.get(r.job.status) ?? 0) + 1);
    return by;
  }, [rows]);

  // a tab that can only ever say nothing is a tab worth not drawing. cancelled
  // is the usual absentee, but a creator who has never had a revision should
  // not be looking at a revisions tab either.
  const tabs = TABS.filter(
    (t) => t.value === "all" || (counts.get(t.value) ?? 0) > 0
  );

  const shown = useMemo(
    () => (tab === "all" ? rows : rows.filter((r) => r.job.status === tab)),
    [rows, tab]
  );

  return (
    <div className="flex flex-col gap-5 lg:min-h-0 lg:flex-1">
      <div className="flex shrink-0 items-center gap-6 overflow-x-auto border-b border-line">
        {tabs.map((t) => {
          const on = tab === t.value;
          const n = t.value === "all" ? rows.length : (counts.get(t.value) ?? 0);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-current={on ? "page" : undefined}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-3 text-[14.5px] tracking-[-0.01em] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-flame ${
                on
                  ? "border-flame font-extrabold text-ink"
                  : "border-transparent font-semibold text-ink-50 hover:text-ink"
              }`}
            >
              {t.label}
              <span
                className={`rounded-pill px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums ${
                  on ? "bg-ember text-flame" : "bg-shell text-ink-50"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* the four words that explain the whole product, once, at the top. no
          "learn more": there is no page behind it and a link that goes nowhere
          costs more trust than the sentence buys. */}
      <p className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-line bg-paper px-5 py-3.5 text-[13.5px] text-ink-50 shadow-card">
        <span className="font-bold text-ink">how it works</span>
        <span aria-hidden="true">·</span>
        post the batch → an editor claims it → they deliver → you approve or ask
        for changes
      </p>

      {/* the list is what scrolls, not the window. the tabs and the one-line
          explainer above it are fixed points, and a page that moved them to
          show row six would be moving the way you filter to show what you
          filtered. */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-card lg:min-h-0 lg:flex-1">
        {/* column headings only where there are columns. under lg every row
            stacks and a header would be labelling a layout that is not there. */}
        <div className="hidden shrink-0 items-center gap-4 border-b border-line px-5 py-3 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-50 lg:flex">
          <span className="min-w-0 flex-1">request</span>
          <span className="w-[150px] shrink-0">status</span>
          <span className="w-[190px] shrink-0">progress</span>
          <span className="w-[120px] shrink-0">updated</span>
          <span className="w-[130px] shrink-0 text-right">action</span>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {shown.length === 0 ? (
            <p className="px-5 py-12 text-center text-[14px] text-ink-50">
              nothing in that view.
            </p>
          ) : (
            shown.map((r) => <RequestLine key={r.job.id} row={r} />)
          )}
        </div>
      </div>
    </div>
  );
}

function RequestLine({ row }: { row: RequestRow }) {
  const { job, deliverableCount } = row;
  const tone = TONE_OF[job.status];
  const at = STAGE_OF[job.status];
  const dead = job.status === "cancelled";
  // approved is the end of the line, not a place the job is standing and
  // waiting. a hollow ring on the last node read as "done hasn't happened".
  const finished = job.status === "approved";
  const when = stamp(job);

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <div className="flex min-w-[240px] flex-1 items-center gap-3.5">
        <BrandMark
          name={job.brand_name ?? job.title}
          logo={brandLogo({
            logo_key: job.brand_logo_key,
            logo_url: job.brand_logo_url,
          })}
          size="lg"
        />
        <div className="min-w-0">
          {job.brand_name && (
            <p className="truncate text-[11.5px] font-bold uppercase tracking-[0.12em] text-ink-50">
              {job.brand_name}
            </p>
          )}
          <Link
            href={`/editing/${job.id}`}
            className="block truncate text-[15px] font-bold tracking-[-0.015em] transition-colors hover:text-flame"
          >
            {job.title}
          </Link>
          <p className="mt-1 truncate text-[12.5px] text-ink-50">
            {bundleLabel(job)}
            {deliverableCount > 0 &&
              ` · ${deliverableCount} of ${job.video_count} back`}
          </p>
        </div>
      </div>

      <div className="w-[150px] shrink-0">
        <span
          className={`inline-flex rounded-pill px-2.5 py-1 text-[12.5px] font-bold ${CHIP[tone]}`}
        >
          {LABEL[job.status]}
        </span>
        <p className="mt-1.5 truncate text-[12.5px] text-ink-50">{note(row)}</p>
      </div>

      <div className="w-[190px] shrink-0">
        {dead ? (
          <p className="text-[12.5px] text-ink-50">stopped</p>
        ) : (
          <Stepper at={at} tone={tone} done={finished} />
        )}
      </div>

      <div className="w-[120px] shrink-0">
        <p className="text-[13px] font-semibold">{shortDate(when.at)}</p>
        <p className="mt-0.5 truncate text-[12px] text-ink-50">
          {job.sla_at && (job.status === "claimed" || job.status === "revisions")
            ? `due ${shortDate(job.sla_at)}`
            : when.label}
        </p>
      </div>

      <div className="w-[130px] shrink-0 text-right">
        <Link
          href={`/editing/${job.id}`}
          className={`inline-flex h-9 items-center rounded-pill px-4 text-[13.5px] font-bold transition-colors ${
            tone === "flame"
              ? "bg-flame text-on-accent hover:bg-flame-dark"
              : "border border-line text-ink-70 hover:border-flame hover:text-flame-dark"
          }`}
        >
          {action(job.status)}
        </Link>
      </div>
    </div>
  );
}

/**
 * Four nodes and the line between them.
 *
 * Everything behind the current stage is filled, the current one is a ring, and
 * what is ahead is a hairline. The labels are under the nodes rather than in a
 * tooltip: a progress bar you have to hover to read is a decoration.
 */
function Stepper({ at, tone, done }: { at: number; tone: Tone; done?: boolean }) {
  return (
    <div className="flex items-start">
      {STAGES.map((stage, i) => {
        const passed = i < at || (done === true && i === at);
        const here = i === at && done !== true;
        return (
          <div key={stage} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              {/* the trail into this node, drawn by the node so the first one
                  has none and nothing has to be positioned absolutely */}
              <span
                className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : passed || here ? DOT[tone] : "bg-line"}`}
              />
              <span
                className={`size-2.5 shrink-0 rounded-full ${
                  passed
                    ? DOT[tone]
                    : here
                      ? `bg-paper ring-2 ${tone === "live" ? "ring-live" : tone === "flame" ? "ring-flame" : "ring-ink"}`
                      : "bg-line"
                }`}
              />
              <span
                className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? "opacity-0" : passed ? DOT[tone] : "bg-line"}`}
              />
            </div>
            <span
              className={`mt-1.5 truncate text-[10.5px] tracking-[-0.005em] ${
                passed || here ? "font-bold text-ink-70" : "text-ink-50"
              }`}
            >
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}
