"use client";

import { useActionState, useState } from "react";
import {
  cancelPost,
  editPost,
  removePost,
  type PostState,
} from "@/app/(dash)/social/actions";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { Note, Submit } from "@/components/dash/form";
import { Pill } from "@/components/dash/ui";
import type { SocialPost } from "@/lib/autopost/server";
import { MAX_CAPTION, YOUTUBE_TITLE_MAX } from "@/lib/autopost/limits";
import { PLATFORM_LABEL, type Platform } from "@/lib/deals";
import {
  COMMON_ZONES,
  dayKeyInZone,
  formatInZone,
  instantToWallClock,
  wallClockToInstant,
  zoneLabel,
} from "@/lib/tz";


/**
 * The three ways of looking at one deal's posting, and the clock they are all
 * read in.
 *
 * Lifted out of `autopost-panel` because it had grown a composer, a connect
 * strip and a queue in one file, and the queue is the half that gained a
 * calendar. Everything here is presentation over `SocialPost[]` plus the two
 * writes a row can make (cancel a scheduled one, clear a finished one).
 *
 * **Every time on screen is rendered in the chosen zone, never the browser's.**
 * That is the whole reason `zone` is threaded through instead of read where it
 * is needed: a list showing New York times over a composer taking Berlin ones
 * is worse than either on its own.
 */

const statusTone: Record<SocialPost["status"], "flame" | "ink" | "quiet" | "line"> = {
  posted: "flame",
  scheduled: "ink",
  processing: "ink",
  partial: "line",
  failed: "line",
  canceled: "quiet",
};

const statusLabel: Record<SocialPost["status"], string> = {
  posted: "posted",
  scheduled: "scheduled",
  processing: "posting",
  partial: "partly posted",
  failed: "failed",
  canceled: "canceled",
};

/**
 * The dot on a calendar tile, one entry per status.
 *
 * A map rather than the nested ternary this was: that one had no `canceled`
 * branch, so a pulled post fell through to `bg-flame` and sat on the grid
 * looking exactly like one still due. A record cannot fall through — a new
 * status is a type error here rather than a post that lies about itself.
 */
const calendarDot: Record<SocialPost["status"], string> = {
  scheduled: "bg-flame",
  processing: "bg-flame",
  posted: "bg-live",
  partial: "bg-live",
  failed: "bg-flame-dark",
  // never reaches the grid, `CalendarWeek` drops it. here so the record is total.
  canceled: "bg-ink/25",
};

/** The instant a row belongs at: when it is due, or when it was sent. */
export function postAt(post: SocialPost): string {
  return post.scheduled_for ?? post.created_at;
}

/**
 * Is this post still part of the schedule?
 *
 * The one place that question is answered. The queue and the calendar are two
 * views of one schedule and they used to decide separately what belonged on
 * them, which is how cancelling a post took it out of the queue and left it
 * sitting on the calendar. Both read this now.
 */
export function onSchedule(post: SocialPost): boolean {
  return post.status !== "canceled";
}

/* --------------------------------------------------------------- zone picker */

/**
 * Which clock the whole tab is in.
 *
 * A plain select rather than a searchable list of all 400 IANA names: a creator
 * schedules against an audience and the audience is in a handful of places.
 * The browser's own zone is pushed onto the front, so somebody in a city that
 * is not on the list still sees theirs and never has to open this at all.
 */
export function ZonePicker({
  zone,
  onChange,
  disabled = false,
}: {
  zone: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const options = COMMON_ZONES.includes(zone as (typeof COMMON_ZONES)[number])
    ? [...COMMON_ZONES]
    : [zone, ...COMMON_ZONES];

  return (
    <label className="flex min-w-0 items-center gap-1.5 rounded-pill border border-line bg-shell px-3 py-1 text-[12.5px] text-ink-50 focus-within:border-flame">
      <span className="shrink-0">times in</span>
      <select
        value={zone}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="the time zone every time on this tab is shown in"
        className="min-w-0 max-w-[168px] cursor-pointer truncate bg-transparent font-semibold text-ink-70 focus:outline-none disabled:opacity-60"
      >
        {options.map((z) => (
          <option key={z} value={z}>
            {zoneLabel(z)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ----------------------------------------------------------------- one post */

/**
 * A cut in the list: the frame, what it says, where it is going and when.
 *
 * The poster frame is the stored video with `preload="metadata"`, so the browser
 * pulls a few kilobytes of container rather than the file. It earns that: a
 * queue of captions is unreadable at a glance and a queue of thumbnails is the
 * thing somebody is actually looking for.
 */
const EMPTY_STATE: PostState = {};

function PostRow({
  post,
  zone,
  onReuse,
  dealName,
}: {
  post: SocialPost;
  zone: string;
  onReuse?: (post: SocialPost) => void;
  /** the brand this row posts for, only when the list crosses deals. the
   *  per-deal queue leaves it off because the whole page is that brand. */
  dealName?: string | null;
}) {
  // cancelling talks to upload-post and can genuinely fail: their service being
  // down, or a job they no longer have. it used to swallow both and re-render
  // the row unchanged, so the button read as broken. whatever it has to say
  // lands on the row's own error line.
  const [cancelState, cancel] = useActionState(cancelPost, EMPTY_STATE);
  // shut by default. the row is a list row first, and a queue where every entry
  // is a form is a queue nobody can scan.
  const [editing, setEditing] = useState(false);

  const links = post.results.filter((r) => r.success && r.url);
  const failures = post.results.filter((r) => !r.success && r.error);
  // anything that already ran can run again. a scheduled post cannot: it has
  // not happened yet, and "again" before "once" is just a second post.
  const rerunnable = ["posted", "partial", "failed", "canceled"].includes(post.status);

  return (
    <div className="border-b border-line last:border-b-0">
      <div className="relative flex items-center gap-3.5 px-5 py-3.5 sm:px-6">
        <span className="aspect-[9/16] w-[38px] shrink-0 overflow-hidden rounded-[7px] bg-shell">
          <video
            src={`${post.video_url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold tracking-[-0.015em]">
            {post.caption.slice(0, 90) || "no caption"}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-ink-50">
            {post.platforms.map((p) => (
              <span key={p} title={PLATFORM_LABEL[p as Platform] ?? p} className="text-ink-50">
                <PlatformGlyph platform={p as Platform} className="size-[13px]" />
              </span>
            ))}
            <span aria-hidden="true">·</span>
            {/* the exact wall clock in the chosen zone, always. "in 3h" is a nice
                second sentence and a terrible only one: nobody lines a brand's
                calendar up against a countdown. */}
            <span className="tabular-nums">{formatInZone(postAt(post), zone)}</span>
            {dealName && post.deal_id && (
              <>
                <span aria-hidden="true">·</span>
                <a
                  href={`/deals/${post.deal_id}/posting`}
                  className="truncate font-semibold text-ink-70 hover:text-flame"
                >
                  {dealName}
                </a>
              </>
            )}
            {links.map((r) => (
              <span key={r.platform} className="flex items-center gap-1">
                <span aria-hidden="true">·</span>
                <a
                  href={r.url!}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-flame hover:text-flame-dark"
                >
                  {PLATFORM_LABEL[r.platform as Platform] ?? r.platform} ↗
                </a>
              </span>
            ))}
          </div>
          {(cancelState.error || post.error || failures.length > 0) && (
            <p className="mt-0.5 truncate text-[12.5px] text-flame-dark">
              {cancelState.error ??
                post.error ??
                failures.map((f) => `${f.platform}: ${f.error}`).join(" · ")}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Pill tone={statusTone[post.status]}>{statusLabel[post.status]}</Pill>

          {/* the failed case is what this was built for: the cut, the caption and
              the platforms are all still on the row, and the only thing on offer
              used to be Clear — throw the whole post away and type it in again.
              It does not resend on press; it fills the composer in, because a
              published post is not something to fire off a list row without
              reading it. */}
          {rerunnable && onReuse && (
            <button
              type="button"
              onClick={() => onReuse(post)}
              className="flex h-8 items-center rounded-pill border border-line px-3 text-[12.5px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
            >
              {post.status === "failed"
                ? "Try again"
                : post.status === "canceled"
                  ? "Send it"
                  : "Send again"}
            </button>
          )}

          {/* only while it is still waiting. a post already on its way out has
              nothing left to change, and the row's own status says so. */}
          {post.status === "scheduled" && (
            <button
              type="button"
              onClick={() => setEditing((was) => !was)}
              aria-expanded={editing}
              className={`flex h-8 items-center rounded-pill border px-3 text-[12.5px] font-semibold transition-colors ${
                editing
                  ? "border-flame/45 bg-ember text-flame-dark"
                  : "border-line text-ink-70 hover:border-flame/45 hover:text-flame"
              }`}
            >
              {editing ? "Close" : "Edit"}
            </button>
          )}

          {post.status === "scheduled" && (
            <form action={cancel}>
              <input type="hidden" name="post_id" value={post.id} />
              <Submit tone="ghost" size="xs" pendingLabel="…">
                Cancel
              </Submit>
            </form>
          )}
          {rerunnable && (
            <form action={removePost}>
              <input type="hidden" name="post_id" value={post.id} />
              <Submit tone="ghost" size="xs" pendingLabel="…">
                Clear
              </Submit>
            </form>
          )}
        </div>
      </div>

      {/* not keyed on the row: a save re-renders this list with the new caption,
          and remounting on that would take the "Saved." line away in the same
          frame it was earned. The box already holds what was just sent. */}
      {editing && post.status === "scheduled" && (
        <PostEditor post={post} zone={zone} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- the editor */

/** What the file is called, for somebody checking they queued the right cut.
 *  A Drive download url has no filename in it, so that one answers with the
 *  host instead of pretending. */
function cutName(url: string): string {
  try {
    const at = new URL(url);
    const last = decodeURIComponent(at.pathname.split("/").pop() ?? "");
    return /\.(mp4|mov|m4v|webm)$/i.test(last) ? last : at.hostname.replace(/^www\./, "");
  } catch {
    return "the cut";
  }
}

/**
 * The row, opened up: the cut playing, the whole caption, and the slot.
 *
 * The two things this exists for are a caption typo caught before it goes out
 * and "which video is that, actually" — a 38px poster frame answers the second
 * one badly, so the editor plays the real file with controls on and names it.
 *
 * The cut and the platform list are read only here, and that is upstream's
 * shape rather than a choice: Upload-Post's edit endpoint takes the time and
 * the words and nothing else. Changing either of the others is a different
 * post, so the row's own Cancel plus the composer is the path, and it fills
 * itself in from this row.
 */
function PostEditor({
  post,
  zone,
  onClose,
}: {
  post: SocialPost;
  zone: string;
  onClose: () => void;
}) {
  const [state, save] = useActionState(editPost, EMPTY_STATE);
  const [caption, setCaption] = useState(post.caption);
  /**
   * null until the box is touched, which is what lets an untouched time follow
   * the zone picker on the header above. Holding the wall clock in state from
   * the first render would freeze it in whichever zone happened to be resolved
   * at mount, and the row would then read 6:30pm under a label saying Berlin.
   */
  const [when, setWhen] = useState<string | null>(null);
  const shown =
    when ?? (post.scheduled_for ? instantToWallClock(new Date(post.scheduled_for), zone) : "");

  const picked = when === null ? null : wallClockToInstant(shown, zone);
  // untouched sends nothing and the server keeps the slot it has.
  const scheduleIso = when === null ? "" : (picked?.toISOString() ?? "");
  const badTime = when !== null && !picked;

  // the one edit their patch endpoint cannot carry, so it is done by pulling the
  // job and booking a new one. worth a line: the slot is kept but the post is
  // genuinely re-made, and that is why saving it takes a beat longer.
  const resends =
    caption.trim() !== post.caption &&
    post.platforms.includes("youtube") &&
    caption.trim().length > YOUTUBE_TITLE_MAX;

  return (
    <form action={save} className="grid gap-4 border-t border-line bg-shell/40 px-5 py-4 sm:grid-cols-[124px_1fr] sm:px-6">
      <input type="hidden" name="post_id" value={post.id} />
      <input type="hidden" name="scheduled_iso" value={scheduleIso} />

      <div className="flex flex-col gap-1.5">
        {/* controls on, unlike every other frame on this page: this is the one
            place somebody is checking WHICH cut rather than that there is one. */}
        <video
          src={`${post.video_url}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full rounded-[12px] bg-ink/[0.04] object-contain"
        />
        <p className="truncate text-[11px] text-ink-50" title={post.video_url}>
          {cutName(post.video_url)}
        </p>
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-ink-50">Caption</span>
            <span className="text-[11.5px] tabular-nums text-ink-50">
              {caption.length} / {MAX_CAPTION}
            </span>
          </div>
          <textarea
            name="caption"
            rows={4}
            maxLength={MAX_CAPTION}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="mt-1 w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[13.5px] font-medium focus:border-flame focus:outline-none"
          />
          {resends && (
            <p className="mt-1 text-[11.5px] text-ink-50">
              youtube caps its title at {YOUTUBE_TITLE_MAX}, so this one gets pulled and
              re-sent to the same slot rather than patched in place.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex w-[196px] shrink-0 items-center rounded-pill border border-line bg-paper px-3 focus-within:border-flame">
            <input
              type="datetime-local"
              value={shown}
              onChange={(e) => setWhen(e.target.value)}
              aria-label="when this post fires"
              className="w-full bg-transparent py-1.5 text-[13px] font-medium focus:outline-none"
            />
          </div>
          <span className="text-[12px] text-ink-50">{zoneLabel(zone)}</span>

          <span className="h-5 w-px bg-line" aria-hidden="true" />

          {/* read only, and labelled as such below. a checkbox here would be a
              promise the edit endpoint does not keep. */}
          <span className="flex items-center gap-1.5 text-ink-50">
            {post.platforms.map((p) => (
              <span key={p} title={PLATFORM_LABEL[p as Platform] ?? p}>
                <PlatformGlyph platform={p as Platform} className="size-[14px]" />
              </span>
            ))}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Submit size="sm" pendingLabel="Saving" disabled={!caption.trim() || badTime}>
            Save
          </Submit>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
          >
            Close
          </button>
          <span className="min-w-0 text-[12.5px] text-ink-50">
            {badTime ? (
              <span className="font-semibold text-flame-dark">that time did not read</span>
            ) : (
              "to change the cut or where it goes, cancel it and send it again"
            )}
          </span>
          <Note state={state} />
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ the list */

/**
 * The queue and the posted list are the same list with a different filter, so
 * they are the same component. Rows are grouped under the day they fall on IN
 * the chosen zone, which is the only grouping that survives a zone change: a
 * 1am post moves to the previous day when you switch to a zone behind you, and
 * the header it sits under has to move with it.
 */
export function PostList({
  posts,
  zone,
  empty,
  onReuse,
  dealNames,
}: {
  posts: SocialPost[];
  zone: string;
  empty: string;
  onReuse?: (post: SocialPost) => void;
  /** deal id → brand name, for a list that crosses deals. */
  dealNames?: Record<string, string>;
}) {
  if (posts.length === 0) {
    return <p className="px-5 pb-5 text-[13px] text-ink-50 sm:px-6">{empty}</p>;
  }

  const today = dayKeyInZone(new Date().toISOString(), zone);
  const days: { key: string; posts: SocialPost[] }[] = [];
  for (const post of posts) {
    const key = dayKeyInZone(postAt(post), zone);
    const last = days[days.length - 1];
    if (last?.key === key) last.posts.push(post);
    else days.push({ key, posts: [post] });
  }

  return (
    <>
      {days.map((day) => (
        <div key={day.key}>
          <p className="px-5 pb-1.5 pt-3 text-[12.5px] font-semibold text-ink-50 sm:px-6">
            {day.key === today && <span className="text-flame">today · </span>}
            {formatInZone(`${day.key}T12:00:00Z`, "UTC", "day")}
          </p>
          {day.posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              zone={zone}
              onReuse={onReuse}
              dealName={post.deal_id ? dealNames?.[post.deal_id] : null}
            />
          ))}
        </div>
      ))}
    </>
  );
}

/* -------------------------------------------------------------- the calendar */

/** Sunday of the week a day key falls in, as a day key. */
function weekStartOf(dayKey: string): string {
  const at = new Date(`${dayKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() - at.getUTCDay());
  return at.toISOString().slice(0, 10);
}

function shiftDays(dayKey: string, by: number): string {
  const at = new Date(`${dayKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
}

/**
 * One week, seven columns, the scheduled cuts sitting on the day they fire.
 *
 * There is no slot system behind this and it does not pretend there is: a day
 * is a column with the posts already on it and a button that opens the composer
 * pointed at that day. A grid of empty "slots" would be a promise about
 * recurring posting times that nothing in the schema keeps.
 *
 * Every day boundary is computed in the chosen zone, so switching zones can and
 * does move a late-night post into the day before. That is correct: the column
 * is a wall-clock day, and the whole point of the picker is to say whose.
 *
 * A canceled post is dropped here rather than by the caller. The grid is the
 * answer to "what is happening this week", and something pulled before it fired
 * is not happening — it came out of the queue and stayed on the calendar for
 * exactly as long as this filter did not exist. Filtering inside means every
 * caller gets it, including the next one.
 */
export function CalendarWeek({
  posts,
  zone,
  weekStart,
  onWeek,
  onPickDay,
}: {
  posts: SocialPost[];
  zone: string;
  /** sunday of the week on show, as "2026-08-09". */
  weekStart: string;
  onWeek: (start: string) => void;
  /** open the composer on this day. */
  onPickDay: (dayKey: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(weekStart, i));
  const today = dayKeyInZone(new Date().toISOString(), zone);
  const thisWeek = weekStartOf(today) === weekStart;

  const byDay = new Map<string, SocialPost[]>();
  for (const post of posts.filter(onSchedule)) {
    const key = dayKeyInZone(postAt(post), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  const span = `${formatInZone(`${days[0]}T12:00:00Z`, "UTC", "day")} to ${formatInZone(
    `${days[6]}T12:00:00Z`,
    "UTC",
    "day"
  )}`;

  return (
    <div className="px-5 pb-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <div className="flex items-center gap-1">
          {[
            { label: "‹", to: shiftDays(weekStart, -7), name: "previous week" },
            { label: "›", to: shiftDays(weekStart, 7), name: "next week" },
          ].map((nav) => (
            <button
              key={nav.name}
              type="button"
              aria-label={nav.name}
              onClick={() => onWeek(nav.to)}
              className="grid size-7 place-items-center rounded-pill border border-line text-[14px] text-ink-50 transition-colors hover:border-flame/45 hover:text-flame"
            >
              {nav.label}
            </button>
          ))}
        </div>
        <p className="text-[13.5px] font-bold tracking-[-0.015em]">
          {span}
          {thisWeek && <span className="ml-2 font-medium text-ink-50">this week</span>}
        </p>
        {!thisWeek && (
          <button
            type="button"
            onClick={() => onWeek(weekStartOf(today))}
            className="text-[12.5px] font-semibold text-flame hover:text-flame-dark"
          >
            back to this week
          </button>
        )}
      </div>

      {/* seven columns on a desktop, and a scrolling strip under it rather than
          a 7-wide grid crushed into a phone. a calendar that reflows to one
          column per row is a list with extra steps. */}
      <div className="-mx-1 grid grid-cols-7 gap-1.5 overflow-x-auto px-1 max-lg:w-[720px]">
        {days.map((day) => {
          const rows = byDay.get(day) ?? [];
          const isToday = day === today;

          return (
            <div
              key={day}
              className={`flex min-h-[168px] flex-col rounded-[12px] border p-2 ${
                isToday ? "border-flame/45 bg-ember/40" : "border-line bg-shell/50"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1 px-0.5">
                <span className="text-[11.5px] lowercase text-ink-50">
                  {formatInZone(`${day}T12:00:00Z`, "UTC", "day").split(",")[0]}
                </span>
                <span
                  className={`text-[13px] font-bold tabular-nums ${
                    isToday ? "text-flame" : "text-ink-70"
                  }`}
                >
                  {Number(day.slice(8))}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onPickDay(day)}
                className="mt-1.5 rounded-[8px] border border-dashed border-line py-1 text-[11.5px] font-semibold text-ink-50 transition-colors hover:border-flame hover:text-flame"
              >
                + schedule
              </button>

              <div className="mt-1.5 flex flex-col gap-1.5">
                {rows.map((post) => (
                  <div
                    key={post.id}
                    className="rounded-[8px] border border-line bg-paper p-1.5"
                    title={post.caption}
                  >
                    <p className="flex items-center gap-1 text-[11.5px] font-bold tabular-nums">
                      {formatInZone(postAt(post), zone, "time")}
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${calendarDot[post.status]}`}
                        aria-hidden="true"
                      />
                    </p>
                    <p className="truncate text-[10.5px] text-ink-50">
                      {post.caption.slice(0, 40) || "no caption"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The day key a composer should open on when a calendar day is pressed. */
export function dayToWallClock(dayKey: string, hour = 10): string {
  return `${dayKey}T${String(hour).padStart(2, "0")}:00`;
}

/** This week's sunday, for the calendar's opening position. */
export function currentWeekStart(zone: string): string {
  return weekStartOf(dayKeyInZone(new Date().toISOString(), zone) || "1970-01-01");
}
