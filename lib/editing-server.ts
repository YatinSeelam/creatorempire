/**
 * The creator side of the editing marketplace: reads only, server only.
 *
 * Same split as deals: types and pure helpers live in `lib/editing.ts` where the
 * browser can have them, anything that talks to the database lives here. Every
 * query is scoped to the signed-in creator explicitly, not just by RLS, because
 * a creator who is also an editor can see other people's open jobs through the
 * board policy and this page is "my jobs", not "jobs I can see".
 */

import {
  asLinkItems,
  asReelClips,
  asStringList,
  type EditJob,
  type Editor,
  type EditorPayout,
  type JobDeliverable,
  type JobEvent,
} from "@/lib/editing";
import {
  loadDealAssets,
  loadJobFiles,
  resolveDeliverables,
  type JobFile,
  type ResolvedDeliverable,
  type DealAsset,
} from "@/lib/editing-files";
import { brandLogo } from "@/lib/brand-catalog";
import type { ReviewLink, ReviewNote } from "@/lib/editing-review";
import { loadReviewLink, loadReviewNotes } from "@/lib/editing-review-server";
import type { HandoffLink } from "@/lib/editing-handoff";
import { loadHandoffLink } from "@/lib/editing-handoff-server";
import { createClient } from "@/lib/supabase/server";
import { dealScope } from "@/lib/workspace";

/** jsonb arrives loose; the app works on the typed shape. */
function normalizeJob(row: Record<string, unknown>): EditJob {
  const job = row as unknown as EditJob;
  return {
    ...job,
    footage_links: asLinkItems(job.footage_links),
    reference_links: asLinkItems(job.reference_links),
    pay_cents: Number(job.pay_cents ?? 0),
    video_count: Number(job.video_count ?? 1),
    tier: Number(job.tier ?? 1) === 2 ? 2 : 1,
    credits: Number(job.credits ?? 0),
    is_rush: Boolean(job.is_rush),
    change_rounds: Number(job.change_rounds ?? 0),
    revision_count: Number(job.revision_count ?? 0),
    rating: typeof row.rating === "number" ? (row.rating as number) : null,
  };
}

function normalizeEditor(row: Record<string, unknown>): Editor {
  const editor = row as unknown as Editor;
  const tier = Number(row.tier ?? 1);
  return {
    ...editor,
    skills: asStringList(editor.skills),
    software: asStringList(editor.software),
    links: asLinkItems(editor.links),
    reel: asReelClips(editor.reel),
    tier: tier === 3 ? 3 : tier === 2 ? 2 : 1,
  };
}

// ----------------------------------------------------------------- the list

export type EditJobListRow = {
  job: EditJob;
  deliverableCount: number;
  /** display name of the claimed editor, null while the job is unclaimed. */
  editorName: string | null;
};

/**
 * Every job this creator posted, newest first, with the two things the list
 * shows beyond the row itself: how many cuts came back and who is on it.
 */
/** keeps a job whose deal is on these books, or that has no deal yet. */
function onScope(orgId: string | null) {
  return (row: unknown): boolean => {
    const r = row as { deal_id: string | null; deal?: { org_id: string | null } | null };
    if (!r.deal_id) return true;
    return (r.deal?.org_id ?? null) === orgId;
  };
}

export async function loadEditJobs(): Promise<EditJobListRow[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("edit_jobs")
    .select("*, deal:deals(org_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  // this deploy is one workspace, and a login is shared with ugc flows. a job
  // on a deal from somebody's personal books does not belong on this screen.
  // a job with no deal yet stays, because that is what the wizard makes first.
  const scope = await dealScope();
  const jobs = (data ?? []).filter(onScope(scope.orgId)).map(normalizeJob);
  if (jobs.length === 0) return [];

  const jobIds = jobs.map((j) => j.id);
  const editorIds = [
    ...new Set(jobs.map((j) => j.editor_id).filter((v): v is string => v !== null)),
  ];

  const [deliverables, editors] = await Promise.all([
    supabase.from("edit_job_deliverables").select("job_id").in("job_id", jobIds),
    editorIds.length
      ? supabase.from("editors").select("user_id, name, handle").in("user_id", editorIds)
      : Promise.resolve({ data: [] }),
  ]);

  const countBy = new Map<string, number>();
  for (const d of deliverables.data ?? []) {
    const jobId = (d as { job_id: string }).job_id;
    countBy.set(jobId, (countBy.get(jobId) ?? 0) + 1);
  }

  const nameBy = new Map<string, string | null>(
    ((editors.data ?? []) as { user_id: string; name: string | null; handle: string }[]).map(
      (e) => [e.user_id, e.name || e.handle || null]
    )
  );

  return jobs.map((job) => ({
    job,
    deliverableCount: countBy.get(job.id) ?? 0,
    editorName: job.editor_id ? (nameBy.get(job.editor_id) ?? null) : null,
  }));
}

// --------------------------------------------------------------- the detail

export type EditJobDetail = {
  job: EditJob;
  /** newest first, sentinel urls already resolved to signed ones. */
  deliverables: ResolvedDeliverable[];
  /** uploaded footage, references and cuts, newest first, signed urls attached. */
  files: JobFile[];
  /** the brand deal's shelf, read live rather than copied onto the job, so a
   *  logo fixed once is fixed on every batch. empty when there is no deal. */
  dealAssets: DealAsset[];
  /** oldest first, the order a thread reads in. */
  events: JobEvent[];
  /** the claimed editor's profile, null while open. */
  editor: Editor | null;
  /** the frozen payout once approved, null before. */
  payout: EditorPayout | null;
  /** "Brand · deal name" when the job is pinned to a deal. */
  dealLabel: string | null;
  /** the client review link, null until the creator makes one. */
  reviewLink: ReviewLink | null;
  /** the editor handoff link, null until the creator makes one. */
  handoffLink: HandoffLink | null;
  /** what the client said on it, newest first. */
  clientNotes: ReviewNote[];
};

export async function loadEditJob(id: string): Promise<EditJobDetail | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row, error } = await supabase
    .from("edit_jobs")
    .select("*, deal:deals(org_id)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  if (!onScope((await dealScope()).orgId)(row)) return null;

  const job = normalizeJob(row);

  const [
    deliverables,
    events,
    payouts,
    editorRes,
    dealRes,
    files,
    reviewLink,
    clientNotes,
    dealAssets,
    handoffLink,
  ] = await Promise.all([
    supabase
      .from("edit_job_deliverables")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("edit_job_events")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("editor_payouts")
      .select("*")
      .eq("job_id", id)
      .order("created_at", { ascending: true })
      .limit(1),
    job.editor_id
      ? supabase.from("editors").select("*").eq("user_id", job.editor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    job.deal_id
      ? supabase
          .from("deals")
          .select("name, brand:brands(name)")
          .eq("id", job.deal_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadJobFiles(supabase, id),
    loadReviewLink(supabase, id),
    loadReviewNotes(supabase, id),
    loadDealAssets(supabase, job.deal_id),
    loadHandoffLink(supabase, id),
  ]);

  const payoutRow = ((payouts.data ?? []) as Record<string, unknown>[])[0];
  const payout = payoutRow
    ? {
        ...(payoutRow as unknown as EditorPayout),
        amount_cents: Number(payoutRow.amount_cents ?? 0),
      }
    : null;

  const dealRow = dealRes.data as unknown as
    | { name: string; brand: { name: string } | null }
    | null;

  return {
    job,
    deliverables: await resolveDeliverables(
      supabase,
      (deliverables.data ?? []) as JobDeliverable[]
    ),
    files,
    dealAssets,
    events: (events.data ?? []) as JobEvent[],
    editor: editorRes.data ? normalizeEditor(editorRes.data as Record<string, unknown>) : null,
    payout,
    dealLabel: dealRow ? (dealRow.brand ? `${dealRow.brand.name} · ${dealRow.name}` : dealRow.name) : null,
    reviewLink,
    clientNotes,
    handoffLink,
  };
}

// --------------------------------------------------------------- the picker

/**
 * A deal, as the job form's picker draws it.
 *
 * `label` is still the one-line form the review step and the summary print.
 * `brandName` and `logo` are split back out because the picker is a list of
 * brands with their marks now, not a `<select>` of strings: a creator running
 * five deals recognises the square before they have read a word of it, and
 * a native select cannot hold an image at all.
 */
export type DealOption = {
  id: string;
  label: string;
  brandName: string;
  name: string;
  /** "" when the brand has no mark. already resolved, never a raw key. */
  logo: string;
};

/** The creator's still-running deals, for the optional picker on the job form. */
export async function loadDealOptions(): Promise<DealOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deals")
    .select("id, name, brand:brands(name, logo_key, logo_url)")
    .neq("status", "ended")
    .order("created_at", { ascending: false });

  return (
    (data ?? []) as unknown as {
      id: string;
      name: string;
      brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    label: row.brand ? `${row.brand.name} · ${row.name}` : row.name,
    brandName: row.brand?.name ?? row.name,
    name: row.name,
    logo: row.brand ? brandLogo(row.brand) : "",
  }));
}
