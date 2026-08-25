-- variations: mix hooks x demos x sounds x text hooks per brand, render every
-- combination.
--
-- three tables and one bucket. the brand bank is the existing `brands` row --
-- a component just points at it -- so a deal's brand and its asset bank are
-- the same thing and nobody keeps two lists of the same companies.
--
-- a render row is the unit of work AND the unit of output: the worker claims
-- queued rows, writes the mp4 back onto the same row, and the ui reads status
-- straight off it. no separate queue table, because a job that is not also the
-- artifact is a job that can succeed while the artifact goes missing.

create table if not exists public.variation_components (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- hook = the opening clip. demo = the body clip. audio = a sound to lay
  -- over the cut. text_hook = words burned on top, no media of its own.
  kind text not null check (kind in ('hook', 'demo', 'audio', 'text_hook')),
  title text not null default '',
  -- path inside the `variations` bucket. null for text hooks.
  storage_path text,
  -- jpg first frame, extracted by the worker. null = not made yet.
  poster_path text,
  -- text hooks only
  text_content text,
  text_style jsonb,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

create index if not exists variation_components_brand_idx
  on public.variation_components (brand_id, kind, created_at desc);

create table if not exists public.variation_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- what was picked, frozen as counts so the batch header still reads right
  -- after somebody deletes one of the components it was built from.
  hook_count int not null default 0,
  demo_count int not null default 0,
  audio_count int not null default 0,
  text_count int not null default 0,
  audio_title text,
  created_at timestamptz not null default now()
);

create index if not exists variation_batches_brand_idx
  on public.variation_batches (brand_id, created_at desc);

create table if not exists public.variation_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  batch_id uuid not null references public.variation_batches (id) on delete cascade,
  brand_id uuid not null references public.brands (id) on delete cascade,
  -- set null, not cascade: deleting a source clip must not delete the finished
  -- video it produced.
  hook_id uuid references public.variation_components (id) on delete set null,
  demo_id uuid references public.variation_components (id) on delete set null,
  audio_id uuid references public.variation_components (id) on delete set null,
  text_hook_id uuid references public.variation_components (id) on delete set null,
  -- "H1·D1" -- which combination this is, readable on the thumbnail
  label text not null default '',
  -- snapshots. the render is what it was rendered with, forever, even if the
  -- text hook is edited afterwards.
  text_content text,
  text_style jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'done', 'failed')),
  progress int not null default 0,
  output_path text,
  poster_path text,
  error text,
  attempts int not null default 0,
  started_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists variation_renders_batch_idx
  on public.variation_renders (batch_id, created_at);
-- the worker's claim query: oldest queued first, cheap.
create index if not exists variation_renders_queue_idx
  on public.variation_renders (status, created_at)
  where status in ('queued', 'rendering');

alter table public.variation_components enable row level security;
alter table public.variation_batches enable row level security;
alter table public.variation_renders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variation_components'
      and policyname = 'own_rows'
  ) then
    create policy own_rows on public.variation_components
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variation_batches'
      and policyname = 'own_rows'
  ) then
    create policy own_rows on public.variation_batches
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variation_renders'
      and policyname = 'own_rows'
  ) then
    create policy own_rows on public.variation_renders
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;

-- the admin half of the house pattern: inert unless the request carries
-- x-admin-view, so a staff account browsing its own tools sees its own rows.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variation_components'
      and policyname = 'variation_components_admin_read'
  ) then
    create policy variation_components_admin_read on public.variation_components
      for select using (private.is_admin() and private.admin_view());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'variation_renders'
      and policyname = 'variation_renders_admin_read'
  ) then
    create policy variation_renders_admin_read on public.variation_renders
      for select using (private.is_admin() and private.admin_view());
  end if;
end $$;

-- the bucket. public read like `autopost`: the browser plays these back in a
-- <video> on every card, and a signed url per card per refresh is a round trip
-- per tile for files whose paths are already unguessable uuids. writes stay
-- scoped to the uploader's own uid folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'variations',
  'variations',
  true,
  524288000,
  array['video/mp4', 'video/quicktime', 'video/webm', 'audio/mpeg', 'audio/mp4',
        'audio/wav', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'variations_objects_read'
  ) then
    create policy variations_objects_read on storage.objects
      for select using (bucket_id = 'variations');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'variations_objects_insert'
  ) then
    create policy variations_objects_insert on storage.objects
      for insert with check (
        bucket_id = 'variations'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'variations_objects_update'
  ) then
    create policy variations_objects_update on storage.objects
      for update using (
        bucket_id = 'variations'
        and (storage.foldername(name))[1] = (auth.uid())::text
      ) with check (
        bucket_id = 'variations'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'variations_objects_delete'
  ) then
    create policy variations_objects_delete on storage.objects
      for delete using (
        bucket_id = 'variations'
        and (storage.foldername(name))[1] = (auth.uid())::text
      );
  end if;
end $$;
