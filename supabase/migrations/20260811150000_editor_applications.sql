-- The hiring funnel that sits in front of the market.
--
-- Separate table rather than columns on `editors` on purpose: `editors` carries
-- `editors_public_read` (published OR own), so anything stored there is public
-- the moment somebody publishes their portfolio. A phone number is not. This
-- row is own-read plus admin-read and never leaves those two paths.

create table if not exists public.editor_applications (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  email           text,
  phone           text,
  discord         text,
  location        text,
  -- the "i already have a portfolio" path. the built one lives on `editors`.
  portfolio_url   text,
  software        jsonb not null default '[]'::jsonb,
  videos_per_day  integer,
  hours_per_week  integer,
  weekends        boolean not null default false,
  experience      text,
  note            text,
  status          text not null default 'new',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint editor_applications_status_check
    check (status in ('new', 'reviewing', 'test_sent', 'hired', 'declined')),
  constraint editor_applications_videos_per_day_check
    check (videos_per_day is null or videos_per_day between 0 and 100),
  constraint editor_applications_hours_per_week_check
    check (hours_per_week is null or hours_per_week between 0 and 168)
);

create index if not exists editor_applications_status_idx
  on public.editor_applications (status, created_at desc);

drop trigger if exists editor_applications_touch on public.editor_applications;
create trigger editor_applications_touch
  before update on public.editor_applications
  for each row execute function public.touch_updated_at();

alter table public.editor_applications enable row level security;

-- default privileges off, then column-scoped back on: an applicant may write
-- their own answers and nothing else. `status` is deliberately absent from both
-- grants, so a tampered form cannot mark itself hired.
revoke all on public.editor_applications from anon, authenticated;
grant select on public.editor_applications to authenticated;
grant insert (
  user_id, name, email, phone, discord, location, portfolio_url,
  software, videos_per_day, hours_per_week, weekends, experience, note
) on public.editor_applications to authenticated;
grant update (
  name, email, phone, discord, location, portfolio_url,
  software, videos_per_day, hours_per_week, weekends, experience, note
) on public.editor_applications to authenticated;

create policy editor_applications_own_read on public.editor_applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- staff, and only behind the x-admin-view opt in, same as every other admin read
create policy editor_applications_admin_read on public.editor_applications
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

create policy editor_applications_own_insert on public.editor_applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy editor_applications_own_update on public.editor_applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

/**
 * Moving an application along. `status` is not granted to anyone, so this is
 * the only way it changes, and the admin check lives inside the function rather
 * than in a policy the column grant would block anyway.
 */
create or replace function public.set_editor_application_status(
  p_user uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'not allowed';
  end if;

  if p_status not in ('new', 'reviewing', 'test_sent', 'hired', 'declined') then
    raise exception 'unknown status %', p_status;
  end if;

  update public.editor_applications
     set status = p_status
   where user_id = p_user;
end;
$$;

revoke all on function public.set_editor_application_status(uuid, text) from public, anon;
grant execute on function public.set_editor_application_status(uuid, text) to authenticated;
