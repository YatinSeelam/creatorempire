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
