-- The download packs that go with the shared audio library.
--
-- A catalogue row rather than a convention over object names, for one reason
-- the storage limit forced: this project refuses an upload over 50mb, and the
-- cinematic mood is 133mb of mp3, so a mood is not one zip. It is however many
-- standalone zips fit under the cap, and how many that is depends on what is in
-- the folder that week. Parsing `music-cinematic-2.zip` back into "cinematic,
-- part 2 of 3" is guesswork the ingest already knows the answer to, so it
-- writes the answer down.
--
-- Same write model as `audio_assets`: select to anyone signed in, no insert or
-- update policy at all, so the service key in scripts/audio-library.mjs is the
-- only thing that can change what the packs are.

create table if not exists public.audio_kits (
  -- the object name under `kits/` in the audio-library bucket. it is the
  -- identity: two rows naming the same file is not a thing that can be true.
  file text primary key,

  kind text not null check (kind in ('music', 'sfx')),

  -- the mood this pack holds, or null for the sfx pack which holds all of them.
  category text,

  -- what the button says, including "3 of 4" when the mood needed splitting.
  label text not null,

  tracks int    not null default 0,
  bytes  bigint not null default 0,

  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists audio_kits_order_idx on public.audio_kits (sort_order);

alter table public.audio_kits enable row level security;

drop policy if exists audio_kits_select on public.audio_kits;
create policy audio_kits_select on public.audio_kits
  for select to authenticated
  using (true);
