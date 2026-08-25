import Link from "next/link";
import { PlatformGlyph } from "./platform-glyph";
import { PLATFORMS, PLATFORM_LABEL, profileUrl, type Platform } from "@/lib/deals";

export type PlatformSlot = {
  platform: Platform;
  /** the account on this deal, or null when there is none. */
  handle: string | null;
  /** youtube only: a UC id links straight at the channel. */
  channelId?: string | null;
};

/**
 * A deal's platforms as marks and nothing else.
 *
 * This replaced a whole "Tracked accounts" panel with checkboxes, a brand column
 * and rollup figures. On a deal's own page every one of those columns said
 * the same thing twice: the brand is in the title, and a deal holds at most one
 * account per platform, so a table with a select-all box was answering a question
 * nobody had. What is actually being asked at a glance is "which of mine is
 * live", and colour answers it without a word.
 *
 * Live is the platform's own colour and links out to the account. Missing is
 * greyed out and goes to the deal's settings, where connecting happens. No
 * labels: the mark is the label, and the title attribute carries the name for
 * anyone hovering or using a reader.
 */
export function DealPlatformStrip({
  slots,
  editHref,
}: {
  slots: PlatformSlot[];
  /** where a greyed-out mark goes: the deal's own connect-accounts section. */
  editHref: string;
}) {
  const by = new Map(slots.map((s) => [s.platform, s] as const));

  return (
    <div className="flex shrink-0 items-center gap-1">
      {PLATFORMS.map((platform) => {
        const slot = by.get(platform);
        const label = PLATFORM_LABEL[platform];

        if (slot?.handle) {
          return (
            <a
              key={platform}
              href={profileUrl(platform, slot.handle, slot.channelId ?? null)}
              target="_blank"
              rel="noreferrer"
              title={`@${slot.handle} on ${label}`}
              className="grid size-9 place-items-center rounded-full transition-colors hover:bg-shell"
            >
              <span className="sr-only">{`@${slot.handle} on ${label}`}</span>
              <PlatformGlyph platform={platform} tone="brand" className="size-[21px]" />
            </a>
          );
        }

        return (
          <Link
            key={platform}
            href={editHref}
            title={`No ${label} account yet. Connect one.`}
            className="grid size-9 place-items-center rounded-full text-line transition-colors hover:bg-shell hover:text-ink-50"
          >
            <span className="sr-only">{`Connect a ${label} account`}</span>
            <PlatformGlyph platform={platform} className="size-[21px]" />
          </Link>
        );
      })}
    </div>
  );
}
