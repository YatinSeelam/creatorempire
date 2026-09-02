"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { dropPost, movePost, restorePost } from "@/app/(dash)/tools/autoposting/actions";
import { AutopostBatchFlow } from "@/components/dash/autopost-batch-flow";
import { AutopostCalendar } from "@/components/dash/autopost-calendar";
import { BrandMark } from "@/components/dash/brand-mark";
import { ConnectButton } from "@/components/dash/connect-button";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import {
  DOW,
  addDays,
  dayKey,
  fromTimeInput,
  isLive,
  parseDay,
  startOfWeek,
  toTimeInput,
  type AutopostWorkspaceView,
  type DealCard,
  type ScheduledPost,
} from "@/lib/autopost/plan";
import { PLATFORMS, PLATFORM_LABEL } from "@/lib/deals";

/**
 * The autoposting tool: one brand at a time, three screens over it.
 *
 * The brand picker is the spine. Everything under it is scoped to one deal
 * because the accounts are: a batch goes out of the logins connected to THAT
 * brand, and a cross-brand queue would be a list where every row needs its own
 * answer to "which account". The cross-deal view already exists at /social and
 * is deliberately not duplicated here.
 *
 * Switching brands is a navigation, not local state. The clips, the connections
 * and the preset all belong to the deal, and re-reading them on the server is
 * both simpler and the only way the connection refresh (which costs an upstream
 * call) happens exactly once per brand somebody actually opens.
 */
export function AutopostingWorkspace({
  view,
  userId,
  todayKey,
  initialPicked = [],
}: {
  view: AutopostWorkspaceView;
  userId: string;
  /** `YYYY-MM-DD` computed on the server, so nothing here calls a clock while
   *  rendering. */
  todayKey: string;
  /** clip ids to open with already picked, from `?pick=` — Variations handing a
   *  finished render over. */
  initialPicked?: string[];
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<"flow" | "calendar">("flow");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [, startTransition] = useTransition();

  // remounts the wizard after a batch lands, so a second batch starts clean
  // rather than on step four with nine already-scheduled clips still picked.
  const [flowKey, setFlowKey] = useState(0);

  const deal = view.deals.find((d) => d.id === view.dealId) ?? null;
  const today = useMemo(() => parseDay(todayKey), [todayKey]);

  function say(msg: string, bad?: boolean) {
    setToast({ msg, bad });
    window.setTimeout(() => setToast(null), 2600);
  }

  function pickDeal(id: string) {
    setPickerOpen(false);
    setQuery("");
    startTransition(() => router.push(`/tools/autoposting?deal=${id}`));
  }

  const weekBar = useMemo(() => {
    const first = startOfWeek(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(first, i);
      const key = dayKey(d);
      return {
        key,
        date: d.getDate(),
        // two letters, not one: S and T each name two days, and a strip where
        // three of the seven labels are ambiguous is a strip nobody reads.
        dow: DOW[d.getDay()].slice(0, 2).toUpperCase(),
        isToday: key === todayKey,
        count: view.posts.filter((p) => p.day === key && isLive(p.status)).length,
      };
    });
  }, [today, todayKey, view.posts]);

  const weekTotal = weekBar.reduce((n, d) => n + d.count, 0);
  // the tallest day is what every bar is drawn against, so a week of ones still
  // reads as a week of ones rather than a flat line nobody can compare.
  const weekPeak = Math.max(...weekBar.map((d) => d.count), 1);

  const connectedCount = PLATFORMS.filter((p) => view.connected[p]).length;

  const matches = view.deals.filter((d) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${d.brandName} ${d.name} ${d.handle ?? ""}`.toLowerCase().includes(q);
  });

  if (!deal) {
    return (
      <>
        <div className="mx-auto w-full max-w-[1280px]">
          <h1 className="text-[15px] font-bold tracking-[-0.01em]">scheduler</h1>
          <div className="mx-auto mt-4 max-w-[520px] rounded-xl border border-line bg-paper px-8 py-14 text-center">
            {/* the four marks say what the tool is for faster than the heading
                does, and greyed out they also say the honest thing: there is
                nothing here to post from yet. */}
            <span className="flex items-center justify-center gap-2 text-line">
              {PLATFORMS.map((p) => (
                <PlatformGlyph key={p} platform={p} className="size-[22px]" />
              ))}
            </span>
            <h2 className="mt-4 text-[13.5px] font-semibold">
              no brand deals yet
            </h2>
            <p className="mx-auto mt-1 max-w-[400px] text-[12.5px] leading-[1.55] text-ink-50">
              autoposting goes out of the accounts on a brand deal. make a deal first,
              then connect its accounts.
            </p>
            <Link
              href="/deals/new"
              className="mt-4 inline-flex h-8 items-center rounded-lg bg-flame px-4 text-[12.5px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
            >
              make a deal
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mx-auto w-full max-w-[1280px] pb-16">
        {/* Three things, three jobs: which brand, what it can post to, and the
            way to change that. They used to share one line with `ml-auto`
            deciding the gaps, which fell apart the moment a brand name ran
            long. The picker keeps its own width, the state sits next to it, and
            the button is pinned to the far end on a wide screen and wraps under
            on a narrow one. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <h1 className="mr-1 text-[15px] font-bold tracking-[-0.01em]">scheduler</h1>
          <div className="relative">
            <button
              type="button"
              aria-expanded={pickerOpen}
              onClick={() => {
                setPickerOpen((v) => !v);
                setQuery("");
              }}
              className={`flex h-8 w-full min-w-[200px] max-w-[300px] items-center gap-2 rounded-lg border bg-paper pl-1.5 pr-2 text-left transition-colors sm:w-auto ${
                pickerOpen
                  ? "border-flame"
                  : "border-line hover:bg-shell"
              }`}
            >
              <BrandMark name={deal.brandName} logo={deal.logo} size="xs" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold leading-none">
                  {deal.brandName || deal.name}
                </span>
                {subLine(deal) && (
                  <span className="mt-0.5 block truncate text-[10.5px] leading-none text-ink-50">
                    {subLine(deal)}
                  </span>
                )}
              </span>
              <Chevron open={pickerOpen} />
            </button>

            {pickerOpen && (
              <>
                <button
                  type="button"
                  aria-label="close the brand picker"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setPickerOpen(false)}
                />
                <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-[340px] rounded-xl border border-line bg-paper p-2 shadow-[0_12px_32px_-20px_rgb(16_16_16/0.4)]">
                  <div className="mb-1 flex items-center gap-2 rounded-pill bg-shell px-3 py-2">
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="search brands"
                      className="flex-1 bg-transparent text-[13.5px] font-semibold outline-none placeholder:font-normal placeholder:text-ink-50"
                    />
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    {matches.map((d) => (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => pickDeal(d.id)}
                        className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors ${
                          d.id === deal.id ? "bg-ember" : "hover:bg-shell"
                        }`}
                      >
                        <BrandMark name={d.brandName} logo={d.logo} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-bold">
                            {d.brandName || d.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5">
                            <Connections connected={d.connected} tracked={d.tracked} />
                            {subLine(d) && (
                              <span className="min-w-0 truncate text-[11.5px] text-ink-50">
                                {subLine(d)}
                              </span>
                            )}
                          </span>
                        </span>
                        {d.scheduled > 0 && (
                          <span className="shrink-0 rounded-pill bg-paper px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums text-ink-50">
                            {d.scheduled}
                          </span>
                        )}
                      </button>
                    ))}
                    {matches.length === 0 && (
                      <p className="px-3 py-6 text-center text-[12.5px] text-ink-50">
                        no brands match that
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-3">
            <Connections connected={deal.connected} tracked={deal.tracked} />
            <span className="h-4 w-px shrink-0 bg-line" />
            <span className="truncate text-[12px] text-ink-50">
              {deal.handle ? `@${deal.handle} · ` : ""}
              {deal.scheduled} scheduled
            </span>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ScreenSwitch
              value={screen}
              onChange={setScreen}
              options={[
                { value: "flow", label: "new batch" },
                { value: "calendar", label: "calendar" },
              ]}
            />
            {!view.configured ? (
              <span className="text-[12.5px] text-ink-50">
                posting is not switched on for this deploy
              </span>
            ) : (
              <ConnectButton
                dealId={deal.id}
                manage={connectedCount > 0}
                origin="social"
                tone="line"
                label={connectedCount > 0 ? "manage accounts" : "connect an account"}
              />
            )}
          </div>
        </div>

        {/* This week at a glance. Read only: it is orientation, not a control,
            and a day you can click is a promise that clicking does something.
            Drawn as one card with hairlines inside rather than seven boxes,
            because seven boxes read as seven things to compare when the only
            comparison worth making is which day is fuller than the others. The
            count is a bar plus a number: dots stopped meaning anything past the
            fourth, and a creator dropping ten clips in a batch is normal.

            Not on the batch tab. Building a batch is about clips that have not
            been scheduled yet, so a strip of seven zeroes above the fold is a
            hundred pixels of the screen spent saying nothing. The calendar is
            the screen it is orientation FOR. */}
        <div className={`mt-5 ${screen === "flow" ? "hidden" : ""}`}>
          <div className="flex items-baseline justify-between px-1 pb-1.5">
            <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-50">
              this week
            </span>
            <span className="text-[12px] font-semibold text-ink-50">
              {weekTotal === 0
                ? "nothing scheduled"
                : `${weekTotal} ${weekTotal === 1 ? "post" : "posts"} going out`}
            </span>
          </div>

          <div className="flex items-stretch overflow-hidden rounded-xl border border-line bg-paper">
            {weekBar.map((d) => (
              <div
                key={d.key}
                title={`${d.count} scheduled`}
                className={`relative flex-1 border-l border-line/70 px-2 pb-2.5 pt-2 text-center first:border-l-0 ${
                  d.isToday ? "bg-ember" : ""
                }`}
              >
                <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-50">
                  {d.dow}
                </div>
                <div
                  className={`mt-0.5 text-[15px] font-extrabold tabular-nums leading-none tracking-[-0.02em] ${
                    d.isToday ? "text-flame" : ""
                  }`}
                >
                  {d.date}
                </div>

                {/* the bar is scaled against the busiest day of the week, so
                    height is a comparison and the number is the fact. */}
                <div className="mt-2 flex h-[18px] items-end justify-center gap-1">
                  <span className="flex h-full w-[6px] items-end overflow-hidden rounded-pill bg-shell">
                    <span
                      className={`w-full rounded-pill ${d.count > 0 ? "bg-flame" : ""}`}
                      style={{
                        height: d.count > 0 ? `${(d.count / weekPeak) * 100}%` : 0,
                      }}
                    />
                  </span>
                  <span
                    className={`text-[12px] font-extrabold tabular-nums leading-none ${
                      d.count > 0 ? "text-ink-70" : "text-ink-50/50"
                    }`}
                  >
                    {d.count || "0"}
                  </span>
                </div>

                {/* today gets a hairline on the floor of its cell. an ember
                    wash on its own is easy to miss against the paper, and a
                    full flame cell shouts over the counts, which are the
                    reason anybody is looking. */}
                {d.isToday && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-flame" />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          {screen === "flow" && (
            <AutopostBatchFlow
              key={flowKey}
              deal={deal}
              clips={view.clips}
              connected={view.connected}
              userId={userId}
              todayKey={todayKey}
              initialPicked={initialPicked}
              initialHashtags={view.hashtags}
              initialOptions={view.options}
              onSay={say}
              onDone={() => {
                setFlowKey((n) => n + 1);
                setScreen("calendar");
                startTransition(() => router.refresh());
              }}
            />
          )}

          {screen === "calendar" && (
            <AutopostCalendar
              posts={view.posts}
              today={today}
              onMove={(id, day, min) => {
                startTransition(async () => {
                  const res = await movePost(id, day, min);
                  say(res.error ?? res.ok ?? "moved.", Boolean(res.error));
                  router.refresh();
                });
              }}
              onOpen={(p) => (isLive(p.status) || p.status === "canceled") && setEditing(p)}
            />
          )}
        </div>
      </div>

      {editing && (
        <PostSheet
          post={editing}
          todayKey={todayKey}
          onClose={() => setEditing(null)}
          onSave={(day, min) => {
            const id = editing.id;
            const gone = editing.status === "canceled";
            setEditing(null);
            startTransition(async () => {
              // a cancelled post has no upstream job left to move, so the same
              // date and time field books a new one instead.
              const res = gone ? await restorePost(id, day, min) : await movePost(id, day, min);
              say(res.error ?? res.ok ?? "moved.", Boolean(res.error));
              router.refresh();
            });
          }}
          onDrop={() => {
            const id = editing.id;
            setEditing(null);
            startTransition(async () => {
              // the same action twice: on a live post it cancels upstream and
              // keeps the row, on a cancelled one it deletes the row.
              const res = await dropPost(id);
              say(res.error ?? res.ok ?? "done.", Boolean(res.error));
              router.refresh();
            });
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-pill px-5 py-3 text-[13.5px] font-bold shadow-card ${
            toast.bad ? "bg-flame-dark text-on-accent" : "bg-ink text-paper"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}

/**
 * One scheduled post, opened off the calendar: move it, or take it off.
 *
 * Cancelling is the half the calendar could never do. A drag can only ever say
 * "later", and a student who no longer wants a post going out had nothing to
 * press. `dropPost` cancels upstream at upload-post first and KEEPS the row as
 * `canceled`, so the record stays honest rather than the post quietly vanishing
 * from a list the platform still holds.
 *
 * Which is why the same sheet opens on a cancelled post and reads the other way
 * round: cancelling is not deleting, so the date and time field is still there
 * and "put it back on" books a fresh upstream job off the same row (`restorePost`),
 * with the clip, caption, tags and platforms it always had. Deleting is the
 * separate, final move underneath, and it is the only one that asks twice.
 */
function PostSheet({
  post,
  todayKey,
  onClose,
  onSave,
  onDrop,
}: {
  post: ScheduledPost;
  todayKey: string;
  onClose: () => void;
  onSave: (day: string, min: number) => void;
  onDrop: () => void;
}) {
  const [day, setDay] = useState(post.day);
  const [time, setTime] = useState(toTimeInput(post.min));
  const [confirm, setConfirm] = useState(false);
  const min = fromTimeInput(time);
  const gone = post.status === "canceled";
  // a cancelled post is being booked again, so the time it used to hold is a
  // perfectly good answer and the button cannot be disabled on it.
  const unchanged = !gone && day === post.day && min === post.min;

  return (
    <>
      <button
        type="button"
        aria-label="close"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-ink/25"
      />
      <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[440px] rounded-t-2xl border border-line bg-paper p-5 shadow-[0_-12px_40px_-24px_rgb(16_16_16/0.5)] sm:inset-y-0 sm:left-auto sm:right-0 sm:my-auto sm:mr-5 sm:h-fit sm:rounded-2xl">
        <div className="mb-4">
          <div className="text-[15px] font-extrabold tracking-[-0.01em]">
            {gone ? "cancelled post" : "move post"}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-ink-50">
            {post.videoName ?? (post.caption.slice(0, 60) || "scheduled post")}
          </div>
        </div>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!day || !time) return;
            onSave(day, min);
          }}
        >
          <div className="flex items-center gap-2">
            {post.platforms.map((pf) => (
              <PlatformGlyph key={pf} platform={pf} className="h-4 w-4" />
            ))}
            <span className="text-[12.5px] text-ink-50">
              {post.platforms.map((pf) => PLATFORM_LABEL[pf]).join(", ")}
            </span>
          </div>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-50">
              date
            </span>
            <input
              type="date"
              value={day}
              min={todayKey}
              required
              onChange={(e) => setDay(e.target.value)}
              className="rounded-pill border border-line bg-paper px-3 py-2 text-[13px] font-semibold outline-none focus:border-flame"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink-50">
              time
            </span>
            <input
              type="time"
              value={time}
              required
              onChange={(e) => setTime(e.target.value)}
              className="rounded-pill border border-line bg-paper px-3 py-2 text-[13px] font-semibold outline-none focus:border-flame"
            />
          </label>

          <p className="text-[12.5px] text-ink-50">
            {gone
              ? "it did not go out. pick when it should, and it goes back on with the same clip and caption."
              : "in your own timezone. a minute from now is as close as it goes."}
          </p>

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill px-4 py-2 text-[13px] font-semibold text-ink-50 hover:bg-shell hover:text-ink"
            >
              close
            </button>
            <button
              type="submit"
              disabled={unchanged}
              className="rounded-pill bg-ink px-4 py-2 text-[13px] font-bold text-paper disabled:opacity-40"
            >
              {gone ? "put it back on" : "move it"}
            </button>
          </div>
        </form>

        <div className="mt-4 border-t border-line pt-4">
          {gone ? (
            confirm ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink-50">
                  gone off the calendar for good. you cannot undo this.
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirm(false)}
                    className="rounded-pill px-3 py-2 text-[13px] font-semibold text-ink-50 hover:bg-shell hover:text-ink"
                  >
                    keep it
                  </button>
                  <button
                    type="button"
                    onClick={onDrop}
                    className="rounded-pill bg-flame-dark px-4 py-2 text-[13px] font-bold text-on-accent"
                  >
                    yes, delete it
                  </button>
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12.5px] text-ink-50">
                  cancelled, not deleted. it can go back on any time.
                </span>
                <button
                  type="button"
                  onClick={() => setConfirm(true)}
                  className="text-[13px] font-bold text-flame-dark hover:underline"
                >
                  delete it
                </button>
              </div>
            )
          ) : confirm ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] text-ink-50">
                it will not go out. you can put it back on later.
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className="rounded-pill px-3 py-2 text-[13px] font-semibold text-ink-50 hover:bg-shell hover:text-ink"
                >
                  keep it
                </button>
                <button
                  type="button"
                  onClick={onDrop}
                  className="rounded-pill bg-flame-dark px-4 py-2 text-[13px] font-bold text-on-accent"
                >
                  yes, cancel it
                </button>
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="text-[13px] font-bold text-flame-dark hover:underline"
            >
              take it off the schedule
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The quieter half of the picker's two lines.
 *
 * `name` is the whole deal ("acme spring drop") and `brandName` is just the
 * brand, so the interesting part of the deal is whatever `name` has that the
 * brand does not. Printing both in full gives you "acme" over "acme spring
 * drop", which reads as a bug. A deal named after nothing but its brand falls
 * back to the handle, because a blank second line is better than a repeat and
 * the handle is the other thing worth knowing about a brand you are about to
 * post as.
 */
function subLine(d: DealCard): string {
  const brand = d.brandName.trim();
  const full = d.name.trim();
  const rest =
    brand && full.toLowerCase().startsWith(brand.toLowerCase())
      ? full.slice(brand.length).replace(/^[\s·:/|-]+/, "")
      : full.toLowerCase() === brand.toLowerCase()
        ? ""
        : full;
  if (rest) return rest;
  return d.handle ? `@${d.handle}` : "";
}

/** Rotates rather than swapping glyphs, so the picker opening is one movement
 *  instead of two characters trading places. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-[14px] shrink-0 text-ink-50 transition-transform ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * One track, three states, rather than three buttons that happen to sit next to
 * each other. The old row of loose pills read as "new batch" plus two things
 * you could also press; a segmented control says out loud that these are three
 * views of the same brand and exactly one of them is on.
 *
 * The selected segment is paper on shell with the card's own lift, not a black
 * slab. The slab won at a glance and then went on winning, competing with the
 * flame accent that actually marks the work.
 */
function ScreenSwitch<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border border-line bg-shell p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-[26px] rounded-md px-2.5 text-[12px] font-semibold transition-colors ${
            o.value === value
              ? "bg-paper text-ink shadow-[0_1px_2px_rgb(16_16_16/0.12)]"
              : "text-ink-50 hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * What a batch on this brand could actually go out of, one mark per platform.
 *
 * The difference between connected and tracked matters here more than anywhere
 * else in the product, because a tracked-only account counts views and cannot
 * be posted to. This used to be four tiny circles keyed on fill and border
 * colour, which is three states told in a way nobody can read at 8px. The real
 * marks say which platform without a word of type, and colour carries the
 * state: full colour is a login, a grey outline is tracked only, and a mark
 * faded into the hairline is a platform this brand has nothing on at all.
 *
 * The dead ones are drawn rather than dropped so the four always sit in the
 * same order in the same width. A row that changes length per brand makes the
 * picker jump every time you switch.
 */
function Connections({
  connected,
  tracked,
}: {
  connected: Record<string, boolean>;
  tracked: Record<string, boolean>;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {PLATFORMS.map((p) => {
        const state = connected[p]
          ? "connected"
          : tracked[p]
            ? "tracked only, cannot post"
            : "no account";
        return (
          <span
            key={p}
            title={`${PLATFORM_LABEL[p]}: ${state}`}
            className={`flex items-center ${
              connected[p] ? "" : tracked[p] ? "text-ink-50" : "text-line"
            }`}
          >
            <PlatformGlyph
              platform={p}
              tone={connected[p] ? "brand" : "current"}
              className="size-[15px]"
            />
          </span>
        );
      })}
    </span>
  );
}
