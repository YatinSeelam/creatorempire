// Builds and publishes the shared audio library: the background music bank and
// the sfx bank that the variations tool drags onto a clip and the editors page
// hands out as a starter kit.
//
//   node scripts/audio-library.mjs build     # transcode the local folders into .audio-build/
//   node scripts/audio-library.mjs upload    # push the mp3s + the kit zips to storage
//   node scripts/audio-library.mjs seed      # upsert the rows into public.audio_assets
//   node scripts/audio-library.mjs all       # the three in order
//
// Source folders default to the two the founder handed over and can be pointed
// somewhere else with SFX_DIR / MUSIC_DIR. Music categories are the sub-folders
// of MUSIC_DIR verbatim, so adding a genre is a folder, not a code change.
//
// Everything is normalised to 192k stereo mp3 on purpose. The originals are a
// mix of 320k mp3, 12mbit wav and a few mp4 containers totalling 780mb, which is
// storage we would pay for twice (once to hold, once to serve) for quality that
// dies the moment tiktok re-encodes the upload at ~64k aac. One format also
// means one <audio> element, one download button and one ffmpeg input in the
// renderer. Peaks are computed here rather than in the browser so the library
// grid can draw 140 waveforms without decoding 300mb.

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const HOME = process.env.HOME ?? "";
const SFX_DIR = process.env.SFX_DIR ?? join(HOME, "Downloads/UGC ACADEMY SFX");
const MUSIC_DIR = process.env.MUSIC_DIR ?? join(HOME, "Downloads/UGC ACADEMY BACKGROUND MUSIC");
const BUILD_DIR = resolve(process.cwd(), ".audio-build");
const BUCKET = "audio-library";
const PEAK_BUCKETS = 64;
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".mp4", ".mov", ".flac", ".ogg"]);

// The sfx folder is flat and only holds eighteen files, so it is tagged by hand.
// A file that is not listed here still ships, it just lands in "misc" untagged.
const SFX_META = {
  "Correct Ding": { category: "ui", tags: ["ding", "correct", "notification"] },
  "Counter Sound": { category: "ui", tags: ["counter", "numbers", "tally"] },
  "FAH Echo Sound Effect": { category: "meme", tags: ["voice", "echo"] },
  "Get out!": { category: "meme", tags: ["voice", "shout"] },
  "Glitch Sounds": { category: "transition", tags: ["glitch", "digital"] },
  "Goat - Sound Effect ProSounds": { category: "meme", tags: ["animal", "goat"] },
  "Heavenly sound effect": { category: "riser", tags: ["angelic", "reveal"] },
  "Impact 7": { category: "impact", tags: ["hit", "boom", "cinematic"] },
  "Money Sound 2": { category: "ui", tags: ["money", "cash", "register"] },
  "Mouse Click": { category: "ui", tags: ["click", "tap"] },
  "PLEASE SPEED, I NEED THIS Sound Effect": { category: "meme", tags: ["voice", "tiktok"] },
  "Pop 1": { category: "ui", tags: ["pop", "bubble", "text"] },
  "Riser 3": { category: "riser", tags: ["build", "tension"] },
  "Ryan Higa Teehee sound FX": { category: "meme", tags: ["laugh", "voice"] },
  "Snoring - sound effect": { category: "meme", tags: ["comedy", "sleep"] },
  "Vine Boom": { category: "impact", tags: ["boom", "meme", "bass"] },
  "Whoosh 1": { category: "transition", tags: ["whoosh", "swipe"] },
  "explosive fart sound effect": { category: "meme", tags: ["comedy", "fart"] },
};

function cleanTitle(file) {
  // NFKC folds the styled unicode a few of these titles are typed in
  // ("𝐍𝐀𝐒𝐓𝐘", "𝙎𝙡𝙤𝙬𝙚𝙙") back to plain letters. Without it the title renders as
  // a wall of math-bold in the picker and the slug loses every character it
  // cannot map.
  let t = basename(file, extname(file)).normalize("NFKC").replace(/_/g, " ");
  const ripped = /\(\s*youtube\s*\)/i.test(t);
  t = t.replace(/\(\s*(youtube|official audio|hd|audio)\s*\)/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  // A youtube rip carries the uploading channel as the last " - " segment. It is
  // noise on a track title and it is only reliably the channel when the marker
  // was there, so nothing else gets trimmed.
  if (ripped && t.includes(" - ")) t = t.slice(0, t.lastIndexOf(" - ")).trim();
  return t.replace(/\s*[-–]\s*$/, "").trim();
}

// Supabase storage keys are ascii, and "øneheart" is a real artist in this
// folder, so a slug that keeps letters by unicode category produces a key the
// storage api rejects with InvalidKey. Fold what folds, hand-map what does not,
// drop the rest.
const FOLD = { ø: "o", æ: "ae", œ: "oe", ß: "ss", đ: "d", ð: "d", ł: "l", þ: "th" };

function slugify(s) {
  return (
    s
      // decompose FIRST, lowercase second. the other order leaves styled caps
      // as caps (toLowerCase does not touch 𝐍) and the ascii filter then eats
      // the whole word.
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[̀-ͯ]/g, "")
      .replace(/[øæœßđðłþ]/g, (c) => FOLD[c])
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "track"
  );
}

function run(cmd, args, { capture = false, cwd } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let out = "";
    let err = "";
    if (capture) {
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
    }
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

async function probeDuration(file) {
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { capture: true }
  );
  const secs = Number.parseFloat(out.trim());
  return Number.isFinite(secs) ? Math.round(secs * 1000) : 0;
}

// Decodes to 8k mono s16 and folds it into PEAK_BUCKETS rms values 0..100. Cheap
// enough to run over the whole library and small enough to keep on the row.
function peaksOf(file, durationMs) {
  return new Promise((ok, fail) => {
    const p = spawn("ffmpeg", [
      "-v", "error", "-i", file, "-vn",
      "-ac", "1", "-ar", "8000", "-f", "s16le", "-",
    ]);
    const sums = new Float64Array(PEAK_BUCKETS);
    const counts = new Float64Array(PEAK_BUCKETS);
    const total = Math.max(1, Math.round((durationMs / 1000) * 8000));
    let sampleIndex = 0;
    let carry = null;
    p.stdout.on("data", (chunk) => {
      let buf = chunk;
      if (carry) {
        buf = Buffer.concat([carry, chunk]);
        carry = null;
      }
      const usable = buf.length - (buf.length % 2);
      if (usable < buf.length) carry = buf.subarray(usable);
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i) / 32768;
        const b = Math.min(PEAK_BUCKETS - 1, Math.floor((sampleIndex / total) * PEAK_BUCKETS));
        sums[b] += v * v;
        counts[b] += 1;
        sampleIndex += 1;
      }
    });
    p.on("error", fail);
    p.on("close", () => {
      const rms = Array.from(sums, (s, i) => (counts[i] ? Math.sqrt(s / counts[i]) : 0));
      const peak = Math.max(...rms, 1e-6);
      ok(rms.map((v) => Math.max(2, Math.min(100, Math.round((v / peak) * 100)))));
    });
  });
}

async function listAudio(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries
    .filter((e) => e.isFile() && AUDIO_EXT.has(extname(e.name).toLowerCase()) && !e.name.startsWith("."))
    .map((e) => join(dir, e.name))
    .sort();
  // a zero byte mp3 is a download that died, and there is one in the folder the
  // founder handed over. it is not an error worth stopping a 143 file run for.
  const sized = await Promise.all(files.map(async (f) => [(await stat(f)).size, f]));
  return sized.filter(([size]) => size > 0).map(([, f]) => f);
}

async function build() {
  const sources = [];
  for (const file of await listAudio(SFX_DIR)) {
    const title = cleanTitle(file);
    const meta = SFX_META[title] ?? { category: "misc", tags: [] };
    sources.push({ kind: "sfx", category: meta.category, tags: meta.tags, title, file });
  }
  const musicDirs = (await readdir(MUSIC_DIR, { withFileTypes: true }).catch(() => []))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
  for (const cat of musicDirs) {
    for (const file of await listAudio(join(MUSIC_DIR, cat))) {
      sources.push({ kind: "music", category: cat.toLowerCase(), tags: [], title: cleanTitle(file), file });
    }
  }
  if (!sources.length) throw new Error(`no audio found under ${SFX_DIR} or ${MUSIC_DIR}`);

  const manifest = [];
  const taken = new Set();
  let i = 0;
  for (const src of sources) {
    i += 1;
    let slug = slugify(src.title);
    while (taken.has(`${src.kind}/${slug}`)) slug = `${slug}-2`;
    taken.add(`${src.kind}/${slug}`);

    const key = src.kind === "sfx" ? `sfx/${slug}.mp3` : `music/${slugify(src.category)}/${slug}.mp3`;
    const out = join(BUILD_DIR, key);
    await mkdir(join(out, ".."), { recursive: true });

    const done = await stat(out).then((s) => s.size > 0).catch(() => false);
    if (!done) {
      process.stdout.write(`[${i}/${sources.length}] ${src.title}\n`);
      try {
        await run("ffmpeg", [
          "-v", "error", "-y", "-i", src.file,
          "-vn", "-map_metadata", "-1",
          "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-ac", "2",
          out,
        ]);
      } catch {
        // a source ffmpeg cannot open is one track missing, not a failed run.
        // it is named here so it can be re-downloaded rather than disappearing.
        console.warn(`  skipped, could not decode: ${src.file}`);
        continue;
      }
    }
    const durationMs = await probeDuration(out);
    manifest.push({
      kind: src.kind,
      category: src.category,
      title: src.title,
      slug,
      storage_path: key,
      duration_ms: durationMs,
      bytes: (await stat(out)).size,
      tags: src.tags,
      peaks: await peaksOf(out, durationMs),
      sort_order: i,
    });
  }

  await writeFile(join(BUILD_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`built ${manifest.length} tracks into ${BUILD_DIR}`);

  // The download packs, cut here rather than streamed from a route handler:
  // half a gig of source through a serverless function is a timeout waiting to
  // happen, and a static object in the bucket downloads at full speed and costs
  // nothing to serve.
  //
  // One pack per mood plus one for the sfx, and deliberately no "everything"
  // zip. A mood is how an editor actually picks: nobody needs suspenseful beds
  // for a skincare cut.
  //
  // PART_LIMIT is the project's own storage upload ceiling, not a preference.
  // Uploading past it comes back EntityTooLarge, so a mood bigger than that is
  // cut into numbered parts that each open on their own. Deliberately NOT
  // `zip -s`, which produces .z01/.z02 pieces that are useless without the set;
  // an editor who grabs one of these has a working folder of music.
  const PART_LIMIT = 45 * 1024 * 1024;
  await mkdir(join(BUILD_DIR, "kits"), { recursive: true });

  const packs = [
    { base: "ugc-sfx-pack", kind: "sfx", category: null, label: "sfx pack", dir: "sfx" },
    ...musicDirs.map((c) => ({
      base: `music-${slugify(c)}`,
      kind: "music",
      category: c.toLowerCase(),
      label: `${c.toLowerCase()} music`,
      dir: `music/${slugify(c)}`,
    })),
  ];

  const kits = [];
  let order = 0;
  for (const pack of packs) {
    const rows = manifest.filter((m) => m.storage_path.startsWith(`${pack.dir}/`));
    if (!rows.length) continue;

    const chunks = [[]];
    let held = 0;
    for (const row of rows) {
      if (held > 0 && held + row.bytes > PART_LIMIT) {
        chunks.push([]);
        held = 0;
      }
      chunks[chunks.length - 1].push(row);
      held += row.bytes;
    }

    for (const [n, chunk] of chunks.entries()) {
      const file = chunks.length === 1 ? `${pack.base}.zip` : `${pack.base}-${n + 1}.zip`;
      order += 1;
      // -0 stores rather than deflates: mp3 is already compressed, so deflate
      // buys nothing and costs the whole library's worth of cpu every rebuild.
      await run("zip", ["-q", "-0", "-X", "-FS", `kits/${file}`, ...chunk.map((r) => r.storage_path)], {
        cwd: BUILD_DIR,
      });
      kits.push({
        file,
        kind: pack.kind,
        category: pack.category,
        label: chunks.length === 1 ? pack.label : `${pack.label} ${n + 1} of ${chunks.length}`,
        tracks: chunk.length,
        bytes: (await stat(join(BUILD_DIR, "kits", file))).size,
        sort_order: order,
      });
      console.log(`zipped kits/${file}`);
    }
  }

  await writeFile(join(BUILD_DIR, "kits.json"), JSON.stringify(kits, null, 2));
}

// Raw fetch against storage and postgrest rather than supabase-js. The client
// builds a realtime socket in its constructor, and node 20 has no global
// WebSocket, so importing it here means the script dies before it uploads
// anything. Two endpoints and a bearer token is the whole surface we need.
function admin() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  return { url, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

async function upload() {
  const { url, headers } = admin();
  const manifest = JSON.parse(await readFile(join(BUILD_DIR, "manifest.json"), "utf8"));
  const kits = JSON.parse(await readFile(join(BUILD_DIR, "kits.json"), "utf8"));

  const jobs = [
    ...manifest.map((m) => ({ key: m.storage_path, type: "audio/mpeg" })),
    ...kits.map((k) => ({ key: `kits/${k.file}`, type: "application/zip" })),
  ];

  let done = 0;
  const queue = jobs.slice();
  const worker = async () => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const body = await readFile(join(BUILD_DIR, job.key));
      const res = await fetch(
        `${url}/storage/v1/object/${BUCKET}/${job.key.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "content-type": job.type,
            "cache-control": "max-age=31536000",
            // re-running the ingest replaces a track rather than refusing it,
            // which is what makes a re-cut of one file a one line command.
            "x-upsert": "true",
          },
          body,
        }
      );
      if (!res.ok) throw new Error(`${job.key}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      done += 1;
      if (done % 10 === 0 || done === jobs.length) process.stdout.write(`uploaded ${done}/${jobs.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

async function seed() {
  const { url, headers } = admin();
  const manifest = JSON.parse(await readFile(join(BUILD_DIR, "manifest.json"), "utf8"));
  const kits = JSON.parse(await readFile(join(BUILD_DIR, "kits.json"), "utf8"));

  const upsert = async (table, rows, conflict) => {
    for (let i = 0; i < rows.length; i += 100) {
      const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows.slice(i, i + 100)),
      });
      if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 500)}`);
    }
  };

  await upsert("audio_assets", manifest, "kind,slug");
  await upsert("audio_kits", kits, "file");

  // Anything the run did not produce is retired.
  //
  // A track is DEACTIVATED rather than deleted, which is what `active` is for:
  // a renamed source file changes the slug, so the old row is a duplicate of a
  // track that is still in the bank, and a hard delete of the library row while
  // somebody is mid-batch is a risk with nothing to buy it. A pack IS deleted,
  // because it is a link to an object that no longer exists.
  const list = (values) => `(${values.map((v) => `"${v}"`).join(",")})`;

  for (const kind of ["music", "sfx"]) {
    const slugs = manifest.filter((m) => m.kind === kind).map((m) => m.slug);
    if (!slugs.length) continue;
    const res = await fetch(
      `${url}/rest/v1/audio_assets?kind=eq.${kind}&slug=not.in.${encodeURIComponent(list(slugs))}`,
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ active: false }),
      }
    );
    if (!res.ok) throw new Error(`retire ${kind}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const res = await fetch(
    `${url}/rest/v1/audio_kits?file=not.in.${encodeURIComponent(list(kits.map((k) => k.file)))}`,
    { method: "DELETE", headers: { ...headers, prefer: "return=minimal" } }
  );
  if (!res.ok) throw new Error(`prune packs: ${res.status} ${(await res.text()).slice(0, 300)}`);

  console.log(`seeded ${manifest.length} tracks and ${kits.length} packs`);
}

const step = process.argv[2] ?? "all";
const steps = step === "all" ? ["build", "upload", "seed"] : [step];
for (const s of steps) {
  if (s === "build") await build();
  else if (s === "upload") await upload();
  else if (s === "seed") await seed();
  else throw new Error(`unknown step ${s}`);
}
