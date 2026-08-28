"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AccessPicker } from "@/components/dash/access-picker";
import { PersonAvatar } from "@/components/dash/thumb";
import { ViewAsButton } from "@/components/dash/view-as";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/access-levels";
import { BASE_PATH } from "@/lib/base-path";

/**
 * One person on the founder's roster, already in the words the card prints.
 *
 * Every number and date is formatted on the server before it gets here. That is
 * not tidiness: `lib/founder.ts` reaches for `next/headers` through
 * `requireFounderView`, so a client component cannot import so much as its
 * `personName` helper. Handing over strings keeps the whole formatting layer on
 * the server side of that line, and keeps this file's imports down to the three
 * controls it actually draws.
 */
export type PersonRow = {
  /** empty for a grant written against an address nobody has signed up on. */
  userId: string;
  name: string;
  initial: string;
  avatar: string | null;
  email: string;
  /** "3d ago", or "never used it", or "never signed in". */
  seen: string;
  posts: string;
  views: string;
  deals: string;
  spend: string;
  level: AccessLevel;
};

/**
 * How each level paints, in one map so the card, its picker and its chip cannot
 * drift into three different ideas of what "founder" looks like.
 *
 * Founder is gold, a student is the accent, and no access is left plain. That
 * last one is the important half: three quarters of this roster is accounts
 * that signed in once and hold nothing, and giving them a colour would make the
 * page a wall of colour with the five that matter hidden inside it. So the
 * absence is the signal, and it is why `sheen` is optional — no value means the
 * gradient in globals.css collapses to transparent and the card does not shine.
 */
const TONES: Record<
  AccessLevel,
  { card: string; picker: string; chipOn: string; sheen?: string }
> = {
  founder: {
    card: "border-gold-line bg-gold-soft hover:border-gold/45",
    picker: "border-gold-line bg-gold-soft text-gold",
    chipOn: "border-gold-line bg-gold-soft text-gold",
    sheen: "rgb(201 162 39 / 0.34)",
  },
  student: {
    card: "border-flame/30 bg-ember hover:border-flame/50",
    picker: "border-flame/35 bg-ember text-flame",
    chipOn: "border-flame bg-ember text-flame-dark",
    sheen: "rgb(0 0 139 / 0.10)",
  },
  none: {
    card: "border-line bg-paper hover:border-ink/25",
    picker: "border-line bg-paper text-ink-50",
    chipOn: "border-ink/30 bg-shell text-ink",
  },
};

/** The "everyone" chip has no level of its own, so it wears the app's accent. */
const ALL_CHIP_ON = "border-flame bg-ember text-flame-dark";

/**
 * The roster, with a search over it.
 *
 * Eighty people is past the point where scanning works, and the page had no way
 * to answer "is this address in here" other than ctrl-F. It is a client filter
 * rather than a `?q=` round trip because the whole list is already on the page:
 * a server search would cost a request per keystroke to narrow rows the browser
 * is holding anyway.
 *
 * The filter chips are the other half of the same question. Most of a roster
 * this size is accounts that signed in once and hold nothing, so "show me the
 * students" is the view somebody actually wants and it was three screens of
 * scrolling away.
 *
 * `children` is the totals strip, rendered on the server and passed through, so
 * the numbers and the search share one band instead of stacking into two.
 */
export function PeopleBoard({
  rows,
  children,
}: {
  rows: PersonRow[];
  children: ReactNode;
}) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<AccessLevel | "all">("all");

  // how many sit at each level, for the chips. counted off the unfiltered list
  // on purpose: a chip whose number moved when you picked another chip would be
  // telling you about the filter rather than about the roster.
  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length };
    for (const r of rows) out[r.level] = (out[r.level] ?? 0) + 1;
    return out;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (level === "all" || r.level === level) &&
        (!needle ||
          r.name.toLowerCase().includes(needle) ||
          r.email.toLowerCase().includes(needle))
    );
  }, [rows, q, level]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg border border-line bg-paper px-5 py-4">
        {children}

        {/* pushed to the far edge rather than sitting after the last figure:
            the strip is most of a very wide row, and a search box floating in
            the middle of it reads as a sixth statistic. */}
        <label className="relative ml-auto flex min-w-[220px] flex-1 items-center sm:max-w-[320px]">
          <span className="pointer-events-none absolute left-3 text-ink-50">
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.9}
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${rows.length} people`}
            aria-label="Search people by name or email"
            className="h-10 w-full rounded-md border border-line bg-shell pl-9 pr-3.5 text-[13.5px] transition-colors placeholder:text-ink-50 hover:border-ink/25 focus:border-ink focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip
            on={level === "all"}
            onClick={() => setLevel("all")}
            count={counts.all}
            onClass={ALL_CHIP_ON}
          >
            everyone
          </Chip>
          {ACCESS_LEVELS.map((l) => (
            <Chip
              key={l.value}
              on={level === l.value}
              onClick={() => setLevel(l.value)}
              count={counts[l.value] ?? 0}
              onClass={TONES[l.value].chipOn}
            >
              {l.label}
            </Chip>
          ))}
        </div>
        <span className="text-[13px] text-ink-50 tabular-nums">
          {shown.length === rows.length
            ? `${rows.length}`
            : `${shown.length} of ${rows.length}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-[13.5px] text-ink-50">
          {rows.length === 0 ? "Nobody has signed up yet." : "Nobody matches that."}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {shown.map((r) => (
            <Card key={r.userId || r.email} row={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One filter, with how many it would show. */
function Chip({
  on,
  count,
  onClick,
  onClass,
  children,
}: {
  on: boolean;
  count: number;
  onClick: () => void;
  /** what it wears while it is the one selected. see TONES. */
  onClass: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-semibold transition-colors ${
        on ? onClass : "border-line text-ink-50 hover:border-ink/25 hover:text-ink"
      }`}
    >
      {children}
      <span className="text-[12px] font-bold tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/**
 * One person, in two lines.
 *
 * The face and the name are a link into them and the picker is not, because a
 * picker nested inside an anchor is one click doing two things. So the link is
 * the top line only, and the controls sit at either end of the row beneath it.
 *
 * A plain `<a>` rather than next/link: this is a client component and the href
 * is built by hand, so it has to carry the base path itself.
 *
 * `.sheen` and `--sheen` are the hover pass, defined in globals.css. The colour
 * is set here rather than there because it is the level's, and a level with no
 * `sheen` leaves the variable unset, which is what makes the gradient
 * transparent and the card still.
 */
function Card({ row: r }: { row: PersonRow }) {
  const first = r.name.trim().split(/\s+/)[0] || r.name;
  const tone = TONES[r.level];

  return (
    <div
      style={tone.sheen ? ({ "--sheen": tone.sheen } as CSSProperties) : undefined}
      className={`sheen rounded-lg border px-4 py-3.5 transition-colors ${tone.card}`}
    >
      <div className="relative z-[1] flex items-center gap-3">
        {r.userId ? (
          <a
            href={`${BASE_PATH}/founder/people/${r.userId}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <Face row={r} />
          </a>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <Face row={r} />
          </span>
        )}
        {/* no user id means the seat half of the picker has nothing to write:
            student is not offerable to somebody with no account, and the action
            says so rather than pretending. */}
        <AccessPicker
          userId={r.userId}
          email={r.email}
          level={r.level}
          triggerClass={tone.picker}
        />
      </div>

      {/* the numbers read as one line, dotted, rather than as four columns that
          have to hold their width open for a zero. */}
      <div className="relative z-[1] mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <p className="min-w-0 truncate text-[12.5px] text-ink-50">
          <b className="font-bold text-ink-70 tabular-nums">{r.posts}</b> posts
          {" · "}
          <b className="font-bold text-ink-70 tabular-nums">{r.views}</b> views
          {" · "}
          <b className="font-bold text-ink-70 tabular-nums">{r.deals}</b>{" "}
          {r.deals === "1" ? "deal" : "deals"}
          {" · "}
          <b className="font-bold text-ink-70 tabular-nums">{r.spend}</b>
        </p>
        {r.userId && <ViewAsButton userId={r.userId} name={first} />}
      </div>
    </div>
  );
}

function Face({ row: r }: { row: PersonRow }) {
  return (
    <>
      <PersonAvatar src={r.avatar} initial={r.initial} className="size-9" />
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-bold tracking-[-0.015em]">
          {r.name}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ink-50">
          {r.email || "no email"} · {r.seen}
        </span>
      </span>
    </>
  );
}
