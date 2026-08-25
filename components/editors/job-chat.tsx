import type { ReactNode } from "react";
import type { JobEvent } from "@/lib/editing";
import { ago } from "@/lib/money";

/**
 * The conversation, split out from the status trail.
 *
 * They used to render as one list, which meant "can you make the hook
 * punchier" sat between "claimed the job" and "sent cut v2" and read like
 * logging. They are different things: the trail is what the system did, the
 * chat is two people talking. A creator scanning for what an editor asked
 * should never have to filter machine lines out of it.
 *
 * Server component. The composer is passed in as `composer` so each side can
 * bring its own action without this file knowing about either.
 */

export function JobChat({
  events,
  viewerId,
  otherLabel,
  composer,
}: {
  events: JobEvent[];
  viewerId: string;
  /** what to call the person on the other end: "the creator" or the editor's name. */
  otherLabel: string;
  composer?: ReactNode;
}) {
  const messages = events.filter((e) => e.kind === "comment");

  return (
    <div className="rounded-card border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
        <h2 className="text-[15px] font-bold tracking-[-0.015em]">messages</h2>
        <span className="text-[12.5px] text-ink-50">
          {messages.length === 0
            ? "no messages"
            : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="px-5 sm:px-6">
        <JobThread events={events} viewerId={viewerId} otherLabel={otherLabel} className="py-4" />
      </div>

      {composer && (
        <div className="border-t border-line px-5 py-4 sm:px-6">{composer}</div>
      )}
    </div>
  );
}

/**
 * The bubbles on their own, with no card around them.
 *
 * Split out of {@link JobChat} so the creator's page can drop the thread into
 * a tab it already drew a panel for. Card-inside-a-card is the one thing that
 * makes a two-column page read as cluttered, and the thread is the part worth
 * sharing here — the wrapper never was.
 */
export function JobThread({
  events,
  viewerId,
  otherLabel,
  className = "",
}: {
  events: JobEvent[];
  viewerId: string;
  otherLabel: string;
  className?: string;
}) {
  const messages = events.filter((e) => e.kind === "comment");

  if (messages.length === 0) {
    return (
      <p className={`text-[13.5px] text-ink-50 ${className}`}>
        Nothing yet. Anything unclear about the brief, ask it here.
      </p>
    );
  }

  return (
    <ul className={`max-h-[420px] space-y-3 overflow-y-auto ${className}`}>
      {messages.map((e) => {
        const mine = e.author_id === viewerId;
        return (
          <li key={e.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
            {/* the bubble carries the side, so the name line stays quiet */}
            <span className="mb-1 text-[12px] font-semibold text-ink-50">
              {mine ? "you" : otherLabel} · {ago(e.created_at)}
            </span>
            <p
              className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-[1.55] ${
                mine ? "bg-flame text-on-accent" : "border border-line bg-shell text-ink-70"
              }`}
            >
              {e.body}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The other half of what used to be one list: what the system and the two
 * people did, in order, with no conversation in it.
 */
export function JobTrail({ events, viewerId }: { events: JobEvent[]; viewerId: string }) {
  const trail = events.filter((e) => e.kind === "status");
  if (trail.length === 0) return null;

  return (
    <div className="rounded-card border border-line bg-paper px-5 py-4 sm:px-6">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-50">
        activity
      </h2>
      <ul className="mt-3 space-y-2">
        {trail.map((e) => (
          <li key={e.id} className="flex gap-2.5 text-[13px] text-ink-50">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line" />
            <span>
              <span className="font-semibold text-ink-70">
                {e.author_id === viewerId ? "you" : "they"}
              </span>{" "}
              {e.body} · {ago(e.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
