-- Autoposting becomes a batch a creator builds by hand.
--
-- What it replaces: a cadence on the deal (`posting_quota` / `posting_period`)
-- that worked out the times itself. That is the wrong shape for this job. A
-- creator with nine delivered cuts does not want "three a day starting
-- tomorrow" computed for them and then fought with; they want to see the nine,
-- pick the order, write the captions, choose the accounts, and then be handed a
-- schedule they can drag. The cadence columns are left on `deals` and the code
-- that read them is commented rather than deleted, because the numbers are
-- still what a brand contract says and the auto path may come back as a "fill
-- these times for me" button on top of this.
--
-- Six columns, and each one is something the wizard collects that the table had
-- nowhere to put:
--
--   batch_id     one run of the wizard. the planner groups by it, and cancelling
--                "that batch I just scheduled" is one delete rather than nine.
--   video_name   what to call the clip on screen. video_url is a signed storage
--                url or an editor's link, and neither is a name a person reads.
--   hashtags     kept apart from `caption` on purpose. the caption is per clip
--                and the tags are per batch, so appending them at post time is
--                what lets the tag list be edited once and re-rendered on every
--                row without touching nine captions.
--   options      per platform posting settings (tiktok privacy and duet/stitch,
--                instagram share-to-feed and collaborator, youtube visibility
--                and category). shaped `{ tiktok: {...}, instagram: {...} }`,
--                and jsonb rather than columns because every platform's list
--                changes on its own schedule and none of it is ever filtered on.
--   source_kind  'editor' (a delivered cut) or 'upload' (a file the creator
--   source_ref   picked). the ref is the deliverable id or the storage path, so
--                a posted clip can be traced back to the job that made it.
--
-- `deal_post_presets` is the other half: the tag list and the platform settings
-- a brand always uses, saved once. Read on every new batch for that deal.

alter table public.social_posts
  add column if not exists batch_id    uuid,
  add column if not exists video_name  text,
  add column if not exists hashtags    text[] not null default '{}',
  add column if not exists options     jsonb  not null default '{}'::jsonb,
  add column if not exists source_kind text,
  add column if not exists source_ref  text;

alter table public.social_posts drop constraint if exists social_posts_source_kind_check;
alter table public.social_posts add constraint social_posts_source_kind_check
  check (source_kind is null or source_kind in ('editor', 'upload'));

-- the planner reads one batch at a time; the calendar reads a date window.
create index if not exists social_posts_batch_idx
  on public.social_posts (user_id, batch_id);
create index if not exists social_posts_schedule_idx
  on public.social_posts (user_id, scheduled_for)
  where scheduled_for is not null;

-- ------------------------------------------------------------------ presets

create table if not exists public.deal_post_presets (
  deal_id    uuid primary key references public.deals (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  hashtags   text[] not null default '{}',
  options    jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.deal_post_presets enable row level security;

-- "a preset I can see" is "a deal I can see". the subquery is itself subject to
-- the deals policies, so org scoping comes along rather than being restated.
drop policy if exists deal_post_presets_select on public.deal_post_presets;
create policy deal_post_presets_select on public.deal_post_presets
  for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

drop policy if exists deal_post_presets_write on public.deal_post_presets;
create policy deal_post_presets_write on public.deal_post_presets
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_post_presets_update on public.deal_post_presets;
create policy deal_post_presets_update on public.deal_post_presets
  for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id))
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_post_presets_delete on public.deal_post_presets;
create policy deal_post_presets_delete on public.deal_post_presets
  for delete to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

drop trigger if exists touch_deal_post_presets on public.deal_post_presets;
create trigger touch_deal_post_presets
  before update on public.deal_post_presets
  for each row execute function public.touch_updated_at();
