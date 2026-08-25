/**
 * The field registry, read twice more.
 *
 * `lib/deal-schema.ts` says every field is defined once and read by four
 * consumers: the form, the normaliser, flow's tool schemas, and flow's field
 * descriptions. This file is consumers three and four. Nothing here invents a
 * field name, a label, an enum value or a cap — it reads them off the registry
 * and turns them into json schema.
 *
 * That is the whole reason this file exists rather than a hand written schema
 * sitting next to the tool definitions. A hand written one drifts, and the way
 * drift shows up is an ai proposing a `pay_cycle` of "every month" that the
 * database rejects three layers from the cause.
 *
 * Pure and client safe, same as the registry it reads.
 */

import {
  ACCOUNT_FIELDS,
  BRAND_FIELDS,
  DEAL_FIELDS,
  RULE_FIELDS,
  type FieldSpec,
} from "@/lib/deal-schema";
import type { RiskTier } from "./types";

export type JsonSchema = Record<string, unknown>;

/**
 * One field to one json schema property.
 *
 * Money is a **string**, not a number, and that is deliberate. `parseCents`
 * takes what a rate sheet says ("$1,250.50", "750") and does the multiply, so
 * the model writes what it read and the one place that turns dollars into cents
 * stays the one place. A number type here would invite a float.
 */
function property(spec: FieldSpec): JsonSchema {
  const base = { description: spec.ai };

  switch (spec.kind) {
    case "enum":
      return { ...base, type: "string", enum: (spec.options ?? []).map((o) => o.value) };
    case "count":
      return {
        ...base,
        type: "integer",
        ...(spec.min === undefined ? { minimum: 0 } : { minimum: spec.min }),
        ...(spec.max === undefined ? {} : { maximum: spec.max }),
      };
    case "money":
      return { ...base, type: "string" };
    case "date":
      return { ...base, type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
    default:
      return { ...base, type: "string", ...(spec.max === undefined ? {} : { maxLength: spec.max }) };
  }
}

type Registry = Record<string, FieldSpec>;

/**
 * Schema properties for a registry, optionally renaming a key on the way out.
 *
 * The rename exists for exactly one field. The registry calls the flat fee
 * `flat_fee_cents` because that is the column, while `DealDraftInput` calls it
 * `flat_fee` because that is what the form posts. Rather than let the tool
 * schema pick one and hope, the mapping is written down here.
 */
export function propertiesOf(
  registry: Registry,
  rename: Record<string, string> = {},
  only?: readonly string[]
): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [key, spec] of Object.entries(registry)) {
    if (only && !only.includes(key)) continue;
    out[rename[key] ?? key] = property(spec);
  }
  return out;
}

/** The registry key behind an input key, undoing the rename above. */
function sourceKey(registry: Registry, rename: Record<string, string>, key: string): string {
  const back = Object.entries(rename).find(([, to]) => to === key)?.[0];
  return back && back in registry ? back : key;
}

const ORDER: Record<RiskTier, number> = { safe: 0, review: 1, money: 2 };

/**
 * The highest risk among the fields a patch actually sets.
 *
 * Highest wins and an unknown field counts as `review`, so the failure mode of
 * a field nobody classified is a card a human reads, never a silent write. A
 * patch that sets nothing is `review` too: an empty proposal is a bug, and the
 * safe tier is the one place that auto-applies.
 */
export function riskOf(
  registry: Registry,
  patch: Record<string, unknown>,
  rename: Record<string, string> = {}
): RiskTier {
  let worst: RiskTier = "safe";
  let sawAny = false;

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") continue;
    sawAny = true;
    const spec = registry[sourceKey(registry, rename, key)];
    const tier: RiskTier = spec ? spec.risk : "review";
    if (ORDER[tier] > ORDER[worst]) worst = tier;
  }

  return sawAny ? worst : "review";
}

/* ------------------------------------------------------- the four registries */

/** `flat_fee_cents` is the column; `flat_fee` is what the draft input calls it. */
export const DEAL_RENAME = { flat_fee_cents: "flat_fee" } as const;

/**
 * The brand half of a deal draft is prefixed, and it has to be.
 *
 * `BRAND_FIELDS.name` is the brand and `DEAL_FIELDS.name` is the campaign. Both
 * are literally `name`, so spreading the two registries into one tool schema
 * silently drops the brand — which then fails at apply time with "give the
 * brand a name", three layers from the cause. `DealDraftInput` already solved
 * this by prefixing; this is the same prefix, applied where the schema is built.
 */
export const BRAND_RENAME = { name: "brand_name", website: "brand_website" } as const;

/**
 * Only the two brand fields a draft can actually carry.
 *
 * `contact_name` and `contact_email` are real fields on the brand form, but
 * `normalizeDealDraft` has nowhere to put them, so offering them to a model
 * would produce values that are accepted and then thrown away. A field flow
 * cannot deliver is worse than one it was never told about.
 */
const DRAFT_BRAND_KEYS = ["name", "website"] as const;

export const dealProperties = () => propertiesOf(DEAL_FIELDS, DEAL_RENAME);
export const brandProperties = () =>
  propertiesOf(BRAND_FIELDS, BRAND_RENAME, DRAFT_BRAND_KEYS);
export const accountProperties = () => propertiesOf(ACCOUNT_FIELDS);
export const ruleProperties = () => propertiesOf(RULE_FIELDS);

export { ACCOUNT_FIELDS, BRAND_FIELDS, DEAL_FIELDS, RULE_FIELDS };
