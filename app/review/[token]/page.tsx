import type { Metadata } from "next";
import { BrandMark } from "@/components/dash/brand-mark";
import { VerdictForm } from "@/components/review/verdict-form";
import { brandLogo } from "@/lib/brand-catalog";
import {
  VERDICT_LABEL,
  reviewerName,
  type ReviewVerdict,
} from "@/lib/editing-review";
import { loadReviewRoom, type RoomCut } from "@/lib/editing-review-server";
import { ago, shortDate } from "@/lib/money";

/**
 * The client review room, `ugcflows.com/review/<token>`.
 *
 * Whoever holds this url is the creator's campaign manager, and they have no
 * account here and never will. So: no login, no chrome, no nav. One page with
 * the cuts on it and two buttons.
 *
 * What is NOT on this page is the design. No pay, no credits, no brief, no
 * editor name — the projection in `review_link_room` never returns them, so
 * this file could not leak them if it tried. What the creator charges and what
 * they paid to have it cut are the creator's business, and this link goes to
 * the person on the other side of that number.
 *
 * Dynamic on purpose: the rpc counts the view, which is the creator's only
 * signal that the link actually landed.
 */

export const dynamic = "force-dynamic";

// a capability url must never end up in an index. it is not a secret page, it
// is a secret address, and the two fail the same way.
export const metadata: Metadata = {
  title: "Review",
  robots: { index: false, follow: false, nocache: true },
};

type Props = { params: Promise<{ token: string }> };

const VERDICT_STYLE: Record<ReviewVerdict, string> = {
  approved: "bg-ink text-white",
  changes: "bg-ember text-flame",
  comment: "bg-shell text-ink-50",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-shell">
      <div className="mx-auto w-full max-w-[880px] px-5 py-10 sm:py-14">{children}</div>
    </main>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-card border border-line bg-paper px-5 py-5 sm:px-6 sm:py-6 ${className}`}
    >
      {children}
    </section>
  );
}

/** A dead link says which way it died, because "404" sends people to slack. */
function Closed({ reason }: { reason: "missing" | "revoked" | "expired" }) {
  const copy = {
    missing: {
      head: "this link does not open",
      body: "it was never made, or it has been replaced by a new one. ask whoever sent it for the current link.",
    },
    revoked: {
      head: "this review is closed",
      body: "the creator turned this link off. ask them for a fresh one if you still need to look.",
    },
    expired: {
      head: "this link has run out",
      body: "it was set to stop working by now. ask whoever sent it for a fresh one.",
    },
  }[reason];

  return (
    <Shell>
      <Card className="text-center">
        <p className="text-[22px] font-extrabold tracking-[-0.02em]">{copy.head}</p>
        <p className="mx-auto mt-2 max-w-[42ch] text-[14.5px] leading-[1.65] text-ink-50">
          {copy.body}
        </p>
      </Card>
      <Footer />
    </Shell>
  );
}

function Footer() {
  return (
    <p className="mt-6 text-center text-[12.5px] text-ink-50">
      sent with{" "}
      <a href="https://www.creatorempire.app" className="font-semibold hover:text-flame-dark">
        ugc flows
      </a>
    </p>
  );
}

/** One cut: played inline when the browser can, linked out when it cannot. */
function Cut({ cut }: { cut: RoomCut }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[16px] font-bold tracking-[-0.015em]">cut {cut.version}</p>
        <p className="text-[12.5px] text-ink-50">{ago(cut.created_at)}</p>
      </div>

      {cut.url === null ? (
        <p className="text-[13.5px] text-ink-50">
          this file is not available any more. ask for it again.
        </p>
      ) : cut.playable ? (
        <video
          controls
          preload="metadata"
          src={cut.url}
          className="w-full rounded-card border border-line bg-ink"
        />
      ) : (
        <a
          href={cut.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between gap-3 rounded-card border border-line bg-shell px-4 py-4 transition-colors hover:border-flame"
        >
          <span className="min-w-0 truncate text-[14.5px] font-semibold">
            {cut.uploaded ? "open the file" : cut.url}
          </span>
          <span className="shrink-0 text-[13px] font-bold text-flame">watch</span>
        </a>
      )}

      {cut.note && (
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink-70">
          {cut.note}
        </p>
      )}
    </Card>
  );
}

export default async function ReviewPage({ params }: Props) {
  const { token } = await params;
  const result = await loadReviewRoom(token);
  if (!result.ok) return <Closed reason={result.reason} />;

  const { room } = result;
  const { job } = room;
  const cuts = room.cuts;
  const hasCut = cuts.length > 0;
  const signedOff = room.notes.find((n) => n.verdict === "approved");

  return (
    <Shell>
      <div className="space-y-4">
        {/* ------------------------------------------------------- the header */}
        <Card>
          <div className="flex min-w-0 items-start gap-4">
            <BrandMark
              name={job.brand_name ?? job.title}
              logo={brandLogo({
                logo_key: job.brand_logo_key,
                logo_url: job.brand_logo_url,
              })}
              size="md"
            />
            <div className="min-w-0 flex-1">
              {job.brand_name && (
                <p className="truncate text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
                  {job.brand_name}
                </p>
              )}
              <h1 className="mt-0.5 text-[24px] font-extrabold leading-[1.15] tracking-[-0.025em] sm:text-[28px]">
                {job.title}
              </h1>
              <p className="mt-1.5 text-[13px] text-ink-50">
                {job.video_count} video{job.video_count === 1 ? "" : "s"}
                {job.delivered_at ? ` · delivered ${shortDate(job.delivered_at)}` : ""}
                {room.label ? ` · for ${room.label}` : ""}
              </p>
            </div>
          </div>

          <p className="mt-4 border-t border-line pt-4 text-[14.5px] leading-[1.65] text-ink-70">
            {room.closed
              ? "this one is signed off and closed. the cuts stay here for your records."
              : hasCut
                ? "watch it, then approve it or say what needs changing. either one reaches the creator straight away, and nothing is charged to you."
                : "the edit is not back yet. this link stays live, so keep it and check again later."}
          </p>
        </Card>

        {/* --------------------------------------------------------- the cuts */}
        {hasCut ? (
          cuts.map((cut) => <Cut key={cut.id} cut={cut} />)
        ) : (
          <Card>
            <p className="text-[14.5px] text-ink-50">
              Nothing to watch yet. The editor is still on it.
            </p>
          </Card>
        )}

        {/* ------------------------------------------------------ your verdict */}
        {!room.closed && (
          <Card className="space-y-4">
            <div>
              <p className="text-[16px] font-bold tracking-[-0.015em]">Your call</p>
              <p className="mt-0.5 text-[13px] text-ink-50">
                {signedOff
                  ? `${reviewerName(signedOff)} already approved this. you can still add to it.`
                  : "approving here tells the creator you are happy. they do the rest."}
              </p>
            </div>
            <VerdictForm
              token={token}
              cuts={cuts.map((c) => ({ id: c.id, version: c.version }))}
              hasCut={hasCut}
            />
          </Card>
        )}

        {/* ------------------------------------------------------- what was said */}
        {room.notes.length > 0 && (
          <Card className="space-y-4">
            <p className="text-[16px] font-bold tracking-[-0.015em]">Said so far</p>
            <ul className="space-y-3.5">
              {room.notes.map((note) => (
                <li key={note.id} className="border-t border-line pt-3.5 first:border-0 first:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold tracking-[-0.015em]">
                      {reviewerName(note)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[12px] font-semibold ${VERDICT_STYLE[note.verdict]}`}
                    >
                      {VERDICT_LABEL[note.verdict]}
                    </span>
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
          </Card>
        )}
      </div>

      <Footer />
    </Shell>
  );
}
