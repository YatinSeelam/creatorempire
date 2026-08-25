/**
 * The single door a deal comes in through.
 *
 * `normalizeDealDraft()` in `lib/deal-schema.ts` decides whether a set of loose
 * values is a valid deal. This decides what rows that deal becomes. Keeping
 * them apart matters because the first half is pure and runs anywhere, and this
 * half needs a database and a signed-in user.
 *
 * It exists as its own function rather than as the body of the create action
 * for one reason: the AI brain-dump feature will hand it exactly the same
 * `DealDraft` the form does. `04-AI-LAYER.md` puts it plainly — flow proposes,
 * a human applies, and the apply calls the same code the UI calls with the same
 * validation, the same RLS and the same user. One door means an AI can never
 * write a shape the form could not, and never write one at all without a person
 * pressing the button that gets here.
 *
 * Everything runs as the signed-in user against RLS. `user_id` is read from the
 * session by the caller and passed in, never taken from a form.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { brandSlug, logoForNewBrand, matchCuratedBrand } from "@/lib/brand-catalog";
import type { DealDraft } from "@/lib/deal-schema";
import { PLATFORM_LABEL } from "@/lib/deals";

export type IntakeResult =
  | { ok: true; dealId: string; brandId: string; warning?: string }
  | { ok: false; error: string };

type BrandRef = { ok: true; id: string } | { ok: false; error: string };

/**
 * The brand a deal attaches to, found or made.
 *
 * One "Candle" per creator: a second deal with a brand already on file joins
 * that brand instead of forking its history in two. The match is done in JS
 * against the creator's own (short) brand list rather than with `ilike`,
 * because PostgREST reads `%`, `_` and `*` inside an ilike value as wildcards
 * and a brand legitimately named "50% Off" would then match half the table.
 * Slugging both sides also means "Wispr Flow" and "wisprflow" land on one row,
 * which is the same rule the unique index enforces one level down.
 */
async function resolveBrand(
  db: SupabaseClient,
  userId: string,
  brand: DealDraft["brand"]
): Promise<BrandRef> {
  if (brand.id) {
    // RLS scopes this, so a stolen id from another creator reads as missing.
    const { data } = await db.from("brands").select("id").eq("id", brand.id).maybeSingle();
    if (!data) return { ok: false, error: "That brand is no longer there. Pick another one." };
    return { ok: true, id: data.id as string };
  }

  const name = brand.name.trim();
  if (!name) return { ok: false, error: "Give the brand a name." };

  const { data: mine, error: readError } = await db
    .from("brands")
    .select("id, name, logo_key, logo_url, website");

  if (readError) return { ok: false, error: readError.message };

  const slug = brandSlug(name);
  const existing = (mine ?? []).find((b) => brandSlug(String(b.name)) === slug);
  const curated = matchCuratedBrand(name);

  if (existing) {
    // the brand is already on file, so its name is left exactly as it was
    // saved. only genuinely empty fields are filled in, because a creator who
    // uploaded their own mark, or corrected the url, should not lose either to
    // a catalogue entry.
    const patch: Record<string, string> = {};
    if (!existing.logo_key && !existing.logo_url) {
      if (brand.logoUrl) patch.logo_url = brand.logoUrl;
      else if (brand.logoKey) patch.logo_key = brand.logoKey;
      else {
        const found = logoForNewBrand(name, brand.website ?? existing.website ?? null);
        if (found.logo_key) patch.logo_key = found.logo_key;
        else if (found.logo_url) patch.logo_url = found.logo_url;
      }
    }
    if (!existing.website) {
      const site = brand.website ?? curated?.website ?? null;
      if (site) patch.website = site;
    }
    if (Object.keys(patch).length > 0) {
      await db.from("brands").update(patch).eq("id", existing.id);
    }
    return { ok: true, id: existing.id as string };
  }

  // an upload is the creator saying "this one", so it silences the name match:
  // brandLogo() prefers the key, and a niche brand that happens to share a name
  // with a catalogue entry must not wear the wrong mark. failing both, a brand
  // with a site still gets that site's favicon, which is the difference between
  // a new brand showing its mark and showing a letter.
  const mark = brand.logoUrl
    ? { logo_key: null, logo_url: brand.logoUrl }
    : brand.logoKey
      ? { logo_key: brand.logoKey, logo_url: null }
      : logoForNewBrand(name, brand.website ?? null);

  const { data, error } = await db
    .from("brands")
    .insert({
      user_id: userId,
      name,
      // name matching happens here, once, and the answer is stored. a brand
      // typed rather than picked, or proposed by the AI layer, still arrives
      // with its real mark and its url, and `brandLogo()` stays a pure lookup.
      logo_key: mark.logo_key,
      logo_url: mark.logo_url,
      website: brand.website ?? curated?.website ?? null,
    })
    .select("id")
    .maybeSingle();

  if (data) return { ok: true, id: data.id as string };

  // two tabs, one brand: the unique index on (user_id, lower(name)) caught the
  // second write, so read back the row the first one made.
  if (error?.code === "23505") {
    const { data: raced } = await db.from("brands").select("id, name");
    const found = (raced ?? []).find((b) => brandSlug(String(b.name)) === slug);
    if (found) return { ok: true, id: found.id as string };
  }

  return { ok: false, error: error?.message ?? "Could not save the brand." };
}

/**
 * Brand, deal, accounts, in that order, because each needs the one before it.
 *
 * Accounts are the one part that can fail without failing the whole thing. The
 * deal exists by then and losing it because a handle was already on another
 * row would be worse than landing on the deal page with a note saying which
 * account did not stick.
 */
export async function applyDealDraft(
  db: SupabaseClient,
  userId: string,
  draft: DealDraft,
  /**
   * whose books the deal lands on: null for the creator's own account, an org
   * id for the agency seat they are working in. read from the workspace by
   * the caller (`dealScope()`), never from the form, and a trigger in the db
   * refuses an org the creator does not sit on.
   */
  orgId: string | null = null
): Promise<IntakeResult> {
  const brand = await resolveBrand(db, userId, draft.brand);
  if (!brand.ok) return { ok: false, error: brand.error };

  const { data, error } = await db
    .from("deals")
    .insert({ user_id: userId, brand_id: brand.id, org_id: orgId, ...draft.deal })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the deal." };
  const dealId = data.id as string;

  const missed: string[] = [];

  for (const account of draft.accounts) {
    const { error: accountError } = await db.from("deal_accounts").insert({
      user_id: userId,
      deal_id: dealId,
      platform: account.platform,
      handle: account.handle,
    });
    if (accountError) missed.push(PLATFORM_LABEL[account.platform]);
  }

  return {
    ok: true,
    dealId,
    brandId: brand.id,
    warning: missed.length
      ? `The deal is saved, but the ${missed.join(" and ")} account did not attach. Add it below.`
      : undefined,
  };
}
