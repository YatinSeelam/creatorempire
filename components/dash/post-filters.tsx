"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { PlatformGlyph } from "./platform-glyph";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@/lib/deals";

/**
 * Search and platform filters for the tracked posts table.
 *
 * All of it is url state (`?q=`, `?pf=`), so the rows stay a server render and
 * the bonus each one earned is never recomputed in the browser. This component
 * owns nothing except the text in the box between keystrokes.
 *
 * It builds its own url from its own props rather than reading the current
 * query, which is deliberate on two counts: the page number has to be dropped
 * every time a filter moves (filtering to four results while sat on page three
 * shows an empty table and reads as a bug), and doing it this way needs no
 * `useSearchParams`, so nothing here forces a suspense boundary.
 *
 * `replace` rather than `push`: typing four letters should not put four entries
 * in the back stack.
 */
export function PostFilters({
  query,
  platforms,
  counts,
}: {
  query: string;
  platforms: Platform[];
  /** cuts per platform, for the count on each mark. */
  counts: Record<Platform, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [text, setText] = useState(query);

  // the box is ahead of the url while a keystroke is still settling, so a prop
  // arriving mid-debounce must not reach in and rewrite what is being typed.
  // outside of that, the prop wins, which is what makes the back button work.
  const [typing, setTyping] = useState(false);
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    if (!typing) setText(query);
  }

  const go = (nextQuery: string, nextPlatforms: Platform[]) => {
    const params = new URLSearchParams();
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    if (nextPlatforms.length > 0) params.set("pf", nextPlatforms.join(","));
    const search = params.toString();
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    });
  };

  // `typing` is raised by the keystroke itself and only ever lowered from inside
  // the timer, so the effect never has to set state on its own behalf.
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => {
      setTyping(false);
      go(text, platforms);
    }, 250);
    return () => clearTimeout(timer);
    // go is rebuilt every render and the platforms it closes over are the ones
    // rendered alongside this text, which is exactly what should be sent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, typing]);

  const toggle = (platform: Platform) => {
    const next = platforms.includes(platform)
      ? platforms.filter((p) => p !== platform)
      : [...platforms, platform];
    go(text, next);
  };

  const dirty = text.length > 0 || platforms.length > 0;

  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[12px] border border-line bg-paper px-3.5 transition-colors focus-within:border-flame">
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-50"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setTyping(true);
          }}
          placeholder="Search posts..."
          aria-label="Search tracked posts"
          className="w-full bg-transparent text-[13.5px] placeholder:text-ink-50 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      {/* one bordered square per platform rather than three bare marks: the
          filters have to read as controls next to a field that is now a card,
          and a naked icon beside a bordered box reads as decoration. */}
      <div className="flex shrink-0 items-center gap-2">
        {PLATFORMS.map((platform) => {
          const on = platforms.includes(platform);
          const count = counts[platform] ?? 0;

          return (
            <button
              key={platform}
              type="button"
              onClick={() => toggle(platform)}
              disabled={count === 0 && !on}
              aria-pressed={on}
              title={`${count} on ${PLATFORM_LABEL[platform]}`}
              className={`grid size-10 place-items-center rounded-[12px] border transition-colors disabled:opacity-35 ${
                on
                  ? "border-flame/45 bg-ember"
                  : "border-line bg-paper hover:border-ink-50/40 disabled:hover:border-line"
              }`}
            >
              <span className="sr-only">{`${count} on ${PLATFORM_LABEL[platform]}`}</span>
              <PlatformGlyph
                platform={platform}
                tone={on || count > 0 ? "brand" : "current"}
                className={`size-[17px] ${on || count > 0 ? "" : "text-ink-50"}`}
              />
            </button>
          );
        })}
      </div>

      {dirty && (
        <>
          <span aria-hidden="true" className="h-6 w-px shrink-0 bg-line" />
          <button
            type="button"
            onClick={() => {
              setText("");
              setTyping(false);
              go("", []);
            }}
            className="h-10 shrink-0 rounded-[12px] border border-line bg-paper px-3.5 text-[13px] font-semibold text-ink-50 transition-colors hover:border-flame/45 hover:text-flame"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
