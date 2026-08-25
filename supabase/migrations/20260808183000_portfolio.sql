-- The creator portfolio: one row per user, and the public page that reads it.
--
-- Shape of the problem this encodes: a portfolio is one document. A creator
-- opens it, edits their name, swaps two clips, reorders their skills and hits
-- save once. Nothing in it is independently useful — a skill row with no
-- portfolio around it means nothing — and there is no query anyone will ever
-- run across all creators' clips. So the four lists (skills, socials, clips,
-- clients) are jsonb columns rather than child tables: the whole document is
-- written back in a single upsert, which is atomic for free, and there is no
-- delete-the-rows-that-vanished dance on every save.
--
-- The coming AI brain-dump pass pushes the same way. It takes a creator talking
-- about themselves and returns a whole portfolio; validating that against
-- lib/portfolio-schema.ts and writing it as one row is one round trip. Split
-- across five tables it would be a transaction with five failure modes.
--
-- The other half of this file is visibility. The public page lives at the root
-- (ugcflows.com/yourhandle) and is rendered with the publishable key, with no
-- session and no service key anywhere near it. That works because of one
-- permissive select policy below: published rows are readable by anon.

-- ----------------------------------------------------------------- portfolios

create table if not exists public.portfolios (
  user_id    uuid primary key references auth.users (id) on delete cascade,

  -- the public address. blank until they pick one, which is why the unique
  -- index below skips empty strings.
  slug       text not null,
  published  boolean not null default false,

  name       text,
  role       text,
  location   text,
  cohort     text,
  avatar_url text,

  about      text,
  background text,

  email      text,
  phone      text,
  cta_label  text,

  -- the four lists and the theme. shapes live in lib/portfolio-schema.ts and
  -- are validated there on the way in, so no check constraints here: a
  -- constraint that rejects a save is worse for a creator than a clamped field.
  skills     jsonb not null default '[]'::jsonb,
  socials    jsonb not null default '[]'::jsonb,
  clips      jsonb not null default '[]'::jsonb,
  clients    jsonb not null default '[]'::jsonb,
  theme      jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One creator per link, case-insensitively, so /Dave and /dave can't be two
-- people. Blank slugs are excluded because an unsaved draft has no link yet and
-- every draft would otherwise collide with every other draft.
create unique index if not exists portfolios_slug_key
  on public.portfolios (lower(slug))
  where slug <> '';

-- the public page's only lookup.
create index if not exists portfolios_published_idx
  on public.portfolios (lower(slug))
  where published;

-- touch_updated_at() is created by the deal tracker migration; reused here.
drop trigger if exists touch_portfolios on public.portfolios;
create trigger touch_portfolios
  before update on public.portfolios
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------------ rls

alter table public.portfolios enable row level security;

-- Owner does everything to their own row. Split per verb rather than `for all`
-- so the public read below composes cleanly instead of fighting one broad
-- policy.
drop policy if exists portfolios_owner_select on public.portfolios;
create policy portfolios_owner_select on public.portfolios
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists portfolios_owner_insert on public.portfolios;
create policy portfolios_owner_insert on public.portfolios
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists portfolios_owner_update on public.portfolios;
create policy portfolios_owner_update on public.portfolios
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists portfolios_owner_delete on public.portfolios;
create policy portfolios_owner_delete on public.portfolios
  for delete to authenticated
  using (auth.uid() = user_id);

-- The whole point of the feature. Permissive policies OR together, so a signed
-- in creator still sees their own unpublished row through the owner policy
-- above, and everyone else sees only what was deliberately published.
-- Unpublishing takes the page down for real, not just from the nav.
drop policy if exists portfolios_public_read on public.portfolios;
create policy portfolios_public_read on public.portfolios
  for select to anon, authenticated
  using (published);

-- -------------------------------------------------------------------- storage

-- Avatars, client logos and clips. Public because the portfolio is public and a
-- signed url that expires would break a page a creator handed to a brand.
-- 60MB covers a phone-shot vertical clip; images are resized to webp in the
-- browser before they get here and land well under it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio',
  'portfolio',
  true,
  62914560,
  array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

-- Writes are scoped by the first path segment being the caller's uid, which is
-- why every upload path in lib/portfolio-upload.ts starts with `${userId}/`.
-- Nothing enforces that on the client, so it is enforced here.
drop policy if exists portfolio_objects_insert on storage.objects;
create policy portfolio_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_update on storage.objects;
create policy portfolio_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists portfolio_objects_delete on storage.objects;
create policy portfolio_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portfolio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reads are open to everyone, anon included. An unpublished portfolio's files
-- are still fetchable if someone has the url, which is the same bargain every
-- public bucket makes; nothing secret is ever uploaded here.
drop policy if exists portfolio_objects_read on storage.objects;
create policy portfolio_objects_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'portfolio');
