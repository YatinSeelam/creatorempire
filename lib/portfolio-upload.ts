/**
 * Uploads for the portfolio editor. Browser only - this touches canvas, video
 * elements and object urls, so it can never be imported from a server file.
 *
 * Images are resized here rather than on the way out because the alternative is
 * an image pipeline we would have to run, pay for and keep up. A creator's
 * camera roll photo is 4MB of pixels nobody will ever see at that size; one
 * canvas pass turns it into a ~60KB webp before it leaves the phone, which
 * makes the upload fast on a bad connection and the public page fast for
 * everyone after.
 *
 * Video is uploaded untouched. Transcoding in a browser tab means ffmpeg.wasm,
 * a several-MB download and a minute of a locked-up phone, which is a worse
 * trade than a slightly larger mp4.
 *
 * Every path starts with the uploader's uid because the storage policy on the
 * `portfolio` bucket only accepts writes whose first path segment matches
 * auth.uid(). Changing the shape here without changing the policy fails at the
 * server, not silently.
 */

import { createClient } from "@/lib/supabase/client";
import { capBytes } from "@/lib/upload-limits";

const BUCKET = "portfolio";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = capBytes(60 * 1024 * 1024);

/** a year. these files are immutable - a new upload gets a new name. */
const CACHE_CONTROL = "31536000";

const AVATAR_SIZE = 640;
const LOGO_SIZE = 400;
const POSTER_WIDTH = 720;
const WEBP_QUALITY = 0.85;

/* ------------------------------------------------------------------ helpers */

function publicUrl(path: string) {
  return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

async function put(path: string, body: Blob, contentType: string) {
  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    // a fresh timestamped name every time, so an overwrite would only ever be a
    // collision, and a collision should be loud.
    upsert: false,
    cacheControl: CACHE_CONTROL,
    contentType,
  });

  if (error) {
    throw new Error(
      /exceeded the maximum allowed size/i.test(error.message)
        ? "That file is too large to upload."
        : "Upload failed. Check your connection and try again."
    );
  }

  return publicUrl(path);
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through. safari has historically refused some encoders here.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That image could not be opened."));
      img.src = url;
    });
  } finally {
    // the decoded bitmap keeps its own copy, so the url is done either way.
    URL.revokeObjectURL(url);
  }
}

function dimensions(source: ImageBitmap | HTMLImageElement) {
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  return { w, h };
}

/**
 * Canvas to webp.
 *
 * Safari only learned to encode webp recently; where it can't, toBlob quietly
 * hands back a png instead. That is fine - the bucket accepts png and the blob's
 * own type is passed as the content type, so what is stored is always described
 * honestly even when the filename says webp.
 */
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("That image could not be processed.")),
      "image/webp",
      WEBP_QUALITY
    );
  });
}

function checkImage(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Pick an image file.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Images have to be under 8MB.");
  }
}

/* ------------------------------------------------------------------- avatar */

/**
 * One square source at 640px, cover-cropped from the middle.
 *
 * The template scales this everywhere it appears - a 40px chip in the editor, a
 * 160px circle on the page - so there is exactly one file to upload and one to
 * download regardless of the screen. Cropping to a square here rather than with
 * CSS means the bytes stored are the bytes shown.
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  checkImage(file);

  const source = await decode(file);
  const { w, h } = dimensions(source);
  if (!w || !h) throw new Error("That image could not be opened.");

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That image could not be processed.");

  // cover: take the largest centred square the photo contains, then scale it.
  const side = Math.min(w, h);
  ctx.drawImage(
    source as CanvasImageSource,
    (w - side) / 2,
    (h - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  );

  const blob = await encode(canvas);
  return put(`${userId}/avatar-${Date.now()}.webp`, blob, blob.type);
}

/* -------------------------------------------------------------- client logo */

/**
 * Contained inside 400x400 with whatever padding the aspect ratio implies.
 *
 * The canvas is deliberately left unpainted. Brand logos arrive as transparent
 * PNGs and a white fill would put a white box behind every one of them, which
 * looks broken the moment the creator picks a dark surface for their page.
 */
export async function uploadClientLogo(file: File, userId: string): Promise<string> {
  checkImage(file);

  const source = await decode(file);
  const { w, h } = dimensions(source);
  if (!w || !h) throw new Error("That image could not be opened.");

  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That image could not be processed.");

  // never upscale a small logo. blowing up a 90px favicon only makes it mushy.
  const scale = Math.min(LOGO_SIZE / w, LOGO_SIZE / h, 1);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  ctx.drawImage(
    source as CanvasImageSource,
    (LOGO_SIZE - dw) / 2,
    (LOGO_SIZE - dh) / 2,
    dw,
    dh
  );

  const blob = await encode(canvas);
  return put(`${userId}/client-${Date.now()}.webp`, blob, blob.type);
}

/* --------------------------------------------------------------------- clip */

const VIDEO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * Grabs a still off the front of the clip.
 *
 * Best effort by design: it is a nicety, and a browser that refuses to decode
 * the file, a codec canvas can't read, or a video that never fires `seeked`
 * must not cost the creator the upload they already waited on. Every failure
 * path returns null and the clip renders with the player's own first frame.
 */
async function posterBlob(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  // required or the canvas is tainted for cross-origin sources; harmless here.
  video.crossOrigin = "anonymous";

  try {
    return await new Promise<Blob | null>((resolve) => {
      // some browsers simply never report a seek on some files. don't hang.
      const timer = setTimeout(() => resolve(null), 8000);
      const done = (blob: Blob | null) => {
        clearTimeout(timer);
        resolve(blob);
      };

      video.onerror = () => done(null);

      video.onloadeddata = () => {
        // 0.3s in, because frame zero of a phone video is often a blur or a
        // black fade. shorter clips get 10% instead so the seek stays in range.
        const at = Math.min(0.3, (video.duration || 1) * 0.1);
        video.currentTime = Number.isFinite(at) && at > 0 ? at : 0;
      };

      video.onseeked = () => {
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return done(null);

          const scale = Math.min(POSTER_WIDTH / w, 1);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return done(null);

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => done(blob), "image/webp", WEBP_QUALITY);
        } catch {
          done(null);
        }
      };

      video.src = url;
      video.load();
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The clip itself plus a poster frame.
 *
 * `onProgress` is honest rather than pretty: supabase-js v2 uploads through
 * fetch, which reports nothing until the body is sent, so there is no real
 * percentage to report. It is called with 0 at the start and 100 at the end
 * only, which is enough to drive a spinner. Do not build a filling bar on it.
 */
export async function uploadClip(
  file: File,
  userId: string,
  onProgress?: (pct: number) => void
): Promise<{ videoUrl: string; posterUrl: string }> {
  if (!file.type.startsWith("video/")) {
    throw new Error("Pick a video file.");
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `Clips have to be under ${Math.floor(MAX_VIDEO_BYTES / (1024 * 1024))}MB.`
    );
  }

  onProgress?.(0);

  const stamp = Date.now();
  const ext = VIDEO_EXT[file.type] ?? file.name.split(".").pop()?.toLowerCase() ?? "mp4";
  const videoUrl = await put(`${userId}/clip-${stamp}.${ext}`, file, file.type);

  let posterUrl = "";
  try {
    const poster = await posterBlob(file);
    if (poster) {
      posterUrl = await put(`${userId}/poster-${stamp}.webp`, poster, poster.type);
    }
  } catch {
    // a missing thumbnail is not worth failing an upload that already landed.
  }

  onProgress?.(100);
  return { videoUrl, posterUrl };
}
