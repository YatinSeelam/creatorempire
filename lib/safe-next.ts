/**
 * `?next=` is a redirect target somebody else typed, so it is only ever a path
 * on this origin.
 *
 * The obvious check (starts with `/`, does not start with `//`) is not enough.
 * The WHATWG URL parser treats a backslash as a slash for http(s), so a `next`
 * of `/\evil.com` resolves to the host `evil.com` and the browser leaves the
 * site. Control characters are stripped before parsing and can hide the same
 * shape, so they are rejected rather than normalised.
 *
 * Anything that is not plainly a same-origin path becomes the fallback. There
 * is no partial credit: a `next` we cannot vouch for is not worth salvaging.
 */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;

  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    // C0 controls, DEL, and the backslash that the URL parser would read as a
    // second leading slash.
    if (code < 0x20 || code === 0x7f || code === 0x5c) return fallback;
  }

  return raw;
}
