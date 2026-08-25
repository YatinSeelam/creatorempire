/**
 * Real files on edit jobs. The bucket is private, so a stored path is worth
 * nothing on its own: every render mints a signed url as the signed-in user,
 * and the storage select policy decides who that works for. Only the type
 * import touches supabase-js, so the browser can safely take the constants.
 *
 * A cut uploaded as a file still becomes a deliverable row, but its `url` is
 * the `storage://editing-assets/<path>` sentinel rather than an http link.
 * That sentinel is deliberately not a url: it must never go through safeUrl
 * (which is for external links) and never reach an href raw. The two resolve
 * helpers here are the only way it turns into something clickable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobDeliverable } from "@/lib/editing";

export const BUCKET = "editing-assets";

/**
 * `footage` is the videos to edit, `asset` is what goes on top (clips, audio,
 * images). Same storage folder, different lists on screen, because an editor
 * opening one pile of nineteen files has to sort it themselves.
 */
export type JobFileKind = "footage" | "asset" | "reference" | "doc" | "cut";

/**
 * The deal's shelf. Everything a brand needs on every batch, uploaded once:
 * `asset` is material that goes on top of a cut (logos, product shots, music,
 * sfx), `doc` is words the editor reads before cutting (the SOP, the standing
 * brief, the brand guidelines).
 *
 * Nothing is copied onto a job. A job carries a deal id, the shelf hangs off
 * the deal, and both sides read it live. That is the whole "do not upload it
 * again" story, and it is also why editing one file fixes every future job
 * rather than the next one only.
 */
export type DealAssetKind = "asset" | "doc";

export type DealAsset = {
  id: string;
  deal_id: string;
  user_id: string;
  kind: DealAssetKind;
  path: string;
  name: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
  signedUrl: string | null;
};

export type JobFile = {
  id: string;
  job_id: string;
  uploader_id: string;
  kind: JobFileKind;
  /** the storage object path inside the bucket, `<job>/assets|cuts/<file>` */
  path: string;
  /** the original filename, for display */
  name: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
  /** minted per render, 1 hour. null when signing failed. */
  signedUrl: string | null;
};

/** "3.2 MB", "912 KB". For file rows; nobody needs the exact byte count. */
export function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function isImageFile(file: { mime: string | null }): boolean {
  return (file.mime ?? "").startsWith("image/");
}

/**
 * What a file is, from its type, for the word on its chip and for deciding
 * which shelf it lands on. Browsers hand back an empty type for plenty of real
 * files (.mov off some cameras, .aep, anything unusual), so the extension is
 * the fallback rather than a guess of "video".
 */
export function fileFamily(input: { mime?: string | null; name?: string | null }):
  | "video"
  | "audio"
  | "image"
  | "doc"
  | "file" {
  const mime = (input.mime ?? "").toLowerCase();
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    mime.includes("word") ||
    mime.includes("document")
  ) {
    return "doc";
  }

  const ext = (input.name ?? "").toLowerCase().split(".").pop() ?? "";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "aiff", "aif", "flac", "ogg"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "svg", "avif"].includes(ext)) return "image";
  if (["pdf", "doc", "docx", "txt", "md", "rtf", "odt", "pages"].includes(ext)) return "doc";
  return "file";
}

/** `Final CUT v2!.MOV` → `mov`. Alphanumeric only, so the path stays clean. */
export function fileExt(name: string): string {
  const raw = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return ext || "bin";
}

/**
 * One deal's shelf, docs and assets together, each with a fresh signed url.
 * Empty rather than thrown when the shelf cannot be read: an editor who is not
 * on a job for that deal simply sees nothing, which is the policy doing its
 * job, not an error worth breaking a page over.
 */
export async function loadDealAssets(
  supabase: SupabaseClient,
  dealId: string | null
): Promise<DealAsset[]> {
  if (!dealId) return [];

  const { data, error } = await supabase
    .from("deal_assets")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) return [];

  const rows = (data ?? []) as Omit<DealAsset, "signedUrl">[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      rows.map((r) => r.path),
      3600
    );

  const urlBy = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlBy.set(s.path, s.signedUrl);
  }

  return rows.map((row) => ({
    ...row,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    signedUrl: urlBy.get(row.path) ?? null,
  }));
}

/**
 * Every file on a job, newest first, each carrying a fresh signed url. One
 * `createSignedUrls` call for the lot, not one per file.
 */
export async function loadJobFiles(
  supabase: SupabaseClient,
  jobId: string
): Promise<JobFile[]> {
  const { data, error } = await supabase
    .from("edit_job_files")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Omit<JobFile, "signedUrl">[];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      rows.map((r) => r.path),
      3600
    );

  const urlBy = new Map<string, string>();
  for (const s of signed ?? []) {
    if (s.path && s.signedUrl) urlBy.set(s.path, s.signedUrl);
  }

  return rows.map((row) => ({
    ...row,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    signedUrl: urlBy.get(row.path) ?? null,
  }));
}

// ------------------------------------------------------------- the sentinel

export const STORAGE_URL_PREFIX = "storage://editing-assets/";

/** True when a deliverable's `url` is an uploaded file, not an external link. */
export function isStorageUrl(url: string): boolean {
  return url.startsWith(STORAGE_URL_PREFIX);
}

/**
 * A sentinel url into a signed one; an external link passes through as is.
 * Null means the object is gone or the caller has no read on it, and the
 * render should say so rather than link nowhere.
 */
export async function resolveStorageUrl(
  supabase: SupabaseClient,
  url: string
): Promise<string | null> {
  if (!isStorageUrl(url)) return url;
  const path = url.slice(STORAGE_URL_PREFIX.length);
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Extensions a browser will actually play inline.
 *
 * Matched against the STORED path, never the signed url: a signed url carries
 * a `?token=` query string, and the extension is no longer the tail of the
 * string by the time it gets here.
 */
export const PLAYABLE = /\.(mp4|m4v|mov|webm|ogv)(\?|$)/i;

export type ResolvedDeliverable = JobDeliverable & {
  /** what the href should be: signed url, external link, or null when gone. */
  resolvedUrl: string | null;
  /** true when the cut is an uploaded file rather than a pasted link. */
  uploaded: boolean;
  /** true when it can go straight into a <video>, false when it can only link out. */
  playable: boolean;
  /**
   * The object path inside the bucket, null for a pasted link.
   *
   * This is the join back to `edit_job_files`: the two rows are written in the
   * same action off the same `path`, so it matches exactly. The file row is
   * where the HUMAN name and the size live — a cut's own stored filename is a
   * uuid, and its `note` is the uploader's filename copied at delivery.
   */
  storagePath: string | null;
};

/**
 * Resolve a whole deliverables list at once: external links stay themselves,
 * sentinel urls become signed urls, all minted in one storage call.
 */
export async function resolveDeliverables(
  supabase: SupabaseClient,
  deliverables: JobDeliverable[]
): Promise<ResolvedDeliverable[]> {
  const paths = deliverables
    .filter((d) => isStorageUrl(d.url))
    .map((d) => d.url.slice(STORAGE_URL_PREFIX.length));

  const urlBy = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) urlBy.set(s.path, s.signedUrl);
    }
  }

  return deliverables.map((d) => {
    const uploaded = isStorageUrl(d.url);
    const path = uploaded ? d.url.slice(STORAGE_URL_PREFIX.length) : d.url;
    const resolvedUrl = uploaded ? (urlBy.get(path) ?? null) : d.url;
    return {
      ...d,
      uploaded,
      resolvedUrl,
      playable: Boolean(resolvedUrl) && PLAYABLE.test(path),
      storagePath: uploaded ? path : null,
    };
  });
}
