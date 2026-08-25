/**
 * The editor job post, in one place.
 *
 * This is the copy that goes in a discord server and the copy on /editors, and
 * they have to be the same words. An applicant who reads one thing in a server
 * and another on the page assumes the page is stale, which is the cheapest way
 * to lose somebody who was already sold.
 *
 * Lowercase, no em dashes, same voice as the rest of the product.
 */

/** the signed-out /editors landing. three steps, almost no words. */
export const landing = {
  headline: { pre: "edit videos.", accent: "get paid." },
  sub: "$1 talking head, $2 full edit. claim a job, deliver in 36 hours, get paid weekly.",
  steps: [
    { title: "sign up", body: "two minutes. no calls, no interviews." },
    { title: "claim jobs", body: "we post them, you pick what you want." },
    { title: "get paid", body: "weekly payouts. every job is funded before it posts." },
  ],
} as const;

export const role = {
  title: "hiring short-form video editors",
  /** the one line under the title, and the meta description. */
  hook: "no motion graphics needed. we already have the style and the template, you cut fast and consistently.",

  doing: [
    "cutting dead air and mistakes",
    "adding clean captions",
    "basic zooms and cuts when they help",
    "following an existing editing template",
    "delivering consistently and on time",
  ],

  /** said out loud, because it is what filters the right people in. */
  notCreative:
    "this is not a highly creative editing role. the style and the template are already ours, so you are assembling to a spec, not designing one.",

  wanted: [
    "fast turnaround",
    "following instructions exactly",
    "consistency across a batch",
    "good communication",
    "capacity for several videos a day",
  ],

  upside:
    "there is consistent volume here, and performance bonuses for editors who are fast, reliable and keep the quality steady.",

  /** the four steps rendered on the landing page, in order. */
  steps: [
    "create your free editor profile",
    "add your portfolio, or paste one you already have",
    "add your availability and editing details",
    "submit your application",
  ],

  closing:
    "selected editors get a short timed test edit. we'll reach out either way.",
} as const;
