/**
 * The shared plumbing every provider sits on: a spacing limiter, a retry that
 * only retries what is worth retrying, and a reader for JSON whose shape the
 * provider is free to change without telling anyone.
 */

/**
 * Minimum-spacing scheduler, not a token bucket. Scrape hosts throttle on
 * bursts even when the average is under the cap, so spacing is what they
 * actually enforce. `nextAt` is claimed synchronously before the first await,
 * so two callers in the same tick get two different slots instead of the same
 * one.
 */
export class Spacer {
  private nextAt = 0;

  constructor(private readonly gapMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextAt);
    this.nextAt = at + this.gapMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(readonly status: number, readonly bodyPreview: string) {
    super(`http ${status}: ${bodyPreview.slice(0, 200)}`);
  }
}

/**
 * Retries transient failures with exponential backoff. A 401/403/404 is not
 * retried: a bad key or a deleted account will still be bad in 600ms, and the
 * attempt costs a billable call.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 400 } = {}
): Promise<T> {
  let last: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const transient =
        err instanceof HttpError ? TRANSIENT.has(err.status) : !(err instanceof TypeError);
      if (!transient || i === attempts) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }

  throw last;
}

/** GET, JSON, timed out, non-2xx as an HttpError so retry can classify it. */
export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 12_000
): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(res.status, `not json: ${text.slice(0, 120)}`);
  }
}

// ------------------------------------------------------- reading loose shapes

type Json = unknown;

function at(source: Json, path: string): Json {
  let node: Json = source;
  for (const key of path.split(".")) {
    if (node == null) return undefined;
    if (Array.isArray(node)) {
      const index = Number(key);
      node = Number.isInteger(index) ? node[index] : undefined;
    } else if (typeof node === "object") {
      node = (node as Record<string, Json>)[key];
    } else {
      return undefined;
    }
  }
  return node;
}

/**
 * First path that holds a string. Scrape providers rename fields between
 * versions and nest the same object under three different roots, so every field
 * is a list of the places it has been seen rather than one path that breaks
 * silently on a Tuesday.
 */
export function pickString(source: Json, paths: string[]): string | null {
  for (const path of paths) {
    const value = at(source, path);
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** First path that holds a finite non-negative number. */
export function pickNumber(source: Json, paths: string[]): number | null {
  for (const path of paths) {
    const value = at(source, path);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  }
  return null;
}

/** First path that holds an array. */
export function pickArray(source: Json, paths: string[]): Json[] {
  for (const path of paths) {
    const value = at(source, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}
