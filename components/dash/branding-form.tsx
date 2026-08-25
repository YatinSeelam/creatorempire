"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import type { saveBrandingPatch } from "@/app/(dash)/agency/actions";
import { Field, Label } from "@/components/dash/form";
import { Panel } from "@/components/dash/ui";
import {
  DEFAULT_ACCENT,
  ORG_FEATURES,
  darken,
  featureOn,
  isHex,
  lighten,
  onAccent,
  type FeatureDef,
  type Org,
  type OrgFeatures,
} from "@/lib/org";
import { uploadOrgLogo } from "@/lib/org-upload";

/**
 * The whole branding screen.
 *
 * It autosaves, which is the reason all four panels are one component rather
 * than four. The version this replaced was a single "White label" card holding
 * five unrelated fields in a lopsided two-column grid under one Save button,
 * and the specific thing wrong with it was that nothing on it showed you what
 * you were changing: a hex field asks somebody to picture a rail they cannot
 * see. So the paint now previews itself, the switches say what they hide, and
 * the button is gone because a settings screen with one button at the bottom is
 * a screen people leave without pressing it.
 *
 * Everything here is optimistic. The field takes the new value the instant it
 * is typed, the write goes out behind it, and a refusal puts the old value back
 * rather than leaving the screen claiming something the database does not hold.
 */

/** ~600ms after typing stops. Long enough to not write a word letter by letter,
 *  short enough that leaving the tab straight after typing still saves. */
const TEXT_DEBOUNCE = 600;

/**
 * A colour is not typed, it is dragged, and a native colour well fires change
 * on every frame of that drag. "Immediately" for a colour therefore means the
 * quarter second after the drag stops, not a hundred writes a second, and at
 * this length it still reads as instant. The hex text field shares it and adds
 * one rule of its own: nothing is sent until the six digits are actually there,
 * because posting `#ec5` mid-word only flashes an error at somebody who is
 * halfway through getting it right.
 */
const COLOUR_DEBOUNCE = 250;

/** "saved" is a receipt, not a state. It clears itself. */
const SAVED_FOR = 2200;

type Draft = {
  name: string;
  logo_url: string;
  accent_hex: string;
  /** empty is null: "derive it from the accent", which is the default. */
  rail_hex: string;
  support_email: string;
  features: OrgFeatures;
};

/** The ones that debounce. The colours and the switches do not go through here. */
const TEXT_KEYS = ["name", "logo_url", "support_email"] as const;
type TextKey = (typeof TEXT_KEYS)[number];

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function BrandingForm({
  org,
  userId,
  save,
}: {
  org: Org;
  /**
   * The viewer, not `org.owner_id`. The storage policy on the logo bucket only
   * accepts a path whose first segment is auth.uid(), and an org can hold a
   * second owner who is not the row's `owner_id` — uploading under somebody
   * else's uid fails at the server with a policy error nobody can act on.
   */
  userId: string;
  save: typeof saveBrandingPatch;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    name: org.name,
    logo_url: org.logo_url ?? "",
    accent_hex: org.accent_hex ?? "",
    rail_hex: org.rail_hex ?? "",
    support_email: org.support_email ?? "",
    features: org.features ?? {},
  }));
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  /**
   * The last values the server accepted, which is what a rejected write rolls
   * back to. Rolling back to "whatever was on screen before this edit" is the
   * version that looks right and is not: two edits in flight at once would put
   * back a value that had already been superseded.
   */
  const saved = useRef<Draft>({
    name: org.name,
    logo_url: org.logo_url ?? "",
    accent_hex: org.accent_hex ?? "",
    rail_hex: org.rail_hex ?? "",
    support_email: org.support_email ?? "",
    features: org.features ?? {},
  });

  // the debounced writes read this rather than closing over `draft`, so a
  // timer set three keystrokes ago still sends the word as it now stands.
  const live = useRef(draft);
  useEffect(() => {
    live.current = draft;
  }, [draft]);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const schedule = useCallback((key: string, ms: number, run: () => void) => {
    const pending = timers.current;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        run();
      }, ms)
    );
  }, []);

  /**
   * One write, and one line of status for all of them.
   *
   * The ticket is what stops a slow write that has already been overtaken from
   * printing "saved" over a newer one's "saving". Only the most recent call
   * gets to say anything; the older ones still roll themselves back on failure,
   * because that is about the data rather than about the message.
   */
  const ticket = useRef(0);

  const commit = useCallback(
    async (patch: Partial<Draft>) => {
      const keys = (Object.keys(patch) as (keyof Draft)[]).filter(
        (k) => !same(patch[k], saved.current[k])
      );
      if (keys.length === 0) return;

      const wire: Record<string, unknown> = {};
      for (const k of keys) wire[k] = patch[k];

      const mine = ++ticket.current;
      setStatus({ kind: "saving" });

      const result = await save({ orgId: org.id, patch: wire });

      if (result.ok) {
        for (const k of keys) {
          if (k === "features") saved.current.features = patch.features ?? {};
          else saved.current[k] = (patch[k] ?? "") as string;
        }
        if (mine === ticket.current) {
          setStatus({ kind: "saved" });
          schedule("saved", SAVED_FOR, () => setStatus({ kind: "idle" }));
        }
        return;
      }

      // put back only the keys this write owned. A refused colour must not also
      // throw away a name that was typed while it was in the air.
      setDraft((d) => {
        const rolled = { ...d };
        for (const k of keys) {
          if (k === "features") rolled.features = saved.current.features;
          else rolled[k] = saved.current[k];
        }
        return rolled;
      });
      if (mine === ticket.current) setStatus({ kind: "error", message: result.message });
    },
    [org.id, save, schedule]
  );

  /* ------------------------------------------------------------------ text */

  const flushText = useCallback(() => {
    const pending = timers.current.get("text");
    if (pending) {
      clearTimeout(pending);
      timers.current.delete("text");
    }

    const patch: Partial<Draft> = {};
    for (const k of TEXT_KEYS) {
      if (live.current[k] !== saved.current[k]) patch[k] = live.current[k];
    }
    if (Object.keys(patch).length) void commit(patch);
  }, [commit]);

  const typed = useCallback(
    (key: TextKey, value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      schedule("text", TEXT_DEBOUNCE, flushText);
    },
    [flushText, schedule]
  );

  /* --------------------------------------------------------------- colours */

  const setColour = useCallback(
    (key: "accent_hex" | "rail_hex", value: string) => {
      setDraft((d) => ({ ...d, [key]: value }));
      schedule(key, COLOUR_DEBOUNCE, () => {
        const next = live.current[key];
        // "" is a real value here: it clears the column and hands the colour
        // back to the product's own palette, or in the rail's case back to the
        // accent it is derived from.
        if (next === "" || isHex(next)) void commit({ [key]: next });
      });
    },
    [commit, schedule]
  );

  /* -------------------------------------------------------------- switches */

  const toggle = useCallback(
    (key: string, on: boolean) => {
      const features = { ...live.current.features };
      // a switch turned back on removes the key rather than storing `true`, so
      // the column stays a list of what an agency has switched OFF. Absent
      // means on everywhere else in the app, and a stored `true` would be a
      // second way of saying the same thing that somebody eventually reads as
      // a third.
      if (on) delete features[key];
      else features[key] = false;

      setDraft((d) => ({ ...d, features }));
      void commit({ features });
    },
    [commit]
  );

  /* ---------------------------------------------------------------- render */

  const accent = isHex(draft.accent_hex) ? draft.accent_hex : DEFAULT_ACCENT;
  // exactly what themeVars() does with a null rail_hex, so the miniature below
  // is the rail they will actually get rather than an approximation of it.
  const rail = isHex(draft.rail_hex) ? draft.rail_hex : lighten(accent, 0.78);

  const nav = ORG_FEATURES.filter((f) => f.group === "nav");
  const tools = ORG_FEATURES.filter((f) => f.group === "tool");

  return (
    <div className="space-y-5">
      {/*
        One status line for the whole screen. Six fields each with their own
        "saved" tick is a column of confirmations for work nobody doubted, and
        the one thing a shared line has to solve is being visible from whichever
        of the four panels you are in — hence sticky, and hence a fixed height
        so nothing on the page moves when it appears.
      */}
      <div
        className="pointer-events-none sticky top-2 z-20 flex h-7 items-center justify-end"
        // the region is here for the whole life of the screen rather than
        // appearing with the first save. A live region that mounts at the same
        // moment its text does is not announced by most screen readers, which
        // is the difference between an accessible status and a decorative one.
        // Polite rather than assertive: this narrates a background write and
        // must not interrupt the field being typed into.
        role="status"
        aria-live="polite"
      >
        <StatusPill status={status} />
      </div>

      <Panel
        title="Identity"
        sub="The name and the mark your creators see in the rail."
        flush
      >
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Field
            label="Workspace name"
            name="name"
            value={draft.name}
            onChange={(v) => typed("name", v)}
            onBlur={flushText}
            required
          />

          <LogoControl
            value={draft.logo_url}
            name={draft.name}
            userId={userId}
            onUploaded={(url) => {
              setDraft((d) => ({ ...d, logo_url: url }));
              void commit({ logo_url: url });
            }}
            onTyped={(v) => typed("logo_url", v)}
            onFlush={flushText}
          />
        </div>
      </Panel>

      <Panel
        title="Colour"
        sub="Two: the accent everything is highlighted with, and the rail it sits on."
        flush
      >
        <p className="mt-1 max-w-[64ch] text-[13.5px] leading-[1.6] text-ink-50">
          The greys stay ours. They are what keeps the text readable against
          everything else, and a tenant picking six colours picks at least one
          pair that cannot be read.
        </p>

        <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <ColourWell
              label="Accent"
              value={draft.accent_hex}
              fallback={accent}
              placeholder={DEFAULT_ACCENT}
              onChange={(v) => setColour("accent_hex", v)}
            />

            {/* the two places the accent lands hardest: a primary button and
                the soft chip a callout sits on. Painted from inline styles
                rather than the token, because the token is what this form is
                for. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-pill px-3.5 py-1.5 text-[12.5px] font-bold"
                style={{ background: accent, color: onAccent(accent) }}
              >
                Add a deal
              </span>
              <span
                className="rounded-pill px-3 py-1.5 text-[12.5px] font-semibold"
                style={{ background: lighten(accent), color: darken(accent, 0.28) }}
              >
                owed $1,240
              </span>
            </div>

            <p className="mt-2.5 max-w-[42ch] text-[12.5px] leading-[1.5] text-ink-50">
              {draft.accent_hex && !isHex(draft.accent_hex)
                ? "needs six hex digits, like #ec5a29."
                : onAccent(accent) === "#101010"
                  ? "light enough that labels flip to dark text. that is handled for you."
                  : "buttons, the active nav row and anything owed are painted from this."}
            </p>
          </div>

          <div>
            <ColourWell
              label="Rail"
              value={draft.rail_hex}
              fallback={rail}
              placeholder={rail}
              onChange={(v) => setColour("rail_hex", v)}
              action={
                draft.rail_hex ? (
                  <button
                    type="button"
                    onClick={() => setColour("rail_hex", "")}
                    className="h-8 shrink-0 rounded-pill border border-line px-3 text-[12.5px] font-semibold text-ink-50 transition-colors hover:border-flame hover:text-flame"
                  >
                    Match my accent
                  </button>
                ) : null
              }
            />

            <p className="mt-2.5 max-w-[42ch] text-[12.5px] leading-[1.5] text-ink-50">
              {draft.rail_hex && !isHex(draft.rail_hex)
                ? "needs six hex digits, like #ec5a29."
                : !draft.rail_hex
                  ? "left alone it is a pale wash of your accent. set it to go dark, or to go a colour your accent is not."
                  : onAccent(rail) === "#ffffff"
                    ? "dark enough that the rail's labels flip to white. that is handled for you."
                    : "the column down the left of every screen, and the account row in its corner."}
            </p>
          </div>

          <RailPreview accent={accent} rail={rail} name={draft.name} />
        </div>
      </Panel>

      <Panel
        title="Sections"
        sub="What your roster gets to see. Everything is on until you say otherwise."
        flush
      >
        <p className="mt-1 max-w-[64ch] text-[13.5px] leading-[1.6] text-ink-50">
          These hide rows, they do not lock the routes behind them. Somebody who
          bookmarked a page before you switched it off can still open it, so
          treat this as tidying the app down to what you actually run rather than
          as a permission.
        </p>

        <div className="mt-5 space-y-6">
          <SwitchGroup
            heading="In the rail"
            features={nav}
            state={draft.features}
            onToggle={toggle}
          />
          <SwitchGroup
            heading="In the tools shelf"
            features={tools}
            state={draft.features}
            onToggle={toggle}
          />
        </div>
      </Panel>

      <Panel
        title="Reach"
        sub="Where your creators are sent when they need you."
        flush
      >
        {/* the custom domain used to sit beside this and autosave with it,
            which attached half-typed hostnames to the vercel project on every
            pause. it has its own panel on the page now, with a Save button,
            because attaching a domain is a step you press rather than a
            field you drift through. */}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field
            label="Support email"
            name="support_email"
            value={draft.support_email}
            onChange={(v) => typed("support_email", v)}
            onBlur={flushText}
            placeholder="help@example.com"
            hint="Where your creators are told to go when something is wrong."
          />
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ status */

function StatusPill({ status }: { status: Status }) {
  if (status.kind === "idle") return null;

  const failed = status.kind === "error";

  return (
    <span
      className={`pointer-events-auto max-w-full truncate rounded-pill px-3 py-1 text-[12.5px] font-semibold shadow-card ring-1 ${
        failed
          ? "bg-ember text-flame-dark ring-flame/30"
          : "bg-paper text-ink-50 ring-line"
      }`}
    >
      {status.kind === "saving"
        ? "saving…"
        : status.kind === "saved"
          ? "saved"
          : status.message}
    </span>
  );
}

/* -------------------------------------------------------------------- logo */

/**
 * The logo, as a file first and a url second.
 *
 * A url field on its own is the version of this that reads as finished and is
 * not: an agency owner has their logo as a png on their desktop, and answering
 * "Logo" with "https://…" asks them to go and host it somewhere before they can
 * use the product. The link field is still here, folded away, because anyone
 * whose brand assets already live on a cdn wants exactly that and nothing else.
 *
 * The tile is framed the way `WorkMark` frames it in the rail — object-contain
 * inside a ring — because agency logos are wide wordmarks and dropping one into
 * a square without containing it renders a squashed smear.
 */
function LogoControl({
  value,
  name,
  userId,
  onUploaded,
  onTyped,
  onFlush,
}: {
  value: string;
  name: string;
  userId: string;
  onUploaded: (url: string) => void;
  onTyped: (value: string) => void;
  onFlush: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // cleared so that picking the same file twice in a row still fires change,
    // which is what happens when the first attempt failed on the network.
    e.target.value = "";
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      onUploaded(await uploadOrgLogo(file, userId));
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "That did not work. Try again."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>Logo</Label>

      <div className="mt-1.5 flex items-start gap-4">
        <span
          className={`relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-paper p-1.5 ${
            value ? "ring-1 ring-line" : "border border-dashed border-line"
          }`}
        >
          {value ? (
            // whatever storage handed back, so there is no domain to whitelist
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[22px] font-extrabold text-ink-50">
              {(name.trim() || "?").charAt(0).toUpperCase()}
            </span>
          )}

          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-paper/75 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
              …
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
              className="h-9 rounded-pill border border-line px-4 text-[13px] font-semibold text-ink-70 transition-colors hover:border-flame hover:text-flame disabled:opacity-60"
            >
              {busy ? "Uploading" : value ? "Replace" : "Upload an image"}
            </button>
            {value && !busy && (
              <button
                type="button"
                onClick={() => onUploaded("")}
                className="h-9 px-1 text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame"
              >
                Remove
              </button>
            )}
          </div>

          <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-50">
            a png on transparency reads best. it is resized to 400px and shown
            in the rail at 28.
          </p>

          {error && (
            <p className="mt-2 text-[12.5px] font-semibold leading-[1.45] text-flame-dark">
              {error}
            </p>
          )}

          {/* native details, so the link field costs no state and stays folded
              for the many people who will never want it. */}
          <details className="group mt-2.5">
            <summary className="w-fit cursor-pointer list-none text-[12.5px] font-semibold text-ink-50 transition-colors marker:content-none hover:text-flame">
              paste a link instead
            </summary>
            <div className="mt-2">
              <Field
                label="Logo url"
                name="logo_url"
                type="url"
                value={value}
                onChange={onTyped}
                onBlur={onFlush}
                placeholder="https://…/logo.png"
              />
            </div>
          </details>
        </div>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        onChange={pick}
        className="hidden"
      />
    </div>
  );
}

/* ----------------------------------------------------------------- colours */

/**
 * A colour well and the hex beside it, one value between them.
 *
 * The native well is how a colour gets picked and the text field is how a brand
 * hex gets pasted, and each writes the other. The text field is the only one of
 * the two that can hold nothing, which matters: empty is a real, storable
 * answer here and a colour input has no way to express it.
 */
function ColourWell({
  label,
  value,
  fallback,
  placeholder,
  onChange,
  action,
}: {
  label: string;
  /** what is stored. "" means the column is null and the value is derived. */
  value: string;
  /** what to paint while it is empty or half typed. */
  fallback: string;
  placeholder: string;
  onChange: (value: string) => void;
  action?: ReactNode;
}) {
  const shown = isHex(value) ? value : fallback;

  return (
    <div>
      <Label>{label}</Label>

      <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
        <input
          type="color"
          value={shown}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Pick a ${label.toLowerCase()} colour`}
          className="size-11 shrink-0 cursor-pointer rounded-xl border border-line bg-paper p-1"
        />

        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={`${label} hex`}
          className="h-11 w-[132px] rounded-xl border border-line bg-shell px-3 font-mono text-[14px] tracking-[0.02em] outline-none placeholder:text-ink-50/70 focus:border-flame"
        />

        {action}
      </div>
    </div>
  );
}

/**
 * The rail, small.
 *
 * This is the whole reason the rail colour is settable: the bottom left corner
 * of the app is the one piece of it an agency looks at all day, and a hex field
 * cannot tell you that the black you just picked turned your account row into
 * near-black on near-black. So the miniature carries what the real rail
 * carries — the wordmark, an active row, a resting row and the account chip in
 * the corner — and flips its own ink exactly the way `railInk` does in
 * lib/org.ts, which is why a dark rail here goes white two ways rather than one.
 */
function RailPreview({
  accent,
  rail,
  name,
}: {
  accent: string;
  rail: string;
  name: string;
}) {
  // the same two levels themeVars() emits as --color-on-rail and
  // --color-on-rail-strong. Kept as literals rather than imported because that
  // helper is private to lib/org.ts and this is a preview, not the paint.
  const pale = onAccent(rail) === "#ffffff";
  const soft = pale ? "#ffffffbf" : "#3d3b38";
  const strong = pale ? "#ffffff" : "#101010";

  const wordmark = name.trim() || "Workspace";

  return (
    <div className="w-[176px] shrink-0">
      <div
        className="flex h-[204px] flex-col rounded-xl border border-line p-2"
        style={{ background: rail }}
        aria-hidden="true"
      >
        <div className="flex items-center gap-2 px-1.5 py-1.5">
          <span
            className="size-6 shrink-0 rounded-[7px]"
            style={{ background: accent }}
          />
          <span
            className="truncate text-[12.5px] font-extrabold tracking-[-0.015em]"
            style={{ color: strong }}
          >
            {wordmark}
          </span>
        </div>

        <div className="mt-2 space-y-1">
          <span
            className="flex h-7 items-center gap-2 rounded-pill px-2 text-[11.5px] font-bold"
            style={{ background: accent, color: onAccent(accent) }}
          >
            <Dot color={onAccent(accent)} />
            Dashboard
          </span>
          <span
            className="flex h-7 items-center gap-2 rounded-pill px-2 text-[11.5px] font-bold"
            style={{ color: soft }}
          >
            <Dot color={soft} />
            Deals
          </span>
          <span
            className="flex h-7 items-center gap-2 rounded-pill px-2 text-[11.5px] font-bold"
            style={{ color: soft }}
          >
            <Dot color={soft} />
            Social
          </span>
        </div>

        {/* the corner. pinned to the bottom because that is where it is. */}
        <div className="mt-auto flex items-center gap-2 rounded-pill px-1.5 py-1.5">
          <span
            className="size-6 shrink-0 rounded-full"
            style={{ background: `${strong}24` }}
          />
          <span className="min-w-0 flex-1">
            <span
              className="block h-[6px] w-[54px] rounded-pill"
              style={{ background: `${strong}59` }}
            />
            <span
              className="mt-1 block h-[5px] w-[38px] rounded-pill"
              style={{ background: `${soft}59` }}
            />
          </span>
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-[1.45] text-ink-50">
        your rail, account row in the corner and all.
      </p>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="size-3 shrink-0 rounded-[4px] opacity-70"
      style={{ background: color }}
    />
  );
}

/* ---------------------------------------------------------------- switches */

function SwitchGroup({
  heading,
  features,
  state,
  onToggle,
}: {
  heading: string;
  features: FeatureDef[];
  /** the stored object, read through featureOn so absent still means on. */
  state: OrgFeatures;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <div>
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
        {heading}
      </p>

      <div className="mt-2 divide-y divide-line rounded-xl border border-line">
        {features.map((f) => {
          const on = featureOn(state, f.key);
          return (
            <div
              key={f.key}
              className="flex items-center justify-between gap-4 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-bold tracking-[-0.01em]">{f.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-[1.45] text-ink-50">
                  {f.note}
                </p>
              </div>
              <Switch label={f.label} on={on} onChange={(next) => onToggle(f.key, next)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The switch. There is no switch primitive in this codebase — the two that
 * exist are welded to a form each, one in settings-controls and one in the
 * portfolio editor — so this is a third, kept here rather than lifted into
 * form.tsx until something outside this screen wants one. Same drawing as the
 * other two, so it does not read as a different control.
 */
function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 transition-colors ${
        on ? "bg-flame" : "bg-line"
      }`}
    >
      <span
        className={`size-5 rounded-full bg-white shadow-sm transition-transform ${
          on ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

/* ----------------------------------------------------------------- compares */

/**
 * Is this value already what the server holds?
 *
 * Strings compare as strings. The features object compares on what it actually
 * means — which keys are switched off — so a `{}` that arrived from the
 * database and a `{}` this form built are the same answer rather than two
 * different object identities that would post a pointless write on every click.
 */
function same(a: Draft[keyof Draft] | undefined, b: Draft[keyof Draft]): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return offKeys(a) === offKeys(b);
}

function offKeys(features: OrgFeatures | undefined): string {
  if (!features) return "";
  return Object.entries(features)
    .filter(([, on]) => on === false)
    .map(([key]) => key)
    .sort()
    .join(",");
}
