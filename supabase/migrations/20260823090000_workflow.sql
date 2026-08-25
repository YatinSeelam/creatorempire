-- The workflow tool: a content calendar sitting on top of a script bank.
--
-- Three tables. `scripts` is the bank: an idea worth filming, written by hand
-- or saved off a competitor's clip in the scraper's tables. `script_slots` is
-- the calendar: one row per (script, day), because the same hook filmed for two
-- brands on two Tuesdays is two slots of one script, and unique (script_id,
-- day) is what lets the schedule-ahead picker grey out days already booked.
-- `watch_creators` is the watchlist: a pointer at a `scrape_targets` row the
-- profile scraper already owns, optionally pinned to a deal, so the clip grid
-- reads posts the credits already paid for instead of scraping twice.
--
-- Money is NOT stored here. "banked today" is done slots times the deal's own
-- per-video fee, computed at read time off `deals.flat_fee_cents`, the same way
-- the deal list computes base pay. A copy of the fee on the slot would be a
-- second answer to what a video pays.

-- ------------------------------------------------------------------- scripts

create table if not exists public.scripts (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- the brand it is for. set null on delete: a deal ending does not un-write
  -- the scripts it inspired.
  deal_id uuid references public.deals (id) on delete set null,

  -- the one-liner on every card and queue row. the body is the full script and
  -- empty is fine: a saved clip is a hook and a link until somebody writes it out.
  hook text not null check (hook <> ''),
  body text not null default '',

  -- where it was stolen from, when it was. all nullable, because a script
  -- written from scratch has no source and that is the other half of the bank.
  source_url     text,
  platform       text check (platform in ('tiktok', 'instagram', 'youtube', 'facebook')),
  creator_handle text,
  thumbnail_url  text,
  -- what the source clip had when it was saved. display only, never money.
  source_views   bigint,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scripts_user_idx
  on public.scripts (user_id, created_at desc);

-- ---------------------------------------------------------------- the slots

create table if not exists public.script_slots (
  id        uuid primary key default gen_random_uuid(),
  -- denormalized from the script so rls is one predicate and not a join.
  user_id   uuid not null references auth.users (id) on delete cascade,
  script_id uuid not null references public.scripts (id) on delete cascade,

  day    date not null,
  status text not null default 'queued' check (status in ('queued', 'filming', 'done')),
  -- stamped when status lands on done, cleared when it is reopened. "banked
  -- today" counts done slots by day, and the stamp is the receipt.
  done_at timestamptz,

  -- per-day notes: "film the b-roll first", not part of the script itself.
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one slot per script per day. this is what the schedule-ahead calendar
  -- leans on to grey out days already booked.
  constraint script_slots_one_per_day unique (script_id, day)
);

create index if not exists script_slots_user_day_idx
  on public.script_slots (user_id, day);

-- ------------------------------------------------------------- the watchlist

create table if not exists public.watch_creators (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- the scraper's row IS the creator: handle, avatar, follower count and every
  -- post live there, refreshed by the same pulls the scraper tool makes.
  -- cascade, because a deleted pull leaves nothing here to point at.
  target_id uuid not null references public.scrape_targets (id) on delete cascade,

  -- which brand this creator is studied for. set null: unpinning a deal
  -- should not empty the watchlist.
  deal_id uuid references public.deals (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint watch_creators_one_per_target unique (user_id, target_id)
);

create index if not exists watch_creators_user_idx
  on public.watch_creators (user_id, created_at);

-- ----------------------------------------------------------------- triggers

drop trigger if exists touch_scripts on public.scripts;
create trigger touch_scripts
  before update on public.scripts
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_script_slots on public.script_slots;
create trigger touch_script_slots
  before update on public.script_slots
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------- rls

alter table public.scripts        enable row level security;
alter table public.script_slots   enable row level security;
alter table public.watch_creators enable row level security;

-- own rows, full control, on all three. no admin read: nothing under /admin
-- reads a creator's filming plan, and a policy nothing uses is a door nobody
-- is watching.
drop policy if exists scripts_own on public.scripts;
create policy scripts_own on public.scripts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists script_slots_own on public.script_slots;
create policy script_slots_own on public.script_slots
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists watch_creators_own on public.watch_creators;
create policy watch_creators_own on public.watch_creators
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
