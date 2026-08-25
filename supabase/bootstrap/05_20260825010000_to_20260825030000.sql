-- ==== 20260825010000_org_templates.sql
-- Templates: a workspace can run its own ui tree instead of the product's.
--
-- `template` names the tree under app/t/<template>/ that the proxy rewrites a
-- tenant host into. 'default' is the product's own (dash) shell with the light
-- white-label on top: paint, features, overrides. Anything else is a heavy
-- white-label, a whole custom tree that reuses the reads and the server actions
-- and nothing of the chrome. lib/tenants/registry.ts is the list of names.
--
-- `settings` is the tenant's own bag of preferences, validated per template in
-- app code (lib/tenants/<template>/settings.ts), written by the org owner.
--
-- Only a founder may change `template`, and it is enforced by a trigger rather
-- than a column grant, because column-level UPDATE is already granted on the
-- table and the ordinary owner policy would otherwise let an agency put itself
-- on a tree that was built for somebody else.

alter table public.orgs
  add column if not exists template text not null default 'default'
    check (template ~ '^[a-z][a-z0-9-]{0,39}$'),
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- the proxy resolves a host to its template before anybody is signed in, so
-- anon reads the template (and nothing else new). settings stay members-only.
grant select (template) on public.orgs to anon;
grant select (template, settings) on public.orgs to authenticated;
grant insert (template, settings) on public.orgs to authenticated;
grant update (template, settings) on public.orgs to authenticated;

create or replace function private.orgs_guard_template()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.template <> 'default' and not private.is_admin() then
      raise exception 'only a founder can put a workspace on a template'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.template is distinct from old.template and not private.is_admin() then
    raise exception 'only a founder can change a workspace template'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists orgs_guard_template on public.orgs;
create trigger orgs_guard_template
  before insert or update on public.orgs
  for each row execute function private.orgs_guard_template();

-- the founder's write, through the founder view client (x-admin-view: 1),
-- the same shape as org_overrides_admin_*. an update has to pass a select
-- policy too, and orgs_admin_read already covers that side.
drop policy if exists orgs_admin_update on public.orgs;
create policy orgs_admin_update on public.orgs
  for update to authenticated
  using ((select private.is_admin()) and (select private.admin_view()))
  with check ((select private.is_admin()) and (select private.admin_view()));

create index if not exists orgs_template_idx on public.orgs (template)
  where template <> 'default';

-- ==== 20260825020000_orgs_insert_founder_only.sql
-- Workspaces are made by a founder, not by whoever signs up.
--
-- The self-serve door (/new, `orgs_insert_own`) let any signed-in creator mint
-- an agency with a subdomain and a roster. That is the product handing out
-- white labels for free. From here an org row is inserted by a founder on
-- `admin_emails` (createOrgFor uses the service client and never met this
-- policy; createOrg from /new now requires the same email). Everything
-- already inserted stays.

drop policy if exists orgs_insert_own on public.orgs;
create policy orgs_insert_own on public.orgs
  for insert to authenticated
  with check (owner_id = auth.uid() and (select private.is_admin()));

-- ==== 20260825030000_org_members_owner_sets_role.sql
-- an owner can change a seat between admin and creator. the owner row itself
-- is never touched here: `orgs.owner_id` is the permission, and the pin
-- trigger keeps that row as it is. update is column scoped to `role`, so a
-- tampered form cannot move a seat to another org or another person.
drop policy if exists org_members_owner_update on public.org_members;
create policy org_members_owner_update on public.org_members
  for update to authenticated
  using (
    role <> 'owner'
    and org_id in (select o.id from public.orgs o where o.owner_id = (select auth.uid()))
  )
  with check (
    role in ('admin', 'creator')
    and org_id in (select o.id from public.orgs o where o.owner_id = (select auth.uid()))
  );
grant update (role) on public.org_members to authenticated;

