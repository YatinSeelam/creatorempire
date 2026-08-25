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
