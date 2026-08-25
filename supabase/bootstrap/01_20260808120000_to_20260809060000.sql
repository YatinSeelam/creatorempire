-- ==== 20260808120000_deal_tracker.sql
-- Brand deal tracker: the money model.
--
-- Shape of the problem this encodes: one creator works with many brands. Each
-- brand deal spawns its own set of social accounts (a tiktok, an instagram, a
-- youtube), the same cut usually goes out on all of them, and the pay is a flat
-- fee plus a bonus whose rules differ per brand and sometimes per platform.
-- Some bonuses run forever, some only for a window, some only for the first N
-- days of a video's life. That variation is why bonus_rules is its own table
-- instead of columns on deals.
--
-- Everything is scoped by user_id and every table carries it, even where it
-- could be reached through a parent, so every RLS policy is one index lookup
-- rather than a join.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- housekeeping

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- --------------------------------------------------------------------- brands

create table if not exists public.brands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  website       text,
  contact_name  text,
  contact_email text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- one "Candle" per creator. case-insensitive so "Candle" and "candle" can't
-- both exist and split a creator's history in two.
create unique index if not exists brands_user_name_key
  on public.brands (user_id, lower(name));

-- ---------------------------------------------------------------------- deals

create table if not exists public.deals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  brand_id       uuid not null references public.brands (id) on delete cascade,
  name           text not null default 'Campaign',
  status         text not null default 'active'
                   check (status in ('draft', 'active', 'paused', 'ended')),
  started_on     date,
  ends_on        date,

  -- the part that is owed regardless of how the videos perform.
  flat_fee_cents bigint not null default 0 check (flat_fee_cents >= 0),
  flat_fee_kind  text not null default 'one_time'
                   check (flat_fee_kind in ('one_time', 'per_video', 'per_month')),

  pay_cycle      text not null default 'monthly'
                   check (pay_cycle in ('one_time', 'weekly', 'biweekly', 'monthly')),
  net_days       int  not null default 30 check (net_days between 0 and 180),
  currency       text not null default 'usd',

  contract_url   text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists deals_user_idx on public.deals (user_id, status);
create index if not exists deals_brand_idx on public.deals (brand_id);

-- ------------------------------------------------------------- deal_accounts

-- The accounts made for one deal. platform_account_id is the stable id the
-- ingest layer needs and the handle alone can't give: tiktok's secUid,
-- instagram's numeric pk, youtube's UC channel id. It is filled on first sync
-- so a later rename doesn't orphan the account's videos.
create table if not exists public.deal_accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  deal_id             uuid not null references public.deals (id) on delete cascade,
  platform            text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  handle              text not null,
  platform_account_id text,
  -- how numbers get in: scraped by us, pulled from an api the creator
  -- authorised, or typed by hand when neither is possible.
  source              text not null default 'scrape'
                        check (source in ('scrape', 'oauth', 'manual')),
  active              boolean not null default true,
  last_synced_at      timestamptz,
  last_sync_error     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists deal_accounts_handle_key
  on public.deal_accounts (deal_id, platform, lower(handle));

-- the cron's work queue: oldest sync first, never-synced first of all.
create index if not exists deal_accounts_due_idx
  on public.deal_accounts (last_synced_at nulls first)
  where active;

-- --------------------------------------------------------------- bonus_rules

-- One row per way a deal pays on performance. A deal can hold several: a $1 cpm
-- on tiktok, a $5 cpm on youtube, and a one-off $50 at 100k views.
--
-- window_kind is the piece that matters most in practice:
--   forever     every view ever counts.
--   absolute    only views that accrued between starts_on and ends_on count.
--   since_post  only views in the first window_days of each video's life count.
--
-- 'absolute' and 'since_post' are both computed as a difference between two
-- daily snapshots, which is the whole reason video_stats keeps history instead
-- of only a latest number.
create table if not exists public.bonus_rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  deal_id           uuid not null references public.deals (id) on delete cascade,
  label             text,
  kind              text not null check (kind in ('cpm', 'per_video', 'milestone')),

  -- empty array means "every platform on this deal". listing platforms is how
  -- a $1 tiktok cpm and a $5 youtube cpm live on the same deal.
  platforms         text[] not null default '{}',

  -- kind = cpm. cents per 1,000 counted views, so a $1 cpm is 100.
  rate_cents_per_1k bigint check (rate_cents_per_1k >= 0),

  -- kind = per_video. paid once per video that posted inside the window.
  amount_cents      bigint check (amount_cents >= 0),

  -- kind = milestone. [{"views": 100000, "amount_cents": 5000}, ...]
  -- the highest tier a video reaches pays; tiers do not stack.
  tiers             jsonb not null default '[]'::jsonb,

  -- a video earns nothing from this rule until it clears min_views, and never
  -- more than cap_cents from it. cap_cents null means uncapped.
  min_views         bigint not null default 0 check (min_views >= 0),
  cap_cents         bigint check (cap_cents >= 0),

  window_kind       text not null default 'forever'
                      check (window_kind in ('forever', 'absolute', 'since_post')),
  starts_on         date,
  ends_on           date,
  window_days       int check (window_days > 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- a rule that can't be evaluated is worse than no rule, so the shape is
  -- checked here rather than trusted from the form.
  constraint bonus_rules_kind_fields check (
    case kind
      when 'cpm'       then rate_cents_per_1k is not null
      when 'per_video' then amount_cents is not null
      when 'milestone' then jsonb_array_length(tiers) > 0
    end
  ),
  constraint bonus_rules_window_fields check (
    case window_kind
      when 'absolute'   then starts_on is not null
      when 'since_post' then window_days is not null
      else true
    end
  )
);

create index if not exists bonus_rules_deal_idx on public.bonus_rules (deal_id);

-- -------------------------------------------------------------------- videos

-- content_group ties the same creative together across platforms. The user
-- posts one cut to three accounts; without this, "how did that video do" can
-- only be answered per platform.
create table if not exists public.videos (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  deal_id           uuid not null references public.deals (id) on delete cascade,
  deal_account_id   uuid not null references public.deal_accounts (id) on delete cascade,
  platform          text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  platform_video_id text not null,
  url               text,
  caption           text,
  thumbnail_url     text,
  posted_at         timestamptz,
  content_group     text,

  -- some brands only pay on videos they approved. false keeps the video visible
  -- but out of every earnings number.
  counts            boolean not null default true,

  -- latest snapshot, copied down so a list of 300 videos is one query. the
  -- history it came from lives in video_stats.
  views             bigint not null default 0,
  likes             bigint not null default 0,
  comments          bigint not null default 0,
  shares            bigint not null default 0,
  last_seen_at      timestamptz,

  -- set once no open bonus window can pay this video another cent. the ingest
  -- layer stops asking about frozen videos, which is what keeps a creator with
  -- 900 old videos from costing anything to track.
  frozen_at         timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists videos_platform_key
  on public.videos (deal_account_id, platform_video_id);
create index if not exists videos_deal_idx on public.videos (deal_id, posted_at desc);
create index if not exists videos_account_idx on public.videos (deal_account_id);
create index if not exists videos_group_idx on public.videos (user_id, content_group)
  where content_group is not null;

-- --------------------------------------------------------------- video_stats

-- One row per video per day. The primary key is what makes a re-poll on the
-- same day an update instead of a third opinion, so polling twice costs storage
-- nothing and the series stays exactly one point per day.
create table if not exists public.video_stats (
  video_id   uuid not null references public.videos (id) on delete cascade,
  day        date not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  views      bigint not null default 0,
  likes      bigint not null default 0,
  comments   bigint not null default 0,
  shares     bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (video_id, day)
);

create index if not exists video_stats_user_day_idx on public.video_stats (user_id, day desc);

-- -------------------------------------------------------------------- payouts

-- A payout is a frozen bill. The cents are stored, not recomputed, because a
-- scrape that backfills a missing day must never quietly change what a brand
-- already paid. Recompute lands in a new payout or an adjustment, never in an
-- old row.
create table if not exists public.payouts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  deal_id       uuid not null references public.deals (id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  flat_cents    bigint not null default 0,
  bonus_cents   bigint not null default 0,
  adjust_cents  bigint not null default 0,
  status        text not null default 'due'
                  check (status in ('due', 'invoiced', 'paid')),
  invoiced_on   date,
  paid_on       date,
  reference     text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint payouts_period check (period_end >= period_start)
);

create index if not exists payouts_deal_idx on public.payouts (deal_id, period_start desc);
create index if not exists payouts_open_idx on public.payouts (user_id, status)
  where status <> 'paid';

-- ---------------------------------------------------------------- ingest_runs

-- Every sync attempt, so "why is this deal's number stale" has an answer and
-- so the cost of tracking is a number on a page rather than a surprise on an
-- invoice. api_calls is the unit that actually gets billed.
create table if not exists public.ingest_runs (
  id              bigserial primary key,
  user_id         uuid references auth.users (id) on delete cascade,
  deal_account_id uuid references public.deal_accounts (id) on delete set null,
  platform        text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  ok              boolean,
  videos_seen     int not null default 0,
  videos_new      int not null default 0,
  api_calls       int not null default 0,
  error           text
);

create index if not exists ingest_runs_recent_idx on public.ingest_runs (started_at desc);

-- ------------------------------------------------------------------- triggers

do $$
declare t text;
begin
  foreach t in array array['brands', 'deals', 'deal_accounts', 'bonus_rules', 'videos', 'payouts']
  loop
    execute format('drop trigger if exists touch_%1$s on public.%1$s', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s
         for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------ rls

-- Owner-only, on every table. The dashboard is staff-only today (requireAdmin
-- in the (dash) layout) but the data was never scoped to staff, so opening the
-- gate to paying creators later needs no migration.
do $$
declare t text;
begin
  foreach t in array array['brands', 'deals', 'deal_accounts', 'bonus_rules',
                           'videos', 'video_stats', 'payouts', 'ingest_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- --------------------------------------------------------------- the earnings

-- One row per (video, rule) with the views that rule counts and what it pays.
--
-- security invoker, so it sees exactly the rows the caller's RLS policies allow
-- and needs no user_id argument. stable, so a page that calls it once per
-- render doesn't re-run it per row.
create or replace function public.video_rule_earnings(p_deal uuid default null)
returns table (
  deal_id         uuid,
  video_id        uuid,
  rule_id         uuid,
  countable_views bigint,
  amount_cents    bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with vid as (
    select v.id, v.deal_id, v.platform,
           (v.posted_at at time zone 'utc')::date as posted_on
    from videos v
    where v.counts
      and v.posted_at is not null
      and (p_deal is null or v.deal_id = p_deal)
  ),
  paired as (
    select
      v.id      as video_id,
      v.deal_id as deal_id,
      r.id      as rule_id,
      r.kind, r.rate_cents_per_1k, r.amount_cents, r.tiers,
      r.min_views, r.cap_cents,

      -- only an absolute window has a baseline to subtract. 'forever' and
      -- 'since_post' both start counting from nothing, because views before a
      -- video is posted do not exist.
      case when r.window_kind = 'absolute' then r.starts_on end as w_start,

      case r.window_kind
        when 'absolute'   then r.ends_on
        when 'since_post' then v.posted_on + r.window_days
      end as w_end,

      -- per_video pays on the act of posting, so for an absolute campaign the
      -- video has to have been posted inside it. cpm and milestone don't care:
      -- an older video earning new views during a campaign still earns.
      case
        when r.window_kind = 'absolute'
          then v.posted_on between r.starts_on and coalesce(r.ends_on, 'infinity'::date)
        else true
      end as posted_ok
    from vid v
    join bonus_rules r
      on  r.deal_id = v.deal_id
      and (cardinality(r.platforms) = 0 or v.platform = any (r.platforms))
  ),
  edges as (
    select
      p.*,
      case
        when p.w_start is null then 0::bigint
        else coalesce((
          select s.views from video_stats s
          where s.video_id = p.video_id and s.day <= p.w_start
          order by s.day desc limit 1
        ), 0)
      end as views_start,
      coalesce((
        select s.views from video_stats s
        where s.video_id = p.video_id
          and (p.w_end is null or s.day <= p.w_end)
        order by s.day desc limit 1
      ), 0) as views_end
    from paired p
  ),
  counted as (
    select e.*, greatest(e.views_end - e.views_start, 0) as cv from edges e
  )
  select
    c.deal_id,
    c.video_id,
    c.rule_id,
    c.cv,
    case
      when c.cv < c.min_views then 0::bigint
      else least(
        coalesce(c.cap_cents, 9223372036854775807::bigint),
        case c.kind
          when 'cpm' then
            round(c.cv * coalesce(c.rate_cents_per_1k, 0) / 1000.0)::bigint
          when 'per_video' then
            case when c.posted_ok then coalesce(c.amount_cents, 0) else 0::bigint end
          when 'milestone' then
            coalesce((
              select max((t ->> 'amount_cents')::bigint)
              from jsonb_array_elements(c.tiers) t
              where (t ->> 'views')::bigint <= c.cv
            ), 0)
        end
      )
    end
  from counted c;
$$;

grant execute on function public.video_rule_earnings(uuid) to authenticated;

-- ==== 20260808120001_deal_rollups.sql
-- Rollups, so the deals list is a fixed number of queries rather than four per
-- deal.
--
-- Both are `security_invoker`, which is the whole point: a view or function that
-- runs as its owner would bypass row level security and hand one creator another
-- creator's totals. Invoker means RLS on `deals`, `videos` and `video_stats` is
-- what scopes them, and neither needs a user_id argument to be safe.

create or replace view public.deal_rollup with (security_invoker = true) as
select
  d.id      as deal_id,
  d.user_id as user_id,
  count(v.id) filter (where v.counts)::bigint               as video_count,
  coalesce(sum(v.views) filter (where v.counts), 0)::bigint  as total_views,
  max(v.posted_at)                                          as last_posted_at
from public.deals d
left join public.videos v on v.deal_id = d.id
group by d.id, d.user_id;

grant select on public.deal_rollup to authenticated;

-- One number per deal, for the list. The detail page calls
-- video_rule_earnings(deal) directly instead, because it wants the per-video and
-- per-rule breakdown that this throws away.
create or replace function public.deal_earnings(p_deal uuid default null)
returns table (deal_id uuid, bonus_cents bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.deal_id, sum(e.amount_cents)::bigint
  from public.video_rule_earnings(p_deal) e
  group by e.deal_id;
$$;

grant execute on function public.deal_earnings(uuid) to authenticated;

-- ==== 20260808183000_portfolio.sql
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

-- ==== 20260808200000_transcripts.sql
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

-- ==== 20260808213000_profile_scraper.sql
-- The profile scraper, and the credit ledger that makes it safe to run.
--
-- The tool: paste a tiktok, instagram or youtube profile url, get every short
-- form post back in a table with views, likes, comments and an engagement rate.
-- One provider (scrapecreators), one request per page of posts, one credit per
-- request. That last sentence is the whole cost model and every table here
-- exists to keep it true.
--
-- Four tables:
--   scrape_targets    one row per (creator, platform, handle) they pulled
--   scrape_posts      the posts, upserted so a re-pull refreshes instead of doubling
--   api_usage_events  one row per outbound api call, the cost ledger
--   api_pricing       what a credit costs, and the default daily cap, admin editable
--
-- The ledger is the part that is easy to get wrong. It is written by the
-- service key ONLY (see the rls block at the bottom): a creator can read what
-- they spent and can never insert, edit or delete a row. A cost ledger the
-- spender can rewrite is not a ledger. The consequence is deliberate: if the
-- service key is missing the app refuses to scrape rather than spending credits
-- it cannot account for.

-- ---------------------------------------------------------------- targets

create table if not exists public.scrape_targets (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users (id) on delete cascade,

  platform  text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  -- lowercased, no leading @. the unique key below is what stops the same
  -- profile becoming two rows because somebody pasted a different url spelling.
  handle    text not null check (handle <> ''),

  -- what they pasted, and the canonical profile page. same split as transcripts.
  input_url   text not null,
  profile_url text not null,

  -- whatever the posts response happened to carry about the author. never a
  -- second request: the profile endpoint is another credit for a follower count
  -- nobody is being paid on.
  display_name   text,
  avatar_url     text,
  follower_count bigint,
  post_count     bigint,

  -- the pagination bookmark, opaque and platform shaped: tiktok max_cursor,
  -- instagram max_id, youtube continuationToken. stored so "load more" costs
  -- one credit instead of re-walking every page from the top.
  next_cursor text,
  has_more    boolean not null default false,

  -- running totals for this target, so the ui can say what a pull has cost
  -- without a join. the ledger is still the source of truth for billing.
  pages_fetched  integer not null default 0,
  credits_spent  integer not null default 0,

  last_scraped_at timestamptz,
  last_error      text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint scrape_targets_one_per_handle unique (user_id, platform, handle)
);

create index if not exists scrape_targets_user_idx
  on public.scrape_targets (user_id, updated_at desc);

-- ------------------------------------------------------------------ posts

create table if not exists public.scrape_posts (
  id        uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.scrape_targets (id) on delete cascade,
  -- denormalized from the target so rls is one predicate and not a join.
  user_id   uuid not null references auth.users (id) on delete cascade,

  platform         text not null check (platform in ('tiktok', 'instagram', 'youtube')),
  platform_post_id text not null,
  post_url         text not null,

  -- caption on instagram, desc on tiktok, title on youtube. one column: the
  -- table shows one thing and the creator does not care what the api called it.
  title         text,
  thumbnail_url text,

  -- bigint because a view count outgrew int32 years ago. null means the
  -- platform did not report it, which is different from zero, and the
  -- engagement rate below refuses to guess between the two.
  views    bigint,
  likes    bigint,
  comments bigint,
  shares   bigint,
  saves    bigint,

  duration_seconds integer,
  posted_at        timestamptz,

  is_pinned boolean not null default false,
  is_ad     boolean not null default false,

  -- stored, not computed in the page, so the table can sort on it in sql and
  -- every row agrees on the formula. null views gives null rate rather than a
  -- confident looking zero.
  engagement_rate numeric generated always as (
    case
      when views is not null and views > 0
        then (coalesce(likes, 0) + coalesce(comments, 0) + coalesce(shares, 0))::numeric / views
      else null
    end
  ) stored,

  first_seen_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- the upsert key. a re-pull of page one updates yesterday's numbers in place
  -- instead of adding a second copy of the same post.
  constraint scrape_posts_one_per_post unique (target_id, platform_post_id)
);

create index if not exists scrape_posts_target_idx
  on public.scrape_posts (target_id, posted_at desc nulls last);

create index if not exists scrape_posts_user_idx
  on public.scrape_posts (user_id, created_at desc);

-- ---------------------------------------------------------- the cost ledger

create table if not exists public.api_usage_events (
  id bigint generated always as identity primary key,

  -- set null, not cascade: a deleted account must not erase what it spent.
  user_id    uuid references auth.users (id) on delete set null,
  -- copied at write time for the same reason. the admin page reads this, so a
  -- closed account still shows up in last month's costs.
  user_email text,

  provider text not null default 'scrapecreators',
  -- the path, not the full url. no query string: handles and cursors are not
  -- worth keeping and a cursor is long enough to bloat the table.
  endpoint text not null,
  platform text check (platform in ('tiktok', 'instagram', 'youtube')),

  target_id uuid references public.scrape_targets (id) on delete set null,

  -- read off the response body, never assumed. a cached hit is 0.
  credits_charged  integer not null default 0,
  credits_remaining bigint,
  cached           boolean not null default false,

  ok          boolean not null,
  status_code integer,
  error       text,
  duration_ms integer,

  created_at timestamptz not null default now()
);

-- the two queries the admin page runs: everything in a date range, and one
-- person's history.
create index if not exists api_usage_events_when_idx
  on public.api_usage_events (created_at desc);

create index if not exists api_usage_events_user_idx
  on public.api_usage_events (user_id, created_at desc);

-- ------------------------------------------------------------------ pricing

-- One row per provider. micros, not cents: scrapecreators sells credits at a
-- fraction of a cent each, so the product's usual integer-cents rule cannot
-- hold the number. 1,000,000 micros = $1. $0.002 a credit is 2000.
create table if not exists public.api_pricing (
  provider          text primary key,
  micros_per_credit bigint not null default 0 check (micros_per_credit >= 0),

  -- the safety rail. null means unlimited, which is a choice an admin has to
  -- make on purpose. it is enforced in the app before a request goes out, not
  -- here, because the check has to happen before money is spent.
  default_daily_credit_cap integer check (default_daily_credit_cap is null or default_daily_credit_cap >= 0),

  -- what the dashboard at app.scrapecreators.com says is left, typed in by an
  -- admin. the ledger's credits_remaining is the live number; this is the
  -- purchase it is counting down from.
  credits_purchased bigint,
  notes             text,
  updated_at        timestamptz not null default now()
);

insert into public.api_pricing (provider, micros_per_credit, default_daily_credit_cap, notes)
values ('scrapecreators', 0, 50, 'set micros_per_credit from the plan price: plan cost in dollars / credits included, times 1,000,000.')
on conflict (provider) do nothing;

-- Per person override. A row here beats the default above; absent means use it.
create table if not exists public.api_user_limits (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  daily_credit_cap integer check (daily_credit_cap is null or daily_credit_cap >= 0),
  note             text,
  updated_at       timestamptz not null default now()
);

-- ----------------------------------------------------------------- triggers

drop trigger if exists touch_scrape_targets on public.scrape_targets;
create trigger touch_scrape_targets
  before update on public.scrape_targets
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_scrape_posts on public.scrape_posts;
create trigger touch_scrape_posts
  before update on public.scrape_posts
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_api_pricing on public.api_pricing;
create trigger touch_api_pricing
  before update on public.api_pricing
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_api_user_limits on public.api_user_limits;
create trigger touch_api_user_limits
  before update on public.api_user_limits
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------- rls

alter table public.scrape_targets   enable row level security;
alter table public.scrape_posts     enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.api_pricing      enable row level security;
alter table public.api_user_limits  enable row level security;

-- targets and posts: your own, full control. an admin can read them, because
-- "why did this person burn 200 credits" is answered by looking at what they
-- pulled, and read is as far as that needs to go.
drop policy if exists scrape_targets_own on public.scrape_targets;
create policy scrape_targets_own on public.scrape_targets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists scrape_targets_admin_read on public.scrape_targets;
create policy scrape_targets_admin_read on public.scrape_targets
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists scrape_posts_own on public.scrape_posts;
create policy scrape_posts_own on public.scrape_posts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists scrape_posts_admin_read on public.scrape_posts;
create policy scrape_posts_admin_read on public.scrape_posts
  for select to authenticated
  using ((select private.is_admin()));

-- the ledger is READ ONLY to everybody who goes through rls. there is no
-- insert, update or delete policy on purpose, so even the row's own owner
-- cannot touch it. the only writer is the service key, which bypasses rls and
-- is reachable only from server code that has already identified the caller.
drop policy if exists api_usage_events_own_read on public.api_usage_events;
create policy api_usage_events_own_read on public.api_usage_events
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists api_usage_events_admin_read on public.api_usage_events;
create policy api_usage_events_admin_read on public.api_usage_events
  for select to authenticated
  using ((select private.is_admin()));

-- pricing: anyone signed in may read it, because the tool has to tell a creator
-- what a click costs before they click. only an admin can change it.
drop policy if exists api_pricing_read on public.api_pricing;
create policy api_pricing_read on public.api_pricing
  for select to authenticated
  using (true);

drop policy if exists api_pricing_admin_write on public.api_pricing;
create policy api_pricing_admin_write on public.api_pricing
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists api_user_limits_own_read on public.api_user_limits;
create policy api_user_limits_own_read on public.api_user_limits
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists api_user_limits_admin_write on public.api_user_limits;
create policy api_user_limits_admin_write on public.api_user_limits
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- The admin usage page needs a name and an email against each user_id, and
-- profiles was own-rows-only until now. Read only, admins only.
drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin on public.profiles
  for select to authenticated
  using ((select private.is_admin()));

-- ==== 20260808230000_brand_identity.sql
-- Brands get a face and a file.
--
-- Two logo columns rather than one, because they answer different questions.
-- `logo_key` points at an entry in lib/brand-catalog.ts, so the brand keeps its
-- mark even when the catalogue swaps the file behind that key. `logo_url` is
-- the escape hatch for a brand the list has never heard of. Both null is the
-- normal case and renders the brand's initial, never a broken image.
--
-- The catalogue is a convenience, never a whitelist: a brand missing from it is
-- a slower path, not a blocked one. That is why neither column is constrained
-- against it and neither is required.
alter table public.brands
  add column if not exists logo_key text,
  add column if not exists logo_url text;

-- ==== 20260808234500_brand_logo_backfill.sql
-- Give the brands that predate `logo_key` the mark they should have had.
--
-- Name matching happens exactly once per brand, on write, and the answer is
-- stored. Brands created before the column existed never got that pass, so this
-- is that pass, run once. A resolver that matched names on every read would be
-- simpler and wrong: a creator could never clear a logo off a brand whose name
-- is in the catalogue, because the clear would save and the next render would
-- put it straight back.
--
-- The slug on the right is the same normalisation `brandSlug()` does in
-- lib/brand-catalog.ts: lowercased, everything that is not a letter or a digit
-- removed, so "Wispr Flow", "wisprflow" and "wispr-flow" are one brand. Keys
-- come from that file and are stable by contract, so this list cannot rot the
-- way a list of file paths would.
--
-- `where logo_key is null and logo_url is null` is what makes it safe to run
-- twice and what stops it overwriting a mark someone picked by hand.
update public.brands b
set logo_key = c.key
from (
  values
    ('anara', 'anara'),
    ('based', 'based'),
    ('biggerz', 'biggerz'),
    ('blustu', 'blustu'),
    ('breadwinners', 'breadwinners'),
    ('candle', 'candle'),
    ('codedex', 'codedex'),
    ('composio', 'composio'),
    ('folk', 'folk'),
    ('hyperknow', 'hyperknow'),
    ('launchpoint', 'launchpoint'),
    ('liftoff', 'liftoff'),
    ('lotus', 'lotus'),
    ('lovable', 'lovable'),
    ('manus', 'manus'),
    ('mathgpt', 'mathgpt'),
    ('mosaic', 'mosaic'),
    ('new-wave', 'newwave'),
    ('phrasly', 'phrasly'),
    ('pine-ai', 'pineai'),
    ('plutus', 'plutus'),
    ('polymarket', 'polymarket'),
    ('tiny-nature', 'tinynature'),
    ('turbo-ai', 'turboai'),
    ('wellspoken', 'wellspoken'),
    ('wispr-flow', 'wisprflow')
) as c (key, slug)
where b.logo_key is null
  and b.logo_url is null
  and regexp_replace(lower(b.name), '[^a-z0-9]', '', 'g') = c.slug;

-- ==== 20260809010000_calendar_notes.sql
-- The calendar's own memory.
--
-- Everything else on the calendar is derived: videos mark the days content
-- went up, deals mark the days campaigns start and end. A note is the one thing
-- with no other table to live in, "post the candle hook thursday", and it is
-- deliberately small: a day, a line of text, optionally a platform and a deal.
-- Not a scheduling engine. When real autoposting lands it gets its own table
-- with send state; a note is a plan, not a job.
create table if not exists public.calendar_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  title      text not null,
  platform   text check (platform in ('tiktok', 'instagram', 'youtube')),
  -- notes usually belong to a deal, and the calendar shows the brand when one
  -- is set. set null on delete: the plan outlives the deal row.
  deal_id    uuid references public.deals (id) on delete set null,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_notes_user_day_idx
  on public.calendar_notes (user_id, day);

drop trigger if exists touch_calendar_notes on public.calendar_notes;
create trigger touch_calendar_notes before update on public.calendar_notes
  for each row execute function public.touch_updated_at();

alter table public.calendar_notes enable row level security;
drop policy if exists own_rows on public.calendar_notes;
create policy own_rows on public.calendar_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ==== 20260809030000_autopost.sql
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

-- ==== 20260809030000_earn_referrals.sql
-- The referral programme. A member turns their link on, posts it, and gets a
-- share of every payment the people who signed up on it make.
--
-- Five tables, in the order one referral moves through them:
--
--   affiliates            one row per member who has turned their link on
--   referral_clicks       somebody opened /r/<code>. a counter, not a person
--   referrals             one row per ACCOUNT that signed up on a link
--   referral_commissions  one row per PAYMENT, so a recurring share is a row a month
--   affiliate_payouts     what we actually sent them, and when
--
-- Money is an integer of cents end to end, the same as the deal tracker. The
-- rate is stored in basis points ON the commission row rather than read from
-- config when a payout is cut: the programme's terms will change, and a share
-- already earned must not silently re-price itself six months later.
--
-- Nothing in here needs a cron. "pending" versus "ready to pay" is a date
-- comparison in the view, not a status somebody has to remember to flip.

-- ---------------------------------------------------------------- affiliates

create table if not exists public.affiliates (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- the code in the link. lowercase, url safe, and never rewritten once
  -- claimed: it is sitting in a tiktok bio and a pinned comment, so changing
  -- it would break links other people already posted.
  code text not null unique
    check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),

  status text not null default 'active'
    check (status in ('active', 'paused', 'blocked')),

  -- where the money goes. four strings rather than a lookup table, because a
  -- lookup table for four strings is a join nobody wanted.
  payout_method text check (payout_method in ('paypal', 'wise', 'bank', 'other')),
  payout_email text,
  payout_note text,

  -- who this member is inside whatever affiliate platform gets wired up later
  -- (rewardful, tolt, partnerstack). null for as long as we are the platform,
  -- and the one column an external tool needs to key against.
  external_id text,

  terms_agreed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- clicks

create table if not exists public.referral_clicks (
  id bigint generated always as identity primary key,
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,

  -- where the link pointed, and which site it came off. both exist to answer
  -- the member's own "which post is actually working" question. no ip, no user
  -- agent and no cookie id is stored here, deliberately: this table is a
  -- counter and it should never become a log of people.
  landing_path text,
  referrer_host text,

  created_at timestamptz not null default now()
);

create index if not exists referral_clicks_owner_idx
  on public.referral_clicks (affiliate_user_id, created_at desc);

-- ---------------------------------------------------------------- referrals

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,

  -- one attribution per account, and the FIRST link wins. the unique
  -- constraint is the whole rule: a second visit on somebody else's link
  -- cannot move a signup onto a different member's ledger later.
  referred_user_id uuid not null unique references auth.users (id) on delete cascade,
  referred_email text,

  status text not null default 'signed_up'
    check (status in ('signed_up', 'active', 'canceled', 'void')),

  first_paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- nobody earns a commission on their own signup
  constraint referrals_not_self check (referred_user_id <> affiliate_user_id)
);

create index if not exists referrals_owner_idx
  on public.referrals (affiliate_user_id, created_at desc);

-- ------------------------------------------------------------------ payouts

-- declared before commissions because a commission points at the payout that
-- settled it.
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents bigint not null default 0,
  method text,
  reference text,
  status text not null default 'due'
    check (status in ('due', 'sent', 'paid', 'failed')),
  sent_on date,
  paid_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_payouts_owner_idx
  on public.affiliate_payouts (affiliate_user_id, created_at desc);

-- -------------------------------------------------------------- commissions

create table if not exists public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  referral_id uuid not null references public.referrals (id) on delete cascade,

  -- the invoice this share came off, and the entire idempotency story. stripe
  -- retries an event for three days, and a webhook that paid a commission
  -- twice is real money out the door.
  stripe_invoice_id text unique,

  gross_cents bigint not null default 0,
  -- basis points. 5000 is 50%. frozen at the moment it was earned.
  rate_bps integer not null,
  amount_cents bigint not null default 0,
  currency text not null default 'usd',

  -- the day it stops being clawback-able. a refund inside that window voids
  -- the row rather than subtracting from a later one.
  mature_on date not null,

  status text not null default 'pending'
    check (status in ('pending', 'paid', 'void')),

  payout_id uuid references public.affiliate_payouts (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists referral_commissions_owner_idx
  on public.referral_commissions (affiliate_user_id, created_at desc);

create index if not exists referral_commissions_referral_idx
  on public.referral_commissions (referral_id, created_at desc);

-- ------------------------------------------------------------- updated_at

drop trigger if exists touch_affiliates on public.affiliates;
create trigger touch_affiliates before update on public.affiliates
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_referrals on public.referrals;
create trigger touch_referrals before update on public.referrals
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_affiliate_payouts on public.affiliate_payouts;
create trigger touch_affiliate_payouts before update on public.affiliate_payouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- the numbers

-- Every figure the Earn page prints, as one row. `security_invoker` means rls
-- on the base tables is what scopes it, so this view needs no user argument
-- and cannot leak another member's ledger.
--
-- "pending" versus "ready" is `mature_on` against today rather than a stored
-- status, which is what keeps the whole feature cron-free.
create or replace view public.affiliate_stats
with (security_invoker = true) as
select
  a.user_id,
  a.code,

  (select count(*) from public.referral_clicks c
    where c.affiliate_user_id = a.user_id) as clicks,

  (select count(*) from public.referrals r
    where r.affiliate_user_id = a.user_id and r.status <> 'void') as signups,

  (select count(*) from public.referrals r
    where r.affiliate_user_id = a.user_id and r.status = 'active') as active_referrals,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id
      and m.status = 'pending' and m.mature_on > current_date) as pending_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id
      and m.status = 'pending' and m.mature_on <= current_date) as ready_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id and m.status = 'paid') as paid_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id and m.status <> 'void') as lifetime_cents,

  -- what next month looks like if nobody cancels: the newest commission on
  -- every referral that is still paying. an active referral that has not been
  -- billed yet contributes nothing rather than an invented number.
  (select coalesce(sum(latest.amount_cents), 0)
     from public.referrals r
     cross join lateral (
       select m.amount_cents
         from public.referral_commissions m
        where m.referral_id = r.id and m.status <> 'void'
        order by m.created_at desc
        limit 1
     ) latest
    where r.affiliate_user_id = a.user_id and r.status = 'active') as run_rate_cents

from public.affiliates a;

-- -------------------------------------------------------------------- grants

-- Default privileges in supabase hand `all` on a new public table to anon and
-- authenticated, which would let a member set their own status or write their
-- own commission rows. Everything is revoked and handed back one column at a
-- time instead.

revoke all on public.affiliates from anon, authenticated;
grant select on public.affiliates to authenticated;
-- claiming a link is the only insert, and it may only carry these two columns.
-- status, external_id and the payout fields are not on it.
grant insert (user_id, code, terms_agreed_at) on public.affiliates to authenticated;
-- the code is absent here on purpose: it is immutable once claimed.
grant update (payout_method, payout_email, payout_note) on public.affiliates to authenticated;

revoke all on public.referral_clicks from anon, authenticated;
grant select on public.referral_clicks to authenticated;

revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;

revoke all on public.referral_commissions from anon, authenticated;
grant select on public.referral_commissions to authenticated;

revoke all on public.affiliate_payouts from anon, authenticated;
grant select on public.affiliate_payouts to authenticated;

grant select on public.affiliate_stats to authenticated;

-- ----------------------------------------------------------------------- rls

alter table public.affiliates enable row level security;
drop policy if exists own_row on public.affiliates;
create policy own_row on public.affiliates for select to authenticated
  using (user_id = auth.uid());
drop policy if exists claim_own on public.affiliates;
create policy claim_own on public.affiliates for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists update_own on public.affiliates;
create policy update_own on public.affiliates for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.referral_clicks enable row level security;
drop policy if exists own_rows on public.referral_clicks;
create policy own_rows on public.referral_clicks for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.referrals enable row level security;
-- the affiliate sees the row. the person referred deliberately does not: it is
-- somebody else's ledger, and it carries their commission terms.
drop policy if exists own_rows on public.referrals;
create policy own_rows on public.referrals for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.referral_commissions enable row level security;
drop policy if exists own_rows on public.referral_commissions;
create policy own_rows on public.referral_commissions for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.affiliate_payouts enable row level security;
drop policy if exists own_rows on public.affiliate_payouts;
create policy own_rows on public.affiliate_payouts for select to authenticated
  using (affiliate_user_id = auth.uid());

-- ------------------------------------------------------------------ the rpcs

-- Two writes happen from outside the owner's own session, so both are
-- `security definer` with a pinned search_path rather than a service key. That
-- keeps the whole feature working on a deploy that has never been given
-- SUPABASE_SECRET_KEY, and it keeps the rls-bypassing surface down to these
-- two functions instead of a client that can touch every table.

-- Somebody opened /r/<code>. Callable by anon, because most clicks are.
--
-- No dedupe: without storing something that identifies the visitor there is
-- nothing to dedupe against, and storing that is worse than a soft number.
-- Treat clicks as a trend, never as a count to pay against.
create or replace function public.record_referral_click(
  p_code text,
  p_path text default null,
  p_referrer text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner
    from public.affiliates
   where code = lower(p_code) and status = 'active';

  if v_owner is null then
    return;
  end if;

  insert into public.referral_clicks (affiliate_user_id, code, landing_path, referrer_host)
  values (v_owner, lower(p_code), left(p_path, 200), left(p_referrer, 120));
end;
$$;

revoke all on function public.record_referral_click(text, text, text) from public;
grant execute on function public.record_referral_click(text, text, text) to anon, authenticated;

-- Attach the caller's brand new account to the link they arrived on.
--
-- Called once, from the auth callback, with the code off the referral cookie.
-- Returns whether an attribution was actually made, so the caller can clear
-- the cookie either way and never try twice.
create or replace function public.attach_referral(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    return false;
  end if;

  select user_id into v_owner
    from public.affiliates
   where code = lower(p_code) and status = 'active';

  -- unknown code, a paused programme, or somebody clicking their own link
  if v_owner is null or v_owner = v_uid then
    return false;
  end if;

  insert into public.referrals (affiliate_user_id, code, referred_user_id, referred_email)
  select v_owner, lower(p_code), v_uid, u.email
    from auth.users u
   where u.id = v_uid
  on conflict (referred_user_id) do nothing;

  -- false when the account was already attributed. first link wins.
  return found;
end;
$$;

revoke all on function public.attach_referral(text) from public;
grant execute on function public.attach_referral(text) to authenticated;

-- ==== 20260809031000_earn_referrals_owner_fk.sql
-- The ledger hangs off `affiliates`, not off `auth.users`.
--
-- As first written, deleting an affiliate row left its clicks, referrals,
-- commissions and payouts standing with nothing pointing at them. The stats
-- view starts from `affiliates`, so those rows became invisible while still
-- being money somebody was owed. Pointing the owner column at the affiliate
-- itself means there is no orphan state to reason about: either the programme
-- membership exists and its ledger with it, or neither does.
--
-- Account deletion still cascades the whole way down, because `affiliates`
-- itself is `references auth.users (id) on delete cascade`.
--
-- A member who breaks the rules is set to status 'blocked'. Nothing in the app
-- deletes an affiliate, and `authenticated` has no delete grant on the table.

alter table public.referral_clicks
  drop constraint if exists referral_clicks_affiliate_user_id_fkey,
  add constraint referral_clicks_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.referrals
  drop constraint if exists referrals_affiliate_user_id_fkey,
  add constraint referrals_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.referral_commissions
  drop constraint if exists referral_commissions_affiliate_user_id_fkey,
  add constraint referral_commissions_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_affiliate_user_id_fkey,
  add constraint affiliate_payouts_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

-- ==== 20260809050000_editing.sql
-- The editing marketplace: editors sign up, publish a portfolio, and pick up
-- edit jobs that creators post. Five tables:
--
--   editors                one row per editor, portfolio as a jsonb document
--                          (same shape of reasoning as public.portfolios: the
--                          profile is edited and saved as one thing)
--   edit_jobs              the bounty. a creator posts footage + references +
--                          an offer; an open job is visible to every editor,
--                          the first claim wins
--   edit_job_deliverables  the cuts an editor sends back, versioned
--   edit_job_events        comments + status changes, one timeline per job
--   editor_payouts         what a finished job is worth, frozen at approval.
--                          never recomputed, same lesson as public.payouts
--
-- Access model in one line: creators own their jobs, editors see open jobs and
-- everything about jobs they claimed, the public sees published editor
-- profiles and nothing else.

-- -------------------------------------------------------------------- editors

create table if not exists public.editors (
  user_id    uuid primary key references auth.users (id) on delete cascade,

  -- the public address, ugcflows.com/e/<handle>. blank until picked.
  handle     text not null default '',
  published  boolean not null default false,

  name       text,
  headline   text,
  location   text,
  avatar_url text,
  bio        text,

  -- what they cut and what they cut it with. validated in lib, not here: a
  -- check constraint that rejects a save is worse than a clamped field.
  skills     jsonb not null default '[]'::jsonb,
  software   jsonb not null default '[]'::jsonb,
  links      jsonb not null default '[]'::jsonb,
  -- the portfolio reel: [{url, title, platform}]
  reel       jsonb not null default '[]'::jsonb,

  -- typical asking price per video, advisory only. the number that pays is
  -- the one on the job.
  rate_cents       integer,
  turnaround_hours integer,

  -- taking work right now or not. paused editors keep their portfolio.
  status   text not null default 'active' check (status in ('active', 'paused')),

  -- set by staff, guarded by a trigger below. self-serve verification is not
  -- verification.
  verified boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists editors_handle_key
  on public.editors (lower(handle))
  where handle <> '';

create index if not exists editors_published_idx
  on public.editors (lower(handle))
  where published;

drop trigger if exists touch_editors on public.editors;
create trigger touch_editors
  before update on public.editors
  for each row execute function public.touch_updated_at();

-- verified is staff-only. clamp rather than reject so a profile save from the
-- editor never fails because of a flag they cannot see.
create or replace function public.guard_editor_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- service role and sql console pass through
  end if;
  if tg_op = 'INSERT' then
    if new.verified and not public.am_i_admin() then
      new.verified := false;
    end if;
  elsif new.verified is distinct from old.verified and not public.am_i_admin() then
    new.verified := old.verified;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_editors on public.editors;
create trigger guard_editors
  before insert or update on public.editors
  for each row execute function public.guard_editor_flags();

-- ------------------------------------------------------------------ edit_jobs

create table if not exists public.edit_jobs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- optionally pinned to the brand deal the footage belongs to
  deal_id uuid references public.deals (id) on delete set null,

  title  text not null,
  brief  text,
  -- the style asked for, free text: "fast cuts like the refs", "clean talking
  -- head with captions"
  style  text,
  -- target output, free text: "9:16, under 60s"
  format text,

  -- links out, both [{url, label}]. footage is drive/dropbox, references are
  -- videos that look like what the creator wants back.
  footage_links   jsonb not null default '[]'::jsonb,
  reference_links jsonb not null default '[]'::jsonb,

  -- the offer. flat for the whole job or per finished video.
  pay_kind    text not null default 'flat' check (pay_kind in ('flat', 'per_video')),
  pay_cents   integer not null default 0 check (pay_cents >= 0),
  video_count integer not null default 1 check (video_count >= 1),

  status text not null default 'open' check (
    status in ('open', 'claimed', 'delivered', 'revisions', 'approved', 'cancelled')
  ),

  -- who claimed it. null while open. the claim is an atomic
  -- "where status = 'open' and editor_id is null" update, first editor wins.
  editor_id    uuid references public.editors (user_id) on delete set null,
  claimed_at   timestamptz,
  due_at       timestamptz,
  delivered_at timestamptz,
  approved_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_jobs_user_idx   on public.edit_jobs (user_id, created_at desc);
create index if not exists edit_jobs_editor_idx on public.edit_jobs (editor_id, created_at desc);
create index if not exists edit_jobs_deal_idx   on public.edit_jobs (deal_id);
-- the market page's only lookup
create index if not exists edit_jobs_open_idx   on public.edit_jobs (created_at desc) where status = 'open';

drop trigger if exists touch_edit_jobs on public.edit_jobs;
create trigger touch_edit_jobs
  before update on public.edit_jobs
  for each row execute function public.touch_updated_at();

-- rls lets a claimed editor update the row (deliver, re-deliver), but the
-- offer and the brief belong to the creator, and approval is the creator's
-- word. enforced here because rls cannot see which columns changed.
create or replace function public.guard_edit_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select auth.uid()) = old.user_id then
    return new;
  end if;

  -- somebody other than the owner: an editor claiming or delivering
  if new.user_id <> old.user_id
    or new.deal_id is distinct from old.deal_id
    or new.title <> old.title
    or new.brief is distinct from old.brief
    or new.pay_kind <> old.pay_kind
    or new.pay_cents <> old.pay_cents
    or new.video_count <> old.video_count then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_edit_jobs on public.edit_jobs;
create trigger guard_edit_jobs
  before update on public.edit_jobs
  for each row execute function public.guard_edit_job_update();

-- -------------------------------------------------------- edit_job_deliverables

create table if not exists public.edit_job_deliverables (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.edit_jobs (id) on delete cascade,
  editor_id uuid not null references auth.users (id) on delete cascade,

  url     text not null,
  note    text,
  version integer not null default 1,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_deliverables_job_idx
  on public.edit_job_deliverables (job_id, created_at desc);
create index if not exists edit_job_deliverables_editor_idx
  on public.edit_job_deliverables (editor_id);

-- ------------------------------------------------------------- edit_job_events

create table if not exists public.edit_job_events (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.edit_jobs (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,

  kind text not null default 'comment' check (kind in ('comment', 'status')),
  body text not null,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_events_job_idx
  on public.edit_job_events (job_id, created_at);
create index if not exists edit_job_events_author_idx
  on public.edit_job_events (author_id);

-- ------------------------------------------------------------- editor_payouts

create table if not exists public.editor_payouts (
  id        uuid primary key default gen_random_uuid(),
  -- the job can be deleted later; the money record survives
  job_id    uuid references public.edit_jobs (id) on delete set null,
  editor_id uuid not null references auth.users (id) on delete cascade,
  -- who owes it
  user_id   uuid not null references auth.users (id) on delete cascade,

  amount_cents integer not null check (amount_cents >= 0),
  -- frozen wording of what this paid for, so the row still reads after the
  -- job is gone
  memo         text,

  status  text not null default 'due' check (status in ('due', 'paid')),
  paid_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists editor_payouts_editor_idx on public.editor_payouts (editor_id, created_at desc);
create index if not exists editor_payouts_user_idx   on public.editor_payouts (user_id, created_at desc);
create index if not exists editor_payouts_job_idx    on public.editor_payouts (job_id);

-- ------------------------------------------------------------------------ rls

alter table public.editors               enable row level security;
alter table public.edit_jobs             enable row level security;
alter table public.edit_job_deliverables enable row level security;
alter table public.edit_job_events       enable row level security;
alter table public.editor_payouts        enable row level security;

-- editors: the public page and the marketplace read published rows with the
-- publishable key and no session. owners read themselves always.
drop policy if exists editors_public_read on public.editors;
create policy editors_public_read on public.editors
  for select to anon, authenticated
  using (published or (select auth.uid()) = user_id);

drop policy if exists editors_insert_own on public.editors;
create policy editors_insert_own on public.editors
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists editors_update_own on public.editors;
create policy editors_update_own on public.editors
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists editors_delete_own on public.editors;
create policy editors_delete_own on public.editors
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- is the caller an editor at all. used by the job policies so the open board
-- is editors-only rather than every signed-in customer.
create or replace function public.am_i_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editors where user_id = (select auth.uid())
  );
$$;

-- edit_jobs: owner sees theirs, the claimed editor sees theirs, and any
-- editor sees the open board.
drop policy if exists edit_jobs_select on public.edit_jobs;
create policy edit_jobs_select on public.edit_jobs
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
    or (status = 'open' and public.am_i_editor())
  );

drop policy if exists edit_jobs_insert_own on public.edit_jobs;
create policy edit_jobs_insert_own on public.edit_jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- two update paths: the owner edits freely; an editor may claim an open job
-- (writing themselves in) or update a job already theirs. the trigger above
-- keeps the editor path away from the brief and the money.
drop policy if exists edit_jobs_update on public.edit_jobs;
create policy edit_jobs_update on public.edit_jobs
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
    or (status = 'open' and public.am_i_editor())
  )
  with check (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
  );

drop policy if exists edit_jobs_delete_own on public.edit_jobs;
create policy edit_jobs_delete_own on public.edit_jobs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- deliverables: visible to the two people on the job, written by the editor.
drop policy if exists deliverables_select on public.edit_job_deliverables;
create policy deliverables_select on public.edit_job_deliverables
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists deliverables_insert on public.edit_job_deliverables;
create policy deliverables_insert on public.edit_job_deliverables
  for insert to authenticated
  with check (
    (select auth.uid()) = editor_id
    and exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and j.editor_id = (select auth.uid())
    )
  );

drop policy if exists deliverables_delete_own on public.edit_job_deliverables;
create policy deliverables_delete_own on public.edit_job_deliverables
  for delete to authenticated
  using ((select auth.uid()) = editor_id);

-- events: same audience, either side writes as themselves.
drop policy if exists events_select on public.edit_job_events;
create policy events_select on public.edit_job_events
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists events_insert on public.edit_job_events;
create policy events_insert on public.edit_job_events
  for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- payouts: both parties read, the payer writes. no update policy for editors,
-- so "paid" is the payer's word alone.
drop policy if exists editor_payouts_select on public.editor_payouts;
create policy editor_payouts_select on public.editor_payouts
  for select to authenticated
  using ((select auth.uid()) = editor_id or (select auth.uid()) = user_id);

drop policy if exists editor_payouts_insert on public.editor_payouts;
create policy editor_payouts_insert on public.editor_payouts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists editor_payouts_update on public.editor_payouts;
create policy editor_payouts_update on public.editor_payouts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ==== 20260809060000_editing_files.sql
-- Real files on edit jobs, not just links. A creator uploads raw footage and
-- reference images/videos straight to storage from the browser; an editor
-- uploads finished cuts the same way. The bucket is private end to end and
-- every read goes through a signed url minted for a job participant, so a
-- leaked path is not a leaked video.
--
-- Object paths carry the access model: <job_id>/assets/<file> is the
-- creator's footage and references, <job_id>/cuts/<file> is the editor's
-- deliveries. The storage policies join edit_jobs on that first segment, so
-- who can touch what is the same question RLS already answers for the job.

-- ------------------------------------------------------------- edit_job_files

create table if not exists public.edit_job_files (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.edit_jobs (id) on delete cascade,
  uploader_id uuid not null references auth.users (id) on delete cascade,

  kind text not null default 'footage' check (kind in ('footage', 'reference', 'cut')),

  -- the storage object path inside the editing-assets bucket
  path       text not null unique,
  name       text not null,
  mime       text,
  size_bytes bigint,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_files_job_idx
  on public.edit_job_files (job_id, created_at desc);
create index if not exists edit_job_files_uploader_idx
  on public.edit_job_files (uploader_id);

alter table public.edit_job_files enable row level security;

drop policy if exists job_files_select on public.edit_job_files;
create policy job_files_select on public.edit_job_files
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- footage and references come from the job's owner, cuts from its editor
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (kind in ('footage', 'reference') and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.user_id = (select auth.uid())
      ))
      or
      (kind = 'cut' and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.editor_id = (select auth.uid())
      ))
    )
  );

-- the uploader tidies their own mistakes, the job owner tidies the job
drop policy if exists job_files_delete on public.edit_job_files;
create policy job_files_delete on public.edit_job_files
  for delete to authenticated
  using (
    (select auth.uid()) = uploader_id
    or exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and j.user_id = (select auth.uid())
    )
  );

-- --------------------------------------------------------------------- bucket

-- 500mb per file, video and image only. the project-level upload cap still
-- applies on top of this; raise it in the dashboard if uploads 413.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'editing-assets',
  'editing-assets',
  false,
  524288000,
  array['video/*', 'image/*']
)
on conflict (id) do nothing;

-- ------------------------------------------------------------ storage policies

drop policy if exists editing_assets_insert on storage.objects;
create policy editing_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'editing-assets'
    and (
      (
        (storage.foldername(name))[2] = 'assets'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.user_id = (select auth.uid())
        )
      )
      or (
        (storage.foldername(name))[2] = 'cuts'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.editor_id = (select auth.uid())
        )
      )
    )
  );

-- reads mint signed urls server side, but the minting itself runs as the
-- user, so select has to admit both people on the job and nobody else.
drop policy if exists editing_assets_select on storage.objects;
create policy editing_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'editing-assets'
    and exists (
      select 1 from public.edit_jobs j
      where j.id::text = (storage.foldername(name))[1]
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists editing_assets_delete on storage.objects;
create policy editing_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'editing-assets'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.edit_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and j.user_id = (select auth.uid())
      )
    )
  );

