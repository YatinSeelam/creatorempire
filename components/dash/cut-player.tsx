"use client";

import { useState } from "react";
import { Panel } from "@/components/dash/ui";
import { humanSize } from "@/lib/editing-files";
import type { ResolvedDeliverable } from "@/lib/editing-files";
import { ago } from "@/lib/money";

/**
 * The cut, playing, with its versions as a switch.
 *
 * The deliverables list used to be a stack of rows reading "uploaded file v1",
 * which meant the one thing a creator opens this page to do — watch what came
 * back — was a click out to a signed url in another tab. A cut is the subject
 * of this page, so it renders as the subject.
 *
 * Client only for the version switch. Every url is already signed by the
 * server; nothing here fetches.
 */

export type PlayerCut = ResolvedDeliverable & {
  /** the human filename off the joined file row. falls back to the cut's note. */
  fileName: string;
  /** the joined file row's size, null for a pasted link or a missing row. */
  sizeBytes: number | null;
};

export function CutPlayer({ cuts }: { cuts: PlayerCut[] }) {
  // cuts arrive newest first, so index 0 is the one to open on.
  const [i, setI] = useState(0);
  const cut = cuts[Math.min(i, cuts.length - 1)];
  if (!cut) return null;

  return (
    <Panel
      title={`Cut v${cut.version}`}
      action={
        cuts.length > 1 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {/* oldest on the left, the way versions are counted, even though
                the list itself arrives the other way round. */}
            {[...cuts].reverse().map((c) => {
                const at = cuts.indexOf(c);
                const on = at === Math.min(i, cuts.length - 1);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setI(at)}
                    aria-pressed={on}
                    className={`rounded-pill border px-3 py-1 text-[12.5px] font-bold tabular-nums transition-colors ${
                      on
                        ? "border-flame bg-ember text-flame-dark"
                        : "border-line text-ink-50 hover:text-ink"
                    }`}
                  >
                    V{c.version}
                  </button>
                );
            })}
          </div>
        ) : (
          <span className="shrink-0 text-[12.5px] text-ink-50">{ago(cut.created_at)}</span>
        )
      }
    >
      <div className="space-y-3.5">
        {cut.resolvedUrl === null ? (
          <p className="rounded-card border border-line bg-shell px-4 py-6 text-center text-[13.5px] text-ink-50">
            This file is gone. Ask the editor to send it again.
          </p>
        ) : cut.playable ? (
          <video
            key={cut.id}
            controls
            preload="metadata"
            src={cut.resolvedUrl}
            className="aspect-video w-full rounded-card border border-line bg-ink"
          />
        ) : (
          <a
            href={cut.resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-card border border-line bg-shell px-4 py-5 transition-colors hover:border-flame"
          >
            <span className="min-w-0 truncate text-[14px] font-semibold">
              {cut.uploaded ? cut.fileName : cut.resolvedUrl}
            </span>
            <span className="shrink-0 text-[13px] font-bold text-flame">watch</span>
          </a>
        )}

        {/* on an uploaded cut the note is the uploader's filename, already the
            headline of the row below. only a note that says something else is
            worth its own line. */}
        {cut.note && cut.note !== cut.fileName && (
          <p className="whitespace-pre-wrap text-[13.5px] leading-[1.6] text-ink-70">
            {cut.note}
          </p>
        )}

        {cut.resolvedUrl && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line bg-shell px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
              {cut.uploaded ? cut.fileName : cut.resolvedUrl}
            </span>
            <span className="shrink-0 text-[12.5px] text-ink-50">
              {[humanSize(cut.sizeBytes), ago(cut.created_at)].filter(Boolean).join(" · ")}
            </span>
            <a
              href={cut.resolvedUrl}
              target="_blank"
              rel="noreferrer"
              // `download` is ignored cross-origin, which a signed storage url
              // is, so this opens rather than saves. The word stays honest for
              // a link out and the browser's own menu does the saving.
              className="shrink-0 rounded-pill border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark"
            >
              Open
            </a>
          </div>
        )}
      </div>
    </Panel>
  );
}
