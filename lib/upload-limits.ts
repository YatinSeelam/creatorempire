/**
 * The biggest file the browser is allowed to send, in one place.
 *
 * This number is NOT ours to pick. Supabase enforces a project-wide upload
 * ceiling in front of every bucket, and a bucket's own `file_size_limit` is
 * only ever the smaller of the two: `autopost` reads 200MB, the project's
 * ceiling is 50MB, and the project wins. So the composer said "mp4 up to
 * 200mb", a 57MB cut was refused with "The object exceeded the maximum allowed
 * size", and the label was the thing that lied.
 *
 * Raising it is a change in Supabase (Storage > Settings > upload file size
 * limit, on a plan that allows more than 50MB), then setting
 * NEXT_PUBLIC_MAX_UPLOAD_MB to the same number here. Every label, client check
 * and error message reads this one value, so they move together or not at all.
 */

const FALLBACK_MB = 50;

export const MAX_UPLOAD_MB = (() => {
  // NEXT_PUBLIC_ vars are inlined at build time, so this has to be a literal
  // property read rather than a lookup through a variable.
  const raw = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : FALLBACK_MB;
})();

export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** A per-feature cap, never allowed above what storage will actually accept. */
export function capBytes(preferred: number): number {
  return Math.min(preferred, MAX_UPLOAD_BYTES);
}
