-- deals belong to a workspace.
--
-- before this a deal was only ever "yours". the moment a creator joined an
-- agency every deal they had ever run showed up on that agency's roster, and
-- a brand new agency was born with numbers on it that had nothing to do with
-- it. an agency and a creator account are separate entities: the creator's
-- own deals stay on their own books, and a deal done for an agency sits on
-- the agency's.
--
-- `deals.org_id` is that split. null = the creator's personal account, an org
-- id = a deal done inside that workspace. every read in the app scopes on it
-- (lib/workspace.ts `dealScope`) and the org read policies below stop reading
-- "every deal of every member" and read "the deals on this org's books".

alter table public.deals
  add column if not exists org_id uuid references public.orgs(id) on delete set null;

create index if not exists deals_user_org_idx on public.deals (user_id, org_id);
create index if not exists deals_org_idx on public.deals (org_id) where org_id is not null;

-- a deal can only be filed under an org its owner actually sits on. a form
-- can post any uuid it likes; this is what stops it landing on a stranger's
-- roster. definer, so the check reads org_members past its own rls.
create or replace function private.is_org_member(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = p_user
  )
$$;

create or replace function private.deals_check_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.org_id is not null and not private.is_org_member(new.org_id, new.user_id) then
    raise exception 'that workspace is not one you belong to' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deals_check_org on public.deals;
create trigger deals_check_org
  before insert or update of org_id, user_id on public.deals
  for each row execute function private.deals_check_org();

-- leaving an org hands the deals back. a seat that is gone cannot be switched
-- into, so a deal left filed under it would be invisible to the creator who
-- owns it and still visible to the agency that let them go. neither is right.
create or replace function private.org_members_release_deals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.deals
     set org_id = null
   where user_id = old.user_id
     and org_id = old.org_id;
  return old;
end;
$$;

drop trigger if exists org_members_release_deals on public.org_members;
create trigger org_members_release_deals
  after delete on public.org_members
  for each row execute function private.org_members_release_deals();

-- the deals on the books of an org i manage. what every org read below hangs
-- off, so "which rows may a manager see" is answered once.
create or replace function private.org_deal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.deals
  where org_id in (select private.managed_org_ids())
$$;

create or replace function private.org_video_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.videos
  where deal_id in (select private.org_deal_ids())
$$;

-- the org read policies. they used to say "any row belonging to a member of an
-- org i manage", which handed a manager the creator's whole personal history.
-- now: the deal is on my org's books, or it is not mine to read.
drop policy if exists deals_org_read on public.deals;
create policy deals_org_read on public.deals
  for select using (
    (select private.org_view())
    and org_id in (select private.managed_org_ids())
  );

drop policy if exists videos_org_read on public.videos;
create policy videos_org_read on public.videos
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists deal_accounts_org_read on public.deal_accounts;
create policy deal_accounts_org_read on public.deal_accounts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists payouts_org_read on public.payouts;
create policy payouts_org_read on public.payouts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists bonus_rules_org_read on public.bonus_rules;
create policy bonus_rules_org_read on public.bonus_rules
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists social_posts_org_read on public.social_posts;
create policy social_posts_org_read on public.social_posts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists video_stats_org_read on public.video_stats;
create policy video_stats_org_read on public.video_stats
  for select using (
    (select private.org_view())
    and video_id in (select private.org_video_ids())
  );

-- brands stay readable per member: a brand is a name and a logo shared by
-- every deal with them, personal or not, and the roster never reads it.
