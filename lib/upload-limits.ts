/**
 * The biggest file the browser is allowed to send, in one place.
 *
 * This number is NOT ours to pick. Supabase enforces a project-wide upload
 * ceiling in front of every bucket, and a bucket's own `file_size_limit` is
 * only ever the smaller of the two. That is how the composer came to say "mp4
 * up to 200mb" while a 57MB cut was refused with "The object exceeded the
 * maximum allowed size": `autopost` reads 200MB, the project's ceiling read
 * 50MB, and the project wins. The label was the thing that lied.
 *
 * So the ceiling is set in exactly two places and they must carry the same
 * number: Supabase (Storage > Settings > upload file size limit, which needs a
 * plan allowing more than 50MB - this project is on Pro) and
 * NEXT_PUBLIC_MAX_UPLOAD_MB here. Every label, client check and error message
 * reads this one value, so they move together or not at all.
 *
 * The fallback is 50 rather than 200 on purpose: an environment that forgot the
 * variable should under-promise and refuse a file storage would have taken,
 * never advertise a size storage will reject after a two minute upload.
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
