/**
 * Applying a proposal. This is the one door.
 *
 * Nothing in here writes a product row itself. Every branch builds the same
 * input the matching form builds and hands it to the same function the form
 * hands it to — `normalizeDealDraft` + `applyDealDraft` for a new deal,
 * `updateDeal` for an edit to one that exists, and the `addRule` / `addAccount`
 * server actions for the rest.
 *
 * That is what "flow proposes, a human applies, and the apply is the same
 * server action the ui calls" means when you write it out. The validation, the
 * rls and the user are identical either way, so a proposal cannot produce a row
 * the form could not have produced, and it cannot produce one at all without
 * somebody pressing the button that gets here.
 *
 * A patch is a model's json. It is never trusted: every value goes through the
 * same parser a browser's form value goes through, and a failure comes back as
 * the sentence the form would have shown.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addAccount,
  addRule,
  destroyDeal,
  updateBrand,
  updateDeal,
} from "@/app/(dash)/deals/actions";
import { applyDealDraft } from "@/lib/deal-intake";
import { dealScope } from "@/lib/workspace";
import { normalizeDealDraft, type DealDraftInput } from "@/lib/deal-schema";
import type { Proposal } from "./types";

export type ApplyResult =
  | { ok: true; href: string | null; message: string }
  | { ok: false; error: string };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** FormData is what every action here reads, so a patch becomes one first. */
function form(entries: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      // the actions read repeated keys with getAll, which is how platforms and
      // the tier table arrive from a real form too.
      value.forEach((item) => fd.append(key, String(item)));
    } else {
      fd.append(key, String(value));
    }
  }
  return fd;
}

/**
 * The deal columns an edit may touch, named the way the form posts them rather
 * than the way the table stores them. `flat_fee` is the rename that matters:
 * the column is cents, the field is dollars, and the conversion has exactly one
 * home in `parseCents`.
 */
const EDIT_KEYS = [
  "name",
  "status",
  "started_on",
  "ends_on",
  "flat_fee",
  "flat_fee_kind",
  "min_views_for_base",
  "pay_cycle",
  "cycle_anchor_on",
  "net_days",
  "contract_url",
  "notes",
] as const;

/** The fields that are allowed to be nothing. The rest have a real default. */
const CLEARABLE = new Set(["started_on", "ends_on", "cycle_anchor_on", "contract_url", "notes"]);

/**
 * Editing a deal, which is a merge and not a write.
 *
 * `updateDeal` takes a whole deal, the way the edit form posts one, and
 * `normalizeDeal` fills anything missing with a default — a blank status is
 * `active`, a blank fee is $0. So a patch holding only `status` cannot be handed
 * over as-is: it would quietly reset the campaign name, the terms and the fee of
 * a deal somebody is being paid on. The current row is read first and the patch
 * lands on top of it, so the fields the model never mentioned post back exactly
 * as they are.
 *
 * The write itself is still `updateDeal`, the same server action the edit form
 * calls. Flow gets no private path to the deals table.
 */
async function applyDealEdit(db: SupabaseClient, proposal: Proposal): Promise<ApplyResult> {
  const patch = proposal.patch ?? {};
  const dealId = str(patch.deal_id) || proposal.target_id || "";
  if (!dealId) return { ok: false, error: "That edit is not attached to a deal." };

  const { data: deal } = await db
    .from("deals")
    .select(
      "name, status, started_on, ends_on, flat_fee_cents, flat_fee_kind, min_views_for_base, pay_cycle, cycle_anchor_on, net_days, contract_url, notes"
    )
    .eq("id", dealId)
    .maybeSingle();

  // rls scopes the read, so somebody else's deal and a deleted one are the same
  // answer here, which is the right one either way: nothing was changed.
  if (!deal) return { ok: false, error: "That deal is gone. Nothing was changed." };

  const current: Record<string, unknown> = {
    ...deal,
    // the edit form seeds this box the same way. cents to dollars and back
    // through parseCents is exact, so an untouched fee posts back untouched.
    flat_fee: (Number(deal.flat_fee_cents) || 0) / 100,
  };
  delete current.flat_fee_cents;

  const cleared = new Set(
    (Array.isArray(patch.clear) ? patch.clear : []).map(String).filter((k) => CLEARABLE.has(k))
  );

  let changed = cleared.size > 0;
  const merged: Record<string, unknown> = {};

  for (const key of EDIT_KEYS) {
    if (cleared.has(key)) {
      // "" is dropped by `form` below, so the field arrives absent and
      // normalizeDeal reads it as null. that is what clearing one means.
      merged[key] = "";
      continue;
    }
    const proposed = patch[key];
    const setting = proposed !== null && proposed !== undefined && proposed !== "";
    if (setting) changed = true;
    merged[key] = setting ? proposed : current[key];
  }

  if (!changed) return { ok: false, error: "That card does not change anything on the deal." };

  const state = await updateDeal({}, form({ deal_id: dealId, ...merged }));
  if (state.error) return { ok: false, error: state.error };

  return { ok: true, href: `/deals/${dealId}`, message: "Deal updated." };
}

/**
 * One bonus rule to the form `addRule` reads. Shared by the standalone bonus
 * card and by the rules a new deal arrives carrying, so a rule written at
 * creation time and one added later go through identical parsing.
 */
function ruleForm(rule: Record<string, unknown>, dealId: string): FormData {
  const fd = form({
    deal_id: dealId,
    label: rule.label,
    kind: rule.kind,
    rate: rule.rate,
    amount: rule.amount,
    min_views: rule.min_views,
    cap: rule.cap,
    window_kind: rule.window_kind ?? "forever",
    window_days: rule.window_days,
    starts_on: rule.starts_on,
    ends_on: rule.ends_on,
    tier_mode: rule.tier_mode,
    view_counting: rule.view_counting,
    platforms: rule.platforms,
  });

  // the tier table posts as two parallel lists, and `parseTierRows` rejects a
  // row with one side filled rather than dropping it. appending both sides per
  // tier keeps that check meaningful.
  const tiers = Array.isArray(rule.tiers) ? rule.tiers : [];
  for (const tier of tiers as { views?: unknown; amount?: unknown }[]) {
    fd.append("tier_views", String(tier?.views ?? ""));
    fd.append("tier_amount", String(tier?.amount ?? ""));
  }

  return fd;
}

/**
 * Editing a brand, which is the same merge-not-write problem `applyDealEdit`
 * has. `updateBrand` takes the whole brand the way its form posts one, and
 * `normalizeBrand` reads a missing field as empty, so handing over a patch that
 * only carries a name would wipe the website and the contact.
 *
 * A rename lands on every deal pointing at the brand. That is the feature, not
 * a side effect: one Candle, however many deals.
 */
async function applyBrandEdit(db: SupabaseClient, proposal: Proposal): Promise<ApplyResult> {
  const patch = proposal.patch ?? {};
  const brandId = str(patch.brand_id) || proposal.target_id || "";
  if (!brandId) return { ok: false, error: "That edit is not attached to a brand." };

  const { data: brand } = await db
    .from("brands")
    .select("name, website, contact_name, contact_email, logo_key, logo_url")
    .eq("id", brandId)
    .maybeSingle();

  // rls scopes the read, so somebody else's brand and a deleted one are the
  // same answer here, and it is the right one either way: nothing changed.
  if (!brand) return { ok: false, error: "That brand is gone. Nothing was changed." };

  // the tool schema prefixes the two fields that collide with a deal's own,
  // because `name` means the campaign on one registry and the company on the
  // other. see BRAND_RENAME. undoing the prefix is this map and nothing else.
  const proposed: Record<string, unknown> = {
    name: patch.brand_name,
    website: patch.brand_website,
    contact_name: patch.contact_name,
    contact_email: patch.contact_email,
  };

  let changed = false;
  // both logo columns ride along untouched: the AI layer has no card for the
  // mark, and a merge that dropped them would wipe an uploaded logo on rename.
  const merged: Record<string, unknown> = {
    logo_key: brand.logo_key,
    logo_url: brand.logo_url,
  };

  for (const key of ["name", "website", "contact_name", "contact_email"] as const) {
    const value = proposed[key];
    const setting = value !== null && value !== undefined && value !== "";
    if (setting) changed = true;
    merged[key] = setting ? value : brand[key];
  }

  if (!changed) return { ok: false, error: "That card does not change anything on the brand." };

  const state = await updateBrand({}, form({ brand_id: brandId, ...merged }));
  if (state.error) return { ok: false, error: state.error };

  return { ok: true, href: "/deals", message: "Brand updated." };
}

export async function applyProposal(
  db: SupabaseClient,
  userId: string,
  proposal: Proposal
): Promise<ApplyResult> {
  const patch = proposal.patch ?? {};

  switch (proposal.target_entity) {
    /* ------------------------------------------------------------- a deal */
    case "deal": {
      if (proposal.op === "update") return applyDealEdit(db, proposal);

      if (proposal.op === "delete") {
        const dealId = str(patch.deal_id) || proposal.target_id || "";
        if (!dealId) return { ok: false, error: "That delete is not attached to a deal." };

        // the same server action the delete button on the edit page runs,
        // minus its redirect. rls scopes it, so somebody else's deal and a
        // deal already gone both come back as "nothing was changed".
        const state = await destroyDeal(dealId);
        if (state.error) return { ok: false, error: state.error };

        return {
          ok: true,
          href: "/deals",
          message: "Deal deleted. Its accounts, rules, videos and history went with it.",
        };
      }

      // the patch IS a DealDraftInput. that is not a coincidence: the tool's
      // json schema was generated from the same registry that defines this
      // type, so the shape the model fills in is the shape the form posts.
      const parsed = normalizeDealDraft(patch as DealDraftInput);
      if (!parsed.ok) return { ok: false, error: parsed.error };

      // the same books the form would write to: whichever workspace the card
      // was accepted from.
      const result = await applyDealDraft(db, userId, parsed.draft, (await dealScope()).orgId);
      if (!result.ok) return { ok: false, error: result.error };

      // the bonus rules the brand described, written now that the deal has an
      // id. they ride on the draft rather than arriving as their own cards
      // because propose_bonus_rule needs a deal id and a deal being created has
      // none — which is why these terms used to end up as prose in `notes`,
      // where the earnings engine cannot see them and the bonus paid nothing.
      //
      // `normalizeDealDraft` never looked at them, so they are still raw model
      // json here. `addRule` is the same parser the bonus form posts into, and
      // it is the only thing that turns them into a row.
      const rules = Array.isArray(patch.rules) ? patch.rules : [];
      const failed: string[] = [];

      for (const [i, rule] of rules.entries()) {
        if (!rule || typeof rule !== "object") continue;
        const state = await addRule({}, ruleForm(rule as Record<string, unknown>, result.dealId));
        // a rule that will not parse must not take the deal down with it: the
        // deal is written by this point and losing it over one malformed tier
        // table is worse than landing on the deal with a line saying which
        // bonus to add by hand.
        if (state.error) {
          const label = str((rule as Record<string, unknown>).label) || `bonus ${i + 1}`;
          failed.push(`${label} (${state.error})`);
        }
      }

      const notes = [
        result.warning,
        failed.length
          ? `${failed.length === 1 ? "This bonus" : "These bonuses"} did not save: ${failed.join("; ")}. Add ${failed.length === 1 ? "it" : "them"} below.`
          : null,
      ].filter(Boolean);

      const added = rules.length - failed.length;

      return {
        ok: true,
        href: `/deals/${result.dealId}`,
        // the deal exists even when an account or a rule did not attach, so the
        // warnings travel with the success rather than replacing it.
        message: [
          added > 0 ? `Deal created with ${added} bonus ${added === 1 ? "rule" : "rules"}.` : "Deal created.",
          ...notes,
        ].join(" "),
      };
    }

    /* --------------------------------------------------------------- a brand */
    case "brand":
      return applyBrandEdit(db, proposal);

    /* -------------------------------------------------------- a bonus rule */
    case "bonus_rule": {
      const dealId = str(patch.deal_id);
      if (!dealId) return { ok: false, error: "That bonus is not attached to a deal." };

      const state = await addRule({}, ruleForm(patch, dealId));
      if (state.error) return { ok: false, error: state.error };
      return { ok: true, href: `/deals/${dealId}`, message: "Bonus added." };
    }

    /* ----------------------------------------------------------- an account */
    case "deal_account": {
      const dealId = str(patch.deal_id);
      if (!dealId) return { ok: false, error: "That account is not attached to a deal." };

      const state = await addAccount(
        {},
        form({ deal_id: dealId, platform: patch.platform, handle: patch.handle })
      );
      if (state.error) return { ok: false, error: state.error };
      return { ok: true, href: `/deals/${dealId}`, message: state.ok ?? "Account added." };
    }

    default:
      return { ok: false, error: "Flow does not know how to apply that." };
  }
}
