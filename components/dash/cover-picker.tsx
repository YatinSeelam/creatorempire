"use client";

/**
 * Which frame the post opens on.
 *
 * Asked in the discord: "is there a way to edit the thumbnail for the
 * autoposter?" A cover is not a setting somebody types, it is a frame they
 * recognise, so this is a strip of the clip's own stills with the picked one
 * ringed and the real frame shown above it at full size.
 *
 * THE PREVIEW IS A REAL `<video>` SEEKED TO THE PICK, never the nearest still
 * off the strip. The strip is coarse by design — twelve tiles across a
 * thirty second cut is two and a half seconds apart — so drawing the nearest
 * tile as "your cover" would show a frame that is not the one being sent. The
 * video element seeks exactly, costs nothing extra (the clip is already
 * loaded for the row's own poster), and makes what is on screen the thing that
 * goes out.
 *
 * THE STRIP CAN COME BACK EMPTY AND THAT IS FINE. Reading a frame off a canvas
 * needs the source to answer CORS, which our own public `autopost` bucket does
 * (`access-control-allow-origin: *`) and a third-party url may not. A clip
 * whose stills cannot be drawn keeps the preview and the scrubber and simply
 * has no tiles, the same bargain `useThumbnails` already makes with the ai
 * editor's timeline.
 *
 * NOTHING IS DECIDED HERE ABOUT WHERE THE COVER GOES. `lib/autopost/cover.ts`
 * is that rule and it runs on the server too; this draws the frame and hands
 * back a number.
 */

import { useEffect, useRef, useState } from "react";

import { COVER_MAX_MS, coverLabel } from "@/lib/autopost/cover";
import { useThumbnails } from "@/components/dash/thumbs";

/** how many stills to lay along the clip. twelve is enough to find the shot
 *  somebody is looking for on a thirty second cut and few enough that the
 *  strip does not need its own scrollbar in a 480px drawer. */
const TILES = 12;
const TILE_H = 72;

export function CoverPicker({
  src,
  coverMs,
  onPick,
  busy = false,
  note,
}: {
  /** the clip itself. null draws nothing at all: there is no frame to choose
   *  from and a scrubber over a video nobody can see is a number picked blind. */
  src: string | null;
  /** the frame currently picked, or null for no choice. */
  coverMs: number | null;
  /** a new frame, or null to go back to no choice. */
  onPick: (ms: number | null) => void;
  busy?: boolean;
  /** one line under the strip, for whatever the caller has to say about where
   *  this cover actually lands. */
  note?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [dead, setDead] = useState(false);
  // a source swap has to clear the last one's failure, or the picker stays
  // empty forever. adjusted in render rather than in an effect so the new
  // src's first paint is the new src — `ClipThumb`'s own idiom.
  const [tracked, setTracked] = useState(src);
  if (tracked !== src) {
    setTracked(src);
    setDead(false);
    setDurationMs(0);
  }

  const at = coverMs ?? 0;

  // the real frame, seeked. only while there is a duration to seek inside:
  // setting currentTime before metadata lands is a seek the element throws
  // away, which is what leaves a picker showing frame zero forever.
  useEffect(() => {
    const el = video.current;
    if (!el || durationMs <= 0) return;
    const want = Math.min(at, Math.max(0, durationMs - 1)) / 1000;
    if (Math.abs(el.currentTime - want) < 0.02) return;
    try {
      el.currentTime = want;
    } catch {
      // a source that will not seek keeps whatever frame it is showing.
    }
  }, [at, durationMs]);

  const strip = useThumbnails(
    dead ? null : src,
    durationMs,
    { width: 1080, height: 1920 },
    { count: TILES, height: TILE_H }
  );

  if (!src) return null;

  const max = Math.max(0, Math.min(COVER_MAX_MS, durationMs > 0 ? durationMs - 1 : 0));

  return (
    <div className="grid gap-2.5">
      <div className="relative overflow-hidden rounded-card border border-line bg-shell">
        {/* muted and never played: this is a still, and a cover picker that
            starts playing takes the frame out from under the finger choosing
            it. */}
        <video
          ref={video}
          src={src}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDurationMs(Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0);
          }}
          onError={() => setDead(true)}
          className="mx-auto block max-h-[38vh] w-auto"
        />
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-pill bg-ink/80 px-2 py-0.5 text-[11px] font-bold tabular-nums text-paper">
          {coverMs === null ? "no cover picked" : coverLabel(at)}
        </span>
      </div>

      {/* the coarse choice. a tile is what somebody is actually scanning for,
          so it is the loud control and the slider under it is the nudge. */}
      {strip.ready > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {strip.frames.map((frame, i) => {
            const ms = Math.min(max, i * strip.stepMs);
            const picked = coverMs !== null && Math.abs(ms - at) < strip.stepMs / 2;
            return (
              <button
                key={i}
                type="button"
                disabled={busy}
                aria-label={`cover at ${coverLabel(ms)}`}
                aria-pressed={picked}
                onClick={() => onPick(ms)}
                className={`shrink-0 overflow-hidden rounded-[8px] border-2 transition-colors disabled:opacity-60 ${
                  picked ? "border-flame" : "border-transparent hover:border-flame/50"
                }`}
              >
                <Still frame={frame} width={strip.width} height={strip.height} />
              </button>
            );
          })}
        </div>
      )}

      {/* the fine one. `max` is a frame short of the end on purpose: a cover at
          exactly the last millisecond is a frame the platform may not have. */}
      <input
        type="range"
        min={0}
        max={max || 1}
        step={100}
        value={Math.min(at, max)}
        disabled={busy || max <= 0}
        aria-label="cover frame"
        onChange={(e) => onPick(Number(e.target.value))}
        className="w-full accent-flame disabled:opacity-50"
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {note && <span className="text-[12px] text-ink-50">{note}</span>}
        {/* the way back, and it clears rather than picking 0: those are two
            different answers. no cover means the platform chooses, which is
            what every post before this did. */}
        {coverMs !== null && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(null)}
            className="ml-auto shrink-0 text-[12px] font-semibold text-ink-50 transition-colors hover:text-flame disabled:opacity-60"
          >
            let the platform pick
          </button>
        )}
      </div>
    </div>
  );
}

/** One still, drawn out of its bitmap. A tile whose frame has not landed yet
 *  is a flat block rather than a gap, so the strip does not reflow as it
 *  fills in left to right. */
function Still({
  frame,
  width,
  height,
}: {
  frame: ImageBitmap | null;
  width: number;
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !frame) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(frame, 0, 0);
  }, [frame]);
  return (
    <canvas
      ref={ref}
      width={Math.max(1, width)}
      height={Math.max(1, height)}
      className="block bg-shell"
      style={{ width: Math.max(1, width), height: Math.max(1, height) }}
    />
  );
}
