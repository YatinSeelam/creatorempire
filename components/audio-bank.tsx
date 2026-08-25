"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  audioUrl,
  categoriesFor,
  categoryLabel,
  matchesQuery,
  sizeLabel,
  trackClock,
  type AudioAsset,
  type AudioKind,
} from "@/lib/audio-library";

/**
 * The sound bank browser. One component, two hosts.
 *
 * The editors page mounts it in `download` mode and the variations tool mounts
 * it in `pick` mode inside a sheet. They are the same list, the same player and
 * the same filters, so they are the same component: the moment they were two,
 * one of them would get a search box and the other would not.
 *
 * The player is deliberately a single audio element held here rather than one
 * per row. A hundred and forty audio elements is a hundred and forty network
 * connections the moment anything preloads, and "only one thing plays at a
 * time" stops being a rule you have to enforce when there is only one thing.
 */

export const AUDIO_DRAG_TYPE = "application/x-ugc-audio";

type PickState = "idle" | "working" | "done";

export function AudioBank({
  assets,
  mode,
  onPick,
  pickLabel = "add",
  pickedLabel = "added",
  emptyLine = "nothing in the bank yet.",
  height = "min(60vh,560px)",
}: {
  assets: AudioAsset[];
  mode: "download" | "pick";
  /** pick mode only. resolve false to leave the row un-ticked. */
  onPick?: (asset: AudioAsset) => Promise<boolean>;
  pickLabel?: string;
  pickedLabel?: string;
  emptyLine?: string;
  height?: string;
}) {
  const kinds = useMemo(() => {
    const present = new Set(assets.map((a) => a.kind));
    return (["music", "sfx"] as AudioKind[]).filter((k) => present.has(k));
  }, [assets]);

  const [kind, setKind] = useState<AudioKind>(kinds[0] ?? "music");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [picks, setPicks] = useState<Record<string, PickState>>({});

  const ofKind = useMemo(() => assets.filter((a) => a.kind === kind), [assets, kind]);

  // the chips are the categories that actually have something in them, in the
  // order lib/audio-library.ts offers them, with anything unnamed on the end.
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of ofKind) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
    const known = categoriesFor(kind)
      .filter((c) => counts.has(c.key))
      .map((c) => ({ key: c.key, label: c.label, count: counts.get(c.key) ?? 0 }));
    const extra = [...counts.keys()]
      .filter((key) => !categoriesFor(kind).some((c) => c.key === key))
      .map((key) => ({ key, label: key, count: counts.get(key) ?? 0 }));
    return [...known, ...extra];
  }, [ofKind, kind]);

  const shown = useMemo(
    () =>
      ofKind.filter(
        (a) => (category === "all" || a.category === category) && matchesQuery(a, query)
      ),
    [ofKind, category, query]
  );

  const player = usePlayer();

  // switching tab keeps the search but drops a chip that does not exist on the
  // other side. leaving "cinematic" selected on the sfx tab shows nothing and
  // reads like a bug.
  const swap = (next: AudioKind) => {
    setKind(next);
    setCategory("all");
  };

  const pick = async (asset: AudioAsset) => {
    if (!onPick || picks[asset.id] === "working") return;
    setPicks((p) => ({ ...p, [asset.id]: "working" }));
    const ok = await onPick(asset).catch(() => false);
    setPicks((p) => ({ ...p, [asset.id]: ok ? "done" : "idle" }));
  };

  const line = categoriesFor(kind).find((c) => c.key === category)?.line;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5 sm:px-6">
        {kinds.length > 1 && (
          <div className="flex items-center gap-1 rounded-pill bg-shell p-1">
            {kinds.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => swap(k)}
                className={`h-8 rounded-pill px-4 text-[13px] font-semibold transition-colors ${
                  kind === k ? "bg-paper text-ink shadow-card" : "text-ink-50 hover:text-ink-70"
                }`}
              >
                {k === "music" ? "music" : "sfx"}
              </button>
            ))}
          </div>
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search"
          className="ml-auto h-9 w-[180px] rounded-pill border border-line bg-shell px-4 text-[13.5px] focus:border-flame focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3 sm:px-6">
        <Chip on={category === "all"} onClick={() => setCategory("all")}>
          all <Count>{ofKind.length}</Count>
        </Chip>
        {chips.map((c) => (
          <Chip key={c.key} on={category === c.key} onClick={() => setCategory(c.key)}>
            {c.label} <Count>{c.count}</Count>
          </Chip>
        ))}
        {line && <span className="hidden text-[12.5px] text-ink-50 lg:block">{line}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: height }}>
        {shown.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13.5px] text-ink-50">
            {ofKind.length === 0 ? emptyLine : "nothing matches that."}
          </p>
        ) : (
          <ul>
            {shown.map((asset) => (
              <TrackRow
                key={asset.id}
                asset={asset}
                mode={mode}
                player={player}
                pick={picks[asset.id] ?? "idle"}
                pickLabel={pickLabel}
                pickedLabel={pickedLabel}
                onPick={onPick ? () => pick(asset) : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── the one player ───────────────────────────────────────────────────────── */

type Player = ReturnType<typeof usePlayer>;

function usePlayer() {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    ref.current = el;
    const tick = () => setAt(el.duration > 0 ? el.currentTime / el.duration : 0);
    const stop = () => {
      setPlaying(false);
      setAt(0);
    };
    el.addEventListener("timeupdate", tick);
    el.addEventListener("ended", stop);
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("play", () => setPlaying(true));
    return () => {
      el.pause();
      el.src = "";
      el.removeEventListener("timeupdate", tick);
      el.removeEventListener("ended", stop);
    };
  }, []);

  const toggle = (asset: AudioAsset) => {
    const el = ref.current;
    const src = audioUrl(asset.storage_path);
    if (!el || !src) return;
    if (id === asset.id) {
      if (el.paused) void el.play().catch(() => setPlaying(false));
      else el.pause();
      return;
    }
    el.pause();
    el.src = src;
    el.currentTime = 0;
    setId(asset.id);
    setAt(0);
    void el.play().catch(() => setPlaying(false));
  };

  /** seek within whatever is loaded. a click on a row that is not playing
   *  starts it at that point, which is how everybody expects a waveform to
   *  behave and costs one extra branch. */
  const seek = (asset: AudioAsset, fraction: number) => {
    const el = ref.current;
    if (!el) return;
    if (id !== asset.id) {
      toggle(asset);
      // the duration is not known until metadata lands, so the seek waits for it.
      const once = () => {
        el.currentTime = el.duration * fraction;
        el.removeEventListener("loadedmetadata", once);
      };
      el.addEventListener("loadedmetadata", once);
      return;
    }
    if (el.duration > 0) el.currentTime = el.duration * fraction;
  };

  return { id, playing, at, toggle, seek };
}

/* ── a row ────────────────────────────────────────────────────────────────── */

function TrackRow({
  asset,
  mode,
  player,
  pick,
  pickLabel,
  pickedLabel,
  onPick,
}: {
  asset: AudioAsset;
  mode: "download" | "pick";
  player: Player;
  pick: PickState;
  pickLabel: string;
  pickedLabel: string;
  onPick?: () => void;
}) {
  const live = player.id === asset.id;
  const url = audioUrl(asset.storage_path);

  return (
    <li
      draggable
      onDragStart={(e) => {
        // the variations library panel reads this. text/plain rides along so a
        // drop onto a text field pastes the title rather than nothing at all.
        e.dataTransfer.setData(AUDIO_DRAG_TYPE, asset.id);
        e.dataTransfer.setData("text/plain", asset.title);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="group flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0 hover:bg-shell sm:px-6"
    >
      <button
        type="button"
        onClick={() => player.toggle(asset)}
        aria-label={live && player.playing ? `pause ${asset.title}` : `play ${asset.title}`}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border transition-colors ${
          live
            ? "border-flame bg-flame text-on-accent"
            : "border-line text-ink-70 hover:border-flame hover:text-flame"
        }`}
      >
        {live && player.playing ? <PauseGlyph /> : <PlayGlyph />}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-ink">{asset.title}</p>
        <p className="truncate text-[12px] text-ink-50">
          {categoryLabel(asset.kind, asset.category)}
          {asset.tags.length > 0 && ` · ${asset.tags.join(", ")}`}
          {mode === "download" && sizeLabel(asset.bytes) && ` · ${sizeLabel(asset.bytes)}`}
        </p>
      </div>

      <Wave
        peaks={asset.peaks}
        progress={live ? player.at : 0}
        onSeek={(fraction) => player.seek(asset, fraction)}
      />

      <span className="w-10 shrink-0 text-right text-[12px] tabular-nums text-ink-50">
        {trackClock(asset.duration_ms)}
      </span>

      {mode === "download" ? (
        <a
          href={url ? `${url}?download=${encodeURIComponent(`${asset.slug}.mp3`)}` : "#"}
          title={`download ${asset.title}`}
          aria-label={`download ${asset.title}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill border border-line text-ink-50 transition-colors hover:border-flame hover:bg-flame hover:text-on-accent"
        >
          <DownloadGlyph />
        </a>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {/* the same file, for somebody who cuts in capcut rather than here.
              quiet on purpose: adding to the bank is what this sheet is for,
              and a second loud button next to it would make that a choice. */}
          <a
            href={url ? `${url}?download=${encodeURIComponent(`${asset.slug}.mp3`)}` : "#"}
            title="download the file"
            aria-label={`download ${asset.title}`}
            className="flex h-8 w-8 items-center justify-center rounded-pill text-ink-50 transition-colors hover:bg-shell hover:text-flame"
          >
            <DownloadGlyph />
          </a>
          <button
            type="button"
            onClick={onPick}
            disabled={pick !== "idle"}
            className={`rounded-pill px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              pick === "done"
                ? "bg-ember text-flame"
                : "bg-flame text-on-accent hover:bg-flame-dark disabled:opacity-60"
            }`}
          >
            {pick === "done" ? pickedLabel : pick === "working" ? "adding" : pickLabel}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The waveform, as one svg path rather than 64 divs.
 *
 * 140 rows of 64 bars is 9,000 nodes, which a phone feels. Two clipped copies
 * of a single path give the played/unplayed split for six nodes a row.
 */
function Wave({
  peaks,
  progress,
  onSeek,
}: {
  peaks: number[];
  progress: number;
  onSeek: (fraction: number) => void;
}) {
  const d = useMemo(() => {
    if (!peaks.length) return "";
    const gap = 100 / peaks.length;
    const w = gap * 0.62;
    return peaks
      .map((p, i) => {
        const h = Math.max(1.5, (Math.min(100, Math.max(0, p)) / 100) * 22);
        const x = i * gap;
        return `M${x.toFixed(2)},${((24 - h) / 2).toFixed(2)}h${w.toFixed(2)}v${h.toFixed(2)}h-${w.toFixed(2)}z`;
      })
      .join("");
  }, [peaks]);

  // the clip id has to be stable across renders and unique across rows, which
  // is exactly what useId is for. deriving it from the progress value instead
  // would mint a new node on every timeupdate.
  const clip = useId().replace(/:/g, "");

  if (!d) return <div className="hidden w-[140px] lg:block" />;

  const cut = Math.max(0, Math.min(1, progress)) * 100;

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onSeek(box.width > 0 ? (e.clientX - box.left) / box.width : 0);
      }}
      className="hidden h-6 w-[140px] shrink-0 cursor-pointer lg:block"
    >
      <path d={d} className="fill-line" />
      <clipPath id={clip}>
        <rect x="0" y="0" width={cut} height="24" />
      </clipPath>
      <path d={d} className="fill-flame" clipPath={`url(#${clip})`} />
    </svg>
  );
}

/* ── small parts ──────────────────────────────────────────────────────────── */

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-pill border px-3.5 text-[13px] font-semibold transition-colors ${
        on ? "border-flame bg-ember text-flame" : "border-line text-ink-70 hover:border-flame"
      }`}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 text-[11.5px] font-semibold text-ink-50">{children}</span>;
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M4.5 2.8v10.4c0 .5.55.8.97.53l8.2-5.2a.63.63 0 0 0 0-1.06l-8.2-5.2A.63.63 0 0 0 4.5 2.8Z" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 2v7.4" />
      <path d="M4.9 6.6 8 9.7l3.1-3.1" />
      <path d="M2.9 12.6h10.2" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
      <path d="M4 2.6h3v10.8H4zM9 2.6h3v10.8H9z" />
    </svg>
  );
}
