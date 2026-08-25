-- Autoposting through Upload-Post.
--
-- The shape, ported from the sister project's proven engine: one managed
-- profile per creator on Upload-Post's side (a username string we generate),
-- the creator connects their own tiktok/instagram/youtube to it once through a
-- white-label link, and publishing is one API call carrying that username. The
-- OAuth tokens never touch this database — the username is the only credential
-- we hold, and it is useless without our API key.
--
-- social_posts is OUR ledger, not a mirror. Upload-Post fires scheduled posts
-- from its own side; our row records what was asked for and what came back, so
-- the queue on /social answers from here without an upstream round trip, and a
-- post that vanished upstream still has a row saying it existed.

-- ------------------------------------------------------------ social_profiles

create table if not exists public.social_profiles (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  upload_post_username text not null unique,
  -- platform -> handle/details as Upload-Post reports them, refreshed on page
  -- load. a cache for display, never an authority: publishing rechecks live.
  connected            jsonb not null default '{}'::jsonb,
  last_checked_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- --------------------------------------------------------------- social_posts

create table if not exists public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  caption       text not null,
  platforms     text[] not null,
  video_url     text not null,
  -- null means "posted immediately"; set means Upload-Post's scheduler owns it
  -- until it fires.
  scheduled_for timestamptz,
  status        text not null default 'processing'
                  check (status in ('scheduled', 'processing', 'posted', 'partial', 'failed', 'canceled')),
  -- exactly one of these ids exists per row: job_id for scheduled posts,
  -- request_id for async immediate ones. both null only when the upload
  -- answered synchronously and the row was born terminal.
  job_id        text,
  request_id    text,
  -- per-platform outcomes as reported upstream: [{platform, success, url, error}]
  results       jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists social_posts_user_idx
  on public.social_posts (user_id, created_at desc);

-- the reconcile pass asks "what is still in flight" on every /social load.
create index if not exists social_posts_pending_idx
  on public.social_posts (user_id)
  where status in ('scheduled', 'processing');

-- ------------------------------------------------------------------- triggers

do $$
declare t text;
begin
  foreach t in array array['social_profiles', 'social_posts']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s
         for each row execute function public.touch_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- -------------------------------------------------------------------- storage

-- The videos waiting to be posted. Public bucket, because Upload-Post's
-- servers fetch the file by plain URL; the path carries a uuid so a url is
-- unguessable, which is the same bargain the portfolio bucket makes.
-- 200MB: a phone-shot vertical clip lands well under it, and tiktok's own
-- upload cap is in the same range.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'autopost',
  'autopost',
  true,
  209715200,
  array['video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists autopost_objects_insert on storage.objects;
create policy autopost_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'autopost'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists autopost_objects_delete on storage.objects;
create policy autopost_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'autopost'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists autopost_objects_read on storage.objects;
create policy autopost_objects_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'autopost');
