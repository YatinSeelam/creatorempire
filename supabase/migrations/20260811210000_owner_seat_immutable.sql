-- The founder's seat is part of the org, not a row anybody can manage away.
--
-- The bug: an owner could remove themselves from their own roster (or re-join
-- through a test invite), and their seat came back as a plain creator. The
-- orgs row still named them owner, but every permission reads org_members, so
-- the person who made the workspace could no longer manage it. Two triggers
-- make that state unrepresentable:
--
--   1. deleting the owner's seat is refused while the org exists. deleting
--      the ORG still works: by the time the fk cascade removes the seats, the
--      org row is gone and the check passes.
--   2. any insert or update of the owner's seat is coerced to role 'owner',
--      so an invite accepted by the founder can never downgrade them.

create or replace function private.protect_owner_seat_del()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.orgs o
    where o.id = old.org_id and o.owner_id = old.user_id
  ) then
    raise exception 'The owner cannot leave their own workspace. Delete the workspace on the branding page instead.';
  end if;
  return old;
end
$$;

drop trigger if exists protect_owner_seat_del on public.org_members;
create trigger protect_owner_seat_del
  before delete on public.org_members
  for each row execute function private.protect_owner_seat_del();

create or replace function private.protect_owner_seat_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.orgs o
    where o.id = new.org_id and o.owner_id = new.user_id
  ) then
    new.role := 'owner';
  end if;
  return new;
end
$$;

drop trigger if exists protect_owner_seat_role on public.org_members;
create trigger protect_owner_seat_role
  before insert or update on public.org_members
  for each row execute function private.protect_owner_seat_role();

-- repair any org already in the broken state: the owner's seat exists with the
-- wrong role, or does not exist at all.
update public.org_members m
set role = 'owner'
from public.orgs o
where o.id = m.org_id and o.owner_id = m.user_id and m.role <> 'owner';

insert into public.org_members (org_id, user_id, role)
select o.id, o.owner_id, 'owner'
from public.orgs o
where not exists (
  select 1 from public.org_members m
  where m.org_id = o.id and m.user_id = o.owner_id
);
