"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { uploadAvatar } from "@/lib/portfolio-upload";

/**
 * The editor's photo, picked and uploaded before the form is submitted.
 *
 * It uploads on pick rather than on submit, and what the form carries is the
 * url in a hidden input. That is the same trade the portfolio editor makes and
 * it is the right one here for a specific reason: this sits inside a four step
 * wizard that is ONE form, so a File held in state until the last screen would
 * be a file the person chose three screens and possibly several minutes ago,
 * uploading on the one click they expect to be instant.
 *
 * `uploadAvatar` resizes to a 640px square webp in a canvas before anything
 * leaves the device, so a 4MB camera roll photo goes up as ~60KB. Every path
 * starts with the uploader's uid because that is what the `portfolio` bucket's
 * insert policy checks.
 */
export function AvatarPicker({
  userId,
  name,
  value,
  onChange,
}: {
  userId: string;
  /** only used for the initial, so the empty state is not a grey circle. */
  name: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // the input is cleared either way, so picking the same file twice after a
    // failure still fires a change event.
    e.target.value = "";
    if (!file) return;

    setError(null);
    setBusy(true);
    try {
      onChange(await uploadAvatar(file, userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "that upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const initial = (name.trim() || "?").charAt(0).toUpperCase();

  return (
    <div>
      {/* what the wizard's single form actually submits */}
      <input type="hidden" name="avatar_url" value={value} />

      <label className="mb-1.5 block text-[13px] font-semibold text-ink-70">
        your photo
      </label>

      <div className="flex items-center gap-4">
        <div className="relative size-[76px] shrink-0 overflow-hidden rounded-full border border-line bg-shell">
          {value ? (
            // straight from storage, and google avatars come from their host, so
            // there is no domain worth whitelisting for next/image here
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-[26px] font-extrabold text-ink-50">
              {initial}
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-paper/70 text-[11px] font-semibold text-ink-50">
              …
            </span>
          )}
        </div>

        <div className="min-w-0">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="h-9 rounded-pill border border-line px-4 text-[13px] font-semibold text-ink-50 transition-colors hover:border-flame hover:text-flame disabled:opacity-60"
          >
            {busy ? "uploading" : value ? "replace" : "upload a photo"}
          </button>
          <p className="mt-1.5 text-[12.5px] leading-[1.45] text-ink-50">
            a clear photo of your face. creators see this on every job you claim.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={pick}
        className="hidden"
      />

      {error && (
        <p className="mt-2 text-[12.5px] font-semibold text-flame-dark">{error}</p>
      )}
    </div>
  );
}
