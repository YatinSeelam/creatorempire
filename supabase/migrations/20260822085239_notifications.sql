-- The bell.
--
-- Everything that happens to a creator on this product happens while they are
-- somewhere else: an editor claims a job at 2am, a cut lands, their client
-- signs off on a review link. Until now the only way to learn any of that was
-- an email that may be off and a discord channel most creators are not in.
--
-- So: one table, one row per thing that happened to one person, read from a
-- bell in the rail. Both sides get it — the creator's rail and the editor's —
-- because the events are symmetric and the table does not care which shell
-- renders them.
--
-- NO INSERT POLICY, on purpose. The writer is always the service client
-- (lib/notify-server.ts), the same shape as account_email_messages and
-- edit_job_review_notes. That is not incidental: almost every notification is
-- written by the OTHER party's session (the editor claims, the creator is
-- told), so a session-scoped insert would have to be "anyone may write to
-- anyone's bell", which is a spam endpoint with extra steps.

create table if not exists public.notifications (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- what happened, from the closed list in lib/notify.ts. text rather than an
  -- enum so a new kind is an app deploy, not a migration; an unknown kind
  -- renders with the neutral tone rather than crashing.
  kind text not null,

  title text not null,
  body  text,
  -- where it goes when tapped. in-app path, never an absolute url.
  href  text,

  -- what it is about, normally a job id. the seam for "opening the job clears
  -- its bell rows" and for collapsing a run of events on one thing. nothing
  -- reads it yet; it is written from the start so the history is there when
  -- something does.
  subject text,

  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- the count in the bell is the only query that runs on every page of the app,
-- so it gets its own partial index and touches nothing that is already read.
create index if not exists notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
-- marking one read is the only write a session gets, and it cannot rewrite the
-- words: a column-scoped update means a tampered request can flip a timestamp
-- and nothing else.
grant update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists notifications_mark on public.notifications;
create policy notifications_mark on public.notifications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists notifications_clear on public.notifications;
create policy notifications_clear on public.notifications
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------------ the phone

-- Texting is not wired yet and the toggle says so out loud. The columns land
-- now because the number is the slow part: people give it once, and having it
-- already collected is what makes turning sms on a deploy rather than a
-- campaign asking everybody to come back and type it.
--
-- `phone_verified_at` is deliberately NOT grantable from a session. A number
-- somebody typed is a claim; only a code we sent and they returned makes it a
-- fact, and nothing may set that flag from a form.
alter table public.profiles
  add column if not exists phone             text,
  add column if not exists notify_sms        boolean not null default false,
  add column if not exists phone_verified_at timestamptz;

grant update (phone, notify_sms) on public.profiles to authenticated;
