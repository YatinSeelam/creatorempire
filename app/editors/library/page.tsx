import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AudioBank } from "@/components/audio-bank";
import { Panel } from "@/components/editors/ui";
import { audioUrl, kitLine, sizeLabel, type AudioKit } from "@/lib/audio-library";
import { loadAudioKits, loadAudioLibrary } from "@/lib/audio-library-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sound Library · Creator Empire",
  // the packs are the house's material, handed to people who cut for us. it is
  // not a public download page and it should not read like one.
  robots: { index: false, follow: false },
};

/**
 * The editor's starter kit.
 *
 * Everything a cut for us is allowed to sound like, in one place, in two
 * shapes. The packs at the top are for the editor who is setting up: pull them
 * once, drop them in premiere, never come back. The browser underneath is for
 * the editor mid-cut who needs one whoosh and does not want a 90mb download to
 * get it.
 *
 * Both halves point at the same files. There is no "pro" tier of sounds and no
 * per-editor selection, because the point of a house bank is that every cut
 * that comes back sounds like it came from the same place.
 */
export default async function EditorLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/editors/library");

  // the same predicate as the rest of /editors: being an editor is having a
  // row. somebody who has not signed up yet gets sent to the page that signs
  // them up rather than a locked panel that explains why they cannot look.
  const { data: editor } = await supabase
    .from("editors")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!editor) redirect("/editors");

  const [assets, kits] = await Promise.all([
    loadAudioLibrary(supabase),
    loadAudioKits(supabase),
  ]);

  const music = assets.filter((a) => a.kind === "music").length;
  const sfx = assets.filter((a) => a.kind === "sfx").length;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8">
      <header className="mb-6">
        <h1 className="text-[26px] font-bold tracking-[-0.02em] sm:text-[30px]">
          sound library
        </h1>
        <p className="mt-1.5 max-w-[62ch] text-[14px] leading-[1.5] text-ink-70">
          the music and sfx every cut for us is built from. {music} tracks across{" "}
          {new Set(assets.filter((a) => a.kind === "music").map((a) => a.category)).size} moods,{" "}
          {sfx} sound effects. hit play on anything to preview it, then pull the single
          file, or grab a whole pack once and work offline. all of it is 192k mp3.
        </p>
      </header>

      <div className="mb-5">
        <Panel title="browse" padded={false}>
          <AudioBank
            assets={assets}
            mode="download"
            height="min(64vh,640px)"
            emptyLine="the bank has not been filled yet. ask in the editing channel."
          />
        </Panel>
      </div>

      {kits.length > 0 && (
        <Panel
          title="packs"
          action={<span className="text-[12.5px] font-semibold text-ink-50">zip</span>}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kits.map((kit) => (
              <KitCard key={kit.file} kit={kit} />
            ))}
          </div>
          <p className="mt-4 text-[12.5px] leading-[1.5] text-ink-50">
            there is no one download for the lot on purpose. the music alone is
            about half a gig, and a mood is how you actually pick it. take the
            sfx pack plus the two or three moods your brands sound like. a mood
            split across numbered parts is still one folder, each part opens on
            its own.
          </p>
        </Panel>
      )}
    </div>
  );
}

function KitCard({ kit }: { kit: AudioKit }) {
  const url = audioUrl(`kits/${kit.file}`);
  const line = kitLine(kit);
  return (
    <a
      href={url ? `${url}?download=${encodeURIComponent(kit.file)}` : "#"}
      className="group flex items-start gap-3 rounded-xl border border-line bg-paper p-4 transition-colors hover:border-flame hover:bg-shell"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-shell text-ink-50 transition-colors group-hover:bg-ember group-hover:text-flame">
        <FolderGlyph />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold tracking-[-0.01em] text-ink group-hover:text-flame">
          {kit.label}
        </p>
        {line && <p className="mt-0.5 text-[12.5px] leading-[1.4] text-ink-50">{line}</p>}
        <p className="mt-2 text-[12px] font-semibold text-ink-50">
          {kit.tracks} {kit.tracks === 1 ? "file" : "files"}
          {kit.bytes > 0 && ` · ${sizeLabel(kit.bytes)}`}
        </p>
      </div>

      <span
        aria-hidden
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border border-line text-ink-50 transition-colors group-hover:border-flame group-hover:bg-flame group-hover:text-on-accent"
      >
        <DownloadGlyph />
      </span>
    </a>
  );
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M1.5 3.9c0-.72.58-1.3 1.3-1.3h2.9c.42 0 .81.2 1.05.54l.55.76h6c.72 0 1.3.58 1.3 1.3v6.7c0 .72-.58 1.3-1.3 1.3H2.8c-.72 0-1.3-.58-1.3-1.3V3.9Z" />
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
