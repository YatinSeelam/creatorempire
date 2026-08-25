"use client";

import { useState } from "react";
import { connectLink } from "@/app/(dash)/social/actions";
import type { ConnectOrigin } from "@/lib/autopost/server";

/**
 * Press it, log in on the platform's own page, come back connected.
 *
 * Lives in its own file because it is now on two pages: the composer's account
 * strip in Social, and the deal's own Connect accounts section. Connecting is
 * the same act from either, and a creator setting a brand up should not have to
 * find the other page to finish it.
 *
 * `origin` decides where Upload-Post sends them back to. It is a two-value enum
 * and the path is built on the server, because this value comes from a browser
 * and ends up as a redirect target handed to a third party.
 */
export function ConnectButton({
  dealId,
  manage,
  origin = "social",
  label,
  tone = "flame",
}: {
  dealId: string;
  /** something is already connected, so the button manages rather than starts. */
  manage: boolean;
  origin?: ConnectOrigin;
  /** overrides both default labels, for a row that says what it is connecting. */
  label?: string;
  tone?: "flame" | "line";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    // NO `noopener` in the feature string. It reads like the safe choice and it
    // is the bug: with it the browser hands back null instead of the window, so
    // there is nothing to point at the url when it arrives — the blank tab is
    // stranded and the fallback navigates the tab you were on, which is exactly
    // the behaviour this was written to stop. The opener link is cut below
    // instead, once we still have the handle we need.
    const tab = window.open("about:blank", "_blank");

    try {
      const result = await connectLink(dealId, origin);
      if ("error" in result) {
        tab?.close();
        setError(result.error);
        return;
      }

      if (tab) {
        // same thing `noopener` would have done, done late enough to be useful:
        // Upload-Post's page must not get a handle on ours through
        // `window.opener`. Safe here because the tab is still our own
        // about:blank at this point.
        tab.opener = null;
        // replace, not assign: about:blank should not sit in that tab's history
        // waiting for a back button to land on it.
        tab.location.replace(result.url);
      } else {
        // the open was blocked outright. a lost page beats a dead button.
        window.location.href = result.url;
      }
    } catch {
      setError("Could not open the connect page. Try again.");
      tab?.close();
    } finally {
      setBusy(false);
    }
  };

  const skin =
    tone === "flame"
      ? "bg-flame text-on-accent hover:bg-flame-dark"
      : "border border-line text-ink-70 hover:border-flame/45 hover:text-flame";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`h-9 shrink-0 rounded-pill px-4 text-[13.5px] font-semibold transition-colors disabled:opacity-60 ${skin}`}
      >
        {busy ? "Opening" : (label ?? (manage ? "Manage connections" : "Connect accounts"))}
      </button>
      {error && <p className="text-[12px] font-semibold text-flame-dark">{error}</p>}
    </div>
  );
}
