/**
 * Where the cut comes from, and what counts as a url we are willing to hand to
 * Upload-Post.
 *
 * Three sources, and the difference between them is only ever how the url is
 * arrived at. Downstream nothing changes: Upload-Post fetches one public url,
 * the bytes cross our infrastructure at most once, and `social_posts.video_url`
 * stores whatever was resolved here.
 *
 * - **upload** — the file went browser → the `autopost` bucket. The url was
 *   minted by our own uploader, so anything not on that exact prefix is
 *   somebody poking at the endpoint.
 * - **variation** — a finished render out of the variations tool. The client
 *   sends a render id, never a url: the row is re-read through rls and the url
 *   is built here, so a hand-edited form cannot post somebody else's file or a
 *   render that is still queued.
 * - **link** — a link somebody pasted, usually Google Drive. This is the only
 *   one that leaves our storage, so it is the only one with a host allowlist.
 *
 * Pure and client safe on purpose: the composer uses `readLink` to tell
 * somebody their link will not work while they are still looking at the box,
 * and the action uses the same function to decide. One answer, two callers.
 */

/** The `autopost` bucket, public. A url on this prefix came from our uploader. */
export function autopostPrefix(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/autopost/`;
}

export type LinkRead = { ok: true; url: string; label: string } | { ok: false; error: string };

/** A Drive file id out of any of the four link shapes Drive hands people. */
function driveFileId(url: URL): string | null {
  // .../file/d/<id>/view, .../file/d/<id>/edit, and the bare .../d/<id>
  const inPath = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  if (inPath) return inPath[1];
  // /open?id=<id>, /uc?id=<id>, /download?id=<id>
  const inQuery = url.searchParams.get("id");
  return inQuery && /^[A-Za-z0-9_-]{10,}$/.test(inQuery) ? inQuery : null;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

/**
 * A host that is a machine rather than a name on the public internet.
 *
 * Nothing here fetches the link — it is posted to Upload-Post as a string and
 * they do the download — so this is not our SSRF to have. It is still the wrong
 * thing to relay: `https://169.254.169.254/x.mp4` is a cloud metadata endpoint
 * wearing a video extension, and the only honest answer to "why would a creator
 * paste an ip literal for a brand deal" is that they would not. Blocking the
 * shape costs nothing and keeps us from being the pipe.
 *
 * String work only, and deliberately so: this module is imported by the browser
 * composer, so it cannot resolve a name. Anything past the shape (a public name
 * that points at a private address) is Upload-Post's own fetcher to defend.
 */
function isMachineHost(hostname: string): boolean {
  // new URL() brackets an ipv6 literal, and ::1 / fd00:: never belong here.
  if (hostname.startsWith("[")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // no dot at all: localhost, or a bare container/service name on some network.
  return !hostname.includes(".");
}

/**
 * A pasted link to something Upload-Post can actually fetch.
 *
 * The hard part is not the allowlist, it is that a Drive *share* link is an
 * html page. Handing that over unchanged means Upload-Post downloads a page of
 * markup, calls it a video, and the post fails somewhere far away from the
 * person who pasted it. So a Drive link is rewritten to the direct download
 * endpoint, and `confirm=t` is what skips the virus-scan interstitial Drive
 * puts in front of anything big enough to be a video.
 *
 * Sharing still has to be "anyone with the link". We cannot check that from
 * here — a private file 302s to a login page and looks fine to a url parser —
 * so the composer says it in words instead.
 */
export function readLink(raw: string): LinkRead {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "Paste the link first." };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { ok: false, error: "That is not a link." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "The link has to be https." };
  }

  // before the host branches, so it covers the open-ended one at the bottom.
  // the two named hosts could never have matched an ip anyway.
  if (isMachineHost(url.hostname)) {
    return { ok: false, error: "That is not a link anything can download from." };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
    const id = driveFileId(url);
    if (!id) {
      return {
        ok: false,
        error: "That Drive link has no file in it. Use Share, Copy link, on the video itself.",
      };
    }
    return {
      ok: true,
      url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`,
      label: "Google Drive",
    };
  }

  if (host === "dropbox.com" || host === "dl.dropboxusercontent.com") {
    // dl=1 is what turns a dropbox preview page into the file itself.
    url.searchParams.set("dl", "1");
    return { ok: true, url: url.toString(), label: "Dropbox" };
  }

  // anything else has to already BE the file. a link to a page that happens to
  // contain a video is a page, and it fails the same way a drive share link
  // does, just without a rewrite we know how to write.
  if (VIDEO_EXT.test(url.pathname)) {
    return { ok: true, url: url.toString(), label: host };
  }

  return {
    ok: false,
    error:
      "Use a Google Drive or Dropbox link, or a direct link ending in .mp4. A link to a page will not download.",
  };
}
