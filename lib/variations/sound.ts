import "server-only";

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { download, importable, resolveClipMedia } from "@/lib/portfolio-import";
import type { ImportPlatform } from "@/lib/portfolio-embed";
import { mediaSeconds, runFfmpeg } from "./render";

/**
 * A pasted tiktok / reel / short, turned into a sound in the bank.
 *
 * No new scraper. This is the portfolio importer's resolver used for a
 * different half of the same file: that one keeps the picture and throws the
 * audio away, this one does the opposite. Same providers (scrapecreators for
 * tiktok and instagram, apify for youtube and as the fallback for the other
 * two), same credit ledger, same one billed call per link.
 *
 * What comes back is the video's OWN audio track — the whole mix, voice
 * included — not the platform's "original sound" record. That is deliberate:
 * "the audio of that video" is what somebody pasting a link means, it is the
 * only answer all three platforms can give, and a music-only url exists on
 * exactly one of them.
 *
 * The mp4 is never kept. It is downloaded to a temp dir, stripped to aac and
 * deleted, so a bank of sounds costs kilobytes rather than a copy of every
 * video anyone was inspired by.
 *
 * Server only: the resolver reads SCRAPECREATORS_API_KEY and APIFY_TOKEN.
 */

export type ExtractedSound = {
  bytes: Buffer;
  contentType: string;
  /** the file extension, matching contentType. */
  ext: string;
  seconds: number | null;
  title: string;
  platform: ImportPlatform;
  /** the link as pasted, kept on the row as provenance. */
  sourceUrl: string;
};

export type SoundResult =
  | { ok: true; sound: ExtractedSound }
  | { ok: false; error: string };

const PLATFORM_LABEL: Record<ImportPlatform, string> = {
  tiktok: "tiktok",
  instagram: "reel",
  youtube: "short",
};

/**
 * A name somebody can tell apart in a grid of waveforms.
 *
 * The handle is what makes a sound recognisable ("that one off @brand"), and it
 * is already in the url on every platform that puts it there, so this costs no
 * request. A link with no handle in it falls back to the platform, which at
 * least says where it came from.
 */
export function soundTitle(platform: ImportPlatform, url: string): string {
  const handle = url.match(/@([\w.]{2,30})/)?.[1];
  if (handle) return `@${handle} ${PLATFORM_LABEL[platform]} sound`;

  const code =
    url.match(/instagram\.com\/(?:reels?|p|tv)\/([\w-]{5,})/i)?.[1] ??
    url.match(/(?:shorts\/|youtu\.be\/|[?&]v=)([\w-]{6,})/i)?.[1] ??
    url.match(/\/video\/(\d{6,})/)?.[1];

  return code
    ? `${PLATFORM_LABEL[platform]} sound ${code.slice(0, 12)}`
    : `${PLATFORM_LABEL[platform]} sound`;
}

/**
 * Strip a downloaded clip to its audio track.
 *
 * aac in an m4a rather than mp3: it is what the render worker lays back over a
 * cut anyway, so re-encoding to mp3 here would only cost a second generation of
 * loss on the way to the same place.
 */
export async function toAudio(
  video: ArrayBuffer | Buffer
): Promise<{ bytes: Buffer; seconds: number | null } | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sound-"));
  try {
    const src = path.join(dir, "src");
    const out = path.join(dir, "sound.m4a");
    await writeFile(src, Buffer.isBuffer(video) ? video : Buffer.from(video));

    await runFfmpeg([
      "-i", src,
      "-vn",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      out,
    ]);

    const bytes = await readFile(out);
    if (bytes.byteLength === 0) return null;
    return { bytes, seconds: await mediaSeconds(out) };
  } catch {
    // a clip with no audio stream at all fails here, and that is a sentence for
    // the creator rather than a crash in a server action.
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The resolver's sentences, said the way this product says things.
 *
 * They are matched rather than passed through because they were written for the
 * portfolio importer ("cannot be imported"), and somebody here is after a sound,
 * not a clip. The apify one keeps its env var spelled properly: that line is for
 * whoever configures the deploy, not for a creator.
 */
function soundError(raw: string): string {
  const text = raw.trim();
  if (/apify/i.test(text)) return "youtube links need APIFY_TOKEN set on the server.";
  if (/could not be found/i.test(text)) {
    return "that post could not be found. check the link is public.";
  }
  if (/no video/i.test(text)) {
    return "that post has no video on it, so there is no sound to take.";
  }
  return "could not reach that post. try again in a minute.";
}

export async function soundFromLink(
  rawUrl: string,
  who: { userId: string; email: string | null }
): Promise<SoundResult> {
  const source = importable(typeof rawUrl === "string" ? rawUrl : "");
  if (!source) {
    return {
      ok: false,
      error: "paste a tiktok, instagram reel or youtube link.",
    };
  }

  const found = await resolveClipMedia(source, who);
  if (!found.ok) return { ok: false, error: soundError(found.error) };

  const video = await download(found.media.videoUrl, "video");
  if (!video) {
    return { ok: false, error: "that video could not be downloaded. try again." };
  }

  const audio = await toAudio(video.bytes);
  if (!audio) {
    return { ok: false, error: "there is no audio on that post." };
  }

  return {
    ok: true,
    sound: {
      bytes: audio.bytes,
      contentType: "audio/mp4",
      ext: "m4a",
      seconds: audio.seconds,
      title: soundTitle(source.platform, source.url),
      platform: source.platform,
      sourceUrl: source.url,
    },
  };
}
