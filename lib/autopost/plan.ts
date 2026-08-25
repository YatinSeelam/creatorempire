/**
 * The batch a creator builds by hand, and the arithmetic under it.
 *
 * Pure on purpose: the wizard runs this on every keystroke to redraw the
 * schedule, the server runs the same functions to turn what was posted into
 * rows, and neither may disagree about what time the fourth clip goes out.
 *
 * Times are minutes-from-midnight in the creator's own timezone, and the day is
 * a `YYYY-MM-DD` string. That pairing is deliberate. A batch is planned as
 * "Tuesday at 9am", not as an instant: dragging a post across a daylight saving
 * boundary must not move it to 8am, and it does exactly that if the plan is
 * carried around as a timestamp. The two are only joined into a real instant at
 * the last moment, in `scheduledAt()`, which is also the only place a timezone
 * is involved at all.
 */

import type { Platform } from "@/lib/deals";

/* ------------------------------------------------------------------ dates */

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** A local calendar day as `YYYY-MM-DD`. Never `toISOString`, which is UTC and
 *  turns 8pm on the 3rd into the 4th for most of the world. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** 545 → "9:05 AM" */
export function fmtMinutes(min: number): string {
  const raw = Math.floor(min / 60);
  const mm = min % 60;
  const ap = raw >= 12 ? "PM" : "AM";
  const h = raw % 12 === 0 ? 12 : raw % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

/** 14 → "2:00pm", for the calendar's hour gutter. */
export function fmtHour(hour: number): string {
  const ap = hour >= 12 ? "pm" : "am";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00${ap}`;
}

/** minutes ⇄ what an `<input type="time">` wants. */
export function toTimeInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function fromTimeInput(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * The one place a day and a minute become an instant.
 *
 * Built through the local `Date` constructor rather than by string, so the
 * browser applies the creator's own offset and the server stores the moment
 * they actually meant.
 */
export function scheduledAt(day: string, min: number): Date {
  const base = parseDay(day);
  base.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return base;
}

/* ---------------------------------------------------------------- the plan */

/** The shape of a row while it is still being planned. */
export type PlannedRow = {
  /** the clip this row posts, by its id in the picker */
  clipId: string;
  /** `YYYY-MM-DD`, local */
  day: string;
  /** minutes from midnight, local */
  min: number;
};

export type BatchConfig = {
  /** `YYYY-MM-DD` the first post goes out */
  start: string;
  /** minutes from midnight for the first post of each day */
  startMin: number;
  /** minutes between posts on the same day */
  gap: number;
  /** how many go out before the plan rolls to the next day */
  perDay: number;
};

/** 11:55pm. Past this the next post rolls rather than stacking at midnight. */
const LAST_MINUTE = 23 * 60 + 55;

/**
 * Lay the picked clips out over days at a fixed gap.
 *
 * Pick order is posting order, which is the one rule the picker's numbered
 * badges are promising. A day fills to `perDay` and then rolls, and a gap that
 * would push a post past midnight rolls too rather than clamping several posts
 * onto the same last minute of the day.
 */
export function buildRows(clipIds: string[], cfg: BatchConfig): PlannedRow[] {
  let day = parseDay(cfg.start);
  let slot = 0;

  return clipIds.map((clipId) => {
    if (slot >= cfg.perDay) {
      day = addDays(day, 1);
      slot = 0;
    }

    let min = cfg.startMin + slot * cfg.gap;
    if (min > LAST_MINUTE) {
      day = addDays(day, 1);
      slot = 0;
      min = cfg.startMin;
    }
    slot += 1;

    return { clipId, day: dayKey(day), min };
  });
}

/**
 * Caption plus the batch's tags.
 *
 * Kept as a function rather than baked into the caption when it is typed,
 * because the tag list is edited once for the whole batch and every row has to
 * re-read it. The stored row keeps the two apart for the same reason.
 */
export function finalCaption(
  caption: string,
  hashtags: string[],
  useTags: boolean
): string {
  const base = (caption ?? "").trim();
  if (!useTags || hashtags.length === 0) return base;
  return `${base} ${hashtags.join(" ")}`.trim();
}

/** `#Candle!!` / `candle` → `#candle`. Empty when there is nothing usable. */
export function normalizeTag(raw: string): string {
  const clean = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase();
  return clean ? `#${clean}` : "";
}

/* ------------------------------------------------------- posting options */

/**
 * Per-platform posting settings.
 *
 * Stored as jsonb rather than columns: every platform changes its own list on
 * its own schedule, and none of this is ever filtered or sorted on.
 *
 * Only settings that upload-post actually carries are here. The mock this was
 * built from drew a few more (instagram remix, hide like count, a facebook
 * privacy picker) behind a "placeholder options" chip, and they are left out:
 * a switch that reads "on" while nothing sends it is a worse lie than a switch
 * that is not there. `lib/autopost/upload-post.ts` is the other end and names
 * the field each of these becomes.
 *
 * Widened 2026-08-24 against the live `/api/upload` docs. Everything added is a
 * documented field, and the three disclosure toggles are here because they are
 * not cosmetic: a paid-partnership post without the label is the platform's
 * problem to take down, and every one of the four now demands an AI label.
 */
export type TiktokOptions = {
  privacy: "Public" | "Friends" | "Followers" | "Private";
  comments: boolean;
  duet: boolean;
  stitch: boolean;
  /** paid partnership with somebody else's brand */
  branded: boolean;
  /** promoting your own business. tiktok treats these as different disclosures
   *  and a post can carry both. */
  ownBrand: boolean;
  aiGenerated: boolean;
  /** seconds into the clip the cover frame is taken from. sent as ms. */
  coverSecond: number;
  /** land it in the tiktok inbox as a draft instead of posting it. tiktok drops
   *  every bit of metadata in this mode, which the ui has to say out loud. */
  draft: boolean;
};

export type InstagramOptions = {
  shareToFeed: boolean;
  /** reel or story. a story is gone in 24h and does not take a collaborator. */
  mediaType: "Reel" | "Story";
  /** one handle, no @. upload-post takes a list; the ui collects one, which is
   *  the only shape a brand deal ever actually needs. */
  collab: string;
  /** renames the reel's original audio track. instagram allows this once. */
  audioName: string;
  aiGenerated: boolean;
};

export type YoutubeOptions = {
  visibility: "Public" | "Unlisted" | "Private";
  madeForKids: boolean;
  category: string;
  /** youtube's own tag list, separate from the caption hashtags */
  tags: string[];
  embeddable: boolean;
  license: "Standard" | "Creative Commons";
  /** the ftc disclosure. the same fact as tiktok's `branded`, different word. */
  paidPromotion: boolean;
  aiGenerated: boolean;
};

export type FacebookOptions = {
  /** a reel, a 24h story, or an ordinary page video */
  mediaType: "Reel" | "Story" | "Video";
  /** save it to the page as a draft rather than publishing */
  draft: boolean;
};

export type PostOptions = {
  tiktok: TiktokOptions;
  instagram: InstagramOptions;
  youtube: YoutubeOptions;
  facebook: FacebookOptions;
};

export const YOUTUBE_CATEGORIES = [
  "People & Blogs",
  "Science & Technology",
  "Entertainment",
  "Education",
  "Howto & Style",
  "Comedy",
] as const;

export const DEFAULT_OPTIONS: PostOptions = {
  tiktok: {
    privacy: "Public",
    comments: true,
    duet: true,
    stitch: true,
    branded: false,
    ownBrand: false,
    aiGenerated: false,
    coverSecond: 1,
    draft: false,
  },
  instagram: {
    shareToFeed: true,
    mediaType: "Reel",
    collab: "",
    audioName: "",
    aiGenerated: false,
  },
  youtube: {
    visibility: "Public",
    madeForKids: false,
    category: "People & Blogs",
    tags: [],
    embeddable: true,
    license: "Standard",
    paidPromotion: false,
    aiGenerated: false,
  },
  facebook: { mediaType: "Reel", draft: false },
};

/** What tiktok calls each of our privacy words. */
export const TIKTOK_PRIVACY: Record<TiktokOptions["privacy"], string> = {
  Public: "PUBLIC_TO_EVERYONE",
  Friends: "MUTUAL_FOLLOW_FRIENDS",
  Followers: "FOLLOWER_OF_CREATOR",
  Private: "SELF_ONLY",
};

/**
 * The youtube category id behind each label. Their api takes the number, and a
 * wrong one fails the youtube half of the post rather than the whole thing, so
 * an unknown label falls back to People & Blogs rather than being sent.
 */
export const YOUTUBE_CATEGORY_ID: Record<string, string> = {
  "People & Blogs": "22",
  "Science & Technology": "28",
  Entertainment: "24",
  Education: "27",
  "Howto & Style": "26",
  Comedy: "23",
};

/** A stored `options` blob back into a complete one. A preset saved before a
 *  control existed is missing that key, and every reader wants a full object. */
export function withDefaults(stored: unknown): PostOptions {
  const obj = (stored ?? {}) as Partial<Record<Platform, unknown>>;
  const merge = <T,>(base: T, over: unknown): T =>
    over && typeof over === "object" ? { ...base, ...(over as T) } : base;

  return {
    tiktok: merge(DEFAULT_OPTIONS.tiktok, obj.tiktok),
    instagram: merge(DEFAULT_OPTIONS.instagram, obj.instagram),
    youtube: merge(DEFAULT_OPTIONS.youtube, obj.youtube),
    facebook: merge(DEFAULT_OPTIONS.facebook, obj.facebook),
  };
}

/** The colour each platform is drawn in. Not a theme token: these are the
 *  platforms' own marks, and they do not change with a white label. */
export const PLATFORM_COLOR: Record<Platform, string> = {
  tiktok: "#111111",
  instagram: "#D6337E",
  youtube: "#E5342A",
  facebook: "#1877F2",
};

/* ---------------------------------------------------------- calendar grid */

/** The calendar's drawn window: 6am to midnight, at 58px an hour. */
export const GRID = {
  firstHour: 6,
  lastHour: 24,
  rowHeight: 58,
  // the hour labels read "12:00pm" at their widest. 56 clipped the leading
  // "1" off it on retina text, so noon read as 2pm. 64 clears it with room.
  gutter: 64,
  // a card carries a poster frame now, and 38px cropped the caption to a strip
  // beside it. 46 is the smallest that lets both the frame and one line of type
  // sit at their own size.
  cardHeight: 46,
  openAt: 8,
} as const;

export const GRID_HEIGHT = (GRID.lastHour - GRID.firstHour) * GRID.rowHeight;

/* --------------------------------------------------------- what the ui sees */

/**
 * One clip available to a batch.
 *
 * Two sources and they are not interchangeable. An `editor` clip is a cut
 * already delivered on an edit job for this brand, and its `ref` is either the
 * editor's own link or a `storage://` sentinel that has to be signed before
 * anybody outside the app can fetch it. An `upload` clip is a file the creator
 * just put in the public autopost bucket, and its `ref` is already a url.
 */
export type BatchClip = {
  /** stable within a batch: a deliverable id, or `upload:<path>` */
  id: string;
  name: string;
  source: "editor" | "upload" | "variation";
  /** the editor's name, "You" for an upload, the batch for a variation */
  by: string;
  /** when it landed, already worded */
  when: string;
  /** an http url, the `storage://editing-assets/<path>` sentinel, or the
   *  `variations://<path>` one a rendered variation carries */
  ref: string;
  /**
   * A url the BROWSER can play, for the poster frame on the picker.
   *
   * Separate from `ref` on purpose. `ref` is what gets handed upstream and is
   * signed at schedule time, because a url minted at page load would be stale
   * long before Upload-Post fetches it. This one only has to survive the tab
   * being open, so it is signed once for the whole list in a single call and a
   * `<video>` seeks it to draw a frame. Null for a clip nothing can preview:
   * a pasted link the browser cannot decode, or a sentinel that failed to sign.
   */
  previewUrl: string | null;
};

export type PostStatus =
  | "scheduled"
  | "processing"
  | "posted"
  | "partial"
  | "failed"
  | "canceled";

/**
 * A `social_posts` row as the planner and calendar want it: the instant split
 * back into the local day and minute they were planned in, so dragging one
 * across a daylight saving boundary keeps the hour it was set to.
 */
export type ScheduledPost = {
  id: string;
  dealId: string | null;
  batchId: string | null;
  caption: string;
  hashtags: string[];
  platforms: Platform[];
  videoName: string | null;
  /**
   * A url the browser can seek for the row's poster frame, freshly minted at
   * load. NOT the stored `video_url`: that one was signed when the batch was
   * scheduled and is an hour old at best, so a queue opened tomorrow would draw
   * a column of broken players off it.
   */
  previewUrl: string | null;
  /** `YYYY-MM-DD`, local */
  day: string;
  /** minutes from midnight, local */
  min: number;
  status: PostStatus;
};

/** A deal in the brand picker, with the dots that say what is connected. */
export type DealCard = {
  id: string;
  name: string;
  /** the brand's own mark, already resolved by `brandLogo`. "" when it has none
   *  and the initial has to stand in. */
  logo: string;
  /** the brand on its own, without the deal's name after it. the picker shows
   *  both lines and a mark needs the name it is a mark OF. */
  brandName: string;
  /** the handle the posts go out under, when one account names it */
  handle: string | null;
  connected: Record<Platform, boolean>;
  /** platforms with a tracking row but no login: dots, but hollow ones */
  tracked: Record<Platform, boolean>;
  scheduled: number;
};

/** Terminal posts are history: they cannot be moved and are drawn quietly. */
export function isLive(status: PostStatus): boolean {
  return status === "scheduled" || status === "processing";
}

/**
 * Everything the workspace draws, in the one shape the server builds and the
 * client component takes.
 *
 * Declared here rather than beside the loader because the loader is a server
 * module: a client component importing its type would pull the whole read, the
 * supabase server client and `next/headers` into the browser bundle.
 */
export type AutopostWorkspaceView = {
  deals: DealCard[];
  dealId: string | null;
  posts: ScheduledPost[];
  clips: BatchClip[];
  hashtags: string[];
  options: PostOptions;
  /** false when UPLOAD_POST_API_KEY is unset: connecting is off, not broken */
  configured: boolean;
  connected: Record<Platform, boolean>;
};
