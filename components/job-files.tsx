"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BUCKET, humanSize, type JobFileKind } from "@/lib/editing-files";

/**
 * The one uploader both sides of the marketplace share. Files go straight
 * from the browser into the private bucket under the path contract the
 * storage policies enforce, then a server action records the row. If that
 * record step fails the object is removed again, so storage never holds a
 * file the database has never heard of.
 */

export type RecordFileInput = {
  jobId: string;
  kind: JobFileKind;
  path: string;
  name: string;
  mime: string;
  size: number;
};

export type RecordFileResult = { error?: string };

type UploadItem = {
  key: string;
  name: string;
  size: number;
  status: "uploading" | "done" | "failed";
  error?: string;
};

/** `Final CUT v2!.MOV` → `mov`. Alphanumeric only, so the path stays clean. */
function fileExt(name: string): string {
  const raw = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10);
  return ext || "bin";
}

export function JobFileUpload({
  jobId,
  kind,
  record,
  label,
  hint,
}: {
  jobId: string;
  kind: JobFileKind;
  /** server action that writes the edit_job_files row (and, for cuts, the rest). */
  record: (input: RecordFileInput) => Promise<RecordFileResult>;
  label?: string;
  hint?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  // cuts arrive one at a time because each one is a delivery; assets in bulk.
  const multiple = kind !== "cut";

  const patch = (key: string, next: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...next } : it)));

  async function uploadOne(file: File): Promise<boolean> {
    const key = crypto.randomUUID();
    setItems((prev) => [
      ...prev,
      { key, name: file.name, size: file.size, status: "uploading" },
    ]);

    const path = `${jobId}/${kind === "cut" ? "cuts" : "assets"}/${key}.${fileExt(file.name)}`;
    const supabase = createClient();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) {
      patch(key, { status: "failed", error: uploadError.message });
      return false;
    }

    const result = await record({
      jobId,
      kind,
      path,
      name: file.name.slice(0, 200),
      mime: file.type,
      size: file.size,
    });

    if (result?.error) {
      // the row never landed, so the object comes back out. best effort: an
      // orphan here is invisible either way, the db is what the pages read.
      await supabase.storage.from(BUCKET).remove([path]);
      patch(key, { status: "failed", error: result.error });
      return false;
    }

    patch(key, { status: "done" });
    return true;
  }

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    setBusy(true);
    let any = false;
    // one at a time: a phone on hotel wifi uploading three videos in parallel
    // is how every one of them times out.
    for (const file of Array.from(list)) {
      const ok = await uploadOne(file);
      any = any || ok;
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    if (any) router.refresh();
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple={multiple}
        className="sr-only"
        aria-label={label ?? "upload files"}
        onChange={(e) => onPick(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-pill border border-line px-4 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink disabled:opacity-60"
      >
        {busy ? "uploading" : (label ?? (multiple ? "upload files" : "upload the file"))}
      </button>
      {hint && <p className="mt-1 text-[12.5px] text-ink-50">{hint}</p>}

      {items.length > 0 && (
        <ul className="mt-2 space-y-1">
          {items.map((it) => (
            <li
              key={it.key}
              className="flex min-w-0 items-baseline gap-2 text-[13px]"
            >
              <span className="truncate font-semibold text-ink-70">{it.name}</span>
              {it.size > 0 && (
                <span className="shrink-0 text-ink-50">{humanSize(it.size)}</span>
              )}
              <span
                className={`shrink-0 ${
                  it.status === "failed"
                    ? "text-flame-dark"
                    : it.status === "done"
                      ? "text-ink-50"
                      : "text-ink-50"
                }`}
              >
                {it.status === "uploading"
                  ? "uploading"
                  : it.status === "done"
                    ? "done"
                    : (it.error ?? "failed")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
