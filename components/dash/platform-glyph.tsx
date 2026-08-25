import type { Platform } from "@/lib/deals";

/**
 * TikTok, Instagram, YouTube, Facebook, as marks.
 *
 * A platform is one of four things a creator already recognises at a glance,
 * and spelling "INSTAGRAM" under every handle costs a line of type to say what a
 * 16px mark says instantly. Used wherever a row is per-platform: the autopost
 * connect strip, the deal's own bar, anywhere a handle needs saying whose it is.
 *
 * Two tones, and the difference carries meaning rather than decoration:
 *
 * - `tone="current"` is the default and inherits `currentColor`, so a strip of
 *   four reads as one set and the parent decides what the colour means. This is
 *   what the connect strip and the account rows use.
 * - `tone="brand"` draws the platform's own colours. Reserved for the one place
 *   where colour IS the state: the deal bar shows a live account in full colour
 *   and a missing one greyed out, so "which of my four is connected" is
 *   answered without a word of text. Anywhere else, four brand colours in a row
 *   fight each other and fight the page's accent.
 *
 * Drawn here rather than pulled from an icon package: four marks at 20px is a
 * few hundred bytes against a dependency, and they have to inherit size from
 * whatever they are dropped into.
 */
export function PlatformGlyph({
  platform,
  className = "size-[17px]",
  tone = "current",
}: {
  platform: Platform;
  className?: string;
  tone?: "current" | "brand";
}) {
  if (tone === "brand") return <BrandMarkGlyph platform={platform} className={className} />;

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {platform === "tiktok" && (
        <>
          <path d="M14 3v11.2a3.8 3.8 0 1 1-3.2-3.75" />
          <path d="M14 3a5.6 5.6 0 0 0 5.4 4.4" />
        </>
      )}
      {platform === "instagram" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
        </>
      )}
      {platform === "youtube" && (
        <>
          <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
          <path d="m10.5 9.5 5 2.5-5 2.5z" fill="currentColor" strokeWidth="1.2" />
        </>
      )}
      {platform === "facebook" && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <path d="M13 18V9c0-2 1-3 3-3" />
          <path d="M10.5 12h5" />
        </>
      )}
    </svg>
  );
}

/**
 * The full-colour marks.
 *
 * TikTok is three offset copies of one note (cyan behind, red in front, ink on
 * top) because that is what the real mark is. Instagram's gradient needs a
 * `<defs>`, and its id is per platform rather than random: two of these can be
 * on a page at once and a duplicate id is harmless when both mean the same
 * thing, where a random one breaks a server render's hydration match. Facebook
 * is a flat rounded square, same shape as instagram's rect but one solid fill
 * instead of a gradient. The last `return` below is not a default, it is
 * tiktok specifically: add a new platform above it or it silently draws
 * tiktok's mark instead of its own.
 */
function BrandMarkGlyph({
  platform,
  className,
}: {
  platform: Platform;
  className: string;
}) {
  if (platform === "youtube") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
        <path
          d="M22.5 7.2a3 3 0 0 0-2.1-2.1C18.6 4.6 12 4.6 12 4.6s-6.6 0-8.4.5A3 3 0 0 0 1.5 7.2C1 9 1 12 1 12s0 3 .5 4.8a3 3 0 0 0 2.1 2.1c1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5a3 3 0 0 0 2.1-2.1C23 15 23 12 23 12s0-3-.5-4.8Z"
          fill="#FF0000"
        />
        <path d="M9.8 15.4V8.6l5.7 3.4-5.7 3.4Z" fill="#fff" />
      </svg>
    );
  }

  if (platform === "instagram") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
        <defs>
          {/* userSpaceOnUse, because these coordinates are viewBox units. the
              default is objectBoundingBox, where 2 and 22 are read as fractions
              of the rect and every stop but one falls off the end, which is why
              the mark drew as one flat orange instead of the gradient. */}
          <linearGradient
            id="ugcflows-ig-mark"
            gradientUnits="userSpaceOnUse"
            x1="3.5"
            y1="21.5"
            x2="20.5"
            y2="2.5"
          >
            <stop offset="0" stopColor="#FFDC80" />
            <stop offset="0.25" stopColor="#F77737" />
            <stop offset="0.5" stopColor="#F56040" />
            <stop offset="0.75" stopColor="#C13584" />
            <stop offset="1" stopColor="#5B51D8" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="20" height="20" rx="5.8" fill="url(#ugcflows-ig-mark)" />
        <circle cx="12" cy="12" r="4.6" fill="none" stroke="#fff" strokeWidth="1.9" />
        <circle cx="17.6" cy="6.5" r="1.15" fill="#fff" />
      </svg>
    );
  }

  if (platform === "facebook") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
        <rect x="2" y="2" width="20" height="20" rx="5.8" fill="#1877F2" />
        <path
          d="M15.6 12.6l.44-2.9h-2.78V7.83c0-.79.39-1.56 1.63-1.56h1.27V3.8s-1.15-.2-2.25-.2c-2.3 0-3.8 1.39-3.8 3.91V9.7H7.56v2.9h2.55V19h3.14v-6.4h2.35Z"
          fill="#fff"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path
        d="M15.2 2.2c.4 2.4 1.9 4 4.3 4.2v2.7c-1.5.1-2.9-.3-4.2-1.1v5.1c0 4-3.4 6.6-7 5.6a5.7 5.7 0 0 1-.8-10.6c.6-.3 1.3-.4 1.9-.4v2.8c-1.6.2-2.5 1.3-2.4 2.7a2.9 2.9 0 0 0 5.7-.2V2.2h2.5Z"
        fill="#25F4EE"
        transform="translate(-1.4 1)"
      />
      <path
        d="M15.2 2.2c.4 2.4 1.9 4 4.3 4.2v2.7c-1.5.1-2.9-.3-4.2-1.1v5.1c0 4-3.4 6.6-7 5.6a5.7 5.7 0 0 1-.8-10.6c.6-.3 1.3-.4 1.9-.4v2.8c-1.6.2-2.5 1.3-2.4 2.7a2.9 2.9 0 0 0 5.7-.2V2.2h2.5Z"
        fill="#FE2C55"
        transform="translate(1 -0.4)"
      />
      <path
        d="M15.2 2.2c.4 2.4 1.9 4 4.3 4.2v2.7c-1.5.1-2.9-.3-4.2-1.1v5.1c0 4-3.4 6.6-7 5.6a5.7 5.7 0 0 1-.8-10.6c.6-.3 1.3-.4 1.9-.4v2.8c-1.6.2-2.5 1.3-2.4 2.7a2.9 2.9 0 0 0 5.7-.2V2.2h2.5Z"
        fill="#111"
      />
    </svg>
  );
}
