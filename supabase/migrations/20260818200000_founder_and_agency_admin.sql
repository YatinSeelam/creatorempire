-- founder + agency admin.
--
-- two role systems, and this migration names them the way the product does:
--
--   platform  founder   the people on admin_emails. they see every workspace,
--                       who owns it, who sits on it, and they are the only ones
--                       who can hand a workspace something the product does not
--                       give everybody (a custom tool, a portfolio tweak).
--   workspace owner     the agency's own founder. one per workspace, pinned by
--                       trigger. branding, the flow key, removals, delete.
--             admin     runs THAT workspace and nothing outside it: roster,
--                       invites, modules. this is what "manager" was.
--             creator   a seat. their own work under the agency's paint.
--
-- an agency admin is admin of exactly one workspace. a founder is above all of
-- them. nothing about `admin_emails`, `private.is_admin()` or `x-admin-view`
-- changes: those are the founder mechanism and the name in the schema stays,
-- because renaming a security-definer function and a header on a live product
-- buys nothing but risk. the app calls it founder everywhere a person reads it.

-- ------------------------------------------------------------- manager → admin

update public.org_members set role = 'admin' where role = 'manager';
update public.org_invites set role = 'admin' where role = 'manager';

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members
  add constraint org_members_role_check
  check (role in ('owner', 'admin', 'creator'));

-- an invite can hand out admin or creator. never owner: `orgs.owner_id` is the
-- owner permission and an invite has never moved it, so an "owner" invite was
-- a manager wearing the wrong label. the app refused it already; now the table does.
alter table public.org_invites drop constraint if exists org_invites_role_check;
alter table public.org_invites
  add constraint org_invites_role_check
  check (role in ('admin', 'creator'));

create or replace function private.managed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and role in ('owner', 'admin')
$$;

comment on table public.admin_emails is
  'the platform founders. on this list = founder role: /founder, every workspace, custom tools. not an agency role.';

-- ------------------------------------------------------------- org_overrides
--
-- what a founder configured for one workspace that the product does not give
-- everybody. a key/value shelf on purpose: the first two keys are custom tool
-- grants (`tool.<slug>` = true) and portfolio setup (`portfolio.footer`,
-- `portfolio.badge`), and the next one an agency asks for is a row, not a
-- migration. members read their own workspace's rows (the tools shelf, the
-- portfolio); only a founder writes.

create table if not exists public.org_overrides (
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  value jsonb not null default 'true'::jsonb,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (org_id, key)
);

comment on table public.org_overrides is
  'per-workspace config a founder set: tool.<slug> grants, portfolio.* setup, anything custom. members read, founders write.';

alter table public.org_overrides enable row level security;

revoke all on public.org_overrides from anon, authenticated;
grant select, insert, update, delete on public.org_overrides to authenticated;

drop policy if exists org_overrides_member_read on public.org_overrides;
create policy org_overrides_member_read on public.org_overrides
  for select to authenticated
  using (org_id in (select private.my_org_ids()));

-- the founder half only fires behind x-admin-view, like every other *_admin_read:
-- a founder's own tools shelf shows their own workspaces' grants, not everyone's.
drop policy if exists org_overrides_admin_read on public.org_overrides;
create policy org_overrides_admin_read on public.org_overrides
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists org_overrides_admin_insert on public.org_overrides;
create policy org_overrides_admin_insert on public.org_overrides
  for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists org_overrides_admin_update on public.org_overrides;
create policy org_overrides_admin_update on public.org_overrides
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists org_overrides_admin_delete on public.org_overrides;
create policy org_overrides_admin_delete on public.org_overrides
  for delete to authenticated
  using ((select private.is_admin()));

-- who set it, when. stamped by the table rather than trusted from the form.
create or replace function private.stamp_org_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.set_by := auth.uid();
  new.set_at := now();
  return new;
end;
$$;

drop trigger if exists org_overrides_stamp on public.org_overrides;
create trigger org_overrides_stamp
  before insert or update on public.org_overrides
  for each row execute function private.stamp_org_override();

-- ------------------------------------------------- the public portfolio's agency
--
-- a creator's public page at /<slug> is read with no session at all, and the
-- one thing it wants to know about orgs is: is this creator on a workspace a
-- founder gave portfolio setup to, and what is that setup. one definer call,
-- returning the org's already-public branding columns plus its portfolio.*
-- overrides. an org with no portfolio.* rows is not returned, so a creator on
-- a plain agency gets exactly the page they had.

create or replace function public.portfolio_agency_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'custom_domain', o.custom_domain,
    'overrides', (
      select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb)
      from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  )
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = p_user
    and exists (
      select 1 from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  order by m.joined_at asc
  limit 1;
$$;

revoke all on function public.portfolio_agency_for(uuid) from public;
grant execute on function public.portfolio_agency_for(uuid) to anon, authenticated;
