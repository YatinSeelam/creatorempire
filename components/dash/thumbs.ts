"use client";

/**
 * the filmstrip: one still every so often along the source, drawn by an
 * offscreen video into bitmaps the timeline tiles under each clip.
 *
 * it lives here rather than under `ai-editor/` because the autoposter's cover
 * picker draws the same strip for a different question — which frame does this
 * post open on — and one offscreen video seeking N times is strictly cheaper
 * than N video elements. two copies of this would be two things to fix the
 * next time a browser changes its mind about seeking.
 *
 * a fixed count rather than one per pixel of zoom, because a still is a
 * label for "roughly here" and forty of them along a take say where the
 * person turned their head well enough at any zoom. they arrive in order as
 * the offscreen element seeks, so the strip fills in left to right and the
 * timeline draws a flat block where one has not landed yet.
 *
 * the source is a signed storage url on another origin; storage answers
 * `access-control-allow-origin: *`, which is what lets a frame be read back
 * off a canvas at all. a source that cannot be read leaves `frames` empty and
 * the strip stays flat rather than the timeline breaking.
 */

import { useEffect, useRef, useState } from "react";

export type Thumbs = {
  /** sparse until every frame has landed. index i is the still at `i * stepMs`. */
  frames: (ImageBitmap | null)[];
  stepMs: number;
  width: number;
  height: number;
  /** how many have landed. drawn from so the canvas redraws as they arrive. */
  ready: number;
};

const EMPTY: Thumbs = { frames: [], stepMs: 1, width: 0, height: 0, ready: 0 };

export function useThumbnails(
  src: string | null,
  durationMs: number,
  video: { width: number; height: number },
  opts: { count?: number; height?: number } = {},
): Thumbs {
  const count = Math.max(1, Math.min(120, opts.count ?? 48));
  const height = opts.height ?? 64;
  const [state, setState] = useState<Thumbs>(EMPTY);
  const frames = useRef<(ImageBitmap | null)[]>([]);

  useEffect(() => {
    let dead = false;
    let el: HTMLVideoElement | null = null;

    // through a tick, so nothing here sets state inside the effect's own body.
    const kick = setTimeout(() => {
      if (dead) return;
      if (!src || durationMs <= 0 || typeof createImageBitmap !== "function") {
        setState(EMPTY);
        return;
      }
      el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.playsInline = true;
      el.preload = "auto";
      el.src = src;
      const v = el;

      const stepMs = Math.max(250, Math.ceil(durationMs / count));
      const n = Math.max(1, Math.ceil(durationMs / stepMs));
      frames.current = new Array(n).fill(null);

      const aspect = Math.max(0.2, Math.min(5, (video.width || 1080) / (video.height || 1920)));
      const w = Math.max(16, Math.round(height * aspect));
      setState({ frames: frames.current.slice(), stepMs, width: w, height, ready: 0 });

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: false });
      if (!ctx) return;

      const seekTo = (s: number) =>
        new Promise<void>((resolve, reject) => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            v.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            v.removeEventListener("seeked", onSeeked);
            v.removeEventListener("error", onError);
            reject(new Error("seek failed"));
          };
          v.addEventListener("seeked", onSeeked);
          v.addEventListener("error", onError);
          v.currentTime = s;
        });

      const run = async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            if (v.readyState >= 1) return resolve();
            v.addEventListener("loadedmetadata", () => resolve(), { once: true });
            v.addEventListener("error", () => reject(new Error("load failed")), { once: true });
          });
          const vw = v.videoWidth || video.width || 1080;
          const vh = v.videoHeight || video.height || 1920;
          // cover, not contain: a portrait still in a landscape tile is cropped to the middle.
          const scale = Math.max(w / vw, height / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          const dx = (w - dw) / 2;
          const dy = (height - dh) / 2;
          let ready = 0;
          for (let i = 0; i < n && !dead; i++) {
            // a hair past the boundary, so the still is the frame that starts here rather than the one before.
            const at = Math.min(durationMs - 1, i * stepMs + 1) / 1000;
            await seekTo(at);
            if (dead) break;
            ctx.drawImage(v, dx, dy, dw, dh);
            const bmp = await createImageBitmap(canvas);
            if (dead) {
              bmp.close();
              break;
            }
            frames.current[i] = bmp;
            ready++;
            // every fourth still, and the last, is enough to watch it fill in.
            if (ready % 4 === 0 || i === n - 1) {
              setState({ frames: frames.current.slice(), stepMs, width: w, height, ready });
            }
          }
        } catch {
          // a source that will not seek, or a canvas that is tainted: the strip stays flat.
        }
      };
      void run();
    }, 0);

    return () => {
      dead = true;
      clearTimeout(kick);
      if (el) {
        el.removeAttribute("src");
        el.load();
      }
      for (const f of frames.current) f?.close();
      frames.current = [];
    };
  }, [src, durationMs, count, height, video.width, video.height]);

  return state;
}
