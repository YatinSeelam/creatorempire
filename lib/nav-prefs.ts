import { tools } from "@/lib/tools";

/**
 * Which parts of the app a creator wants to see.
 *
 * The rail already had two gates before this one and they answer different
 * questions. `hidden` in side-nav.tsx is "this is not finished, nobody gets
 * it". `feature` is the org's answer: a white-label workspace deciding what its
 * seats are allowed. This is the third and the smallest — the person's own
 * answer to "I do not use that one". It cannot grant anything the other two
 * took away; it only ever subtracts.
 *
 * A COOKIE, for the same reason the theme is one: the rail is rendered by the
 * layout on every single page, so the preference has to be readable before the
 * first paint or the nav visibly reflows a beat after it arrives. A column on
 * `profiles` would be a second query in the layout on every navigation to save
 * a preference that is worth exactly one row.
 *
 * Stored as explicit choices — `flow:1,transcriber:0` — rather than a list of
 * what is off. That is what lets a section default OFF and still be turned on:
 * a set of exclusions cannot express "off unless asked for", and Flow is
 * precisely that. It also means a section added next month appears for everyone
 * without anybody's cookie needing a migration, because an id nobody has voted
 * on falls through to its own default.
 */

export const NAV_COOKIE = "ugcf_nav";

export const NAV_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type NavSection = {
  id: string;
  label: string;
  blurb: string;
  /** what somebody who has never touched this screen sees. */
  on: boolean;
};

/**
 * The rail's own rows.
 *
 * Dashboard and Settings are not here on purpose: a nav you can empty is a nav
 * somebody can lock themselves out of, and the way back from "I hid Settings"
 * is a support message. Founder is not here either — it is a role, not a
 * preference.
 *
 * **Flow is off by default**, which is the one entry that starts hidden. It is
 * the newest and least finished thing in the product and it does not need to be
 * the second row of everybody's rail while that is true. Nothing about the
 * feature is switched off by this: `/flow` still answers, the turn API still
 * runs, and turning the row back on is one tap in settings.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "flow",
    label: "Flow",
    blurb: "the ai assistant, and its bubble",
    on: false,
  },
  {
    // the bell in the rail and the settings tab behind it. off by default for
    // the same reason Flow is: almost nothing fills it yet, and a bell that is
    // always empty teaches people not to look at it — which is expensive later,
    // when it starts carrying claims and client sign-offs.
    id: "notifications",
    label: "Notifications",
    blurb: "the bell, and its settings tab",
    on: false,
  },
  { id: "deals", label: "Deals", blurb: "brand deals, bonuses and payouts", on: true },
  { id: "tools", label: "Tools", blurb: "the whole tools shelf", on: true },
  { id: "editing", label: "Editing", blurb: "hand cuts to an editor", on: true },
];

/**
 * Tools that start hidden.
 *
 * A tool goes here when it is real but not yet the thing somebody should meet
 * first — same test Flow and the bell were held to. Workflow is the calendar
 * plus the competitor watchlist, and both of them are empty on day one for
 * everybody: a shelf whose top card opens on "nothing planned" and "nobody on
 * the watchlist yet" spends its first impression proving there is nothing here.
 * It is one tap away for anyone who wants it.
 *
 * A slug, not a whole entry, so the rest is still generated from the registry.
 */
const TOOLS_OFF_BY_DEFAULT = new Set(["workflow"]);

/** The tools shelf, one switch each. Read off the registry rather than typed
 *  out, so a tool added to `lib/tools.ts` turns up here on its own — on, unless
 *  its slug is in the set above. */
export const NAV_TOOLS: NavSection[] = tools.map((tool) => ({
  id: `tool.${tool.slug}`,
  label: tool.name,
  blurb: tool.blurb ?? "",
  on: !TOOLS_OFF_BY_DEFAULT.has(tool.slug),
}));

const DEFAULTS = new Map(
  [...NAV_SECTIONS, ...NAV_TOOLS].map((section) => [section.id, section.on])
);

export type NavPrefs = Record<string, boolean>;

/**
 * A cookie is a string anybody can type, so only ids this build knows about
 * survive the read. Anything else is dropped rather than carried, which also
 * means a cookie written before a section was renamed cannot keep voting for a
 * row that no longer exists.
 */
export function readNavPrefs(raw: string | undefined | null): NavPrefs {
  const out: NavPrefs = {};
  if (!raw) return out;

  for (const part of raw.split(",").slice(0, 40)) {
    const [id, value] = part.split(":");
    if (!id || !DEFAULTS.has(id)) continue;
    out[id] = value === "1";
  }
  return out;
}

export function writeNavPrefs(prefs: NavPrefs): string {
  return Object.entries(prefs)
    .filter(([id]) => DEFAULTS.has(id))
    .map(([id, on]) => `${id}:${on ? "1" : "0"}`)
    .join(",");
}

/** Whether a section is showing. An id nobody has voted on takes its default,
 *  and an id this build has never heard of is on, because the alternative is a
 *  typo silently deleting a row. */
export function navOn(prefs: NavPrefs, id: string): boolean {
  return prefs[id] ?? DEFAULTS.get(id) ?? true;
}
