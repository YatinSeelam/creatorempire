/**
 * Which frame of the clip a post opens on.
 *
 * Ported from ugc flows, where it was asked for in the discord as "is there a
 * way to edit the thumbnail for the autoposter?". Before this a whole batch had
 * one number, on tiktok only (`options.tiktok.coverSecond`, 1s by default), and
 * nothing at all on instagram.
 *
 * WHAT UPLOAD-POST CARRIES, off its own `/api/upload` reference:
 *
 * | platform  | frame offset            |
 * |-----------|-------------------------|
 * | instagram | `thumb_offset` (ms)     |
 * | tiktok    | `cover_timestamp` (ms)  |
 * | youtube   | none (an image only)    |
 * | facebook  | none on a reel          |
 *
 * So a frame reaches instagram and tiktok and nowhere else, and the picker is
 * only drawn when one of those two is on the batch.
 *
 * A COVER IS PER CLIP, the same grain a caption is: it describes the video.
 *
 * NULL MEANS WHAT HAPPENED BEFORE ANY OF THIS: tiktok keeps reading the
 * batch's `coverSecond` and instagram is sent nothing, byte for byte.
 *
 * IT IS STORED INSIDE `social_posts.options` (as `coverMs`) rather than in a
 * column of its own, so this ships with no migration and a restore resends the
 * frame somebody picked. `withDefaults` drops the key on read, which is why
 * `storedCoverMs` reads it off the raw jsonb.
 */

import type { PostOptions } from "@/lib/autopost/plan";
import type { Platform } from "@/lib/deals";

/** an hour. a number past this is not a cover anybody meant, so it reads as
 *  "no choice" rather than being clamped into a frame the platform refuses. */
export const COVER_MAX_MS = 3_600_000;

/** A cover read back. `Number(null)` and `Number("")` are both 0, so a value
 *  has to EXIST before it is read: an absent cover read as 0 would pin every
 *  post to its first frame. */
export function readCoverMs(raw: unknown): number | null {
  if (typeof raw === "number") return clampCover(raw);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return null;
    return clampCover(Number(text));
  }
  return null;
}

function clampCover(value: number): number | null {
  if (!Number.isFinite(value) || value < 0 || value > COVER_MAX_MS) return null;
  return Math.round(value);
}

/** the cover a stored post carries inside its options jsonb, or null. */
export function storedCoverMs(options: unknown): number | null {
  if (!options || typeof options !== "object") return null;
  return readCoverMs((options as { coverMs?: unknown }).coverMs);
}

/**
 * What each of the two platforms is sent.
 *
 * - instagram: `thumb_offset` only when a cover was picked AND it is a reel. a
 *   story has no cover.
 * - tiktok: always `cover_timestamp` when it is on the post, as before: the
 *   picked cover, else the batch's `coverSecond`.
 */
export function coverOffsets(input: {
  coverMs: number | null | undefined;
  platforms: readonly string[];
  options: PostOptions | null | undefined;
}): { instagram: number | null; tiktok: number | null } {
  const picked = readCoverMs(input.coverMs);
  const on = (p: Platform) => input.platforms.includes(p);
  const story = input.options?.instagram?.mediaType === "Story";

  const instagram = on("instagram") && !story ? picked : null;

  let tiktok: number | null = null;
  if (on("tiktok")) {
    if (picked !== null) tiktok = picked;
    else if (input.options) {
      tiktok = Math.max(0, Math.round((input.options.tiktok.coverSecond || 0) * 1000));
    }
  }
  return { instagram, tiktok };
}

/** whether a picked frame can reach anything on this post at all. */
export function coverReaches(
  platforms: readonly string[],
  options: PostOptions | null | undefined
): boolean {
  if (platforms.includes("tiktok")) return true;
  return platforms.includes("instagram") && options?.instagram?.mediaType !== "Story";
}

/** `2400` -> `2.4s`. */
export function coverLabel(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
