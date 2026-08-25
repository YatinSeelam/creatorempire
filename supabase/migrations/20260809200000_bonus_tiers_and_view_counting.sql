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
