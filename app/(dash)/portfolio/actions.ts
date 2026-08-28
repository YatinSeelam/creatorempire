"use server";

/**
 * One action, one button. The editor holds the whole document in state and
 * posts all of it, so there is nothing to merge here and no partial-save path
 * to reason about.
 *
 * The client's shape is never trusted. Whatever arrives goes through
 * normalizePortfolio, so a hand-crafted request is subject to exactly the same
 * limits as the form. The normalized document is returned on success so the
 * editor can adopt the server's version: clamped strings, generated ids and a
 * slugified link, rather than drifting from what was actually stored.
 */

import { revalidatePath } from "next/cache";
import {
  normalizePortfolio,
  portfolioGaps,
  slugProblem,
  toRow,
  type Portfolio,
} from "@/lib/portfolio-schema";
import { download, importable, resolveClipMedia } from "@/lib/portfolio-import";
import { createClient } from "@/lib/supabase/server";
import { toViewer } from "@/lib/viewer";

export type SaveResult =
  | { ok: true; portfolio: Portfolio }
  | { ok: false; error: string };

export async function savePortfolio(input: unknown): Promise<SaveResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Sign in again to save." };

  const viewer = toViewer(user);
  const p = normalizePortfolio(input, {
    name: viewer.name,
    email: user.email ?? "",
  });

  // A draft is allowed to be half finished, and saving a bad link mid-typing has
  // to keep working. Publishing is where the standards apply, because that is
  // the moment the page becomes an address a brand can open.
  if (p.published) {
    const bad = slugProblem(p.slug);
    if (bad) return { ok: false, error: bad };

    const [gap] = portfolioGaps(p).required;
    if (gap) return { ok: false, error: gap };
  }

  const { error } = await supabase
    .from("portfolios")
    .upsert(toRow(p, user.id), { onConflict: "user_id" });

  if (error) {
    // the unique index on lower(slug). the only collision this table can have,
    // and the only one worth explaining in the creator's own words.
    if (error.code === "23505") {
      return { ok: false, error: "That link is already taken. Try another." };
    }
    return { ok: false, error: "Could not save your portfolio. Try again." };
  }

  // the public page is cached at the root, so a save that changes it has to
  // clear that path and not just the editor's. one address here, unlike the
  // copy of this inside ugc flows: this deploy is the only thing serving the
  // table, so a portfolio has nowhere else it could be.
  if (p.slug) revalidatePath(`/${p.slug}`);
  revalidatePath("/portfolio");

  return { ok: true, portfolio: p };
}

/* ------------------------------------------------------------------ import */

export type ImportResult =
  | { ok: true; videoUrl: string; posterUrl: string }
  | { ok: false; error: string };

/**
 * A TikTok or Instagram link, turned into a file in our own bucket.
 *
 * The end state is identical to a hand upload: `videoUrl` and `posterUrl` on
 * the clip, both pointing at the portfolio bucket, playing in a plain `<video>`
 * on the public page. That is the whole reason this exists rather than an
 * embed — the platforms' embeds are cards with their own header, follow button
 * and caption bar, and none of that belongs between a brand and the work.
 *
 * Writes go through the caller's own client, so the bucket policy (first path
 * segment must equal auth.uid()) is what scopes the write, exactly as it does
 * for the browser upload path. No service key involved.
 *
 * It costs a credit and it is slow — a fetch of the api, a download of the file
 * and an upload of it — so the editor calls it on a button, never on a
 * keystroke.
 */
export async function importClip(rawUrl: string): Promise<ImportResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: "Sign in again to import." };

  const source = importable(typeof rawUrl === "string" ? rawUrl : "");
  if (!source) {
    return { ok: false, error: "Only TikTok and Instagram links can be imported." };
  }

  const found = await resolveClipMedia(source, {
    userId: user.id,
    email: user.email ?? null,
  });
  if (!found.ok) return found;

  const video = await download(found.media.videoUrl, "video");
  if (!video) {
    return { ok: false, error: "That clip could not be downloaded. Try again." };
  }

  const stamp = Date.now();
  const base = `${user.id}/clip-${stamp}`;

  const { error } = await supabase.storage
    .from("portfolio")
    .upload(`${base}.mp4`, video.bytes, {
      upsert: false,
      cacheControl: "31536000",
      contentType: video.contentType,
    });

  if (error) {
    return { ok: false, error: "Could not save that clip. Try again." };
  }

  const videoUrl = supabase.storage.from("portfolio").getPublicUrl(`${base}.mp4`)
    .data.publicUrl;

  // the cover is a nicety. a clip that landed must not be lost because its
  // poster did, so every failure past this point is swallowed.
  let posterUrl = "";
  if (found.media.posterUrl) {
    const poster = await download(found.media.posterUrl, "poster");
    if (poster) {
      const ext = poster.contentType.includes("webp") ? "webp" : "jpg";
      const { error: posterError } = await supabase.storage
        .from("portfolio")
        .upload(`${base}-poster.${ext}`, poster.bytes, {
          upsert: false,
          cacheControl: "31536000",
          contentType: poster.contentType,
        });
      if (!posterError) {
        posterUrl = supabase.storage
          .from("portfolio")
          .getPublicUrl(`${base}-poster.${ext}`).data.publicUrl;
      }
    }
  }

  return { ok: true, videoUrl, posterUrl };
}
