/**
 * The custom brand logo upload. Browser only - this touches canvas and image
 * elements, so it can never be imported from a server file. Same shape as
 * lib/portfolio-upload.ts and for the same reasons: raster images are resized
 * to a small webp before they leave the phone, so the upload is fast and the
 * dashboard stays fast for everyone after.
 *
 * SVGs are the one exception: a canvas pass would rasterise a vector mark,
 * which is strictly worse, so they go up untouched. The bucket's 1MB limit is
 * the backstop for those.
 *
 * Every path starts with the uploader's uid because the storage policy on the
 * `brand-logos` bucket only accepts writes whose first path segment matches
 * auth.uid(). Changing the shape here without changing the policy fails at the
 * server, not silently.
 */

import { createClient } from "@/lib/supabase/client";

const BUCKET = "brand-logos";
const MAX_BYTES = 1024 * 1024;
const LOGO_SIZE = 400;
const WEBP_QUALITY = 0.85;

/** a year. these files are immutable - a new upload gets a new name. */
const CACHE_CONTROL = "31536000";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

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

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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

/**
 * Contained inside 400x400 with whatever padding the aspect ratio implies, on
 * a deliberately unpainted canvas: logos arrive as transparent PNGs and a
 * white fill would put a white box behind every one of them.
 */
async function toWebp(file: File): Promise<Blob> {
  const source = await decode(file);
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
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
  ctx.drawImage(source as CanvasImageSource, (LOGO_SIZE - dw) / 2, (LOGO_SIZE - dh) / 2, dw, dh);

  return new Promise((resolve, reject) => {
    // where a browser can't encode webp, toBlob quietly hands back a png. that
    // is fine: the bucket accepts png and the blob's own type is what's sent.
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("That image could not be processed.")),
      "image/webp",
      WEBP_QUALITY
    );
  });
}

/**
 * Uploads a brand logo and returns its public url, ready for `brands.logo_url`.
 *
 * The uid is read from the session here rather than threaded down as a prop:
 * the storage policy re-checks it on the server, so a wrong one cannot land a
 * file under somebody else's path, only fail.
 */
export async function uploadBrandLogo(file: File): Promise<string> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error("Pick a png, jpg, webp or svg.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Logos have to be under 1MB.");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session expired. Sign in again.");

  const stamp = Date.now();
  if (file.type === "image/svg+xml") {
    return put(`${user.id}/logo-${stamp}.svg`, file, file.type);
  }

  const blob = await toWebp(file);
  return put(`${user.id}/logo-${stamp}.webp`, blob, blob.type);
}
