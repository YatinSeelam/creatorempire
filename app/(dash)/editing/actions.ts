"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { tierForKind } from "@/lib/credits";
import { safeUrl, type LinkItem, type PayKind } from "@/lib/editing";
import { parseCount } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export type EditingState = { error?: string; ok?: string };

/**
 * Every write runs as the signed-in creator against RLS, so the only thing an
 * action has to prove is that somebody is signed in. The `user_id` written into
 * each row comes from the session, never from the form. The db trigger keeps
 * anyone who is not the owner away from the brief and the money, so these
 * writes just work under the user's own client.
 */
async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

const text = (value: FormDataEntryValue | null, max: number): string | null => {
  const out = String(value ?? "").trim();
  return out ? out.slice(0, max) : null;
};

const date = (value: FormDataEntryValue | null): string | null => {
  const out = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
};

const oneOf = <T extends string>(
  value: FormDataEntryValue | null,
  allowed: readonly T[],
  fallback: T
): T => {
  const out = String(value ?? "");
  return (allowed as readonly string[]).includes(out) ? (out as T) : fallback;
};

/**
 * The link rows post as repeated `<prefix>_url` / `<prefix>_label` pairs, in
 * order. Blank urls are rows the creator added and never filled in, so they
 * are dropped rather than rejected.
 */
function readLinks(formData: FormData, prefix: string): LinkItem[] {
  const urls = formData.getAll(`${prefix}_url`).map((v) => String(v).trim());
  const labels = formData.getAll(`${prefix}_label`).map((v) => String(v).trim());

  const out: LinkItem[] = [];
  urls.forEach((url, i) => {
    if (!url) return;
    // http(s) only. a javascript: link pasted here would render as an href on
    // the editor's side of the job, which is somebody else's browser.
    const safe = safeUrl(url);
    if (!safe) return;
    out.push({ url: safe, label: (labels[i] ?? "").slice(0, 120) });
  });
  return out.slice(0, 20);
}

/**
 * The fields create and edit share, parsed once so the two paths can never
 * disagree about what a valid job is.
 *
 * There is no money on a job at all here. Nobody is hired through this app:
 * the creator hands the batch to an editor they already pay, so `credits` and
 * `pay_cents` are written as 0 and nothing reads them. The columns stay so a
 * screen copied from ugc flows still lands.
 *
 * `tier` and `is_rush` survive because they are not prices, they are what the
 * job IS: a reaction cut or a full edit, wanted normally or wanted fast. The
 * editor reads both off the handoff link.
 */
function readJobForm(
  formData: FormData
):
  | { error: string }
  | {
      row: {
        brief: string | null;
        style: null;
        format: null;
        footage_links: LinkItem[];
        reference_links: LinkItem[];
        pay_kind: PayKind;
        pay_cents: number;
        video_count: number;
        tier: 1 | 2;
        credits: number;
        is_rush: boolean;
        due_at: string | null;
      };
    } {
  // no title field any more. a job is named after the brand it is for and
  // numbered per creator, resolved in createEditJob where the deal is known.
  const videoCount = parseCount(formData.get("video_count")) ?? 1;

  const footage = readLinks(formData, "footage");
  const rush = formData.get("rush") === "on" || formData.get("rush") === "1";

  // one question decides the rate now. anything that is not explicitly a
  // reaction is the full rate, so a missing or tampered field costs the
  // creator more rather than less.
  const tier = tierForKind(String(formData.get("video_kind") ?? ""));

  return {
    row: {
      brief: text(formData.get("brief"), 5000),
      // style and format are gone from the form. the brief says how to cut
      // it, and two half-filled boxes above the brief were three places to
      // write the same instruction. kept null rather than dropped so old rows
      // still read.
      style: null,
      format: null,
      footage_links: footage,
      reference_links: readLinks(formData, "reference"),
      // no money on a job here. see the note above the function.
      pay_kind: "per_video",
      pay_cents: 0,
      video_count: videoCount,
      tier,
      credits: 0,
      is_rush: rush,
      // no due date picker any more: the turnaround IS the deadline. the
      // clock starts when an editor claims it (24h, 6h on a rush) and lives
      // on `sla_at`, so a second date the creator typed could only disagree
      // with the one the market actually enforces.
      due_at: null,
    },
  };
}

/**
 * The optional deal the job is pinned to. Checked through the user's own
 * client, so RLS is what proves the deal is theirs; the fk alone would let a
 * pasted id point at somebody else's deal.
 */
type BrandStamp = {
  brand_name: string | null;
  brand_logo_key: string | null;
  brand_logo_url: string | null;
};

/**
 * What this batch is called. A job is not a thing a creator should have to
 * name: it is "the next batch for Candle", and typing that out every time is
 * a box that only ever gets the brand's name in it anyway.
 *
 * So the brand names it and a counter separates batches. First is "Candle",
 * the next is "Candle 2".
 *
 * Numbered off the HIGHEST suffix already used rather than off a count, so
 * deleting the second of three batches does not hand the next one a name that
 * is already on screen. Titles are not unique in the database and nothing
 * breaks if two collide, this is only about a list a person has to read.
 *
 * Two posts landing in the same instant can still pick the same number. Left
 * alone deliberately: the fix is a lock held across a user's whole job table,
 * which is a lot of machinery to make a label prettier.
 */
async function nextBatchTitle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  base: string
): Promise<string> {
  const clean = base.trim().slice(0, 120) || "edit batch";

  // titles only, filtered here rather than with `ilike`: a brand called
  // "50% off" would otherwise be a wildcard pattern against its own list.
  const { data } = await supabase
    .from("edit_jobs")
    .select("title")
    .eq("user_id", userId);

  const lower = clean.toLowerCase();
  let highest = 0;
  for (const row of data ?? []) {
    const title = String((row as { title: string }).title ?? "").trim();
    const t = title.toLowerCase();
    if (t === lower) {
      highest = Math.max(highest, 1);
      continue;
    }
    if (t.startsWith(`${lower} `)) {
      const tail = title.slice(clean.length).trim();
      if (/^\d+$/.test(tail)) highest = Math.max(highest, parseInt(tail, 10));
    }
  }

  return highest === 0 ? clean : `${clean} ${highest + 1}`;
}

async function checkDealId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
): Promise<
  { error: string } | { dealId: string | null; dealName: string; brand: BrandStamp }
> {
  const empty: BrandStamp = {
    brand_name: null,
    brand_logo_key: null,
    brand_logo_url: null,
  };

  const dealId = text(formData.get("deal_id"), 40);
  if (!dealId) return { dealId: null, dealName: "", brand: empty };

  // the brand rides back with the check so it can be stamped onto the job.
  // editors cannot read `deals` or `brands` at all, so a join at render time
  // would come back empty on their side of the market.
  const { data } = await supabase
    .from("deals")
    .select("id, name, brand:brands(name, logo_key, logo_url)")
    .eq("id", dealId)
    .maybeSingle();
  if (!data) return { error: "Pick one of your own deals." };

  const brand = (data as unknown as {
    brand: { name: string; logo_key: string | null; logo_url: string | null } | null;
  }).brand;

  // the deal's own name is the fallback label for a deal whose brand row was
  // never filled in, so a job is never called "edit batch" when the creator
  // clearly told us what it was for.
  const dealName = String((data as unknown as { name: string | null }).name ?? "");

  return {
    dealId,
    dealName,
    brand: brand
      ? {
          brand_name: brand.name,
          brand_logo_key: brand.logo_key,
          brand_logo_url: brand.logo_url,
        }
      : empty,
  };
}

/**
 * Files the new job form uploaded before the job had an id.
 *
 * They already sit in the bucket under `user/<uid>/`, which is a folder the
 * storage policies let this person write to without a job existing. Posting the
 * job is what ties them to it, and the row is the tie: nothing is moved, so a
 * 400mb upload is not copied a second time at the exact moment somebody is
 * watching a spinner.
 *
 * Best effort by design. The job is posted and paid for by the time this runs,
 * and a file that failed to attach is one the creator can drop on the job page
 * a second later. Failing the post over it would be worse.
 */
async function attachStagedFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  userId: string,
  formData: FormData
): Promise<void> {
  const raw = String(formData.get("staged_files") ?? "").trim();
  if (!raw || raw === "[]") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(parsed)) return;

  const rows = parsed
    .slice(0, 200)
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const path = String(row.path ?? "").slice(0, 300);
      if (!path.startsWith(`user/${userId}/`)) return null;
      const size = Number(row.size);
      return {
        job_id: jobId,
        uploader_id: userId,
        kind: fileKind(row.kind),
        path,
        name: String(row.name ?? "").slice(0, 200) || "file",
        mime: String(row.mime ?? "").slice(0, 100) || null,
        size_bytes: Number.isFinite(size) ? Math.max(0, Math.round(size)) : null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return;

  const { error } = await supabase.from("edit_job_files").insert(rows);
  if (error) console.error("[editing.stage_attach_failed]", error.message);
}

// ---------------------------------------------------------------------- jobs

export async function createEditJob(
  _prev: EditingState,
  formData: FormData
): Promise<EditingState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const parsed = readJobForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const deal = await checkDealId(supabase, formData);
  if ("error" in deal) return { error: deal.error };

  // the brand names the batch, the deal's own name is the fallback, and a job
  // tied to neither still needs something to read.
  const title = await nextBatchTitle(
    supabase,
    user.id,
    deal.brand.brand_name || deal.dealName || "edit batch"
  );

  const { data, error } = await supabase
    .from("edit_jobs")
    .insert({
      user_id: user.id,
      deal_id: deal.dealId,
      status: "open",
      title,
      ...deal.brand,
      ...parsed.row,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  // the files the form uploaded before this job had an id.
  await attachStagedFiles(supabase, data.id, user.id, formData);

  // the handoff link is minted here rather than waiting for a button, because
  // a job without one is a job nobody can start: the link IS how the batch
  // reaches the editor. it exists from the first render of the job page and
  // the creator's only decision is when to paste it.
  //
  // best effort on purpose. a job that posted but could not mint a token is
  // still a job, and the box on the page offers to make one.
  const { data: token } = await supabase.rpc("new_link_token");
  if (token) {
    await supabase.from("edit_job_handoff_links").insert({
      job_id: data.id,
      user_id: user.id,
      token: String(token),
    });
  }

  revalidatePath("/editing");
  redirect(`/editing/${data.id}`);
}

/** Edit the offer. Only while open: once claimed, the terms are the terms. */
export async function updateEditJob(
  _prev: EditingState,
  formData: FormData
): Promise<EditingState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const id = text(formData.get("job_id"), 40);
  if (!id) return { error: "Missing job." };

  const parsed = readJobForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const deal = await checkDealId(supabase, formData);
  if ("error" in deal) return { error: deal.error };

  // the price was spent when the job was posted, so an edit never re-prices:
  // the money fields are stripped and only the content of the brief moves.
  const {
    pay_kind: _pk,
    pay_cents: _pc,
    video_count: _vc,
    tier: _tier,
    credits: _credits,
    is_rush: _rush,
    ...content
  } = parsed.row;

  // the status guard rides in the query, so an editor claiming between the
  // page load and this submit turns the edit into a no-op rather than a
  // rewrite of terms somebody already accepted.
  const { data, error } = await supabase
    .from("edit_jobs")
    .update({ deal_id: deal.dealId, ...deal.brand, ...content })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only an open job can be edited." };

  revalidatePath(`/editing/${id}`);
  revalidatePath("/editing");
  return { ok: "Saved." };
}

/** Cancel keeps the row and its history. Only while the job is still open. */
export async function cancelEditJob(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("job_id"), 40);
  if (!id) return;

  const { data } = await supabase
    .from("edit_jobs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "open")
    .select("id");

  // the link dies with the job. a url already pasted into a chat is the only
  // way this batch reaches anybody, so cancelling has to shut it.
  if (data?.length) {
    await supabase
      .from("edit_job_handoff_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("job_id", id)
      .eq("user_id", user.id);
  }

  revalidatePath(`/editing/${id}`);
  revalidatePath("/editing");
}

export async function deleteEditJob(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("job_id"), 40);
  if (!id) return;

  // open only. a job that has been handed over carries somebody else's work and
  // a cancelled one is the record of it; neither should vanish from a delete
  // button. the row goes through cancelled on its way out so nothing observes
  // a job blinking straight from open to gone.
  const { data } = await supabase
    .from("edit_jobs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "open")
    .select("id");
  if (!data?.length) return;

  // the link row goes with it on the fk cascade, so the url stops resolving.
  await supabase.from("edit_jobs").delete().eq("id", id).eq("status", "cancelled");

  revalidatePath("/editing");
  redirect("/editing");
}

/**
 * Mark the batch done.
 *
 * Nobody is paid from here. There is no editor account on this deploy and no
 * payout row to freeze: what the creator owes their editor is settled between
 * them, wherever they already settle it. Approving is the status flip, the
 * optional rating, and the line in the trail.
 */
export async function approveEditJob(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const id = text(formData.get("job_id"), 40);
  if (!id) return;

  const { data: job } = await supabase
    .from("edit_jobs")
    .select("id, title, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!job) return;
  if (job.status !== "delivered" && job.status !== "revisions") return;

  // an optional 1-5 on the way past, frozen on the job row with the approval.
  const ratingRaw = Number(String(formData.get("rating") ?? ""));
  const rating =
    Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;

  // filtered on the status it was read at, so a second tap updates nothing and
  // cannot write the trail twice.
  const { data: updated } = await supabase
    .from("edit_jobs")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      ...(rating ? { rating, rating_note: text(formData.get("rating_note"), 300) } : {}),
    })
    .eq("id", id)
    .eq("status", job.status)
    .select("id");
  if (!updated?.length) return;

  await supabase.from("edit_job_events").insert({
    job_id: id,
    author_id: user.id,
    kind: "status",
    body: "approved",
  });

  revalidatePath(`/editing/${id}`);
  revalidatePath("/editing");
}

// --------------------------------------------------------------------- files

/**
 * The browser already put the object in the bucket (storage RLS proved the
 * job is this creator's); this records it so the pages can list it. The path
 * is re-checked against the job id so a row can never point at another job's
 * folder, whatever the client sent.
 */
export async function recordJobFile(input: {
  jobId: string;
  kind: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const jobId = String(input.jobId ?? "").slice(0, 40);
  const kind = fileKind(input.kind);
  const path = String(input.path ?? "").slice(0, 300);
  // two shapes are legitimate: the job's own folder, and the uploader's own
  // `user/` prefix, which is where anything uploaded before the job existed
  // lives. The same pair is enforced again by the insert policy.
  if (!jobId || !ownedPath(path, jobId, user.id)) {
    return { error: "That upload does not belong to this job." };
  }

  const { error } = await supabase.from("edit_job_files").insert({
    job_id: jobId,
    uploader_id: user.id,
    kind,
    path,
    name: String(input.name ?? "").slice(0, 200) || "file",
    mime: String(input.mime ?? "").slice(0, 100) || null,
    size_bytes: Number.isFinite(input.size) ? Math.max(0, Math.round(input.size)) : null,
  });
  if (error) return { error: error.message };

  revalidatePath(`/editing/${jobId}`);
  return {};
}

/** the four things a creator can attach to a job. anything unrecognised is
 *  footage, which is the only kind that was ever the default. */
function fileKind(raw: unknown): "footage" | "asset" | "reference" | "doc" {
  const value = String(raw ?? "");
  return value === "reference" || value === "asset" || value === "doc" ? value : "footage";
}

/**
 * A path this person is allowed to record against this job.
 *
 * `<job>/assets/...` is an upload made from the job page, `user/<uid>/...` is
 * one made before the job had an id. Nothing else, whatever the client sent:
 * the storage select policy treats a file row as a read grant, so a row that
 * could name any path at all would be a way to read somebody else's bucket.
 */
function ownedPath(path: string, jobId: string, userId: string): boolean {
  return path.startsWith(`${jobId}/assets/`) || path.startsWith(`user/${userId}/`);
}

/**
 * The deal's shelf: uploaded once, on every job for that brand from then on.
 *
 * Nothing is copied onto a job. The job carries the deal id and both sides
 * read the shelf live, which is what makes fixing a wrong logo fix every
 * future batch rather than the next one.
 */
export async function recordDealAsset(input: {
  dealId: string;
  kind: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const dealId = String(input.dealId ?? "").slice(0, 40);
  const path = String(input.path ?? "").slice(0, 300);
  const kind = String(input.kind ?? "") === "doc" ? "doc" : "asset";
  if (!dealId || !path.startsWith(`bank/${dealId}/`)) {
    return { error: "That upload does not belong to this deal." };
  }

  const { error } = await supabase.from("deal_assets").insert({
    user_id: user.id,
    deal_id: dealId,
    kind,
    path,
    name: String(input.name ?? "").slice(0, 200) || "file",
    mime: String(input.mime ?? "").slice(0, 100) || null,
    size_bytes: Number.isFinite(input.size) ? Math.max(0, Math.round(input.size)) : null,
  });
  if (error) return { error: error.message };

  revalidatePath("/editing/new");
  revalidatePath(`/deals/${dealId}/edit`);
  return {};
}

/** Off the shelf and out of the bucket. Object first, row second, same as a
 *  job file: an orphan object is invisible, an orphan row is a dead link. */
export async function deleteDealAsset(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const assetId = text(formData.get("asset_id"), 40);
  if (!assetId) return;

  const { data: asset } = await supabase
    .from("deal_assets")
    .select("id, path, deal_id")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return;

  await supabase.storage.from("editing-assets").remove([asset.path]);
  await supabase.from("deal_assets").delete().eq("id", assetId);

  revalidatePath(`/deals/${asset.deal_id}/edit`);
  revalidatePath("/editing/new");
}

/**
 * Object first, row second: a row without an object is a dead link, an object
 * without a row is merely invisible. RLS scopes both, so the uploader or the
 * job owner is the only one this works for.
 */
export async function deleteJobFile(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const fileId = text(formData.get("file_id"), 40);
  const jobId = text(formData.get("job_id"), 40);
  if (!fileId) return;

  const { data: file } = await supabase
    .from("edit_job_files")
    .select("id, path")
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return;

  await supabase.storage.from("editing-assets").remove([file.path]);
  await supabase.from("edit_job_files").delete().eq("id", fileId);

  if (jobId) revalidatePath(`/editing/${jobId}`);
}

// ---------------------------------------------------------- handoff links

/**
 * Make the job's editor handoff link, or rotate it.
 *
 * The mirror of `createReviewLink`, pointed at the other person: that url goes
 * to whoever signs a cut off, this one goes to whoever makes it. Same rules —
 * one link per job, rotating replaces the token in place, and that is the whole
 * revoke story for a url already sitting in somebody's dms.
 *
 * The token comes from `new_review_token()` rather than a second generator: how
 * a capability is minted should not depend on which feature asked for it.
 */
export async function createHandoffLink(
  _prev: EditingState,
  formData: FormData
): Promise<EditingState> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const jobId = text(formData.get("job_id"), 40);
  if (!jobId) return { error: "Missing job." };
  const label = text(formData.get("label"), 80);
  const rotate = String(formData.get("rotate") ?? "") === "1";

  // proves the job is this creator's before anything is written. rls would
  // catch the insert anyway, but a clean message beats a policy error.
  const { data: job } = await supabase
    .from("edit_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!job) return { error: "That job is not yours." };

  const { data: token, error: tokenError } = await supabase.rpc("new_review_token");
  if (tokenError || !token) return { error: "Could not mint a link. Try again." };

  const { data: existing } = await supabase
    .from("edit_job_handoff_links")
    .select("id, label")
    .eq("job_id", jobId)
    .maybeSingle();

  if (existing && !rotate) {
    // already there: this call is only editing the label
    const { error } = await supabase
      .from("edit_job_handoff_links")
      .update({ label, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { error: error.message };
    revalidatePath(`/editing/${jobId}`);
    return { ok: "Saved." };
  }

  const { error } = await supabase.from("edit_job_handoff_links").upsert(
    {
      job_id: jobId,
      user_id: user.id,
      token: String(token),
      // rotating is not a rename: without this the "raj, my editor" note is
      // wiped by a fresh url.
      label: label ?? ((existing?.label as string | null) ?? null),
      revoked_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "job_id" }
  );
  if (error) return { error: error.message };

  revalidatePath(`/editing/${jobId}`);
  return {
    ok: rotate ? "New link made. The old one is dead." : "Link ready. Send it over.",
  };
}

/** Turn the handoff link off or back on without changing the token. */
export async function toggleHandoffLink(formData: FormData): Promise<void> {
  const { supabase, user } = await authed();
  if (!user) return;

  const jobId = text(formData.get("job_id"), 40);
  if (!jobId) return;
  const off = String(formData.get("off") ?? "") === "1";

  await supabase
    .from("edit_job_handoff_links")
    .update({
      revoked_at: off ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", jobId)
    .eq("user_id", user.id);

  revalidatePath(`/editing/${jobId}`);
}

// -------------------------------------------------------- manual delivery

/**
 * File the cut the editor sent back.
 *
 * The handoff room is read only, so nothing an anonymous url holder does can
 * write a row here. The cut arrives over whatever channel the editor already
 * uses and the CREATOR files it, which is what "delivery is manual" means.
 *
 * Everything after the upload is exactly what the editor's own `recordCutFile`
 * does: a file row, a deliverable, the flip to delivered, a status event. The
 * deliverable's `editor_id` is the creator, because that column means "who
 * filed this" and nothing reads it as an entitlement — the payout is keyed off
 * `edit_jobs.editor_id`, which stays null on a handoff job.
 */
export async function recordDeliveredCut(input: {
  jobId: string;
  path: string;
  name: string;
  mime: string;
  size: number;
}): Promise<{ error?: string }> {
  const { supabase, user } = await authed();
  if (!user) return { error: "Your session expired. Sign in again." };

  const jobId = String(input.jobId ?? "").slice(0, 40);
  const path = String(input.path ?? "").slice(0, 300);
  if (!jobId || !ownedPath(path, jobId, user.id)) {
    return { error: "That upload does not belong to this job." };
  }

  const { data: job } = await supabase
    .from("edit_jobs")
    .select("id, status")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!job) return { error: "That job is not yours." };
  if (job.status === "cancelled") return { error: "That job was cancelled." };

  const name = String(input.name ?? "").slice(0, 200) || "cut";

  const { error: fileError } = await supabase.from("edit_job_files").insert({
    job_id: jobId,
    uploader_id: user.id,
    kind: "cut",
    path,
    name,
    mime: String(input.mime ?? "").slice(0, 100) || null,
    size_bytes: Number.isFinite(input.size) ? Math.max(0, Math.round(input.size)) : null,
  });
  if (fileError) return { error: fileError.message };

  const { count } = await supabase
    .from("edit_job_deliverables")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  const version = (count ?? 0) + 1;

  const { error } = await supabase.from("edit_job_deliverables").insert({
    job_id: jobId,
    editor_id: user.id,
    // the sentinel, not a url: resolved to a signed url wherever it renders.
    url: `storage://editing-assets/${path}`,
    note: name,
    version,
  });
  if (error) {
    // the delivery never landed, so the file row goes too and nothing
    // half-exists for the page to draw.
    await supabase.from("edit_job_files").delete().eq("path", path);
    return { error: error.message };
  }

  const { error: statusError } = await supabase
    .from("edit_jobs")
    .update({ status: "delivered", delivered_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", user.id);
  if (statusError) return { error: statusError.message };

  await supabase.from("edit_job_events").insert({
    job_id: jobId,
    author_id: user.id,
    kind: "status",
    body: `filed cut v${version}`,
  });

  revalidatePath(`/editing/${jobId}`);
  revalidatePath("/editing");
  return {};
}
