"use client";

import { useState, type ReactNode } from "react";
import { Label, Select } from "@/components/dash/form";
import {
  darken,
  isHex,
  lighten,
  onAccent,
  INVITE_ROLES,
  ROLE_LABEL,
  ROLE_NOTE,
  type OrgRole,
} from "@/lib/org";

/**
 * The accent, with the thing it changes standing next to it.
 *
 * A hex field on its own asks somebody to picture a button they cannot see, and
 * the specific failure it hides is a pale brand colour: white-on-yellow is
 * unreadable and nobody finds that out from `#f5d90a`. The preview runs the same
 * `onAccent` flip the server does, so the swatch here is the button they get.
 *
 * Two inputs, one value. The native colour well is how a colour gets picked and
 * the text field is how a brand hex gets pasted, and each writes the other.
 */
export function AccentField({
  defaultValue,
  name,
}: {
  defaultValue: string;
  /** the workspace name, so the preview shows their own wordmark, not "Acme". */
  name: string;
}) {
  const [accent, setAccent] = useState(defaultValue);
  const valid = isHex(accent);
  const shown = valid ? accent : defaultValue;

  return (
    <div>
      <Label>Accent</Label>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="color"
          value={shown}
          onChange={(e) => setAccent(e.target.value)}
          aria-label="Pick an accent colour"
          className="size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-paper p-1"
        />

        <input
          name="accent_hex"
          value={accent}
          onChange={(e) => setAccent(e.target.value)}
          spellCheck={false}
          placeholder="#ec5a29"
          className="h-11 w-[140px] rounded-xl border border-line bg-paper px-3 font-mono text-[14px] tracking-[0.02em] outline-none focus:border-flame"
        />

        {/* the preview: the rail pill, a primary button and a soft chip, which
            are the three places the accent lands. Painted from inline styles
            rather than the token, because the token is what this form is for. */}
        <span
          className="flex items-center gap-2 rounded-pill px-2 py-1.5"
          style={{ background: lighten(shown, 0.78) }}
        >
          <span
            className="rounded-pill px-3 py-1 text-[12.5px] font-bold"
            style={{ background: shown, color: onAccent(shown) }}
          >
            {name.trim() ? name.trim().slice(0, 14) : "Dashboard"}
          </span>
          <span
            className="rounded-pill px-3 py-1 text-[12.5px] font-semibold"
            style={{ background: darken(shown), color: onAccent(darken(shown)) }}
          >
            Hover
          </span>
        </span>
      </div>

      <p className="mt-1 text-[12.5px] text-ink-50">
        {valid
          ? onAccent(shown) === "#101010"
            ? "Light enough that labels flip to dark text. That is handled for you."
            : "Buttons, the active nav pill and anything owed are painted from this."
          : "Needs six hex digits, like #ec5a29."}
      </p>
    </div>
  );
}

/**
 * Copy an invite link.
 *
 * The label is the state: "Copy link" becomes "Copied" for two seconds and
 * nothing else on screen moves. A toast for this would be a floating element
 * announcing something the button it came from can say itself.
 */
export function CopyLink({ href }: { href: string }) {
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(href);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          // clipboard is blocked (insecure origin, or the user said no). The
          // link is in the title attribute, so it is still gettable by hand.
        }
      }}
      title={href}
      className="h-7 shrink-0 rounded-pill border border-line px-2.5 text-[12px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
    >
      {done ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * The invite row: an email, a role, the button, and one live line saying what
 * the role that is currently picked actually gets.
 *
 * It owns the whole row rather than just the select, and that is the point of
 * the component. The note has to sit under all three controls, because a hint
 * hanging off the select alone is what made this form ragged: the select grew
 * two lines taller than the email field beside it, `items-end` dutifully lined
 * everything up with the bottom of the tallest child, and the button had to be
 * shoved back down with a hand-measured `pb-[22px]` to look level again. With
 * the note lifted out to its own grid row every control ends at the same box
 * bottom, so aligning to the end is honest instead of being compensated for.
 *
 * The note also used to be `ROLE_NOTE.creator`, hard coded, which meant picking
 * Admin left the screen describing what a Creator gets. That is worse than no
 * note at all: the roles are described where they are picked precisely so nobody
 * has to go and look them up, and a description that quietly stops matching the
 * thing it labels is a lie the reader has no way to catch.
 *
 * The form around this stays a plain server-action form. Only the note needs to
 * move as you type, so only the note needs state, and turning the page client
 * side to get one line of copy would drag the invite list and its reads with it.
 */
export function RolePicker({
  field,
  submit,
}: {
  /** the email field, rendered on the server. it takes whatever width is left. */
  field: ReactNode;
  /** the submit, kept as a slot so the page never loses `useFormStatus`. */
  submit: ReactNode;
}) {
  const [role, setRole] = useState<OrgRole>("creator");

  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end">
      {field}

      {/* The listener sits on a wrapper rather than on `Select` itself, so the
          shared primitive keeps one shape for every form in the app. React's
          change event bubbles, and this wrapper contains nothing but the select,
          so nothing else can reach it. A listener on the whole row would hear
          the email field on every keystroke instead and set the role to whatever
          had been typed, which is why the wrapper is this tight; the instanceof
          is what says so to the type checker as well as to the next reader. */}
      <div
        onChange={(e) => {
          if (e.target instanceof HTMLSelectElement) {
            setRole(e.target.value as OrgRole);
          }
        }}
      >
        <Select
          label="Role"
          name="role"
          defaultValue="creator"
          // no Owner: `orgs.owner_id` is the owner permission and an invite
          // never moves it, so the seat would draw Branding on the rail and
          // have every write on it refused. one founder per workspace.
          options={INVITE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
        />
      </div>

      {/* the button is wrapped so it keeps its own width in a stretched grid
          cell, and so the cell it sits in can be the one that hugs its content. */}
      <div className="flex">{submit}</div>

      <p className="text-[12.5px] leading-[1.5] text-ink-50 sm:col-span-3">
        {ROLE_NOTE[role]}
      </p>
    </div>
  );
}
