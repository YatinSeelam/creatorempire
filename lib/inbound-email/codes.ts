/**
 * Pulling a signup code out of an email, and guessing who sent it.
 *
 * Pure and dependency free, so the webhook can run it with no i/o and it can be
 * reasoned about on its own. Nothing here throws: a message the parser cannot
 * read still becomes a row, because the subject line in front of a human beats
 * a dropped email every time.
 *
 * The thing this has to get right is NOT finding codes, it is refusing to find
 * them. "1,240 people watched your video" and "© 2026" are both a digit run in
 * an email, and a wrong code pasted into a signup form locks an account out for
 * fifteen minutes. So every candidate is scored, the low ones say so on the
 * card, and a number with nothing code-shaped near it is not a code.
 */

export type Confidence = "high" | "medium" | "low" | "none";

export type CodeGuess = {
  code: string | null;
  confidence: Confidence;
};

const NO_CODE: CodeGuess = { code: null, confidence: "none" };

/**
 * Words that sit next to a code. Deliberately generous: a false positive here
 * only means a number gets promoted from "low" to "high", and every candidate
 * still has to survive the guard below.
 */
const CODE_WORD =
  "(?:verification|verify|verifying|confirm(?:ation|ing)?|security|authenticat\\w*|one[-\\s]?time|single[-\\s]?use|sign[-\\s]?in|log[-\\s]?in|login|passcode|access\\s+code|otp|\\bpin\\b|\\bcode\\b)";

/** Numbers that are never a code, in the shapes they actually arrive in. */
const NOT_A_CODE_TAIL =
  /^\s*(?:followers?|views?|likes?|comments?|subscribers?|shares?|px|%|off\b|usd|eur|gbp)/i;

/**
 * A candidate is rejected outright when the text around it says it is
 * something else. Cheap checks, in the order they fire most often.
 */
function allowed(hay: string, code: string, at: number): boolean {
  const before = hay.slice(Math.max(0, at - 1), at);
  const after = hay.slice(at + code.length);

  // part of a bigger number, a price, or a decimal
  if (/[\d.,$£€]/.test(before)) return false;
  if (/^[.,]\d/.test(after)) return false;
  if (NOT_A_CODE_TAIL.test(after)) return false;

  // a bare year is the single most common false positive: every footer has one
  if (/^(?:19|20)\d{2}$/.test(code)) {
    const near = hay.slice(Math.max(0, at - 28), at + code.length + 28);
    if (!new RegExp(CODE_WORD, "i").test(near)) return false;
  }

  return true;
}

/** First match of `re` whose captured group survives `allowed()`. */
function firstAllowed(hay: string, re: RegExp): { code: string; at: number } | null {
  for (const m of hay.matchAll(re)) {
    const code = m[1];
    if (!code || m.index === undefined) continue;
    const at = m.index + m[0].lastIndexOf(code);
    if (allowed(hay, code, at)) return { code, at };
  }
  return null;
}

/**
 * Extract the most likely code from a subject and a body.
 *
 * Ordered rules, strongest first. Each one returns as soon as it fires, so the
 * order IS the ranking, and the confidence it carries is what the card shows.
 */
export function extractVerificationCode(subject: string, body: string): CodeGuess {
  const subj = (subject ?? "").trim();
  const text = (body ?? "").trim();
  if (!subj && !text) return NO_CODE;

  // Links are stripped before anything is scanned. A tracking url carries
  // thirty digits of campaign id and is the largest source of wrong answers in
  // the whole problem; a code that only exists inside a link is a click flow,
  // not a type-it-in flow, so nothing real is lost.
  const clean = (s: string) => s.replace(/https?:\/\/\S+/gi, " ");
  const cleanSubject = clean(subj);
  const cleanBody = clean(text);
  const hay = `${cleanSubject}\n${cleanBody}`;
  const hasCodeWord = new RegExp(CODE_WORD, "i").test(hay);

  // 1. Google's own shape. The user types the digits, not the G-.
  const google = firstAllowed(hay, /\bG-(\d{4,8})\b/g);
  if (google) return { code: google.code, confidence: "high" };

  // 2 and 3. Digits sitting next to a code word, either side of it. This is
  // what almost every real verification email looks like.
  const afterWord = firstAllowed(
    hay,
    new RegExp(`${CODE_WORD}[^\\d\\n]{0,48}?(\\d{4,8})\\b`, "gi")
  );
  if (afterWord) return { code: afterWord.code, confidence: "high" };

  const beforeWord = firstAllowed(
    hay,
    new RegExp(`\\b(\\d{4,8})[^\\d\\n]{0,48}?${CODE_WORD}`, "gi")
  );
  if (beforeWord) return { code: beforeWord.code, confidence: "high" };

  // 4. Instagram splits its six digits into two groups: "123 456 is your code".
  if (hasCodeWord) {
    const spaced = hay.match(/\b(\d{3})\s(\d{3})\b/);
    if (spaced) return { code: spaced[1] + spaced[2], confidence: "high" };
  }

  // 5. A line holding nothing but the code. This is the shape an html email
  // takes once the markup is stripped, where the code is its own big heading
  // and the word "code" is a paragraph away.
  let offset = 0;
  for (const line of hay.split("\n")) {
    const trimmed = line.trim();
    const m = trimmed.match(/^(\d{4,8})$/);
    // the candidate's real index, not the first place that digit run happens to
    // appear: allowed() reads the characters either side of it and would judge
    // the wrong occurrence otherwise.
    if (m && allowed(hay, m[1], offset + line.indexOf(trimmed))) {
      return { code: m[1], confidence: hasCodeWord ? "high" : "medium" };
    }
    offset += line.length + 1;
  }

  // 6. An alphanumeric token next to a code word, for the platforms that do not
  // use digits. Both a letter and a digit is the tell, so it cannot fire on an
  // ordinary word or on something rule 2 would already have caught.
  const alnum = hay.match(
    new RegExp(`${CODE_WORD}[^\\w\\n]{0,24}([A-Z0-9]{5,8})\\b`, "i")
  );
  if (alnum && /[A-Za-z]/.test(alnum[1]) && /\d/.test(alnum[1])) {
    return { code: alnum[1].toUpperCase(), confidence: "high" };
  }

  // 7. Nothing was labelled. A digit run in the subject is still the likeliest
  // place a code hides, so it is offered rather than dropped, and it is offered
  // as a guess: the card says so and shows the subject line under it.
  const looseSubject = firstAllowed(cleanSubject, /\b(\d{4,8})\b/g);
  if (looseSubject) return { code: looseSubject.code, confidence: "low" };

  const looseBody = firstAllowed(cleanBody, /\b(\d{4,8})\b/g);
  if (looseBody) return { code: looseBody.code, confidence: "low" };

  return NO_CODE;
}

/**
 * Who sent it. Domain first because it is the only part a sender cannot get
 * wrong, then the display name and subject as a fallback for the platforms that
 * send through a third party.
 *
 * A list rather than a chain of ifs so adding a platform is one line, which is
 * the whole point: this list will be wrong about something new every few
 * months and the fix should never be a code change anywhere else.
 */
const PLATFORM_HINTS: ReadonlyArray<{
  platform: string;
  domains: string[];
  needles: string[];
}> = [
  { platform: "tiktok", domains: ["tiktok.com", "tiktokv.com", "tiktokglobalshop.com"], needles: ["tiktok"] },
  { platform: "instagram", domains: ["instagram.com", "mail.instagram.com"], needles: ["instagram"] },
  { platform: "youtube", domains: ["youtube.com"], needles: ["youtube"] },
  { platform: "google", domains: ["google.com", "gmail.com", "accounts.google.com"], needles: ["google", "gmail"] },
  { platform: "facebook", domains: ["facebook.com", "facebookmail.com", "meta.com", "metamail.com"], needles: ["facebook", "meta platforms"] },
  { platform: "snapchat", domains: ["snapchat.com", "mail.snapchat.com"], needles: ["snapchat"] },
  { platform: "twitter", domains: ["x.com", "twitter.com"], needles: ["twitter", " x corp"] },
  { platform: "pinterest", domains: ["pinterest.com"], needles: ["pinterest"] },
  { platform: "linkedin", domains: ["linkedin.com"], needles: ["linkedin"] },
  { platform: "discord", domains: ["discord.com", "discordapp.com"], needles: ["discord"] },
  { platform: "twitch", domains: ["twitch.tv"], needles: ["twitch"] },
  { platform: "reddit", domains: ["reddit.com", "redditmail.com"], needles: ["reddit"] },
];

export function detectPlatform(from: string, subject: string): string {
  const domain = addressDomain(parseAddress(from));
  if (domain) {
    for (const hint of PLATFORM_HINTS) {
      // suffix match, so mail.tiktok.com and notifications.tiktok.com both land
      if (hint.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
        return hint.platform;
      }
    }
  }

  const hay = ` ${from ?? ""} ${subject ?? ""} `.toLowerCase();
  for (const hint of PLATFORM_HINTS) {
    if (hint.needles.some((n) => hay.includes(n))) return hint.platform;
  }
  return "other";
}

/**
 * Html to text, keeping the line breaks.
 *
 * Collapsing everything onto one line is what breaks the "code on its own line"
 * rule above, and that rule is the one that catches the big-heading emails
 * every platform sends. Block tags become newlines before the tags are stripped.
 */
export function htmlToText(html: string): string {
  return (html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "TikTok <no-reply@tiktok.com>" to "no-reply@tiktok.com". */
export function parseAddress(raw: string): string {
  const angled = (raw ?? "").match(/<([^>]+)>/);
  return (angled ? angled[1] : (raw ?? "")).trim().toLowerCase();
}

export function addressDomain(address: string): string {
  const at = (address ?? "").lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).trim().toLowerCase();
}
