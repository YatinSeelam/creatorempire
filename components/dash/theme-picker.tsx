"use client";

import { useState, useTransition } from "react";
import { setTheme } from "@/app/(dash)/settings/actions";
import { THEMES, type Theme } from "@/lib/theme";

/**
 * Three cards: system, light, dark.
 *
 * The attribute is flipped on `.dash-shell` before the action is called, and
 * that is the whole reason this is a client component. A cookie write plus a
 * `revalidatePath` is a server round trip, and a colour scheme that arrives a
 * few hundred milliseconds after the click reads as a page that did not hear
 * you — this is the one control in the product whose entire job is to be
 * visibly instant. The action then makes it survive a reload.
 *
 * Both halves write the same three words, and `readTheme` on the server is what
 * stops the cookie being anything else.
 *
 * Not a two-way switch. "System" is a real answer and the most common right
 * one — a laptop that goes dark at sunset should take the app with it — and a
 * toggle cannot express it without a second control next to it explaining that
 * the first one is being ignored.
 */
export function ThemePicker({ current }: { current: Theme }) {
  const [value, setValue] = useState<Theme>(current);
  const [, startTransition] = useTransition();

  function pick(next: Theme) {
    setValue(next);
    // the shell owns the tokens, not <html>: dark mode is scoped to the app so
    // the marketing pages keep the design they were drawn as.
    document.querySelector(".dash-shell")?.setAttribute("data-theme", next);

    const body = new FormData();
    body.set("theme", next);
    startTransition(() => void setTheme(body));
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {THEMES.map((option) => {
        const on = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => pick(option.value)}
            aria-pressed={on}
            className={`rounded-xl border p-3 text-left transition-colors ${
              on ? "border-flame bg-ember" : "border-line bg-paper hover:border-flame/45"
            }`}
          >
            <Swatch theme={option.value} />
            <span className="mt-2.5 block text-[14px] font-bold tracking-[-0.01em]">
              {option.label}
            </span>
            <span className="block text-[12.5px] text-ink-50">{option.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the option looks like, rather than what it is called.
 *
 * A miniature of the app — rail, card, two lines of text — because "dark" is a
 * word and this is a picture of the thing, which is the faster read by a mile.
 * Hardcoded hexes on purpose: these are the light and dark palettes as drawn,
 * and painting the swatch in the CURRENT tokens would make all three previews
 * identical to whatever is already on screen.
 */
function Swatch({ theme }: { theme: Theme }) {
  if (theme === "system") {
    // split down the middle, which is the honest picture of "it depends".
    return (
      <span className="flex h-[54px] w-full overflow-hidden rounded-[9px] border border-line">
        <span className="w-1/2 border-r border-line">
          <Mini dark={false} />
        </span>
        <span className="w-1/2">
          <Mini dark />
        </span>
      </span>
    );
  }

  return (
    <span className="block h-[54px] w-full overflow-hidden rounded-[9px] border border-line">
      <Mini dark={theme === "dark"} />
    </span>
  );
}

function Mini({ dark }: { dark: boolean }) {
  const ground = dark ? "#0f0f0e" : "#f6f4f1";
  const card = dark ? "#1b1b19" : "#ffffff";
  const rail = dark ? "#191513" : "#fde0d0";
  const line = dark ? "#36342f" : "#e4e0d9";
  const text = dark ? "#8d8880" : "#c9c4bb";

  return (
    <span className="flex size-full" style={{ background: ground }}>
      <span className="h-full w-[26%]" style={{ background: rail }} />
      <span className="flex flex-1 flex-col justify-center gap-1 p-1.5">
        <span
          className="block h-2 w-full rounded-[2px]"
          style={{ background: card, border: `1px solid ${line}` }}
        />
        <span className="block h-1 w-3/4 rounded-pill" style={{ background: text }} />
        <span className="block h-1 w-1/2 rounded-pill" style={{ background: text }} />
      </span>
    </span>
  );
}
