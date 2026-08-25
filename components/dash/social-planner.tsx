"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cancelPost, reschedulePost, type PostState } from "@/app/(dash)/social/actions";
import { useActionState } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { Submit } from "@/components/dash/form";
import { PostList, ZonePicker, onSchedule, postAt } from "@/components/dash/post-queue";
import { Panel, Pill } from "@/components/dash/ui";
import { useMounted } from "@/components/dash/stamp";
import type { SocialPost } from "@/lib/autopost/server";
import { PLATFORM_LABEL, type Platform } from "@/lib/deals";
import {
  browserZone,
  dayKeyInZone,
  formatInZone,
  instantToWallClock,
  wallClockToInstant,
} from "@/lib/tz";

/**
 * The planning calendar: every deal's schedule on one grid.
 *
 * The per-deal Posting tab is where a post is made and where its full editor
 * lives; this page is where a week of posting across four brands is read and
 * rearranged. Three views over one list of rows: the queue (what is coming,
 * soonest first), a week with time-of-day rows, a month of compact days.
 *
 * A drop on either grid moves a scheduled post's slot through Upload-Post's
 * own edit endpoint, so the job keeps its id and a failed call moves nothing.
 * Everything else a card offers is a link back to the deal's own tab, because
 * the composer needs to know which brand it is posting for and this page
 * deliberately holds all of them.
 */

/** Same key the per-deal tab writes, so both surfaces read one clock. */
const ZONE_KEY = "ugcf_posting_zone";

function storedZone(): string | null {
  try {
    return window.localStorage.getItem(ZONE_KEY);
  } catch {
    return null;
  }
}

export type PlannerDeal = {
  id: string;
  name: string;
  brand: string;
  /** resolved by the page, "" when the brand has no mark. */
  logo: string;
};

type View = "queue" | "week" | "month";

/* ------------------------------------------------------------- day-key math */
/* Day keys ("2026-08-13") are wall-clock days in the chosen zone. Arithmetic
   on them rides UTC noon so a DST hop can never move the date under it. */

function shiftDays(dayKey: string, by: number): string {
  const at = new Date(`${dayKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + by);
  return at.toISOString().slice(0, 10);
}

/** Sunday of the week a day key falls in. */
function weekStartOf(dayKey: string): string {
  const at = new Date(`${dayKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() - at.getUTCDay());
  return at.toISOString().slice(0, 10);
}

function shiftMonths(monthKey: string, by: number): string {
  const at = new Date(`${monthKey}-01T12:00:00Z`);
  at.setUTCMonth(at.getUTCMonth() + by);
  return at.toISOString().slice(0, 7);
}

function monthLabel(monthKey: string): string {
  return new Date(`${monthKey}-01T12:00:00Z`).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "sun 10" header bits for a day key. */
function dayName(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00Z`)
    .toLocaleString(undefined, { weekday: "short", timeZone: "UTC" })
    .toLowerCase();
}

/* ----------------------------------------------------------------- statuses */

const cardAccent: Record<SocialPost["status"], string> = {
  scheduled: "border-flame/40 bg-ember/50",
  processing: "border-flame/40 bg-ember/50",
  posted: "border-line bg-paper",
  partial: "border-line bg-paper",
  failed: "border-flame-dark/50 bg-paper",
  canceled: "border-line bg-shell", // never drawn, onSchedule drops it
};

const statusWord: Record<SocialPost["status"], string> = {
  scheduled: "scheduled",
  processing: "posting",
  posted: "posted",
  partial: "partly posted",
  failed: "failed",
  canceled: "canceled",
};

const statusTone: Record<SocialPost["status"], "flame" | "ink" | "quiet" | "line"> = {
  posted: "flame",
  scheduled: "ink",
  processing: "ink",
  partial: "line",
  failed: "line",
  canceled: "quiet",
};

/** Minutes into its wall-clock day, in the chosen zone. */
function minuteOfDay(iso: string, zone: string): number {
  const wall = instantToWallClock(new Date(iso), zone);
  return Number(wall.slice(11, 13)) * 60 + Number(wall.slice(14, 16));
}

const HOUR_H = 44; // px per hour in the week grid
const CARD_H = 42; // px a week card occupies, for the collision push-down

/* ------------------------------------------------------------------ planner */

export function SocialPlanner({
  posts,
  deals,
}: {
  posts: SocialPost[];
  deals: PlannerDeal[];
}) {
  const router = useRouter();
  const mounted = useMounted();

  // one clock for the whole page, same bargain as the per-deal tab: first
  // paint is UTC on both sides of the wire, the post-mount paint is real.
  const [chosenZone, setChosenZone] = useState<string | null>(null);
  const zone = chosenZone ?? (mounted ? (storedZone() ?? browserZone()) : "UTC");
  const pickZone = (next: string) => {
    setChosenZone(next);
    try {
      window.localStorage.setItem(ZONE_KEY, next);
    } catch {
      // private mode. the pick still holds for this visit.
    }
  };

  const [view, setView] = useState<View>("week");

  const today = dayKeyInZone(new Date().toISOString(), zone);
  const [weekPick, setWeekPick] = useState<string | null>(null);
  const week = weekPick ?? weekStartOf(today);
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const month = monthPick ?? today.slice(0, 7);

  /**
   * Optimistic moves: post id → the ISO instant it was just dropped on. The
   * card sits on its new slot while the server call runs; a refusal deletes
   * the entry and the card snaps back. A success leaves it, and the next
   * server render arrives with the row already matching.
   */
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [note, setNote] = useState<PostState>({});
  const [, startMove] = useTransition();

  const effective = useMemo(
    () =>
      posts.map((p) => (moves[p.id] ? { ...p, scheduled_for: moves[p.id] } : p)),
    [posts, moves]
  );

  const dealNames = useMemo(
    () => Object.fromEntries(deals.map((d) => [d.id, d.brand])),
    [deals]
  );

  const [peek, setPeek] = useState<SocialPost | null>(null);
  const [composeAt, setComposeAt] = useState<string | null>(null); // wall clock

  /** A slot was pressed: one deal goes straight to its composer, several ask. */
  const compose = (wallClock: string) => {
    if (deals.length === 0) return;
    if (deals.length === 1) {
      router.push(`/deals/${deals[0].id}/posting?at=${encodeURIComponent(wallClock)}`);
      return;
    }
    setComposeAt(wallClock);
  };

  /** A card landed on a new slot. */
  const drop = (post: SocialPost, wallClock: string) => {
    if (post.status !== "scheduled") return;
    const instant = wallClockToInstant(wallClock, zone);
    if (!instant) return;
    if (instant.getTime() < Date.now() + 5 * 60_000) {
      setNote({ error: "that slot is in the past. five minutes out is the floor." });
      return;
    }
    const iso = instant.toISOString();
    setMoves((was) => ({ ...was, [post.id]: iso }));
    setNote({});
    startMove(async () => {
      const result = await reschedulePost(post.id, iso).catch(() => ({
        error: "could not reach the posting service. the post kept its old slot.",
      }));
      if (result.error) {
        setMoves((was) => {
          const next = { ...was };
          delete next[post.id];
          return next;
        });
      }
      setNote(result);
    });
  };

  const queueRows = effective
    .filter((p) => ["scheduled", "processing", "failed"].includes(p.status))
    .sort((a, b) => postAt(a).localeCompare(postAt(b)));

  const label =
    view === "month"
      ? monthLabel(month)
      : `${formatInZone(`${week}T12:00:00Z`, "UTC", "day")} to ${formatInZone(
          `${shiftDays(week, 6)}T12:00:00Z`,
          "UTC",
          "day"
        )}`;

  const step = (by: number) => {
    if (view === "month") setMonthPick(shiftMonths(month, by));
    else setWeekPick(shiftDays(week, by * 7));
  };
  const toToday = () => {
    setWeekPick(weekStartOf(today));
    setMonthPick(today.slice(0, 7));
  };
  const onToday = view === "month" ? month === today.slice(0, 7) : week === weekStartOf(today);

  return (
    <Panel
      padded={false}
      flush
      className="min-h-0 flex-1"
      scroll
      title="Schedule"
      action={mounted ? <ZonePicker zone={zone} onChange={pickZone} /> : null}
      toolbar={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex rounded-pill bg-shell p-0.5">
            {(
              [
                { value: "queue", label: "Queue" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ] as { value: View; label: string }[]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setView(option.value)}
                className={`h-7 rounded-pill px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-flame ${
                  view === option.value
                    ? "bg-paper text-ink shadow-sm"
                    : "text-ink-50 hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {view !== "queue" && (
            <>
              <div className="flex items-center gap-1">
                {[
                  { glyph: "‹", by: -1, name: view === "month" ? "previous month" : "previous week" },
                  { glyph: "›", by: 1, name: view === "month" ? "next month" : "next week" },
                ].map((nav) => (
                  <button
                    key={nav.name}
                    type="button"
                    aria-label={nav.name}
                    onClick={() => step(nav.by)}
                    className="grid size-7 place-items-center rounded-pill border border-line text-[14px] text-ink-50 transition-colors hover:border-flame/45 hover:text-flame"
                  >
                    {nav.glyph}
                  </button>
                ))}
              </div>
              <p className="text-[13.5px] font-bold tracking-[-0.015em]">{label}</p>
              {!onToday && (
                <button
                  type="button"
                  onClick={toToday}
                  className="text-[12.5px] font-semibold text-flame hover:text-flame-dark"
                >
                  today
                </button>
              )}
            </>
          )}

          {(note.error || note.ok) && (
            <span
              className={`min-w-0 truncate text-[12.5px] font-semibold ${
                note.error ? "text-flame-dark" : "text-ink-50"
              }`}
            >
              {note.error ?? note.ok}
            </span>
          )}
        </div>
      }
    >
      {view === "queue" && (
        <PostList
          posts={queueRows}
          zone={zone}
          dealNames={dealNames}
          empty={
            deals.length === 0
              ? "Nothing to plan yet. Add a deal and its accounts first."
              : "Nothing waiting. Press a slot on the week or month view to book one."
          }
        />
      )}

      {view === "week" && (
        <WeekGrid
          posts={effective}
          zone={zone}
          weekStart={week}
          today={today}
          mounted={mounted}
          onPeek={setPeek}
          onSlot={compose}
          onDrop={drop}
        />
      )}

      {view === "month" && (
        <MonthGrid
          posts={effective}
          zone={zone}
          month={month}
          today={today}
          onPeek={setPeek}
          onSlot={compose}
          onDrop={drop}
        />
      )}

      {peek && (
        <PostPeek
          post={effective.find((p) => p.id === peek.id) ?? peek}
          zone={zone}
          dealName={peek.deal_id ? (dealNames[peek.deal_id] ?? null) : null}
          onClose={() => setPeek(null)}
        />
      )}

      {composeAt && (
        <DealPickSheet
          deals={deals}
          wallClock={composeAt}
          zone={zone}
          onClose={() => setComposeAt(null)}
        />
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- week grid */

/**
 * Seven day columns against a time-of-day gutter, Metricool-shaped: a post
 * sits at its own hour, an empty stretch is a button for that slot, and a
 * scheduled card drags to any other slot. Drops snap to 15 minutes.
 */
function WeekGrid({
  posts,
  zone,
  weekStart,
  today,
  mounted,
  onPeek,
  onSlot,
  onDrop,
}: {
  posts: SocialPost[];
  zone: string;
  weekStart: string;
  today: string;
  mounted: boolean;
  onPeek: (post: SocialPost) => void;
  /** a pressed slot, as a wall clock in the chosen zone. */
  onSlot: (wallClock: string) => void;
  onDrop: (post: SocialPost, wallClock: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDays(weekStart, i));
  const frame = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);

  // open on the working part of the day rather than 12am.
  useEffect(() => {
    frame.current?.scrollTo({ top: 7.5 * HOUR_H });
  }, []);

  const byDay = new Map<string, SocialPost[]>();
  for (const post of posts.filter(onSchedule)) {
    const key = dayKeyInZone(postAt(post), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  /** y offset inside a day column → a snapped "HH:MM". */
  const timeAtY = (e: React.MouseEvent | React.DragEvent, el: HTMLElement): string => {
    const y = e.clientY - el.getBoundingClientRect().top;
    const minutes = Math.min(
      1425,
      Math.max(0, Math.round((y / HOUR_H) * 60 / 15) * 15)
    );
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const nowMinute = mounted ? minuteOfDay(new Date().toISOString(), zone) : null;

  return (
    <div className="overflow-x-auto px-5 pb-4 sm:px-6">
      <div className="min-w-[840px]">
        {/* day headers, over the gutter */}
        <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-b border-line pb-1.5">
          <span aria-hidden="true" />
          {days.map((day) => (
            <div key={day} className="flex items-baseline justify-center gap-1.5 px-1">
              <span className="text-[11.5px] lowercase text-ink-50">{dayName(day)}</span>
              <span
                className={`text-[13.5px] font-bold tabular-nums ${
                  day === today ? "text-flame" : "text-ink-70"
                }`}
              >
                {Number(day.slice(8))}
              </span>
            </div>
          ))}
        </div>

        <div ref={frame} className="max-h-[560px] overflow-y-auto">
          <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]">
            {/* the time gutter */}
            <div className="relative" style={{ height: 24 * HOUR_H }}>
              {Array.from({ length: 24 }, (_, h) => (
                <span
                  key={h}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-ink-50"
                  style={{ top: h * HOUR_H }}
                >
                  {h === 0 ? "" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                </span>
              ))}
            </div>

            {days.map((day) => {
              const rows = (byDay.get(day) ?? []).sort((a, b) =>
                postAt(a).localeCompare(postAt(b))
              );

              // exact tops, pushed down just enough that stacked cards stay
              // readable when two posts share a slot.
              let lastBottom = -1;
              const placed = rows.map((post) => {
                const exact = (minuteOfDay(postAt(post), zone) / 60) * HOUR_H;
                const top = Math.max(exact, lastBottom + 2);
                lastBottom = top + CARD_H;
                return { post, top };
              });

              return (
                <div
                  key={day}
                  className={`relative border-l border-line ${
                    day === today ? "bg-ember/25" : ""
                  }`}
                  style={{ height: 24 * HOUR_H }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const moved = byId.get(e.dataTransfer.getData("text/plain"));
                    if (moved) onDrop(moved, `${day}T${timeAtY(e, e.currentTarget)}`);
                  }}
                >
                  {/* hour lines double as the "book this slot" buttons */}
                  {Array.from({ length: 24 }, (_, h) => (
                    <button
                      key={h}
                      type="button"
                      aria-label={`schedule a post on ${day} around ${h}:00`}
                      onClick={(e) =>
                        onSlot(`${day}T${timeAtY(e, e.currentTarget.parentElement!)}`)
                      }
                      className="group absolute inset-x-0 border-t border-line/60 hover:bg-flame/[0.06]"
                      style={{ top: h * HOUR_H, height: HOUR_H }}
                    >
                      <span className="pointer-events-none absolute left-1.5 top-1 hidden text-[10.5px] font-semibold text-flame group-hover:block">
                        + schedule
                      </span>
                    </button>
                  ))}

                  {day === today && nowMinute !== null && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-flame"
                      style={{ top: (nowMinute / 60) * HOUR_H }}
                    />
                  )}

                  {placed.map(({ post, top }) => (
                    <WeekCard key={post.id} post={post} zone={zone} top={top} onPeek={onPeek} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeekCard({
  post,
  zone,
  top,
  onPeek,
}: {
  post: SocialPost;
  zone: string;
  top: number;
  onPeek: (post: SocialPost) => void;
}) {
  const movable = post.status === "scheduled";
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", post.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onPeek(post)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPeek(post);
        }
      }}
      title={post.caption || "no caption"}
      className={`absolute inset-x-1 z-20 rounded-[8px] border px-1.5 py-1 text-left shadow-sm transition-shadow hover:shadow-md ${
        cardAccent[post.status]
      } ${movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      style={{ top, height: CARD_H - 4 }}
    >
      <p className="flex items-center gap-1 text-[10.5px] font-bold tabular-nums leading-tight">
        {formatInZone(postAt(post), zone, "time").toLowerCase()}
        <span className="flex items-center gap-0.5 text-ink-50">
          {post.platforms.map((p) => (
            <PlatformGlyph key={p} platform={p as Platform} className="size-[10px]" />
          ))}
        </span>
        {post.status === "failed" && (
          <span className="font-semibold text-flame-dark">failed</span>
        )}
      </p>
      <p className="truncate text-[10.5px] leading-tight text-ink-50">
        {post.caption.slice(0, 60) || "no caption"}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- month grid */

/**
 * Six weeks of compact days. A drop here changes the date and keeps the
 * post's own time of day, because a month cell has no hours to aim at.
 */
function MonthGrid({
  posts,
  zone,
  month,
  today,
  onPeek,
  onSlot,
  onDrop,
}: {
  posts: SocialPost[];
  zone: string;
  month: string;
  today: string;
  onPeek: (post: SocialPost) => void;
  onSlot: (wallClock: string) => void;
  onDrop: (post: SocialPost, wallClock: string) => void;
}) {
  const gridStart = weekStartOf(`${month}-01`);
  const cells = Array.from({ length: 42 }, (_, i) => shiftDays(gridStart, i));
  const byId = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);

  const byDay = new Map<string, SocialPost[]>();
  for (const post of posts.filter(onSchedule)) {
    const key = dayKeyInZone(postAt(post), zone);
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }

  // the trailing week is only drawn when the month reaches into it.
  const weeks = cells[35].slice(0, 7) === month ? cells : cells.slice(0, 35);

  return (
    <div className="overflow-x-auto px-5 pb-4 sm:px-6">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 border-b border-line pb-1.5">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className="px-2 text-[11.5px] lowercase text-ink-50">
              {dayName(shiftDays(gridStart, i))}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {weeks.map((day) => {
            const inMonth = day.slice(0, 7) === month;
            const rows = (byDay.get(day) ?? []).sort((a, b) =>
              postAt(a).localeCompare(postAt(b))
            );

            return (
              <div
                key={day}
                className={`group/day relative min-h-[104px] border-b border-l border-line p-1.5 ${
                  day === today ? "bg-ember/40" : inMonth ? "" : "bg-shell/50"
                }`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const moved = byId.get(e.dataTransfer.getData("text/plain"));
                  if (!moved) return;
                  // same time of day, new date.
                  const time = instantToWallClock(new Date(postAt(moved)), zone).slice(11, 16);
                  onDrop(moved, `${day}T${time}`);
                }}
              >
                <div className="flex items-center justify-between px-0.5">
                  <span
                    className={`text-[12px] font-bold tabular-nums ${
                      day === today ? "text-flame" : inMonth ? "text-ink-70" : "text-ink-50/60"
                    }`}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {/* 10am, not midnight: a pressed day means "this day", and a
                      post booked for 00:00 reads as the night before. */}
                  <button
                    type="button"
                    aria-label={`schedule a post on ${day}`}
                    onClick={() => onSlot(`${day}T10:00`)}
                    className="hidden size-5 items-center justify-center rounded-full text-[13px] font-semibold text-flame hover:bg-ember group-hover/day:flex"
                  >
                    +
                  </button>
                </div>

                <div className="mt-1 space-y-1">
                  {rows.slice(0, 3).map((post) => (
                    <div
                      key={post.id}
                      role="button"
                      tabIndex={0}
                      draggable={post.status === "scheduled"}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", post.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onPeek(post)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPeek(post);
                        }
                      }}
                      title={post.caption || "no caption"}
                      className={`rounded-[6px] border px-1.5 py-1 ${cardAccent[post.status]} ${
                        post.status === "scheduled"
                          ? "cursor-grab active:cursor-grabbing"
                          : "cursor-pointer"
                      }`}
                    >
                      <p className="flex items-center gap-1 truncate text-[10.5px] leading-tight">
                        <span className="font-bold tabular-nums">
                          {formatInZone(postAt(post), zone, "time").toLowerCase()}
                        </span>
                        <span className="flex shrink-0 items-center gap-0.5 text-ink-50">
                          {post.platforms.map((p) => (
                            <PlatformGlyph
                              key={p}
                              platform={p as Platform}
                              className="size-[10px]"
                            />
                          ))}
                        </span>
                        <span className="truncate text-ink-50">
                          {post.caption.slice(0, 40) || "no caption"}
                        </span>
                      </p>
                    </div>
                  ))}
                  {rows.length > 3 && (
                    <p className="px-1 text-[10.5px] font-semibold text-ink-50">
                      +{rows.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the peek */

const EMPTY_STATE: PostState = {};

/**
 * A card, opened: the cut playing, the whole caption, where it goes and what
 * came back. Cancel is the one write it offers; the full editor (caption,
 * exact time) lives on the deal's own tab and the button here goes there.
 */
function PostPeek({
  post,
  zone,
  dealName,
  onClose,
}: {
  post: SocialPost;
  zone: string;
  dealName: string | null;
  onClose: () => void;
}) {
  const [cancelState, cancel] = useActionState(cancelPost, EMPTY_STATE);
  const links = post.results.filter((r) => r.success && r.url);
  const failures = post.results.filter((r) => !r.success && r.error);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="post details"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] overflow-hidden rounded-card border border-line bg-paper shadow-xl"
      >
        <div className="flex gap-3.5 p-4">
          <span className="aspect-[9/16] w-[72px] shrink-0 overflow-hidden rounded-[9px] bg-shell">
            <video
              src={`${post.video_url}#t=0.1`}
              muted
              playsInline
              controls
              preload="metadata"
              className="size-full object-cover"
            />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-bold tabular-nums">
                {formatInZone(postAt(post), zone)}
              </p>
              <Pill tone={statusTone[post.status]}>{statusWord[post.status]}</Pill>
            </div>

            {dealName && post.deal_id && (
              <Link
                href={`/deals/${post.deal_id}/posting`}
                className="mt-0.5 block truncate text-[12.5px] font-semibold text-ink-70 hover:text-flame"
              >
                {dealName}
              </Link>
            )}

            <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-[13px] leading-snug">
              {post.caption || "no caption"}
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-50">
              {post.platforms.map((p) => (
                <span key={p} className="flex items-center gap-1">
                  <PlatformGlyph platform={p as Platform} className="size-[12px]" />
                  {PLATFORM_LABEL[p as Platform] ?? p}
                </span>
              ))}
            </div>

            {links.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
                {links.map((r) => (
                  <a
                    key={r.platform}
                    href={r.url!}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-flame hover:text-flame-dark"
                  >
                    {PLATFORM_LABEL[r.platform as Platform] ?? r.platform} ↗
                  </a>
                ))}
              </div>
            )}

            {(cancelState.error || post.error || failures.length > 0) && (
              <p className="mt-1.5 text-[12px] font-semibold text-flame-dark">
                {cancelState.error ??
                  post.error ??
                  failures.map((f) => `${f.platform}: ${f.error}`).join(" · ")}
              </p>
            )}
            {cancelState.ok && (
              <p className="mt-1.5 text-[12px] font-semibold text-ink-50">{cancelState.ok}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-shell/40 px-4 py-2.5">
          {post.deal_id && (
            <Link
              href={`/deals/${post.deal_id}/posting`}
              className="flex h-8 items-center rounded-pill border border-line bg-paper px-3 text-[12.5px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
            >
              {post.status === "scheduled" ? "Edit on the deal" : "Open the deal"}
            </Link>
          )}
          {post.status === "scheduled" && (
            <form action={cancel}>
              <input type="hidden" name="post_id" value={post.id} />
              <Submit tone="ghost" size="xs" pendingLabel="…">
                Cancel post
              </Submit>
            </form>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- the deal picker */

/**
 * A slot was pressed and there is more than one brand to post for. The
 * composer is deal-scoped on purpose, so the press picks the deal and lands
 * on its Posting tab with the slot already in the schedule box.
 */
function DealPickSheet({
  deals,
  wallClock,
  zone,
  onClose,
}: {
  deals: PlannerDeal[];
  wallClock: string;
  zone: string;
  onClose: () => void;
}) {
  const instant = wallClockToInstant(wallClock, zone);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="pick the deal to post for"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] overflow-hidden rounded-card border border-line bg-paper shadow-xl"
      >
        <div className="border-b border-line px-4 py-3">
          <p className="text-[14px] font-bold tracking-[-0.015em]">Which brand is this for?</p>
          <p className="mt-0.5 text-[12.5px] text-ink-50">
            {instant ? `books the slot ${formatInZone(instant.toISOString(), zone)}` : wallClock}
          </p>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {deals.map((deal) => (
            <Link
              key={deal.id}
              href={`/deals/${deal.id}/posting?at=${encodeURIComponent(wallClock)}`}
              className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-ember/40"
            >
              <BrandMark name={deal.brand} logo={deal.logo} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold tracking-[-0.015em]">
                  {deal.brand}
                </span>
                <span className="block truncate text-[12px] text-ink-50">{deal.name}</span>
              </span>
              <span aria-hidden="true" className="text-ink-50">
                ›
              </span>
            </Link>
          ))}
        </div>

        <div className="flex justify-end border-t border-line bg-shell/40 px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-semibold text-ink-50 transition-colors hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
