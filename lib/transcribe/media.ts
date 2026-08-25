/**
 * The cover and the file behind one pasted post.
 *
 * The transcriber's apify actor answers exactly one question, "what was said",
 * and hands back nothing else: no cover, no handle, no caption. That is why
 * every instagram card in the strip showed two grey letters where the clip
 * should be, and why the video pane fell all the way through to instagram's own
 * embed on a post we could have played directly.
 *
 * These are the same two single-post endpoints the portfolio importer already
 * uses (lib/portfolio-import.ts): one billed credit each, written to the same
 * ledger so a transcribe shows up on /admin/usage like everything else.
 *
 * Failure here is silent on purpose. A missing cover is a plainer card. It must
 * never be the reason a transcript that already came back is refused.
 */

import type { ParsedUrl } from "@/lib/ingest/urls";
import { fetchInstagramPost, fetchTiktokPost, SC_ENDPOINT } from "@/lib/scrape/scrapecreators";
import { logUsage } from "@/lib/scrape/usage";

/** Who is paying for the credit. Null only where there is no session to name. */
export type Who = { userId: string; email: string | null };

export type ClipMeta = {
  video_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  creator_handle: string | null;
};

const EMPTY: ClipMeta = {
  video_url: null,
  thumbnail_url: null,
  caption: null,
  creator_handle: null,
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** tiktok returns every media url as a `{ url_list: [...] }` of mirrors. */
const firstUrl = (v: unknown): string | null => {
  const list = obj(v).url_list;
  return Array.isArray(list) && typeof list[0] === "string" && list[0].trim() ? list[0] : null;
};

/**
 * A caption worth putting in the title bar.
 *
 * Instagram captions are routinely one emoji and four hashtags, and a card
 * named "🫡" is worse than one named off its own first sentence, which is what
 * the caller falls back to when this returns null.
 */
function usableCaption(raw: string | null): string | null {
  if (!raw) return null;
  const words = raw
    .replace(/#[^\s#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words.length >= 12 ? raw.trim() : null;
}

export async function fetchClipMeta(parsed: ParsedUrl, who: Who | null): Promise<ClipMeta> {
  if (parsed.platform !== "tiktok" && parsed.platform !== "instagram") return EMPTY;
  if (!process.env.SCRAPECREATORS_API_KEY) return EMPTY;

  const ig = parsed.platform === "instagram";
  const endpoint = ig ? SC_ENDPOINT.instagramPost : SC_ENDPOINT.tiktokPost;
  const res = ig
    ? await fetchInstagramPost(parsed.canonicalUrl)
    : await fetchTiktokPost(parsed.canonicalUrl);

  const body = res.ok ? obj(res.body) : {};

  // logged before anything is read out of it: the credit is spent either way.
  if (who) {
    await logUsage({
      userId: who.userId,
      userEmail: who.email,
      endpoint,
      platform: parsed.platform,
      targetId: parsed.videoId,
      creditsCharged: typeof body.credits_charged === "number" ? body.credits_charged : 1,
      creditsRemaining: typeof body.credits_remaining === "number" ? body.credits_remaining : null,
      cached: false,
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : res.error,
      durationMs: res.durationMs,
    });
  }

  if (!res.ok) return EMPTY;

  if (ig) {
    const m = obj(obj(body.data).xdt_shortcode_media);
    return {
      video_url: str(m.video_url),
      thumbnail_url: str(m.display_url) ?? str(m.thumbnail_src),
      caption: usableCaption(
        str(
          obj(obj(obj(obj(m.edge_media_to_caption).edges)[0]).node).text
        )
      ),
      creator_handle: str(obj(m.owner).username),
    };
  }

  const detail = obj(body.aweme_detail);
  const video = obj(detail.video);
  return {
    // play_addr before download_addr: the download one carries the burned in
    // watermark, same reason the portfolio importer prefers it.
    video_url: firstUrl(video.play_addr) ?? firstUrl(video.play_addr_h264),
    thumbnail_url: firstUrl(video.origin_cover) ?? firstUrl(video.cover),
    caption: usableCaption(str(detail.desc)),
    creator_handle: str(obj(detail.author).unique_id),
  };
}
