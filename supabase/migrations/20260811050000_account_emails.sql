-- Account emails. A throwaway signup address per social account, plus the
-- verification codes that land on it.
--
-- The problem: a creator running six brand deals needs a fresh tiktok, an
-- instagram and a youtube per deal, and every one of those signups wants an
-- email address nobody has used before. Buying a mailbox each is absurd, and
-- gmail aliases get rejected by half the platforms.
--
-- The shape instead: one domain with a catch-all in front of it. Every address
-- we hand out is a row here, nothing is provisioned anywhere, and an inbound
-- worker posts every received message to /api/inbound-email. The route matches
-- the recipient back to a row, pulls the code out and stores it, so the code is
-- on screen a second or two after the platform sent it.
--
-- Two tables:
--   account_emails          the address, plus what account was made with it
--   account_email_messages  one row per inbound mail routed to an address
--
-- Only the webhook writes messages, and it holds the secret key, so that table
-- has read policies and nothing else. Anything that could write it from a
-- session could forge a code.

-- --------------------------------------------------------------- the addresses

create table if not exists public.account_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,

  -- the full address, always lowercase. unique because the webhook matches an
  -- inbound recipient back to exactly one owner, and because handing the same
  -- address to two people would put one person's codes on the other's screen.
  address     text not null unique check (address = lower(address)),
  local_part  text not null,

  -- what the address was used for, filled in AFTER the account exists. free
  -- text rather than an enum: a new platform to sign up to should not need a
  -- migration, and lib/account-emails.ts holds the list the picker offers.
  platform    text,
  username    text,
  -- the account's password. write only from a session: `authenticated` is
  -- granted update on this column and never select, so a compromised session
  -- token cannot read the vault back out. reads go through
  -- public.account_email_password(), one row at a time, on a button press.
  password_secret text,
  -- whether a password is stored, without being the password. the ui needs to
  -- say "saved" on a card, and that question should not cost a trip through
  -- the definer function or a grant on the column itself.
  password_set boolean generated always as
              (password_secret is not null and password_secret <> '') stored,
  note        text,

  -- archived keeps the row (and its codes) without listing it. deleting is
  -- still allowed, it just should not be the only way to tidy up.
  status      text not null default 'active'
              check (status in ('active', 'archived')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- bumped by the webhook so "recently used" is a sort and not a join.
  last_code_at timestamptz
);

create index if not exists account_emails_user_idx
  on public.account_emails (user_id, created_at desc);

-- touch_updated_at() comes from the deal tracker migration.
drop trigger if exists touch_account_emails on public.account_emails;
create trigger touch_account_emails
  before update on public.account_emails
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- the messages

create table if not exists public.account_email_messages (
  id       uuid primary key default gen_random_uuid(),
  email_id uuid not null references public.account_emails (id) on delete cascade,
  -- denormalised owner. rls and the realtime row filter both become a single
  -- column check, with no join on the path a code takes to the screen.
  user_id  uuid not null references auth.users (id) on delete cascade,

  recipient     text not null,
  sender        text,
  sender_domain text,
  subject       text,
  -- best guess from the sender domain first, the subject second.
  platform      text,

  -- the extracted code, and how sure the parser was. null is a real outcome:
  -- the row is still stored, because a code the parser missed is exactly when
  -- somebody needs to read the subject line themselves.
  code       text,
  confidence text not null default 'low'
             check (confidence in ('high', 'medium', 'low', 'none')),

  -- first slice of the plain text body, for context under the code. never the
  -- whole email: this is a code utility, not a mailbox.
  snippet text,

  -- who delivered it and their id for the message. the id is the entire
  -- idempotency story, because every provider retries.
  provider            text not null default 'unknown',
  provider_message_id text,

  received_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists account_email_messages_user_idx
  on public.account_email_messages (user_id, received_at desc);

create index if not exists account_email_messages_email_idx
  on public.account_email_messages (email_id, received_at desc);

-- a redelivery of the same message is a no-op rather than a second card on the
-- screen. partial, because a provider that sends us no id still gets through.
create unique index if not exists account_email_messages_provider_msg_key
  on public.account_email_messages (provider, provider_message_id)
  where provider_message_id is not null;

-- ------------------------------------------------------------------------- rls

alter table public.account_emails enable row level security;
alter table public.account_email_messages enable row level security;

drop policy if exists account_emails_owner_select on public.account_emails;
create policy account_emails_owner_select on public.account_emails
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_emails_owner_insert on public.account_emails;
create policy account_emails_owner_insert on public.account_emails
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists account_emails_owner_update on public.account_emails;
create policy account_emails_owner_update on public.account_emails
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists account_emails_owner_delete on public.account_emails;
create policy account_emails_owner_delete on public.account_emails
  for delete to authenticated
  using (auth.uid() = user_id);

-- read only, and only for a request that asked for the wide read. same shape as
-- every other *_admin_read in this schema: the header narrows, is_admin() is
-- the permission.
drop policy if exists account_emails_admin_read on public.account_emails;
create policy account_emails_admin_read on public.account_emails
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists account_email_messages_owner_select on public.account_email_messages;
create policy account_email_messages_owner_select on public.account_email_messages
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_email_messages_admin_read on public.account_email_messages;
create policy account_email_messages_admin_read on public.account_email_messages
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- no insert / update / delete policy on messages on purpose. the webhook holds
-- the secret key and bypasses rls; anything that could write this table from a
-- session could post itself a code and claim it came from tiktok.

-- ---------------------------------------------------------------------- grants
--
-- rls decides which rows. these decide which columns, which is the half rls
-- cannot do: password_secret is writable from a session and never readable.

revoke all on public.account_emails from anon, authenticated;
revoke all on public.account_email_messages from anon, authenticated;

grant select (
  id, user_id, address, local_part, platform, username, password_set, note,
  status, created_at, updated_at, last_code_at
) on public.account_emails to authenticated;

grant insert (user_id, address, local_part, platform, note) on public.account_emails to authenticated;
grant update (platform, username, password_secret, note, status) on public.account_emails to authenticated;
grant delete on public.account_emails to authenticated;

grant select on public.account_email_messages to authenticated;

-- The one way a password comes back out, one row at a time, on a button press.
-- security definer so it can read a column the caller cannot select, and it
-- re-checks ownership itself rather than trusting rls to have done it.
create or replace function public.account_email_password(p_id uuid)
returns text
language sql
security definer
stable
set search_path to ''
as $$
  select e.password_secret
  from public.account_emails e
  where e.id = p_id
    and e.user_id = auth.uid();
$$;

comment on function public.account_email_password(uuid) is
  'Reads back one account password. Owner only, and the only path to a column authenticated cannot select.';

revoke all on function public.account_email_password(uuid) from public, anon;
grant execute on function public.account_email_password(uuid) to authenticated;

-- ------------------------------------------------------------------- realtime
--
-- what makes a code appear without a refresh. the dashboard also polls as a
-- fallback, so a project with realtime switched off degrades to a few seconds
-- of delay rather than to a broken tool.

do $$
begin
  alter publication supabase_realtime add table public.account_email_messages;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
