/**
 * Editor handoff links: the shared contract, pure, safe in the browser.
 *
 * The idea in one line: on this deploy the person who cuts the video already
 * exists, on discord or telegram or upwork, and they will never hold a login
 * here. So a job mints one opaque url, `creatorempire.app/handoff/<token>`, and
 * whoever holds it gets the whole batch on one page: the brief, the style, the
 * references, every uploaded video, the brand's shelf, downloadable.
 *
 * The room is read only, and that is the design. Delivery is manual — the
 * editor sends the finished file back however they always did, and the creator
 * files it on the job page. Nothing an anonymous url holder does can write a
 * row, so there is no forged delivery to defend against.
 *
 * Reads: app/handoff/[token]. Writes: app/(dash)/editing/actions.ts and the
 * one security-definer rpc in 20260825190000_editor_handoff_links.
 */

/** One row of `edit_job_handoff_links`. The token only reaches the owner. */
export type HandoffLink = {
  id: string;
  job_id: string;
  user_id: string;
  token: string;
  label: string | null;
  revoked_at: string | null;
  expires_at: string | null;
  views: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The origin every handoff link is built on. Same shape as the referral link
 * in lib/earn.ts and for the same reason: this url gets pasted into somebody
 * else's discord, so it has to be absolute and it has to be stable.
 */
export function handoffBase(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "https://www.creatorempire.app";
  return raw.replace(/\/+$/, "");
}

export function handoffUrl(token: string, base = handoffBase()): string {
  return `${base}/handoff/${token}`;
}

/** True while the link still opens: not revoked, not past its date. */
export function linkIsLive(
  link: Pick<HandoffLink, "revoked_at" | "expires_at">
): boolean {
  if (link.revoked_at) return false;
  if (link.expires_at && new Date(link.expires_at) <= new Date()) return false;
  return true;
}

/** What a job's kind is called on the editor's page. */
export const HANDOFF_KIND_LABEL: Record<number, string> = {
  1: "reaction cut",
  2: "full edit",
};

/** The word on a file's chip, in the editor's language rather than the db's. */
export const FILE_KIND_LABEL: Record<string, string> = {
  footage: "video",
  asset: "asset",
  reference: "reference",
  doc: "doc",
};
