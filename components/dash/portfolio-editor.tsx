"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { barTitle, DashBar, Panel, Split } from "./ui";
import { PortfolioSite } from "@/components/portfolio/portfolio-site";
import { importClip, savePortfolio } from "@/app/(dash)/portfolio/actions";
import { brand } from "@/lib/content";
import { CURATED_BRANDS, matchCuratedBrand, searchBrands } from "@/lib/brand-catalog";
// embeds AND importable both come from the embed module, never from
// portfolio-import: that one is a server file and importing it here would drag
// the scrape client and the credit ledger into the browser bundle.
import { embeds, importable } from "@/lib/portfolio-embed";
import { portfolioFontVars } from "@/lib/portfolio-fonts";
import { onAccent, themeVars } from "@/lib/portfolio-theme";
import { uploadAvatar, uploadClientLogo, uploadClip } from "@/lib/portfolio-upload";
import type { PortfolioAgency } from "@/lib/org-overrides";
import {
  ACCENT_PRESETS,
  BRAND_COLORS,
  FONTS,
  MAX_CLIENTS,
  MAX_CLIPS,
  MAX_SKILLS,
  PORTFOLIO_FIELDS,
  SOCIAL_PLATFORMS,
  SURFACES,
  brandColor,
  portfolioGaps,
  portfolioScore,
  portfolioUrl,
  rowId,
  slugify,
  slugProblem,
  type Portfolio,
  type PortfolioClient,
  type PortfolioClip,
  type PortfolioSkill,
  type PortfolioSocial,
  type PortfolioTheme,
  type SocialPlatform,
} from "@/lib/portfolio-schema";

/**
 * The portfolio maker: one section at a time, the real page pinned beside it.
 *
 * ## why this is not the seven stacked panels the mother platform uses
 *
 * The document has seven parts and ugc flows renders all seven as cards down a
 * single column. That column is about four screens tall, so the address, the
 * publish switch and the save button all live off screen from wherever you are
 * typing, and the answer there was to float a second save button over the form
 * in a pill that follows you down. Two save buttons and a floating strip is a
 * lot of chrome to fix a problem the layout created.
 *
 * Here the seven parts are a strip of steps and exactly one is on screen. Each
 * section is short enough that its own panel holds the save button in its
 * footer, so the control is always a few pixels from the field you just left
 * and nothing has to float. `Next` walks the strip, so a creator filling the
 * page for the first time is led through it rather than left to scroll.
 *
 * The preview is not a sketch of the public page, it is the public page:
 * `PortfolioSite` is the same component the visitor gets, sized by container
 * queries rather than viewport ones, so putting it in a 318px box or a 1180px
 * one is the entire difference between the phone and desktop views here.
 *
 * Everything is one piece of local state so the preview updates on the keystroke
 * rather than on save. Saving is explicit — no autosave, because a half-written
 * headline is not something anyone wants published behind their back, and the
 * publish toggle is a deliberate act too.
 *
 * There is no cover photo here. `lib/ce/portfolio-schema.ts` has no `coverUrl`
 * and the template beside it has no frame to put one in, so a control for it
 * would upload a file that nothing on the public page could ever show.
 */

/** The width the desktop preview is rendered at before it is scaled down. Wide
 *  enough that a container-query template picks its widest layout, which is the
 *  only thing the desktop view is there to show. */
const DESKTOP_WIDTH = 1180;

/**
 * How tall the preview well is while it is stuck.
 *
 * Sized off the viewport at lg so the whole device stays on screen:
 * `--bar-offset` is where Split pins the aside (globals.css), 48px is the
 * device toggle sitting above the frame plus its gap, and 32px is the same
 * breathing room left under it. Read from the property rather than added up by
 * hand, so moving the bar does not silently leave this well a few pixels tall.
 */
const WELL_HEIGHT =
  "h-[560px] lg:h-[min(660px,calc(100dvh-var(--bar-offset)-80px))]";

type Device = "phone" | "desktop";

/* ------------------------------------------------------------------ shared */

const PRIMARY =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-ink px-4 text-[13.5px] font-semibold text-paper transition-colors hover:bg-ink/85 disabled:opacity-50";
const GHOST =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-line px-3.5 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-50";
const QUIET =
  "inline-flex h-8 shrink-0 items-center justify-center rounded-md border border-line px-3 text-[12.5px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-50";

/* ---------------------------------------------------------------- sections */

const SECTIONS = [
  { key: "profile", label: "Profile" },
  { key: "story", label: "Story" },
  { key: "contact", label: "Contact" },
  { key: "work", label: "Work" },
  { key: "brands", label: "Brands" },
  { key: "look", label: "Look" },
  { key: "publish", label: "Publish" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

/**
 * Whether a step has anything in it yet.
 *
 * `null` means the question does not apply: Look always has a theme, so a dot
 * there would be on from the first paint and tell nobody anything.
 */
function filledSections(p: Portfolio): Record<SectionKey, boolean | null> {
  return {
    profile: Boolean(p.name.trim()),
    story: Boolean(p.about.trim() || p.background.trim() || p.skills.length),
    contact: Boolean(p.email.trim() || p.phone.trim() || p.socials.length),
    work: p.clips.length > 0,
    brands: p.clients.length > 0,
    look: null,
    publish: p.published,
  };
}

export function PortfolioEditor({
  initial,
  userId,
  agency = null,
}: {
  initial: Portfolio;
  userId: string;
  /** the programme's sign-off, so the preview carries the footer a visitor gets. */
  agency?: PortfolioAgency | null;
}) {
  const [draft, setDraft] = useState<Portfolio>(initial);
  // what the server last confirmed. the only honest thing to diff against —
  // `initial` goes stale the moment one save lands.
  const [saved, setSaved] = useState<Portfolio>(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [device, setDevice] = useState<Device>("phone");
  const [section, setSection] = useState<SectionKey>("profile");

  // A timestamp rather than a boolean, so clicking copy again while the toast
  // is still up restarts the three seconds instead of inheriting the tail of
  // the previous timer.
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const copied = copiedAt !== null;

  useEffect(() => {
    if (copiedAt === null) return;
    const id = setTimeout(() => setCopiedAt(null), 3000);
    return () => clearTimeout(id);
  }, [copiedAt]);

  // Comparing the serialised documents rather than tracking a flag on every
  // setter: there are two dozen ways to change this form and exactly one of
  // them would eventually forget to raise the flag.
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved]
  );

  // The browser's own guard is the only one that survives a tab close. It is
  // hung on the dirty state rather than mounted once, so a saved portfolio does
  // not nag on the way out.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useCallback(() => {
    setSaveError(null);
    startTransition(async () => {
      const result = await savePortfolio(draft);
      if (result.ok) {
        // adopt what came back, not what was sent. the server clamps lengths,
        // drops blank rows and re-slugs; if the form kept its own copy the two
        // would disagree until the next reload.
        setDraft(result.portfolio);
        setSaved(result.portfolio);
      } else {
        setSaveError(result.error);
      }
    });
  }, [draft]);

  const set = useCallback(
    <K extends keyof Portfolio>(key: K, value: Portfolio[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    []
  );

  const setTheme = useCallback(
    (patch: Partial<PortfolioTheme>) =>
      setDraft((d) => ({ ...d, theme: { ...d.theme, ...patch } })),
    []
  );

  const url = portfolioUrl(draft.slug);
  const gaps = portfolioGaps(draft);
  const filled = filledSections(draft);

  const index = SECTIONS.findIndex((s) => s.key === section);
  const next = SECTIONS[index + 1] ?? null;

  // one footer, rendered into whichever panel is on screen. it is a function
  // rather than a node so the `Next` label follows the step you are on.
  const footer = (
    <SaveBar
      dirty={dirty}
      pending={pending}
      error={saveError}
      onSave={save}
      next={next}
      onNext={() => next && setSection(next.key)}
    />
  );

  return (
    // portfolioFontVars has to sit above both the preview and the font picker:
    // the picker previews each face in itself, and neither can resolve
    // --pf-font-* unless the variables are in scope on a shared ancestor.
    <div className={portfolioFontVars}>
      {/* Its own bar, edge to edge: the page's name on the left, the address
          you actually hand out on the right. The save button is deliberately
          NOT here — it belongs to the section you are editing, and one save in
          one place is what lets the sections stay this quiet. */}
      <DashBar
        lead={<h1 className={`shrink-0 ${barTitle}`}>Portfolio</h1>}
        right={
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <CopyLink url={url} onCopied={() => setCopiedAt(Date.now())} />
            {/* The sticky preview beside the form is for typing against. This
                is for the last look before the link goes out: the whole page at
                real device widths, on its own screen. It reads the saved row,
                not this draft, which is why it is a link and not a tab. */}
            <Link
              href="/portfolio/preview"
              className={`hidden sm:inline-flex ${GHOST}`}
            >
              Preview
            </Link>
          </div>
        }
      >
        <CopiedToast show={copied} />
      </DashBar>

      <Split
        aside={
          <Preview
            draft={draft}
            agency={agency}
            device={device}
            onDevice={setDevice}
            url={url}
          />
        }
      >
        <div className="mx-auto w-full max-w-[720px]">
          <Steps
            active={section}
            filled={filled}
            onPick={setSection}
            dirty={dirty}
          />

          <div className="mt-4">
            {section === "profile" && (
              <Panel title="Profile" sub="who the page is for." footer={footer}>
                <Avatar
                  value={draft.avatarUrl}
                  name={draft.name}
                  userId={userId}
                  onChange={(v) => set("avatarUrl", v)}
                />

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field
                    spec={PORTFOLIO_FIELDS.name}
                    value={draft.name}
                    onChange={(v) => set("name", v)}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.role}
                    value={draft.role}
                    onChange={(v) => set("role", v)}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.location}
                    value={draft.location}
                    onChange={(v) => set("location", v)}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.cohort}
                    value={draft.cohort}
                    onChange={(v) => set("cohort", v)}
                  />
                </div>
              </Panel>
            )}

            {section === "story" && (
              <Panel
                title="Story"
                sub="what you do, and what you are good at."
                footer={footer}
              >
                <div className="space-y-4">
                  <Field
                    spec={PORTFOLIO_FIELDS.about}
                    value={draft.about}
                    onChange={(v) => set("about", v)}
                    rows={4}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.background}
                    value={draft.background}
                    onChange={(v) => set("background", v)}
                    rows={3}
                  />
                </div>

                <Skills
                  skills={draft.skills}
                  onChange={(nextSkills) => set("skills", nextSkills)}
                />
              </Panel>
            )}

            {section === "contact" && (
              <Panel
                title="Contact"
                sub="how a brand reaches you."
                footer={footer}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    spec={PORTFOLIO_FIELDS.email}
                    value={draft.email}
                    onChange={(v) => set("email", v)}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.phone}
                    value={draft.phone}
                    onChange={(v) => set("phone", v)}
                  />
                  <Field
                    spec={PORTFOLIO_FIELDS.ctaLabel}
                    value={draft.ctaLabel}
                    onChange={(v) => set("ctaLabel", v)}
                  />
                </div>

                <Socials
                  socials={draft.socials}
                  onChange={(nextSocials) => set("socials", nextSocials)}
                />
              </Panel>
            )}

            {section === "work" && (
              <Clips
                clips={draft.clips}
                userId={userId}
                onChange={(nextClips) => set("clips", nextClips)}
                footer={footer}
              />
            )}

            {section === "brands" && (
              <Brands
                clients={draft.clients}
                userId={userId}
                onChange={(nextClients) => set("clients", nextClients)}
                footer={footer}
              />
            )}

            {section === "look" && (
              <Look theme={draft.theme} onChange={setTheme} footer={footer} />
            )}

            {section === "publish" && (
              <PublishPanel
                slug={draft.slug}
                published={draft.published}
                gaps={gaps}
                score={portfolioScore(draft)}
                onSlug={(v) => set("slug", slugify(v))}
                onPublished={(v) => set("published", v)}
                footer={footer}
              />
            )}
          </div>
        </div>
      </Split>
    </div>
  );
}

/* ------------------------------------------------------------------- steps */

/**
 * The seven parts of the document as one strip.
 *
 * A row of links rather than a wizard: every step is reachable from every other
 * one, because a creator coming back to swap one clip should not have to walk
 * past six panels to reach it. The dot is filled once the step has anything in
 * it, which is the whole progress report — a percentage lives on the Publish
 * step where it can be acted on.
 *
 * Sticky, and the only sticky thing in the form column. It is 44px tall, so it
 * costs almost nothing to keep on screen, and it is what the save button in the
 * panel footer is reached through when a section does run long.
 */
function Steps({
  active,
  filled,
  onPick,
  dirty,
}: {
  active: SectionKey;
  filled: Record<SectionKey, boolean | null>;
  onPick: (key: SectionKey) => void;
  dirty: boolean;
}) {
  return (
    <div className="-mx-1 bg-shell/95 px-1 py-2 backdrop-blur-sm lg:sticky lg:top-0 lg:z-20">
      <nav
        aria-label="Portfolio sections"
        className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-md border border-line bg-paper p-1"
      >
        {SECTIONS.map((s) => {
          const on = s.key === active;
          const done = filled[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onPick(s.key)}
              aria-current={on ? "step" : undefined}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                on ? "bg-ink text-paper" : "text-ink-50 hover:text-ink"
              }`}
            >
              {done !== null && (
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    done
                      ? on
                        ? "bg-paper"
                        : "bg-ink"
                      : on
                        ? "bg-paper/40"
                        : "bg-line"
                  }`}
                />
              )}
              {s.label}
            </button>
          );
        })}

        {/* the one thing the strip has to say when it is not the section you
            are looking at: there is work in this tab that is not on the server
            yet. a word, not a second button — the button is in the footer. */}
        {dirty && (
          <span className="ml-auto hidden shrink-0 pl-2 pr-1 text-[12px] font-semibold text-ink-50 sm:block">
            unsaved
          </span>
        )}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------- saving */

/**
 * The save state and the save button, in the footer of whatever panel is open.
 *
 * The mother platform floats this over the form because its column is four
 * screens long. One section at a time is short enough that the foot of the
 * panel is always within reach, so it can be a strip in the card rather than a
 * pill hovering over it.
 */
function SaveBar({
  dirty,
  pending,
  error,
  onSave,
  next,
  onNext,
}: {
  dirty: boolean;
  pending: boolean;
  error: string | null;
  onSave: () => void;
  next: { key: SectionKey; label: string } | null;
  onNext: () => void;
}) {
  const message = error
    ? error
    : pending
      ? "Saving"
      : dirty
        ? "Unsaved changes"
        : "All changes saved";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
      <span
        aria-live="polite"
        className={`min-w-0 flex-1 truncate text-[12.5px] font-semibold ${
          error ? "text-flame-dark" : "text-ink-50"
        }`}
      >
        {message}
      </span>

      <div className="flex shrink-0 items-center gap-2">
        {next && (
          <button type="button" onClick={onNext} className={GHOST}>
            Next: {next.label}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={pending}
          className={PRIMARY}
        >
          {pending ? "Saving" : "Save"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ preview */

/**
 * The public page, at two sizes.
 *
 * Both devices are strokes, not slabs. A filled wrapper with padding around the
 * screen reads as a heavy block sitting on the page; an outline at a big radius
 * reads as a device at a fraction of the visual weight, and the screen still
 * runs edge to edge inside it.
 */
function Preview({
  draft,
  agency,
  device,
  onDevice,
  url,
}: {
  draft: Portfolio;
  agency: PortfolioAgency | null;
  device: Device;
  onDevice: (d: Device) => void;
  url: string;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex h-9 items-center rounded-md border border-line bg-paper p-0.5">
        {(["phone", "desktop"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDevice(d)}
            aria-pressed={device === d}
            className={`h-8 rounded-[5px] px-4 text-[13px] font-semibold transition-colors ${
              device === d ? "bg-ink text-paper" : "text-ink-50 hover:text-ink"
            }`}
          >
            {d === "phone" ? "Phone" : "Desktop"}
          </button>
        ))}
      </div>

      {device === "phone" ? (
        <div
          className={`no-scrollbar w-full max-w-[318px] overflow-y-auto overscroll-contain rounded-[38px] border-2 border-ink bg-paper shadow-card ${WELL_HEIGHT}`}
        >
          <PortfolioSite portfolio={draft} mode="preview" agency={agency} />
        </div>
      ) : (
        <DesktopFrame draft={draft} agency={agency} url={url} />
      )}
    </div>
  );
}

/**
 * The same component in a 1180px box, shrunk to fit the column.
 *
 * `transform: scale()` on `transform-origin: top left` is what makes this an
 * honest desktop view instead of a mock: the template is genuinely laid out at
 * desktop width and container queries pick the wide branch, then the whole
 * thing is photographically reduced. Nothing inside knows it was scaled.
 *
 * A transform does not change layout, so the scaled node would still claim
 * 1180px by its full height inside the scroller. The spacer under it carries
 * the real, scaled dimensions and the page is lifted out of flow on top of it,
 * which is what keeps the scroll extent right and the column from overflowing
 * sideways. Both sizes are measured rather than assumed, because the column is
 * 400px at lg and full width below it.
 */
function DesktopFrame({
  draft,
  agency,
  url,
}: {
  draft: Portfolio;
  agency: PortfolioAgency | null;
  url: string;
}) {
  const wellRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);

  useEffect(() => {
    const well = wellRef.current;
    const page = pageRef.current;
    if (!well || !page) return;

    const measure = () => {
      setScale(well.clientWidth / DESKTOP_WIDTH);
      setPageHeight(page.offsetHeight);
    };

    measure();
    // the page's height changes on every keystroke, not just on resize, so the
    // observer watches the content as well as the box around it
    const ro = new ResizeObserver(measure);
    ro.observe(well);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={`flex w-full flex-col overflow-hidden rounded-[14px] border-2 border-ink bg-paper shadow-card ${WELL_HEIGHT}`}
    >
      {/* the chrome is what tells you which view you are looking at. it is the
          cheapest possible signal and it does nothing else. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex gap-1" aria-hidden="true">
          <span className="size-2 rounded-full bg-line" />
          <span className="size-2 rounded-full bg-line" />
          <span className="size-2 rounded-full bg-line" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-shell px-2.5 py-1 text-center text-[11px] text-ink-50">
          {url}
        </span>
      </div>

      <div
        ref={wellRef}
        className="no-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        <div className="relative w-full" style={{ height: pageHeight * scale }}>
          <div
            ref={pageRef}
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: DESKTOP_WIDTH, transform: `scale(${scale})` }}
          >
            <PortfolioSite portfolio={draft} mode="preview" agency={agency} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- the header */

/**
 * Confirmation for the copy button, centred in the bar.
 *
 * Always rendered and faded rather than mounted on demand, so it eases in and
 * out instead of appearing and vanishing. pointer-events-none throughout: it
 * sits over the middle of the bar and must never eat a click meant for the
 * heading or the link behind it.
 */
function CopiedToast({ show }: { show: boolean }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
    >
      <div
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-md bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-paper transition-all duration-200 ${
          show ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
        }`}
      >
        <Check className="size-[15px] shrink-0" />
        Link copied
      </div>
    </div>
  );
}

/**
 * The public address, and a button that puts it on the clipboard. The icon
 * flips to a check while the toast above is up, so the button itself also
 * acknowledges the click.
 */
function CopyLink({ url, onCopied }: { url: string; onCopied: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${url}`);
      setCopied(true);
      onCopied();
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // clipboard is blocked (insecure origin, denied permission). the address
      // is right there in the link, so there is nothing to recover from.
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <a
        href={`https://${url}`}
        target="_blank"
        rel="noreferrer"
        className="truncate text-[14px] font-semibold text-flame no-underline transition-colors hover:text-flame-dark sm:text-[15px]"
      >
        {url}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Link copied" : "Copy link"}
        className="flex size-9 shrink-0 items-center justify-center rounded-md text-flame transition-colors hover:bg-ember hover:text-flame-dark"
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {copied ? (
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            ) : (
              <>
                <rect x="9" y="9" width="11" height="11" rx="2.5" />
                <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
              </>
            )}
          </g>
        </svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ profile */

/**
 * The avatar, as a circle you click.
 *
 * A round preview at the size the page actually uses, because a square crop
 * that looks fine in a file picker regularly loses a chin once it is a circle.
 * The file input is hidden behind the button rather than styled: no browser
 * lets you restyle the native control far enough to belong here.
 */
function Avatar({
  value,
  name,
  userId,
  onChange,
}: {
  value: string;
  name: string;
  userId: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = takeFile(e);
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await uploadAvatar(file, userId));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Label>Photo</Label>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative size-[76px] shrink-0 overflow-hidden rounded-full border border-line bg-shell">
          {value ? (
            // whatever storage handed back, so there is no domain to whitelist
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[26px] font-extrabold text-ink-50">
              {(name.trim() || "?").charAt(0).toUpperCase()}
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-paper/70">
              <Spinner />
            </span>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className={QUIET}
            >
              {value ? "Replace" : "Upload photo"}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange("")}
                className="h-8 px-1 text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-ink"
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-50">
            A clear, well lit photo of your face. Square.
          </p>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={pick}
        className="hidden"
      />
    </div>
  );
}

/* ------------------------------------------------------------------- skills */

/** Short, flat list. No reordering: six rows is not enough to be worth a drag
 *  handle, and the template does not read anything into their order. */
function Skills({
  skills,
  onChange,
}: {
  skills: PortfolioSkill[];
  onChange: (next: PortfolioSkill[]) => void;
}) {
  const patch = (id: string, next: Partial<PortfolioSkill>) =>
    onChange(skills.map((s) => (s.id === id ? { ...s, ...next } : s)));

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-center justify-between gap-4">
        <Label>Skills</Label>
        {skills.length < MAX_SKILLS && (
          <button
            type="button"
            className={QUIET}
            onClick={() =>
              onChange([...skills, { id: rowId("sk"), name: "", detail: "" }])
            }
          >
            Add skill
          </button>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {skills.map((s, i) => (
          <div
            key={s.id}
            className="rounded-md border border-line bg-shell px-4 py-4"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="text-[12px] font-semibold text-ink-50">
                Skill {i + 1}
              </span>
              <RemoveButton
                label={`Remove skill ${i + 1}`}
                onClick={() => onChange(skills.filter((x) => x.id !== s.id))}
              />
            </div>
            {/* the hints only ride the first row. repeated six times they stop
                being help and start being noise. */}
            <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr]">
              <Field
                spec={PORTFOLIO_FIELDS.skillName}
                value={s.name}
                onChange={(v) => patch(s.id, { name: v })}
                showHint={i === 0}
              />
              <Field
                spec={PORTFOLIO_FIELDS.skillDetail}
                value={s.detail}
                onChange={(v) => patch(s.id, { detail: v })}
                showHint={i === 0}
              />
            </div>
          </div>
        ))}

        {skills.length === 0 && (
          <Empty>Nothing yet. Three or four is plenty.</Empty>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ socials */

/**
 * Six marks in a row. Tap one, type the handle.
 *
 * Six labelled rows, always on screen, cost six input boxes and a column of
 * labels for a creator who has two accounts. The platforms are a row of glyphs
 * instead — the same ones the public page draws, so the mark you press is the
 * mark that shows up — and only the ones with a handle get an input. Pressing
 * an added platform again removes it. The schema caps socials at one per
 * platform, so a mark cannot be added twice.
 */
function Socials({
  socials,
  onChange,
}: {
  socials: PortfolioSocial[];
  onChange: (next: PortfolioSocial[]) => void;
}) {
  /**
   * The mark tapped in THIS mount, and the only input allowed to steal focus.
   *
   * `autoFocus` on every empty handle is right in a form that is mounted once:
   * tapping Instagram should put the cursor in the box that just appeared. It
   * is wrong here, because leaving Contact for another step unmounts the whole
   * panel, and coming back would fire autoFocus again on a handle nobody was
   * typing, yanking the page to it. State rather than a ref, because the row
   * has to render with the flag already set on the same pass that adds it.
   */
  const [focusOn, setFocusOn] = useState<SocialPlatform | null>(null);

  /** rebuilt in SOCIAL_PLATFORMS order every time, so adding a platform never
   *  reshuffles the marks already on the public page. */
  const write = (all: PortfolioSocial[]) => {
    const ordered: PortfolioSocial[] = [];
    for (const p of SOCIAL_PLATFORMS) {
      const hit = all.find((s) => s.platform === p.key);
      if (hit) ordered.push(hit);
    }
    onChange(ordered);
  };

  const set = (platform: SocialPlatform, handle: string) =>
    write([...socials.filter((s) => s.platform !== platform), { platform, handle }]);

  const toggle = (platform: SocialPlatform) => {
    const on = socials.some((s) => s.platform === platform);
    setFocusOn(on ? null : platform);
    write(
      on
        ? socials.filter((s) => s.platform !== platform)
        : [...socials, { platform, handle: "" }]
    );
  };

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Socials</Label>
        <span className="text-[12px] text-ink-50">tap to add</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {SOCIAL_PLATFORMS.map((p) => {
          const on = socials.some((s) => s.platform === p.key);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => toggle(p.key)}
              aria-pressed={on}
              aria-label={p.label}
              title={p.label}
              className={`grid size-10 place-items-center rounded-md border transition-colors ${
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-ink-50 hover:border-ink-50 hover:text-ink"
              }`}
            >
              <PlatformGlyph name={p.key} />
            </button>
          );
        })}
      </div>

      {socials.length > 0 && (
        <div className="mt-3 space-y-2">
          {socials.map((s) => {
            const meta = SOCIAL_PLATFORMS.find((p) => p.key === s.platform);
            if (!meta) return null;
            return (
              <div
                key={s.platform}
                className="flex items-center rounded-md border border-line bg-shell px-3 focus-within:border-ink"
              >
                <span className="shrink-0 text-ink-50" aria-hidden="true">
                  <PlatformGlyph name={s.platform} />
                </span>
                {meta.prefix && (
                  <span className="shrink-0 pl-2 text-[14.5px] text-ink-50">
                    {meta.prefix}
                  </span>
                )}
                <input
                  value={s.handle}
                  maxLength={PORTFOLIO_FIELDS.handle.max}
                  placeholder={PORTFOLIO_FIELDS.handle.placeholder}
                  aria-label={meta.label}
                  autoFocus={focusOn === s.platform && !s.handle}
                  onChange={(e) => set(s.platform, e.target.value)}
                  className={`w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none ${meta.prefix ? "" : "pl-2"}`}
                />
                <RemoveButton
                  label={`Remove ${meta.label}`}
                  onClick={() => toggle(s.platform)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The same marks the public page draws, at form size.
 *
 * Deliberately a second copy of the paths rather than an import from
 * portfolio-site: that file's glyph reads `--pf-accent`, which only exists
 * inside a themed portfolio, and this one has to take the form's own colours.
 * The shapes are the shapes; if one is corrected, correct both.
 */
function PlatformGlyph({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[17px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "instagram" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
        </>
      )}
      {name === "tiktok" && (
        <>
          <path d="M14 3v11.2a3.8 3.8 0 1 1-3.2-3.75" />
          <path d="M14 3a5.6 5.6 0 0 0 5.4 4.4" />
        </>
      )}
      {name === "youtube" && (
        <>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" strokeWidth="1.2" />
        </>
      )}
      {name === "x" && <path d="m4 4 16 16M20 4 4 20" />}
      {name === "linkedin" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M7.4 10.6V17M7.4 7.4v.02M11.6 17v-3.6a2.2 2.2 0 0 1 4.4 0V17" />
        </>
      )}
      {name === "website" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3.2 9.6h17.6M3.2 14.4h17.6" />
          <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
        </>
      )}
    </svg>
  );
}

/* -------------------------------------------------------------------- clips */

function Clips({
  clips,
  userId,
  onChange,
  footer,
}: {
  clips: PortfolioClip[];
  userId: string;
  onChange: (next: PortfolioClip[]) => void;
  footer: ReactNode;
}) {
  const full = clips.length >= MAX_CLIPS;

  return (
    <Panel
      title="Work"
      sub={`up to ${MAX_CLIPS} clips. the ones a brand watches first.`}
      footer={footer}
      action={
        full ? undefined : (
          <button
            type="button"
            className={QUIET}
            onClick={() =>
              onChange([
                ...clips,
                {
                  id: rowId("cl"),
                  title: "",
                  brand: "",
                  result: "",
                  videoUrl: "",
                  posterUrl: "",
                  linkUrl: "",
                },
              ])
            }
          >
            Add clip
          </button>
        )
      }
    >
      <div className="space-y-4">
        {clips.map((c, i) => (
          <ClipRow
            key={c.id}
            clip={c}
            index={i}
            userId={userId}
            onChange={(next) =>
              onChange(clips.map((x) => (x.id === c.id ? { ...x, ...next } : x)))
            }
            onRemove={() => onChange(clips.filter((x) => x.id !== c.id))}
          />
        ))}

        {clips.length === 0 && (
          <Empty>No clips yet. Add one and it shows up in the preview.</Empty>
        )}

        {full && (
          <p className="text-[13px] leading-[1.55] text-ink-50">
            Three is the cap. A few strong pieces land better than a wall of
            average ones, and a brand watching your page never gets to the
            fourth.
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * One clip. Upload the file or paste the link, never both required.
 *
 * The upload state and its error live on the row rather than in a banner at the
 * top of the form: with three rows that can each be mid-upload, a shared error
 * line cannot say which one failed. There is no percentage because uploadClip
 * reports none, and a fake one is worse than an honest spinner.
 */
function ClipRow({
  clip,
  index,
  userId,
  onChange,
  onRemove,
}: {
  clip: PortfolioClip;
  index: number;
  userId: string;
  onChange: (next: Partial<PortfolioClip>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = takeFile(e);
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const { videoUrl, posterUrl } = await uploadClip(file, userId);
      onChange({ videoUrl, posterUrl });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const linked = clip.linkUrl.trim();
  const canImport = Boolean(importable(clip.linkUrl));

  /** the same busy flag and error line as an upload, because to the creator it
   *  is the same thing happening: a file arriving in their storage. */
  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await importClip(clip.linkUrl);
      if (!res.ok) setError(res.error);
      else onChange({ videoUrl: res.videoUrl, posterUrl: res.posterUrl });
    } catch {
      setError("Could not import that clip. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-line bg-shell p-3">
      <div className="flex items-start gap-3">
        {/* 9:16, because that is what every one of these clips is. it doubles
            as the upload button, so the row loses a pill and the thing you
            click is the thing that changes. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label={clip.videoUrl ? "Replace video" : "Upload video"}
          className="relative h-[86px] w-[48px] shrink-0 overflow-hidden rounded-md border border-line bg-paper text-ink-50 transition-colors hover:border-ink hover:text-ink"
        >
          {clip.posterUrl ? (
            // storage url, no domain to whitelist
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clip.posterUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center">
              <Play />
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-paper/70">
              <Spinner />
            </span>
          )}
        </button>

        <div className="grid min-w-0 flex-1 gap-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Field
                spec={PORTFOLIO_FIELDS.clipTitle}
                value={clip.title}
                onChange={(v) => onChange({ title: v })}
                compact
              />
            </div>
            <RemoveButton
              label={`Remove clip ${index + 1}`}
              onClick={onRemove}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              spec={PORTFOLIO_FIELDS.clipBrand}
              value={clip.brand}
              onChange={(v) => onChange({ brand: v })}
              compact
            />
            <Field
              spec={PORTFOLIO_FIELDS.clipResult}
              value={clip.result}
              onChange={(v) => onChange({ result: v })}
              compact
            />
          </div>

          <Field
            spec={PORTFOLIO_FIELDS.clipLink}
            value={clip.linkUrl}
            onChange={(v) => onChange({ linkUrl: v })}
            compact
          />

          {/* The one control that matters on a pasted link.
              TikTok and Instagram do not embed a player, they embed a card
              with their own header, follow button and caption bar around the
              clip. Importing pulls the file itself into your storage, and from
              then on it is the same as a clip you uploaded: your page, your
              player, nothing else in the frame. */}
          {canImport && !clip.videoUrl && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="h-8 shrink-0 rounded-md bg-ink px-3.5 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink/85 disabled:opacity-40"
              >
                {busy ? "Importing" : "Import video"}
              </button>
              <span className="text-[12px] leading-[1.45] text-ink-50">
                pulls the file in so it plays without the app&rsquo;s branding
              </span>
            </div>
          )}
          {linked && !canImport && !clip.videoUrl && (
            <p
              className={`text-[12px] leading-[1.45] ${
                embeds(clip.linkUrl) ? "text-ink-50" : "text-flame-dark"
              }`}
            >
              {embeds(clip.linkUrl)
                ? "Plays on your page."
                : "Opens in a new tab only. Paste the full post url to have it play here."}
            </p>
          )}
          {!linked && !clip.videoUrl && (
            <p className="text-[12px] leading-[1.45] text-ink-50">
              Tap the tile to upload, or paste a TikTok, Reel, YouTube or Drive
              link.
            </p>
          )}
          {clip.videoUrl && !busy && (
            <button
              type="button"
              onClick={() => onChange({ videoUrl: "", posterUrl: "" })}
              className="justify-self-start text-[12px] font-semibold text-ink-50 transition-colors hover:text-ink"
            >
              Remove video
            </button>
          )}
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={pick}
        className="hidden"
      />
    </div>
  );
}

/* ------------------------------------------------------------------- brands */

/**
 * Brands, picked rather than typed.
 *
 * A logo wall only works when the logos are the real ones, and a creator with a
 * phone is not going to find a clean transparent PNG of a brand they shot for.
 * The curated list is the fast path; typing a name and picking a colour is the
 * one underneath it, and it is a real path rather than a consolation. A brand
 * drawn as its initial on a colour it chose is a mark. Hunting for a png, being
 * told the file is 4MB, and giving up is an empty section.
 *
 * Uploading a logo is still there, but it is the third option rather than the
 * price of entry: a form that disabled everything until a file was picked meant
 * a brand nobody had a file for simply could not be added.
 */
function Brands({
  clients,
  userId,
  onChange,
  footer,
}: {
  clients: PortfolioClient[];
  userId: string;
  onChange: (next: PortfolioClient[]) => void;
  footer: ReactNode;
}) {
  // one box, two jobs: what is typed narrows the catalogue AND is the name of a
  // brand that is not in it. there is no second "add your own" field to keep in
  // sync with this one.
  const [query, setQuery] = useState("");
  const [ownColor, setOwnColor] = useState<string>(BRAND_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const full = clients.length >= MAX_CLIENTS;
  const named = query.trim();

  const results = useMemo(() => {
    const taken = new Set(
      clients
        .map((c) => c.catalogKey)
        .filter((k): k is string => typeof k === "string")
    );
    // an empty box shows the catalogue rather than nothing, so the picker is
    // usable before anyone knows what is in it
    const pool = query.trim() ? searchBrands(query) : CURATED_BRANDS;
    return pool.filter((b) => !taken.has(b.key)).slice(0, 12);
  }, [query, clients]);

  const add = (client: Omit<PortfolioClient, "id">) => {
    onChange([...clients, { id: rowId("cb"), ...client }]);
    setQuery("");
    setError(null);
  };

  /** the typed name, as its own brand. a name the catalogue does know still
   *  arrives with that logo, so typing "candle" and pressing enter is the same
   *  brand as clicking Candle in the row below. */
  const addOwn = () => {
    const match = matchCuratedBrand(named);
    add(
      match
        ? { name: match.name, logoUrl: match.logo, color: "", catalogKey: match.key }
        : { name: named, logoUrl: "", color: ownColor, catalogKey: null }
    );
  };

  const addWithLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = takeFile(e);
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const logoUrl = await uploadClientLogo(file, userId);
      // the colour rides along even with a logo, so clearing a broken file
      // later leaves a mark rather than a grey square
      add({ name: named, logoUrl, color: ownColor, catalogKey: null });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Brands"
      sub="the row of marks under your work."
      footer={footer}
    >
      {clients.length > 0 && (
        <div className="mb-5 grid gap-2 sm:grid-cols-2">
          {clients.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-2.5 rounded-md border border-line bg-shell py-2 pl-2.5 pr-1.5"
            >
              <BrandMark name={c.name} logoUrl={c.logoUrl} color={c.color} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold tracking-[-0.015em]">
                {c.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(clients.filter((x) => x.id !== c.id))}
                aria-label={`Remove ${c.name}`}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-50 transition-colors hover:bg-ember hover:text-flame"
              >
                <Cross />
              </button>
            </div>
          ))}
        </div>
      )}

      {full ? (
        <p className="text-[13px] leading-[1.55] text-ink-50">
          That is {MAX_CLIENTS}, the most a brand row can hold before it stops
          reading as one. Remove one to add another.
        </p>
      ) : (
        <>
          {/* One box does both jobs: it searches the catalogue and it is the
              name of a brand the catalogue has never heard of. Two separate
              boxes, one for finding and one for adding, meant reading both
              before typing either. */}
          <div className="flex items-center gap-2 rounded-md border border-line bg-shell px-2.5 focus-within:border-ink">
            {named ? (
              <span
                className="grid size-8 shrink-0 place-items-center rounded-md text-[13px] font-extrabold"
                style={{ background: ownColor, color: onAccent(ownColor) }}
                aria-hidden="true"
              >
                {named.charAt(0).toUpperCase()}
              </span>
            ) : (
              <span className="shrink-0 text-ink-50">
                <Search />
              </span>
            )}
            <input
              value={query}
              maxLength={PORTFOLIO_FIELDS.clientName.max}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // this panel sits inside the editor. enter here means "add the
                // brand", never "save the portfolio".
                e.preventDefault();
                if (named) addOwn();
              }}
              placeholder="Search brands, or type a new one"
              aria-label="Search or name a brand"
              className="w-full bg-transparent py-2.5 text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none"
            />
            {named && (
              <button
                type="button"
                onClick={addOwn}
                className="h-8 shrink-0 rounded-md bg-ink px-3.5 text-[12.5px] font-semibold text-paper transition-colors hover:bg-ink/85"
              >
                Add
              </button>
            )}
          </div>

          {/* the swatches only matter once there is a name to colour, so they
              stay out of the panel until then */}
          {named && (
            <div
              className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2"
              role="group"
              aria-label="Brand colour"
            >
              <div className="flex flex-wrap gap-1.5">
                {BRAND_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setOwnColor(c)}
                    aria-label={`Colour ${c}`}
                    aria-pressed={c === ownColor}
                    style={{ background: c }}
                    className={`size-6 rounded-full transition-transform ${
                      c === ownColor
                        ? "ring-2 ring-ink ring-offset-2 ring-offset-paper"
                        : "hover:scale-110"
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => logoRef.current?.click()}
                disabled={busy}
                className="text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-ink disabled:opacity-40"
              >
                {busy ? "Uploading" : "or use a logo"}
              </button>
            </div>
          )}

          {results.length > 0 && (
            <div className="no-scrollbar mt-3 flex max-h-[168px] flex-wrap gap-1.5 overflow-y-auto">
              {results.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => {
                    add({
                      name: b.name,
                      logoUrl: b.logo,
                      color: "",
                      catalogKey: b.key,
                    });
                    setQuery("");
                  }}
                  className="flex items-center gap-2 rounded-pill border border-line py-1 pl-1 pr-3 transition-colors hover:border-ink"
                >
                  <BrandMark name={b.name} logoUrl={b.logo} color="" size={7} />
                  <span className="max-w-[130px] truncate text-[12.5px] font-semibold">
                    {b.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && <ErrorLine>{error}</ErrorLine>}

          <input
            ref={logoRef}
            type="file"
            accept="image/*"
            onChange={addWithLogo}
            className="hidden"
          />
        </>
      )}
    </Panel>
  );
}

/** The logo if there is one, otherwise the initial on the brand's colour.
 *  contain, never cover: a cropped wordmark is worse than a small one. */
function BrandMark({
  name,
  logoUrl,
  color,
  size = 9,
}: {
  name: string;
  logoUrl: string;
  color: string;
  /** tailwind size step: 9 for a list row, 7 for a chip in the catalogue. */
  size?: 7 | 9;
}) {
  const box = size === 7 ? "size-7 rounded-full" : "size-9 rounded-md";

  if (!logoUrl) {
    const fill = brandColor(name, color);
    return (
      <span
        className={`grid ${box} shrink-0 place-items-center text-[13px] font-extrabold`}
        style={{ background: fill, color: onAccent(fill) }}
        aria-hidden="true"
      >
        {(name.trim() || "?").charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <span className={`grid ${box} shrink-0 place-items-center overflow-hidden bg-white`}>
      {/* catalogue and storage urls both, so no fixed domain to whitelist */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logoUrl} alt="" className="size-full object-contain p-[3px]" />
    </span>
  );
}

/* --------------------------------------------------------------------- look */

/**
 * Theme, and nothing else.
 *
 * One template dressed three ways. Every control here writes a value the
 * template reads as a CSS variable, so the preview repaints on the click with
 * no reload and no second rendering path to keep in sync. No hints under the
 * labels: the preview is the explanation, and a sentence describing something
 * the creator can already watch happen tripled the height of the panel.
 */
function Look({
  theme,
  onChange,
  footer,
}: {
  theme: PortfolioTheme;
  onChange: (patch: Partial<PortfolioTheme>) => void;
  footer: ReactNode;
}) {
  const custom = !ACCENT_PRESETS.some((a) => a === theme.accent);

  return (
    <Panel
      title="Look"
      sub="watch the preview, not the labels."
      footer={footer}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label>Accent</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {ACCENT_PRESETS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onChange({ accent: a })}
              aria-label={`Accent ${a}`}
              aria-pressed={theme.accent === a}
              className={`size-6 rounded-full transition-transform hover:scale-110 ${
                theme.accent === a
                  ? "ring-2 ring-ink ring-offset-2 ring-offset-paper"
                  : ""
              }`}
              style={{ background: a }}
            />
          ))}

          {/* the native picker is the escape hatch. it is also its own swatch,
              so a colour that is not in the presets still shows as selected. */}
          <label
            className={`relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-line ${
              custom ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""
            }`}
            style={custom ? { background: theme.accent } : undefined}
          >
            {!custom && (
              <span
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "conic-gradient(#00008b,#2fa14d,#f0c000,#ec5a29,#be123c,#6d28d9,#00008b)",
                }}
              />
            )}
            <input
              type="color"
              value={theme.accent}
              onChange={(e) => onChange({ accent: e.target.value })}
              aria-label="Custom accent"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label>Font</Label>
        <div className="flex flex-wrap gap-1.5">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onChange({ font: f.key })}
              aria-pressed={theme.font === f.key}
              title={f.note}
              // set in its own face, which is the only description a typeface
              // needs and the one thing a sentence cannot do
              style={{ fontFamily: `var(--pf-font-${f.key})` }}
              className={`h-9 rounded-md border px-3.5 text-[14px] transition-colors ${
                theme.font === f.key
                  ? "border-ink bg-ink text-paper"
                  : "border-line text-ink-70 hover:border-ink-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Label>Background</Label>
        <div className="flex flex-wrap gap-1.5">
          {SURFACES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ surface: s.key })}
              aria-pressed={theme.surface === s.key}
              className={`h-9 rounded-md border px-4 text-[13px] font-semibold transition-colors ${
                theme.surface === s.key
                  ? "border-ink ring-2 ring-ink/15"
                  : "border-line hover:border-ink-50"
              }`}
              // painted from themeVars rather than a second copy of the palette,
              // so a surface tweaked in portfolio-theme cannot go stale here
              style={themeVars({ ...theme, surface: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ publish */

/**
 * The address and the switch that makes it real.
 *
 * The publish toggle is gated on the required gaps rather than warning after
 * the fact, because a live page with no name and no email is worse than no page
 * at all. Everything else is a nudge: the meter and its checklist say what would
 * make the page better and never block anything.
 */
function PublishPanel({
  slug,
  published,
  gaps,
  score,
  onSlug,
  onPublished,
  footer,
}: {
  slug: string;
  published: boolean;
  gaps: { required: string[]; suggested: string[] };
  score: number;
  onSlug: (v: string) => void;
  onPublished: (v: boolean) => void;
  footer: ReactNode;
}) {
  const problem = slugProblem(slug);
  const blocked = gaps.required.length > 0;

  return (
    <Panel
      title="Publish"
      sub="the address, and the switch that makes it real."
      footer={footer}
    >
      <Field
        spec={PORTFOLIO_FIELDS.slug}
        value={slug}
        onChange={onSlug}
        prefix={`${brand.domain}/`}
      />
      {problem && <ErrorLine>{problem}</ErrorLine>}

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-line pt-5">
        <div className="min-w-0">
          <p className="text-[14.5px] font-bold tracking-[-0.01em]">Publish</p>
          <p className="mt-0.5 text-[13px] leading-[1.5] text-ink-50">
            {blocked
              ? "A couple of things first:"
              : published
                ? "Anyone with the link can see it."
                : "Off. Only you can see it."}
          </p>
          {blocked && (
            <ul className="mt-2 space-y-1">
              {gaps.required.map((g) => (
                <li key={g} className="text-[13px] font-semibold text-flame-dark">
                  {g}
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={published}
          aria-label="Publish"
          disabled={blocked}
          onClick={() => onPublished(!published)}
          className={`flex h-6 w-11 shrink-0 items-center rounded-pill p-0.5 transition-colors disabled:opacity-40 ${
            published ? "bg-ink" : "bg-line"
          }`}
        >
          <span
            className={`size-5 rounded-full bg-paper shadow-card transition-transform ${
              published ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-4">
          <Label>Ready</Label>
          <span className="text-[11px] font-semibold tabular-nums text-ink-50">
            {score}%
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-shell">
          <div
            className="h-full rounded-pill bg-ink transition-[width] duration-300"
            style={{ width: `${score}%` }}
          />
        </div>
        {gaps.suggested.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {gaps.suggested.map((g) => (
              <li
                key={g}
                className="flex items-center gap-2 text-[13px] text-ink-50"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-line" />
                {g}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------------------- bits */

/** Every label, hint, placeholder and ceiling in this form comes out of
 *  PORTFOLIO_FIELDS. Nothing here types its own copy, which is what lets an AI
 *  pass later read the same table and know exactly what it may write. */
type FieldSpec = (typeof PORTFOLIO_FIELDS)[keyof typeof PORTFOLIO_FIELDS];

/** The same input chrome as components/dash/form.tsx — shell fill, line
 *  border, ink on focus — plus a textarea mode and the hint line that makes
 *  each section self-describing. */
function Field({
  spec,
  value,
  onChange,
  prefix,
  rows,
  showHint = true,
  compact = false,
}: {
  spec: FieldSpec;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  rows?: number;
  showHint?: boolean;
  /** label and counter off, placeholder carries the meaning. For rows of short
   *  fields where a label over every box is more chrome than content. */
  compact?: boolean;
}) {
  const shared =
    "w-full bg-transparent text-[14.5px] font-medium placeholder:font-normal placeholder:text-ink-50/70 focus:outline-none";

  return (
    <div className="min-w-0">
      {!compact && (
        <>
          <div className="flex items-center justify-between gap-2">
            <Label>{spec.label}</Label>
            <span className="text-[11px] tabular-nums text-ink-50">
              {value.length}/{spec.max}
            </span>
          </div>
          {showHint && <Hint>{spec.hint}</Hint>}
        </>
      )}
      <div
        className={`flex items-start rounded-md border border-line bg-shell px-3.5 focus-within:border-ink ${compact ? "" : "mt-1.5"}`}
      >
        {prefix && (
          <span className="shrink-0 whitespace-nowrap py-2.5 text-[14.5px] text-ink-50">
            {prefix}
          </span>
        )}
        {rows ? (
          <textarea
            value={value}
            rows={rows}
            maxLength={spec.max}
            placeholder={spec.placeholder}
            aria-label={spec.label}
            onChange={(e) => onChange(e.target.value)}
            className={`${shared} no-scrollbar resize-none py-2.5 leading-[1.55]`}
          />
        ) : (
          <input
            value={value}
            maxLength={spec.max}
            placeholder={spec.placeholder}
            aria-label={spec.label}
            onChange={(e) => onChange(e.target.value)}
            className={`${shared} py-2.5`}
          />
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-ink-50">
      {children}
    </span>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 text-[12.5px] leading-[1.45] text-ink-50">{children}</p>
  );
}

function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-[12.5px] font-semibold leading-[1.45] text-flame-dark">
      {children}
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-[14px] text-ink-50">{children}</p>;
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-50 transition-colors hover:bg-ember hover:text-flame"
    >
      <Cross />
    </button>
  );
}

/* -------------------------------------------------------------------- icons */

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 animate-spin" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        className="text-line"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        className="text-ink"
      />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="m5 12.5 4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Play() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path d="M9 6.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

function Search() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ helpers */

/**
 * Pull the file off a native input and clear it in the same breath. Without the
 * reset, picking the same file twice fires no change event, so a failed upload
 * could never be retried with the exact file that failed.
 */
function takeFile(e: ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0] ?? null;
  e.target.value = "";
  return file;
}

/** The upload helpers throw readable Errors. Anything else is a bug, and a bug
 *  should still leave the creator a sentence rather than a blank space. */
function messageOf(err: unknown) {
  return err instanceof Error && err.message
    ? err.message
    : "That did not work. Try again.";
}
