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
      : "border border-line bg-paper text-ink hover:bg-shell";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-60 ${skin}`}
      >
        {busy ? "Opening" : (label ?? (manage ? "Manage connections" : "Connect accounts"))}
      </button>
      {error && <p className="text-[12px] font-semibold text-flame-dark">{error}</p>}
      <DifferentAccount dealId={dealId} origin={origin} />
    </div>
  );
}

/**
 * The way to connect an account OTHER than the one the browser is signed into.
 *
 * Reported by students as "it auto connects to a previous account, or picks one
 * for me, and never lets me choose". Nothing on our side picks: every deal has
 * its own Upload-Post profile and nothing is shared between them. What is shared
 * is the browser. Upload-Post's connect page hands off to the platform's own
 * login, and TikTok and Instagram silently approve as whoever is already signed
 * in there, so the second brand lands on the first brand's account without a
 * screen ever asking. No parameter on their connect page forces a fresh login.
 *
 * So the fix is a link that can be opened somewhere signed into nothing: a
 * private window. The platform then has to ask who you are. The link is minted
 * on the press (good for about two days) and copied, never opened here, since
 * opening it here is exactly the signed-in tab that caused the problem.
 */
export function DifferentAccount({
  dealId,
  origin = "social",
}: {
  dealId: string;
  origin?: ConnectOrigin;
}) {
  const [shown, setShown] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "ready" | "error">("idle");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const mint = async () => {
    if (state === "busy") return;
    setState("busy");
    setError("");
    try {
      const result = await connectLink(dealId, origin);
      if ("error" in result) {
        setError(result.error);
        setState("error");
        return;
      }
      setUrl(result.url);
      setState("ready");
    } catch {
      setError("Could not make a link right now. Try again.");
      setState("error");
    }
  };

  // the write is the first thing the handler does, nothing awaited before it:
  // safari only allows a clipboard write inside the gesture that asked for it.
  const copy = () => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false)
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShown(true)}
        className="text-[12px] font-semibold text-ink-50 underline-offset-2 hover:text-ink hover:underline"
      >
        Use a different account?
      </button>

      {shown && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Connect a different account"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShown(false)}
        >
          <div
            className="w-full max-w-[460px] rounded-2xl border border-line bg-paper p-6 text-left shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[17px] font-bold text-ink">Connect a different account</h2>
              <button
                type="button"
                onClick={() => setShown(false)}
                aria-label="Close"
                className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-[18px] leading-none text-ink-50 hover:bg-shell hover:text-ink"
              >
                ×
              </button>
            </div>

            <p className="mt-3 text-[13.5px] leading-[1.55] text-ink-70">
              Each deal has its own accounts, so nothing carries over between them. What carries
              over is your browser: TikTok and Instagram log you in as whoever is already signed
              in and often skip the screen that asks.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13.5px] leading-[1.55] text-ink-70">
              <li>Get the link below and copy it.</li>
              <li>
                Open a <span className="font-semibold text-ink">private or incognito window</span>{" "}
                and paste it there.
              </li>
              <li>Log in as the account you want for this deal.</li>
              <li>Come back here and refresh. Check the handle that shows up.</li>
            </ol>
            <p className="mt-3 text-[13px] leading-[1.55] text-ink-50">
              On Facebook you can also press &ldquo;Log in to another account&rdquo; on their screen.
              On a phone, sign out of the app first.
            </p>

            <div className="mt-5">
              {state !== "ready" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={mint}
                    disabled={state === "busy"}
                    className="h-9 rounded-lg bg-flame px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-flame-dark disabled:opacity-60"
                  >
                    {state === "busy" ? "Making a link" : "Get a connect link"}
                  </button>
                  {error && <p className="text-[12px] font-semibold text-flame-dark">{error}</p>}
                </div>
              ) : (
                <div className="grid gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={url}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="Connect link"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-shell px-3 text-[12.5px] text-ink-70 focus:border-flame focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={copy}
                      className="h-9 shrink-0 rounded-lg bg-flame px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p className="text-[12px] text-ink-50">
                    Good for about two days. Paste it into a private window.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
