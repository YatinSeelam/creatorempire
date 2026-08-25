/**
 * Money and counts. Everything money is an integer number of cents, end to end:
 * the database stores cents, the forms parse to cents, and the only place a
 * dollar figure exists is the string a human reads. Float dollars in a CPM
 * calculation is how a payout ends up a cent off and nobody can say why.
 */

/** "1,250.50" · "$1250.5" · "1250" → 125050. Junk → null. */
export function parseCents(input: unknown): number | null {
  const text = String(input ?? "").trim().replace(/[$,\s]/g, "");
  if (!text) return null;
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const dollars = Number(text);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/** Same, but an empty field means "zero" rather than "invalid". */
export function parseCentsOrZero(input: unknown): number | null {
  const text = String(input ?? "").trim();
  if (!text) return 0;
  return parseCents(text);
}

/** "12,000" · "12000" → 12000. Junk or negative → null. */
export function parseCount(input: unknown): number | null {
  const text = String(input ?? "").trim().replace(/[,\s]/g, "");
  if (!text) return null;
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

/** 125050 → "$1,250.50". Whole dollars lose the ".00", which is most of them. */
export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = whole.toLocaleString("en-US") + (rest ? `.${String(rest).padStart(2, "0")}` : "");
  return `${negative ? "-" : ""}$${body}`;
}

/** 1250 → "$12.50" always, for rates where the cents are the point. */
export function moneyExact(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  return `${negative ? "-" : ""}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** 1_284_000 → "1.28m". View counts are read at a glance, never audited. */
export function views(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1_000;
    return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? m.toFixed(2).replace(/0$/, "").replace(/\.$/, "") : m.toFixed(1)}m`;
}

/** "Aug 8" · "Aug 8, 2025" once the year stops being this one. */
export function shortDate(value: string | null | undefined, now = new Date()): string {
  if (!value) return "unknown";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "unknown";
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

/** "3d ago" · "2w ago". Relative is what a creator actually wants on a feed. */
export function ago(value: string | null | undefined, now = new Date()): string {
  if (!value) return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";
  const days = Math.floor((now.getTime() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * The same idea as {@link ago}, but it fills in the hours and minutes.
 *
 * `ago` stops at the day on purpose: a post's age is read in days and "14 hours
 * ago" is noise on a feed. A refresh stamp is the opposite question — whether
 * the numbers under it are five minutes or a fortnight old — so this answers
 * the first day precisely and hands anything older back to `ago`.
 */
export function since(value: string | null | undefined, now = new Date()): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "never";

  const secs = Math.floor((now.getTime() - then) / 1000);
  if (secs < 45) return "a few seconds ago";

  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  return ago(value, now);
}

/** Today in UTC as YYYY-MM-DD. The day key every snapshot is stored under. */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
