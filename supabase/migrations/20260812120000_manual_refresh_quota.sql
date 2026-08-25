-- Manual refresh quota.
--
-- The nightly pull becomes a three-day pull, because a daily full pass over
-- every creator's accounts is most of the scraper bill and almost none of it
-- changes a payout. What a creator loses is the ability to see today's number
-- today, so they get that back by hand: a fixed number of manual refreshes per
-- calendar month, each one a forced sweep of every account they own.
--
-- The count is a table rather than a column because the spend deserves a
-- receipt, and because the row is what makes the cap enforceable. Nothing but
-- the functions below may write it: `authenticated` gets select and nothing
-- else, so a session cannot delete its way to a seventh refresh.

create table if not exists public.manual_refreshes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- filled in when the sweep reports back. a row that never finishes still
  -- counts, because the api calls it made were already billed to somebody.
  finished_at timestamptz,
  accounts    integer not null default 0,
  videos_seen integer not null default 0,
  api_calls   integer not null default 0
);

create index if not exists manual_refreshes_user_idx
  on public.manual_refreshes (user_id, created_at desc);

alter table public.manual_refreshes enable row level security;

revoke all on public.manual_refreshes from anon, authenticated;
grant select on public.manual_refreshes to authenticated;

drop policy if exists manual_refreshes_own_read on public.manual_refreshes;
create policy manual_refreshes_own_read on public.manual_refreshes
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists manual_refreshes_admin_read on public.manual_refreshes;
create policy manual_refreshes_admin_read on public.manual_refreshes
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists manual_refreshes_org_read on public.manual_refreshes;
create policy manual_refreshes_org_read on public.manual_refreshes
  for select to authenticated
  using (
    (select private.org_view())
    and user_id in (select private.org_member_ids())
  );

-- ------------------------------------------------------------------ the limit
--
-- One number, one place. Raising everybody's allowance is an edit here rather
-- than a hunt through the four call sites that quote it.

create or replace function public.manual_refresh_limit()
returns integer
language sql
immutable
set search_path to ''
as $$ select 6 $$;

comment on function public.manual_refresh_limit() is
  'How many manual refreshes one person gets per calendar month.';

revoke all on function public.manual_refresh_limit() from public, anon;
grant execute on function public.manual_refresh_limit() to authenticated;

-- ------------------------------------------------------------------ the count
--
-- UTC, not local. A cap has to reset at the same instant for everyone, and a
-- timezone in the middle of a spending limit is a bug waiting for a customer in
-- a different one. The comparison is written `at time zone 'utc'` on both sides
-- because `date_trunc(... now() at time zone 'utc')` is a plain timestamp, and
-- comparing that against a timestamptz would silently re-read it in whatever
-- timezone the session happens to carry.

create or replace function public.manual_refresh_quota()
returns table (used integer, quota integer, remaining integer, resets_on date)
language sql
stable
security definer
set search_path to ''
as $$
  select
    c.n::integer,
    public.manual_refresh_limit(),
    greatest(public.manual_refresh_limit() - c.n, 0)::integer,
    (date_trunc('month', (now() at time zone 'utc')) + interval '1 month')::date
  from (
    select count(*) as n
    from public.manual_refreshes m
    where m.user_id = auth.uid()
      and m.created_at >= (date_trunc('month', (now() at time zone 'utc')) at time zone 'utc')
  ) c;
$$;

comment on function public.manual_refresh_quota() is
  'What the signed-in person has left this month. Read only, safe to call on every page load.';

revoke all on function public.manual_refresh_quota() from public, anon;
grant execute on function public.manual_refresh_quota() to authenticated;

-- ------------------------------------------------------------------ the claim
--
-- Called before the sweep runs, never after: a refresh that reads the quota
-- once the work is done has already spent it. Returns a null id when there is
-- nothing left, so refusing is an ordinary answer rather than an exception the
-- caller has to parse out of an error string.

create or replace function public.claim_manual_refresh()
returns table (id uuid, used integer, quota integer, remaining integer, resets_on date)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user   uuid := auth.uid();
  v_start  timestamptz := date_trunc('month', (now() at time zone 'utc')) at time zone 'utc';
  v_resets date := (date_trunc('month', (now() at time zone 'utc')) + interval '1 month')::date;
  v_limit  integer := public.manual_refresh_limit();
  v_used   integer;
  v_id     uuid;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  -- a double click is two requests, and count-then-insert lets both of them
  -- read five and both write a sixth. the lock is per person and lasts the
  -- transaction, so the second one waits and then sees the truth.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select count(*) into v_used
  from public.manual_refreshes m
  where m.user_id = v_user and m.created_at >= v_start;

  if v_used >= v_limit then
    return query select null::uuid, v_used, v_limit, 0, v_resets;
    return;
  end if;

  insert into public.manual_refreshes (user_id)
  values (v_user)
  returning manual_refreshes.id into v_id;

  return query
    select v_id, v_used + 1, v_limit, greatest(v_limit - v_used - 1, 0), v_resets;
end;
$$;

comment on function public.claim_manual_refresh() is
  'Takes one refresh off this month''s allowance and returns the row to report against. Null id means there was none left.';

revoke all on function public.claim_manual_refresh() from public, anon;
grant execute on function public.claim_manual_refresh() to authenticated;

-- ----------------------------------------------------------------- the report
--
-- What the sweep actually did, written back onto the claimed row. Owner scoped,
-- so a guessed id belonging to somebody else updates nothing.

create or replace function public.finish_manual_refresh(
  p_id          uuid,
  p_accounts    integer,
  p_videos_seen integer,
  p_api_calls   integer
)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.manual_refreshes
  set finished_at = now(),
      accounts    = greatest(coalesce(p_accounts, 0), 0),
      videos_seen = greatest(coalesce(p_videos_seen, 0), 0),
      api_calls   = greatest(coalesce(p_api_calls, 0), 0)
  where id = p_id
    and user_id = auth.uid();
$$;

comment on function public.finish_manual_refresh(uuid, integer, integer, integer) is
  'Records what one manual refresh read. Does not change whether it counted.';

revoke all on function public.finish_manual_refresh(uuid, integer, integer, integer) from public, anon;
grant execute on function public.finish_manual_refresh(uuid, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------- the give-back
--
-- A claim that turned out to have no work to do (no live deals, no accounts on
-- them) hands the refresh back rather than charging for a no-op. Only an
-- unfinished row of your own can go, so this cannot be used to erase a sweep
-- that already spent api calls.

create or replace function public.cancel_manual_refresh(p_id uuid)
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.manual_refreshes
  where id = p_id
    and user_id = auth.uid()
    and finished_at is null;
$$;

comment on function public.cancel_manual_refresh(uuid) is
  'Returns an unspent claim to the allowance. Unfinished rows only.';

revoke all on function public.cancel_manual_refresh(uuid) from public, anon;
grant execute on function public.cancel_manual_refresh(uuid) to authenticated;
