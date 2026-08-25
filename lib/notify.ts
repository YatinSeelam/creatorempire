/**
 * The bell: shared contract, pure, safe in the browser.
 *
 * One row per thing that happened to one person. Both shells render the same
 * table — the creator's rail and the editor's — because the events are
 * symmetric: an editor claims, the creator is told; the creator sends it back,
 * the editor is told.
 *
 * The wording lives here rather than at each call site so the same event never
 * reads two ways depending on which action wrote it, and so this file is the
 * one place to look when somebody asks what the bell can say.
 *
 * Writes: lib/notify-server.ts, service client only (see the migration for why
 * there is no insert policy). Reads: the same file, RLS-scoped.
 */

export type NotifKind =
  // creator's bell
  | "job_claimed"
  | "job_released"
  | "cut_delivered"
  | "client_approved"
  | "client_changes"
  | "client_note"
  // editor's bell
  | "revisions_requested"
  | "job_approved"
  | "payout_paid";

export type Notification = {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  subject: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Three tones and nothing else.
 *
 * `flame` means the ball is in your court, `ink` means money or a finish line,
 * `quiet` means information. An unknown kind is quiet: a row written by a
 * deploy newer than the one rendering it must degrade, never throw.
 */
export type NotifTone = "flame" | "ink" | "quiet";

const TONES: Record<NotifKind, NotifTone> = {
  job_claimed: "quiet",
  job_released: "flame",
  cut_delivered: "flame",
  client_approved: "ink",
  client_changes: "flame",
  client_note: "quiet",
  revisions_requested: "flame",
  job_approved: "ink",
  payout_paid: "ink",
};

export function notifTone(kind: string): NotifTone {
  return TONES[kind as NotifKind] ?? "quiet";
}

/** The glyph a row draws, by tone. Four paths, no icon library. */
export type NotifGlyph = "clock" | "check" | "dot";

const GLYPHS: Record<NotifKind, NotifGlyph> = {
  job_claimed: "dot",
  job_released: "clock",
  cut_delivered: "clock",
  client_approved: "check",
  client_changes: "clock",
  client_note: "dot",
  revisions_requested: "clock",
  job_approved: "check",
  payout_paid: "check",
};

export function notifGlyph(kind: string): NotifGlyph {
  return GLYPHS[kind as NotifKind] ?? "dot";
}

export const UNREAD_CAP = 99;

/** "12" or "99+". The bell is 20px wide and a real number will not fit. */
export function unreadLabel(n: number): string {
  return n > UNREAD_CAP ? `${UNREAD_CAP}+` : String(n);
}

/**
 * A pasted number into something storable: a leading `+` if it was there, then
 * digits. Null when there are not enough digits to be a phone number anywhere.
 *
 * Deliberately not a strict E.164 parse. The product has creators in half a
 * dozen countries typing their number the way their own phone shows it, and a
 * validator that rejects a real number is worse than one that stores a number
 * the sender will reject later — nothing sends yet, and the verification round
 * trip is what will settle the format when it does.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${plus ? "+" : ""}${digits}`;
}
