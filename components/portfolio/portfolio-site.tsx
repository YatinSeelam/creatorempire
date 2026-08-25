/* eslint-disable @next/next/no-img-element -- every image here is an arbitrary
   remote url: an avatar in supabase storage, a poster frame, a logo out of the
   brand catalog. next.config declares no remotePatterns, so next/image would
   refuse them at request time. */

import { BrandTile } from "@/components/portfolio/brand-tile";
import { clipEmbed } from "@/lib/portfolio-embed";
import {
  SOCIAL_PLATFORMS,
  type Portfolio,
  type PortfolioClip,
} from "@/lib/portfolio-schema";
import { portfolioFontVars } from "@/lib/portfolio-fonts";
import { themeVars } from "@/lib/portfolio-theme";
import type { PortfolioAgency } from "@/lib/org-overrides";

/**
 * The portfolio template. One component, two homes.
 *
 * The public route at `/<slug>` renders it, and so does the phone inside the
 * editor, live, on every keystroke. That single fact explains the two rules this
 * file never breaks:
 *
 * 1. Container queries, not breakpoints. The editor shows the page at ~312px
 *    inside a phone frame while the browser window is 1600px wide. `sm:` and
 *    `lg:` read the window, so the preview would lay itself out as a desktop
 *    page squeezed into a phone. `@container` on the root plus `@md:` / `@2xl:`
 *    variants measure the element the page is actually drawn in, which is the
 *    only number that means anything here.
 *
 * 2. CSS variables, not Tailwind colours. The accent is a hex a creator picked
 *    at runtime and Tailwind cannot compile a class it has never seen. Every
 *    colour on this page comes out of `themeVars` as a `--pf-*` variable on the
 *    root and is read back as `text-[var(--pf-text)]` and friends.
 *
 * It is also pure: no "use client", no async, no server-only import, so the
 * client-side editor can import it as-is.
 *
 * Every section below hides itself when it has nothing to say. A creator who has
 * filled in only their name gets a page with only their name on it, not a
 * skeleton of empty headings waiting to be filled.
 */

type Mode = "live" | "preview";

const PLATFORMS = new Map(SOCIAL_PLATFORMS.map((p) => [p.key, p] as const));

type ContactLink = {
  key: string;
  label: string;
  href: string;
  external: boolean;
};

export function PortfolioSite({
  portfolio,
  mode = "live",
  agency = null,
}: {
  portfolio: Portfolio;
  mode?: Mode;
  /**
   * The workspace this creator sits on, when its founder set portfolios up
   * (lib/org-overrides.ts). Two touches and no more: a line under the name and
   * the sign-off at the foot. The creator's own theme, copy and layout are
   * theirs; an agency does not get to redesign a page that carries somebody
   * else's name.
   */
  agency?: PortfolioAgency | null;
}) {
  const p = portfolio;

  // Instrument Serif ships a single weight. Asking a browser for 800 makes it
  // smear the 400 sideways, and faux bold on a display serif reads as a
  // rendering fault rather than emphasis.
  const serif = p.theme.font === "serif";
  const display = serif ? "font-normal" : "font-extrabold";
  const strong = serif ? "font-normal" : "font-bold";

  const contacts = contactLinks(p);
  const hasMeta = Boolean(p.location || p.cohort);
  const hasAbout = Boolean(p.about || p.background);
  const hasContact = contacts.length > 0;

  // the accent hairline closes the hero off from the rest. with nothing after
  // it, it would just be a line hanging under a name.
  const hasBody =
    hasAbout ||
    p.skills.length > 0 ||
    p.clips.length > 0 ||
    p.clients.length > 0 ||
    hasContact;

  return (
    <div
      className={`${portfolioFontVars} @container w-full`}
      style={themeVars(p.theme)}
    >
      {/* The column, and the fact that it is a column, is the layout.

          This used to run the full width of whatever it was dropped into: 940px
          on the public route, 1440 in the preview frame. Left-aligned prose in a
          box that wide is a paragraph pinned to one edge with half a screen of
          nothing beside it, which reads as a broken page rather than a spacious
          one. Capped at 760 and centred, the same content is a page. */}
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-14 px-5 py-12 @2xl:gap-[72px] @2xl:px-8 @2xl:py-20">
        {/* hero.

            Centred, and so is everything under it. A portfolio is read in one
            pass on a phone by someone deciding whether to reply, so the page is
            built as one narrow centred column at every width instead of a
            desktop layout that collapses into one. Nothing has to move. */}
        <header className="flex flex-col items-center text-center">
          {(p.avatarUrl || p.name) && (
            <div className="shrink-0">
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt={p.name}
                  referrerPolicy="no-referrer"
                  className="aspect-square size-[88px] rounded-full object-cover ring-2 ring-[var(--pf-accent-line)] ring-offset-4 ring-offset-[var(--pf-bg)] @2xl:size-[112px]"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className={`flex aspect-square size-[88px] items-center justify-center rounded-full bg-[var(--pf-accent-soft)] text-[30px] leading-none text-[var(--pf-text)] ring-2 ring-[var(--pf-accent-line)] ring-offset-4 ring-offset-[var(--pf-bg)] @2xl:size-[112px] @2xl:text-[38px] ${display}`}
                >
                  {p.name.trim().charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          )}

          {p.name && (
            <h1
              className={`mt-6 text-balance text-[32px] leading-[1.05] tracking-[-0.035em] @md:text-[40px] @2xl:text-[52px] ${display}`}
            >
              {p.name}
            </h1>
          )}

          {p.role && (
            <p className="mt-3 max-w-[40ch] text-balance text-[15px] font-medium leading-[1.45] text-[var(--pf-text)] @2xl:text-[18px]">
              {p.role}
            </p>
          )}

          {agency?.badge && (
            <p className="mt-3 inline-flex items-center rounded-full border border-[var(--pf-accent-line)] bg-[var(--pf-accent-soft)] px-3 py-1 text-[12px] font-medium text-[var(--pf-text)]">
              {agency.badge}
            </p>
          )}

          {hasMeta && (
            <p className="mt-3 text-[12.5px] uppercase tracking-[0.12em] text-[var(--pf-muted)]">
              {[p.location, p.cohort].filter(Boolean).join(" · ")}
            </p>
          )}

          {hasContact && (
            <div className="mt-6 flex max-w-full flex-wrap justify-center gap-2">
              {contacts.map((c) => (
                <Anchor
                  key={c.key}
                  link={c}
                  mode={mode}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--pf-line)] py-1.5 pl-2.5 pr-3.5 text-[12.5px] font-semibold text-[var(--pf-text)] transition-colors hover:border-[var(--pf-accent-line)]"
                >
                  <ContactGlyph name={c.key} />
                  <span className="truncate">{c.label}</span>
                </Anchor>
              ))}
            </div>
          )}
        </header>

        {/* A short accent rule rather than a full-width hairline. Centred, a
            line that runs edge to edge cuts the page in two; a stub under the
            hero closes it off and points at what follows. */}
        {hasBody && (
          <div
            aria-hidden="true"
            className="mx-auto h-[3px] w-10 rounded-full bg-[var(--pf-accent)]"
          />
        )}

        {/* about */}
        {hasAbout && (
          <section className="text-center">
            <SectionLabel>About</SectionLabel>
            {p.about && (
              <p className="mx-auto mt-5 max-w-[56ch] whitespace-pre-line text-[15px] leading-[1.7] text-[var(--pf-text)] @2xl:text-[17px]">
                {p.about}
              </p>
            )}
            {p.background && (
              <div className="mt-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-muted)]">
                  Background
                </p>
                <p className="mx-auto mt-2 max-w-[56ch] whitespace-pre-line text-[14px] leading-[1.7] text-[var(--pf-muted)] @2xl:text-[15px]">
                  {p.background}
                </p>
              </div>
            )}
          </section>
        )}

        {/* skills.

            Cards rather than a bare two-column list. Centred text with nothing
            around it floats, and a skill with no detail line next to one with
            two ends up looking like a layout fault. A box around each gives the
            column an edge to sit against and makes the uneven heights read as
            cards of different lengths, which is what they are. */}
        {p.skills.length > 0 && (
          <section>
            <SectionLabel>Skills</SectionLabel>
            {/* wrap-and-centre rather than a grid. one skill in a two-column
                grid is a card pinned to the left of an empty half, and a
                creator adding their first one should not have to add a second
                to stop the page looking broken. */}
            <div className="mt-5 flex flex-wrap justify-center gap-3 @2xl:gap-4">
              {p.skills.map((s) => (
                <div
                  key={s.id}
                  className="w-full rounded-[16px] border border-[var(--pf-line)] bg-[var(--pf-panel)] px-5 py-4 text-center @md:w-[calc(50%-6px)] @2xl:px-6 @2xl:py-5 @2xl:w-[calc(50%-8px)]"
                >
                  <p
                    className={`text-[15px] tracking-[-0.01em] text-[var(--pf-text)] @2xl:text-[16px] ${strong}`}
                  >
                    {s.name}
                  </p>
                  {s.detail && (
                    <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--pf-muted)]">
                      {s.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* work */}
        {p.clips.length > 0 && (
          <section>
            <SectionLabel>Work</SectionLabel>
            {/* narrow: a snapping row that bleeds past the page padding, so the
                next tile peeks and the swipe is obvious. wide: three across. */}
            {/* The max-width is the whole reason this looks like a portfolio
                and not a video wall. Three 9:16 tiles across a 940px page come
                out 480px tall each and eat an entire screen; capped at 660 they
                sit at phone proportions, which is what these clips actually
                are. */}
            {/* narrow: one clip per row, centred, at a size worth watching.
                It used to be a sideways snap scroller of 62%-wide tiles, which
                is the shape a feed of forty thumbnails wants; three clips do
                not need paging, and a phone is where a brand actually watches
                these, so each one gets the width of the screen and the next is
                a scroll away rather than a swipe.

                wide: wrap and centre, so one clip sits in the middle of the
                page rather than in the left third of an empty row. */}
            <div className="mt-5 flex flex-col items-center gap-7 @2xl:mx-auto @2xl:max-w-[620px] @2xl:flex-row @2xl:flex-wrap @2xl:justify-center @2xl:gap-5">
              {p.clips.map((clip) => (
                <Clip
                  key={clip.id}
                  clip={clip}
                  mode={mode}
                  strong={strong}
                />
              ))}
            </div>
          </section>
        )}

        {/* clients.

            A list of names with marks, not a logo wall. The wall needed every
            logo to be a clean transparent file of roughly the same proportion,
            and real ones are a square app icon, a wide wordmark and a jpeg with
            a white block baked in, so it came out as five tall boxes with
            something small floating in each. A row per brand is legible however
            bad the file is, survives having no file at all, and drops to two
            columns on a phone without leaving holes. */}
        {p.clients.length > 0 && (
          // A tinted band, not another run of the page. This is the proof
          // section, the one thing on here a brand scans for before it reads a
          // word, and giving it its own ground is what makes it findable in the
          // two seconds it gets.
          <section className="rounded-[20px] border border-[var(--pf-line)] bg-[var(--pf-well)] px-4 py-7 @2xl:px-8 @2xl:py-9">
            <SectionLabel>Brands I have worked with</SectionLabel>
            {/* wrap-and-centre, so an eleventh brand leaves a centred row of
                three rather than three tiles and a hole. */}
            <div className="mt-5 flex flex-wrap justify-center gap-2.5">
              {p.clients.map((c) => (
                <div
                  key={c.id}
                  className="w-[calc(50%-5px)] @md:w-[calc(33.333%-7px)] @4xl:w-[calc(25%-8px)]"
                >
                  <BrandTile
                    name={c.name}
                    logoUrl={c.logoUrl}
                    color={c.color}
                    strong={strong}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* contact / cta.

            Centred, unlike every section above it. Left aligned, the button sat
            in the top corner of a very wide panel with nothing balancing it.
            This is the last thing on the page and it asks for one thing, so it
            gets the middle. */}
        {hasContact && (
          <section className="rounded-[18px] border border-[var(--pf-line)] bg-[var(--pf-panel)] px-6 py-9 text-center @2xl:px-10 @2xl:py-11">
            {p.email && (
              <Anchor
                link={{
                  key: "cta",
                  label: p.ctaLabel,
                  href: `mailto:${p.email}`,
                  external: false,
                }}
                mode={mode}
                className={`inline-flex items-center rounded-full bg-[var(--pf-accent)] px-6 py-3 text-[15px] text-[var(--pf-on-accent)] shadow-[0_10px_28px_-16px_var(--pf-shadow)] transition-opacity hover:opacity-90 @2xl:text-[16px] ${strong}`}
              >
                {p.ctaLabel}
              </Anchor>
            )}

            {/* glyph and label, no interpuncts. the marks are what a reader
                scans this row for, and a middot between every pair turned it
                into one long string of text. */}
            <div
              className={`flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] text-[var(--pf-muted)] ${p.email ? "mt-7" : ""}`}
            >
              {contacts.map((c) => (
                <Anchor
                  key={c.key}
                  link={c}
                  mode={mode}
                  className="inline-flex max-w-full items-center gap-1.5 transition-colors hover:text-[var(--pf-text)]"
                >
                  <ContactGlyph name={c.key} />
                  <span className="truncate">{c.label}</span>
                </Anchor>
              ))}
            </div>

            {/* footer. the product's mark, and nothing more than a mark. an
                agency with portfolio setup signs off here instead, with its
                own label and link; that is the whole of what it gets to say. */}
            <p className="mt-8 text-[11.5px] text-[var(--pf-muted)]">
              {agency?.footer ? (
                agency.footer.url ? (
                  <Anchor
                    link={{
                      key: "agency",
                      label: agency.footer.label,
                      href: agency.footer.url,
                      external: true,
                    }}
                    mode={mode}
                    className="underline underline-offset-2 transition-colors hover:text-[var(--pf-text)]"
                  >
                    {agency.footer.label}
                  </Anchor>
                ) : (
                  agency.footer.label
                )
              ) : (
                <>
                  Made with{" "}
                  <Anchor
                    link={{
                      key: "creatorempire",
                      label: "Creator Empire",
                      href: "https://creatorempire.app",
                      external: true,
                    }}
                    mode={mode}
                    className="underline underline-offset-2 transition-colors hover:text-[var(--pf-text)]"
                  >
                    Creator Empire
                  </Anchor>
                </>
              )}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- sections */

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--pf-muted)]">
      {children}
    </h2>
  );
}

/**
 * One 9:16 tile and its caption.
 *
 * Four ways a clip can exist, in the order they are worth showing: an uploaded
 * file plays in place, a pasted link plays in place too if the platform has an
 * embed, a link that has no embed goes out to wherever it lives, and a clip
 * with none of those is still a slot on the page rather than a hole in the row.
 *
 * The embed branch is the one that matters. A creator who pastes a TikTok url
 * means "show this clip", not "link to this clip", and the old build read that
 * as the second one: a grey box with a play glyph that opened a new tab. The
 * frame stays 9:16 for every branch even though the platform players are each
 * a slightly different shape — a row of tiles that all agree on their size is
 * worth more than the strip of each player's own chrome it costs.
 */
function Clip({
  clip,
  mode,
  strong,
}: {
  clip: PortfolioClip;
  mode: Mode;
  strong: string;
}) {
  const caption = [clip.brand, clip.result].filter(Boolean).join(" · ");

  const frame =
    "relative aspect-[9/16] overflow-hidden rounded-[14px] border border-[var(--pf-line)] bg-[var(--pf-well)]";

  // the editor's preview repaints on every keystroke, and three third-party
  // players reloading as somebody types their headline is both slow and
  // distracting. there, a link stays a still with a glyph.
  const embed = mode === "live" && !clip.videoUrl ? clipEmbed(clip.linkUrl) : null;

  return (
    <figure className="w-full max-w-[290px] @2xl:w-[calc(33.333%-14px)] @2xl:min-w-[170px] @2xl:max-w-[190px]">
      {clip.videoUrl ? (
        <div className={frame}>
          <video
            src={clip.videoUrl}
            poster={clip.posterUrl || undefined}
            playsInline
            muted
            preload="metadata"
            // no controls in the preview: the phone is a picture of the page,
            // and a creator poking at a scrubber is a creator not writing.
            controls={mode === "live"}
            className="size-full object-cover"
          />
        </div>
      ) : embed ? (
        <div className={frame}>
          {embed.kind === "video" ? (
            <video
              src={embed.src}
              poster={clip.posterUrl || undefined}
              playsInline
              muted
              preload="metadata"
              controls
              className="size-full object-cover"
            />
          ) : (
            <iframe
              src={embed.src}
              title={clip.title || embed.label}
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              scrolling="no"
              // every embed that survives clipEmbed is a bare player, so it
              // just fills the frame. the platforms that wrap a clip in a card
              // are refused there rather than fought with here.
              className="size-full border-0"
            />
          )}
        </div>
      ) : clip.linkUrl ? (
        <Anchor
          link={{
            key: clip.id,
            label: clip.title,
            href: clip.linkUrl,
            external: true,
          }}
          mode={mode}
          className={`relative block ${frame}`}
        >
          {clip.posterUrl && (
            <img
              src={clip.posterUrl}
              alt={clip.title}
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <PlayGlyph />
          </span>
        </Anchor>
      ) : (
        <div className={`flex items-center justify-center ${frame}`}>
          <PlayGlyph />
        </div>
      )}

      <figcaption className="mt-3 text-center">
        {clip.title && (
          <p
            className={`truncate text-[14px] tracking-[-0.01em] text-[var(--pf-text)] ${strong}`}
          >
            {clip.title}
          </p>
        )}
        {caption && (
          <p className="mt-0.5 truncate text-[12.5px] text-[var(--pf-muted)]">
            {caption}
          </p>
        )}
      </figcaption>
    </figure>
  );
}

/** A link out is only obvious on a thumbnail if it wears the one glyph everyone
 *  already reads as "this plays". */
function PlayGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-9 text-[var(--pf-muted)]"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        opacity="0.55"
      />
      <path d="M10 8.4 16 12l-6 3.6z" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------------ glyphs */

/**
 * The mark on a contact pill: an envelope, a handset, or the platform's own.
 *
 * Drawn here rather than pulled from an icon package. Six marks at 15px is a
 * few hundred bytes inline against a dependency on every page load, and these
 * have to inherit `currentColor` so they can be tinted with the creator's
 * accent — the whole point is that the row reads as one set in one colour
 * rather than as six brands fighting each other, which is what real Instagram
 * pink next to real YouTube red does to a page.
 *
 * Every path is drawn on a 24 grid and keyed on the same string
 * `contactLinks()` uses, so a new platform in SOCIAL_PLATFORMS shows up here
 * with a mark or falls through to the link glyph rather than to a gap.
 */
function ContactGlyph({ name }: { name: string }) {
  const path = GLYPHS[name] ?? GLYPHS.website;

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[15px] shrink-0 text-[var(--pf-accent)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

const GLYPHS: Record<string, React.ReactNode> = {
  email: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  phone: (
    <path d="M6.5 3h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 5.2 2 2 0 0 1 5.5 3z" />
  ),
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  tiktok: (
    <>
      <path d="M14 3v11.2a3.8 3.8 0 1 1-3.2-3.75" />
      <path d="M14 3a5.6 5.6 0 0 0 5.4 4.4" />
    </>
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" strokeWidth="1.2" />
    </>
  ),
  x: <path d="m4 4 16 16M20 4 4 20" />,
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7.4 10.6V17M7.4 7.4v.02M11.6 17v-3.6a2.2 2.2 0 0 1 4.4 0V17" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.6h17.6M3.2 14.4h17.6" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
    </>
  ),
};

/* -------------------------------------------------------------------- links */

/**
 * Every outbound thing on the page goes through here.
 *
 * In the editor the page is a picture of a page. A click that opened a mail
 * client or navigated a tab would take a creator off the form they are in the
 * middle of filling, so preview mode renders the same markup as plain text.
 */
function Anchor({
  link,
  mode,
  className,
  children,
}: {
  link: ContactLink;
  mode: Mode;
  className?: string;
  children: React.ReactNode;
}) {
  if (mode === "preview") {
    return <span className={className}>{children}</span>;
  }

  // Second lock on the same door. normalizePortfolio already refuses any
  // scheme but http(s) on the fields a creator types, and this is the single
  // place every href on the page is built, so checking again here means a new
  // caller cannot introduce a `javascript:` url by forgetting to normalize.
  const safe = /^(https?:|mailto:|tel:)/i.test(link.href) ? link.href : "#";

  return (
    <a
      href={safe}
      className={className}
      {...(link.external
        ? { target: "_blank", rel: "noreferrer noopener" }
        : {})}
    >
      {children}
    </a>
  );
}

/**
 * Email, phone and socials as one ordered list, built once and rendered twice:
 * as pills in the hero and as a plain line under the button. Two copies of the
 * same loop would eventually disagree about which platforms are shown.
 */
function contactLinks(p: Portfolio): ContactLink[] {
  const out: ContactLink[] = [];

  if (p.email) {
    out.push({
      key: "email",
      label: p.email,
      href: `mailto:${p.email}`,
      external: false,
    });
  }

  if (p.phone) {
    out.push({
      key: "phone",
      label: p.phone,
      // a dialler wants digits and a plus, not the spaces people type
      href: `tel:${p.phone.replace(/[^\d+]/g, "")}`,
      external: false,
    });
  }

  for (const s of p.socials) {
    const meta = PLATFORMS.get(s.platform);
    // a handle-less row is a platform somebody has tapped in the editor and not
    // filled in yet. normalize drops it on save; until then it must not render
    // as a pill pointing at the platform's home page.
    if (!meta || !s.handle.trim()) continue;
    out.push({
      key: s.platform,
      label: meta.label,
      href: meta.url(s.handle),
      external: true,
    });
  }

  return out;
}
