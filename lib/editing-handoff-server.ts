/**
 * Editor handoff links: the reads. Server only.
 *
 * Two audiences, two paths, the same split the review link uses.
 *
 * The dashboard half (`loadHandoffLink`) runs on the caller's own client and
 * RLS decides it: the token is the creator's alone.
 *
 * The public half (`loadHandoffRoom`) has no session at all. It goes through
 * the `handoff_link_room` rpc, which is security definer and whose projection
 * IS the access control — no pay, no credits, no owner, no cuts. The rpc hands
 * back bucket PATHS rather than urls, because a path into a private bucket is
 * worth nothing on its own; the only thing this file adds is signing them,
 * which needs a client that can read that bucket. That is the service key, used
 * here for the reason the review room uses it: the caller already proved a
 * capability (the token) no storage policy could have expressed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { BUCKET, PLAYABLE } from "@/lib/editing-files";
import type { LinkItem } from "@/lib/editing";
import { asLinkItems } from "@/lib/editing";
import type { HandoffLink } from "@/lib/editing-handoff";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

// ------------------------------------------------------------ the dashboard

/** This job's handoff link, or null when the creator never made one. */
export async function loadHandoffLink(
  supabase: SupabaseClient,
  jobId: string
): Promise<HandoffLink | null> {
  const { data } = await supabase
    .from("edit_job_handoff_links")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as HandoffLink), views: Number((data as HandoffLink).views ?? 0) };
}

// ---------------------------------------------------------------- the room

export type RoomFile = {
  id: string;
  kind: string;
  name: string;
  mime: string | null;
  size_bytes: number | null;
  /** signed for an hour, null when there is no service key to sign with. */
  url: string | null;
  /** the same url with a download disposition, so a click saves the file. */
  downloadUrl: string | null;
  /** true when the browser can play it inline rather than linking out. */
  playable: boolean;
  /** true for an image, which previews as a thumbnail rather than a player. */
  image: boolean;
};

export type HandoffRoom = {
  label: string | null;
  closed: boolean;
  delivered: boolean;
  job: {
    title: string;
    brand_name: string | null;
    brand_logo_key: string | null;
    brand_logo_url: string | null;
    video_count: number;
    tier: number;
    is_rush: boolean;
    brief: string | null;
    style: string | null;
    format: string | null;
    footage_links: LinkItem[];
    reference_links: LinkItem[];
    status: string;
    due_at: string | null;
    created_at: string;
  };
  /** the videos to cut. */
  footage: RoomFile[];
  /** what goes on top: b roll, music, logos, product shots. */
  assets: RoomFile[];
  /** words to read before cutting: the script, the sop, the guidelines. */
  docs: RoomFile[];
  /** the brand deal's shelf, which is assets and docs kept once per brand. */
  shelf: RoomFile[];
  /** true when uploaded files exist but nothing could be signed. */
  unsigned: boolean;
};

export type HandoffResult =
  | { ok: true; room: HandoffRoom }
  | { ok: false; reason: "missing" | "revoked" | "expired" };

type RawFile = {
  id: string;
  kind: string;
  path: string;
  name: string;
  mime: string | null;
  size_bytes: number | string | null;
};

/**
 * The public handoff page's whole read. One rpc, then one storage call for
 * every file on the job and its brand shelf together.
 */
export async function loadHandoffRoom(token: string): Promise<HandoffResult> {
  // the caller's own client, which on this route carries no session. the rpc is
  // granted to anon, so a signed-out visitor and a signed-in one get the
  // identical answer and neither is trusted with more than the token buys.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("handoff_link_room", { p_token: token });
  if (error || !data) return { ok: false, reason: "missing" };

  const payload = data as Record<string, unknown>;
  if (payload.ok !== true) {
    const reason = String(payload.reason ?? "missing");
    return {
      ok: false,
      reason: reason === "revoked" || reason === "expired" ? reason : "missing",
    };
  }

  const rawFiles = (payload.files ?? []) as RawFile[];
  const rawShelf = (payload.shelf ?? []) as RawFile[];
  const signed = await signPaths([
    ...rawFiles.map((f) => f.path),
    ...rawShelf.map((f) => f.path),
  ]);

  const shape = (row: RawFile): RoomFile => {
    const url = signed.get(row.path) ?? null;
    const mime = row.mime ?? null;
    const size =
      row.size_bytes === null || row.size_bytes === undefined
        ? null
        : Number(row.size_bytes);
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      mime,
      size_bytes: Number.isFinite(size as number) ? (size as number) : null,
      url,
      // supabase honours `download` on a signed url and sets the disposition
      // from it, which is what makes a click save the file under the name the
      // creator uploaded rather than the uuid it is stored as.
      downloadUrl: url ? `${url}&download=${encodeURIComponent(row.name)}` : null,
      // tested against the stored PATH, never the signed url: that carries a
      // token query string the regex would trip on.
      playable: PLAYABLE.test(row.path),
      image: (mime ?? "").startsWith("image/"),
    };
  };

  const files = rawFiles.map(shape);
  const shelf = rawShelf.map(shape);
  const total = files.length + shelf.length;

  const job = payload.job as Record<string, unknown>;

  return {
    ok: true,
    room: {
      label: (payload.label as string | null) ?? null,
      closed: Boolean(payload.closed),
      delivered: Boolean(payload.delivered),
      job: {
        title: String(job.title ?? "edit batch"),
        brand_name: (job.brand_name as string | null) ?? null,
        brand_logo_key: (job.brand_logo_key as string | null) ?? null,
        brand_logo_url: (job.brand_logo_url as string | null) ?? null,
        video_count: Number(job.video_count ?? 0),
        tier: Number(job.tier ?? 1),
        is_rush: Boolean(job.is_rush),
        brief: (job.brief as string | null) ?? null,
        style: (job.style as string | null) ?? null,
        format: (job.format as string | null) ?? null,
        footage_links: asLinkItems(job.footage_links),
        reference_links: asLinkItems(job.reference_links),
        status: String(job.status ?? "open"),
        due_at: (job.due_at as string | null) ?? null,
        created_at: String(job.created_at ?? ""),
      },
      footage: files.filter((f) => f.kind === "footage"),
      assets: files.filter((f) => f.kind === "asset" || f.kind === "reference"),
      docs: files.filter((f) => f.kind === "doc"),
      shelf,
      unsigned: total > 0 && signed.size === 0,
    },
  };
}

/**
 * Bucket paths into signed urls, in one storage call.
 *
 * With no service key set the map comes back empty and the room says the files
 * cannot be handed over right now — degraded rather than broken, and the links
 * the creator pasted into the brief keep working either way.
 */
async function signPaths(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;

  const service = createServiceClient();
  if (!service) {
    console.error("[handoff] no service key, uploaded files cannot be handed over");
    return out;
  }

  // an hour is long enough to download a batch and short enough that a url
  // forwarded on is dead by the time it is somebody else's problem.
  const { data } = await service.storage.from(BUCKET).createSignedUrls(paths, 3600);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
