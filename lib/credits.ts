// Credits, the wallet that pays for edit jobs. Pure: types, packs, tier math
// and wording. Anything that touches the database lives in
// lib/credits-server.ts, same split as deals.
//
// The whole model in one line: 1 credit = $1 of editor pay. A reaction video
// is 1 credit a video, everything else is 2, rush adds 1. The platform's
// margin lives in the pack price, never in a per-job fee, so the editor's $1
// is always exactly $1.

export const CREDIT_CENTS = 100;

export type CreditPack = {
  id: string;
  credits: number;
  priceCents: number;
  blurb: string;
};

/**
 * The packs. Flat rate, founder's call: $1 is 1 credit at every size, no
 * markup, no decimals anywhere a person reads. Stripe checkout builds its
 * line item off `priceCents` and the webhook grants `credits` by looking the
 * pack up again by id, so a tampered form cannot pick its own exchange rate.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", credits: 20, priceCents: 20_00, blurb: "try it out" },
  { id: "creator", credits: 100, priceCents: 100_00, blurb: "a month of steady posting" },
  { id: "volume", credits: 500, priceCents: 500_00, blurb: "for the daily posters" },
  { id: "studio", credits: 2000, priceCents: 2000_00, blurb: "agency scale" },
];

export function packById(id: string): CreditPack | null {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

export type LedgerKind = "purchase" | "job_post" | "job_refund" | "adjust";

export type LedgerRow = {
  id: string;
  delta: number;
  kind: LedgerKind;
  job_id: string | null;
  memo: string | null;
  created_at: string;
};

export const LEDGER_LABEL: Record<LedgerKind, string> = {
  purchase: "credits bought",
  job_post: "job posted",
  job_refund: "job refunded",
  adjust: "adjustment",
};

export type JobTier = 1 | 2;

/**
 * What the batch is, and the only thing that moves the price.
 *
 * This used to be derived from how many sources were attached plus four
 * checkboxes (b-roll, graphics, multiple scenes, music sync). That was wrong
 * about the work: essentially every UGC video has b-roll and music, so the
 * boxes were ticked every time and the "cheap" tier was unreachable in
 * practice. Deriving a price from a signal that is always true is just a
 * fixed price with extra steps.
 *
 * The real line is narrower and it is one question: is somebody reacting to
 * something on screen, or are they the video. A reaction is one take, one
 * screen capture, minimal assembly. Everything else is a real edit.
 *
 * Self-declared, which the old derivation existed to avoid, and that is an
 * accepted trade: a reaction video is obvious on sight, so a job tagged
 * wrongly is caught the moment an editor opens it rather than being an
 * unfalsifiable claim about effort.
 */
export const VIDEO_KINDS = [
  {
    value: "reaction",
    tier: 1 as JobTier,
    label: "reaction",
    blurb: "reacting to something on screen. no talking head to build around.",
  },
  {
    value: "standard",
    tier: 2 as JobTier,
    // "full edit", the same words `TIER_LABEL` uses, so the toggle and the job
    // summary beside it stop naming the same thing two ways. it is also about
    // fifty pixels narrower than "everything else", which is what let the four
    // settings share one row again.
    label: "full edit",
    blurb: "talking head, product, ugc ad. the normal job.",
  },
] as const;

export type VideoKind = (typeof VIDEO_KINDS)[number]["value"];

/** Anything that is not explicitly a reaction is the full rate. */
export function tierForKind(kind: string): JobTier {
  return kind === "reaction" ? 1 : 2;
}

/** The whole job's price in credits: (tier + rush) per video. */
export function jobCredits(tier: JobTier, rush: boolean, videoCount: number): number {
  return (tier + (rush ? 1 : 0)) * Math.max(1, videoCount);
}

/**
 * The editor's clock, in hours from the moment they claim.
 *
 * Standard was 24 and the rush was 6 until 2026-08-24. Six hours is a promise
 * the pool cannot keep on a job posted at 11pm — somebody has to cut through
 * the night — and a missed sla releases the claim, so the creator loses a day
 * rather than saving one. 36/18 keeps the shape (a rush is half the standard
 * clock) at hours a person can actually work.
 *
 * The number that actually decides a deadline lives in `claim_edit_job` in
 * postgres, because only the claim writes `sla_at`. This is the copy every
 * screen quotes, and the two must be changed together: a migration alone would
 * leave the whole product promising a clock the database no longer sets.
 */
export const TURNAROUND_HOURS = { standard: 36, rush: 18 } as const;

export function turnaroundHours(rush: boolean): number {
  return rush ? TURNAROUND_HOURS.rush : TURNAROUND_HOURS.standard;
}

/** "36h" / "18h", for a chip with no room for a sentence. */
export function turnaroundShort(rush: boolean): string {
  return `${turnaroundHours(rush)}h`;
}

export const TIER_LABEL: Record<JobTier, string> = {
  1: "reaction",
  2: "full edit",
};

export const TIER_HINT: Record<JobTier, string> = {
  1: "reacting to something on screen. one take, light assembly.",
  2: "talking head, product, ugc ad. b-roll and music included, they always are.",
};

/** "3 credits" with the plural handled once. */
export function creditsLabel(n: number): string {
  return `${n} credit${n === 1 ? "" : "s"}`;
}
