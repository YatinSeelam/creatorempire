"use client";

import { useActionState, useState } from "react";
import {
  createHandoffLink,
  toggleHandoffLink,
  type EditingState,
} from "@/app/(dash)/editing/actions";
import { Note } from "@/components/dash/form";
import { handoffUrl, linkIsLive, type HandoffLink } from "@/lib/editing-handoff";
import { ago } from "@/lib/money";

/**
 * The creator's half of an editor handoff link.
 *
 * The link is minted when the job is posted, so what this draws is a url and a
 * copy button and nothing else. There is no explanation next to it: the page
 * around it is called "the link" and the thing under the cursor is a url, and
 * three sentences telling somebody what a url is were most of the weight on the
 * old version of this panel.
 *
 * Rotating replaces the token in place, which is the only real revoke for a url
 * already sitting in somebody's dms. Turning it off keeps the url and shuts the
 * page. Both fold, because both are done once if ever.
 */

const empty: EditingState = {};

const field =
  "w-full rounded-md border border-line bg-shell px-3 text-[12.5px] outline-none transition-colors placeholder:text-ink-50 focus:border-ink";
const dark =
  "shrink-0 rounded-md bg-ink px-4 text-[12.5px] font-bold text-paper transition-colors hover:bg-ink/85";
const quiet =
  "shrink-0 rounded-md border border-line px-3 text-[12px] font-semibold text-ink-50 transition-colors hover:text-ink";

export function HandoffLinkBox({
  jobId,
  link,
}: {
  jobId: string;
  link: HandoffLink | null;
}) {
  const [state, action] = useActionState(createHandoffLink, empty);

  // the fallback: a job posted before the link was minted automatically.
  if (!link) {
    return (
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="job_id" value={jobId} />
        <input
          name="label"
          placeholder="who is cutting it"
          maxLength={80}
          className={`h-9 min-w-0 flex-1 ${field}`}
        />
        <button type="submit" className={`h-9 ${dark}`}>
          make the link
        </button>
        <Note state={state} />
      </form>
    );
  }

  const live = linkIsLive(link);
  const url = handoffUrl(link.token);

  return (
    <div className="space-y-2">
      <CopyRow url={url} live={live} />

      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11.5px] text-ink-50 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            {!live
              ? "off"
              : link.views > 0
                ? `opened ${link.views}×${link.last_viewed_at ? `, ${ago(link.last_viewed_at)}` : ""}`
                : "not opened yet"}
            {link.label ? ` · ${link.label}` : ""}
          </span>
          <span className="shrink-0 font-semibold transition-colors group-hover:text-ink">
            <span className="group-open:hidden">settings</span>
            <span className="hidden group-open:inline">hide</span>
          </span>
        </summary>

        <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
          {/* a note to yourself about who is holding it. auto-minted links
              start with none, so this is where the name gets put on. */}
          <form action={action} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="job_id" value={jobId} />
            <input
              name="label"
              defaultValue={link.label ?? ""}
              placeholder="who is cutting it"
              maxLength={80}
              className={`h-8 min-w-0 flex-1 ${field}`}
            />
            <button type="submit" className={`h-8 ${quiet}`}>
              save
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <form action={toggleHandoffLink}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="off" value={live ? "1" : "0"} />
              <button type="submit" className={`h-8 ${quiet}`}>
                {live ? "turn it off" : "turn it on"}
              </button>
            </form>
            <form action={action}>
              <input type="hidden" name="job_id" value={jobId} />
              <input type="hidden" name="rotate" value="1" />
              <button type="submit" className={`h-8 ${quiet}`}>
                rotate
              </button>
            </form>
            <p className="min-w-0 flex-1 text-[11.5px] leading-[1.5] text-ink-50">
              rotating mints a new url and kills this one.
            </p>
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
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className={`h-9 min-w-0 flex-1 ${field} font-semibold ${
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
        className={`h-9 ${dark}`}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
