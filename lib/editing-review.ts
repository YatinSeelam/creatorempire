/**
 * Client review links: the shared contract, pure, safe in the browser.
 *
 * The idea in one line: the person who actually signs off on a cut is the
 * creator's campaign manager, and they will never have a login here. So a job
 * gets one opaque url, `creatorempire.app/review/<token>`, and whoever holds it can
 * watch the cuts and say approve or changes.
 *
 * A verdict is a signal, not a command. Approving still happens in the
 * dashboard, because approving releases the payout and a stranger with a url
 * must not be able to spend the creator's credits. Same for a change request:
 * the creator forwards it, because the included direction round is finite.
 *
 * Reads: app/review/[token] (the public room), the creator's job page, the
 * editor's job page. Writes: app/(dash)/editing/actions.ts and the two
 * security-definer rpcs in 20260822050000_client_review_links.
 */

export type ReviewVerdict = "approved" | "changes" | "comment";

/** One row of `edit_job_review_links`. The token only ever reaches the owner. */
export type ReviewLink = {
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

/** One thing the client said. `handled_at` null is the creator's inbox. */
export type ReviewNote = {
  id: string;
  job_id: string;
  link_id: string;
  deliverable_id: string | null;
  version: number;
  verdict: ReviewVerdict;
  reviewer_name: string | null;
  body: string | null;
  handled_at: string | null;
  created_at: string;
};

/** Chip wording, house voice, one place. */
export const VERDICT_LABEL: Record<ReviewVerdict, string> = {
  approved: "approved",
  changes: "changes asked",
  comment: "note",
};

export const VERDICT_TONE: Record<ReviewVerdict, "flame" | "ink" | "quiet"> = {
  approved: "ink",
  changes: "flame",
  comment: "quiet",
};

/** What the room says the reviewer's name was, when they did not type one. */
export function reviewerName(note: Pick<ReviewNote, "reviewer_name">): string {
  return note.reviewer_name?.trim() || "your client";
}

/** True while the link still opens: not revoked, not past its date. */
export function linkIsLive(link: Pick<ReviewLink, "revoked_at" | "expires_at">): boolean {
  if (link.revoked_at) return false;
  if (link.expires_at && new Date(link.expires_at) <= new Date()) return false;
  return true;
}

/**
 * The origin every review link is built on. Same shape as the referral link in
 * lib/earn.ts and for the same reason: the url gets pasted into somebody
 * else's slack, so it has to be absolute and it has to be stable.
 */
export function reviewBase(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "https://www.creatorempire.app";
  return raw.replace(/\/+$/, "");
}

export function reviewUrl(token: string, base = reviewBase()): string {
  return `${base}/review/${token}`;
}

/**
 * A verdict a note carries into the creator's inbox, in one sentence, for the
 * discord ping and the email subject.
 */
export function verdictSentence(note: {
  verdict: ReviewVerdict;
  reviewer_name: string | null;
}): string {
  const who = reviewerName(note);
  if (note.verdict === "approved") return `${who} approved the cut`;
  if (note.verdict === "changes") return `${who} asked for changes`;
  return `${who} left a note`;
}
