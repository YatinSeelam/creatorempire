-- a second granted role beside founder.
--
-- `admin_emails` was "people we let in", and letting somebody in made them a
-- founder, because those were the same thing while the only account was ours.
-- They are not the same thing now: a creator we hand the tracker to should see
-- the dashboard and the tools and nothing else. No /founder, no other
-- workspace's rows, no editing market.
--
-- One column rather than a second table, because the question the app asks is
-- "what were they granted", and two tables would mean two answers that can
-- disagree. Existing rows default to founder, so nobody's access changes on
-- the way through.

alter table public.admin_emails
  add column role text not null default 'founder'
    check (role in ('founder', 'creator'));

grant insert (role), update (role) on public.admin_emails to authenticated;

-- ------------------------------------------------------------- is_admin v2

-- THE load-bearing line of this migration. Every founder-only read in the
-- product goes through here: the /founder gate, every `*_admin_read` policy,
-- the editing bypasses. Narrowing it to role = 'founder' is what makes a
-- creator row stop being staff everywhere at once, with no page left to
-- remember.
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_emails a on a.email = lower(u.email)
    where u.id = (select auth.uid())
      and a.role = 'founder'
  );
$$;

-- ---------------------------------------------------------- the wider door

-- What was granted, or null for somebody who was never on the list. This is
-- what opens `(dash)` for a creator: they hold no subscription and no org
-- seat, so before this every gate said no.
create or replace function private.granted_role()
returns text
language sql stable security definer
set search_path to ''
as $$
  select a.role
  from auth.users u
  join public.admin_emails a on a.email = lower(u.email)
  where u.id = (select auth.uid())
  limit 1;
$$;

create or replace function public.my_granted_role()
returns text
language sql stable
set search_path to ''
as $$
  select private.granted_role();
$$;

revoke all on function public.my_granted_role() from public, anon;
grant execute on function public.my_granted_role() to authenticated;

-- --------------------------------------------------------- last founder

-- the guard counted every row, so with creators on the list it would have
-- happily let the last real founder go. it counts founders now.
create or replace function private.protect_last_admin()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  caller_email text;
begin
  select lower(u.email) into caller_email
  from auth.users u
  where u.id = (select auth.uid());

  if caller_email is not null and caller_email = old.email then
    raise exception 'you cannot remove your own access';
  end if;

  if old.role = 'founder'
    and (select count(*) from public.admin_emails where role = 'founder') <= 1 then
    raise exception 'there has to be at least one founder';
  end if;

  return old;
end;
$$;

-- ------------------------------------------------------- demotion is a write

-- the table had no update policy at all, because until now there was nothing
-- on a row worth changing. moving somebody between the two grants is an
-- update, so it needs one, founder-only like the other three.
create policy admin_emails_update on public.admin_emails
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- and the last-founder guard was BEFORE DELETE only, which with a role column
-- is a hole: demoting the last founder to creator locks the product's back
-- office with nobody able to reopen it. Same two rules, on the update path.
create or replace function private.protect_last_admin_update()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
declare
  caller_email text;
begin
  if new.role = old.role then
    return new;
  end if;

  select lower(u.email) into caller_email
  from auth.users u
  where u.id = (select auth.uid());

  if caller_email is not null and caller_email = old.email then
    raise exception 'you cannot change your own role';
  end if;

  if old.role = 'founder'
    and (select count(*) from public.admin_emails where role = 'founder') <= 1 then
    raise exception 'there has to be at least one founder';
  end if;

  return new;
end;
$$;

drop trigger if exists admin_emails_protect_last_update on public.admin_emails;
create trigger admin_emails_protect_last_update
  before update on public.admin_emails
  for each row execute function private.protect_last_admin_update();

-- ------------------------------------------------------------ the two rows

-- both signed up as creators using the tracker, not as people building the
-- product. named explicitly rather than matched by pattern.
update public.admin_emails
set role = 'creator'
where email in ('createwadrianugc@gmail.com', 'ugc.raf.ugc@gmail.com');
