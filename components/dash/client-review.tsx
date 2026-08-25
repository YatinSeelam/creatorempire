"use client";

import { useActionState, useState } from "react";
import {
  createReviewLink,
  dismissClientNote,
  forwardClientNote,
  toggleReviewLink,
  type EditingState,
} from "@/app/(dash)/editing/actions";
import { Note, Submit } from "@/components/dash/form";
import {
  linkIsLive,
  reviewUrl,
  reviewerName,
  type ReviewLink,
  type ReviewNote,
} from "@/lib/editing-review";
import { ago } from "@/lib/money";

/**
 * The creator's half of a client review link.
 *
 * Two pieces, and the split matters: the link itself is a share control, and
 * every note the client left is an INBOX item that needs a decision. A verdict
 * never acts on its own — approving releases the payout, and a change request
 * spends a round the creator paid for — so the client says it here and the
 * creator does it.
 */

const empty: EditingState = {};

/** Make it, name it, rotate it. One link per job, rotating kills the old url. */
export function ReviewLinkBox({
  jobId,
  link,
}: {
  jobId: string;
  link: ReviewLink | null;
}) {
  const [state, action] = useActionState(createReviewLink, empty);

  if (!link) {
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="job_id" value={jobId} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
              Who is it for
            </span>
            <input
              name="label"
              placeholder="acme campaign manager"
              maxLength={80}
              className="w-full rounded-xl border border-line bg-shell px-3.5 py-3 text-[14.5px] outline-none transition-colors placeholder:text-ink-50 focus:border-flame"
            />
          </label>
          <Submit pendingLabel="Making">Make the link</Submit>
        </div>
        <Note state={state} />
      </form>
    );
  }

  const live = linkIsLive(link);
  const url = reviewUrl(link.token);

  // three sentences of link management used to sit open under the url on a page
  // that already had eight panels. Rotating and revoking are things you do once,
  // if ever, so they fold and the line that changes — has anyone opened it — is
  // the one left showing.
  return (
    <div className="space-y-3">
      <CopyRow url={url} live={live} />

      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-50">
            {link.label ? `For ${link.label}. ` : ""}
            {!live
              ? "This link is off."
              : link.views > 0
                ? `Opened ${link.views} time${link.views === 1 ? "" : "s"}${
                    link.last_viewed_at ? `, last ${ago(link.last_viewed_at)}` : ""
                  }.`
                : "Not opened yet."}
          </span>
          <span className="shrink-0 text-[12.5px] font-semibold text-ink-50 transition-colors group-hover:text-ink">
            <span className="group-open:hidden">Link settings</span>
            <span className="hidden group-open:inline">Hide settings</span>
          </span>
        </summary>

        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <p className="text-[12.5px] leading-[1.6] text-ink-50">
            {live
              ? "Turning it off closes the review and keeps the url. Rotating mints a new one and kills this, which is how you take a link back after it has gone out. Send it to the editor too if you want them reading the feedback first hand."
              : "Turn it back on, or rotate for a fresh url."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={toggleReviewLink}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="off" value={live ? "1" : "0"} />
              <button
                type="submit"
                className="rounded-pill border border-line px-4 py-2 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
              >
                {live ? "Turn it off" : "Turn it on"}
              </button>
            </form>
            <form action={action}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="rotate" value="1" />
              <Submit tone="line" size="sm" pendingLabel="Rotating">
                Rotate
              </Submit>
            </form>
          </div>
        </div>
      </details>
      <Note state={state} />
    </div>
  );
}

/**
 * The url and a copy button. `navigator.clipboard` can be missing on an
 * insecure origin, so the input stays selectable and the button falls back to
 * selecting the text rather than doing nothing.
 */
function CopyRow({ url, live }: { url: string; live: boolean }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className={`min-w-0 flex-1 rounded-xl border border-line bg-shell px-3.5 py-3 text-[14px] font-semibold outline-none ${
          live ? "" : "text-ink-50 line-through"
        }`}
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            // no clipboard permission. the field is already selectable.
          }
        }}
        className="shrink-0 rounded-pill bg-ink px-5 py-3 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90"
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

/**
 * One unhandled note, with the decision attached.
 *
 * The scope picker is the same brief-vs-direction split the creator's own
 * revision form uses, and it is here rather than on the public page for the
 * reason the whole feature exists: a `direction` round is the one included
 * change and costs real money, so the person paying picks it.
 */
export function ClientNoteRow({
  jobId,
  note,
  canForward,
  directionUsed,
}: {
  jobId: string;
  note: ReviewNote;
  /** false unless the job is sitting delivered: nothing else can go back. */
  canForward: boolean;
  directionUsed: boolean;
}) {
  const [state, action] = useActionState(forwardClientNote, empty);
  const [scope, setScope] = useState<"brief" | "direction">("brief");

  return (
    <div className="space-y-3 rounded-card border border-line bg-shell px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-bold tracking-[-0.015em]">
          {reviewerName(note)}
        </span>
        {note.version > 0 && note.deliverable_id && (
          <span className="text-[12.5px] text-ink-50">on cut {note.version}</span>
        )}
      </div>

      {note.body && (
        <p className="whitespace-pre-wrap text-[14px] leading-[1.6] text-ink-70">
          {note.body}
        </p>
      )}

      {note.verdict === "changes" && note.body ? (
        <form action={action} className="space-y-3">
          <input type="hidden" name="job_id" value={jobId} />
          <input type="hidden" name="note_id" value={note.id} />
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
              Brief was missed
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
              {directionUsed ? "Direction change used" : "New direction"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Submit size="sm" pendingLabel="Sending" disabled={!canForward}>
              Send to the editor
            </Submit>
            <DismissButton jobId={jobId} noteId={note.id} />
          </div>

          {!canForward && (
            <p className="text-[12.5px] text-ink-50">
              Only a delivered job can go back. This one is already with the editor.
            </p>
          )}
          <Note state={state} />
        </form>
      ) : (
        <DismissButton jobId={jobId} noteId={note.id} />
      )}
    </div>
  );
}

function DismissButton({ jobId, noteId }: { jobId: string; noteId: string }) {
  return (
    <form action={dismissClientNote}>
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="note_id" value={noteId} />
      <button
        type="submit"
        className="rounded-pill border border-line px-4 py-2 text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
      >
        Mark handled
      </button>
    </form>
  );
}
