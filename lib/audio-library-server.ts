/**
 * The reads for the shared sound bank.
 *
 * Both of them are rls scoped through the caller's own client: the table's one
 * policy is "signed in sees the whole bank", so the scoping here is only
 * "signed in", which is exactly what the two surfaces want.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AudioAsset, AudioKind, AudioKit } from "@/lib/audio-library";

const COLUMNS =
  "id, kind, category, title, slug, storage_path, duration_ms, bytes, tags, peaks";

function toAsset(row: Record<string, unknown>): AudioAsset {
  return {
    id: String(row.id),
    kind: (row.kind === "sfx" ? "sfx" : "music") as AudioKind,
    category: String(row.category ?? "misc"),
    title: String(row.title ?? "untitled"),
    slug: String(row.slug ?? ""),
    storage_path: String(row.storage_path ?? ""),
    duration_ms: Number(row.duration_ms ?? 0),
    bytes: Number(row.bytes ?? 0),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    peaks: Array.isArray(row.peaks) ? row.peaks.map(Number) : [],
  };
}

/**
 * Every active track, ordered the way the ingest saw them.
 *
 * The whole bank in one read rather than a page per category: it is ~140 rows
 * of small columns, and holding all of it lets the browser filter and search
 * without a round trip per chip, which is the difference between a picker that
 * feels like a folder and one that feels like a form.
 */
export async function loadAudioLibrary(supabase: SupabaseClient): Promise<AudioAsset[]> {
  const { data, error } = await supabase
    .from("audio_assets")
    .select(COLUMNS)
    .eq("active", true)
    .order("kind", { ascending: true })
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data.map((row) => toAsset(row as Record<string, unknown>));
}

/**
 * The download packs, in the order the ingest cut them.
 *
 * The rows ARE the catalogue: the ingest writes one per zip it actually made
 * and prunes the ones it did not, so the page can never offer a link to an
 * object that is not there. Sizes come from the same place for the same reason,
 * the number under a download button being the size of the thing downloaded.
 */
export async function loadAudioKits(supabase: SupabaseClient): Promise<AudioKit[]> {
  const { data, error } = await supabase
    .from("audio_kits")
    .select("file, kind, category, label, tracks, bytes")
    .order("sort_order", { ascending: true });

  if (error || !data) return [];
  return data.map((row) => ({
    file: String(row.file),
    kind: (row.kind === "sfx" ? "sfx" : "music") as AudioKind,
    category: row.category == null ? null : String(row.category),
    label: String(row.label ?? ""),
    tracks: Number(row.tracks ?? 0),
    bytes: Number(row.bytes ?? 0),
  }));
}
