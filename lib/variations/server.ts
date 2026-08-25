import "server-only";

import { brandLogo } from "@/lib/brand-catalog";
import { createClient } from "@/lib/supabase/server";
import { dealScope, onBooks } from "@/lib/workspace";
import {
  type BatchWithRenders,
  type BrandBank,
  type ComponentKind,
  type VariationBatch,
  type VariationComponent,
  type VariationRender,
} from "./model";

/**
 * Every read the variations tool does. All of it goes through the signed-in
 * user's own client, so rls is the scoping and nothing here filters by user_id
 * itself.
 */

const COMPONENT_COLS =
  "id, brand_id, kind, title, storage_path, poster_path, text_content, text_style, duration_seconds, trim_start_seconds, trim_end_seconds, source_url, audio_role, audio_gain, created_at";

const RENDER_COLS =
  "id, batch_id, brand_id, hook_id, demo_id, audio_id, sfx_id, text_hook_id, label, text_content, text_style, status, progress, output_path, poster_path, error, attempts, created_at";

const EMPTY_COUNTS: Record<ComponentKind, number> = {
  hook: 0,
  demo: 0,
  audio: 0,
  text_hook: 0,
};

/**
 * The brand picker: one bank per brand you have a deal with.
 *
 * A bank is not its own thing to create. The tool used to offer a "new brand
 * bank" tile that wrote a `brands` row directly, and the result was two lists
 * of companies that disagreed: five banks against three deals, with nothing on
 * the deals screen explaining where the other two came from. Deals are the
 * registry, so a brand earns a bank by having a deal and loses the tile when it
 * has none.
 *
 * The one exception is a brand that already holds clips. That can only happen
 * to a bank whose deal was deleted afterwards, and hiding it would strand
 * uploads somewhere with no way back to them.
 *
 * Brands with an empty bank are still listed, because the first thing anyone
 * needs here is somewhere to put the first clip.
 */
export async function loadBrandBanks(): Promise<BrandBank[]> {
  const [supabase, scope] = await Promise.all([createClient(), dealScope()]);

  const [brands, components, renders, deals] = await Promise.all([
    supabase
      // logo_key as well as logo_url: the catalogue key is what most brands
      // actually carry, and reading only the uploaded url drew an initial for
      // every brand that came off the catalogue.
      .from("brands")
      .select("id, name, logo_key, logo_url")
      .order("name", { ascending: true }),
    supabase
      .from("variation_components")
      .select("brand_id, kind, poster_path, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("variation_renders")
      .select("brand_id, status, poster_path, created_at")
      .order("created_at", { ascending: false }),
    // "has a deal" means a deal on the books being looked at: a brand a
    // creator only works with for one agency is not a bank on their own account.
    supabase.from("deals").select("brand_id").filter(...onBooks(scope)),
  ]);

  if (!brands.data) return [];

  const withDeal = new Set((deals.data ?? []).map((d) => d.brand_id as string));
  const withClips = new Set((components.data ?? []).map((c) => c.brand_id as string));

  const banks = new Map<string, BrandBank>();
  for (const b of brands.data) {
    if (!withDeal.has(b.id) && !withClips.has(b.id)) continue;
    banks.set(b.id, {
      id: b.id,
      name: b.name,
      logo: brandLogo(b),
      counts: { ...EMPTY_COUNTS },
      renders: 0,
      posters: [],
      last_active: null,
    });
  }

  const touch = (bank: BrandBank, at: string) => {
    if (!bank.last_active || at > bank.last_active) bank.last_active = at;
  };

  for (const c of components.data ?? []) {
    const bank = banks.get(c.brand_id);
    if (!bank) continue;
    bank.counts[c.kind as ComponentKind] += 1;
    touch(bank, c.created_at);
    if (c.poster_path && bank.posters.length < 5) bank.posters.push(c.poster_path);
  }

  for (const r of renders.data ?? []) {
    const bank = banks.get(r.brand_id);
    if (!bank) continue;
    if (r.status === "done") bank.renders += 1;
    touch(bank, r.created_at);
  }

  // banks that have been used float to the top; the rest keep their name order
  // underneath, so an untouched brand is somewhere predictable rather than
  // sorted into the middle by a timestamp it does not have.
  return [...banks.values()].sort((a, b) => {
    if (a.last_active && b.last_active) return b.last_active.localeCompare(a.last_active);
    if (a.last_active) return -1;
    if (b.last_active) return 1;
    return a.name.localeCompare(b.name);
  });
}

/** the newest finished work across every brand, for the overview's tail */
export async function loadRecentBatches(limit = 6): Promise<
  { batch: VariationBatch; brand: { id: string; name: string; logo: string } | null; ready: number; total: number; poster: string | null }[]
> {
  const supabase = await createClient();

  const { data: batches } = await supabase
    .from("variation_batches")
    .select("id, brand_id, hook_count, demo_count, audio_count, text_count, audio_title, sfx_title, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!batches?.length) return [];

  const [{ data: renders }, { data: brands }] = await Promise.all([
    supabase
      .from("variation_renders")
      .select("batch_id, status, poster_path, created_at")
      .in("batch_id", batches.map((b) => b.id))
      .order("created_at", { ascending: true }),
    supabase
      .from("brands")
      .select("id, name, logo_key, logo_url")
      .in("id", [...new Set(batches.map((b) => b.brand_id))]),
  ]);

  const brandById = new Map(
    (brands ?? []).map((b) => [b.id, { id: b.id, name: b.name, logo: brandLogo(b) }])
  );

  return batches.map((batch) => {
    const mine = (renders ?? []).filter((r) => r.batch_id === batch.id);
    return {
      batch,
      brand: brandById.get(batch.brand_id) ?? null,
      ready: mine.filter((r) => r.status === "done").length,
      total: mine.length,
      poster: mine.find((r) => r.poster_path)?.poster_path ?? null,
    };
  });
}

export type Workspace = {
  brand: { id: string; name: string; logo: string };
  components: VariationComponent[];
  batches: BatchWithRenders[];
};

/** one brand's whole workspace: its bank and every batch it has rendered */
export async function loadWorkspace(brandId: string): Promise<Workspace | null> {
  const [supabase, scope] = await Promise.all([createClient(), dealScope()]);

  const { data: brand } = await supabase
    .from("brands")
    .select("id, name, logo_key, logo_url")
    .eq("id", brandId)
    .maybeSingle();

  if (!brand) return null;

  const [{ data: components }, { data: batches }, { count: dealCount }] = await Promise.all([
    supabase
      .from("variation_components")
      .select(COMPONENT_COLS)
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false }),
    supabase
      .from("variation_batches")
      .select("id, brand_id, hook_count, demo_count, audio_count, text_count, audio_title, sfx_title, created_at")
      .eq("brand_id", brandId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .filter(...onBooks(scope))
      .eq("brand_id", brandId),
  ]);

  // same rule the picker draws: no deal and nothing uploaded means this brand
  // has no bank, so a hand-typed url reads as missing rather than as a way back
  // to the create path that was removed.
  if (!(dealCount ?? 0) && !(components ?? []).length) return null;

  let renders: VariationRender[] = [];
  if (batches?.length) {
    const { data } = await supabase
      .from("variation_renders")
      .select(RENDER_COLS)
      .in("batch_id", batches.map((b) => b.id))
      .order("created_at", { ascending: true });
    renders = (data ?? []) as VariationRender[];
  }

  return {
    brand: { id: brand.id, name: brand.name, logo: brandLogo(brand) },
    components: (components ?? []) as VariationComponent[],
    batches: (batches ?? []).map((b) => ({
      ...b,
      renders: renders.filter((r) => r.batch_id === b.id),
    })),
  };
}

/** how many renders are mid-flight, for the header pill */
export async function countRendering(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("variation_renders")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "rendering"]);
  return count ?? 0;
}
