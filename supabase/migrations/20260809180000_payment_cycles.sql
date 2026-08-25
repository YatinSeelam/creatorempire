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
