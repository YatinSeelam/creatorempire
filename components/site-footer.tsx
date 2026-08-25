import Link from "next/link";
import { brand, footerNav, socials } from "@/lib/content";
import { Mark, SocialIcon } from "./art";

/**
 * Black, and the page's closing band is the same black.
 *
 * It ran on the shell for a while, on the argument that a dark slab under a
 * page of paper and shell puts a hard horizontal edge at the bottom of every
 * route. That is true of a footer standing on its own; it is not true here any
 * more, because FinalCta above it is now the same near-black and the two read
 * as one base the page settles onto rather than as a slab dropped under it.
 *
 * Every colour in here is a white opacity rather than an ink token. The ink
 * scale is three greys tuned against paper and every one of them is unreadable
 * on ink itself, so the muted tiers are /70 for links, /50 for prose and /40
 * for the labels and the copyright.
 *
 * The mark is left as it is. public/logo-mark.png is a black tile with a white
 * "u." on it, so on this ground the tile disappears and the letter is the logo,
 * which is the right answer and needs no second file.
 */
export function SiteFooter({ flush = false }: { flush?: boolean }) {
  const links = socials.filter((s) => s.href);

  return (
    // `flush` drops the top margin. The landing page ends on a band with its own
    // section padding and wants none; a page ending on a bare paragraph does.
    <footer className={`bg-ink ${flush ? "" : "mt-20"}`}>
      <div className="mx-auto w-full max-w-[1440px] px-5 py-12 sm:px-6 sm:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)] lg:gap-8">
          <div className="max-w-[34ch]">
            <Link
              href="/"
              className="flex w-fit items-center gap-2.5 text-[18px] font-extrabold tracking-[-0.03em] text-white no-underline"
            >
              <Mark className="size-8" />
              {brand.wordmark}
            </Link>
            <p className="mt-3.5 text-[14px] leading-[1.6] text-white/50">
              {brand.tagline}
            </p>

            {/* nothing renders until a handle is filled in on `socials`. a row
                of icons that all point at nothing says the site is abandoned,
                which is the opposite of what a footer row of icons is for. */}
            {links.length > 0 && (
              <ul className="mt-5 flex items-center gap-2">
                {links.map((s) => (
                  <li key={s.name}>
                    <a
                      href={s.href as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={s.label}
                      className="flex size-9 items-center justify-center rounded-pill border border-white/15 bg-white/5 text-white/60 transition-colors hover:border-flame hover:text-flame"
                    >
                      <SocialIcon name={s.name} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {footerNav.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.16em] text-white/40">
                {group.heading}
              </p>
              {/* inline-block + py, not a bare inline link: an inline anchor's
                  box is the 17px of text, so the gap between two links was
                  space you could not tap. the rows are 37px tall now and the
                  gap shrinks to keep the group the same height. */}
              <ul className="mt-2.5 flex flex-col gap-0.5">
                {group.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="inline-block py-2.5 text-[14.5px] font-medium text-white/70 no-underline transition-colors hover:text-flame"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* the year is not computed. a footer that renders a new year at
            midnight on a statically built page is a footer that disagrees with
            the copy on the page above it until the next deploy. */}
        <p className="mt-10 border-t border-white/10 pt-6 text-center text-[12.5px] text-white/40">
          © 2026 {brand.wordmark}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
