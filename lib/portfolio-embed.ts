/**
 * A link a creator pasted, turned into something that plays on the page.
 *
 * The portfolio takes a clip two ways: an uploaded file, or a link to wherever
 * the clip already lives. The upload played and the link did not — it rendered
 * as a still with a play glyph that opened a new tab, which reads as a broken
 * player rather than as a deliberate link out. A brand looking at a portfolio
 * for twenty seconds does not open tabs.
 *
 * So every platform a creator actually posts on gets parsed down to the one id
 * its embed needs. Nothing here fetches: an id is pulled out of the url with a
 * regex, which means this is a pure function usable on the server, in the
 * editor's live preview, and inside `normalize`-style code paths alike.
 *
 * `vm.tiktok.com/XXXX` short links deliberately return null. Resolving one
 * takes a network round trip to read the redirect, and a portfolio that has to
 * make a request per clip before it can render is a worse trade than the link
 * falling back to what it did before. The editor is where to tell someone to
 * paste the full url.
 */

export type ClipEmbed = {
  /** `video` plays in a <video>, `iframe` in the platform's own player. */
  kind: "video" | "iframe";
  src: string;
  /** what the iframe is called, for screen readers. */
  label: string;
};

/** A file the browser can play itself, wherever it is hosted. */
const FILE = /\.(mp4|webm|ogv|mov)(\?|#|$)/i;

const YOUTUBE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/i;
/** the canonical form. `/@user/video/<id>` and `/t/<id>` both carry the id. */
const TIKTOK = /tiktok\.com\/(?:.+\/video\/|v\/|embed\/v2\/)(\d{6,})/i;
/** the kind is captured with the code: `/p/` is a post and `/reel/` a reel, and
 *  instagram's embed 404s if you hand it the wrong one for a given shortcode. */
const INSTAGRAM = /instagram\.com\/(reels?|p|tv)\/([\w-]+)/i;
const DRIVE = /drive\.google\.com\/file\/d\/([\w-]+)/i;
const VIMEO = /vimeo\.com\/(?:video\/)?(\d+)/i;

export function clipEmbed(url: string): ClipEmbed | null {
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) return null;

  // a bare file wins over everything: it needs no third party at all, and a
  // <video> is the only branch here that can be muted, looped and autoplayed
  if (FILE.test(raw)) return { kind: "video", src: raw, label: "Clip" };

  const yt = raw.match(YOUTUBE);
  if (yt) {
    return {
      kind: "iframe",
      // no related videos at the end, and no cookie until someone presses play
      src: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`,
      label: "YouTube clip",
    };
  }

  // TikTok and Instagram are deliberately never embedded.
  //
  // Neither ships a player. Both ship a card — avatar, follow button, @handle,
  // caption, sound row, "Watch now" — with the clip somewhere inside it, and
  // that is somebody else's branding standing between a brand and the work.
  //
  // Cropping the card down to the clip was tried and is a dead end. Instagram's
  // is measurable at rest (54px header, 4:5 media box) and then reflows the
  // moment it loads its profile row, at which point the crop is showing a
  // stripe of the wrong thing. A layout you do not control is not a layout you
  // can crop.
  //
  // The answer for both is Import, which fetches the actual file and copies it
  // into our own bucket, after which it plays as a plain <video> with nothing
  // around it. Until that is pressed the tile links out, which is honest.
  if (TIKTOK.test(raw) || INSTAGRAM.test(raw)) return null;

  const drive = raw.match(DRIVE);
  if (drive) {
    return {
      kind: "iframe",
      src: `https://drive.google.com/file/d/${drive[1]}/preview`,
      label: "Clip",
    };
  }

  const vimeo = raw.match(VIMEO);
  if (vimeo) {
    return {
      kind: "iframe",
      src: `https://player.vimeo.com/video/${vimeo[1]}`,
      label: "Vimeo clip",
    };
  }

  return null;
}

/**
 * Whether a link will play on the page, for the editor to say so before anyone
 * hits save. A link that cannot be embedded is not an error — it still opens in
 * a new tab — but a creator who pasted a `vm.tiktok.com` shortlink deserves to
 * be told the long one plays inline.
 */
export function embeds(url: string): boolean {
  return clipEmbed(url) !== null;
}

/* ------------------------------------------------------------------ import */

/** The platforms whose file can be pulled into our own storage. */
export type ImportPlatform = "instagram" | "tiktok" | "youtube";

export type ClipSource = {
  platform: ImportPlatform;
  /** the url as pasted. the provider resolves shortlinks itself. */
  url: string;
};

/**
 * Which links are worth importing rather than embedding.
 *
 * Lives here, next to the url parsing, rather than in portfolio-import: the
 * editor is a client component and needs this answer to decide whether to show
 * the button, and portfolio-import reads the api key, so a client component
 * cannot touch it.
 */
export function importable(raw: string): ClipSource | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  if (/instagram\.com\/(reels?|p|tv)\//i.test(url)) return { platform: "instagram", url };
  // a vm.tiktok.com shortlink carries no id, and the provider follows the
  // redirect itself, so it is passed through rather than refused
  if (/tiktok\.com\//i.test(url)) return { platform: "tiktok", url };
  // youtube embeds cleanly as a bare player, so importing it is an upgrade
  // rather than a rescue: the file plays with no title bar, no channel avatar
  // and no "Watch on YouTube", and it keeps working if the video goes private.
  if (YOUTUBE.test(url)) return { platform: "youtube", url };
  return null;
}
