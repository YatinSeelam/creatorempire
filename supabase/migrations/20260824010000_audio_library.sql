-- The shared audio library: one bank of background music and sfx that the
-- whole product reads and nobody but staff writes.
--
-- Every other bucket in this product belongs to somebody. `variations` is
-- scoped to the uploader's uid, `editing-assets` to a job's two people,
-- `deal_assets` to a deal. This one is the opposite shape on purpose: it is the
-- house's own material, uploaded once from `scripts/audio-library.mjs`, and
-- every signed-in person gets exactly the same read of it. So there is no
-- user_id column and no insert or update policy at all. Writes happen with the
-- service key or they do not happen, which is a stronger guarantee than a
-- policy naming an admin table, and it means a compromised session cannot
-- quietly swap a track ninety creators are dragging into videos.
--
-- Two surfaces read it. The variations tool copies a picked track into the
-- caller's own `variations` folder (see addFromAudioLibrary) rather than
-- pointing a render at this bucket, which keeps the renderer's single-bucket
-- assumption intact and means deleting a library track never breaks a batch
-- somebody already built. The editors page hands out the same files as zips.
--
-- `peaks` is the waveform, pre-computed at ingest as 64 rms buckets scaled
-- 0..100. A browser CAN draw this itself, but only by decoding the mp3, and a
-- grid of 140 rows decoding 400mb to draw 140 little bar charts is not a page.

-- --------------------------------------------------------------- audio_assets

create table if not exists public.audio_assets (
  id   uuid primary key default gen_random_uuid(),

  -- `music` is a bed that runs under a whole cut. `sfx` is a one-shot that
  -- lands on a beat. They are browsed separately because they are picked at
  -- different moments, so the split is a column and not a tag.
  kind text not null check (kind in ('music', 'sfx')),

  -- the mood folder for music ('upbeat', 'cinematic', …), the use for sfx
  -- ('transition', 'impact', 'meme', 'ui', 'riser'). Free text on purpose:
  -- adding a mood is a new folder on the founder's disk, not a migration.
  category text not null,

  title text not null,
  slug  text not null,

  -- path inside the public `audio-library` bucket, always a 192k mp3.
  storage_path text not null,

  duration_ms int    not null default 0,
  bytes       bigint not null default 0,

  tags  text[] not null default '{}',

  -- 64 rms buckets, 0..100. see the header.
  peaks smallint[] not null default '{}',

  -- the order the ingest saw them in, so the grid is stable between runs
  -- rather than reshuffling every time a row is touched.
  sort_order int not null default 0,

  -- pulling a track is a flag, never a delete: a creator may already have a
  -- copy of it in a bank, and a row that vanishes makes that copy unexplainable.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (kind, slug)
);

create index if not exists audio_assets_browse_idx
  on public.audio_assets (kind, category, sort_order)
  where active;

alter table public.audio_assets enable row level security;

-- Everybody signed in sees the whole bank. There is nothing per-person in it,
-- and gating it on a subscription would mean the variations tool's sound picker
-- being empty for the exact people the tool is sold to.
drop policy if exists audio_assets_select on public.audio_assets;
create policy audio_assets_select on public.audio_assets
  for select to authenticated
  using (active);

-- No insert, update or delete policy. With rls on, that is a refusal for every
-- role except the service key, which is what the ingest script uses.

-- --------------------------------------------------------------------- bucket

-- Public read, like `variations` and for the same reason: these are files an
-- audio element seeks around in and a browser caches. Signed urls would mean
-- re-minting 140 of them on every render of the library page, and re-minting
-- one mid-scrub when the hour ran out.
--
-- 500mb matches the `variations` cap. The per-mood zip packs are the only
-- objects here that get near it; the mp3s are single digit megabytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-library',
  'audio-library',
  true,
  524288000,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'application/zip']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves an object by url with no policy, but LISTING one still
-- needs select. The editors page lists `kits/` to show which packs exist and how
-- big they are, so grant the read that the urls already imply.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'audio_library_read'
  ) then
    create policy audio_library_read on storage.objects
      for select to public
      using (bucket_id = 'audio-library');
  end if;
end $$;
