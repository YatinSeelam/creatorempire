/**
 * Everything the autoposting workspace draws, in one read.
 *
 * The page is a brand picker over three screens, and all three want the same
 * four things: which deals exist and what is connected on each, what is already
 * scheduled, what cuts are available to schedule, and the tag preset for this
 * brand. Splitting that across the screens meant every tab switch was a round
 * trip for rows the last tab already had.
 *
 * One thing here is deliberately cheap and one is deliberately not.
 *
 * The picker's connection dots come from the `social_profiles` rows as they
 * were last cached, with no upstream call at all. Refreshing every deal's
 * connections on page load would be one Upload-Post request per brand, and the
 * dots only have to be roughly right to pick a brand by. The deal actually
 * opened goes through `loadConnections`, which does refresh and which is what
 * every other page in the product uses, so the platform list the wizard offers
 * is never stale.
 */

import { cache } from "react";
import { PLATFORMS, type Platform } from "@/lib/deals";
import { BUCKET, PLAYABLE, STORAGE_URL_PREFIX, isStorageUrl } from "@/lib/editing-files";
import { brandLogo } from "@/lib/brand-catalog";
import { loadConnections } from "@/lib/autopost/server";
import {
  DEFAULT_OPTIONS,
  withDefaults,
  type AutopostWorkspaceView,
  type BatchClip,
  type DealCard,
  type PostStatus,
  type ScheduledPost,
} from "@/lib/autopost/plan";
import { createClient } from "@/lib/supabase/server";
import { currentTz } from "@/lib/tz-server";
import { wallClock } from "@/lib/tz";
import { dealScope, onBooks } from "@/lib/workspace";
import { VARIATIONS_BUCKET, VARIATIONS_URL_PREFIX } from "@/lib/variations/model";

const noneConnected = (): Record<Platform, boolean> =>
  Object.fromEntries(PLATFORMS.map((p) => [p, false])) as Record<Platform, boolean>;

/** The shape itself lives in plan.ts, so the client component can take it
 *  without importing this module and dragging the server client with it. */
export type AutopostWorkspace = AutopostWorkspaceView;

/**
 * A stored timestamp back into the local day and minute it was planned in.
 *
 * The reverse of `scheduledAt`. Both have to exist because the plan is a wall
 * clock and the column is an instant, and the round trip has to land on the
 * same wall clock it left on.
 */
function splitLocal(iso: string | null, tz: string): { day: string; min: number } {
  return wallClock(iso ? new Date(iso) : new Date(), tz);
}

export const loadAutopostWorkspace = cache(
  async (wantedDealId?: string | null): Promise<AutopostWorkspace | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const scope = await dealScope();
    const [col, op, value] = onBooks(scope);

    const { data: dealRows } = await supabase
      .from("deals")
      .select("id, name, brand_id, brand:brands(name, logo_key, logo_url)")
      .filter(col, op, value)
      .neq("status", "ended")
      .order("created_at", { ascending: false });

    const deals = (dealRows ?? []) as unknown as {
      id: string;
      name: string;
      /** the variations read is keyed on this, not on the deal. */
      brand_id: string | null;
      brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
    }[];

    if (deals.length === 0) {
      return {
        deals: [],
        dealId: null,
        posts: [],
        clips: [],
        hashtags: [],
        options: DEFAULT_OPTIONS,
        configured: Boolean(process.env.UPLOAD_POST_API_KEY),
        connected: noneConnected(),
      };
    }

    const ids = deals.map((d) => d.id);

    // the cached half: profiles for the dots, accounts for the hollow dots, and
    // every pending post so the picker can say how many each brand has waiting.
    const [profileRes, accountRes, countRes] = await Promise.all([
      supabase.from("social_profiles").select("deal_id, connected").in("deal_id", ids),
      supabase.from("deal_accounts").select("deal_id, platform, handle").in("deal_id", ids),
      supabase
        .from("social_posts")
        .select("deal_id, status")
        .in("deal_id", ids)
        .in("status", ["scheduled", "processing"]),
    ]);

    const connectedBy = new Map<string, Record<string, string>>();
    for (const row of (profileRes.data ?? []) as {
      deal_id: string | null;
      connected: Record<string, string> | null;
    }[]) {
      if (row.deal_id) connectedBy.set(row.deal_id, row.connected ?? {});
    }

    const trackedBy = new Map<string, Record<Platform, boolean>>();
    const handleBy = new Map<string, string>();
    for (const row of (accountRes.data ?? []) as {
      deal_id: string;
      platform: Platform;
      handle: string;
    }[]) {
      const marks = trackedBy.get(row.deal_id) ?? noneConnected();
      marks[row.platform] = true;
      trackedBy.set(row.deal_id, marks);
      if (!handleBy.has(row.deal_id)) handleBy.set(row.deal_id, row.handle);
    }

    const pendingBy = new Map<string, number>();
    for (const row of (countRes.data ?? []) as { deal_id: string | null }[]) {
      if (row.deal_id) pendingBy.set(row.deal_id, (pendingBy.get(row.deal_id) ?? 0) + 1);
    }

    const cards: DealCard[] = deals.map((deal) => {
      const conn = connectedBy.get(deal.id) ?? {};
      const marks = noneConnected();
      for (const p of PLATFORMS) marks[p] = Boolean(String(conn[p] ?? "").trim());

      return {
        id: deal.id,
        name: deal.brand ? `${deal.brand.name} · ${deal.name}` : deal.name,
        brandName: deal.brand?.name ?? deal.name,
        logo: deal.brand ? brandLogo(deal.brand) : "",
        handle: handleBy.get(deal.id) ?? null,
        connected: marks,
        tracked: trackedBy.get(deal.id) ?? noneConnected(),
        scheduled: pendingBy.get(deal.id) ?? 0,
      };
    });

    // a hand-typed deal id that is not this creator's simply is not in the list,
    // so it falls back to the first rather than being refused.
    const dealId = ids.includes(String(wantedDealId)) ? String(wantedDealId) : ids[0];

    const [connections, posts, cuts, renders, preset] = await Promise.all([
      loadConnections(supabase, user.id, dealId).catch(() => ({
        connected: {} as Record<string, string>,
        lastCheckedAt: null,
        configured: Boolean(process.env.UPLOAD_POST_API_KEY),
      })),
      loadDealPosts(supabase, dealId),
      loadDealClips(supabase, dealId),
      loadVariationClips(supabase, deals.find((d) => d.id === dealId)?.brand_id ?? null),
      supabase
        .from("deal_post_presets")
        .select("hashtags, options")
        .eq("deal_id", dealId)
        .maybeSingle(),
    ]);

    const live = noneConnected();
    for (const p of PLATFORMS) live[p] = Boolean(String(connections.connected[p] ?? "").trim());

    // the picker's dots for the open deal come from the refreshed read, so the
    // brand somebody is actually looking at never disagrees with the wizard.
    const openCard = cards.find((c) => c.id === dealId);
    if (openCard) openCard.connected = live;

    const presetRow = preset.data as { hashtags: string[] | null; options: unknown } | null;

    return {
      deals: cards,
      dealId,
      posts,
      // the editors' cuts first: they are the thing this tool was built around,
      // and a variation is a remix of something that already went through it.
      clips: [...cuts, ...renders],
      hashtags: presetRow?.hashtags ?? [],
      options: withDefaults(presetRow?.options),
      configured: connections.configured,
      connected: live,
    };
  }
);

/** Everything scheduled or already out for one deal, split back into wall clock. */
async function loadDealPosts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dealId: string
): Promise<ScheduledPost[]> {
  const tz = await currentTz();
  const { data } = await supabase
    .from("social_posts")
    .select(
      "id, deal_id, batch_id, caption, hashtags, platforms, video_name, video_url, source_ref, scheduled_for, created_at, status"
    )
    .eq("deal_id", dealId)
    .order("scheduled_for", { ascending: true, nullsFirst: false })
    .limit(400);

  const rows = (data ?? []) as {
    id: string;
    deal_id: string | null;
    batch_id: string | null;
    caption: string;
    hashtags: string[] | null;
    platforms: string[];
    video_name: string | null;
    video_url: string | null;
    source_ref: string | null;
    scheduled_for: string | null;
    created_at: string;
    status: PostStatus;
  }[];

  // posters, re-signed now rather than trusted from the row. an editor's cut is
  // a sentinel in `source_ref` and gets a fresh hour; an upload lives in the
  // public bucket, so its stored `video_url` never went stale in the first
  // place. one storage call for the whole queue.
  const paths = rows
    .map((r) => r.source_ref ?? "")
    .filter((ref) => isStorageUrl(ref))
    .map((ref) => ref.slice(STORAGE_URL_PREFIX.length));

  const signedBy = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls([...new Set(paths)], 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedBy.set(s.path, s.signedUrl);
    }
  }

  return rows.map((row) => {
    // a post with no schedule went out the moment it was made, so the day it
    // belongs on is the day it was created. it still has to sit somewhere on
    // the calendar or it silently disappears from the only view of the queue.
    const { day, min } = splitLocal(row.scheduled_for ?? row.created_at, tz);

    const ref = row.source_ref ?? "";
    const stored = isStorageUrl(ref);
    const poster = stored
      ? (signedBy.get(ref.slice(STORAGE_URL_PREFIX.length)) ?? null)
      : (row.video_url ?? null);

    return {
      id: row.id,
      dealId: row.deal_id,
      batchId: row.batch_id,
      caption: row.caption,
      hashtags: row.hashtags ?? [],
      platforms: row.platforms.filter((p): p is Platform =>
        (PLATFORMS as readonly string[]).includes(p)
      ),
      videoName: row.video_name,
      previewUrl: poster && PLAYABLE.test(stored ? ref : poster) ? poster : null,
      day,
      min,
      status: row.status,
    };
  });
}

/**
 * The cuts a batch can be built from: every edit delivered on a job for this
 * brand, newest first.
 *
 * `ref` is left exactly as the deliverable stored it, sentinel and all. It is
 * only signed when a post is actually scheduled, because a signed url minted at
 * page load would have expired long before Upload-Post fetches it.
 *
 * `previewUrl` is the other half and is signed HERE, for the poster frame the
 * picker draws. The old objection to signing at load was cost, and it does not
 * hold: `createSignedUrls` takes the whole list in one call, so a hundred cuts
 * is one request, not a hundred. It only has to outlive the open tab.
 */
async function loadDealClips(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dealId: string
): Promise<BatchClip[]> {
  const { data: jobs } = await supabase
    .from("edit_jobs")
    .select("id, title, editor_name")
    .eq("deal_id", dealId)
    .limit(100);

  const jobRows = (jobs ?? []) as { id: string; title: string; editor_name: string | null }[];
  if (jobRows.length === 0) return [];

  const byId = new Map(jobRows.map((j) => [j.id, j] as const));

  const { data } = await supabase
    .from("edit_job_deliverables")
    .select("id, job_id, url, version, created_at")
    .in(
      "job_id",
      jobRows.map((j) => j.id)
    )
    .order("created_at", { ascending: false })
    .limit(120);

  const rows = (data ?? []) as {
    id: string;
    job_id: string;
    url: string;
    version: number;
    created_at: string;
  }[];

  // one call for the lot. a cut stored as a sentinel gets a signed url the
  // browser can seek; a pasted link is already one and is handed straight back.
  const paths = rows
    .filter((r) => isStorageUrl(r.url))
    .map((r) => r.url.slice(STORAGE_URL_PREFIX.length));

  const signedBy = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedBy.set(s.path, s.signedUrl);
    }
  }

  return rows.map((row) => {
    const job = byId.get(row.job_id);
    const stored = isStorageUrl(row.url);
    const path = stored ? row.url.slice(STORAGE_URL_PREFIX.length) : row.url;
    const playable = stored ? (signedBy.get(path) ?? null) : row.url;

    return {
      id: row.id,
      name: job ? `${job.title} · cut ${row.version}` : `cut ${row.version}`,
      source: "editor" as const,
      by: job?.editor_name || "your editor",
      when: new Date(row.created_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      ref: row.url,
      // a link out to youtube or drive is not a file a <video> can decode, so
      // it gets no poster rather than a broken player.
      previewUrl: playable && PLAYABLE.test(path) ? playable : null,
    };
  });
}

/**
 * The finished variations for the brand this deal is on.
 *
 * Autoposting could already see two kinds of clip: what an editor delivered and
 * what somebody dragged in. A rendered variation is neither, and it is the one
 * the tool actually produces — nine cuts of one shoot with different hooks is
 * exactly a posting batch, and until now the only way to get one out of
 * Variations and into a schedule was to download it and upload it again.
 *
 * Keyed on the BRAND rather than the deal, because that is what a variation
 * belongs to: `variation_renders.brand_id` is the only link it has, and a brand
 * with two deals should offer its renders on both.
 *
 * `done` only. A render still queued has no file behind it and a failed one
 * never will, so neither is something to schedule a post against.
 */
async function loadVariationClips(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string | null
): Promise<BatchClip[]> {
  if (!brandId) return [];

  const { data } = await supabase
    .from("variation_renders")
    .select("id, label, output_path, poster_path, created_at, batch_id")
    .eq("brand_id", brandId)
    .eq("status", "done")
    .not("output_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);

  const rows = (data ?? []) as {
    id: string;
    label: string | null;
    output_path: string | null;
    poster_path: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  // one call for the lot, same as the cuts. the poster is what the picker
  // draws; `ref` stays a sentinel and is signed again at schedule time, because
  // a url minted at page load is stale long before the post fires.
  const paths = rows.map((r) => r.output_path!).filter(Boolean);
  const signedBy = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(VARIATIONS_BUCKET)
      .createSignedUrls(paths, 3600);
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedBy.set(item.path, item.signedUrl);
    }
  }

  return rows.map((row) => ({
    id: `variation:${row.id}`,
    name: row.label?.trim() || "variation",
    source: "variation" as const,
    by: "variations",
    when: new Date(row.created_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    ref: `${VARIATIONS_URL_PREFIX}${row.output_path}`,
    previewUrl: signedBy.get(row.output_path!) ?? null,
  }));
}

/** True when a deliverable's url is an uploaded file rather than a link out. */
export function needsSigning(url: string): boolean {
  return isStorageUrl(url);
}

export { STORAGE_URL_PREFIX };
