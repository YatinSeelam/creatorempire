-- The calendar's own memory.
--
-- Everything else on the calendar is derived: videos mark the days content
-- went up, deals mark the days campaigns start and end. A note is the one thing
-- with no other table to live in, "post the candle hook thursday", and it is
-- deliberately small: a day, a line of text, optionally a platform and a deal.
-- Not a scheduling engine. When real autoposting lands it gets its own table
-- with send state; a note is a plan, not a job.
create table if not exists public.calendar_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  day        date not null,
  title      text not null,
  platform   text check (platform in ('tiktok', 'instagram', 'youtube')),
  -- notes usually belong to a deal, and the calendar shows the brand when one
  -- is set. set null on delete: the plan outlives the deal row.
  deal_id    uuid references public.deals (id) on delete set null,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calendar_notes_user_day_idx
  on public.calendar_notes (user_id, day);

drop trigger if exists touch_calendar_notes on public.calendar_notes;
create trigger touch_calendar_notes before update on public.calendar_notes
  for each row execute function public.touch_updated_at();

alter table public.calendar_notes enable row level security;
drop policy if exists own_rows on public.calendar_notes;
create policy own_rows on public.calendar_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
