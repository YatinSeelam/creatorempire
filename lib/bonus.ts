/**
 * What a bonus rule pays, in TypeScript, for everything that is not a payout.
 *
 * The money that gets invoiced is computed in postgres
 * (`public.video_rule_earnings_asof`) and that does not change: it needs two
 * daily snapshots per video per rule and a join across the cut, which is not a
 * loop you want in a component. This file answers the other question, the one
 * postgres cannot answer without a row existing yet:
 *
 *   "a video with 120,000 views, what does this rule pay it?"
 *
 * That question is asked in three places and none of them are a payout: the
 * preview inside the rule form (there is no video at all), the tier progress on
 * a post row ("32k more views and this pays $150"), and the one-line summary of
 * a rule on the edit page. All three are read-only and none of them may be
 * treated as the amount owed.
 *
 * The rules it applies are the same ones the SQL applies, in the same order:
 * under `min_views` earns nothing, a milestone pays the highest tier reached and
 * tiers never stack, and `cap_cents` is the ceiling on whatever came out. The
 * two things it deliberately does NOT model are the window (which views count is
 * a question about snapshots, not about a number somebody typed) and view
 * counting across a cut (which needs the cut's other posts). Both are stated on
 * screen next to the preview instead of being silently folded into it.
 *
 * Pure: no next, no supabase, no react. It runs in the browser inside the form
 * and on the server inside the page, off the same numbers.
 */

import { PLATFORM_LABEL, type BonusRule, type MilestoneTier } from "@/lib/deals";
import { money, moneyExact, views as fmtViews } from "@/lib/money";

/** The ladder, lowest step first, with the junk rows dropped. */
export function sortedTiers(tiers: MilestoneTier[]): MilestoneTier[] {
  return [...(tiers ?? [])]
    .filter((t) => Number.isFinite(t?.views) && Number.isFinite(t?.amount_cents))
    .sort((a, b) => a.views - b.views);
}

export type RuleQuote = {
  /** what this many views earns from this rule alone, in cents. */
  cents: number;
  /** the tier that paid, on a milestone rule that reached one. */
  tier: MilestoneTier | null;
  /** the next step up and how far off it is. null once the ladder is topped. */
  next: { tier: MilestoneTier; viewsAway: number } | null;
  /** true when the rule's own view floor is what stopped it paying. */
  underMin: boolean;
  /** true when `cap_cents` took money off the answer. */
  capped: boolean;
};

/**
 * What `views` earns under one rule.
 *
 * The order is the SQL's order and it matters: the floor is checked before the
 * kind, so a rule with a 10k minimum pays nothing at 9k however good the tier
 * sheet is, and the cap is applied last, to whatever the kind produced.
 */
export function quoteRule(rule: BonusRule, views: number): RuleQuote {
  const tiers = rule.kind === "milestone" ? sortedTiers(rule.tiers) : [];
  const clean = Math.max(0, Math.floor(views || 0));

  // the next step up is worth knowing even when the floor is what is blocking
  // it, so it is computed before the early return rather than inside the branch.
  const nextTier = tiers.find((t) => t.views > clean) ?? null;
  const next = nextTier ? { tier: nextTier, viewsAway: nextTier.views - clean } : null;

  if (clean < rule.min_views) {
    return { cents: 0, tier: null, next, underMin: true, capped: false };
  }

  let raw = 0;
  let tier: MilestoneTier | null = null;

  if (rule.kind === "cpm") {
    raw = Math.round((clean * (rule.rate_cents_per_1k ?? 0)) / 1000);
  } else if (rule.kind === "per_video") {
    raw = rule.amount_cents ?? 0;
  } else {
    // highest reached, never a sum: a video at 60k on a 10k/50k sheet earns the
    // 50k amount and not both. Same rule as the `max(...)` in the SQL.
    for (const t of tiers) if (t.views <= clean) tier = t;
    raw = tier?.amount_cents ?? 0;
  }

  const cap = rule.cap_cents;
  const capped = cap != null && raw > cap;

  return { cents: capped ? cap : raw, tier, next, underMin: false, capped };
}

/** Every rule on the deal, quoted against one view count and added up. */
export function quoteRules(rules: BonusRule[], views: number): number {
  return rules.reduce((sum, rule) => sum + quoteRule(rule, views).cents, 0);
}

/* ------------------------------------------------------------------ wording */

/**
 * The money shape of a rule in one phrase, without any of its modifiers.
 *
 * This is the line somebody scans a list of rules by, so it says the number and
 * nothing else. Everything conditional lives in {@link ruleChips}, which is the
 * split that `describeRule` in lib/deals.ts did not have: that one joined nine
 * facts with dots and the rate was the fourth of them.
 */
export function ruleHeadline(rule: BonusRule): string {
  if (rule.kind === "cpm") {
    return `${moneyExact(rule.rate_cents_per_1k ?? 0)} per 1,000 views`;
  }
  if (rule.kind === "per_video") {
    return `${money(rule.amount_cents ?? 0)} per video posted`;
  }

  const tiers = sortedTiers(rule.tiers);
  if (tiers.length === 0) return "no tiers set";
  if (tiers.length === 1) {
    return `${money(tiers[0].amount_cents)} at ${fmtViews(tiers[0].views)} views`;
  }
  return `${tiers.length} tiers, ${money(tiers[0].amount_cents)} at ${fmtViews(
    tiers[0].views
  )} up to ${money(tiers[tiers.length - 1].amount_cents)} at ${fmtViews(
    tiers[tiers.length - 1].views
  )}`;
}

/**
 * The modifiers, one short chip each, and only the ones that are not the
 * default. A rule that pays on top of base pay, on every platform, per post,
 * forever, with no floor and no cap produces one chip, because five chips
 * saying "the normal thing" is the noise the old summary string was.
 */
export function ruleChips(rule: BonusRule): string[] {
  const chips: string[] = [];

  // never suppressed: it is the difference between $30 and $180 on a video that
  // hit its tier, and nothing else on the row would give it away.
  chips.push(rule.tier_mode === "replace" ? "instead of base pay" : "on top of base pay");

  if (rule.platforms.length > 0) {
    chips.push(rule.platforms.map((p) => PLATFORM_LABEL[p]).join(" + ") + " only");
  }

  if (rule.view_counting === "highest") chips.push("best platform of the cut");
  else if (rule.view_counting === "combined") chips.push("platforms added together");

  if (rule.window_kind === "since_post") chips.push(`first ${rule.window_days} days of a post`);
  else if (rule.window_kind === "absolute") {
    chips.push(rule.ends_on ? `${rule.starts_on} to ${rule.ends_on}` : `from ${rule.starts_on}`);
  }

  if (rule.min_views > 0) chips.push(`needs ${fmtViews(rule.min_views)} views`);
  if (rule.cap_cents != null) chips.push(`caps at ${money(rule.cap_cents)}`);

  return chips;
}

/**
 * The tier ladder as something drawable: each step, what it pays, and whether
 * the views passed in have reached it.
 *
 * `hit` is what turns a list of numbers into progress. Without it a seven step
 * ladder on a deal doing 300 views a post reads exactly the same as one on a
 * deal doing 2m, which is most of why the rule card said nothing useful.
 */
export type LadderStep = MilestoneTier & { hit: boolean; top: boolean };

export function ruleLadder(rule: BonusRule, views = 0): LadderStep[] {
  const tiers = sortedTiers(rule.tiers);
  let topIndex = -1;
  tiers.forEach((t, i) => {
    if (views >= t.views) topIndex = i;
  });
  return tiers.map((t, i) => ({ ...t, hit: views >= t.views, top: i === topIndex }));
}

/**
 * The short version of what a post's bonus cell should say under the amount.
 *
 * Three states, and the middle one is the whole point: a post that earned
 * nothing because it has not got there yet is not the same fact as a post on a
 * rule that cannot pay it, and a column of "-" said both.
 */
export function tierNote(rule: BonusRule, views: number): string | null {
  if (rule.kind !== "milestone") return null;
  const quote = quoteRule(rule, views);
  if (quote.tier) return `${fmtViews(quote.tier.views)} tier`;
  if (quote.next) return `${fmtViews(quote.next.viewsAway)} to go`;
  return null;
}
