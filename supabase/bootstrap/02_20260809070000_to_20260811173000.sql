-- ==== 20260809070000_admin_visibility.sql
-- Admin visibility.
--
-- Until now the only tables staff could read across accounts were the ones the
-- usage page needed: profiles, the api ledger, and the scraper's two. Everything
-- else carries a single `own_rows` policy of `user_id = auth.uid()`, so an admin
-- opening somebody's page got an empty screen rather than a permission error,
-- which is the worse of the two failures because it looks like no data.
--
-- Every policy below is SELECT only, on purpose. `own_rows` is FOR ALL and stays
-- the only way anything is written, so staff can look at a deal and still cannot
-- edit one. Permissive policies are OR'd, so each of these widens reads and
-- touches nothing else.
--
-- `private.is_admin()` is the same function the existing admin policies and
-- `am_i_admin()` call, wrapped in a scalar subquery so postgres runs it once per
-- statement instead of once per row.

create policy "brands_admin_read" on public.brands
  for select to authenticated using ((select private.is_admin()));

create policy "deals_admin_read" on public.deals
  for select to authenticated using ((select private.is_admin()));

create policy "bonus_rules_admin_read" on public.bonus_rules
  for select to authenticated using ((select private.is_admin()));

create policy "deal_accounts_admin_read" on public.deal_accounts
  for select to authenticated using ((select private.is_admin()));

create policy "videos_admin_read" on public.videos
  for select to authenticated using ((select private.is_admin()));

create policy "video_stats_admin_read" on public.video_stats
  for select to authenticated using ((select private.is_admin()));

create policy "payouts_admin_read" on public.payouts
  for select to authenticated using ((select private.is_admin()));

create policy "ingest_runs_admin_read" on public.ingest_runs
  for select to authenticated using ((select private.is_admin()));

create policy "calendar_notes_admin_read" on public.calendar_notes
  for select to authenticated using ((select private.is_admin()));

create policy "portfolios_admin_read" on public.portfolios
  for select to authenticated using ((select private.is_admin()));

create policy "transcripts_admin_read" on public.transcripts
  for select to authenticated using ((select private.is_admin()));

create policy "social_posts_admin_read" on public.social_posts
  for select to authenticated using ((select private.is_admin()));

create policy "social_profiles_admin_read" on public.social_profiles
  for select to authenticated using ((select private.is_admin()));

create policy "edit_jobs_admin_read" on public.edit_jobs
  for select to authenticated using ((select private.is_admin()));

create policy "editor_payouts_admin_read" on public.editor_payouts
  for select to authenticated using ((select private.is_admin()));

create policy "subscriptions_admin_read" on public.subscriptions
  for select to authenticated using ((select private.is_admin()));

create policy "affiliates_admin_read" on public.affiliates
  for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------- the roster

-- One row per person with every count the admin list prints, so the page is a
-- single query rather than a fan of them per profile.
--
-- `security_invoker` is what makes this safe to leave granted to authenticated:
-- each subquery is filtered by the caller's own policies, so a creator who
-- somehow reached it sees one row, their own, with their own numbers. It is the
-- admin policies above that turn the same view into the whole roster for staff.
--
-- The counts are correlated subqueries rather than a pile of left joins because
-- a join against `videos` and `scrape_posts` at once multiplies the rows and
-- every sum comes out wrong in a way that still looks plausible.
create or replace view public.admin_people
with (security_invoker = true) as
select
  p.id                                as user_id,
  p.email,
  p.full_name,
  p.avatar_url,
  p.handle,
  p.niche,
  p.created_at,
  exists (
    select 1 from public.admin_emails a where a.email = lower(p.email)
  )                                   as is_admin,
  po.slug                             as portfolio_slug,
  coalesce(po.published, false)       as portfolio_published,
  (select count(*) from public.deals d where d.user_id = p.id)          as deal_count,
  (select count(*) from public.videos v where v.user_id = p.id)         as video_count,
  (select coalesce(sum(v.views), 0) from public.videos v
     where v.user_id = p.id)                                            as tracked_views,
  (select max(v.posted_at) from public.videos v where v.user_id = p.id) as last_posted_at,
  (select count(*) from public.scrape_posts s where s.user_id = p.id)   as scraped_post_count,
  (select coalesce(sum(s.views), 0) from public.scrape_posts s
     where s.user_id = p.id)                                            as scraped_views,
  (select count(*) from public.social_posts sp where sp.user_id = p.id) as social_post_count,
  (select count(*) from public.transcripts t where t.user_id = p.id)    as transcript_count,
  (select count(*) from public.edit_jobs j where j.user_id = p.id)      as edit_job_count,
  (select coalesce(sum(e.credits_charged), 0) from public.api_usage_events e
     where e.user_id = p.id)                                            as credits_spent,
  (select max(e.created_at) from public.api_usage_events e
     where e.user_id = p.id)                                            as last_call_at
from public.profiles p
left join public.portfolios po on po.user_id = p.id;

revoke all on public.admin_people from anon;
grant select on public.admin_people to authenticated;

-- ==== 20260809180000_payment_cycles.sql
-- payment cycles: deals learn where their pay period starts, and earnings
-- become readable as of any date so a period is a subtraction.

-- null keeps the old behaviour: monthly cycles run with the calendar month,
-- weekly and biweekly ones anchor on started_on. a date here moves the
-- boundary, so a "16th to 15th" deal stores the 16th and a biweekly deal
-- stores any day inside one of its periods.
alter table public.deals add column if not exists cycle_anchor_on date;

-- earnings as they stood at the end of day p_at. same rules and same shape as
-- video_rule_earnings, with every reading capped at p_at, so earnings inside
-- a period are asof(period_end) minus asof(day before period_start) and caps,
-- min_views and milestone tiers stay correct by construction: a cap already
-- hit earns nothing more in later periods, a milestone lands in the period
-- the video crossed it.
create or replace function public.video_rule_earnings_asof(p_at date, p_deal uuid default null)
returns table(deal_id uuid, video_id uuid, rule_id uuid, countable_views bigint, amount_cents bigint)
language sql
stable
set search_path to 'public'
as $function$
  with vid as (
    select v.id, v.deal_id, v.platform, (v.posted_at at time zone 'utc')::date as posted_on
    from videos v
    where v.counts and v.posted_at is not null
      and (v.posted_at at time zone 'utc')::date <= p_at
      and (p_deal is null or v.deal_id = p_deal)
  ),
  paired as (
    select
      v.id as video_id, v.deal_id as deal_id, r.id as rule_id,
      r.kind, r.rate_cents_per_1k, r.amount_cents, r.tiers, r.min_views, r.cap_cents,
      case when r.window_kind = 'absolute' then r.starts_on end as w_start,
      least(
        coalesce(case r.window_kind
          when 'absolute' then r.ends_on
          when 'since_post' then v.posted_on + r.window_days
        end, p_at),
        p_at
      ) as w_end,
      case
        when r.window_kind = 'absolute'
          then v.posted_on between r.starts_on and coalesce(r.ends_on, 'infinity'::date)
        else true
      end as posted_ok
    from vid v
    join bonus_rules r
      on r.deal_id = v.deal_id
     and (cardinality(r.platforms) = 0 or v.platform = any (r.platforms))
  ),
  edges as (
    select p.*,
      case when p.w_start is null then 0::bigint
        else coalesce((select s.views from video_stats s
          where s.video_id = p.video_id and s.day <= p.w_start
          order by s.day desc limit 1), 0)
      end as views_start,
      coalesce((select s.views from video_stats s
        where s.video_id = p.video_id and s.day <= p.w_end
        order by s.day desc limit 1), 0) as views_end
    from paired p
  ),
  counted as (select e.*, greatest(e.views_end - e.views_start, 0) as cv from edges e)
  select c.deal_id, c.video_id, c.rule_id, c.cv,
    case
      when c.cv < c.min_views then 0::bigint
      else least(
        coalesce(c.cap_cents, 9223372036854775807::bigint),
        case c.kind
          when 'cpm' then round(c.cv * coalesce(c.rate_cents_per_1k, 0) / 1000.0)::bigint
          when 'per_video' then case when c.posted_ok then coalesce(c.amount_cents, 0) else 0::bigint end
          when 'milestone' then coalesce((
            select max((t ->> 'amount_cents')::bigint)
            from jsonb_array_elements(c.tiers) t
            where (t ->> 'views')::bigint <= c.cv), 0)
        end
      )
    end
  from counted c;
$function$;

create or replace function public.deal_earnings_asof(p_at date)
returns table(deal_id uuid, bonus_cents bigint)
language sql
stable
set search_path to 'public'
as $function$
  select e.deal_id, sum(e.amount_cents)::bigint
  from public.video_rule_earnings_asof(p_at) e
  group by e.deal_id;
$function$;

-- ==== 20260809200000_bonus_tiers_and_view_counting.sql
-- Bonus tiers that can replace base pay, a minimum on base pay, and view
-- counting across the platforms one cut was posted to.
--
-- Three things arrive here.
--
-- 1. `deals.min_views_for_base`. A per-video base fee that only pays once the
--    video clears a floor. Zero (the default) is exactly today's behaviour.
--
-- 2. `bonus_rules.tier_mode`. 'add' stacks the bonus on top of the base fee,
--    which is what every existing rule does. 'replace' means the bonus IS the
--    pay for that cut and the base fee is not owed on it, which is how most
--    brand tier sheets are actually written ("$30/video, or $150 at 50k").
--
-- 3. `bonus_rules.view_counting`. The same cut goes out on three platforms, so
--    the question "how many views did it get" has three answers:
--      per_video — each post earns on its own views. today's behaviour.
--      highest   — only the best performing post of the cut earns.
--      combined  — the cut's views are totalled and it earns once.
--    A "cut" is `videos.content_group`, the tag that already exists to tie one
--    edit together across platforms. An untagged video is its own group, so
--    nothing changes for anyone who never used the tag.
--
-- The earnings functions grow a `replaces_base` column and the deal rollups
-- grow a `base_videos` count, so the flat fee side can stay in TypeScript while
-- still knowing which videos are owed one. Return types change, so the four
-- functions are dropped and rebuilt rather than replaced.

alter table public.deals
  add column if not exists min_views_for_base bigint not null default 0
    check (min_views_for_base >= 0);

alter table public.bonus_rules
  add column if not exists tier_mode text not null default 'add'
    check (tier_mode in ('add', 'replace'));

alter table public.bonus_rules
  add column if not exists view_counting text not null default 'per_video'
    check (view_counting in ('per_video', 'highest', 'combined'));

drop function if exists public.deal_earnings(uuid);
drop function if exists public.deal_earnings_asof(date);
drop function if exists public.video_rule_earnings(uuid);
drop function if exists public.video_rule_earnings_asof(date, uuid);

-- The whole calculation, once. `video_rule_earnings` is a thin call into this
-- with p_at at infinity, because two copies of this query is how the live
-- number and the historical one quietly stop agreeing.
create function public.video_rule_earnings_asof(p_at date, p_deal uuid default null)
returns table (
  deal_id uuid,
  video_id uuid,
  rule_id uuid,
  countable_views bigint,
  amount_cents bigint,
  replaces_base boolean
)
language sql
stable
set search_path to 'public'
as $function$
  with vid as (
    select
      v.id,
      v.deal_id,
      v.platform,
      -- an untagged video is a group of one, so grouping never merges two cuts
      -- that were never said to be the same cut.
      coalesce(nullif(btrim(v.content_group), ''), v.id::text) as grp,
      (v.posted_at at time zone 'utc')::date as posted_on
    from videos v
    where v.counts and v.posted_at is not null
      and (v.posted_at at time zone 'utc')::date <= p_at
      and (p_deal is null or v.deal_id = p_deal)
  ),
  paired as (
    select
      v.id as video_id, v.deal_id as deal_id, v.grp, r.id as rule_id,
      r.kind, r.rate_cents_per_1k, r.amount_cents, r.tiers, r.min_views, r.cap_cents,
      r.tier_mode, r.view_counting,
      case when r.window_kind = 'absolute' then r.starts_on end as w_start,
      least(
        coalesce(case r.window_kind
          when 'absolute' then r.ends_on
          when 'since_post' then v.posted_on + r.window_days
        end, p_at),
        p_at
      ) as w_end,
      case
        when r.window_kind = 'absolute'
          then v.posted_on between r.starts_on and coalesce(r.ends_on, 'infinity'::date)
        else true
      end as posted_ok
    from vid v
    join bonus_rules r
      on r.deal_id = v.deal_id
     and (cardinality(r.platforms) = 0 or v.platform = any (r.platforms))
  ),
  edges as (
    select p.*,
      case when p.w_start is null then 0::bigint
        else coalesce((select s.views from video_stats s
          where s.video_id = p.video_id and s.day <= p.w_start
          order by s.day desc limit 1), 0)
      end as views_start,
      coalesce((select s.views from video_stats s
        where s.video_id = p.video_id and s.day <= p.w_end
        order by s.day desc limit 1), 0) as views_end
    from paired p
  ),
  counted as (select e.*, greatest(e.views_end - e.views_start, 0) as cv from edges e),
  -- one seat per (rule, cut). seat 1 is the best performing post of that cut and
  -- is the only one that earns once the rule stops counting per video.
  seated as (
    select c.*,
      sum(c.cv) over (partition by c.rule_id, c.grp) as group_views,
      row_number() over (partition by c.rule_id, c.grp order by c.cv desc, c.video_id) as seat
    from counted c
  ),
  scoped as (
    select s.*,
      case s.view_counting
        when 'highest' then case when s.seat = 1 then s.cv else 0::bigint end
        when 'combined' then case when s.seat = 1 then s.group_views else 0::bigint end
        else s.cv
      end as ev
    from seated s
  ),
  priced as (
    select s.*,
      case
        -- a non-seat-1 post under a grouping rule is paid through its group, not
        -- twice. checked before min_views, because a zero floor would otherwise
        -- let a flat per-video rule pay every platform.
        when s.view_counting <> 'per_video' and s.seat <> 1 then 0::bigint
        when s.ev < s.min_views then 0::bigint
        else least(
          coalesce(s.cap_cents, 9223372036854775807::bigint),
          case s.kind
            when 'cpm' then round(s.ev * coalesce(s.rate_cents_per_1k, 0) / 1000.0)::bigint
            when 'per_video' then case when s.posted_ok then coalesce(s.amount_cents, 0) else 0::bigint end
            when 'milestone' then coalesce((
              select max((t ->> 'amount_cents')::bigint)
              from jsonb_array_elements(s.tiers) t
              where (t ->> 'views')::bigint <= s.ev), 0)
          end
        )
      end as amt
    from scoped s
  )
  -- replacement is decided for the whole cut, not the one post that earned it:
  -- if a combined rule paid $150 for the cut, no post of that cut is owed base.
  select p.deal_id, p.video_id, p.rule_id, p.ev, p.amt,
    p.tier_mode = 'replace' and max(p.amt) over (partition by p.rule_id, p.grp) > 0
  from priced p;
$function$;

create function public.video_rule_earnings(p_deal uuid default null)
returns table (
  deal_id uuid,
  video_id uuid,
  rule_id uuid,
  countable_views bigint,
  amount_cents bigint,
  replaces_base boolean
)
language sql
stable
set search_path to 'public'
as $function$
  select r.deal_id, r.video_id, r.rule_id, r.countable_views, r.amount_cents, r.replaces_base
  from public.video_rule_earnings_asof('infinity'::date, p_deal) r;
$function$;

-- Bonus and base side by side. `base_videos` is how many videos are owed a
-- per-video flat fee: they cleared `min_views_for_base` and no replacing rule
-- has already paid for their cut. `flatFeeCents()` in lib/deals.ts multiplies
-- by it, so the flat fee stays readable TypeScript and still knows the rules.
create function public.deal_earnings_asof(p_at date)
returns table (deal_id uuid, bonus_cents bigint, base_videos bigint)
language sql
stable
set search_path to 'public'
as $function$
  with e as (
    select * from public.video_rule_earnings_asof(p_at)
  ),
  bonus as (
    select e.deal_id as did, sum(e.amount_cents)::bigint as cents
    from e group by e.deal_id
  ),
  base as (
    select v.deal_id as did, count(*)::bigint as n
    from videos v
    join deals d on d.id = v.deal_id
    where v.counts and v.posted_at is not null
      and (v.posted_at at time zone 'utc')::date <= p_at
      and not exists (select 1 from e where e.video_id = v.id and e.replaces_base)
      and coalesce((select s.views from video_stats s
            where s.video_id = v.id and s.day <= p_at
            order by s.day desc limit 1), 0) >= d.min_views_for_base
    group by v.deal_id
  )
  select coalesce(bonus.did, base.did), coalesce(bonus.cents, 0), coalesce(base.n, 0)
  from bonus
  full join base on base.did = bonus.did;
$function$;

create function public.deal_earnings(p_deal uuid default null)
returns table (deal_id uuid, bonus_cents bigint, base_videos bigint)
language sql
stable
set search_path to 'public'
as $function$
  select r.deal_id, r.bonus_cents, r.base_videos
  from public.deal_earnings_asof('infinity'::date) r
  where p_deal is null or r.deal_id = p_deal;
$function$;

grant execute on function public.video_rule_earnings(uuid) to anon, authenticated, service_role;
grant execute on function public.video_rule_earnings_asof(date, uuid) to anon, authenticated, service_role;
grant execute on function public.deal_earnings(uuid) to anon, authenticated, service_role;
grant execute on function public.deal_earnings_asof(date) to anon, authenticated, service_role;

-- ==== 20260810030000_admin_read_needs_admin_view.sql
-- Admin-wide reads must be asked for, not inherited.
--
-- 20260809070000 added an `*_admin_read` policy to every user-scoped table so
-- /admin could see other people's rows. But the whole product reads through the
-- same session client and never filters `user_id` itself ("rls does the
-- scoping"), so those policies also widened /deals, /dashboard, /calendar and
-- /social: any staff account saw every creator's deals mixed into its own list.
-- The whole (dash) group is currently admin-gated, so in practice that was
-- everybody.
--
-- The fix keeps one policy set and makes the admin half opt in per request.
-- PostgREST exposes the request headers as a GUC, so a client that deliberately
-- sends `x-admin-view: 1` gets the wide read and every other client does not.
-- The header is not the permission - `private.is_admin()` still is, and a
-- non-admin sending it gets exactly nothing. The header only narrows.

create or replace function private.admin_view()
returns boolean
language sql
stable
set search_path to ''
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-admin-view',
    ''
  ) = '1';
$$;

comment on function private.admin_view() is
  'True when the caller opted into admin-wide reads with the x-admin-view header. Pairs with private.is_admin(); never a grant on its own.';

-- Outside PostgREST (service key, sql editor, cron) the GUC is unset, so this
-- returns false. That is correct: the service key bypasses rls anyway.

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('affiliates',        'affiliates_admin_read'),
      ('api_usage_events',  'api_usage_events_admin_read'),
      ('bonus_rules',       'bonus_rules_admin_read'),
      ('brands',            'brands_admin_read'),
      ('calendar_notes',    'calendar_notes_admin_read'),
      ('deal_accounts',     'deal_accounts_admin_read'),
      ('deals',             'deals_admin_read'),
      ('edit_jobs',         'edit_jobs_admin_read'),
      ('editor_payouts',    'editor_payouts_admin_read'),
      ('ingest_runs',       'ingest_runs_admin_read'),
      ('payouts',           'payouts_admin_read'),
      ('portfolios',        'portfolios_admin_read'),
      ('profiles',          'profiles_select_admin'),
      ('scrape_posts',      'scrape_posts_admin_read'),
      ('scrape_targets',    'scrape_targets_admin_read'),
      ('social_posts',      'social_posts_admin_read'),
      ('social_profiles',   'social_profiles_admin_read'),
      ('subscriptions',     'subscriptions_admin_read'),
      ('transcripts',       'transcripts_admin_read'),
      ('video_stats',       'video_stats_admin_read'),
      ('videos',            'videos_admin_read')
    ) as t(tbl, pol)
  loop
    execute format(
      'alter policy %I on public.%I using ((select private.is_admin()) and (select private.admin_view()))',
      p.pol, p.tbl
    );
  end loop;
end $$;

-- api_user_limits folded its admin branch into the own-row policy instead of a
-- separate one, so it gets rewritten by hand.
alter policy api_user_limits_own_read on public.api_user_limits
  using (
    user_id = (select auth.uid())
    or ((select private.is_admin()) and (select private.admin_view()))
  );

-- ...and its write policy was `for all`, which means it granted select too.
-- Split it so reads go through the policy above and only the writes stay wide.
drop policy if exists api_user_limits_admin_write on public.api_user_limits;

create policy api_user_limits_admin_insert on public.api_user_limits
  for insert to authenticated
  with check ((select private.is_admin()));

create policy api_user_limits_admin_update on public.api_user_limits
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy api_user_limits_admin_delete on public.api_user_limits
  for delete to authenticated
  using ((select private.is_admin()));

-- admin_emails and api_pricing keep their plain is_admin() policies: neither
-- holds per-creator data, so widening them leaks nothing.

-- ==== 20260810040000_autopost_per_deal.sql
-- Autoposting moves from one profile per creator to one profile per deal.
--
-- The product's own model says why: a creator hired by four brands runs four
-- sets of accounts, usually a tiktok, an instagram and a youtube each. A single
-- managed profile per creator could only ever hold one login per platform, so
-- every brand's cut went out of the same three handles and the composer had no
-- way to say which brand it was posting for. The queue had the same problem in
-- reverse: one list, four brands, no way to tell whose schedule you were
-- looking at.
--
-- So the Upload-Post managed profile becomes per (creator, deal): its own
-- username, its own three OAuth connections, its own queue. Nothing about the
-- publish call changes, only which username it carries.

-- ------------------------------------------------------------ social_profiles

alter table public.social_profiles
  add column if not exists deal_id uuid references public.deals (id) on delete cascade;

-- user_id was the primary key back when a creator had exactly one profile.
-- A surrogate key takes over and (user_id, deal_id) carries the uniqueness.
alter table public.social_profiles
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.social_profiles drop constraint if exists social_profiles_pkey;
alter table public.social_profiles add primary key (id);

-- `nulls not distinct` is load bearing: rows written before this migration have
-- no deal, and without it postgres would happily let a creator collect several
-- of those. The dangling pre-deal row is left alone rather than guessed at — it
-- still holds a real Upload-Post profile with real connections behind it, and
-- picking a deal for it on the creator's behalf is not a call a migration gets
-- to make. The app ignores rows with a null deal_id.
create unique index if not exists social_profiles_user_deal_idx
  on public.social_profiles (user_id, deal_id) nulls not distinct;

-- --------------------------------------------------------------- social_posts

alter table public.social_posts
  add column if not exists deal_id uuid references public.deals (id) on delete cascade;

create index if not exists social_posts_deal_idx
  on public.social_posts (user_id, deal_id, created_at desc);

-- ==== 20260810160000_one_account_per_platform_per_deal.sql
-- one account per platform per deal.
--
-- a deal is one brand and one run of work, and the accounts it posts from are
-- one tiktok, one instagram, one youtube, made for that brand. the old key was
-- (deal_id, platform, lower(handle)), which only stopped the SAME handle being
-- added twice and happily let a deal carry three tiktoks. that made every
-- per-platform read on a deal a list rather than a value, which is why the deal
-- page needed a table with a select-all checkbox to say something a coloured
-- mark now says on its own.
--
-- lower(handle) is dropped from the key on purpose: uniqueness is per platform
-- now, so a duplicate handle cannot get in anyway.

drop index if exists public.deal_accounts_handle_key;

create unique index if not exists deal_accounts_platform_key
  on public.deal_accounts (deal_id, platform);

-- ==== 20260810190000_orgs_white_label.sql
-- Orgs: the white-label tenant layer.
--
-- A brand or a mentorship runs a roster of creators and wants the tracker under
-- their own name. That is two separate things and this migration adds both:
--
--   1. an org, its members, and their roles  (who can see whose numbers)
--   2. the org's branding                    (what the app looks like to them)
--
-- The deliberate choice here is that NO existing table gets an `org_id`. Every
-- user table in this product is keyed on `user_id` and scoped by an `own_rows`
-- policy, and re-keying twenty of them on a tenant is both a migration that can
-- lose rows and a permanent second source of truth about who owns what. A
-- creator's rows stay theirs. An org gets a READ over its members' rows, added
-- as a second policy beside `own_rows`, which is exactly the shape the existing
-- `*_admin_read` policies already use.
--
-- The consequence is worth stating out loud: joining an org never moves data and
-- leaving one never takes any. Membership is a lens, not ownership.

-- ---------------------------------------------------------------- the tables

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),

  -- the subdomain, and the url-safe name. Lowercased and constrained here rather
  -- than in app code because it ends up in DNS and in other people's bookmarks.
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(btrim(name)) > 0),

  -- branding. All optional: an org with none of it set renders in the product's
  -- own flame palette, which is a working white-label of zero effort rather than
  -- a broken screen.
  logo_url text,
  wordmark_url text,
  favicon_url text,
  -- one accent, and the dark step used for hovers and pressed states. Hex only,
  -- validated here, because these are interpolated into a style attribute and a
  -- loose string there is a css injection.
  accent_hex text check (accent_hex ~ '^#[0-9a-fA-F]{6}$'),
  accent_dark_hex text check (accent_dark_hex ~ '^#[0-9a-fA-F]{6}$'),
  -- the tint behind an accent on a card. Same validation, same reason.
  accent_soft_hex text check (accent_soft_hex ~ '^#[0-9a-fA-F]{6}$'),

  support_email text,
  -- set once DNS points at us. Null means the org lives at <slug>.ugcflows.com.
  custom_domain text unique,

  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orgs_owner_idx on public.orgs (owner_id);

-- Roles, and what each one buys:
--   owner   — everything a manager can do, plus branding, billing and deleting
--   manager — reads every member's deals, videos and money. Writes nothing of theirs
--   creator — a member. Reads only their own rows, exactly as before joining
--
-- A manager's read is deliberately read-only. An org editing a creator's deal
-- terms is a different product with a different consent story, and nothing in
-- the app should be able to do it by accident before that is designed.
create table if not exists public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'creator'
    check (role in ('owner', 'manager', 'creator')),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);

-- An invite is an email plus a token, and it is the only way into an org. There
-- is no "join by slug": a roster that anyone with the url can add themselves to
-- is a roster whose numbers cannot be trusted.
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null,
  role text not null default 'creator'
    check (role in ('owner', 'manager', 'creator')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists org_invites_org_idx on public.org_invites (org_id);
create unique index if not exists org_invites_pending_idx
  on public.org_invites (org_id, lower(email))
  where accepted_at is null;

-- ------------------------------------------------------------- the helpers
--
-- All four are `security definer` and read `org_members`, which is itself an
-- rls'd table. That is the point: a policy ON org_members that queried
-- org_members would recurse and postgres would refuse it. A definer function
-- reads underneath rls once, and every policy calls the function instead.

create or replace function private.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

create or replace function private.managed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and role in ('owner', 'manager')
$$;

-- Every user whose rows I am allowed to read through an org I manage. Excludes
-- me: my own rows already come through `own_rows`, and including myself here
-- would make the org policy look like it was doing work it is not.
create or replace function private.org_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct m.user_id
  from public.org_members m
  where m.org_id in (select private.managed_org_ids())
    and m.user_id <> auth.uid()
$$;

-- The opt in, mirroring `private.admin_view()` exactly.
--
-- Without it, a coach who also runs their own deals would open /deals and find
-- their roster's eleven brands mixed into their own four, because this product
-- never filters `user_id` in app code and trusts rls to have done it. The header
-- is not the permission — a non-member sending it still sees nothing — it is the
-- request saying which of the two views it is asking for.
create or replace function private.org_view()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    current_setting('request.headers', true)::json ->> 'x-org-view',
    ''
  ) = '1'
$$;

-- ----------------------------------------------------------- rls on the new

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;

revoke all on public.orgs from anon, authenticated;
revoke all on public.org_members from anon, authenticated;
revoke all on public.org_invites from anon, authenticated;

grant select on public.orgs to authenticated;
grant insert, update on public.orgs to authenticated;

-- anon gets the branding columns and nothing else. The login page at
-- acme.ugcflows.com has to paint acme's logo before anyone has authenticated, so
-- the row must be reachable signed out — but `owner_id` and `support_email` are
-- not branding, and a column grant is what keeps "readable" from meaning "all of
-- it". The rls policy below still has to pass on top of this.
grant select (
  id, slug, name, logo_url, wordmark_url, favicon_url,
  accent_hex, accent_dark_hex, accent_soft_hex, custom_domain
) on public.orgs to anon;
grant select on public.org_members to authenticated;
grant select, insert, update, delete on public.org_invites to authenticated;
grant delete on public.org_members to authenticated;

-- An org is readable by its members, in full. anon reaches the same rows but
-- only the branding columns, per the grant above.
drop policy if exists orgs_read_member on public.orgs;
create policy orgs_read_member on public.orgs
  for select to authenticated
  using (id in (select private.my_org_ids()));

drop policy if exists orgs_read_branding on public.orgs;
create policy orgs_read_branding on public.orgs
  for select to anon
  using (true);

drop policy if exists orgs_insert_own on public.orgs;
create policy orgs_insert_own on public.orgs
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists orgs_update_owner on public.orgs;
create policy orgs_update_owner on public.orgs
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- I can see my own membership rows, and every row of an org I manage.
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select private.managed_org_ids())
  );

-- Leaving is always allowed. Removing someone else needs the org.
drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select private.managed_org_ids())
  );

-- Invites are managed by the org and never listed to the invitee. Accepting one
-- goes through `public.accept_org_invite`, which takes the token.
drop policy if exists org_invites_manage on public.org_invites;
create policy org_invites_manage on public.org_invites
  for all to authenticated
  using (org_id in (select private.managed_org_ids()))
  with check (org_id in (select private.managed_org_ids()));

-- ------------------------------------------------------- the org's read over
--
-- One policy per table, all the same shape, all additive: `own_rows` is
-- untouched, so a creator who is in no org sees exactly what they saw before
-- this migration ran.
--
-- `video_stats` and the rule/earning tables are keyed off their parent rather
-- than carrying a user_id, so they are not listed: they inherit through the
-- existing joins once the parent is visible.
do $$
declare
  t text;
begin
  foreach t in array array[
    'brands', 'deals', 'deal_accounts', 'bonus_rules', 'videos', 'payouts',
    'social_posts', 'social_profiles', 'portfolios', 'edit_jobs', 'calendar_notes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_org_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || '(select private.org_view()) and user_id in (select private.org_member_ids())'
      || ')',
      t || '_org_read', t
    );
  end loop;
end
$$;

-- profiles is keyed on `id`, not `user_id`, so it gets the same policy by hand.
-- A roster is a list of people and it needs their names.
drop policy if exists profiles_select_org on public.profiles;
create policy profiles_select_org on public.profiles
  for select to authenticated
  using (
    (select private.org_view())
    and id in (select private.org_member_ids())
  );

-- ------------------------------------------------------------ accepting one
--
-- `security definer` because the invitee cannot see the invite row (the manage
-- policy is scoped to the org) and cannot insert their own membership. The token
-- is the authorisation. The email check is what stops a forwarded link from
-- seating the wrong person.
create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.org_invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite is not valid';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite was sent to a different email';
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do nothing;

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end
$$;

revoke all on function public.accept_org_invite(text) from public, anon;
grant execute on function public.accept_org_invite(text) to authenticated;

-- The owner is a member from the moment the org exists, so a roster is never
-- empty and `managed_org_ids` never has a hole in it right after a create.
create or replace function private.seat_org_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (org_id, user_id) do update set role = 'owner';
  return new;
end
$$;

drop trigger if exists seat_org_owner on public.orgs;
create trigger seat_org_owner
  after insert on public.orgs
  for each row execute function private.seat_org_owner();

-- ==== 20260810200000_flow_ai.sql
-- Flow, the ai layer. Three tables and nothing else.
--
-- The architectural rule from docs/04-AI-LAYER.md is that flow proposes and a
-- human applies. These tables are the proposal side of that: they hold what the
-- model said and what it wants to write, and they are the ONLY tables the model
-- loop is allowed to touch. Applying a proposal runs the same server action a
-- form runs, against the same rls, as the same user, so an ai can never write a
-- shape the ui could not.
--
-- Nothing here references a deal or a brand by foreign key. A proposal is a
-- claim about the world, not a row in it, and it has to survive the thing it
-- points at being deleted so the thread still reads back.

create table if not exists public.ai_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text,
  -- where the composer was opened from, e.g. `/deals/<uuid>`. it is what makes
  -- "the bonus went up to $5 cpm" resolvable without naming the brand.
  page_ref        text,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists ai_threads_user_recent_idx
  on public.ai_threads (user_id, last_message_at desc);

create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.ai_threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  -- the anthropic content block array as sent and received, verbatim. text,
  -- images and tool calls all live in here rather than in columns, because the
  -- next model version adds block kinds and a column per kind does not scale.
  content    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_thread_idx
  on public.ai_messages (thread_id, created_at);

create table if not exists public.ai_proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  thread_id     uuid not null references public.ai_threads (id) on delete cascade,
  message_id    uuid references public.ai_messages (id) on delete set null,

  target_entity text not null
    check (target_entity in ('deal', 'bonus_rule', 'deal_account', 'calendar_note')),
  -- null means create. an update carries the id of the row it edits, and that
  -- id is re-read through rls at apply time rather than trusted.
  target_id     uuid,
  op            text not null default 'create' check (op in ('create', 'update')),

  -- the payload, in the same loose shape the matching form posts. it is fed to
  -- the same normalise function, so a patch that would not pass the form does
  -- not pass here either.
  patch         jsonb not null,

  -- the literal span of the input this came from. it is what makes approving a
  -- two second read rather than an act of faith, so it goes on the card.
  evidence      text,
  confidence    numeric check (confidence >= 0 and confidence <= 1),

  -- read off `risk:` in lib/deal-schema.ts, highest field wins. `money` never
  -- auto applies, no matter how confident the model is.
  risk_tier     text not null default 'review'
    check (risk_tier in ('safe', 'review', 'money')),

  -- re-processing the same screenshot must not create a second gymshark deal.
  -- unique per user among live proposals; a rejected one frees the key so a
  -- corrected re-run can take it.
  dedupe_key    text,

  status        text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected', 'applied', 'failed')),
  error         text,

  created_at    timestamptz not null default now(),
  applied_at    timestamptz
);

create index if not exists ai_proposals_user_pending_idx
  on public.ai_proposals (user_id, created_at desc)
  where status = 'proposed';

create index if not exists ai_proposals_thread_idx
  on public.ai_proposals (thread_id, created_at);

-- partial: only live proposals collide. once one is rejected or applied the key
-- is free again, which is what lets a creator fix a bad read and re-send.
create unique index if not exists ai_proposals_dedupe_idx
  on public.ai_proposals (user_id, dedupe_key)
  where dedupe_key is not null and status in ('proposed', 'accepted');

alter table public.ai_threads   enable row level security;
alter table public.ai_messages  enable row level security;
alter table public.ai_proposals enable row level security;

drop policy if exists own_rows on public.ai_threads;
create policy own_rows on public.ai_threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.ai_messages;
create policy own_rows on public.ai_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.ai_proposals;
create policy own_rows on public.ai_proposals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- select only, same as every other admin_read half: staff can look at a thread
-- and still cannot accept a proposal on somebody's behalf.
create policy "ai_threads_admin_read" on public.ai_threads
  for select to authenticated using ((select private.is_admin()));

create policy "ai_messages_admin_read" on public.ai_messages
  for select to authenticated using ((select private.is_admin()));

create policy "ai_proposals_admin_read" on public.ai_proposals
  for select to authenticated using ((select private.is_admin()));

-- ==== 20260810210000_video_payment_override.sql
-- A hand-set payment for one cut, overriding what the deal's rules computed.
--
-- The rules answer "what did this earn" correctly for the deal as written, and
-- that is still the default on every row. This column is for the times the deal
-- as written is not what was agreed: a brand paid a flat $50 for one hero post,
-- a cut was reshot and only paid once, a rate was renegotiated mid-campaign.
-- Without it the only lever was `counts`, which is all or nothing.
--
-- null means "use the computed amount" and is the state of every existing row.
-- 0 is a real answer and is not the same as null: it means somebody looked at
-- this post and decided it pays nothing, which is different from a rule that
-- happens to compute zero today and may not tomorrow.
--
-- Stored per video, written to every video of a cut with the same value. The
-- posts table is one row per cut, so the amount somebody types is the amount for
-- that row; reading it off the cut's lead video is what makes the row's number
-- the number they typed rather than a share of it.
--
-- Nothing in the sync touches this. The video upsert builds its `on conflict`
-- update from the keys in its payload and this is not one of them, the same
-- reason a nightly run cannot un-tick `counts` or clear `content_group`.
alter table public.videos
  add column if not exists payment_override_cents integer;

alter table public.videos
  drop constraint if exists videos_payment_override_cents_nonneg;

alter table public.videos
  add constraint videos_payment_override_cents_nonneg
  check (payment_override_cents is null or payment_override_cents >= 0);

comment on column public.videos.payment_override_cents is
  'Hand-set payment for this cut in cents, overriding the computed base + bonus. null = use the computed amount. Written to every video of a cut, read off the lead.';

-- the deal page reads these one deal at a time and only needs the rows that have
-- one, which is a handful out of a creator''s whole history.
create index if not exists videos_payment_override_idx
  on public.videos (deal_id)
  where payment_override_cents is not null;

-- ==== 20260811040000_variations.sql
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

-- ==== 20260811050000_account_emails.sql
-- Account emails. A throwaway signup address per social account, plus the
-- verification codes that land on it.
--
-- The problem: a creator running six brand deals needs a fresh tiktok, an
-- instagram and a youtube per deal, and every one of those signups wants an
-- email address nobody has used before. Buying a mailbox each is absurd, and
-- gmail aliases get rejected by half the platforms.
--
-- The shape instead: one domain with a catch-all in front of it. Every address
-- we hand out is a row here, nothing is provisioned anywhere, and an inbound
-- worker posts every received message to /api/inbound-email. The route matches
-- the recipient back to a row, pulls the code out and stores it, so the code is
-- on screen a second or two after the platform sent it.
--
-- Two tables:
--   account_emails          the address, plus what account was made with it
--   account_email_messages  one row per inbound mail routed to an address
--
-- Only the webhook writes messages, and it holds the secret key, so that table
-- has read policies and nothing else. Anything that could write it from a
-- session could forge a code.

-- --------------------------------------------------------------- the addresses

create table if not exists public.account_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- the full address, always lowercase. unique because the webhook matches an
  -- inbound recipient back to exactly one owner, and because handing the same
  -- address to two people would put one person's codes on the other's screen.
  address     text not null unique check (address = lower(address)),
  local_part  text not null,

  -- what the address was used for, filled in AFTER the account exists. free
  -- text rather than an enum: a new platform to sign up to should not need a
  -- migration, and lib/account-emails.ts holds the list the picker offers.
  platform    text,
  username    text,
  -- the account's password. write only from a session: `authenticated` is
  -- granted update on this column and never select, so a compromised session
  -- token cannot read the vault back out. reads go through
  -- public.account_email_password(), one row at a time, on a button press.
  password_secret text,
  -- whether a password is stored, without being the password. the ui needs to
  -- say "saved" on a card, and that question should not cost a trip through
  -- the definer function or a grant on the column itself.
  password_set boolean generated always as
              (password_secret is not null and password_secret <> '') stored,
  note        text,

  -- archived keeps the row (and its codes) without listing it. deleting is
  -- still allowed, it just should not be the only way to tidy up.
  status      text not null default 'active'
              check (status in ('active', 'archived')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- bumped by the webhook so "recently used" is a sort and not a join.
  last_code_at timestamptz
);

create index if not exists account_emails_user_idx
  on public.account_emails (user_id, created_at desc);

-- touch_updated_at() comes from the deal tracker migration.
drop trigger if exists touch_account_emails on public.account_emails;
create trigger touch_account_emails
  before update on public.account_emails
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- the messages

create table if not exists public.account_email_messages (
  id       uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.account_emails (id) on delete cascade,
  -- denormalised owner. rls and the realtime row filter both become a single
  -- column check, with no join on the path a code takes to the screen.
  user_id  uuid not null references auth.users (id) on delete cascade,

  recipient     text not null,
  sender        text,
  sender_domain text,
  subject       text,
  -- best guess from the sender domain first, the subject second.
  platform      text,

  -- the extracted code, and how sure the parser was. null is a real outcome:
  -- the row is still stored, because a code the parser missed is exactly when
  -- somebody needs to read the subject line themselves.
  code       text,
  confidence text not null default 'low'
             check (confidence in ('high', 'medium', 'low', 'none')),

  -- first slice of the plain text body, for context under the code. never the
  -- whole email: this is a code utility, not a mailbox.
  snippet text,

  -- who delivered it and their id for the message. the id is the entire
  -- idempotency story, because every provider retries.
  provider            text not null default 'unknown',
  provider_message_id text,

  received_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists account_email_messages_user_idx
  on public.account_email_messages (user_id, received_at desc);

create index if not exists account_email_messages_email_idx
  on public.account_email_messages (email_id, received_at desc);

-- a redelivery of the same message is a no-op rather than a second card on the
-- screen. partial, because a provider that sends us no id still gets through.
create unique index if not exists account_email_messages_provider_msg_key
  on public.account_email_messages (provider, provider_message_id)
  where provider_message_id is not null;

-- ------------------------------------------------------------------------- rls

alter table public.account_emails enable row level security;
alter table public.account_email_messages enable row level security;

drop policy if exists account_emails_owner_select on public.account_emails;
create policy account_emails_owner_select on public.account_emails
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_emails_owner_insert on public.account_emails;
create policy account_emails_owner_insert on public.account_emails
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists account_emails_owner_update on public.account_emails;
create policy account_emails_owner_update on public.account_emails
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists account_emails_owner_delete on public.account_emails;
create policy account_emails_owner_delete on public.account_emails
  for delete to authenticated
  using (auth.uid() = user_id);

-- read only, and only for a request that asked for the wide read. same shape as
-- every other *_admin_read in this schema: the header narrows, is_admin() is
-- the permission.
drop policy if exists account_emails_admin_read on public.account_emails;
create policy account_emails_admin_read on public.account_emails
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists account_email_messages_owner_select on public.account_email_messages;
create policy account_email_messages_owner_select on public.account_email_messages
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_email_messages_admin_read on public.account_email_messages;
create policy account_email_messages_admin_read on public.account_email_messages
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- no insert / update / delete policy on messages on purpose. the webhook holds
-- the secret key and bypasses rls; anything that could write this table from a
-- session could post itself a code and claim it came from tiktok.

-- ---------------------------------------------------------------------- grants
--
-- rls decides which rows. these decide which columns, which is the half rls
-- cannot do: password_secret is writable from a session and never readable.

revoke all on public.account_emails from anon, authenticated;
revoke all on public.account_email_messages from anon, authenticated;

grant select (
  id, user_id, address, local_part, platform, username, password_set, note,
  status, created_at, updated_at, last_code_at
) on public.account_emails to authenticated;

grant insert (user_id, address, local_part, platform, note) on public.account_emails to authenticated;
grant update (platform, username, password_secret, note, status) on public.account_emails to authenticated;
grant delete on public.account_emails to authenticated;

grant select on public.account_email_messages to authenticated;

-- The one way a password comes back out, one row at a time, on a button press.
-- security definer so it can read a column the caller cannot select, and it
-- re-checks ownership itself rather than trusting rls to have done it.
create or replace function public.account_email_password(p_id uuid)
returns text
language sql
security definer
stable
set search_path to ''
as $$
  select e.password_secret
  from public.account_emails e
  where e.id = p_id
    and e.user_id = auth.uid();
$$;

comment on function public.account_email_password(uuid) is
  'Reads back one account password. Owner only, and the only path to a column authenticated cannot select.';

revoke all on function public.account_email_password(uuid) from public, anon;
grant execute on function public.account_email_password(uuid) to authenticated;

-- ------------------------------------------------------------------- realtime
--
-- what makes a code appear without a refresh. the dashboard also polls as a
-- fallback, so a project with realtime switched off degrades to a few seconds
-- of delay rather than to a broken tool.

do $$
begin
  alter publication supabase_realtime add table public.account_email_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ==== 20260811110000_orgs_owner_read.sql
-- An owner can read their own org without going through org_members.
--
-- `createOrg` does `insert(...).select("id").single()`, which postgres runs as
-- `insert ... returning id`, and a RETURNING row is checked against the table's
-- SELECT policies. `orgs_read_member` routes that check through
-- `private.my_org_ids()`, which reads `org_members` — and the membership row is
-- written by the `seat_org_owner` AFTER INSERT trigger, which does not fire until
-- the end of the statement, after RETURNING has already been projected.
--
-- So the owner could not see the org they had just created, for the one instant
-- it was handed back to them, and every "Create agency" failed with:
--
--   new row violates row-level security policy for table "orgs"
--
-- which is the same wording postgres uses for a WITH CHECK failure. The insert
-- itself was always allowed; only the read back was not.
--
-- The fix is a second, cheaper arm on the read: your own org is yours whether or
-- not the seat exists yet. That is also the correct rule on its own terms — an
-- owner whose member row was deleted would otherwise lose all read on an org
-- they still own, with no way back in.
--
-- Deliberately not solved by making the trigger BEFORE INSERT: `org_members`
-- has a foreign key onto `orgs (id)`, so the parent row has to be committed to
-- the statement before the seat can reference it.

drop policy if exists orgs_read_member on public.orgs;
create policy orgs_read_member on public.orgs
  for select to authenticated
  using (
    owner_id = auth.uid()
    or id in (select private.my_org_ids())
  );

-- ==== 20260811150000_editor_applications.sql
-- The hiring funnel that sits in front of the market.
--
-- Separate table rather than columns on `editors` on purpose: `editors` carries
-- `editors_public_read` (published OR own), so anything stored there is public
-- the moment somebody publishes their portfolio. A phone number is not. This
-- row is own-read plus admin-read and never leaves those two paths.

create table if not exists public.editor_applications (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  discord         text,
  location        text,
  -- the "i already have a portfolio" path. the built one lives on `editors`.
  portfolio_url   text,
  software        jsonb not null default '[]'::jsonb,
  videos_per_day  integer,
  hours_per_week  integer,
  weekends        boolean not null default false,
  experience      text,
  note            text,
  status          text not null default 'new',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint editor_applications_status_check
    check (status in ('new', 'reviewing', 'test_sent', 'hired', 'declined')),
  constraint editor_applications_videos_per_day_check
    check (videos_per_day is null or videos_per_day between 0 and 100),
  constraint editor_applications_hours_per_week_check
    check (hours_per_week is null or hours_per_week between 0 and 168)
);

create index if not exists editor_applications_status_idx
  on public.editor_applications (status, created_at desc);

drop trigger if exists editor_applications_touch on public.editor_applications;
create trigger editor_applications_touch
  before update on public.editor_applications
  for each row execute function public.touch_updated_at();

alter table public.editor_applications enable row level security;

-- default privileges off, then column-scoped back on: an applicant may write
-- their own answers and nothing else. `status` is deliberately absent from both
-- grants, so a tampered form cannot mark itself hired.
revoke all on public.editor_applications from anon, authenticated;
grant select on public.editor_applications to authenticated;
grant insert (
  user_id, name, email, phone, discord, location, portfolio_url,
  software, videos_per_day, hours_per_week, weekends, experience, note
) on public.editor_applications to authenticated;
grant update (
  name, email, phone, discord, location, portfolio_url,
  software, videos_per_day, hours_per_week, weekends, experience, note
) on public.editor_applications to authenticated;

create policy editor_applications_own_read on public.editor_applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- staff, and only behind the x-admin-view opt in, same as every other admin read
create policy editor_applications_admin_read on public.editor_applications
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

create policy editor_applications_own_insert on public.editor_applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy editor_applications_own_update on public.editor_applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

/**
 * Moving an application along. `status` is not granted to anyone, so this is
 * the only way it changes, and the admin check lives inside the function rather
 * than in a policy the column grant would block anyway.
 */
create or replace function public.set_editor_application_status(
  p_user uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_status not in ('new', 'reviewing', 'test_sent', 'hired', 'declined') then
    raise exception 'unknown status %', p_status;
  end if;

  update public.editor_applications
     set status = p_status
   where user_id = p_user;
end;
$$;

revoke all on function public.set_editor_application_status(uuid, text) from public, anon;
grant execute on function public.set_editor_application_status(uuid, text) to authenticated;

-- ==== 20260811170000_campaigns.sql
-- The campaign board: who runs which brand campaign, and how to reach them.
--
-- This is staff reference data, not a creator's own rows, and that is the one
-- thing worth stating up front because every other table in this product is the
-- opposite. There is no `user_id` here and there is deliberately no `own_rows`
-- policy: a campaign manager belongs to the business, not to whoever typed them
-- in, and two coaches looking at the board have to be looking at the same board.
-- So the whole feature is admin-only at the policy level, both halves.
--
-- That also means these reads do NOT need the `x-admin-view` opt in. That header
-- exists to widen a table that is normally scoped to `auth.uid()`, and there is
-- nothing here to widen. `requireAdmin()` is the gate; `requireAdminView()`
-- would work too and buys nothing.
--
-- `campaign_deals` is a separate table from `deals` on purpose. `deals` is one
-- creator's contract with one brand and carries their money. This is the
-- pipeline board: the campaigns that exist, what they pay, and how hard they are
-- to get into. A creator eventually signing one is a `deals` row that this table
-- knows nothing about.

-- ---------------------------------------------------------------- managers

create table if not exists public.campaign_managers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) > 0),

  -- [{platform, value}]. jsonb rather than a contacts table because nothing ever
  -- queries across them: they are read as a whole row and rendered as chips, and
  -- a second table would buy a join for that.
  contacts       jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(contacts) = 'array'),

  -- referrals we have actually closed with them, bumped one at a time from the
  -- row. an integer with a floor rather than a ledger: nobody has ever wanted to
  -- know when the fourth one happened.
  referrals      integer not null default 0 check (referrals >= 0),
  last_contacted date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- the name is the identity. both the seed and every future import match on it,
-- and case is not a difference anybody means: "Kai" and "kai" are one person.
create unique index if not exists campaign_managers_name_key
  on public.campaign_managers (lower(name));

-- ------------------------------------------------------------------- deals

create table if not exists public.campaign_deals (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) > 0),

  -- how hard it is to get placed, which is the only ordering the board has ever
  -- been sorted by. `need_info` is the honest default for a campaign somebody
  -- has named but nobody has priced yet.
  status            text not null default 'need_info'
                      check (status in ('instant', 'comp', 'v_comp', 'need_info', 'paused')),

  -- pay and posting are stored twice, and that is not an accident. the free text
  -- is what the board actually says ("$20-$60 PV", "$3-$5 cpm only") and is what
  -- renders; the structured pair is what sorts. a range, a qualifier or a
  -- footnote survives in the text and is simply unsortable, which beats losing it.
  base_pay          text not null default '',
  posting_freq      text not null default '',
  pay_model         text not null default 'per_video'
                      check (pay_model in ('per_video', 'retainer', 'cpm')),
  pay_amount        numeric(10, 2) check (pay_amount is null or pay_amount >= 0),
  posting_per_day   integer check (posting_per_day is null or posting_per_day between 1 and 100),
  posting_unlimited boolean not null default false,

  -- how the campaign's videos tend to do. null is "not rated yet", which is a
  -- different thing from `bad` and has to stay tellable apart from it.
  virality          text check (virality is null or virality in ('great', 'okay', 'bad')),

  formats           text not null default '',
  notes             text not null default '',
  how_to_connect    text not null default '',

  -- the pre-link free text ("Talha (CC)", "add runner"). the join table below is
  -- the real answer; this stays as the fallback for a row nobody has linked yet,
  -- and as the record of what the board said before it was linked.
  who_runs_it       text not null default '',

  -- hand rank inside a status section. null = never ranked, and those sort to
  -- the top newest-first, which is the order the board had before ranking existed.
  sort_order        integer,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists campaign_deals_name_key
  on public.campaign_deals (lower(name));

create index if not exists campaign_deals_board_idx
  on public.campaign_deals (status, sort_order nulls first, created_at desc);

-- --------------------------------------------------------------- who runs it

-- many-to-many both ways: Cantina (agency) is run by two people, and Kai 2 (CC)
-- runs three campaigns. a `manager_id` column on the deal could hold neither.
create table if not exists public.campaign_deal_managers (
  deal_id    uuid not null references public.campaign_deals(id) on delete cascade,
  manager_id uuid not null references public.campaign_managers(id) on delete cascade,
  primary key (deal_id, manager_id)
);

-- the pk covers deal → managers; this covers manager → deals, which is the whole
-- campaigns column on the managers view.
create index if not exists campaign_deal_managers_manager_idx
  on public.campaign_deal_managers (manager_id);

-- ------------------------------------------------------------------ touching

drop trigger if exists campaign_managers_touch on public.campaign_managers;
create trigger campaign_managers_touch
  before update on public.campaign_managers
  for each row execute function public.touch_updated_at();

drop trigger if exists campaign_deals_touch on public.campaign_deals;
create trigger campaign_deals_touch
  before update on public.campaign_deals
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------- rls

alter table public.campaign_managers      enable row level security;
alter table public.campaign_deals         enable row level security;
alter table public.campaign_deal_managers enable row level security;

revoke all on public.campaign_managers      from anon, authenticated;
revoke all on public.campaign_deals         from anon, authenticated;
revoke all on public.campaign_deal_managers from anon, authenticated;

grant select, insert, update, delete on public.campaign_managers      to authenticated;
grant select, insert, update, delete on public.campaign_deals         to authenticated;
grant select, insert, update, delete on public.campaign_deal_managers to authenticated;

-- one policy per table rather than four, because the answer is the same for
-- every command: staff, or nobody. `for all` covers select/insert/update/delete
-- and both halves of the check.
create policy campaign_managers_admin on public.campaign_managers
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy campaign_deals_admin on public.campaign_deals
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy campaign_deal_managers_admin on public.campaign_deal_managers
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ==== 20260811170000_org_rail_features_modules.sql
-- three things the agency section was missing: a second colour, a way to turn
-- sections off, and somewhere to put their own training.

-- ---------------------------------------------------------------- the paint
-- the rail was always derived from the accent (lighten 0.78), which is right
-- until an agency picks black and gets a grey slab down the left of the app.
-- null keeps the derivation, so nothing changes for anyone who never sets it.
alter table public.orgs
  add column if not exists rail_hex text;

-- ------------------------------------------------------------- the switches
-- one jsonb of `{ "<feature key>": false }`. absent means on, so a new feature
-- ships enabled and an org that never opened the branding page is unaffected.
-- keys live in ORG_FEATURES in lib/org.ts; deliberately not a check constraint,
-- because adding a feature would then be a migration rather than a const.
alter table public.orgs
  add column if not exists features jsonb not null default '{}'::jsonb;

-- column privileges on orgs are explicit (anon reads 10 of 14), so new columns
-- have to be named or the branding read comes back short on a tenant host.
grant select (rail_hex, features) on public.orgs to anon;
grant select (rail_hex, features) on public.orgs to authenticated;
grant insert (rail_hex, features) on public.orgs to authenticated;
grant update (rail_hex, features) on public.orgs to authenticated;
grant select (rail_hex, features) on public.orgs to service_role;
grant insert (rail_hex, features) on public.orgs to service_role;
grant update (rail_hex, features) on public.orgs to service_role;

-- ------------------------------------------------------------- the modules
-- an agency's own training, shown to their roster at /modules. Deliberately not
-- tied to a deal or a creator: it is one shelf per org and everybody on the
-- roster sees the same shelf, which is what makes it cheap enough to keep up.
create table if not exists public.org_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  blurb text,
  -- a link to the video wherever it already lives (loom, youtube, drive). we
  -- are not hosting an agency's video library, and every one of them already
  -- has one.
  video_url text,
  -- a doc, a template, a form. the second thing a module is ever made of.
  link_url text,
  body text,
  position integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_modules_org_position_idx
  on public.org_modules (org_id, position, created_at);

alter table public.org_modules enable row level security;

revoke all on public.org_modules from anon;
grant select, insert, update, delete on public.org_modules to authenticated;

-- the roster reads published ones; owners and managers read their drafts too.
drop policy if exists org_modules_read on public.org_modules;
create policy org_modules_read on public.org_modules
  for select to authenticated
  using (
    org_id in (select private.my_org_ids())
    and (published or org_id in (select private.managed_org_ids()))
  );

-- writing is owner/manager, same bar as the roster itself. app code checks
-- nothing: this is the check, so a forged post gets the same answer.
drop policy if exists org_modules_write on public.org_modules;
create policy org_modules_write on public.org_modules
  for all to authenticated
  using (org_id in (select private.managed_org_ids()))
  with check (org_id in (select private.managed_org_ids()));

-- ==== 20260811170100_campaigns_seed.sql
-- The campaign board as it stood on 2026-08-11, transcribed from the two
-- exports off the tracker (campaign_managers.csv, deals.csv).
--
-- Keyed on the NAME rather than a generated id, because the name is the only
-- thing the two exports have in common and re-running this must not produce a
-- second copy of anybody. `on conflict do nothing` throughout, so a row that
-- has since been edited by hand keeps the edit instead of being reset.
--
-- The deals export is a slice of the board (26 rows) while the managers
-- export names 9 campaigns that are not in it. Those come in as `need_info`
-- stubs so the campaigns column reads the same here as it does on the tracker.

insert into public.campaign_managers (name, contacts, referrals, last_contacted) values
  ('aaron tran', '[{"platform":"discord","value":"aarontrann"}]'::jsonb, 0, null),
  ('Ally', '[{"platform":"discord","value":"ally6806"}]'::jsonb, 0, null),
  ('Amir', '[{"platform":"discord","value":"gbpjpy"}]'::jsonb, 0, null),
  ('Ashlynn Wong', '[{"platform":"discord","value":"ashlynnwong"}]'::jsonb, 0, null),
  ('Chris (UK)', '[{"platform":"discord","value":"chris.7460"}]'::jsonb, 0, null),
  ('cj', '[]'::jsonb, 0, null),
  ('Claudia (CC)', '[{"platform":"discord","value":".quck."}]'::jsonb, 0, null),
  ('Cole', '[{"platform":"discord","value":"cole0.0"}]'::jsonb, 0, null),
  ('Dylan (CC)', '[{"platform":"discord","value":"dylan.tigereye"}]'::jsonb, 0, null),
  ('Dylan Khang', '[{"platform":"discord","value":"dylan_khang07"}]'::jsonb, 0, null),
  ('ethan', '[]'::jsonb, 0, null),
  ('hendrix', '[]'::jsonb, 0, null),
  ('Immanuel', '[{"platform":"discord","value":"immanwg"},{"platform":"phone #","value":"+1 438 823 9778"}]'::jsonb, 0, null),
  ('ivan', '[]'::jsonb, 0, null),
  ('Jialin', '[{"platform":"discord","value":"jialin_59273"}]'::jsonb, 0, null),
  ('John', '[{"platform":"discord","value":"fispiy"}]'::jsonb, 0, '2026-07-21'::date),
  ('Kai', '[{"platform":"discord","value":"kaimisc"}]'::jsonb, 0, null),
  ('Kai 2 (CC)', '[{"platform":"discord","value":"likai2466"}]'::jsonb, 0, null),
  ('Kimchi', '[{"platform":"discord","value":".danielyun"}]'::jsonb, 0, null),
  ('Liam', '[{"platform":"discord","value":"liamez"}]'::jsonb, 0, null),
  ('Luksai', '[{"platform":"discord","value":"luksai205"}]'::jsonb, 0, null),
  ('Marko', '[{"platform":"discord","value":"kindmarko"}]'::jsonb, 0, null),
  ('Mick', '[{"platform":"discord","value":"mick1xx"}]'::jsonb, 0, null),
  ('Morgan', '[{"platform":"discord","value":"morgan7005"}]'::jsonb, 0, null),
  ('Nathan', '[{"platform":"discord","value":"ngx1k"}]'::jsonb, 0, null),
  ('Parth', '[{"platform":"discord","value":"parthematics"}]'::jsonb, 0, null),
  ('Renee', '[{"platform":"discord","value":"madness.renee"}]'::jsonb, 0, null),
  ('richard', '[]'::jsonb, 0, null),
  ('Skyler', '[{"platform":"discord","value":"skylerbaoh"}]'::jsonb, 0, null),
  ('Talha (CC)', '[{"platform":"discord","value":"talha.malikk"}]'::jsonb, 0, null),
  ('Victor', '[{"platform":"discord","value":"alertly"}]'::jsonb, 0, null),
  ('Vincent', '[{"platform":"discord","value":"vincentbridgett"}]'::jsonb, 0, null),
  ('Walid (CC)', '[{"platform":"discord","value":"_waliddd"}]'::jsonb, 0, null),
  ('Yoyo Wang', '[{"platform":"discord","value":"yanai.wang"}]'::jsonb, 0, null),
  ('YunLong', '[{"platform":"discord","value":"yunlongxu21"}]'::jsonb, 0, null)
on conflict (lower(name)) do nothing;

insert into public.campaign_deals
  (name, status, base_pay, posting_freq, pay_model, pay_amount, posting_per_day,
   posting_unlimited, virality, formats, notes, who_runs_it, sort_order) values
  ('Invo', 'instant', '$20-$60 PV', '4/day', 'per_video', 20, 4, false, 'great', 'lowkey anything', '- up to $60 base', 'Talha (CC)', 0),
  ('Motion/Mosaic', 'instant', '$30 PV', '5/day', 'per_video', 30, 5, false, 'great', 'reaction skits', 'scaling program, taking creators 3k min; unlocks at 3k views', 'John', 1),
  ('Higgsfield', 'instant', '$50 PV', '3/day', 'per_video', 50, 3, false, 'great', '', 'need to find new CM, nathan just left. claudia?', '', 2),
  ('Krea AI', 'instant', '$50 PV', '3/day', 'per_video', 50, 3, false, 'okay', '', 'trial $15 skits $25 TH 2 week - 100k vid', 'Kimchi', 3),
  ('Meshy AI', 'instant', '$40 PV', '2/day', 'per_video', 40, 2, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 4),
  ('Atom', 'instant', '$30-$35 PV', '1/day', 'per_video', 30, 1, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 5),
  ('Zo', 'instant', '$40 PV', '1/day', 'per_video', 40, 1, false, null, '', 'unlocks at 1k views', 'Kai 2 (CC)', 6),
  ('Jobright', 'instant', '$30 PV', '1/day', 'per_video', 30, 1, false, 'okay', 'TH', '', 'Jialin, Ally', 7),
  ('Blueprint', 'instant', '$25-$35 PV', '1/day', 'per_video', 25, 1, false, 'okay', 'green screen/traditional talking head', '', 'Walid (CC)', 8),
  ('Cantina (agency)', 'instant', '$22 PV', '2/day', 'per_video', 22, 2, false, 'great', 'snapchat format', '10 day trial (need one 10k vid) goes into unlimited when u do good', 'Kai, Amir', 9),
  ('Mathgpt', 'instant', '$750 MR', '2/day', 'retainer', 750, 2, false, 'okay', 'TH', 'okay', 'Morgan', 10),
  ('Lovable (LINK)', 'comp', '$30 PV', 'unlimited', 'per_video', 30, null, true, 'great', 'reaction skits, tape + type, ...', 'link: lovable-ugc.lovable.app/# ; need 100k vid prev', 'hendrix', 11),
  ('Composio', 'comp', '$30 PV', '2/day', 'per_video', 30, 2, false, 'great', 'green screen', '2 week (20k trial); needs to be good TH', 'Victor', 12),
  ('Candle', 'comp', '$35 PV', '2/day', 'per_video', 35, 2, false, 'okay', 'skits/reactions', 'ONLY TAKING GIRLS/good looking guy', 'Parth', 13),
  ('Medeo', 'comp', '$30 PV', '2/day', 'per_video', 30, 2, false, 'okay', '', 'getting brief; getting more info. contact skylar', 'Skyler, YunLong', 14),
  ('Wellspoken', 'comp', '$35 PV', '1/day', 'per_video', 35, 1, false, 'bad', 'TH', 'wants people who can yap pretty good ngl. not good deal.', 'Liam', 15),
  ('Phrasly', 'v_comp', '$35 PV', '4/day', 'per_video', 35, 4, false, 'great', 'TH', 'good at TH, preferably girl', 'Yoyo Wang', 16),
  ('Manus', 'v_comp', '$35 PV', '3/day', 'per_video', 35, 3, false, 'great', 'TH', 'link: creatorprogram.manus.space/apply?ref=cre... ; special $55 base pay deal for TOP creators only (otherwise $35)', 'Renee, Dylan (CC)', 17),
  ('Asmi', 'v_comp', '$35-$45 PV', '3/day', 'per_video', 35, 3, false, 'okay', '', 'Need creators who are good with talking head, preferably done lots of views before', 'Marko', 18),
  ('Replit', 'v_comp', '$1200 PV', 'unlimited', 'per_video', 1200, null, true, 'okay', 'anything', 'bonuses counted seperate $$ - insane bonus. min 60 videos', 'Chris (UK)', 19),
  ('Modo', 'instant', '$5 CPM', 'unlimited', 'cpm', 5, null, true, 'great', '', '', 'Mick', 20),
  ('Bigger Z', 'instant', '$5 CPM', '4/day', 'cpm', 5, 4, false, 'great', '', '$5 base along side $5CPM', 'Mick', 21),
  ('Lovable (MM)', 'instant', '$3-$5 cpm only', 'unlimited', 'cpm', 3, null, true, 'great', 'reaction skits, tape + type, ...', 'Campaign: mediamaxxing.com/ ; $1000 pay cap - better loveable link for creators (in comp)', '', 22),
  ('Open Art (MM)', 'instant', '$3 CPM', 'unlimited', 'cpm', 3, null, true, 'okay', '', 'mediamaxxing.com/creator/campaigns/31179...', '', 23),
  ('Polsia', 'comp', '$3 cpm only', 'unlimited', 'cpm', 3, null, true, 'great', '', 'creators.internetpeople.agency/c/qGHd4AB... ; NO EARNING CAP', 'Vincent', 24),
  ('Qotify', 'instant', '$3 cpm', 'unlimited', 'cpm', 3, null, true, 'okay', '', 'getting more info', 'Cole', 25),
  ('Cantina', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 26),
  ('Halo AI', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 27),
  ('Folk', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 28),
  ('VideoTutor', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 29),
  ('TapVid', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 30),
  ('Knownunity', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 31),
  ('cupie', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 32),
  ('medceptor', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 33),
  ('Launchpoint', 'need_info', '', '', 'per_video', null, null, false, null, '', '', '', 34)
on conflict (lower(name)) do nothing;

-- who runs what, resolved by name at apply time so neither side needs an id.
insert into public.campaign_deal_managers (deal_id, manager_id)
select d.id, m.id
  from (values
    ('Invo', 'Talha (CC)'),
    ('Motion/Mosaic', 'John'),
    ('Krea AI', 'Kimchi'),
    ('Meshy AI', 'Kai 2 (CC)'),
    ('Atom', 'Kai 2 (CC)'),
    ('Zo', 'Kai 2 (CC)'),
    ('Jobright', 'Jialin'),
    ('Jobright', 'Ally'),
    ('Blueprint', 'Walid (CC)'),
    ('Cantina (agency)', 'Kai'),
    ('Cantina (agency)', 'Amir'),
    ('Mathgpt', 'Morgan'),
    ('Lovable (LINK)', 'hendrix'),
    ('Composio', 'Victor'),
    ('Candle', 'Parth'),
    ('Medeo', 'Skyler'),
    ('Medeo', 'YunLong'),
    ('Wellspoken', 'Liam'),
    ('Phrasly', 'Yoyo Wang'),
    ('Manus', 'Renee'),
    ('Manus', 'Dylan (CC)'),
    ('Asmi', 'Marko'),
    ('Replit', 'Chris (UK)'),
    ('Modo', 'Mick'),
    ('Bigger Z', 'Mick'),
    ('Polsia', 'Vincent'),
    ('Qotify', 'Cole'),
    ('Cantina', 'aaron tran'),
    ('Halo AI', 'aaron tran'),
    ('Folk', 'cj'),
    ('VideoTutor', 'Dylan Khang'),
    ('TapVid', 'ethan'),
    ('Knownunity', 'Immanuel'),
    ('cupie', 'Immanuel'),
    ('medceptor', 'ivan'),
    ('Launchpoint', 'richard')
  ) as pair(deal_name, manager_name)
  join public.campaign_deals    d on lower(d.name) = lower(pair.deal_name)
  join public.campaign_managers m on lower(m.name) = lower(pair.manager_name)
on conflict do nothing;

-- ==== 20260811173000_flow_admin_read_requires_admin_view.sql
-- Flow's three tables were leaking every admin's chat to every other admin.
--
-- The schema's rule is that a staff-wide read only fires when the request opts
-- in with `x-admin-view: 1`, which `private.admin_view()` checks alongside
-- `private.is_admin()`. Twenty-four tables carry that pair. These three carried
-- only the `is_admin()` half, so an admin's OWN /flow — a plain `createClient()`
-- with no header on it — matched the admin policy as well as `own_rows` and
-- listed the threads, messages and proposals of every other admin account.
--
-- Nothing under /admin reads these tables, so nothing depended on the wide
-- read. This also closes the resume path in app/api/flow/turn/route.ts, which
-- looks a thread up by id with no user filter because it trusts rls to scope it.

drop policy if exists ai_threads_admin_read on public.ai_threads;
create policy ai_threads_admin_read on public.ai_threads
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists ai_messages_admin_read on public.ai_messages;
create policy ai_messages_admin_read on public.ai_messages
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists ai_proposals_admin_read on public.ai_proposals;
create policy ai_proposals_admin_read on public.ai_proposals
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

