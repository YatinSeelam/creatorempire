"use client";

import { useState } from "react";
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
 * Draws its own square frame rather than borrowing Panel: the page around it is
 * hairline borders and right angles, and Panel is a rounded card with a shadow.
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
  const at = Math.min(i, cuts.length - 1);
  const cut = cuts[at];
  if (!cut) return null;

  return (
    <section className="rounded-lg border border-line bg-paper">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <h2 className="text-[13px] font-bold tracking-[-0.01em]">
          cut v{cut.version}
        </h2>

        {cuts.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1">
            {/* oldest on the left, the way versions are counted, even though
                the list itself arrives the other way round. */}
            {[...cuts].reverse().map((c) => {
              const idx = cuts.indexOf(c);
              const on = idx === at;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setI(idx)}
                  aria-pressed={on}
                  className={`rounded-md px-2 py-0.5 text-[11.5px] font-bold tabular-nums transition-colors ${
                    on ? "bg-ink text-paper" : "text-ink-50 hover:text-ink"
                  }`}
                >
                  v{c.version}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="shrink-0 text-[11.5px] text-ink-50">
            {ago(cut.created_at)}
          </span>
        )}
      </header>

      <div className="p-3">
        {cut.resolvedUrl === null ? (
          <p className="rounded-md border border-line bg-shell px-4 py-8 text-center text-[12.5px] text-ink-50">
            this file is gone. ask for it again.
          </p>
        ) : cut.playable ? (
          <video
            key={cut.id}
            controls
            preload="metadata"
            src={cut.resolvedUrl}
            className="aspect-video w-full rounded-md bg-ink"
          />
        ) : (
          <a
            href={cut.resolvedUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-shell px-4 py-5 transition-colors hover:border-ink"
          >
            <span className="min-w-0 truncate text-[13px] font-semibold">
              {cut.uploaded ? cut.fileName : cut.resolvedUrl}
            </span>
            <span className="shrink-0 text-[12px] font-bold">open</span>
          </a>
        )}

        {/* on an uploaded cut the note is the uploader's filename, already the
            line below. only a note that says something else earns a row. */}
        {cut.note && cut.note !== cut.fileName && (
          <p className="mt-3 whitespace-pre-wrap text-[12.5px] leading-[1.55] text-ink-70">
            {cut.note}
          </p>
        )}

        {cut.resolvedUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">
              {cut.uploaded ? cut.fileName : cut.resolvedUrl}
            </span>
            <span className="shrink-0 text-[11.5px] text-ink-50">
              {[humanSize(cut.sizeBytes), ago(cut.created_at)].filter(Boolean).join(" · ")}
            </span>
            <a
              href={cut.resolvedUrl}
              target="_blank"
              rel="noreferrer"
              // `download` is ignored cross-origin, which a signed storage url
              // is, so this opens rather than saves. The word stays honest for
              // a link out and the browser's own menu does the saving.
              className="shrink-0 text-[12px] font-semibold text-ink-50 transition-colors hover:text-ink"
            >
              open
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
