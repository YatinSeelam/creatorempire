/**
 * A write tool call becomes a proposal row. Nothing else happens here.
 *
 * The two jobs are classification and deduplication, and both matter more than
 * they look:
 *
 * - **risk** is read off `risk:` in the field registry rather than assigned by
 *   hand, so a field nobody thought about lands on `review` and gets a card. A
 *   `money` proposal never auto-applies no matter how confident the model is.
 * - **dedupe_key** is what makes re-processing safe. Paste the same brand email
 *   twice and the second attempt collides on a unique index instead of creating
 *   a second gymshark deal. The key is derived from what identifies the thing,
 *   never from the model's own wording, because the model rewords.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACCOUNT_FIELDS,
  BRAND_FIELDS,
  BRAND_RENAME,
  DEAL_FIELDS,
  DEAL_RENAME,
  riskOf,
} from "./registry";
import type { Proposal, RiskTier, TargetEntity } from "./types";

/** Confidence at or above this auto-applies, and only on the safe tier. */
export const AUTO_APPLY_AT = 0.8;

const ORDER: Record<RiskTier, number> = { safe: 0, review: 1, money: 2 };
const worst = (...tiers: RiskTier[]): RiskTier =>
  tiers.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), "safe");

/** Lowercase, alphanumeric, hyphenated. "Wispr Flow" and "wisprflow" collide. */
const slug = (value: unknown): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** The keys every write tool carries that are about the proposal, not the row. */
const META = new Set(["evidence", "confidence"]);

function stripMeta(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([k]) => !META.has(k)));
}

type Classified = {
  entity: TargetEntity;
  patch: Record<string, unknown>;
  risk: RiskTier;
  dedupeKey: string | null;
  /** Defaults to a create. An edit or a delete says so, and carries its target. */
  op?: "create" | "update" | "delete";
  targetId?: string | null;
};

/**
 * The id column is a uuid, so a hallucinated "the candle deal" would fail the
 * insert with a postgres type error rather than anything a person could read.
 * A shape that is not an id is stored as no id at all; the patch still carries
 * whatever the model said, and apply answers "that deal is gone".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (UUID.test(String(v ?? "")) ? String(v) : null);

/**
 * The identity of an edit: which fields it sets, to what, and which it empties.
 *
 * Sorted, so key order out of the model cannot make the same change look like
 * two. Values are part of it because "set status to ended" and "set status to
 * paused" are different proposals for the same deal, and only one of them is
 * the one the creator is looking at.
 */
function fingerprint(fields: Record<string, unknown>, cleared: string[]): string {
  const set = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${slug(typeof v === "object" ? JSON.stringify(v) : v)}`);
  return [...set, ...cleared.map((k) => `-${k}`)].sort().join(",");
}

/**
 * Tool name plus input to the four things a proposal row needs.
 *
 * Returns null for a tool that produces no proposal (`ask`), so the caller can
 * tell "this turn wrote nothing" from "this turn failed".
 */
export function classify(name: string, raw: Record<string, unknown>): Classified | null {
  const patch = stripMeta(raw);

  switch (name) {
    case "propose_deal": {
      // the brand half is prefixed so it cannot collide with the deal's own
      // `name`. see BRAND_RENAME for why that collision is not theoretical.
      const isBrandKey = (k: string) => k.startsWith("brand_");
      const brandPart = Object.fromEntries(
        Object.entries(patch).filter(([k]) => isBrandKey(k) && k !== "brand_id")
      );
      const dealPart = Object.fromEntries(
        Object.entries(patch).filter(
          ([k]) => !isBrandKey(k) && k !== "accounts" && k !== "rules"
        )
      );

      // an account attaches a handle to a deal, which is review-tier work, so a
      // draft that carries one can never come out safe.
      const accounts = Array.isArray(patch.accounts) && patch.accounts.length > 0;
      // a rule decides what a brand owes. a draft carrying one is money tier by
      // definition, the same as a standalone propose_bonus_rule, so a brand dump
      // with a CPM in it can never auto-apply however sure the model is.
      const rules = Array.isArray(patch.rules) && patch.rules.length > 0;

      return {
        entity: "deal",
        patch,
        risk: worst(
          riskOf(BRAND_FIELDS, brandPart, BRAND_RENAME),
          riskOf(DEAL_FIELDS, dealPart, DEAL_RENAME),
          accounts ? "review" : "safe",
          rules ? "money" : "safe"
        ),
        // a brand plus a start month. re-reading the same email lands on the
        // same key; a genuinely second deal with the same brand next quarter
        // does not.
        dedupeKey: `deal:${slug(patch.brand_name ?? patch.brand_id)}:${
          str(patch.started_on)?.slice(0, 7) ?? "nodate"
        }`,
      };
    }

    case "propose_deal_edit": {
      const dealId = str(patch.deal_id);
      const cleared = (Array.isArray(patch.clear) ? patch.clear : []).map(String);
      const fields = Object.fromEntries(
        Object.entries(patch).filter(([k]) => k !== "deal_id" && k !== "clear")
      );

      return {
        entity: "deal",
        op: "update",
        targetId: uuid(dealId),
        patch,
        // an edit overwrites something that is already there and already
        // earning, so it never comes out `safe` however dull the field is.
        // `safe` is the one tier that writes without anybody looking, and
        // nothing may overwrite a real deal on the model's own confidence.
        risk: worst("review", riskOf(DEAL_FIELDS, fields, DEAL_RENAME)),
        // the deal plus the exact change. re-reading the same email proposes
        // the same edit and collides; a different edit to the same deal does
        // not, because a creator can have two pending changes.
        dedupeKey: dealId ? `edit:deal:${dealId}:${fingerprint(fields, cleared)}` : null,
      };
    }

    case "propose_brand_edit": {
      const brandId = str(patch.brand_id);
      const fields = Object.fromEntries(
        Object.entries(patch).filter(([k]) => k !== "brand_id")
      );

      return {
        entity: "brand",
        op: "update",
        targetId: uuid(brandId),
        patch,
        // a brand rename lands on every deal pointing at it, so like a deal edit
        // it never comes out `safe` however dull the field is. `safe` is the one
        // tier that writes with nobody looking.
        risk: worst("review", riskOf(BRAND_FIELDS, fields, BRAND_RENAME)),
        dedupeKey: brandId ? `edit:brand:${brandId}:${fingerprint(fields, [])}` : null,
      };
    }

    case "propose_deal_delete": {
      const dealId = str(patch.deal_id);
      return {
        entity: "deal",
        op: "delete",
        targetId: uuid(dealId),
        patch,
        // a delete takes the deal's accounts, rules, videos and earnings
        // history with it. it is the most destructive card there is, so it
        // wears the money tier: never auto-applied, loudly badged.
        risk: "money",
        // one live delete card per deal. asking twice surfaces the same card.
        dedupeKey: dealId ? `delete:deal:${dealId}` : null,
      };
    }

    case "propose_bonus_rule": {
      const dealId = str(patch.deal_id);
      // every rule field is money-shaped by definition: this is the thing that
      // decides what a brand owes. it is never anything but a card.
      return {
        entity: "bonus_rule",
        patch,
        risk: "money",
        dedupeKey: dealId
          ? `rule:${dealId}:${slug(patch.kind)}:${slug(patch.rate ?? patch.amount ?? JSON.stringify(patch.tiers ?? ""))}`
          : null,
      };
    }

    case "propose_deal_account": {
      const dealId = str(patch.deal_id);
      const platform = str(patch.platform);
      return {
        entity: "deal_account",
        patch,
        risk: riskOf(ACCOUNT_FIELDS, patch),
        // a deal holds one account per platform, so the deal and the platform
        // are the whole identity. a second handle for the same slot is the same
        // proposal, corrected.
        dedupeKey: dealId && platform ? `acct:${dealId}:${platform}` : null,
      };
    }

    default:
      return null;
  }
}

/**
 * Write the proposal. A dedupe collision is a success, not an error: it means
 * the creator already has this card waiting, which is exactly what the index is
 * for. The existing row comes back so the ui can point at it.
 */
export async function recordProposal(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  messageId: string | null,
  name: string,
  raw: Record<string, unknown>
): Promise<{ proposal: Proposal; duplicate: boolean } | null> {
  const classified = classify(name, raw);
  if (!classified) return null;

  const row = {
    user_id: userId,
    thread_id: threadId,
    message_id: messageId,
    target_entity: classified.entity,
    target_id: classified.targetId ?? null,
    op: classified.op ?? ("create" as const),
    patch: classified.patch,
    evidence: str(raw.evidence),
    confidence: num(raw.confidence),
    risk_tier: classified.risk,
    dedupe_key: classified.dedupeKey,
  };

  const { data, error } = await db.from("ai_proposals").insert(row).select("*").single();

  if (!error && data) return { proposal: data as Proposal, duplicate: false };

  // 23505 is the partial unique index on (user_id, dedupe_key). anything else
  // is a real failure and belongs to the caller.
  if (error?.code !== "23505" || !classified.dedupeKey) {
    throw new Error(error?.message ?? "Could not save the proposal.");
  }

  const { data: existing } = await db
    .from("ai_proposals")
    .select("*")
    .eq("dedupe_key", classified.dedupeKey)
    .in("status", ["proposed", "accepted"])
    .maybeSingle();

  return existing ? { proposal: existing as Proposal, duplicate: true } : null;
}

/**
 * Safe tier and confident enough. Money is excluded by construction.
 *
 * Nothing flow can propose today classifies as `safe` — the calendar note was
 * the only one and it went with the calendar. The tier stays because it is read
 * off the field registry rather than assigned by hand, so the next safe field
 * that appears lands here without a code change.
 */
export function shouldAutoApply(proposal: Proposal): boolean {
  return proposal.risk_tier === "safe" && (proposal.confidence ?? 0) >= AUTO_APPLY_AT;
}
