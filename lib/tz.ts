/**
 * Wall clocks, and turning one into an instant.
 *
 * A schedule is the only thing in this product with two clocks in it. The row
 * in the database is an instant in UTC, which is right and never ambiguous. The
 * thing a creator means is a wall clock: "6:30pm", in some city. Everything
 * here is the conversion between those two, and the reason it is a module
 * rather than three lines in the composer is that getting it wrong is silent —
 * a post goes out at the wrong hour and nothing anywhere says why.
 *
 * No dependency. `Intl` already knows every zone's rules including the DST
 * history, and the only trick needed is asking it the right question.
 */

/**
 * What a zone was offset from UTC at a given instant, in milliseconds.
 *
 * The trick: format the instant AS the target zone, then read those wall-clock
 * parts back as though they were UTC. The gap between that and the real instant
 * is the offset. It costs one `Intl` call and it is correct across DST, because
 * the formatter applies the rules in force on that date rather than today's.
 */
export function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    // hour12:false still hands back 24 for midnight in some engines, and
    // Date.UTC would roll that into the next day.
    read("hour") % 24,
    read("minute"),
    read("second")
  );

  return asUtc - at.getTime();
}

/**
 * A `datetime-local` value ("2026-08-13T18:30") read as a wall clock in a
 * chosen zone, returned as the instant it names.
 *
 * Two passes on purpose. The first offset is looked up at the wrong instant (we
 * do not know the right one yet, which is the whole problem), so on a DST
 * changeover the answer can be an hour out. Re-reading the offset at the
 * corrected instant and correcting again lands it. A third pass would never
 * change anything: no zone shifts twice within one shift's distance.
 *
 * Returns null for a value that does not read as a date, so the caller can say
 * so rather than scheduling a NaN.
 */
export function wallClockToInstant(local: string, timeZone: string): Date | null {
  const value = String(local ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;

  // read as UTC first: a fixed point to measure the zone's offset against.
  const asIfUtc = new Date(`${value.slice(0, 16)}:00Z`);
  if (Number.isNaN(asIfUtc.getTime())) return null;

  const first = new Date(asIfUtc.getTime() - zoneOffsetMs(asIfUtc, timeZone));
  const corrected = new Date(asIfUtc.getTime() - zoneOffsetMs(first, timeZone));
  return Number.isNaN(corrected.getTime()) ? null : corrected;
}

/** The reverse: an instant as the `datetime-local` string a zone would show. */
export function instantToWallClock(at: Date, timeZone: string): string {
  const shifted = new Date(at.getTime() + zoneOffsetMs(at, timeZone));
  return shifted.toISOString().slice(0, 16);
}

/** The zone's short name at a given moment: "EDT" in summer, "EST" in winter. */
export function zoneAbbr(timeZone: string, at: Date = new Date()): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** "America/New_York" → "new york". The city is the part people recognise. */
export function zoneCity(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ").toLowerCase();
}

/** How the zone is named everywhere it is shown: "edt · new york". */
export function zoneLabel(timeZone: string, at: Date = new Date()): string {
  const abbr = zoneAbbr(timeZone, at).toLowerCase();
  const city = zoneCity(timeZone);
  return abbr && abbr !== city ? `${abbr} · ${city}` : city;
}

/** Whatever zone this browser is in. "UTC" on a server or a locked-down engine. */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * The zones on offer, and why it is a short list rather than every IANA name.
 *
 * A creator schedules against an audience, and the audience is in a handful of
 * places. 400 zone names in a select is a search problem nobody wants to have
 * for a value they set once. The browser's own zone is added to the top of this
 * at render time, so somebody in a city that is not on the list still sees
 * theirs and never has to pick.
 */
export const COMMON_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Athens",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

/** Formats an instant as a wall clock in a chosen zone, for reading. */
export function formatInZone(
  iso: string,
  timeZone: string,
  shape: "time" | "day" | "full" = "full"
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "unknown";

  const base: Intl.DateTimeFormatOptions =
    shape === "time"
      ? { hour: "numeric", minute: "2-digit" }
      : shape === "day"
        ? { weekday: "short", month: "short", day: "numeric" }
        : {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          };

  // the year only when it is not this one. "Aug 13" is what somebody wants for
  // next week, and "Aug 13, 2027" is what they need for next year.
  const thisYear = new Date().getUTCFullYear();
  const showYear = shape !== "time" && at.getUTCFullYear() !== thisYear;

  return at.toLocaleString(undefined, {
    timeZone,
    ...base,
    ...(showYear ? { year: "numeric" } : {}),
  });
}

/** The calendar day an instant falls on IN a zone, as "2026-08-13". */
export function dayKeyInZone(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return instantToWallClock(at, timeZone).slice(0, 10);
}

/* ------------------------------------------------------------------ the cookie */

/**
 * (added with the autoposting calendar fix)
 * The creator's timezone, as an IANA name.
 *
 * The plan is a wall clock ("Tuesday at 9am") and the column is an instant,
 * and the two are only ever joined in one of two places: `scheduledAt` when a
 * post is written, and `splitLocal` when it is read back. Both used to lean on
 * the server's own clock, which on vercel is UTC. A creator in los angeles
 * planning 9am got 9am UTC, which is 2am for them, and the calendar's "today"
 * flipped to tuesday at 5pm on a monday.
 *
 * A COOKIE, set by the browser, for the same reason the theme is one: the
 * server has to know it before the first paint, or the page draws the wrong
 * day and then jumps. The browser is the only party that knows the zone, so
 * `TzSync` writes it once and refreshes; from then on every read and write
 * happens in that zone. Nothing stored changes shape: `scheduled_for` stays an
 * instant, and the wall clock is derived from it in whichever zone the person
 * reading is in.
 */

export const TZ_COOKIE = "ugcf_tz";
export const TZ_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** what the server assumes until the browser has said. */
export const DEFAULT_TZ = "UTC";

/** A cookie is a string anybody can type. Only a zone Intl knows survives. */
export function readTz(raw: string | undefined | null): string {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 64) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TZ;
  }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number };

function partsIn(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    y: out.year ?? 1970,
    m: out.month ?? 1,
    d: out.day ?? 1,
    // hourCycle h23 should never yield 24, but some engines have.
    h: (out.hour ?? 0) % 24,
    mi: out.minute ?? 0,
  };
}

/** An instant, as the day and minute-from-midnight it is in `tz`. */
export function wallClock(date: Date, tz: string): { day: string; min: number } {
  const p = partsIn(date, tz);
  const day = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return { day, min: p.h * 60 + p.mi };
}

/**
 * A day and a minute in `tz`, as an instant.
 *
 * Intl only goes one way, so the offset is found by asking what wall clock the
 * naive UTC guess lands on and correcting by the difference. One correction is
 * exact except across a daylight saving edge, where a second pass settles it.
 * A minute that does not exist (the spring-forward hour) lands on the instant
 * after the gap, which is the only honest answer.
 */
export function instantOf(day: string, min: number, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wanted = Date.UTC(y, (m || 1) - 1, d || 1, Math.floor(min / 60), min % 60, 0, 0);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz);
    const seen = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0, 0);
    const diff = seen - wanted;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
