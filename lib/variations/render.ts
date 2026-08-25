import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import ffmpegPath from "ffmpeg-static";
import {
  MAX_RENDER_ATTEMPTS,
  VARIATIONS_BUCKET,
  audioGainOf,
  audioRoleOf,
  trimOf,
  type AudioRole,
  type Trim,
} from "./model";
import { normalizeTextStyle } from "./style";
import { renderTextHookPng } from "./text-image";

/**
 * The ffmpeg half of the tool: take one render row, stitch its hook and demo,
 * swap the sound if it has one, burn the text on top, and put the mp4 back on
 * the row.
 *
 * Everything is normalised to 1080x1920 at 30fps with a guaranteed audio track
 * (silent when the source has none) before anything is joined. concat refuses
 * to work across mismatched streams, and a clip with no audio at all is the
 * common case for a screen recording, so "always emit a track" is what stops
 * half the library from failing at the join.
 *
 * Runs on the node runtime only. Never import this from anything a browser can
 * reach.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ERROR_CHARS = 400;

/** a render that has sat in `rendering` longer than this was killed with its
 *  function, not still working. */
const STALE_RENDER_MINUTES = 12;

/** the three columns a clip needs to be played the way it was trimmed. */
type Clip = {
  storage_path: string | null;
  trim_start_seconds: number | null;
  trim_end_seconds: number | null;
} | null;

/** a clip plus what it is supposed to DO when it is a sound. */
type Sound = (NonNullable<Clip> & {
  audio_role: string | null;
  audio_gain: number | null;
}) | null;

export type RenderRow = {
  id: string;
  user_id: string;
  /** which batch this render belongs to, so a run that finishes the last one
   *  can tell the batch is done. */
  batch_id: string;
  text_content: string | null;
  text_style: unknown;
  attempts: number;
  hook: Clip;
  demo: Clip;
  audio: Sound;
  /** the batch's one sting. always role 'sting', always laid on last. */
  sfx: Sound;
};

/* ── ffmpeg plumbing ──────────────────────────────────────────────────────── */

function ffmpegBinary(): string {
  if (!ffmpegPath) throw new Error("ffmpeg-static binary not found");
  return ffmpegPath;
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), ["-hide_banner", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // keep the tail only. that is where ffmpeg puts the actual error, and
      // the head is a page of build flags nobody reads.
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-MAX_ERROR_CHARS)}`));
    });
  });
}

/** ffmpeg prints stream info to stderr even when it "fails" for want of an
 *  output file, which is the cheapest way to inspect one without shipping
 *  ffprobe alongside the binary. */
async function probe(file: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBinary(), ["-hide_banner", "-i", file], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(stderr));
  });
}

async function hasAudioStream(file: string): Promise<boolean> {
  return /Stream #\d+:\d+.*Audio/.test(await probe(file));
}

export async function mediaSeconds(file: string): Promise<number | null> {
  const m = (await probe(file)).match(/Duration:\s*(\d+):(\d\d):(\d\d)(?:\.(\d+))?/);
  if (!m) return null;
  const seconds =
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    (m[4] ? Number(`0.${m[4]}`) : 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * scale and pad into the 9:16 frame, 30fps, h264 + aac, always with audio, and
 * only the piece of the clip somebody kept.
 *
 * The trim is applied here rather than anywhere later because this pass already
 * re-encodes: seeking is free on top of it, and cutting before the concat is
 * what makes the join's timeline the trimmed one, which is what the caption
 * window is then measured against.
 *
 * `-ss` goes BEFORE `-i` (input seek, so the decoder skips rather than decodes
 * and discards) and `-t` after it, as an output limit. The other order costs a
 * full decode of everything that was cut.
 */
async function normalizeVideo(
  input: string,
  output: string,
  trim: Trim | null = null
): Promise<void> {
  const withAudio = await hasAudioStream(input);
  const vf = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p`;

  const seek = trim && trim.start > 0 ? ["-ss", trim.start.toFixed(3)] : [];
  const cut = trim && trim.duration ? ["-t", trim.duration.toFixed(3)] : [];

  const args = withAudio
    ? [
        ...seek,
        "-i", input,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        ...cut,
        "-movflags", "+faststart",
        output,
      ]
    : [
        // the seek belongs to the clip only. anullsrc is generated and infinite,
        // and seeking into it would produce nothing at all.
        ...seek,
        "-i", input,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-vf", vf,
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        ...cut,
        "-movflags", "+faststart",
        output,
      ];

  await runFfmpeg(args);
}

type Overlay = { file: string; x: number; y: number };

/**
 * Join the hook and the demo, compositing the caption PNG in the same pass.
 *
 * The PNG is a single frame and overlay's default eof_action repeats it, so a
 * fixed x:y needs no per frame expressions.
 *
 * `overlayEndSec` is what stops the words riding the whole video. A text hook
 * is the line you open on; carrying it over the demo covers the thing the
 * demo exists to show. The hook is always first in the output, so its own
 * length in seconds IS the cut point, and `between` closes a frame early so
 * the demo's first frame is never caught by an inclusive comparison.
 */
async function concatWithOverlay(
  hook: string,
  demo: string,
  overlay: Overlay | null,
  output: string,
  overlayEndSec?: number | null
): Promise<void> {
  const inputs = ["-i", hook, "-i", demo];
  let chain = "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[vraw][a]";
  let label = "[vraw]";

  if (overlay) {
    inputs.push("-i", overlay.file);
    const enable =
      overlayEndSec && overlayEndSec > 0
        ? `:enable='between(t,0,${overlayEndSec.toFixed(3)})'`
        : "";
    chain += `;[vraw][2:v]overlay=${overlay.x}:${overlay.y}${enable}[vout]`;
    label = "[vout]";
  }

  await runFfmpeg([
    ...inputs,
    "-filter_complex", chain,
    "-map", label, "-map", "[a]",
    // superfast on the render path: this is the whole-video encode and the
    // single biggest time sink in the run.
    "-c:v", "libx264", "-preset", "superfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    output,
  ]);
}

/**
 * Cut a sound down to the piece somebody kept, into its own file.
 *
 * Not seeked inline, because `-ss` and `-stream_loop` together are ambiguous
 * about whether the second pass restarts at the seek point or at zero, and a
 * bed that loops back to the part somebody cut off is the one failure nobody
 * would ever report as a bug.
 */
async function cutSound(audio: string, trim: Trim | null): Promise<string> {
  if (!trim) return audio;
  const cutTo = `${audio}.cut.m4a`;
  await runFfmpeg([
    ...(trim.start > 0 ? ["-ss", trim.start.toFixed(3)] : []),
    "-i", audio,
    "-vn",
    "-c:a", "aac", "-b:a", "192k",
    ...(trim.duration ? ["-t", trim.duration.toFixed(3)] : []),
    cutTo,
  ]);
  return cutTo;
}

/**
 * Lay a sound onto the video, three ways.
 *
 * `replace` is the original: the track becomes the whole audio. The clip's
 * own sound is discarded, which is exactly right for a trending sound and
 * exactly wrong for everything else.
 *
 * `bed` keeps the clip's audio and mixes the track under it at `gain`. This is
 * the one people actually want from a music library, and it is the reason the
 * bank exists.
 *
 * Neither loops. Both used to run the track through `-stream_loop -1`, and an
 * eight second sound under a twenty second hook-plus-demo restarted twice,
 * which no one who picked that sound wanted. `apad` instead: the track plays
 * once and the rest of the video is silent under it, so `amix`'s
 * `duration=first` and the `-t` cap still see a stream that lasts to the end.
 * Somebody who wants it longer picks a longer sound, or trims the video.
 *
 * `sting` keeps the clip's audio and drops the sound in once, unlooped, landing
 * on the hook/demo seam. `seamSeconds` is where the join is; the sound starts
 * slightly before it so the hit lands ON the cut rather than after it, which is
 * how a whoosh is actually placed by hand.
 *
 * Three things every mixing branch needs.
 *
 * `-t` pins the output to the video's own length, because a padded input is
 * infinite and bare `-shortest` can both overrun the last frame and, worse,
 * truncate a whole video down to a two second track.
 *
 * `normalize=0` on every amix, because amix divides by the number of inputs by
 * default, which would halve the voiceover the moment any music arrived under
 * it. Measured: with it off, a 440Hz tone reads -28.5dB before and after the
 * bed goes on. With it on, that is -34.5dB and the creator sounds far away.
 *
 * `alimiter` after it, because two full scale things added together are louder
 * than full scale. A whoosh at 0.9 over a normal voiceover measured -0.5dB
 * peak, which is not clipping and is half a decibel from it, and a creator who
 * filmed themselves louder would cross it. `level=disabled` matters: alimiter
 * makes up the gain it removed by default, which would undo the bed's level.
 */
const LIMITER = "alimiter=limit=0.94:level=disabled";
async function applySound(
  video: string,
  audio: string,
  output: string,
  opts: {
    role: AudioRole;
    gain: number;
    trim: Trim | null;
    /** where the hook becomes the demo. only read for a sting. */
    seamSeconds?: number | null;
  }
): Promise<void> {
  const seconds = await mediaSeconds(video);
  const cap = seconds ? ["-t", seconds.toFixed(3)] : [];
  const source = await cutSound(audio, opts.trim);
  const gain = opts.gain.toFixed(3);

  if (opts.role === "replace") {
    await runFfmpeg([
      "-i", video,
      "-i", source,
      "-filter_complex", "[1:a]apad[a]",
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k",
      ...cap,
      "-shortest",
      "-movflags", "+faststart",
      output,
    ]);
    return;
  }

  if (opts.role === "bed") {
    await runFfmpeg([
      "-i", video,
      "-i", source,
      "-filter_complex",
      `[1:a]volume=${gain},apad[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0:dropout_transition=0,${LIMITER}[a]`,
      "-map", "0:v", "-map", "[a]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k",
      ...cap,
      "-movflags", "+faststart",
      output,
    ]);
    return;
  }

  /**
   * A transition sound has to CROSS the cut, not follow it.
   *
   * Nothing here peaks at its own first sample: the whoosh in the house bank is
   * 2.2 seconds of swell whose hit is about half a second in, so starting it on
   * the seam puts the impact well after the shot changed. The lead is a share
   * of the sound's own length rather than a constant, capped so a long riser
   * does not start back in the middle of the hook, and floored at nothing so a
   * sound longer than the hook cannot be pushed to a negative delay.
   *
   * It is a heuristic, and the honest fix for the rest is already on the card:
   * audio trims now, so dragging the in-point is how somebody moves the hit
   * exactly where they want it.
   */
  const played = await mediaSeconds(source);
  const lead = Math.min(0.35, (played ?? 0.3) * 0.25);
  const at = Math.max(0, (opts.seamSeconds ?? 0) - lead);
  const delayMs = Math.round(at * 1000);
  // apad keeps the sting branch alive to the end of the mix. without it amix
  // sees an input end early, and even with dropout_transition off that is a
  // shape worth not relying on.
  const sting = `[1:a]volume=${gain},adelay=${delayMs}:all=1,apad[sting]`;

  await runFfmpeg([
    "-i", video,
    "-i", source,
    "-filter_complex",
    `${sting};[0:a][sting]amix=inputs=2:duration=first:normalize=0:dropout_transition=0,${LIMITER}[a]`,
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "128k",
    ...cap,
    "-movflags", "+faststart",
    output,
  ]);
}

async function extractPoster(input: string, output: string): Promise<void> {
  await runFfmpeg([
    "-ss", "0",
    "-i", input,
    "-frames:v", "1",
    "-vf", "scale=360:-2",
    "-q:v", "4",
    output,
  ]);
}

/**
 * A first frame and a length, for a clip that never passed through a browser.
 *
 * The hand-upload path does both of these in the tab, off a `<video>` and a
 * canvas, which costs the server nothing. A clip pulled in from a link has no
 * tab to do it in, and a card with no poster and no duration reads as a broken
 * upload rather than as a different route in.
 *
 * Best effort by design: a failure here costs the tile its instant paint, never
 * the import.
 */
export async function inspectVideo(
  bytes: Buffer
): Promise<{ poster: Buffer | null; seconds: number | null }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inspect-"));
  try {
    const src = path.join(dir, "src");
    await writeFile(src, bytes);

    const seconds = await mediaSeconds(src);

    let poster: Buffer | null = null;
    try {
      const shot = path.join(dir, "poster.jpg");
      await extractPoster(src, shot);
      poster = await readFile(shot);
    } catch {
      // no poster, carry on
    }

    return { poster, seconds };
  } catch {
    return { poster: null, seconds: null };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── storage ──────────────────────────────────────────────────────────────── */

async function downloadToTmp(
  admin: SupabaseClient,
  storagePath: string,
  dest: string
): Promise<void> {
  const { data, error } = await admin.storage.from(VARIATIONS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`could not download ${storagePath}: ${error?.message ?? "missing"}`);
  }
  await writeFile(dest, Buffer.from(await data.arrayBuffer()));
}

/* ── the queue ────────────────────────────────────────────────────────────── */

const CLIP_COLS = "storage_path, trim_start_seconds, trim_end_seconds";
const SOUND_COLS = `${CLIP_COLS}, audio_role, audio_gain`;

const ROW_SELECT = `
  id, user_id, batch_id, text_content, text_style, attempts,
  hook:hook_id (${CLIP_COLS}),
  demo:demo_id (${CLIP_COLS}),
  audio:audio_id (${SOUND_COLS}),
  sfx:sfx_id (${SOUND_COLS})
`;

/**
 * Put back anything that has been "rendering" for longer than a function can
 * live. A killed invocation leaves its row claimed forever otherwise, and the
 * batch sits at "1 of 4 ready" with nothing working on it.
 */
export async function reclaimStale(
  admin: SupabaseClient,
  /** non-null = a person draining their own queue, never anybody else's */
  ownerId: string | null = null
): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RENDER_MINUTES * 60_000).toISOString();
  let q = admin
    .from("variation_renders")
    .update({ status: "queued", progress: 0 })
    .eq("status", "rendering")
    .lt("started_at", cutoff);
  if (ownerId) q = q.eq("user_id", ownerId);
  const { data } = await q.select("id");
  return data?.length ?? 0;
}

/**
 * Claim the oldest queued renders.
 *
 * The update is the claim: flipping status to `rendering` in the same
 * statement that selects the row is what stops two overlapping invocations
 * from encoding the same video twice.
 */
export async function claimRenders(
  admin: SupabaseClient,
  limit: number,
  ownerId: string | null = null
): Promise<RenderRow[]> {
  let pick = admin
    .from("variation_renders")
    .select("id")
    .eq("status", "queued")
    .lt("attempts", MAX_RENDER_ATTEMPTS);
  if (ownerId) pick = pick.eq("user_id", ownerId);

  const { data: queued } = await pick
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!queued?.length) return [];

  const { data } = await admin
    .from("variation_renders")
    .update({ status: "rendering", started_at: new Date().toISOString(), progress: 5 })
    .in("id", queued.map((r) => r.id))
    .eq("status", "queued")
    .select(ROW_SELECT);

  return (data ?? []) as unknown as RenderRow[];
}

export type BatchOutcome = { total: number; pending: number; done: number; failed: number };

/**
 * Where one batch stands right now.
 *
 * Read straight after a render is written, `pending === 0` means this run wrote
 * the update that finished the batch, which is the only transition signal
 * available without a column on `variation_batches`. A render that failed but
 * has attempts left goes back to `queued`, so it counts as pending and the
 * batch is correctly not done yet.
 */
export async function batchOutcome(
  admin: SupabaseClient,
  batchId: string
): Promise<BatchOutcome> {
  const { data } = await admin
    .from("variation_renders")
    .select("status")
    .eq("batch_id", batchId);

  const rows = (data ?? []) as { status: string }[];
  return {
    total: rows.length,
    pending: rows.filter((r) => r.status === "queued" || r.status === "rendering").length,
    done: rows.filter((r) => r.status === "done").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

/** how many are still waiting, so a run can decide whether to chain */
export async function queuedCount(
  admin: SupabaseClient,
  ownerId: string | null = null
): Promise<number> {
  let q = admin
    .from("variation_renders")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .lt("attempts", MAX_RENDER_ATTEMPTS);
  if (ownerId) q = q.eq("user_id", ownerId);
  const { count } = await q;
  return count ?? 0;
}

/* ── one render ───────────────────────────────────────────────────────────── */

/**
 * Render one row, start to finish.
 *
 * Never throws: a failure lands on the row as text somebody can read and
 * retry, because a worker that dies on one bad clip stops the other
 * twenty-nine in the batch.
 */
export async function renderOne(admin: SupabaseClient, row: RenderRow): Promise<void> {
  const attempts = row.attempts + 1;
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), `var-${row.id}-`));

  const progress = async (value: number) => {
    await admin.from("variation_renders").update({ progress: value }).eq("id", row.id);
  };

  try {
    const hookPath = row.hook?.storage_path;
    const demoPath = row.demo?.storage_path;
    if (!hookPath || !demoPath) {
      throw new Error("this combination lost its hook or demo clip");
    }

    const rawHook = path.join(tmpDir, "hook-src");
    const rawDemo = path.join(tmpDir, "demo-src");
    await Promise.all([
      downloadToTmp(admin, hookPath, rawHook),
      downloadToTmp(admin, demoPath, rawDemo),
    ]);
    await progress(20);

    const hook = path.join(tmpDir, "hook.mp4");
    const demo = path.join(tmpDir, "demo.mp4");
    // the trim is the creator's, not the file's: a hook uploaded with three
    // seconds of dead air in front of it is stored whole and starts here.
    await normalizeVideo(rawHook, hook, row.hook ? trimOf(row.hook) : null);
    await progress(40);
    await normalizeVideo(rawDemo, demo, row.demo ? trimOf(row.demo) : null);
    await progress(55);

    // measured on the NORMALIZED hook, not the source: the normalise pass pins
    // 30fps and can land a frame either side of the original duration, and
    // this number has to match the output timeline exactly.
    const hookSeconds = await mediaSeconds(hook);

    let overlay: Overlay | null = null;
    const text = row.text_content?.trim();
    if (text) {
      const png = await renderTextHookPng(
        text,
        normalizeTextStyle(row.text_style),
        WIDTH,
        HEIGHT
      );
      const file = path.join(tmpDir, "text.png");
      await writeFile(file, png.buffer);
      overlay = { file, x: png.x, y: png.y };
    }

    let output = path.join(tmpDir, "out.mp4");
    await concatWithOverlay(
      hook,
      demo,
      overlay,
      output,
      // a frame short of the cut. null duration (unreadable header) means no
      // window rather than a wrong one, so the text holds for the whole cut
      // the way it did before rather than vanishing at zero.
      hookSeconds ? Math.max(0.05, hookSeconds - 0.02) : null
    );
    await progress(80);

    /**
     * The sound passes, in the order they have to happen.
     *
     * The bed or the full track first, because `replace` throws the clip's own
     * audio away and anything laid on before it would go with it. The sting
     * second, so it sits on top of whatever the audio ended up being. Two
     * ffmpeg passes rather than one filter graph: the video is `-c:v copy` in
     * both, so the second pass costs an audio encode and nothing else, and one
     * graph handling every combination of present and absent inputs is the kind
     * of string nobody can debug when a render fails at 2am.
     */
    const lay = async (sound: NonNullable<RenderRow["audio"]>, name: string) => {
      const raw = path.join(tmpDir, `${name}-src`);
      await downloadToTmp(admin, sound.storage_path as string, raw);
      const next = path.join(tmpDir, `${name}.mp4`);
      await applySound(output, raw, next, {
        role: audioRoleOf(sound),
        gain: audioGainOf(sound),
        trim: trimOf(sound),
        seamSeconds: hookSeconds,
      });
      output = next;
    };

    if (row.audio?.storage_path) await lay(row.audio, "audio");
    // a sting whose role somehow is not 'sting' is skipped rather than laid on
    // as a full track replacement, which would silently wipe the bed above it.
    if (row.sfx?.storage_path && audioRoleOf(row.sfx) === "sting") {
      await lay(row.sfx, "sfx");
    }
    await progress(90);

    const outPath = `${row.user_id}/renders/${row.id}.mp4`;
    const { error: upErr } = await admin.storage
      .from(VARIATIONS_BUCKET)
      .upload(outPath, await readFile(output), {
        contentType: "video/mp4",
        upsert: true,
      });
    if (upErr) throw new Error(`upload failed: ${upErr.message}`);

    // best effort. a missing poster only means the card paints from the video
    // itself, which is slower, not broken.
    let posterPath: string | null = null;
    try {
      const posterFile = path.join(tmpDir, "poster.jpg");
      await extractPoster(output, posterFile);
      const dest = `${row.user_id}/renders/${row.id}.jpg`;
      const { error } = await admin.storage
        .from(VARIATIONS_BUCKET)
        .upload(dest, await readFile(posterFile), {
          contentType: "image/jpeg",
          upsert: true,
        });
      if (!error) posterPath = dest;
    } catch {
      // no poster, carry on
    }

    await admin
      .from("variation_renders")
      .update({
        status: "done",
        progress: 100,
        output_path: outPath,
        poster_path: posterPath,
        error: null,
        attempts,
      })
      .eq("id", row.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attempts >= MAX_RENDER_ATTEMPTS;
    await admin
      .from("variation_renders")
      .update({
        // one more go unless it has had its three. a download that timed out
        // usually works on the next pass; a clip with no video stream never
        // will, and the attempt counter is what stops that one spinning.
        status: exhausted ? "failed" : "queued",
        progress: 0,
        error: message.slice(0, MAX_ERROR_CHARS),
        attempts,
      })
      .eq("id", row.id);
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── kicking the worker ───────────────────────────────────────────────────── */

function workerOrigin(): string {
  const vercel = (process.env.VERCEL_URL ?? "").trim();
  if (vercel) return `https://${vercel}`;
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Fire the worker and do not wait for it.
 *
 * Awaited only long enough to get the request on the wire: a plain
 * fire-and-forget can be frozen along with the lambda before it ever sends,
 * which is how a batch ends up waiting for the daily cron instead of starting
 * immediately. Failures are swallowed on purpose, because the cron is the
 * safety net and a queued row is never lost.
 */
export async function kickWorker(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${workerOrigin()}/api/variations/process`, {
      headers: { authorization: `Bearer ${secret}` },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    // aborted after send, or the network hiccupped. the cron catches up.
  } finally {
    clearTimeout(timer);
  }
}
