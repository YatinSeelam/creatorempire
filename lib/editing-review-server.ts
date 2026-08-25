/**
 * Client review links: the reads. Server only.
 *
 * Two audiences, two paths, on purpose.
 *
 * The dashboard half (`loadReviewLink`, `loadReviewNotes`) runs on the caller's
 * own client and RLS decides it: the creator sees the token, both sides of the
 * job see the feedback.
 *
 * The public half (`loadReviewRoom`) has no session at all. It goes through the
 * `review_link_room` rpc, which is security definer and whose projection IS the
 * access control — no pay, no credits, no brief, no editor. The only thing this
 * file adds on top is signing the uploaded cuts, which needs a client that can
 * read a private bucket. That is the service key, used here for the same reason
 * the stripe webhook uses it: the caller already proved a capability (the
 * token) that no policy could have expressed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_URL_PREFIX, BUCKET, isStorageUrl, PLAYABLE } from "@/lib/editing-files";
import type { ReviewLink, ReviewNote, ReviewVerdict } from "@/lib/editing-review";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

// ------------------------------------------------------------ the dashboard

/** This job's review link, or null when the creator never made one. */
export async function loadReviewLink(
  supabase: SupabaseClient,
  jobId: string
): Promise<ReviewLink | null> {
  const { data } = await supabase
    .from("edit_job_review_links")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return null;
  return { ...(data as ReviewLink), views: Number((data as ReviewLink).views ?? 0) };
}

/**
 * Everything the client has said on this job, newest first. Readable by the
 * creator and by the editor holding the job, because "make the hook shorter"
 * is the editor's instruction and retyping it through a third person loses it.
 */
export async function loadReviewNotes(
  supabase: SupabaseClient,
  jobId: string
): Promise<ReviewNote[]> {
  const { data } = await supabase
    .from("edit_job_review_notes")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as ReviewNote[]).map((n) => ({
    ...n,
    version: Number(n.version ?? 0),
  }));
}

// --------------------------------------------------------------- the room

export type RoomCut = {
  id: string;
  version: number;
  note: string | null;
  created_at: string;
  /** signed url, external link, or null when the file is gone. */
  url: string | null;
  /** true when the browser can play it inline rather than linking out. */
  playable: boolean;
  /** true when this is an uploaded file rather than a pasted link. */
  uploaded: boolean;
};

export type ReviewRoom = {
  label: string | null;
  closed: boolean;
  awaitingCut: boolean;
  job: {
    title: string;
    brand_name: string | null;
    brand_logo_key: string | null;
    brand_logo_url: string | null;
    video_count: number;
    status: string;
    delivered_at: string | null;
    approved_at: string | null;
  };
  cuts: RoomCut[];
  notes: {
    id: string;
    verdict: ReviewVerdict;
    reviewer_name: string | null;
    body: string | null;
    version: number;
    deliverable_id: string | null;
    created_at: string;
  }[];
};

export type RoomResult =
  | { ok: true; room: ReviewRoom }
  | { ok: false; reason: "missing" | "revoked" | "expired" };

/**
 * The public review page's whole read. One rpc, then one storage call for
 * however many cuts were uploaded rather than linked.
 */
export async function loadReviewRoom(token: string): Promise<RoomResult> {
  // the caller's own client, which on this route carries no session. the rpc
  // is granted to anon, so a signed-out visitor and a signed-in one get the
  // identical answer and neither one is trusted with more than the token buys.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_link_room", { p_token: token });
  if (error || !data) return { ok: false, reason: "missing" };

  const payload = data as Record<string, unknown>;
  if (payload.ok !== true) {
    const reason = String(payload.reason ?? "missing");
    return {
      ok: false,
      reason: reason === "revoked" || reason === "expired" ? reason : "missing",
    };
  }

  const rawCuts = (payload.cuts ?? []) as {
    id: string;
    url: string;
    note: string | null;
    version: number;
    created_at: string;
  }[];

  const signed = await signCuts(rawCuts.map((c) => c.url));

  return {
    ok: true,
    room: {
      label: (payload.label as string | null) ?? null,
      closed: Boolean(payload.closed),
      awaitingCut: Boolean(payload.awaiting_cut),
      job: payload.job as ReviewRoom["job"],
      cuts: rawCuts.map((cut) => {
        const uploaded = isStorageUrl(cut.url);
        const url = uploaded ? (signed.get(cut.url) ?? null) : cut.url;
        return {
          id: cut.id,
          version: Number(cut.version ?? 0),
          note: cut.note,
          created_at: cut.created_at,
          url,
          uploaded,
          // an uploaded cut is played off its stored path, not off the signed
          // url, which carries a token query string the regex would trip on.
          playable: Boolean(
            url && PLAYABLE.test(uploaded ? cut.url.slice(STORAGE_URL_PREFIX.length) : url)
          ),
        };
      }),
      notes: (payload.notes ?? []) as ReviewRoom["notes"],
    },
  };
}

/**
 * Sentinel urls into signed ones, in one storage call.
 *
 * With no service key set the map comes back empty and every uploaded cut
 * renders as "ask for a link instead" — degraded rather than broken, and cuts
 * the editor pasted as a link keep working either way.
 */
async function signCuts(urls: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const sentinels = urls.filter(isStorageUrl);
  if (sentinels.length === 0) return out;

  const service = createServiceClient();
  if (!service) {
    console.error("[review] no service key, uploaded cuts cannot be shown");
    return out;
  }

  const paths = sentinels.map((u) => u.slice(STORAGE_URL_PREFIX.length));
  const { data } = await service.storage.from(BUCKET).createSignedUrls(paths, 3600);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) {
      out.set(`${STORAGE_URL_PREFIX}${row.path}`, row.signedUrl);
    }
  }
  return out;
}
