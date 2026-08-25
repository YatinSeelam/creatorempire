/**
 * The tools catalogue. Every entry here is built and running — the stubs that
 * used to pad this list out (hook writer, invoice builder, outreach writer and
 * the rest) are gone, because a grid of nine "coming soon" cards makes the two
 * real tools look fake too.
 *
 * Each entry names its own route in `href`, so the card is a shortcut to a
 * real page and nothing else. There is no generic /tools/[slug] workspace any
 * more; a new tool gets its own segment under app/(dash)/tools/ the day it
 * actually runs, plus a glyph in components/dash/tool-glyphs.tsx. The glyph
 * map is keyed by ToolSlug, so a missing one is a type error rather than a
 * hole in the grid.
 */

export type ToolCard = {
  slug: string;
  name: string;
  blurb: string;
  href: string;
};

export const tools = [
  // first because it is the daily driver: the other cards are things you reach
  // for, this one is where a filming day starts.
  {
    slug: "workflow",
    name: "Workflow",
    blurb: "Plan the week on a calendar, bank scripts worth stealing.",
    href: "/tools/workflow",
  },
  {
    slug: "variations",
    name: "Variations",
    blurb: "Mix hooks, demos and sounds. We render every combination.",
    href: "/tools/variations",
  },
  {
    slug: "transcriber",
    name: "Transcriber",
    blurb: "Paste a video link, get the script out of it.",
    href: "/tools/transcriber",
  },
  {
    slug: "account-emails",
    name: "Account Emails",
    blurb: "A fresh signup address per account, with the codes landing here.",
    href: "/tools/account-emails",
  },
  {
    slug: "profile-scraper",
    name: "Profile Scraper",
    blurb: "Pull anyone's recent posts with the numbers attached.",
    href: "/tools/profile-scraper",
  },
  // NOT the old Social rail row moved sideways. That was a list of brand deals
  // sitting under a list of the same brand deals, and it is a tab on the deal
  // now. This is the cut across every deal at once: which logins are still
  // one brand at a time: build a batch out of the cuts your editors delivered,
  // write the captions, pick the accounts, then drag the schedule.
  {
    slug: "autoposting",
    name: "Autoposting",
    blurb: "Schedule a batch of cuts across every account on a brand deal.",
    href: "/tools/autoposting",
  },
  {
    slug: "my-portfolio",
    name: "My Portfolio",
    blurb: "The page you send a brand instead of a PDF.",
    // built at its own route. this card is the only way in: the portfolio used
    // to have its own row in the rail as well, which made the same page
    // reachable twice.
    href: "/portfolio",
  },
] as const satisfies readonly ToolCard[];

/**
 * Tools a founder built for ONE workspace.
 *
 * Off for everybody until a founder switches one on for a specific agency, on
 * /founder/agencies/<id>. The switch is an `org_overrides` row (`tool.<slug>` =
 * true, see lib/org-overrides.ts) and it is a real entitlement, not a shelf
 * tidy like ORG_FEATURES: the card only shows for people seated on a granted
 * workspace, and the route itself refuses everyone else with a 404.
 *
 * To add one:
 *   1. build it at app/(dash)/tools/<slug>/page.tsx, and open the page with
 *      `await requireCustomTool("<slug>")` before it reads anything.
 *   2. list it here, same shape as `tools`, and give it a glyph in
 *      components/dash/tool-glyphs.tsx (the map is keyed by ToolSlug, so a
 *      missing glyph is a type error rather than a blank tile).
 *   3. open /founder/agencies/<the agency> and switch it on for them.
 *
 * Empty is a valid state and the founder page says so.
 */
export const customTools = [] as const satisfies readonly ToolCard[];

export type ToolSlug =
  | (typeof tools)[number]["slug"]
  | (typeof customTools)[number]["slug"];

export type CustomToolSlug = (typeof customTools)[number]["slug"];

/** Every card the product knows about, standard first. */
export const allTools: readonly ToolCard[] = [...tools, ...customTools];

/** The registered custom tool for a slug, or null. Typed as the registry entry so a caller keeps the literal slug. */
export function customTool(slug: string): (typeof customTools)[number] | null {
  return (
    ((customTools as readonly ToolCard[]).find((t) => t.slug === slug) as
      | (typeof customTools)[number]
      | undefined) ?? null
  );
}

export function toolHref(tool: ToolCard): string {
  return tool.href;
}
