/**
 * The shared sound bank: shapes and wording only.
 *
 * Pure, so the same file serves the server pages, the client browser component
 * and the variations action that copies a track into somebody's own bank.
 *
 * Two kinds, browsed separately because they are picked at different moments.
 * Music is a bed that runs under the whole cut and is chosen by mood. Sfx is a
 * one shot that lands on a beat and is chosen by job.
 */

export const AUDIO_BUCKET = "audio-library";

export type AudioKind = "music" | "sfx";

export type AudioAsset = {
  id: string;
  kind: AudioKind;
  category: string;
  title: string;
  slug: string;
  storage_path: string;
  duration_ms: number;
  bytes: number;
  tags: string[];
  /** 64 rms buckets 0..100, computed at ingest. see the migration header. */
  peaks: number[];
};

/**
 * One pack of zipped mp3s sitting in the bucket, ready to download.
 *
 * A mood is not always one file: storage refuses an upload over 50mb here, and
 * the bigger moods are several hundred, so the ingest splits them into numbered
 * parts that each open on their own. `label` already says "2 of 3" when that
 * happened, so nothing downstream has to know it did.
 */
export type AudioKit = {
  /** the object name under `kits/`. */
  file: string;
  kind: AudioKind;
  category: string | null;
  label: string;
  bytes: number;
  tracks: number;
};

/**
 * The mood folders, in the order they are offered.
 *
 * Not alphabetical: the first three are what most ugc actually needs, and a
 * list that opens on "casual, cinematic, funny" buries them. A category the
 * ingest finds that is not named here still shows, under its own raw name.
 */
export const MUSIC_MOODS: { key: string; label: string; line: string }[] = [
  { key: "upbeat", label: "upbeat", line: "bright and fast. good under a quick cut" },
  { key: "casual", label: "casual", line: "easy background that stays out of the way" },
  { key: "quirky", label: "quirky", line: "playful and a little odd. good on demos" },
  { key: "cinematic", label: "cinematic", line: "big and filmic. reveals and before afters" },
  { key: "sentimental", label: "sentimental", line: "warm. story hooks and testimonials" },
  { key: "suspenseful", label: "suspenseful", line: "tense build. holds them to the reveal" },
  { key: "relaxing", label: "relaxing", line: "slow and calm. skincare, routines, asmr" },
  { key: "funny", label: "funny", line: "comedy beds" },
];

export const SFX_GROUPS: { key: string; label: string; line: string }[] = [
  { key: "transition", label: "transitions", line: "whooshes and glitches between shots" },
  { key: "impact", label: "impacts", line: "hits and booms that land a beat" },
  { key: "riser", label: "risers", line: "builds into a reveal" },
  { key: "ui", label: "ui and money", line: "clicks, pops, dings, cash" },
  { key: "meme", label: "memes", line: "the ones people already know" },
  { key: "misc", label: "misc", line: "everything else" },
];

export function categoriesFor(kind: AudioKind) {
  return kind === "music" ? MUSIC_MOODS : SFX_GROUPS;
}

/** the label for a category, falling back to the raw folder name so a mood
 *  added on disk shows up without a code change. */
export function categoryLabel(kind: AudioKind, key: string): string {
  return categoriesFor(kind).find((c) => c.key === key)?.label ?? key;
}

/** the one line under a pack's name. the mood's own description, or a stock
 *  line for the sfx pack, which has no mood. */
export function kitLine(kit: AudioKit): string {
  if (kit.kind === "sfx") return "every sound effect in one folder";
  return categoriesFor("music").find((c) => c.key === kit.category)?.line ?? "";
}

/**
 * The bucket is public, so a path is a url with no round trip. Same call the
 * variations tool makes for the same reason: signing 140 of these on every
 * render of the library, and re-signing one mid scrub when the hour ran out,
 * buys nothing for files whose names are already in a public catalogue.
 */
export function audioUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${AUDIO_BUCKET}/${path}`;
}

/** "1:04". a zero length reads empty rather than "0:00", which would claim a
 *  duration nothing measured. */
export function trackClock(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "38 mb". packs are the only thing here big enough for the number to matter,
 *  so it stays coarse on purpose. */
export function sizeLabel(bytes: number | null | undefined): string {
  const n = typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0;
  if (n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} kb`;
  return `${Math.round(n / (1024 * 1024))} mb`;
}

/** what the search box matches. title, category and hand tags, nothing else:
 *  matching the slug too would make "the-weeknd" hit on "week". */
export function matchesQuery(asset: AudioAsset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${asset.title} ${asset.category} ${asset.tags.join(" ")}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
