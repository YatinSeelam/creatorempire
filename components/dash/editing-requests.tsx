"use client";

import Link from "next/link";
import { useState } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { brandLogo } from "@/lib/brand-catalog";
import { type EditJob } from "@/lib/editing";
import { handoffUrl } from "@/lib/editing-handoff";
import { shortDate } from "@/lib/money";

export type RequestRow = {
  job: EditJob;
  deliverableCount: number;
  link: { token: string; views: number; live: boolean } | null;
};

/**
 * Every batch, one row each.
 *
 * This was a marketplace list: tabs for "in the market" and "claimed", a
 * progress bar with a `claimed` node, a banner explaining that an editor picks
 * your job up off a board. None of that happens on this deploy. A batch here
 * has one life — you write it, you send the link, the cut comes back, you mark
 * it done — and every column now answers a question from inside that life.
 *
 * The row's own action is COPY, not open. The link is the product, the list is
 * where you go to send it, and making somebody open a job to reach a url they
 * are about to paste into discord was the whole trip for nothing.
 */

/** Where a batch actually is, ignoring the marketplace statuses underneath. */
type State = "done" | "cut" | "sent" | "draft" | "dead";

function stateOf(row: RequestRow): State {
  const { job, deliverableCount, link } = row;
  if (job.status === "cancelled") return "dead";
  if (job.status === "approved") return "done";
  if (deliverableCount > 0) return "cut";
  return link?.live ? "sent" : "draft";
}

const WORD: Record<State, string> = {
  draft: "no link yet",
  sent: "with the editor",
  cut: "cut is in",
  done: "done",
  dead: "cancelled",
};

/** Filled black is the one waiting on you. Everything else is quiet. */
const CHIP: Record<State, string> = {
  draft: "border-line text-ink-50",
  sent: "border-line text-ink",
  cut: "border-ink bg-ink text-paper",
  done: "border-line text-ink-50",
  dead: "border-line text-ink-50 line-through",
};

const TABS: { value: "all" | State; label: string }[] = [
  { value: "all", label: "all" },
  { value: "sent", label: "with the editor" },
  { value: "cut", label: "cut is in" },
  { value: "done", label: "done" },
  { value: "dead", label: "cancelled" },
];

/** The last thing that happened, under the column that says "updated". */
function stamp(job: EditJob): { at: string; label: string } {
  if (job.approved_at) return { at: job.approved_at, label: "approved" };
  if (job.delivered_at) return { at: job.delivered_at, label: "cut filed" };
  if (job.status === "cancelled") return { at: job.updated_at, label: "cancelled" };
  return { at: job.created_at, label: "posted" };
}

export function EditingRequests({ rows }: { rows: RequestRow[] }) {
  const [tab, setTab] = useState<"all" | State>("all");

  const withState = rows.map((r) => ({ row: r, state: stateOf(r) }));
  const counts = new Map<State, number>();
  for (const r of withState) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);

  // a tab that can only ever say nothing is a tab worth not drawing.
  const tabs = TABS.filter(
    (t) => t.value === "all" || (counts.get(t.value) ?? 0) > 0
  );
  const shown =
    tab === "all" ? withState : withState.filter((r) => r.state === tab);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((t) => {
          const on = tab === t.value;
          const n = t.value === "all" ? rows.length : (counts.get(t.value) ?? 0);
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              aria-pressed={on}
              className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                on ? "bg-ink text-paper" : "text-ink-50 hover:text-ink"
              }`}
            >
              {t.label} <span className="tabular-nums opacity-60">{n}</span>
            </button>
          );
        })}
      </div>

      <section className="rounded-lg border border-line bg-paper">
        <div className="hidden items-center gap-4 border-b border-line px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-50 lg:flex">
          <span className="min-w-0 flex-1">batch</span>
          <span className="w-[130px] shrink-0">state</span>
          <span className="w-[110px] shrink-0">link</span>
          <span className="w-[110px] shrink-0">updated</span>
          <span className="w-[140px] shrink-0 text-right">action</span>
        </div>

        {shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-ink-50">
            nothing in that view.
          </p>
        ) : (
          shown.map(({ row, state }) => (
            <Row key={row.job.id} row={row} state={state} />
          ))
        )}
      </section>
    </div>
  );
}

function Row({ row, state }: { row: RequestRow; state: State }) {
  const { job, deliverableCount, link } = row;
  const when = stamp(job);

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex min-w-[220px] flex-1 items-center gap-2.5">
        <BrandMark
          name={job.brand_name ?? job.title}
          logo={brandLogo({
            logo_key: job.brand_logo_key,
            logo_url: job.brand_logo_url,
          })}
          size="sm"
        />
        <div className="min-w-0">
          <Link
            href={`/editing/${job.id}`}
            className="block truncate text-[13.5px] font-bold tracking-[-0.01em] transition-colors hover:underline"
          >
            {job.title}
          </Link>
          <p className="truncate text-[11.5px] text-ink-50">
            {job.brand_name ? `${job.brand_name} · ` : ""}
            {job.video_count} video{job.video_count === 1 ? "" : "s"}
            {deliverableCount > 0
              ? ` · ${deliverableCount} back`
              : ""}
          </p>
        </div>
      </div>

      <div className="w-[130px] shrink-0">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-[11.5px] font-semibold ${CHIP[state]}`}
        >
          {WORD[state]}
        </span>
      </div>

      <div className="w-[110px] shrink-0 text-[11.5px] text-ink-50">
        {!link
          ? "none"
          : !link.live
            ? "off"
            : link.views > 0
              ? `opened ${link.views}×`
              : "not opened"}
      </div>

      <div className="w-[110px] shrink-0">
        <p className="text-[12px] font-semibold">{shortDate(when.at)}</p>
        <p className="truncate text-[11px] text-ink-50">{when.label}</p>
      </div>

      <div className="flex w-[140px] shrink-0 items-center justify-end gap-2">
        {link?.live && <CopyButton token={link.token} />}
        <Link
          href={`/editing/${job.id}`}
          className="inline-flex h-7 items-center rounded-md border border-line px-2.5 text-[11.5px] font-semibold text-ink-50 transition-colors hover:border-ink hover:text-ink"
        >
          open
        </Link>
      </div>
    </div>
  );
}

/**
 * Copy the handoff url without leaving the list.
 *
 * `navigator.clipboard` can be missing on an insecure origin, so a failure is
 * swallowed and the label simply does not change — the job page has the same
 * url in a selectable field.
 */
function CopyButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(handoffUrl(token));
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // no clipboard permission. the job page has the url in a field.
        }
      }}
      className="inline-flex h-7 shrink-0 items-center rounded-md bg-ink px-2.5 text-[11.5px] font-bold text-paper transition-colors hover:bg-ink/85"
    >
      {copied ? "copied" : "copy link"}
    </button>
  );
}
