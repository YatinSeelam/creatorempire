-- Members browse the campaign board and ask to be placed on a campaign.
--
-- The board itself (campaign_deals) stays founder-only at the policy level.
-- What a member sees goes through `campaign_catalog()`, a security definer
-- function that hands back only the browsable columns: no notes, no
-- how_to_connect, no who_runs_it, no virality, and nothing about managers.
-- Those are staff working notes, not a menu.
--
-- `campaign_requests` is the ask. A member can hold one PENDING request per
-- campaign (partial unique index); a declined one can be asked again, which is
-- why the index is partial rather than plain. Status is founder-written only:
-- the insert grant is column-scoped so a tampered form cannot approve itself.

-- --------------------------------------------------------------- the catalog

create or replace function public.campaign_catalog()
returns table (
  id                uuid,
  name              text,
  status            text,
  base_pay          text,
  posting_freq      text,
  pay_model         text,
  pay_amount        numeric,
  posting_per_day   integer,
  posting_unlimited boolean,
  formats           text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.name, d.status, d.base_pay, d.posting_freq, d.pay_model,
         d.pay_amount, d.posting_per_day, d.posting_unlimited, d.formats
    from public.campaign_deals d
   -- need_info has no terms to show and paused is not accepting anyone, so
   -- neither belongs on a menu a member can request from.
   where d.status not in ('need_info', 'paused')
   order by d.sort_order nulls first, d.created_at desc;
$$;

revoke all on function public.campaign_catalog() from public, anon;
grant execute on function public.campaign_catalog() to authenticated;

-- --------------------------------------------------------------- the requests

create table if not exists public.campaign_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  campaign_deal_id uuid not null references public.campaign_deals (id) on delete cascade,
  note             text not null default '',
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'declined')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- one live ask per person per campaign. partial, so a declined request does
-- not block asking again later.
create unique index if not exists campaign_requests_one_pending
  on public.campaign_requests (user_id, campaign_deal_id)
  where status = 'pending';

-- the founder view reads them per campaign
create index if not exists campaign_requests_deal_idx
  on public.campaign_requests (campaign_deal_id);

drop trigger if exists campaign_requests_touch on public.campaign_requests;
create trigger campaign_requests_touch
  before update on public.campaign_requests
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------- rls

alter table public.campaign_requests enable row level security;

revoke all on public.campaign_requests from anon, authenticated;

-- the insert grant is column-scoped: a form can say who and what and why, and
-- nothing else. status/timestamps come from defaults, and only the founder
-- update below can move status.
grant select on public.campaign_requests to authenticated;
grant insert (user_id, campaign_deal_id, note) on public.campaign_requests to authenticated;
grant update (status) on public.campaign_requests to authenticated;

drop policy if exists campaign_requests_own_select on public.campaign_requests;
create policy campaign_requests_own_select on public.campaign_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists campaign_requests_own_insert on public.campaign_requests;
create policy campaign_requests_own_insert on public.campaign_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- same pattern as the campaigns migration: staff, or nobody. select so the
-- founder list shows every ask, update so approve/decline can move status.
drop policy if exists campaign_requests_admin_read on public.campaign_requests;
create policy campaign_requests_admin_read on public.campaign_requests
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists campaign_requests_admin_update on public.campaign_requests;
create policy campaign_requests_admin_update on public.campaign_requests
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
