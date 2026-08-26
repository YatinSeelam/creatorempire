"use client";

import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { BUCKET, fileExt, fileFamily, humanSize } from "@/lib/editing-files";
import { uploadToBucket } from "@/lib/storage-upload";

/**
 * The one uploader in the product. Drop files on it, drop a whole folder on it,
 * pick files, or pick a folder.
 *
 * Everything goes straight from the browser into the private bucket under the
 * folder the caller names, and only then does `onUploaded` get a chance to
 * record it. If that step fails the object comes back out, so storage never
 * holds a file the database has never heard of. That ordering is the whole
 * contract and it is why this owns the storage call rather than the caller.
 *
 * Two reasons it is not just an `<input type="file">`:
 *
 * - a creator's raw footage lives in a folder, and picking nineteen files out
 *   of a Finder window one shift-click at a time is the friction this removes.
 *   Dropped directories are walked with the entries api, which is the only way
 *   to read a folder out of a drop.
 * - it is used before the job exists (the new job form) and after it (the job
 *   page), and those two only differ by which folder and what `onUploaded`
 *   does. One component, two callers, no second upload path to keep in sync.
 *
 * Uploads run one at a time on purpose. A phone on hotel wifi sending three
 * videos in parallel is how all three time out.
 */

export type UploadedFile = {
  /** the object path inside the bucket */
  path: string;
  name: string;
  mime: string;
  size: number;
  /**
   * An `object:` url for the file that was just picked, so a caller can draw a
   * thumbnail without asking storage for anything.
   *
   * The bucket is private, so the alternative is a signed url per file — a
   * round trip each, for a picture that is only looked at on this screen, in
   * this session, by the person who just chose the file and already knows what
   * it looks like. The browser already has the bytes. It dies on reload, which
   * is fine: so does the rest of this form's unposted state.
   */
  preview?: string;
};

/**
 * One file on its way up.
 *
 * `pct` is real, not a guess: the upload goes out over XHR (see
 * `lib/storage-upload.ts`) precisely so there is a number to put here. A
 * spinner and the word "uploading" is what this had before, and on a 500MB
 * shoot that is several minutes of something that might equally be broken.
 */
export type UploadRow = {
  key: string;
  name: string;
  size: number;
  status: "waiting" | "uploading" | "done" | "failed";
  /** 0 to 100, whole numbers only. see `patch`. */
  pct: number;
  /** an `object:` url for the picked file, so a caller can draw the frame
   *  before a single byte has gone anywhere. */
  preview?: string;
  error?: string;
};

type Row = UploadRow;

/** dotfiles and Finder/Explorer litter. never what somebody meant to send. */
const JUNK = /^(\.|__MACOSX|Thumbs\.db$|desktop\.ini$)/i;

/** a folder drop is unbounded, and a creator who drags their whole Movies
 *  folder in should be told, not left uploading for an hour. */
const MAX_FILES = 200;
const MAX_DEPTH = 8;

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: FsEntry[]) => void, err?: () => void) => void };
};

async function walk(entry: FsEntry, out: File[], depth: number): Promise<void> {
  if (out.length >= MAX_FILES) return;

  if (entry.isFile && entry.file) {
    const file = await new Promise<File | null>((resolve) =>
      entry.file!(
        (f) => resolve(f),
        () => resolve(null)
      )
    );
    if (file && !JUNK.test(file.name)) out.push(file);
    return;
  }

  if (entry.isDirectory && entry.createReader && depth < MAX_DEPTH) {
    const reader = entry.createReader();
    // readEntries hands back at most 100 at a time and an empty array means
    // the end, so it has to be called until it does.
    for (;;) {
      const batch = await new Promise<FsEntry[]>((resolve) =>
        reader.readEntries(
          (e) => resolve(e),
          () => resolve([])
        )
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, out, depth + 1);
      if (out.length >= MAX_FILES) return;
    }
  }
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? []);
  const entries = items
    .map((item) =>
      typeof (item as unknown as { webkitGetAsEntry?: () => FsEntry | null })
        .webkitGetAsEntry === "function"
        ? (item as unknown as { webkitGetAsEntry: () => FsEntry | null }).webkitGetAsEntry()
        : null
    )
    .filter((e): e is FsEntry => Boolean(e));

  // no entries api (or a drop that carried plain files): take dt.files.
  if (entries.length === 0) {
    return Array.from(dt.files ?? []).filter((f) => !JUNK.test(f.name));
  }

  const out: File[] = [];
  for (const entry of entries) await walk(entry, out, 0);
  return out;
}

export function Dropzone({
  folder,
  accept,
  label,
  hint,
  disabled,
  disabledNote,
  onUploaded,
  onDone,
  compact,
  browseLabel = "choose files",
  hideDone,
  silent,
  onQueue,
  intakeRef,
  fill,
}: {
  /** storage prefix without a trailing slash, eg `user/<uid>` or `<job>/assets` */
  folder: string;
  accept?: string;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
  disabledNote?: string;
  /** record the row. return `{ error }` and the object is removed again. */
  onUploaded: (file: UploadedFile) => Promise<{ error?: string } | void>;
  /** fired once after a batch, when at least one file landed. */
  onDone?: () => void;
  compact?: boolean;
  /** the one filled button. the folder picker sits under it as plain text. */
  browseLabel?: string;
  /**
   * Drop finished rows from this component's own list.
   *
   * For a caller that draws its own list of what landed — the new job form
   * draws thumbnails — the built-in row is a second, uglier copy of the same
   * file two lines below the first. In-flight and failed rows always stay,
   * because nobody else knows about those.
   */
  hideDone?: boolean;
  /**
   * Draw no list at all.
   *
   * For a caller that renders the queue itself — the new job form draws a strip
   * of thumbnails with a progress bar on each — anything this component prints
   * is a second, worse copy of the same information a few lines away. That was
   * the bug: the word "uploading" appeared on the button, on a text row, and
   * nowhere useful, three times for one file.
   */
  silent?: boolean;
  /** every change to the queue, for a caller drawing its own. */
  onQueue?: (rows: UploadRow[]) => void;
  /**
   * A handle on "take these files", for a caller that gets files from
   * somewhere this component cannot see — the Drive picker downloads real
   * `File`s and has to put them somewhere.
   *
   * A ref rather than a prop of files, because handing the same array in twice
   * is indistinguishable from handing in two identical drops, and an effect
   * watching it would upload everything again on any re-render.
   */
  intakeRef?: { current: ((files: File[]) => void) | null };
  /** stretch to the height of whatever is beside it in a grid row. */
  fill?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [tooMany, setTooMany] = useState(false);

  // the caller gets the queue on every change. an effect rather than a call
  // inside the setter, because notifying a parent mid-render is the classic way
  // to get "cannot update a component while rendering a different component".
  useEffect(() => {
    onQueue?.(rows);
    // `onQueue` is an inline arrow at every call site, so depending on it would
    // fire this on every parent render forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const patch = (key: string, next: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const merged = { ...r, ...next };
        // progress fires dozens of times a second and every one of them is a
        // render of this component AND of whatever is drawing the queue. only a
        // whole percent is worth a repaint.
        if (merged.pct === r.pct && merged.status === r.status && merged.error === r.error) {
          return r;
        }
        return merged;
      })
    );

  // `preview` is passed in rather than looked up out of `rows`. `send` is called
  // from `take` in the same tick as the `setRows` that adds these rows, so the
  // `rows` this closure can see is the render BEFORE they existed and the lookup
  // came back undefined every time — which is why a landed image showed the
  // "IMAGE" fallback instead of itself.
  async function send(file: File, key: string, preview?: string): Promise<boolean> {
    patch(key, { status: "uploading", pct: 0 });

    const path = `${folder}/${key}.${fileExt(file.name)}`;
    const supabase = createClient();

    try {
      await uploadToBucket({
        bucket: BUCKET,
        path,
        file,
        onProgress: (fraction) =>
          patch(key, { pct: Math.min(99, Math.round(fraction * 100)) }),
      });
    } catch (err) {
      patch(key, {
        status: "failed",
        error: err instanceof Error ? err.message : "upload failed",
      });
      return false;
    }

    const result = await onUploaded({
      path,
      name: file.name.slice(0, 200),
      mime: file.type,
      size: file.size,
      preview,
    }).catch((err: unknown) => ({
      error: err instanceof Error ? err.message : "could not save that one",
    }));

    if (result && "error" in result && result.error) {
      // best effort: an orphan object is invisible either way, the row is what
      // every page reads.
      await supabase.storage.from(BUCKET).remove([path]);
      patch(key, { status: "failed", error: result.error });
      return false;
    }

    patch(key, { status: "done", pct: 100 });
    return true;
  }

  async function take(files: File[]) {
    if (busy || disabled) return;
    const usable = files.filter((f) => f.size > 0 && !JUNK.test(f.name));
    if (usable.length === 0) return;

    setTooMany(usable.length > MAX_FILES);
    const batch = usable.slice(0, MAX_FILES).map((file) => ({
      file,
      key: crypto.randomUUID(),
      // made here rather than after the upload, so the tile can draw the frame
      // while the bytes are still going out and keep it once they land.
      preview: URL.createObjectURL(file),
    }));

    setRows((prev) => [
      ...prev,
      ...batch.map(({ file, key, preview }) => ({
        key,
        name: file.name,
        size: file.size,
        status: "waiting" as const,
        pct: 0,
        preview,
      })),
    ]);

    setBusy(true);
    let any = false;
    for (const { file, key, preview } of batch) {
      const ok = await send(file, key, preview);
      any = any || ok;
    }
    setBusy(false);

    if (fileRef.current) fileRef.current.value = "";
    if (dirRef.current) dirRef.current.value = "";
    if (any) onDone?.();
  }

  const shown = silent
    ? []
    : hideDone
      ? rows.filter((r) => r.status !== "done")
      : rows;

  // "uploading 2 of 4" beats "uploading": on a folder drop the difference
  // between stuck and working is which number is on screen.
  const doneCount = rows.filter((r) => r.status === "done").length;

  // published in an effect rather than during render: writing to a ref while
  // rendering is a react rule violation, and the handle only has to be right by
  // the time somebody clicks something. `take` closes over `busy` and `folder`,
  // so a stale one would upload into the last render's folder — hence no
  // dependency list.
  useEffect(() => {
    if (!intakeRef) return;
    intakeRef.current = (files: File[]) => void take(files);
    return () => {
      intakeRef.current = null;
    };
  });

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    await take(await filesFromDrop(e.dataTransfer));
  }

  return (
    <div className={fill ? "flex h-full flex-col" : undefined}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`rounded-md border border-dashed text-center transition-colors ${
          compact ? "px-4 py-4" : "px-5 py-6"
        } ${fill ? "flex flex-1 flex-col items-center justify-center" : ""} ${
          disabled
            ? "border-line bg-shell opacity-70"
            : over
              ? "border-ink bg-shell"
              : "border-line bg-shell"
        }`}
      >
        <p className="text-[13.5px] font-bold tracking-[-0.01em]">{label}</p>
        {hint && (
          <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-[1.5] text-ink-50">
            {hint}
          </p>
        )}

        {disabled ? (
          disabledNote && <p className="mt-2 text-[12.5px] text-ink-50">{disabledNote}</p>
        ) : (
          // one filled button, and the folder picker as plain text under it.
          // two pills side by side read as two equally likely choices, and
          // picking a folder is the rarer of the two by a mile.
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-md bg-ink px-4 py-1.5 text-[12.5px] font-bold text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
            >
              {busy
                ? `uploading ${Math.min(doneCount + 1, rows.length)} of ${rows.length}`
                : browseLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => dirRef.current?.click()}
              className="text-[12px] font-semibold text-ink-50 underline decoration-line underline-offset-2 transition-colors hover:text-ink disabled:opacity-60"
            >
              or choose a whole folder
            </button>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        aria-label={label}
        onChange={(e) => void take(Array.from(e.target.files ?? []))}
      />
      {/* webkitdirectory is the folder picker. react does not type the two
          attributes, and both are needed for chrome and firefox. */}
      <input
        ref={dirRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={`${label} (folder)`}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => void take(Array.from(e.target.files ?? []))}
      />

      {tooMany && (
        <p className="mt-2 text-[12.5px] font-semibold text-flame-dark">
          that is more than {MAX_FILES} files. the first {MAX_FILES} are going up, send the
          rest after.
        </p>
      )}

      {shown.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {shown.map((row) => (
            <li key={row.key} className="flex min-w-0 items-baseline gap-2 text-[13px]">
              <span className="shrink-0 text-ink-50">
                {familyMark(fileFamily({ name: row.name }))}
              </span>
              <span className="truncate font-semibold text-ink-70">{row.name}</span>
              {row.size > 0 && (
                <span className="shrink-0 text-ink-50">{humanSize(row.size)}</span>
              )}
              <span
                className={`shrink-0 tabular-nums ${row.status === "failed" ? "text-flame-dark" : "text-ink-50"}`}
              >
                {row.status === "waiting"
                  ? "queued"
                  : row.status === "uploading"
                    ? `${row.pct}%`
                    : row.status === "done"
                      ? "done"
                      : (row.error ?? "failed")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function familyMark(family: ReturnType<typeof fileFamily>): string {
  return family === "video"
    ? "video"
    : family === "audio"
      ? "audio"
      : family === "image"
        ? "image"
        : family === "doc"
          ? "doc"
          : "file";
}
