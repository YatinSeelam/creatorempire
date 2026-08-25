-- The transcriber's queue. One row per video a creator pasted in.
--
-- Why a table and not component state: the point of the tool is recording off
-- somebody else's script. A creator queues five links, films the first, and
-- comes back to the tab an hour later. Losing the queue on a reload would make
-- it a toy. Every scrape persists immediately, and the strip is just that list.
--
-- Two transcript columns on purpose. `original_transcript` is what the provider
-- returned and never changes; `transcript` is what the creator edited it into.
-- That is the whole Reset button, and it means a bad edit is never destructive.
--
-- Nothing here is public. Unlike portfolios there is no anon read policy: a
-- transcript is somebody else's words, held for one creator's own use.

create table if not exists public.transcripts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,

  platform   text not null check (platform in ('tiktok', 'instagram', 'youtube')),

  -- what they pasted, and the canonical form of it. a share link
  -- (vm.tiktok.com/X) and the long url are the same video, and post_url is the
  -- one worth linking back to.
  input_url  text not null,
  post_url   text not null,

  title           text not null default 'untitled video',
  creator_handle  text,

  -- both are ephemeral cdn urls, valid for a few days. the player falls back
  -- thumbnail -> "open original" when they expire rather than showing a black
  -- box, which is cheaper than mirroring every mp4 into storage.
  video_url      text,
  thumbnail_url  text,

  original_transcript text not null default '',
  transcript          text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the only query the tool runs: this creator's queue, newest first.
create index if not exists transcripts_user_idx
  on public.transcripts (user_id, created_at desc);

-- touch_updated_at() is created by the deal tracker migration; reused here.
drop trigger if exists touch_transcripts on public.transcripts;
create trigger touch_transcripts
  before update on public.transcripts
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------------ rls

alter table public.transcripts enable row level security;

drop policy if exists transcripts_owner_select on public.transcripts;
create policy transcripts_owner_select on public.transcripts
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists transcripts_owner_insert on public.transcripts;
create policy transcripts_owner_insert on public.transcripts
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists transcripts_owner_update on public.transcripts;
create policy transcripts_owner_update on public.transcripts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists transcripts_owner_delete on public.transcripts;
create policy transcripts_owner_delete on public.transcripts
  for delete to authenticated
  using (auth.uid() = user_id);
