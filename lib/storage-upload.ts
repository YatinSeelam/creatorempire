"use client";

/**
 * Sending a file to a Supabase storage bucket with a progress number attached.
 *
 * `supabase.storage.upload` runs on `fetch`, and `fetch` cannot report how much
 * of a request body has gone out. That is fine for a 40KB logo and useless for
 * a 500MB shoot on hotel wifi, which is several minutes of a spinner that might
 * equally be a dead connection. XHR has `upload.onprogress`, so anything built
 * on this can draw a bar that actually moves.
 *
 * This lived inside `lib/autopost/upload.ts` and was lifted out unchanged the
 * moment the edit-job uploader needed the same thing. There is exactly one copy
 * of the request shape on purpose: it is hand-rolled against what storage-js
 * sends, so a second copy is a second thing to fix when Supabase changes it.
 *
 * The request is a copy of what storage-js sends for a Blob at this version:
 * POST, multipart with a `cacheControl` field and the file under the empty
 * name, `x-upsert` as a header. Nothing clever, and worth checking against
 * `uploadOrUpdate` in @supabase/storage-js if an upload ever starts 400ing.
 */

import { createClient } from "@/lib/supabase/client";
import { MAX_UPLOAD_MB } from "@/lib/upload-limits";

const CACHE_CONTROL = "31536000";

export function putWithProgress(args: {
  url: string;
  file: File;
  apikey: string;
  accessToken: string;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("cacheControl", CACHE_CONTROL);
    form.append("", args.file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", args.url);
    xhr.setRequestHeader("authorization", `Bearer ${args.accessToken}`);
    xhr.setRequestHeader("apikey", args.apikey);
    xhr.setRequestHeader("x-upsert", "false");
    // deliberately no content-type: XHR writes the multipart boundary itself and
    // setting it by hand is the classic way to break a form upload.

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) args.onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        args.onProgress?.(1);
        resolve();
        return;
      }
      reject(
        new Error(
          /exceeded the maximum allowed size/i.test(xhr.responseText)
            ? `that file is too large. the limit is ${MAX_UPLOAD_MB}mb.`
            : xhr.status === 401 || xhr.status === 403
              ? "your session expired. reload and try again."
              : "upload failed. check your connection."
        )
      );
    };
    xhr.onerror = () => reject(new Error("upload failed. check your connection."));
    xhr.onabort = () => reject(new Error("upload cancelled"));

    xhr.send(form);
  });
}

/**
 * The same thing, addressed by bucket and path rather than by full url, and
 * with the session looked up for you. Everything that is not the autopost
 * composer wants this one.
 */
export async function uploadToBucket(args: {
  bucket: string;
  path: string;
  file: File;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.access_token;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  if (!accessToken || !base) {
    throw new Error("your session expired. reload and try again.");
  }

  await putWithProgress({
    url: `${base}/storage/v1/object/${args.bucket}/${args.path}`,
    file: args.file,
    apikey,
    accessToken,
    onProgress: args.onProgress,
  });
}
