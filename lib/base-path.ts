/**
 * The path prefix this deploy is served under, read off NEXT_PUBLIC_SITE_URL.
 *
 * Production serves this app inside ugc flows: www.ugcflows.com rewrites
 * `/creatorempire/:path*` to this vercel project, so every url the browser
 * ever sees carries `/creatorempire` in front of it. Set
 * NEXT_PUBLIC_SITE_URL=https://www.ugcflows.com/creatorempire and that one
 * value drives next's `basePath`, the oauth redirect, the cron path and every
 * hand written link. Leave it off (or point it at a bare origin) and BASE_PATH
 * is "", which is the standalone deploy and localhost.
 *
 * It is a build time value: next inlines `basePath` into the client bundles,
 * so changing this env var means a rebuild, not a restart.
 *
 * Pure on purpose, and deliberately not built on lib/site-url.ts. next.config
 * imports this before there is a next runtime to import from, and a client
 * bundle only gets NEXT_PUBLIC_* inlined, so the VERCEL_* fallbacks in
 * site-url would read as undefined in the browser and the two halves of the
 * app would disagree about where they live.
 */
export const BASE_PATH: string = (() => {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return "";
  try {
    const path = new URL(raw).pathname.replace(/\/+$/, "");
    return path === "/" ? "" : path;
  } catch {
    // a value that is not a url tells us nothing about a prefix. "" is the
    // safe answer: no prefix anywhere beats half the app carrying one.
    return "";
  }
})();

/** A same origin path with the prefix on it, for links next does not rewrite. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
