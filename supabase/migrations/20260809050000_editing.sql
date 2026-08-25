-- The editing marketplace: editors sign up, publish a portfolio, and pick up
-- edit jobs that creators post. Five tables:
--
--   editors                one row per editor, portfolio as a jsonb document
--                          (same shape of reasoning as public.portfolios: the
--                          profile is edited and saved as one thing)
--   edit_jobs              the bounty. a creator posts footage + references +
--                          an offer; an open job is visible to every editor,
--                          the first claim wins
--   edit_job_deliverables  the cuts an editor sends back, versioned
--   edit_job_events        comments + status changes, one timeline per job
--   editor_payouts         what a finished job is worth, frozen at approval.
--                          never recomputed, same lesson as public.payouts
--
-- Access model in one line: creators own their jobs, editors see open jobs and
-- everything about jobs they claimed, the public sees published editor
-- profiles and nothing else.

-- -------------------------------------------------------------------- editors

create table if not exists public.editors (
  user_id    uuid primary key references auth.users (id) on delete cascade,

  -- the public address, ugcflows.com/e/<handle>. blank until picked.
  handle     text not null default '',
  published  boolean not null default false,

  name       text,
  headline   text,
  location   text,
  avatar_url text,
  bio        text,

  -- what they cut and what they cut it with. validated in lib, not here: a
  -- check constraint that rejects a save is worse than a clamped field.
  skills     jsonb not null default '[]'::jsonb,
  software   jsonb not null default '[]'::jsonb,
  links      jsonb not null default '[]'::jsonb,
  -- the portfolio reel: [{url, title, platform}]
  reel       jsonb not null default '[]'::jsonb,

  -- typical asking price per video, advisory only. the number that pays is
  -- the one on the job.
  rate_cents       integer,
  turnaround_hours integer,

  -- taking work right now or not. paused editors keep their portfolio.
  status   text not null default 'active' check (status in ('active', 'paused')),

  -- set by staff, guarded by a trigger below. self-serve verification is not
  -- verification.
  verified boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists editors_handle_key
  on public.editors (lower(handle))
  where handle <> '';

create index if not exists editors_published_idx
  on public.editors (lower(handle))
  where published;

drop trigger if exists touch_editors on public.editors;
create trigger touch_editors
  before update on public.editors
  for each row execute function public.touch_updated_at();

-- verified is staff-only. clamp rather than reject so a profile save from the
-- editor never fails because of a flag they cannot see.
create or replace function public.guard_editor_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- service role and sql console pass through
  end if;
  if tg_op = 'INSERT' then
    if new.verified and not public.am_i_admin() then
      new.verified := false;
    end if;
  elsif new.verified is distinct from old.verified and not public.am_i_admin() then
    new.verified := old.verified;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_editors on public.editors;
create trigger guard_editors
  before insert or update on public.editors
  for each row execute function public.guard_editor_flags();

-- ------------------------------------------------------------------ edit_jobs

create table if not exists public.edit_jobs (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- optionally pinned to the brand deal the footage belongs to
  deal_id uuid references public.deals (id) on delete set null,

  title  text not null,
  brief  text,
  -- the style asked for, free text: "fast cuts like the refs", "clean talking
  -- head with captions"
  style  text,
  -- target output, free text: "9:16, under 60s"
  format text,

  -- links out, both [{url, label}]. footage is drive/dropbox, references are
  -- videos that look like what the creator wants back.
  footage_links   jsonb not null default '[]'::jsonb,
  reference_links jsonb not null default '[]'::jsonb,

  -- the offer. flat for the whole job or per finished video.
  pay_kind    text not null default 'flat' check (pay_kind in ('flat', 'per_video')),
  pay_cents   integer not null default 0 check (pay_cents >= 0),
  video_count integer not null default 1 check (video_count >= 1),

  status text not null default 'open' check (
    status in ('open', 'claimed', 'delivered', 'revisions', 'approved', 'cancelled')
  ),

  -- who claimed it. null while open. the claim is an atomic
  -- "where status = 'open' and editor_id is null" update, first editor wins.
  editor_id    uuid references public.editors (user_id) on delete set null,
  claimed_at   timestamptz,
  due_at       timestamptz,
  delivered_at timestamptz,
  approved_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_jobs_user_idx   on public.edit_jobs (user_id, created_at desc);
create index if not exists edit_jobs_editor_idx on public.edit_jobs (editor_id, created_at desc);
create index if not exists edit_jobs_deal_idx   on public.edit_jobs (deal_id);
-- the market page's only lookup
create index if not exists edit_jobs_open_idx   on public.edit_jobs (created_at desc) where status = 'open';

drop trigger if exists touch_edit_jobs on public.edit_jobs;
create trigger touch_edit_jobs
  before update on public.edit_jobs
  for each row execute function public.touch_updated_at();

-- rls lets a claimed editor update the row (deliver, re-deliver), but the
-- offer and the brief belong to the creator, and approval is the creator's
-- word. enforced here because rls cannot see which columns changed.
create or replace function public.guard_edit_job_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or (select auth.uid()) = old.user_id then
    return new;
  end if;

  -- somebody other than the owner: an editor claiming or delivering
  if new.user_id <> old.user_id
    or new.deal_id is distinct from old.deal_id
    or new.title <> old.title
    or new.brief is distinct from old.brief
    or new.pay_kind <> old.pay_kind
    or new.pay_cents <> old.pay_cents
    or new.video_count <> old.video_count then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_edit_jobs on public.edit_jobs;
create trigger guard_edit_jobs
  before update on public.edit_jobs
  for each row execute function public.guard_edit_job_update();

-- -------------------------------------------------------- edit_job_deliverables

create table if not exists public.edit_job_deliverables (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.edit_jobs (id) on delete cascade,
  editor_id uuid not null references auth.users (id) on delete cascade,

  url     text not null,
  note    text,
  version integer not null default 1,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_deliverables_job_idx
  on public.edit_job_deliverables (job_id, created_at desc);
create index if not exists edit_job_deliverables_editor_idx
  on public.edit_job_deliverables (editor_id);

-- ------------------------------------------------------------- edit_job_events

create table if not exists public.edit_job_events (
  id        uuid primary key default gen_random_uuid(),
  job_id    uuid not null references public.edit_jobs (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,

  kind text not null default 'comment' check (kind in ('comment', 'status')),
  body text not null,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_events_job_idx
  on public.edit_job_events (job_id, created_at);
create index if not exists edit_job_events_author_idx
  on public.edit_job_events (author_id);

-- ------------------------------------------------------------- editor_payouts

create table if not exists public.editor_payouts (
  id        uuid primary key default gen_random_uuid(),
  -- the job can be deleted later; the money record survives
  job_id    uuid references public.edit_jobs (id) on delete set null,
  editor_id uuid not null references auth.users (id) on delete cascade,
  -- who owes it
  user_id   uuid not null references auth.users (id) on delete cascade,

  amount_cents integer not null check (amount_cents >= 0),
  -- frozen wording of what this paid for, so the row still reads after the
  -- job is gone
  memo         text,

  status  text not null default 'due' check (status in ('due', 'paid')),
  paid_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists editor_payouts_editor_idx on public.editor_payouts (editor_id, created_at desc);
create index if not exists editor_payouts_user_idx   on public.editor_payouts (user_id, created_at desc);
create index if not exists editor_payouts_job_idx    on public.editor_payouts (job_id);

-- ------------------------------------------------------------------------ rls

alter table public.editors               enable row level security;
alter table public.edit_jobs             enable row level security;
alter table public.edit_job_deliverables enable row level security;
alter table public.edit_job_events       enable row level security;
alter table public.editor_payouts        enable row level security;

-- editors: the public page and the marketplace read published rows with the
-- publishable key and no session. owners read themselves always.
drop policy if exists editors_public_read on public.editors;
create policy editors_public_read on public.editors
  for select to anon, authenticated
  using (published or (select auth.uid()) = user_id);

drop policy if exists editors_insert_own on public.editors;
create policy editors_insert_own on public.editors
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists editors_update_own on public.editors;
create policy editors_update_own on public.editors
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists editors_delete_own on public.editors;
create policy editors_delete_own on public.editors
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- is the caller an editor at all. used by the job policies so the open board
-- is editors-only rather than every signed-in customer.
create or replace function public.am_i_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.editors where user_id = (select auth.uid())
  );
$$;

-- edit_jobs: owner sees theirs, the claimed editor sees theirs, and any
-- editor sees the open board.
drop policy if exists edit_jobs_select on public.edit_jobs;
create policy edit_jobs_select on public.edit_jobs
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
    or (status = 'open' and public.am_i_editor())
  );

drop policy if exists edit_jobs_insert_own on public.edit_jobs;
create policy edit_jobs_insert_own on public.edit_jobs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- two update paths: the owner edits freely; an editor may claim an open job
-- (writing themselves in) or update a job already theirs. the trigger above
-- keeps the editor path away from the brief and the money.
drop policy if exists edit_jobs_update on public.edit_jobs;
create policy edit_jobs_update on public.edit_jobs
  for update to authenticated
  using (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
    or (status = 'open' and public.am_i_editor())
  )
  with check (
    (select auth.uid()) = user_id
    or (select auth.uid()) = editor_id
  );

drop policy if exists edit_jobs_delete_own on public.edit_jobs;
create policy edit_jobs_delete_own on public.edit_jobs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- deliverables: visible to the two people on the job, written by the editor.
drop policy if exists deliverables_select on public.edit_job_deliverables;
create policy deliverables_select on public.edit_job_deliverables
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists deliverables_insert on public.edit_job_deliverables;
create policy deliverables_insert on public.edit_job_deliverables
  for insert to authenticated
  with check (
    (select auth.uid()) = editor_id
    and exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and j.editor_id = (select auth.uid())
    )
  );

drop policy if exists deliverables_delete_own on public.edit_job_deliverables;
create policy deliverables_delete_own on public.edit_job_deliverables
  for delete to authenticated
  using ((select auth.uid()) = editor_id);

-- events: same audience, either side writes as themselves.
drop policy if exists events_select on public.edit_job_events;
create policy events_select on public.edit_job_events
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists events_insert on public.edit_job_events;
create policy events_insert on public.edit_job_events
  for insert to authenticated
  with check (
    (select auth.uid()) = author_id
    and exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- payouts: both parties read, the payer writes. no update policy for editors,
-- so "paid" is the payer's word alone.
drop policy if exists editor_payouts_select on public.editor_payouts;
create policy editor_payouts_select on public.editor_payouts
  for select to authenticated
  using ((select auth.uid()) = editor_id or (select auth.uid()) = user_id);

drop policy if exists editor_payouts_insert on public.editor_payouts;
create policy editor_payouts_insert on public.editor_payouts
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists editor_payouts_update on public.editor_payouts;
create policy editor_payouts_update on public.editor_payouts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
