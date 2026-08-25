/**
 * The shapes and the arithmetic. Pure: imported by the pages, the client
 * workspace, the server actions and the render worker alike.
 */

import type { TextHookStyle } from "./style";

export const VARIATIONS_BUCKET = "variations";

/**
 * How a rendered variation is referred to outside this tool.
 *
 * The same trick `STORAGE_URL_PREFIX` plays for an editor's cut: a sentinel
 * that names the bucket and the path, never a url. Autoposting stores this on
 * the batch and signs it again at schedule time, because a signed url minted
 * when the picker rendered would be hours stale by the time Upload-Post
 * actually fetches the file.
 */
export const VARIATIONS_URL_PREFIX = "storage://variations/";

/** the ceiling on one batch. a creator picking four of everything is asking
 *  for 256 videos, which is an afternoon of encoding nobody meant to start. */
export const MAX_RENDERS_PER_BATCH = 60;

/** how many attempts a render gets before it stays failed. */
export const MAX_RENDER_ATTEMPTS = 3;

export type ComponentKind = "hook" | "demo" | "audio" | "text_hook";

export const KINDS = [
  { key: "hook", label: "hooks", one: "hook" },
  { key: "text_hook", label: "text hooks", one: "text hook" },
  { key: "demo", label: "demos", one: "demo" },
  { key: "audio", label: "audio", one: "sound" },
] as const satisfies readonly { key: ComponentKind; label: string; one: string }[];

/**
 * What a sound does to the video it is attached to.
 *
 * `replace` is the original and the default: the picked track becomes the whole
 * audio, looped to the video's length. That is right for a trending sound
 * pulled off a post, where the sound IS the video, and wrong for everything
 * else, which is what the other two are for.
 */
export type AudioRole = "replace" | "bed" | "sting";

export const AUDIO_ROLES = [
  {
    key: "bed",
    label: "under the voice",
    one: "bed",
    line: "music behind whatever was said. the clip keeps its own sound.",
  },
  {
    key: "replace",
    label: "instead of the voice",
    one: "full track",
    line: "the sound becomes the whole audio, looped. what a trending sound is for.",
  },
  {
    key: "sting",
    label: "on the cut",
    one: "sting",
    line: "played once where the hook becomes the demo. picked per batch, not crossed.",
  },
] as const satisfies readonly { key: AudioRole; label: string; one: string; line: string }[];

/**
 * Where a role's level starts.
 *
 * Only the bed is genuinely a question, and it is the one complaint with no
 * other fix: 0.18 is about -15dB, where music sits under speech without
 * fighting it. A sting comes in a touch under full so a whoosh does not clip
 * the voice it lands next to.
 */
export const DEFAULT_GAIN: Record<AudioRole, number> = {
  replace: 1,
  bed: 0.18,
  sting: 0.9,
};

/** the three levels the card offers for a bed. a slider would imply a precision
 *  nobody can hear the difference of on a phone speaker. */
export const BED_LEVELS = [
  { key: "quiet", gain: 0.1, label: "quiet" },
  { key: "normal", gain: 0.18, label: "normal" },
  { key: "loud", gain: 0.32, label: "loud" },
] as const;

export function audioRoleOf(c: { audio_role?: string | null }): AudioRole {
  const role = c.audio_role;
  return role === "bed" || role === "sting" ? role : "replace";
}

export function audioGainOf(c: { audio_gain?: number | null; audio_role?: string | null }): number {
  const gain = Number(c.audio_gain);
  if (Number.isFinite(gain) && gain > 0 && gain <= 2) return gain;
  return DEFAULT_GAIN[audioRoleOf(c)];
}

export type VariationComponent = {
  id: string;
  brand_id: string;
  kind: ComponentKind;
  title: string;
  storage_path: string | null;
  poster_path: string | null;
  text_content: string | null;
  text_style: unknown;
  /** how long the FILE is, always. what the trim selects is the two below. */
  duration_seconds: number | null;
  /** null / null means the whole clip, which is what an untouched upload is. */
  trim_start_seconds: number | null;
  trim_end_seconds: number | null;
  /** the post a sound was pulled off, or null when it was uploaded by hand. */
  source_url: string | null;
  /** audio only, and 'replace' on everything else because that is the column
   *  default. see AudioRole. */
  audio_role: string | null;
  audio_gain: number | null;
  created_at: string;
};

/** what the file may be trimmed to, in a shape ffmpeg and the ui both want.
 *  null means "play it all", which is the only thing a missing pair can mean. */
export type Trim = { start: number; duration: number | null };

export function trimOf(c: {
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
}): Trim | null {
  const start = Number(c.trim_start_seconds ?? 0);
  const end = c.trim_end_seconds == null ? null : Number(c.trim_end_seconds);
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const to = end != null && Number.isFinite(end) && end > from ? end : null;
  if (from === 0 && to === null) return null;
  return { start: from, duration: to === null ? null : to - from };
}

/**
 * How long this component plays for, which is not how long its file is once
 * somebody has trimmed it. The card, the wizard and the batch header all want
 * the selection, never the source.
 */
export function playedSeconds(c: {
  duration_seconds: number | null;
  trim_start_seconds?: number | null;
  trim_end_seconds?: number | null;
}): number | null {
  const trim = trimOf(c);
  if (!trim) return c.duration_seconds;
  if (trim.duration != null) return trim.duration;
  if (typeof c.duration_seconds === "number") {
    return Math.max(0, c.duration_seconds - trim.start);
  }
  return null;
}

export type RenderStatus = "queued" | "rendering" | "done" | "failed";

export type VariationRender = {
  id: string;
  batch_id: string;
  brand_id: string;
  hook_id: string | null;
  demo_id: string | null;
  audio_id: string | null;
  /** the batch's one sting, stamped on every render it made. */
  sfx_id: string | null;
  text_hook_id: string | null;
  label: string;
  text_content: string | null;
  text_style: unknown;
  status: RenderStatus;
  progress: number;
  output_path: string | null;
  poster_path: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
};

export type VariationBatch = {
  id: string;
  brand_id: string;
  hook_count: number;
  demo_count: number;
  audio_count: number;
  text_count: number;
  audio_title: string | null;
  /** the sting, if the batch was given one. a title rather than a count: there
   *  is only ever one, so "1 sound" would say less than its name. */
  sfx_title: string | null;
  created_at: string;
};

export type BatchWithRenders = VariationBatch & { renders: VariationRender[] };

/** a brand with its bank summarised, for the picker screen */
export type BrandBank = {
  id: string;
  name: string;
  /** already resolved through `brandLogo()`, so "" means draw the initial. */
  logo: string;
  counts: Record<ComponentKind, number>;
  renders: number;
  /** newest first, for the little filmstrip on the card */
  posters: string[];
  last_active: string | null;
};

/* ── combinations ─────────────────────────────────────────────────────────── */

/** the four fields of a selection that are lists of ids, as opposed to `sfxId`,
 *  which is one id and not an axis at all. */
export type ComboAxisKey = "hookIds" | "demoIds" | "audioIds" | "textHookIds";

export type ComboSelection = {
  hookIds: string[];
  demoIds: string[];
  /** beds and full tracks. a sting is not in here on purpose, see `sfxId`. */
  audioIds: string[];
  textHookIds: string[];
  /**
   * The one sting laid on every render in the batch.
   *
   * Not an axis. Nobody a/b tests two whooshes, they pick one and it goes on
   * all forty, so crossing by it would multiply the batch by a number nobody
   * asked for. It does not appear in `countCombinations` for the same reason.
   */
  sfxId?: string | null;
};

export type Combo = {
  hookId: string;
  demoId: string;
  audioId: string | null;
  textHookId: string | null;
  label: string;
};

/**
 * How many videos a selection comes out as.
 *
 * Hooks and demos are required axes. Audio and text are optional: picking none
 * is one pass-through slot, meaning "keep the clip's own sound" and "burn no
 * text", not zero videos. Multiplying by zero there is what makes a perfectly
 * reasonable pick silently produce nothing.
 */
export function countCombinations(sel: ComboSelection): number {
  return (
    sel.hookIds.length *
    sel.demoIds.length *
    Math.max(1, sel.audioIds.length) *
    Math.max(1, sel.textHookIds.length)
  );
}

/**
 * Expand a selection into one render per combination.
 *
 * The label is what the thumbnail shows: H2·D1·S1·T3 reads as "second hook,
 * first demo, first sound, third text", which is the only way to tell twenty
 * near-identical cuts apart at thumbnail size. Axes with one option are left
 * out of the label, because a number that is always 1 is noise.
 */
export function expandCombinations(sel: ComboSelection): Combo[] {
  const audios: (string | null)[] = sel.audioIds.length > 0 ? sel.audioIds : [null];
  const texts: (string | null)[] =
    sel.textHookIds.length > 0 ? sel.textHookIds : [null];

  const combos: Combo[] = [];
  sel.hookIds.forEach((hookId, h) => {
    sel.demoIds.forEach((demoId, d) => {
      audios.forEach((audioId, a) => {
        texts.forEach((textHookId, t) => {
          const parts = [`H${h + 1}`, `D${d + 1}`];
          if (sel.audioIds.length > 1) parts.push(`S${a + 1}`);
          if (sel.textHookIds.length > 1) parts.push(`T${t + 1}`);
          combos.push({ hookId, demoId, audioId, textHookId, label: parts.join("·") });
        });
      });
    });
  });
  return combos;
}

/**
 * Posting order that keeps lookalikes apart: round robin across hook groups,
 * biggest group first. Three videos with the same hook going out back to back
 * is the thing the whole tool exists to avoid.
 */
export function spreadByHook<T extends { hook_id: string | null }>(items: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.hook_id ?? "none";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  if (groups.size <= 1) return [...items];

  const queues = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: T[] = [];
  let i = 0;
  const guard = items.length * queues.length + queues.length;
  while (out.length < items.length && i <= guard) {
    const next = queues[i % queues.length].shift();
    if (next) out.push(next);
    i += 1;
  }
  return out;
}

/* ── storage ──────────────────────────────────────────────────────────────── */

/** The bucket is public, so a path is a url with no round trip. Signed urls
 *  would mean one request per tile per refresh for files whose names are
 *  already unguessable uuids. */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${VARIATIONS_BUCKET}/${path}`;
}

export function componentStyle(c: {
  text_style: unknown;
}): TextHookStyle | undefined {
  return c.text_style as TextHookStyle | undefined;
}

/** "0:12". null duration reads as an empty string rather than "0:00", which
 *  would claim a length we never measured. */
export function clock(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
