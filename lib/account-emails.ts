/**
 * Account emails: the vocabulary the tool page, its actions and the inbound
 * webhook all read from. Server safe, dependency free, no browser apis.
 *
 * The addresses are not mailboxes. Nothing is provisioned when one is
 * generated: a row here plus a catch-all in front of the domain is the whole
 * mechanism, which is why a creator can have forty of them and it costs
 * nothing. See app/api/inbound-email/route.ts for the other half.
 */

/**
 * One platform account a generated address signed up. The same address makes
 * the tiktok, the instagram and the youtube for a deal, so these are rows
 * hanging off the address rather than columns on it.
 *
 * Nothing about a row is unique but its id. One address can hold two tiktoks
 * with different handles and different passwords, because that is what the
 * signup forms actually allow and pretending otherwise only forced people to
 * burn a second address on the second login.
 */
export type AccountEmailAccount = {
  id: string;
  email_id: string;
  user_id: string;
  platform: string;
  handle: string | null;
  /** whether a password is stored. never the password itself */
  password_set: boolean;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type AccountEmail = {
  id: string;
  user_id: string;
  address: string;
  local_part: string;
  note: string | null;
  status: "active" | "archived";
  created_at: string;
  last_code_at: string | null;
  /** joined client-side by email_id, oldest first */
  accounts: AccountEmailAccount[];
};

export type AccountCode = {
  id: string;
  email_id: string;
  user_id: string;
  recipient: string;
  sender: string | null;
  sender_domain: string | null;
  subject: string | null;
  platform: string | null;
  code: string | null;
  confidence: "high" | "medium" | "low" | "none";
  snippet: string | null;
  received_at: string;
};

export const ACCOUNT_EMAIL_COLUMNS =
  "id, user_id, address, local_part, note, status, created_at, last_code_at";

/**
 * `password_secret` is deliberately absent, and not as a convention: the
 * `authenticated` role has no select grant on that column at all, so asking
 * for it here would fail the request rather than leak it. It comes back one
 * row at a time through `public.account_email_account_password()`.
 */
export const ACCOUNT_EMAIL_ACCOUNT_COLUMNS =
  "id, email_id, user_id, platform, handle, password_set, note, created_at, updated_at";

export const ACCOUNT_CODE_COLUMNS =
  "id, email_id, user_id, recipient, sender, sender_domain, subject, platform, code, confidence, snippet, received_at";

/**
 * The domain every generated address lives under.
 *
 * A subdomain by default, and that is the safe direction: pointing the root
 * domain's MX at a catch-all takes over every existing address on it, including
 * whatever the founder reads mail on. A subdomain has no mail to break, and no
 * signup form has ever cared that an address had a dot more in it.
 */
export function accountEmailDomain(): string {
  return (process.env.ACCOUNT_EMAIL_DOMAIN || "accounts.creatorempire.app")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
}

/**
 * The four platforms, and there is no fifth.
 *
 * This product is one brand deal going out on tiktok, instagram, youtube and
 * facebook, so the picker is those four and nothing else. Small enough that the
 * ui draws it as buttons rather than a dropdown: a menu you have to open to
 * read four things is a menu that costs more than it saves.
 *
 * Still free text in the database, so a fifth would be a line here rather than
 * a migration.
 */
export const ACCOUNT_PLATFORMS = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
] as const;

/**
 * Platforms the picker used to offer and the table still holds. Trimming the
 * list must not turn a stored row into an unsaveable one, so these still pass
 * validation and still get their proper label. They are simply not on offer for
 * a new account.
 */
const LEGACY_PLATFORMS = [
  { value: "other", label: "Other" },
  { value: "google", label: "Google" },
  { value: "snapchat", label: "Snapchat" },
  { value: "twitter", label: "X" },
] as const;

type PlatformOption = { value: string; label: string };

export function isKnownPlatform(value: string): boolean {
  return (
    ACCOUNT_PLATFORMS.some((p) => p.value === value) ||
    LEGACY_PLATFORMS.some((p) => p.value === value)
  );
}

export function platformLabel(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const known =
    ACCOUNT_PLATFORMS.find((p) => p.value === value) ??
    LEGACY_PLATFORMS.find((p) => p.value === value);
  if (known) return known.label;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The options a picker should carry. The current value is always in the list
 * even when the picker no longer offers it, otherwise a legacy row has no
 * button of its own and nothing on screen says what it holds.
 */
export function platformOptions(current?: string | null): PlatformOption[] {
  const list: PlatformOption[] = ACCOUNT_PLATFORMS.map((p) => ({
    value: p.value,
    label: p.label,
  }));
  if (current && !list.some((p) => p.value === current)) {
    list.unshift({ value: current, label: platformLabel(current) });
  }
  return list;
}

/**
 * How many addresses one account may generate in a day, and how many it may
 * hold at once.
 *
 * Both are here rather than in the database because they are product limits,
 * not integrity ones: a real creator with six deals across three platforms
 * needs eighteen addresses, and a script pointed at the generate button would
 * otherwise burn through the domain's reputation for free.
 */
export const GENERATE_DAILY_LIMIT = 30;
export const ACTIVE_ADDRESS_LIMIT = 250;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Cryptographically random, not sequential. A guessable address is somebody
 * else's signup code delivered to a stranger, and the address is the only
 * secret in the whole flow: anyone who can name it can receive on it.
 */
function randomSuffix(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/**
 * A readable stem so a person can tell two addresses apart at a glance, and a
 * random tail so nobody can guess the next one. Lowercase alphanumerics only,
 * which is the alphabet every signup form on earth accepts without quoting.
 */
export function buildLocalPart(seed: string | null | undefined): string {
  const first = (seed ?? "").trim().split(/[\s@.]+/)[0] ?? "";
  const stem = first.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "ugc";
  return `${stem}-${randomSuffix()}`;
}

export function buildAddress(localPart: string): string {
  return `${localPart.toLowerCase()}@${accountEmailDomain()}`;
}
