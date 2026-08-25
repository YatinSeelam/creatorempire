"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  savePostPreset,
  scheduleBatch,
  type BatchState,
} from "@/app/(dash)/tools/autoposting/actions";
import { uploadAutopostVideo } from "@/lib/autopost/upload";
import {
  DEFAULT_OPTIONS,
  YOUTUBE_CATEGORIES,
  addDays,
  buildRows,
  dayKey,
  finalCaption,
  fromTimeInput,
  normalizeTag,
  parseDay,
  toTimeInput,
  type BatchClip,
  type BatchConfig,
  type DealCard,
  type PostOptions,
} from "@/lib/autopost/plan";
import { MAX_CAPTION } from "@/lib/autopost/limits";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@/lib/deals";
import { PLATFORM_COLOR } from "@/lib/autopost/plan";
import { ClipThumb } from "@/components/dash/clip-thumb";
import { BrandMark } from "@/components/dash/brand-mark";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { ConnectButton } from "@/components/dash/connect-button";

/**
 * One batch, built by hand, in four steps.
 *
 * The shape is the argument. A creator with nine delivered cuts does not want a
 * cadence worked out for them and then fought with; they want to see the nine,
 * put them in an order, write nine captions, pick the accounts, and be handed a
 * schedule they can drag. So: clips, captions, settings, schedule, and the only
 * thing computed for them is the times, which arrive already editable.
 *
 * It opens ON step one. There used to be a fork in front of it — a "where are
 * the videos?" screen with an editors card and an upload card — and it was a
 * click that bought nothing: both answers land on the same grid, which already
 * holds the editors' cuts AND an upload tile, so the fork was asking a question
 * whose two answers were the same page. Worse, its cards drew live poster frames
 * inside a `<button>`, so the visible result of clicking one was a video
 * starting to play rather than the step opening, which reads as broken. Gone.
 *
 * Pick order is posting order. That is the whole promise of the numbered badges
 * on the picker, and it is why `picked` is an array rather than a set. The
 * picked strip on step 1 is that promise made legible: badges scattered across a
 * grid are not an order anybody can read, and the strip is also where one gets
 * dragged somewhere else without unpicking half the batch. It only appears past
 * two clips, because one clip has no order to argue with.
 *
 * Every clip is drawn as its own poster frame (`ClipThumb`), never as a
 * placeholder glyph. Nine vertical cuts of the same shoot are nine identical
 * filenames and nine different first frames, so the frame is the only thing on
 * the row that answers "which one is this".
 *
 * Nothing here is saved until the last button. The clips are already in storage
 * (an upload lands there immediately, an editor's cut has been there since it
 * was delivered), but no `social_posts` row and nothing upstream exists until
 * `scheduleBatch` runs, so a closed tab costs nothing but the upload.
 */

type Step = 1 | 2 | 3 | 4;

/** the drive picker only exists where a google cloud project is configured.
 *  worked out here rather than imported from `drive-picker.tsx`, which is a
 *  `"use client"` module: a non-component export from one of those does not
 *  cross the client boundary. */
// this deploy never talks to google drive. no picker, no gapi script, no
// client id. a drive link can still be pasted like any other url.
const DRIVE_READY = false;

const GAPS = [60, 120, 180, 240];
const PER_DAY = [1, 2, 3, 4];

export function AutopostBatchFlow({
  deal,
  clips,
  connected,
  userId,
  todayKey,
  initialHashtags,
  initialOptions,
  initialPicked = [],
  onDone,
  onSay,
}: {
  deal: DealCard;
  /** cuts delivered by editors on this brand's jobs */
  clips: BatchClip[];
  connected: Record<Platform, boolean>;
  userId: string;
  /** `YYYY-MM-DD` from the server, so nothing here has to call a clock during
   *  render. */
  todayKey: string;
  initialHashtags: string[];
  initialOptions: PostOptions;
  /** clip ids to arrive already picked. filtered against the library, so a link
   *  to a render this deal cannot see picks nothing rather than a ghost row. */
  initialPicked?: string[];
  /** the batch landed: switch the workspace to the planner */
  onDone: (count: number) => void;
  onSay: (message: string, bad?: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(1);

  // uploads join the library the moment they land, so switching to the editor
  // list and back does not lose them.
  const [uploaded, setUploaded] = useState<BatchClip[]>([]);
  const [uploading, setUploading] = useState(false);
  // 0 to 1 across the whole drop, not per file. a creator who dropped four cuts
  // wants to know when the drop is done, and four bars that each fill to full
  // and reset read as three false finishes.
  const [progress, setProgress] = useState(0);
  // the drop target only lights up while something is genuinely over it, so the
  // card is a plain button the rest of the time rather than a permanently
  // dashed box shouting for a file.
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [picked, setPicked] = useState<string[]>(() =>
    initialPicked.filter((id) => clips.some((c) => c.id === id))
  );
  // the tile currently being dragged in the picked strip. held in state rather
  // than read off the drag event because safari will not let you read
  // `dataTransfer` during dragover, which is the only moment the drop target
  // has to decide whether it wants the thing.
  const [dragClip, setDragClip] = useState<string | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});

  const [useTags, setUseTags] = useState(true);
  const [tags, setTags] = useState<string[]>(initialHashtags);
  const [tagDraft, setTagDraft] = useState("");

  const [platforms, setPlatforms] = useState<Platform[]>(
    PLATFORMS.filter((p) => connected[p])
  );
  const [options, setOptions] = useState<PostOptions>(initialOptions ?? DEFAULT_OPTIONS);

  const [cfg, setCfg] = useState<BatchConfig>({
    start: dayKey(addDays(parseDay(todayKey), 1)),
    startMin: 8 * 60,
    gap: 120,
    perDay: 3,
  });
  // a row somebody dragged by hand wins over whatever the spread would compute.
  // cleared whenever the spread itself changes, because keeping an override
  // against a schedule that no longer exists is how rows end up on top of
  // each other.
  const [edits, setEdits] = useState<Record<string, { day: string; min: number }>>({});
  const [busy, setBusy] = useState(false);

  const library = useMemo(() => [...uploaded, ...clips], [uploaded, clips]);
  const clipOf = (id: string) => library.find((c) => c.id === id) ?? null;

  const rows = useMemo(
    () =>
      buildRows(picked, cfg).map((row) => ({
        ...row,
        ...(edits[row.clipId] ?? {}),
      })),
    [picked, cfg, edits]
  );

  const tagChars = tags.join(" ").length;

  function setSpread(next: Partial<BatchConfig>) {
    setEdits({});
    setCfg((prev) => ({ ...prev, ...next }));
  }

  /**
   * One updater per platform.
   *
   * There are now around twenty five controls across the four cards, and spelling
   * `setOptions({ ...options, youtube: { ...options.youtube, x } })` out twenty
   * five times is exactly where a copied line ends up writing a youtube field
   * onto instagram. Functional updates, so two switches flipped in the same tick
   * do not clobber each other.
   */
  const patch = {
    tiktok: (v: Partial<PostOptions["tiktok"]>) =>
      setOptions((o) => ({ ...o, tiktok: { ...o.tiktok, ...v } })),
    instagram: (v: Partial<PostOptions["instagram"]>) =>
      setOptions((o) => ({ ...o, instagram: { ...o.instagram, ...v } })),
    youtube: (v: Partial<PostOptions["youtube"]>) =>
      setOptions((o) => ({ ...o, youtube: { ...o.youtube, ...v } })),
    facebook: (v: Partial<PostOptions["facebook"]>) =>
      setOptions((o) => ({ ...o, facebook: { ...o.facebook, ...v } })),
  };

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Drop `id` where `over` currently sits. Pick order is posting order, so this
   *  is the only way to say "actually that one goes second" without unpicking
   *  everything after it and picking it all again. */
  function reorder(id: string, over: string) {
    if (id === over) return;
    setPicked((prev) => {
      const next = prev.filter((x) => x !== id);
      const at = next.indexOf(over);
      if (at === -1) return prev;
      next.splice(at, 0, id);
      return next;
    });
  }

  function addTag() {
    const tag = normalizeTag(tagDraft);
    setTagDraft("");
    if (!tag) return;
    setTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
  }

  async function takeFiles(files: File[]) {
    // only videos. a folder dragged in arrives as a pile of whatever was in it,
    // and the upload would reject each one one at a time with its own toast.
    const clean = files.filter((f) => f.type.startsWith("video/"));
    if (clean.length === 0 || uploading) return;
    setUploading(true);
    setProgress(0);

    const added: BatchClip[] = [];
    for (const [i, file] of clean.entries()) {
      try {
        // each file owns its slice of the bar, so four cuts fill one bar once
        // rather than four bars four times.
        const url = await uploadAutopostVideo(file, userId, (fraction) =>
          setProgress((i + fraction) / clean.length)
        );
        added.push({
          id: `upload:${url}`,
          name: file.name,
          source: "upload",
          by: "you",
          when: "just now",
          ref: url,
          // the autopost bucket is public, so the url it just came back with is
          // already something the browser can seek for a poster frame.
          previewUrl: url,
        });
      } catch (err) {
        onSay(err instanceof Error ? err.message : "that upload failed.", true);
      }
    }

    setUploading(false);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = "";
    if (added.length === 0) return;

    setUploaded((prev) => [...added, ...prev]);
    setPicked((prev) => [...prev, ...added.map((c) => c.id)]);
  }

  function go(next: Step) {
    if (next === 2 && picked.length === 0) return onSay("pick at least one clip.", true);
    if (next === 4 && platforms.length === 0) {
      return onSay("pick at least one platform.", true);
    }
    setStep(next);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);

    const result = await scheduleBatch({
      dealId: deal.id,
      platforms,
      hashtags: useTags ? tags : [],
      options,
      posts: rows.map((row) => {
        const clip = clipOf(row.clipId);
        return {
          clipId: row.clipId,
          ref: clip?.ref ?? "",
          name: clip?.name ?? "cut",
          source: clip?.source ?? "editor",
          caption: finalCaption(captions[row.clipId] ?? "", tags, useTags),
          day: row.day,
          min: row.min,
        };
      }),
    }).catch(
      (): BatchState => ({ error: "something went wrong. try again." })
    );

    setBusy(false);

    if ("error" in result && result.error) {
      onSay(result.error, true);
      // a partial batch still landed, so the planner is now the honest view.
      if (result.scheduled && result.scheduled > 0) onDone(result.scheduled);
      return;
    }

    onSay(result.ok ?? "scheduled.");
    onDone(result.scheduled ?? rows.length);
  }

  /* ------------------------------------------------------------ the steps */

  return (
    <div>
      <ol className="mb-4 flex items-stretch gap-1 overflow-hidden rounded-card border border-line bg-paper p-1 shadow-card">
        {(
          [
            [1, "clips"],
            [2, "captions"],
            [3, "settings"],
            [4, "schedule"],
          ] as const
        ).map(([n, label]) => {
          const done = step > n;
          const now = step === n;
          return (
            <li key={n} className="min-w-0 flex-1">
              <button
                type="button"
                // only backwards. jumping ahead skips the guards in `go`, and a
                // creator landing on the schedule with nothing picked sees an
                // empty card and no reason for it.
                onClick={() => n < step && setStep(n as Step)}
                disabled={n > step}
                className={`flex w-full items-center justify-center gap-2 rounded-pill px-2 py-2 text-[13.5px] font-bold transition-colors ${
                  now
                    ? "bg-flame text-on-accent"
                    : done
                      ? "bg-ember text-flame-dark hover:bg-flame hover:text-on-accent"
                      : "text-ink-50"
                }`}
              >
                <span
                  className={`flex size-[21px] shrink-0 items-center justify-center rounded-pill text-[11.5px] font-extrabold ${
                    now
                      ? "bg-on-accent/25 text-on-accent"
                      : done
                        ? "bg-flame text-on-accent"
                        : "bg-shell text-ink-50"
                  }`}
                >
                  {done ? "✓" : n}
                </span>
                <span className="truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-extrabold tracking-[-0.02em]">
                the clips
              </h2>
              <p className="text-[12.5px] text-ink-50">
                tap to pick. the order you tap is the order they post.
              </p>
            </div>
            {picked.length > 0 && (
              <span className="ml-auto">
                <Ghost onClick={() => setPicked([])}>clear</Ghost>
              </span>
            )}
          </div>

          {/* the picked strip, and it is not decoration: the badges promise that
              order 1 posts first, and a numbered badge scattered across a grid
              is not a legible order. laid out left to right and draggable, it
              is one. only past two clips, because one clip is not an order and
              a rail restating a single tile is a rail that says nothing. */}
          {picked.length > 1 && (
            <div className="border-b border-line bg-shell px-5 py-3">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
                posting order · drag to change
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {picked.map((id, i) => {
                  const clip = clipOf(id);
                  return (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => setDragClip(id)}
                      onDragEnd={() => setDragClip(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragClip) reorder(dragClip, id);
                        setDragClip(null);
                      }}
                      title={clip?.name}
                      className={`flex cursor-grab items-center gap-2 rounded-pill border border-line bg-paper py-1 pl-1 pr-2.5 transition-opacity ${
                        dragClip === id ? "opacity-40" : ""
                      }`}
                    >
                      <span className="flex size-[22px] items-center justify-center rounded-pill bg-flame text-[11px] font-extrabold text-on-accent">
                        {i + 1}
                      </span>
                      <span className="max-w-[130px] truncate text-[12.5px] font-semibold">
                        {clip?.name ?? "cut"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/*
            Where a cut comes from, then the cuts.

            Two boxes and a grid, the same shape the new job form uses, because
            it is the same question: hand something over, from this machine or
            from the folder it already lives in. What was here before was an
            upload TILE wedged into the first cell of the clip grid, which on a
            brand with nothing delivered yet left one lonely dashed box floating
            in a screen of empty paper.

            Drive is an import, not a link. Upload-Post fetches the video from a
            url of ours, and a Drive share link is an html page with a player on
            it — attaching one would schedule a post that fails hours later on
            somebody else's server. So the bytes come through the browser and
            into our bucket, exactly as a local file does, and from `takeFiles`
            down nothing knows the difference.
          */}
          <div
            onDragOver={(e) => {
              // both halves are required: without preventDefault the browser
              // navigates to the file instead of handing it over.
              e.preventDefault();
              if (!uploading) setDragging(true);
            }}
            onDragLeave={(e) => {
              // dragleave also fires crossing INTO a child, so an unguarded one
              // makes the border flicker off every time the pointer passes over
              // a tile. only a leave that lands outside the body is a leave.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setDragging(false);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void takeFiles(Array.from(e.dataTransfer.files));
            }}
            className={`max-h-[560px] overflow-y-auto p-5 transition-colors ${
              dragging ? "bg-ember" : ""
            }`}
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <UploadBox
                uploading={uploading}
                progress={progress}
                onClick={() => fileRef.current?.click()}
              />

              {DRIVE_READY ? (
                null
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-line bg-shell px-5 py-7 text-center">
                  <p className="text-[15px] font-bold tracking-[-0.01em]">
                    from your editors
                  </p>
                  <p className="mt-1 text-[13px] leading-[1.5] text-ink-50">
                    {clips.length === 0
                      ? `nothing delivered for ${deal.brandName} yet`
                      : `${clips.length} cut${clips.length === 1 ? "" : "s"} waiting below`}
                  </p>
                </div>
              )}
            </div>

            {/* a grid of 9:16 tiles rather than a list of rows, because every
                clip in here is a vertical cut and nine near-identical rows of
                filename tell you nothing a frame tells you instantly. */}
            {library.length > 0 ? (
              <>
                <p className="mb-2.5 mt-5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
                  {clips.length > 0 ? `ready for ${deal.brandName}` : "your uploads"}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {library.map((clip) => {
                    const at = picked.indexOf(clip.id);
                    const on = at > -1;
                    return (
                      <button
                        type="button"
                        key={clip.id}
                        onClick={() => togglePick(clip.id)}
                        aria-pressed={on}
                        className="group/tile text-left"
                      >
                        <span
                          className={`relative block overflow-hidden rounded-xl border-2 transition-colors ${
                            on
                              ? "border-flame"
                              : "border-transparent group-hover/tile:border-line"
                          }`}
                        >
                          <ClipThumb src={clip.previewUrl} size="tile" />
                          <span
                            className={`absolute left-1.5 top-1.5 flex size-[24px] items-center justify-center rounded-pill text-[11px] font-extrabold ${
                              on
                                ? "bg-flame text-on-accent"
                                : "border-[1.5px] border-paper/80 bg-ink/25 text-paper"
                            }`}
                          >
                            {on ? at + 1 : ""}
                          </span>
                          {clip.source !== "editor" && (
                            <span className="absolute right-1.5 top-1.5 rounded-pill bg-ink/55 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-paper">
                              {clip.source === "upload" ? "yours" : "variation"}
                            </span>
                          )}
                        </span>
                        <span className="mt-1.5 block truncate text-[13px] font-semibold">
                          {clip.name}
                        </span>
                        <span className="block truncate text-[12px] text-ink-50">
                          {clip.by} · {clip.when}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="mt-5 text-center text-[13.5px] text-ink-50">
                nothing from your editors or Variations for {deal.name} yet. drop
                your own cuts anywhere on this card.
              </p>
            )}
          </div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* three jobs used to share one row: typing a tag, resetting to the
              brand's preset, and saving a new one. they are a different kind of
              act at a different frequency, so the typing sits on its own line
              and the two preset buttons are a footer under a rule. */}
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">hashtags</h2>
                <p className="text-[12.5px] text-ink-50">
                  one list for the whole batch. tap a tag to drop it.
                </p>
              </div>
              <span className="ml-auto shrink-0">
                <Switch
                  on={useTags}
                  onClick={() => setUseTags((v) => !v)}
                  label="append to every caption"
                />
              </span>
            </div>

            <div className="px-5 py-4">
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    onClick={() => setTags(tags.filter((t) => t !== tag))}
                    className={`rounded-pill px-3 py-1 text-[12.5px] font-bold transition-colors ${
                      useTags
                        ? "bg-ember text-flame-dark hover:bg-flame hover:text-on-accent"
                        : "bg-shell text-ink-50"
                    }`}
                  >
                    {tag} ✕
                  </button>
                ))}
                {tags.length === 0 && (
                  <span className="text-[12.5px] text-ink-50">no hashtags yet</span>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-pill border border-line px-3 py-2 focus-within:border-flame">
                <span className="text-[13px] font-bold text-ink-50">#</span>
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " " || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="type a hashtag, hit enter"
                  className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold outline-none placeholder:font-normal placeholder:text-ink-50"
                />
                <span
                  className={`shrink-0 text-[12px] font-bold ${
                    tagChars > 150 ? "text-flame-dark" : "text-ink-50"
                  }`}
                >
                  {tagChars} chars
                </span>
                <button
                  type="button"
                  onClick={addTag}
                  className="shrink-0 rounded-pill bg-flame px-3 py-1 text-[13px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
                >
                  add
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-shell px-5 py-3">
              <span className="text-[12.5px] text-ink-50">
                a saved preset comes back on every batch for {deal.brandName}
              </span>
              <span className="ml-auto flex flex-wrap gap-2">
                <Ghost onClick={() => setTags(initialHashtags)}>reset to preset</Ghost>
                <Ghost
                  onClick={async () => {
                    const res = await savePostPreset(deal.id, tags, options);
                    onSay(res.error ?? res.ok ?? "saved.", Boolean(res.error));
                  }}
                >
                  save as preset
                </Ghost>
              </span>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-4">
              <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">captions</h2>
              <span className="text-[13.5px] text-ink-50">
                {picked.length} video{picked.length === 1 ? "" : "s"}, in posting order
              </span>
              <Ghost
                className="ml-auto"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? `uploading ${Math.round(progress * 100)}%` : "add more"}
              </Ghost>
            </div>

            <div className="divide-y divide-line/60">
              {picked.map((id, i) => {
                const clip = clipOf(id);
                const caption = captions[id] ?? "";
                // what actually goes out, tags and all. the count that matters
                // is this one, not the length of the box: a caption inside the
                // limit plus twelve tags is a post that fails on send, and
                // finding that out from a red toast an hour later is the whole
                // thing this line exists to prevent.
                const full = finalCaption(caption, tags, useTags);
                const over = full.length > MAX_CAPTION;
                return (
                  <div key={id} className="flex gap-3 px-5 py-4">
                    <div className="relative shrink-0">
                      <ClipThumb src={clip?.previewUrl ?? null} size="lg" />
                      <span className="absolute -left-1.5 -top-1.5 flex size-5 items-center justify-center rounded-pill bg-flame text-[10px] font-extrabold text-on-accent">
                        {i + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-ink-50">
                          {clip?.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPicked((p) => p.filter((x) => x !== id));
                            setCaptions((c) => {
                              const next = { ...c };
                              delete next[id];
                              return next;
                            });
                          }}
                          className="ml-auto shrink-0 text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-flame"
                        >
                          remove
                        </button>
                      </div>
                      <textarea
                        rows={2}
                        value={caption}
                        maxLength={MAX_CAPTION}
                        onChange={(e) =>
                          setCaptions({ ...captions, [id]: e.target.value })
                        }
                        placeholder="what this one says"
                        className="mt-1.5 w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-[14px] leading-[1.5] outline-none focus:border-flame"
                      />

                      <div className="mt-1.5 flex items-start gap-3">
                        <p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-ink-50">
                          {full ? (
                            <>
                              <span className="font-bold uppercase tracking-[0.08em]">
                                goes out as{" "}
                              </span>
                              <span className="text-ink-70">{full}</span>
                            </>
                          ) : (
                            "no caption. it will go out with none."
                          )}
                        </p>
                        <span
                          className={`shrink-0 text-[12px] font-bold ${
                            over ? "text-flame-dark" : "text-ink-50"
                          }`}
                        >
                          {full.length}/{MAX_CAPTION}
                        </span>
                      </div>
                      {over && (
                        <p className="mt-1 text-[12px] font-bold text-flame-dark">
                          too long with the tags on. trim it or drop a tag.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <BrandMark name={deal.brandName} logo={deal.logo} size="sm" />
              <div className="min-w-0">
                <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">post to</h2>
                <p className="text-[12.5px] text-ink-50">
                  the accounts logged in under {deal.brandName}
                </p>
              </div>
              <span className="ml-auto text-[13.5px] font-extrabold">
                {platforms.length} picked
              </span>
            </div>

            {/*
              Not connected used to be a grey pill and a sentence pointing at
              another page, which is a dead end at the exact moment somebody has
              decided they want the account. The connect button goes on the card
              instead.

              Honest note on what that button is: Upload-Post's connect link is
              ONE page per deal where the person picks a platform themselves, not
              a per-platform oauth we can deep link into. So all four buttons are
              literally the same call and only the label makes them specific.
              `manage={false}` because a card that is offering to connect is by
              definition looking at a platform that is not connected yet.
            */}
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {PLATFORMS.map((p) => {
                const on = platforms.includes(p);
                const live = connected[p];

                if (!live) {
                  return (
                    <div
                      key={p}
                      className="flex items-center gap-3 rounded-card border border-dashed border-line bg-shell px-4 py-3"
                    >
                      <span className="opacity-40">
                        <PlatformGlyph platform={p} tone="brand" className="size-[26px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-bold text-ink-70">
                          {PLATFORM_LABEL[p]}
                        </span>
                        <span className="block text-[12.5px] text-ink-50">not connected</span>
                      </span>
                      <span className="ml-auto shrink-0">
                        <ConnectButton
                          dealId={deal.id}
                          manage={false}
                          origin="social"
                          tone="line"
                          label="connect"
                        />
                      </span>
                    </div>
                  );
                }

                return (
                  <button
                    type="button"
                    key={p}
                    onClick={() =>
                      setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p])
                    }
                    aria-pressed={on}
                    className={`flex items-center gap-3 rounded-card border-2 px-4 py-3 text-left transition-colors ${
                      on ? "bg-ember" : "border-line bg-paper hover:bg-shell"
                    }`}
                    style={on ? { borderColor: PLATFORM_COLOR[p] } : undefined}
                  >
                    <PlatformGlyph platform={p} tone="brand" className="size-[26px]" />
                    <span className="min-w-0">
                      <span className="block text-[14px] font-bold">{PLATFORM_LABEL[p]}</span>
                      <span className="block truncate text-[12.5px] text-ink-50">
                        {deal.handle ? `@${deal.handle.replace(/^@/, "")}` : "connected"}
                      </span>
                    </span>
                    <span className="ml-auto shrink-0">
                      <Box on={on} />
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          {/*
            Only the picked platforms get a card, same as before. What changed is
            what is on one: every field upload-post actually sends now has a
            control, which is around twenty five of them, and twenty five
            switches in a stack is a wall nobody reads. So each card is split -
            the things a creator changes per batch are visible, and the things
            they set once a year are behind "more". The three disclosure toggles
            are the exception: they are grouped and worded plainly wherever they
            sit, because a mislabelled paid partnership is the platform's
            problem to take down, not a preference.
          */}
          {platforms.includes("tiktok") && (
            <PlatformCard platform="tiktok">
              <Row label="who can view">
                <Choose
                  value={options.tiktok.privacy}
                  options={["Public", "Friends", "Followers", "Private"]}
                  onChange={(v) => patch.tiktok({ privacy: v as "Public" })}
                />
              </Row>
              <Switch
                on={options.tiktok.comments}
                label="allow comments"
                onClick={() => patch.tiktok({ comments: !options.tiktok.comments })}
              />
              <Switch
                on={options.tiktok.duet}
                label="allow duet"
                onClick={() => patch.tiktok({ duet: !options.tiktok.duet })}
              />
              <Switch
                on={options.tiktok.stitch}
                label="allow stitch"
                onClick={() => patch.tiktok({ stitch: !options.tiktok.stitch })}
              />

              <More>
                <Row label="cover frame">
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={options.tiktok.coverSecond}
                      onChange={(e) =>
                        patch.tiktok({ coverSecond: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-20 rounded-pill border border-line bg-paper px-3 py-1.5 text-[13px] font-semibold outline-none focus:border-flame"
                    />
                    <span className="text-[12.5px] text-ink-50">
                      seconds in. the frame tiktok shows on your grid.
                    </span>
                  </span>
                </Row>

                <Switch
                  on={options.tiktok.draft}
                  label="send as a draft instead of posting"
                  onClick={() => patch.tiktok({ draft: !options.tiktok.draft })}
                />
                {options.tiktok.draft && (
                  <Warn>
                    draft mode lands it in your tiktok inbox and you finish it in the app.
                    tiktok throws away everything above when it does: caption, privacy,
                    comments, duet, stitch, cover, all of it.
                  </Warn>
                )}

                <Disclosures>
                  <Switch
                    on={options.tiktok.branded}
                    label="paid partnership with another brand"
                    onClick={() => patch.tiktok({ branded: !options.tiktok.branded })}
                  />
                  <Switch
                    on={options.tiktok.ownBrand}
                    label="promoting my own business"
                    onClick={() => patch.tiktok({ ownBrand: !options.tiktok.ownBrand })}
                  />
                  <Switch
                    on={options.tiktok.aiGenerated}
                    label="made with ai"
                    onClick={() => patch.tiktok({ aiGenerated: !options.tiktok.aiGenerated })}
                  />
                </Disclosures>
              </More>
            </PlatformCard>
          )}

          {platforms.includes("instagram") && (
            <PlatformCard platform="instagram">
              <Row label="post as">
                <Choose
                  value={options.instagram.mediaType}
                  options={["Reel", "Story"]}
                  onChange={(v) => patch.instagram({ mediaType: v as "Reel" })}
                />
              </Row>
              {options.instagram.mediaType === "Story" ? (
                <Warn>
                  a story is gone in 24 hours and does not take a collaborator. if this is
                  the deliverable a brand is paying for, post it as a reel.
                </Warn>
              ) : (
                <>
                  <Switch
                    on={options.instagram.shareToFeed}
                    label="also share to feed"
                    onClick={() =>
                      patch.instagram({ shareToFeed: !options.instagram.shareToFeed })
                    }
                  />
                  <Row label="collaborator">
                    <span className="flex items-center gap-2">
                      <input
                        value={options.instagram.collab}
                        placeholder="brandhandle"
                        onChange={(e) => patch.instagram({ collab: e.target.value })}
                        className="w-44 rounded-pill border border-line bg-paper px-3 py-1.5 text-[13px] font-semibold outline-none focus:border-flame"
                      />
                      <span className="text-[12.5px] text-ink-50">
                        no @. they have to accept it.
                      </span>
                    </span>
                  </Row>
                </>
              )}

              <More>
                <Row label="audio name">
                  <span className="flex items-center gap-2">
                    <input
                      value={options.instagram.audioName}
                      placeholder="original audio name"
                      onChange={(e) => patch.instagram({ audioName: e.target.value })}
                      className="w-44 rounded-pill border border-line bg-paper px-3 py-1.5 text-[13px] font-semibold outline-none focus:border-flame"
                    />
                    <span className="text-[12.5px] text-ink-50">
                      renames the reel&apos;s original audio. instagram allows this once.
                    </span>
                  </span>
                </Row>

                <Disclosures>
                  <Switch
                    on={options.instagram.aiGenerated}
                    label="made with ai"
                    onClick={() =>
                      patch.instagram({ aiGenerated: !options.instagram.aiGenerated })
                    }
                  />
                </Disclosures>
              </More>
            </PlatformCard>
          )}

          {platforms.includes("youtube") && (
            <PlatformCard platform="youtube">
              <Row label="visibility">
                <Choose
                  value={options.youtube.visibility}
                  options={["Public", "Unlisted", "Private"]}
                  onChange={(v) => patch.youtube({ visibility: v as "Public" })}
                />
              </Row>
              <Row label="category">
                <Choose
                  value={options.youtube.category}
                  options={[...YOUTUBE_CATEGORIES]}
                  onChange={(v) => patch.youtube({ category: v })}
                />
              </Row>
              <Switch
                on={options.youtube.madeForKids}
                label="made for kids"
                onClick={() => patch.youtube({ madeForKids: !options.youtube.madeForKids })}
              />

              <More>
                {/* youtube's own tag field, which is NOT the caption hashtags.
                    same word, two different lists, and mixing them is why this
                    one says so on the line. */}
                <Field label="youtube tags">
                  <TagBox
                    tags={options.youtube.tags}
                    onChange={(next) => patch.youtube({ tags: next })}
                  />
                  <p className="mt-1.5 text-[12.5px] text-ink-50">
                    youtube&apos;s own tags, separate from the hashtags in your caption.
                  </p>
                </Field>

                <div className="mt-3">
                  <Row label="license">
                    <Choose
                      value={options.youtube.license}
                      options={["Standard", "Creative Commons"]}
                      onChange={(v) => patch.youtube({ license: v as "Standard" })}
                    />
                  </Row>
                  <Switch
                    on={options.youtube.embeddable}
                    label="let other sites embed it"
                    onClick={() => patch.youtube({ embeddable: !options.youtube.embeddable })}
                  />
                </div>

                <Disclosures>
                  <Switch
                    on={options.youtube.paidPromotion}
                    label="contains paid promotion"
                    onClick={() =>
                      patch.youtube({ paidPromotion: !options.youtube.paidPromotion })
                    }
                  />
                  <Switch
                    on={options.youtube.aiGenerated}
                    label="made with ai"
                    onClick={() =>
                      patch.youtube({ aiGenerated: !options.youtube.aiGenerated })
                    }
                  />
                </Disclosures>
              </More>
            </PlatformCard>
          )}

          {platforms.includes("facebook") && (
            <PlatformCard platform="facebook">
              <Row label="post as">
                <Choose
                  value={options.facebook.mediaType}
                  options={["Reel", "Story", "Video"]}
                  onChange={(v) => patch.facebook({ mediaType: v as "Reel" })}
                />
              </Row>
              {options.facebook.mediaType === "Story" && (
                <Warn>a facebook story is gone in 24 hours.</Warn>
              )}

              <More>
                <Switch
                  on={options.facebook.draft}
                  label="save to the page as a draft"
                  onClick={() => patch.facebook({ draft: !options.facebook.draft })}
                />
                {options.facebook.draft && (
                  <Warn>
                    it lands unpublished on the page and somebody has to press publish there.
                    the schedule below still runs, it just does not go live on its own.
                  </Warn>
                )}
              </More>
            </PlatformCard>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          {/* the spread. four controls that between them compute every row
              below, so they get their own card above the result rather than
              sitting in the same list as the thing they generate. the two
              pill groups are each drawn as ONE segmented control, because
              "2h" and "3h" are not two buttons, they are two positions of
              the same switch. */}
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">timing</h2>
                <p className="text-[12.5px] text-ink-50">
                  changing any of these redraws every row and drops hand edits
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-4 px-5 py-4">
              <Field label="first post">
                <DateBox
                  value={cfg.start}
                  onChange={(v) => setSpread({ start: v })}
                  min={todayKey}
                />
              </Field>
              <Field label="start time">
                <TimeBox
                  value={cfg.startMin}
                  onChange={(v) => setSpread({ startMin: v })}
                />
              </Field>

              {picked.length > 1 && (
                <>
                  <Field label="gap between posts">
                    <Segmented>
                      {GAPS.map((g) => (
                        <Seg key={g} on={cfg.gap === g} onClick={() => setSpread({ gap: g })}>
                          {g / 60}h
                        </Seg>
                      ))}
                    </Segmented>
                  </Field>
                  <Field label="per day">
                    <Segmented>
                      {PER_DAY.map((n) => (
                        <Seg
                          key={n}
                          on={cfg.perDay === n}
                          onClick={() => setSpread({ perDay: n })}
                        >
                          {n}
                        </Seg>
                      ))}
                    </Segmented>
                  </Field>
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
              <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">going out</h2>
              <span className="text-[13.5px] text-ink-50">
                {rows.length} post{rows.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                {platforms.map((p) => (
                  <PlatformGlyph key={p} platform={p} tone="brand" className="size-[18px]" />
                ))}
              </span>
            </div>

            {rows.map((row, i) => {
              const clip = clipOf(row.clipId);
              const newDay = i === 0 || rows[i - 1].day !== row.day;
              const onDay = rows.filter((r) => r.day === row.day).length;
              const moved = Boolean(edits[row.clipId]);
              return (
                <div key={row.clipId}>
                  {/* the day heading has to out-rank the rows under it or the
                      whole thing reads as one flat list of times. so: shell
                      ground, ink rather than ink-50, and the count of what
                      lands that day, which is the number somebody is actually
                      checking when they scan this. */}
                  {newDay && (
                    <div className="flex items-center gap-2 border-t border-line bg-shell px-5 py-2.5">
                      <span className="text-[13.5px] font-extrabold tracking-[-0.01em]">
                        {parseDay(row.day).toLocaleDateString(undefined, {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      <span className="rounded-pill bg-paper px-2 py-0.5 text-[11.5px] font-bold text-ink-50">
                        {onDay} post{onDay === 1 ? "" : "s"}
                      </span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 border-t border-line/60 px-5 py-3">
                    {/* the time is the left gutter, the way a schedule reads,
                        and it is the input itself rather than text with a
                        picker next to it. one thing, not two. */}
                    <TimeBox
                      value={row.min}
                      big
                      onChange={(v) =>
                        setEdits((prev) => ({
                          ...prev,
                          [row.clipId]: { day: row.day, min: v },
                        }))
                      }
                    />
                    <ClipThumb src={clip?.previewUrl ?? null} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">
                        {finalCaption(captions[row.clipId] ?? "", tags, useTags) ||
                          "no caption"}
                      </p>
                      <p className="truncate text-[12.5px] text-ink-50">
                        {clip?.name}
                        {moved && " · moved by hand"}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {platforms.map((p) => (
                        <PlatformGlyph
                          key={p}
                          platform={p}
                          tone="brand"
                          className="size-[18px]"
                        />
                      ))}
                    </span>
                    <DateBox
                      value={row.day}
                      quiet
                      onChange={(v) =>
                        setEdits((prev) => ({
                          ...prev,
                          [row.clipId]: { day: v, min: row.min },
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* the footer is a bar, not three loose things at the bottom of a scroll.
          it sticks, because on step 2 with nine captions the button that ends
          the batch was several screens below the last thing anybody typed. the
          middle line is the running state of the step, which is also the
          sentence that explains a disabled next. */}
      <div className="sticky bottom-3 z-10 mt-5 flex flex-wrap items-center gap-3 rounded-card border border-line bg-paper px-4 py-3 shadow-card">
        {step > 1 ? (
          <Ghost onClick={() => setStep((step - 1) as Step)}>← back</Ghost>
        ) : (
          <span className="hidden sm:block" />
        )}

        <span className="text-[13.5px] font-semibold text-ink-50">
          {step === 1 &&
            (picked.length === 0
              ? "pick at least one clip"
              : `${picked.length} clip${picked.length === 1 ? "" : "s"}, in this order`)}
          {step === 2 && `${picked.length} caption${picked.length === 1 ? "" : "s"}`}
          {step === 3 &&
            (platforms.length === 0
              ? "pick at least one platform"
              : `${platforms.length} platform${platforms.length === 1 ? "" : "s"}`)}
          {step === 4 && `${rows.length} post${rows.length === 1 ? "" : "s"} ready`}
        </span>

        {step < 4 ? (
          <button
            type="button"
            onClick={() => go((step + 1) as Step)}
            className="ml-auto rounded-pill bg-flame px-6 py-2.5 text-[14px] font-extrabold text-on-accent transition-colors hover:bg-flame-dark"
          >
            next →
          </button>
        ) : (
          <button
            type="button"
            onClick={confirm}
            disabled={busy || rows.length === 0}
            className="ml-auto rounded-pill bg-flame px-6 py-2.5 text-[14px] font-extrabold text-on-accent transition-colors hover:bg-flame-dark disabled:bg-flame/40"
          >
            {busy
              ? "scheduling"
              : `schedule ${rows.length} post${rows.length === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      <FilePicker inputRef={fileRef} onFiles={takeFiles} />
    </div>
  );
}

/* ------------------------------------------------------------- the pieces */

function FilePicker({
  inputRef,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="video/*"
      multiple
      className="sr-only"
      aria-label="pick videos"
      onChange={(e) => onFiles(Array.from(e.target.files ?? []))}
    />
  );
}

/** Every step is one of these. The `pad` escape hatch is gone: half the cards
 *  used it and half did not, which is why the four steps used to sit at four
 *  different insets. Padding belongs to the band inside, so a card can carry a
 *  header, a scrolling body and a footer that all line up. */
function Card({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-paper shadow-card">
      {children}
    </section>
  );
}

function Ghost({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-pill border border-line bg-paper px-3.5 py-1.5 text-[13px] font-semibold text-ink-70 transition-colors hover:border-flame/45 hover:text-flame disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A set of choices that is one control, not four buttons.
 *
 * "2h / 3h / 4h" is a single question with four answers, and four separate
 * outlined pills say the opposite: four things you could press. One track with
 * the picked position filled in says it once.
 */
function Segmented({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-0.5 rounded-pill border border-line bg-shell p-0.5">
      {children}
    </div>
  );
}

function Seg({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`min-w-[38px] rounded-pill px-3 py-1 text-[12.5px] font-bold transition-colors ${
        on ? "bg-flame text-on-accent" : "text-ink-50 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * The native date and time inputs, wearing the app's clothes.
 *
 * They stay native on purpose. A hand-rolled picker is a calendar popover, a
 * keyboard trap and a locale problem for something the browser already does
 * correctly, on a phone especially. What was wrong was never the input, it was
 * that it sat there as raw browser chrome next to hand-built pills. So the
 * border comes off the control and goes on a wrapper the rest of the file
 * already knows how to draw, and the wrapper lights up on focus-within so it
 * still behaves like a field.
 */
function DateBox({
  value,
  onChange,
  min,
  quiet,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  /** the per-row version: quieter, because the day heading above it is already
   *  saying which day this is and this is only here to move it off. */
  quiet?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border border-line focus-within:border-flame ${
        quiet ? "bg-shell px-2 py-1" : "bg-paper px-3 py-1.5"
      }`}
    >
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-transparent font-semibold outline-none ${
          quiet ? "text-[12.5px] text-ink-50" : "text-[13px]"
        }`}
      />
    </span>
  );
}

function TimeBox({
  value,
  onChange,
  big,
}: {
  /** minutes from midnight, the only unit the plan ever carries */
  value: number;
  onChange: (next: number) => void;
  /** the schedule's left gutter: the time is the row's heading, so it is set in
   *  the row's own weight rather than in field type. */
  big?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-pill border border-line focus-within:border-flame ${
        big ? "bg-shell px-2.5 py-1" : "bg-paper px-3 py-1.5"
      }`}
    >
      <input
        type="time"
        value={toTimeInput(value)}
        onChange={(e) => onChange(fromTimeInput(e.target.value))}
        className={`bg-transparent outline-none ${
          big ? "text-[13.5px] font-extrabold tracking-[-0.01em]" : "text-[13px] font-semibold"
        }`}
      />
    </span>
  );
}

function Switch({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="flex w-full items-center gap-2.5 py-1.5 text-left"
    >
      <span
        className={`flex h-5 w-[34px] shrink-0 items-center rounded-pill p-0.5 transition-colors ${
          on ? "justify-end bg-flame" : "justify-start bg-line"
        }`}
      >
        <span className="size-4 rounded-pill bg-paper" />
      </span>
      <span className="text-[13.5px] font-bold">{label}</span>
    </button>
  );
}

function Choose({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer rounded-pill border border-line bg-paper px-3 py-1.5 text-[12.5px] font-bold outline-none focus:border-flame"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-3">
      <span className="w-24 text-[13.5px] font-bold">{label}</span>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
        {label}
      </p>
      {children}
    </div>
  );
}

/**
 * One platform's settings card.
 *
 * The header carries the platform's own mark rather than a coloured dot: a dot
 * is a colour you have to have learned, and four of these are stacked down the
 * step where the mark is the fastest thing on the page to find. The stripe under
 * the header is the one other place `PLATFORM_COLOR` earns its keep, because it
 * ties the card to the chip that turned it on.
 */
function PlatformCard({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-paper shadow-card">
      <div className="h-[3px] w-full" style={{ background: PLATFORM_COLOR[platform] }} />
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
        <PlatformGlyph platform={platform} tone="brand" className="size-[22px]" />
        <h2 className="text-[16px] font-extrabold tracking-[-0.02em]">
          {PLATFORM_LABEL[platform]}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * The rarer half of a platform's settings.
 *
 * Native `<details>` rather than state, same reason the deal forms use one: the
 * browser owns "is it open", so nothing here has to be lifted or reset. Not
 * `FoldPanel` from `ui.tsx` even though it is the same idea, because that one is
 * a whole card with its own border, shadow and title, and this sits INSIDE a
 * card already. Nesting it draws a card in a card.
 */
function More({ children }: { children: ReactNode }) {
  return (
    <details className="group mt-3 border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-bold text-ink-50 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 transition-transform group-open:rotate-180"
          aria-hidden="true"
        >
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        more
      </summary>
      <div className="mt-2.5">{children}</div>
    </details>
  );
}

/**
 * The three legally meaningful toggles, boxed together.
 *
 * Branded content, paid promotion and "made with ai" are not preferences. Every
 * one of the four platforms now demands the label, and an undisclosed paid
 * partnership is something they take the post down for. Grouping them under one
 * plain heading is the difference between a creator reading them and a creator
 * scrolling past three more switches.
 */
function Disclosures({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-shell px-4 py-3">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-50">
        what you have to declare
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** A consequence somebody needs to read before they leave the step, not an
 *  error. Ember rather than the live green, because nothing here is good news. */
function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="my-2 rounded-xl bg-ember px-3.5 py-2.5 text-[12.5px] font-semibold leading-[1.5] text-flame-dark">
      {children}
    </p>
  );
}

/**
 * A chip list you type into. Only youtube needs one, for its own tag field,
 * which is a different list from the caption hashtags however much the two words
 * look alike. Keeps its own draft rather than lifting it, because nothing
 * outside this box cares what is half typed in it.
 */
function TagBox({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const clean = draft.trim().replace(/^#/, "");
    setDraft("");
    if (!clean || tags.includes(clean)) return;
    onChange([...tags, clean]);
  };

  return (
    <div>
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="rounded-pill bg-ember px-3 py-1 text-[12.5px] font-bold text-flame-dark transition-colors hover:bg-flame hover:text-on-accent"
            >
              {tag} ✕
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-pill border border-line px-3 py-1.5 focus-within:border-flame">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="add a tag, hit enter"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-ink-50"
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-pill bg-flame px-3 py-0.5 text-[12.5px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
        >
          add
        </button>
      </div>
    </div>
  );
}

function Box({ on }: { on: boolean }) {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] ${
        on ? "border-flame bg-flame text-on-accent" : "border-line bg-paper"
      }`}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="size-3" aria-hidden="true">
          <path
            d="m5 13 4 4 10-10"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

/**
 * The upload bar.
 *
 * `uploadAutopostVideo` has always taken a progress callback and the wizard has
 * always ignored it, so a 200MB cut on hotel wifi was several minutes of a
 * label reading "uploading" that might equally have been a dead button. The
 * percentage is spelled out next to the bar because a bar that has not moved in
 * ten seconds and a bar that is stuck look identical without a number.
 */
function UploadBar({ fraction }: { fraction: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <span className="block">
      <span className="block h-2 overflow-hidden rounded-pill bg-shell">
        <span
          className="block h-full rounded-pill bg-flame transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="mt-1.5 block text-[12.5px] font-bold text-ink-50">
        {pct}% uploaded. keep this tab open.
      </span>
    </span>
  );
}

/**
 * Upload, as a box beside the drive one.
 *
 * It used to be a 9:16 tile wedged into the first cell of the clip grid, on the
 * argument that "where do my own cuts go" is best answered by the shape of the
 * thing. That reads fine next to nine delivered clips and terribly next to
 * none, which is the state every new brand starts in: one lonely dashed
 * rectangle in a screen of empty paper. Two equal boxes at the top say the same
 * thing at any number of clips.
 */
function UploadBox({
  uploading,
  progress,
  onClick,
}: {
  uploading: boolean;
  progress: number;
  onClick: () => void;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed px-5 py-7 text-center transition-colors ${
        uploading ? "border-flame bg-ember" : "border-line bg-shell"
      }`}
    >
      {uploading ? (
        <span className="w-full max-w-[260px]">
          <UploadBar fraction={progress} />
        </span>
      ) : (
        <>
          <UploadMark />
          <p className="mt-2 text-[15px] font-bold tracking-[-0.01em]">
            drop cuts here
          </p>
          <p className="mt-1 text-[13px] leading-[1.5] text-ink-50">
            mp4 up to 200mb
          </p>
          <button
            type="button"
            onClick={onClick}
            className="mt-3 rounded-pill bg-flame px-5 py-2 text-[13.5px] font-bold text-on-accent transition-colors hover:bg-flame-dark"
          >
            browse files
          </button>
        </>
      )}
    </div>
  );
}

function UploadMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 text-flame" aria-hidden="true">
      <path
        d="M12 16V4m0 0L8 8m4-4 4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
