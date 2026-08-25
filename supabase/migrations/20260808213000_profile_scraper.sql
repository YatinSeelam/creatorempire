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
