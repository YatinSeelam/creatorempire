"use client";

/**
 * The video upload behind the composer. Browser only.
 *
 * The file goes straight from the browser to the `autopost` storage bucket,
 * never through a server action, because serverless request bodies cap out
 * megabytes below a real vertical video. Upload-Post then fetches the public
 * URL from its own side, so the bytes cross our infrastructure exactly once.
 *
 * The path starts with the uploader's uid because the bucket's insert policy
 * demands it; the segment after is random so a URL is unguessable.
 */

import { createClient } from "@/lib/supabase/client";
import { putWithProgress } from "@/lib/storage-upload";

const BUCKET = "autopost";
const MAX_BYTES = 200 * 1024 * 1024;

export async function uploadAutopostVideo(
  file: File,
  userId: string,
  onProgress?: (fraction: number) => void
): Promise<string> {
  if (!file.type.startsWith("video/")) {
    throw new Error("That is not a video file.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("That video is over 200MB. Export a smaller cut.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
  // crypto.randomUUID needs a secure context and is missing from a couple of
  // older safaris; a timestamp plus random suffix is plenty for an unguessable
  // name that only ever has to be unique within one user's folder.
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${userId}/${unique}.${ext}`;

  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  const apikey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  if (!accessToken || !base) {
    throw new Error("Your session expired. Reload the page and try again.");
  }

  await putWithProgress({
    url: `${base}/storage/v1/object/${BUCKET}/${path}`,
    file,
    apikey,
    accessToken,
    onProgress,
  });

  // built by the client rather than by hand, so the url the composer posts back
  // is the same shape schedulePost checks it against.
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
