"use client";

import { useActionState, useState } from "react";
import {
  createHandoffLink,
  toggleHandoffLink,
  type EditingState,
} from "@/app/(dash)/editing/actions";
import { Note, Submit } from "@/components/dash/form";
import { handoffUrl, linkIsLive, type HandoffLink } from "@/lib/editing-handoff";
import { ago } from "@/lib/money";

/**
 * The creator's half of an editor handoff link.
 *
 * One control, and the shape is the review link's on purpose: make it, name
 * whoever is holding it, rotate it when it needs taking back. What is different
 * is which way it points — this url goes to the person who CUTS the batch, and
 * everything they need is on the page it opens.
 */

const empty: EditingState = {};

export function HandoffLinkBox({
  jobId,
  link,
}: {
  jobId: string;
  link: HandoffLink | null;
}) {
  const [state, action] = useActionState(createHandoffLink, empty);

  if (!link) {
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="job_id" value={jobId} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
              Who is cutting it
            </span>
            <input
              name="label"
              placeholder="raj, my editor"
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
  const url = handoffUrl(link.token);

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
              ? "Turning it off closes the page and keeps the url. Rotating mints a new one and kills this, which is how you take a link back after it has gone out. Anything you upload from now on shows up on it without sending anything again."
              : "Turn it back on, or rotate for a fresh url."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <form action={toggleHandoffLink}>
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
