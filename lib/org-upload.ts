/**
 * The agency logo upload. Browser only — this touches canvas and object urls,
 * so it can never be imported from a server file.
 *
 * An agency owner has a logo as a file, not as a url. Asking them for a link
 * means asking them to go and host a png somewhere first, which is a request
 * most people answer by pasting the one from their website and getting a 403
 * hotlink placeholder in the rail. So: a file picker, one canvas pass, and a
 * public url handed back that the branding form writes to `orgs.logo_url` like
 * any other value. Pasting a url still works and is still the right answer for
 * anyone whose brand assets already live on a cdn.
 *
 * Every path starts with the uploader's uid because the storage policy on the
 * `portfolio` bucket only accepts writes whose first path segment matches
 * auth.uid(). Changing the shape here without changing the policy fails at the
 * server, not silently.
 *
 * ## why this duplicates thirty lines of lib/portfolio-upload.ts
 *
 * The decode/encode/put helpers there are private to that module and its own
 * doc comment scopes it to the portfolio editor. Importing `uploadClientLogo`
 * instead would tie the white-label paint to the portfolio's private helpers,
 * so a change made for a creator's client wall — a different size, a different
 * quality, a crop — would silently re-encode every agency's logo too. Two
 * features that never ship together are cheaper kept apart than shared through
 * a module neither of them owns. The bucket is the same because the storage
 * policy is the same; that is the only thing worth sharing here.
 */

import { createClient } from "@/lib/supabase/client";

const BUCKET = "portfolio";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** a year. these files are immutable — a new upload gets a new name. */
const CACHE_CONTROL = "31536000";

const LOGO_SIZE = 400;
const WEBP_QUALITY = 0.85;

function publicUrl(path: string) {
  return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
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
 * Canvas to webp.
 *
 * Safari only learned to encode webp recently; where it can't, toBlob quietly
 * hands back a png instead. That is fine — the bucket accepts png and the
 * blob's own type is passed as the content type, so what is stored is always
 * described honestly even when the filename says webp.
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

/**
 * The org's logo, contained inside 400x400 with whatever padding the aspect
 * ratio implies.
 *
 * The canvas is deliberately left unpainted. Agency logos arrive as transparent
 * PNGs and a white fill would put a white box behind every one of them, which
 * is exactly wrong in the one place this image is shown: a rail whose colour
 * the same form lets them set. A white tile on a black rail reads as a broken
 * image, and the agency's first impression of their own white label is a bug.
 *
 * 400px because the rail draws it at 28 and the switcher menu at 32, so this is
 * already four times what any screen asks for. Anything larger is bytes on
 * every page load of every creator on their roster for pixels nobody sees.
 */
export async function uploadOrgLogo(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    // deliberately not naming svg: it goes through the same canvas pass and
    // comes out a raster, so promising it here would set up a complaint about
    // a logo that stopped being sharp. a transparent png is the right advice.
    throw new Error("Pick an image file. A png on transparency is best.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Logos have to be under 8MB.");
  }

  const source = await decode(file);
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!w || !h) throw new Error("That image could not be opened.");

  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("That image could not be processed.");

  // never upscale a small logo. blowing up a 90px favicon only makes it mushy,
  // and a wordmark that arrives 1200px wide is the common case anyway.
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
  const path = `${userId}/org-logo-${Date.now()}.webp`;

  const supabase = createClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    // a fresh timestamped name every time, so an overwrite would only ever be a
    // collision, and a collision should be loud.
    upsert: false,
    cacheControl: CACHE_CONTROL,
    contentType: blob.type,
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
