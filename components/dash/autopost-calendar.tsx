"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipThumb } from "@/components/dash/clip-thumb";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import {
  addDays,
  dayKey,
  DOW,
  fmtHour,
  fmtMinutes,
  GRID,
  GRID_HEIGHT,
  isLive,
  startOfMonth,
  startOfWeek,
  type ScheduledPost,
} from "@/lib/autopost/plan";

/**
 * The schedule, drawn. Week is the working view and month is the overview.
 *
 * Presentational: it owns the anchor, the view, the drag in flight and the
 * moves the server has not confirmed yet. Moving a post is `onMove`, and the
 * caller writes it and hands back a new `posts` array; until that arrives the
 * card is drawn where it was dropped (see `pending`).
 *
 * A day and a minute-from-midnight, never an instant, for the reason
 * `lib/autopost/plan.ts` opens with: dragging a post across a daylight saving
 * boundary must not quietly move it an hour. So week view drops report the
 * minute they landed on, and month view reports `null` because a cell only ever
 * changed the date.
 *
 * Terminal posts (posted, partial, failed, canceled) are history. They are not
 * draggable and they are drawn quietly, so the eye lands on what can still be
 * changed.
 *
 * The grid is drawn as quietly as it can be and still be a grid. An empty week
 * used to read as a spreadsheet: a full-strength hairline every half hour, a
 * heavy hour gutter, and nothing to say which column was today or where in the
 * day you were. The lines that carry meaning (the hour, the day boundary) are
 * the only ones left visible, the half-hour rows are still there as drop
 * targets but no longer drawn, and the things that DO carry meaning got louder
 * instead: today's column is tinted, the current time is a line across it, and
 * a week with nothing in it says so in words.
 */
export function AutopostCalendar({
  posts,
  today,
  onMove,
  onOpen,
  onMenu,
}: {
  posts: ScheduledPost[];
  today: Date;
  /** day is `YYYY-MM-DD`; min is minutes-from-midnight, or null in month view
   *  where only the date changed */
  onMove: (postId: string, day: string, min: number | null) => void;
  onOpen?: (post: ScheduledPost) => void;
  /** a right click on a card, reported in viewport coordinates so the caller
   *  can hang its menu off the cursor. every status answers it, including the
   *  terminal ones a click will not open. */
  onMenu?: (post: ScheduledPost, x: number, y: number) => void;
}) {
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today);
  const scrollBox = useRef<HTMLDivElement>(null);
  const week = view === "week";

  /**
   * Where a post has been dropped but the server has not answered yet.
   *
   * The caller writes the move and hands back a new `posts` array a round trip
   * later. Until then the card is drawn where it was dropped, not where the
   * last read put it, because a card that snaps back for half a second and
   * then jumps forward reads as "it did not take" every single time. An entry
   * is dropped the moment a new `posts` arrives: if the write landed the new
   * array agrees with it and nothing changes, and if it failed the card goes
   * home, which is the rollback.
   */
  const [pendingFor, setPendingFor] = useState<{
    base: ScheduledPost[];
    map: Map<string, { day: string; min: number }>;
  }>(() => ({ base: posts, map: new Map() }));
  // keyed on the array it was made against, so a fresh `posts` retires it with
  // no effect and no extra render: the overlay simply stops matching.
  const pending = pendingFor.base === posts ? pendingFor.map : null;
  const shownPosts = useMemo(
    () =>
      !pending || pending.size === 0
        ? posts
        : posts.map((p) => {
            const move = pending.get(p.id);
            return move ? { ...p, day: move.day, min: move.min } : p;
          }),
    [posts, pending]
  );

  /**
   * The drag, on pointer events rather than the html5 drag api.
   *
   * The native one has three things wrong with it here: the browser takes a
   * beat to decide a press is a drag, it paints its own translucent copy of
   * the card that nothing can style or snap, and there is no way to say where
   * the drop WOULD land before it lands. Pointer events start the moment the
   * pointer moves four pixels, the ghost is our card drawn on the slot it is
   * over, and a release on the same slot is a click.
   *
   * `elementFromPoint` finds the slot, so no column arithmetic has to know how
   * wide the grid happens to be: each day column and month cell carries a
   * `data-day`, and the minute comes from where in that column the pointer is.
   * Snapped to the half hour, and state only changes when the snapped slot
   * does, so moving within one slot costs no render at all.
   */
  const [drag, setDrag] = useState<{
    id: string;
    active: boolean;
    day: string | null;
    min: number | null;
  } | null>(null);
  const press = useRef<{ id: string; x: number; y: number; day: string; min: number } | null>(
    null
  );
  const suppressClick = useRef(false);

  /**
   * The current minute, for the now line.
   *
   * `today` is a prop precisely so nothing reads a clock during render: the
   * server and the first client paint have to agree, and a clock disagrees with
   * itself between them. The minute genuinely does move while somebody sits on
   * this page though, so it is read after mount and again every minute. Null
   * until then, which is what makes the first paint match the server's.
   *
   * The day is re-read with it rather than taken from `today`, so a tab left
   * open overnight moves the line to the new column instead of drawing it down
   * yesterday's.
   */
  const [now, setNow] = useState<{ key: string; min: number } | null>(null);
  useEffect(() => {
    const read = () => {
      const d = new Date();
      setNow({ key: dayKey(d), min: d.getHours() * 60 + d.getMinutes() });
    };
    read();
    const id = setInterval(read, 60_000);
    return () => clearInterval(id);
  }, []);

  /**
   * The earliest minute a post may land on `day`, or null if the day is gone.
   *
   * The past is not a place to put something: a drop behind the now line
   * would go straight to "that is too soon" from the server, so the grid
   * refuses it up front instead. Today clamps to the next half hour at least
   * five minutes out (the server's own lead), so dragging a card back toward
   * "now" stops AT now rather than bouncing. Null before the clock has been
   * read, which is the first paint, where nothing can be dragged yet anyway.
   */
  const earliestOn = useCallback(
    (day: string): number | null => {
      if (!now) return GRID.firstHour * 60;
      if (day < now.key) return null;
      if (day > now.key) return GRID.firstHour * 60;
      const lead = Math.ceil((now.min + 5) / 30) * 30;
      const floor = Math.max(GRID.firstHour * 60, lead);
      return floor > GRID.lastHour * 60 - 30 ? null : floor;
    },
    [now]
  );

  const slotAt = useCallback(
    (x: number, y: number): { day: string; min: number | null } | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
      if (!el) return null;
      const day = el.dataset.day ?? "";
      if (!day) return null;
      const floor = earliestOn(day);
      if (floor === null) return null;
      if (el.dataset.grid !== "week") return { day, min: null };
      const rect = el.getBoundingClientRect();
      const raw = GRID.firstHour * 60 + ((y - rect.top) / GRID.rowHeight) * 60;
      const snapped = Math.round(raw / 30) * 30;
      const min = Math.max(floor, Math.min(GRID.lastHour * 60 - 30, snapped));
      return { day, min };
    },
    [earliestOn]
  );

  const onCardPointerDown = (e: React.PointerEvent<HTMLElement>, p: ScheduledPost) => {
    if (!isLive(p.status) || e.button !== 0) return;
    press.current = { id: p.id, x: e.clientX, y: e.clientY, day: p.day, min: p.min };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCardPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const start = press.current;
    if (!start) return;
    const moved = Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y) > 4;
    if (!moved && !drag) return;
    const slot = slotAt(e.clientX, e.clientY);
    setDrag((prev) => {
      const next = {
        id: start.id,
        active: true,
        day: slot?.day ?? null,
        min: slot?.min ?? null,
      };
      return prev && prev.day === next.day && prev.min === next.min && prev.active
        ? prev
        : next;
    });
  };

  const onCardPointerUp = (e: React.PointerEvent<HTMLElement>, p: ScheduledPost) => {
    const start = press.current;
    press.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!start) return;
    if (!drag?.active) {
      // a press that never moved is a click, and the click handler takes it
      return;
    }
    suppressClick.current = true;
    setDrag(null);
    const slot = slotAt(e.clientX, e.clientY);
    if (!slot) return;
    // month cells carry no time, so the minute is left alone there — unless
    // that minute is already behind now on today, in which case it is lifted
    // to the floor and sent as a real minute rather than bounced by the server
    const floor = earliestOn(slot.day) ?? p.min;
    const lifted = slot.min === null && p.min < floor;
    const min = slot.min ?? (lifted ? floor : p.min);
    if (slot.day === p.day && min === p.min) return;
    setPendingFor((prev) => ({
      base: posts,
      map: new Map(prev.base === posts ? prev.map : []).set(p.id, { day: slot.day, min }),
    }));
    onMove(p.id, slot.day, lifted ? min : slot.min);
  };

  const onCardClick = (p: ScheduledPost) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen?.(p);
  };

  // month always draws 6 rows, lead-in and trailing days included, so the grid
  // never reflows height as the anchor moves.
  const days = useMemo(() => {
    if (week) {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = startOfMonth(anchor);
    const lead = first.getDay();
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
  }, [week, anchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();
    for (const post of shownPosts) {
      const list = map.get(post.day);
      if (list) list.push(post);
      else map.set(post.day, [post]);
    }
    for (const list of map.values()) list.sort((a, b) => a.min - b.min);
    return map;
  }, [shownPosts]);

  // how many of the drawn days actually hold something. an empty grid has to
  // say it is empty: ruled paper with nothing on it reads as a component that
  // failed to load, not as a week with nothing booked.
  const shown = useMemo(
    () => days.reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0),
    [days, byDay]
  );


  // The window runs to midnight, so opening at the top would show an empty
  // morning most weeks. Land half an hour above the earliest post on screen.
  useEffect(() => {
    const box = scrollBox.current;
    if (!week || !box) return;
    const shownDays = new Set(days.map(dayKey));
    const mins = posts.filter((p) => shownDays.has(p.day)).map((p) => p.min);
    const target = mins.length ? Math.min(...mins) / 60 - 0.5 : GRID.openAt;
    box.scrollTop = Math.max(0, (target - GRID.firstHour) * GRID.rowHeight);
    // on the view and the week, not on `posts`: a move used to re-scroll the
    // box on the refresh that followed it, which is the lurch that made every
    // drop feel like it had missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, days]);

  const label = week
    ? `${short(startOfWeek(anchor))} – ${short(addDays(startOfWeek(anchor), 6))}`
    : anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const step = (dir: number) =>
    setAnchor((a) =>
      week ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1)
    );

  const todayKey = dayKey(today);
  const hours = GRID.lastHour - GRID.firstHour;
  const nowTop = now ? ((now.min - GRID.firstHour * 60) / 60) * GRID.rowHeight : null;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-paper shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <div className="flex rounded-pill bg-shell p-1">
          {(["week", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-pill px-4 py-1.5 text-xs font-bold transition-colors ${
                view === v ? "bg-paper text-ink shadow-card" : "text-ink-50 hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-label={week ? "previous week" : "previous month"}
          onClick={() => step(-1)}
          className="rounded-pill border border-line p-1.5 text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
        >
          <Chevron dir="left" />
        </button>

        <span className="min-w-[150px] text-center text-base font-black">{label}</span>

        <button
          type="button"
          aria-label={week ? "next week" : "next month"}
          onClick={() => step(1)}
          className="rounded-pill border border-line p-1.5 text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
        >
          <Chevron dir="right" />
        </button>

        <button
          type="button"
          onClick={() => setAnchor(today)}
          className="rounded-pill border border-line px-3 py-1.5 text-xs font-bold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame"
        >
          today
        </button>

        <span className="ml-auto text-xs font-bold text-ink-50">drag a post to move it</span>
      </div>

      {shown === 0 && (
        <div className="border-b border-line bg-shell/50 px-4 py-3 text-center text-[13px] font-semibold text-ink-50">
          nothing scheduled {week ? "this week" : "this month"}. anything you queue up lands here.
        </div>
      )}

      {week ? (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 780 }}>
            <div className="flex border-b border-line">
              <div className="shrink-0" style={{ width: GRID.gutter }} />
              {days.map((d, i) => {
                const key = dayKey(d);
                const isToday = key === todayKey;
                return (
                  <div
                    key={key}
                    className={`flex-1 py-2.5 text-center ${
                      i === 0 ? "" : "border-l border-line/40"
                    } ${isToday ? "bg-ember/50" : ""}`}
                  >
                    <div
                      className={`text-xs font-bold ${isToday ? "text-flame" : "text-ink-50"}`}
                    >
                      {DOW[i]}
                    </div>
                    <div className="mt-0.5 text-lg font-black">
                      <span
                        className={`inline-block rounded-pill px-2 ${
                          isToday ? "bg-flame text-on-accent" : ""
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div ref={scrollBox} className="overflow-y-auto" style={{ maxHeight: 520 }}>
              <div className="flex" style={{ height: GRID_HEIGHT }}>
                {/* the gutter carries no rules of its own. the hour lines start
                    at the grid, so the labels read as annotation beside the
                    calendar rather than as a second column of it. */}
                <div className="shrink-0" style={{ width: GRID.gutter }}>
                  {Array.from({ length: hours }, (_, r) => (
                    <div
                      key={r}
                      className="flex items-center justify-end pr-3"
                      style={{ height: GRID.rowHeight }}
                    >
                      <span className="text-[10px] font-semibold text-ink-50">
                        {fmtHour(GRID.firstHour + r)}
                      </span>
                    </div>
                  ))}
                </div>

                {days.map((d) => {
                  const key = dayKey(d);
                  const list = byDay.get(key) ?? [];
                  const isToday = key === todayKey;
                  const ghost =
                    drag?.active && drag.day === key && drag.min !== null
                      ? shownPosts.find((p) => p.id === drag.id) ?? null
                      : null;
                  return (
                    <div
                      key={key}
                      data-day={key}
                      data-grid="week"
                      className={`relative flex-1 border-l border-line/40 ${
                        isToday ? "bg-ember/50" : ""
                      } ${drag?.active && drag.day === key ? "bg-ember/70" : ""}`}
                    >
                      {/* the rules. the half-hour one is drawn transparent rather
                          than removed, so a border-box row keeps the same height
                          whether its rule is visible or not and the grid arithmetic
                          above is untouched. */}
                      {Array.from({ length: hours * 2 }, (_, r) => (
                        <div
                          key={r}
                          className={`border-t ${
                            r % 2 === 0 ? "border-line/55" : "border-transparent"
                          }`}
                          style={{ height: GRID.rowHeight / 2 }}
                        />
                      ))}

                      {/* what has passed, shaded. a whole column for a day that
                          is over, and today down to the now line. pointer-events
                          off: it is paint, and the column under it still has to
                          answer elementFromPoint so the clamp in slotAt can say
                          "no" itself. */}
                      {now && key <= now.key && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-ink/[0.045]"
                          style={{
                            height:
                              key < now.key
                                ? GRID_HEIGHT
                                : Math.max(0, Math.min(GRID_HEIGHT, nowTop ?? 0)),
                          }}
                        />
                      )}

                      {/* where the drop will land, drawn as the card itself on
                          that slot. pointer-events off so it never sits between
                          the pointer and the column under it. */}
                      {ghost && drag && drag.min !== null && (
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute z-30 flex items-center gap-1.5 overflow-hidden rounded-lg border border-flame border-l-[3px] border-l-flame bg-paper p-1 shadow-lg"
                          style={{
                            top: ((drag.min - GRID.firstHour * 60) / 60) * GRID.rowHeight,
                            left: 3,
                            right: 3,
                            height: GRID.cardHeight,
                          }}
                        >
                          <CardThumb src={ghost.previewUrl} width={26} live />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1">
                              <span className="text-[9px] font-bold text-flame">
                                {fmtMinutes(drag.min)}
                              </span>
                              <Marks platforms={ghost.platforms} />
                            </span>
                            <span className="mt-0.5 block truncate text-[9px] leading-[1.2]">
                              {ghost.videoName || ghost.caption}
                            </span>
                          </span>
                        </div>
                      )}

                      {/* where in the day it is, on the day it is. pointer-events
                          off so it never eats a drop from the row under it. */}
                      {now &&
                        key === now.key &&
                        nowTop !== null &&
                        nowTop >= 0 &&
                        nowTop <= GRID_HEIGHT && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-x-0 z-20"
                            style={{ top: nowTop }}
                          >
                            <span className="absolute inset-x-0 top-0 block h-px bg-flame" />
                            <span className="absolute -top-[3px] left-0 block size-[7px] rounded-pill bg-flame" />
                          </div>
                        )}

                      {list.map((p) => {
                        const top = ((p.min - GRID.firstHour * 60) / 60) * GRID.rowHeight;
                        if (top < -20 || top > GRID_HEIGHT) return null;
                        // several posts in one hour would sit exactly on top of
                        // each other, so fan them a few pixels down and right
                        const same = list.filter(
                          (q) => Math.floor(q.min / 60) === Math.floor(p.min / 60)
                        );
                        const off = same.indexOf(p) * 5;
                        const live = isLive(p.status);
                        const t = tone(p.status);

                        return (
                          <button
                            key={p.id}
                            type="button"
                            onPointerDown={(e) => onCardPointerDown(e, p)}
                            onPointerMove={onCardPointerMove}
                            onPointerUp={(e) => onCardPointerUp(e, p)}
                            onPointerCancel={() => {
                              press.current = null;
                              setDrag(null);
                            }}
                            onContextMenu={(e) => {
                              if (!onMenu) return;
                              e.preventDefault();
                              press.current = null;
                              setDrag(null);
                              onMenu(p, e.clientX, e.clientY);
                            }}
                            onClick={() => onCardClick(p)}
                            title={[p.videoName, p.caption].filter(Boolean).join(" — ") || undefined}
                            className={`absolute flex touch-none select-none items-center gap-1.5 overflow-hidden rounded-lg border border-l-[3px] p-1 text-left shadow-card transition-opacity ${t.box} ${t.rail} ${
                              live ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                            } ${drag?.active && drag.id === p.id ? "opacity-35" : ""}`}
                            style={{
                              top: top + off,
                              left: 3 + off,
                              right: 3,
                              height: GRID.cardHeight,
                            }}
                          >
                            <CardThumb src={p.previewUrl} width={26} live={live} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1">
                                <span className={`text-[9px] font-bold ${t.text}`}>
                                  {fmtMinutes(p.min)}
                                </span>
                                <Marks platforms={p.platforms} />
                              </span>
                              <span
                                className={`mt-0.5 block truncate text-[9px] leading-[1.2] ${
                                  live ? "" : "text-ink-50"
                                }`}
                              >
                                {p.videoName || p.caption}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 660 }}>
            <div className="grid grid-cols-7">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="border-b border-line py-2 text-center text-xs font-bold text-ink-50"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {days.map((d, i) => {
                const key = dayKey(d);
                const out = d.getMonth() !== anchor.getMonth();
                const list = byDay.get(key) ?? [];
                const isToday = key === todayKey;
                const past = Boolean(now && key < now.key);
                return (
                  <div
                    key={key}
                    data-day={key}
                    className={`border-b border-line/60 p-1.5 ${
                      (i + 1) % 7 ? "border-r border-line/60" : ""
                    } ${
                      drag?.active && drag.day === key
                        ? "bg-ember ring-2 ring-inset ring-flame/60"
                        : isToday
                          ? "bg-ember/50"
                          : past
                            ? "bg-ink/[0.045]"
                            : out
                              ? "bg-shell/60"
                              : "bg-paper"
                    }`}
                    style={{ minHeight: 112 }}
                  >
                    <div className="mb-1 flex justify-end">
                      <span
                        className={`rounded-pill px-1.5 text-xs font-bold ${
                          isToday
                            ? "bg-flame text-on-accent"
                            : out
                              ? "text-ink-50/60"
                              : "text-ink-50"
                        }`}
                      >
                        {d.getDate()}
                      </span>
                    </div>

                    <div className="space-y-1">
                      {list.map((p) => {
                        const live = isLive(p.status);
                        const t = tone(p.status);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onPointerDown={(e) => onCardPointerDown(e, p)}
                            onPointerMove={onCardPointerMove}
                            onPointerUp={(e) => onCardPointerUp(e, p)}
                            onPointerCancel={() => {
                              press.current = null;
                              setDrag(null);
                            }}
                            onContextMenu={(e) => {
                              if (!onMenu) return;
                              e.preventDefault();
                              press.current = null;
                              setDrag(null);
                              onMenu(p, e.clientX, e.clientY);
                            }}
                            onClick={() => onCardClick(p)}
                            title={[p.videoName, p.caption].filter(Boolean).join(" — ") || undefined}
                            className={`flex w-full touch-none select-none items-center gap-1.5 rounded-lg border-l-[3px] p-1 text-left transition-opacity ${t.cell} ${t.rail} ${
                              live ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
                            } ${drag?.active && drag.id === p.id ? "opacity-35" : ""}`}
                          >
                            <CardThumb src={p.previewUrl} width={18} live={live} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1">
                                <span className={`text-[10px] font-bold ${t.text}`}>
                                  {fmtMinutes(p.min)}
                                </span>
                                <Marks platforms={p.platforms} />
                              </span>
                              <span
                                className={`block truncate text-[10px] leading-[1.3] ${
                                  live ? "" : "text-ink-50"
                                }`}
                              >
                                {p.videoName || p.caption}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * How a card is painted, by status.
 *
 * `posted` is the only terminal state that earns colour, because it is the one
 * anybody scans for. The failures borrow the sync warning's red rather than
 * introducing a second one, and canceled sinks into the shell.
 */
function tone(status: ScheduledPost["status"]): {
  box: string;
  cell: string;
  rail: string;
  text: string;
} {
  if (status === "posted") {
    return {
      box: "bg-live-soft border-live-line",
      cell: "bg-live-soft",
      rail: "border-l-live",
      text: "text-live",
    };
  }
  if (status === "failed" || status === "partial") {
    return {
      box: "bg-paper border-line",
      cell: "bg-shell",
      rail: "border-l-flame-dark",
      text: "text-flame-dark",
    };
  }
  if (status === "canceled") {
    // paused, not gone. dashed and half there is the same idiom the money
    // calendar uses for a day it never read: present on the page, plainly not
    // counted. a solid grey card reads as history, and this one can come back.
    return {
      box: "border-dashed bg-shell border-line opacity-55",
      cell: "border-dashed bg-shell opacity-55",
      rail: "border-l-line",
      text: "text-ink-50",
    };
  }
  return {
    box: "bg-paper border-line",
    cell: "bg-shell",
    rail: "border-l-flame",
    text: "text-ink-50",
  };
}

/**
 * The clip's own frame on a calendar card.
 *
 * A card here is 46px tall, and none of `ClipThumb`'s fixed sizes fit in it. The
 * `tile` one does, because it takes its height from its width and the 9:16 of a
 * vertical cut, which is exactly the shape these clips are: give it a 26px
 * column and it comes back 46px tall. The only thing that has to be forced is
 * the radius, since a 12px corner on a 21px box is a lozenge, and the `!` is
 * how tailwind guarantees which of two radius utilities wins rather than
 * leaving it to stylesheet order.
 *
 * History gets a dimmer frame for the same reason its text is grey: the card is
 * a record, not something you can still act on.
 */
function CardThumb({
  src,
  width,
  live,
}: {
  src: string | null;
  width: number;
  live: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="h-full shrink-0 overflow-hidden"
      style={{ width }}
    >
      <ClipThumb
        src={src}
        size="tile"
        className={`rounded-[5px]! ${live ? "" : "opacity-60"}`}
      />
    </span>
  );
}

/**
 * The platforms a card goes out on.
 *
 * `current`, not `brand`: every platform on one card is in the same state, so
 * brand colours would be four different-coloured ways of saying one thing, and
 * at 11px on a tinted card they read as confetti. The shapes carry it, and the
 * colour stays free to mean status.
 */
function Marks({ platforms }: { platforms: ScheduledPost["platforms"] }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 text-ink-50">
      {platforms.map((x) => (
        <PlatformGlyph key={x} platform={x} className="size-[11px]" />
      ))}
    </span>
  );
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" aria-hidden="true">
      <path
        d={dir === "left" ? "m14.5 5-7 7 7 7" : "m9.5 5 7 7-7 7"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Aug 3", the week label's two ends. */
function short(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
