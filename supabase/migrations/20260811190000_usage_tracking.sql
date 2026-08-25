-- Usage tracking, unified.
--
-- Three things the admin section could not answer cleanly:
--   1. what the AI flow chat costs per person (tokens were thrown away)
--   2. which platform accounts an account email actually made (one column held
--      one platform, but one address signs up tiktok + instagram + youtube)
--   3. what a roster member's usage looks like from the agency side
--
-- This migration adds the flow token ledger, splits account emails into
-- address + accounts, and opens org-scoped reads on the two usage ledgers.

-- ------------------------------------------------------- 1. flow token ledger
--
-- One row per flow turn, written by /api/flow/turn with the user's own session,
-- so the insert policy is the ordinary own-row shape. Reads follow the same
-- three doors as everything else: own rows, admin behind x-admin-view, org
-- behind x-org-view.

create table if not exists public.ai_usage_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  thread_id          uuid,
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  -- how many model calls the turn took and how many tools it ran. a turn that
  -- reads four tools is six calls, and the cost lives in the calls.
  steps              integer not null default 1,
  tool_calls         integer not null default 0,
  ok                 boolean not null default true,
  error              text,
  duration_ms        integer,
  created_at         timestamptz not null default now()
);

create index if not exists ai_usage_events_user_idx
  on public.ai_usage_events (user_id, created_at desc);

alter table public.ai_usage_events enable row level security;

revoke all on public.ai_usage_events from anon, authenticated;

grant select on public.ai_usage_events to authenticated;
grant insert (
  user_id, thread_id, model, input_tokens, output_tokens, cache_read_tokens,
  cache_write_tokens, steps, tool_calls, ok, error, duration_ms
) on public.ai_usage_events to authenticated;

drop policy if exists ai_usage_events_own_read on public.ai_usage_events;
create policy ai_usage_events_own_read on public.ai_usage_events
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_usage_events_own_insert on public.ai_usage_events;
create policy ai_usage_events_own_insert on public.ai_usage_events
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists ai_usage_events_admin_read on public.ai_usage_events;
create policy ai_usage_events_admin_read on public.ai_usage_events
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists ai_usage_events_org_read on public.ai_usage_events;
create policy ai_usage_events_org_read on public.ai_usage_events
  for select to authenticated
  using (
    (select private.org_view())
    and user_id in (select private.org_member_ids())
  );

-- --------------------------------------- 2. account emails: address ≠ account
--
-- The old shape put one platform, one username and one password on the address
-- row, and the whole point of a signup address is that the same one makes the
-- tiktok, the instagram and the youtube for a deal. So the account becomes its
-- own row, one per platform per address, and the address goes back to being
-- just the mailbox.

create table if not exists public.account_email_accounts (
  id         uuid primary key default gen_random_uuid(),
  email_id   uuid not null references public.account_emails (id) on delete cascade,
  -- denormalised owner, same reason as account_email_messages: rls stays a
  -- single column check on the hot path.
  user_id    uuid not null references auth.users (id) on delete cascade,

  -- free text, same reasoning as before: a new platform should not need a
  -- migration. lib/account-emails.ts holds the picker's list.
  platform   text not null,
  handle     text,
  -- write only from a session, same vault shape as before: update granted,
  -- select never. reads go through account_email_account_password().
  password_secret text,
  password_set boolean generated always as
              (password_secret is not null and password_secret <> '') stored,
  note       text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- one email signs a platform up once. a second tiktok needs a second address,
  -- which is exactly how the platforms themselves behave.
  unique (email_id, platform)
);

create index if not exists account_email_accounts_user_idx
  on public.account_email_accounts (user_id, created_at desc);

drop trigger if exists touch_account_email_accounts on public.account_email_accounts;
create trigger touch_account_email_accounts
  before update on public.account_email_accounts
  for each row execute function public.touch_updated_at();

alter table public.account_email_accounts enable row level security;

revoke all on public.account_email_accounts from anon, authenticated;

grant select (
  id, email_id, user_id, platform, handle, password_set, note, created_at, updated_at
) on public.account_email_accounts to authenticated;
grant insert (email_id, user_id, platform, handle, note)
  on public.account_email_accounts to authenticated;
grant update (platform, handle, password_secret, note)
  on public.account_email_accounts to authenticated;
grant delete on public.account_email_accounts to authenticated;

drop policy if exists account_email_accounts_owner_select on public.account_email_accounts;
create policy account_email_accounts_owner_select on public.account_email_accounts
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_email_accounts_owner_insert on public.account_email_accounts;
create policy account_email_accounts_owner_insert on public.account_email_accounts
  for insert to authenticated
  with check (
    auth.uid() = user_id
    -- the address the account hangs off has to be yours too, or an insert
    -- could pin an account row onto somebody else's mailbox.
    and exists (
      select 1 from public.account_emails e
      where e.id = email_id and e.user_id = auth.uid()
    )
  );

drop policy if exists account_email_accounts_owner_update on public.account_email_accounts;
create policy account_email_accounts_owner_update on public.account_email_accounts
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists account_email_accounts_owner_delete on public.account_email_accounts;
create policy account_email_accounts_owner_delete on public.account_email_accounts
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_email_accounts_admin_read on public.account_email_accounts;
create policy account_email_accounts_admin_read on public.account_email_accounts
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- the vault read, one row at a time, owner only. same contract as the old
-- account_email_password(), pointed at the new table.
create or replace function public.account_email_account_password(p_id uuid)
returns text
language sql
security definer
stable
set search_path to ''
as $$
  select a.password_secret
  from public.account_email_accounts a
  where a.id = p_id
    and a.user_id = auth.uid();
$$;

comment on function public.account_email_account_password(uuid) is
  'Reads back one platform account password. Owner only, and the only path to a column authenticated cannot select.';

revoke all on function public.account_email_account_password(uuid) from public, anon;
grant execute on function public.account_email_account_password(uuid) to authenticated;

-- carry the old single-account columns over as the first account row, then
-- drop them. password_set goes first because it is generated off
-- password_secret.
insert into public.account_email_accounts (email_id, user_id, platform, handle, password_secret)
select id, user_id, coalesce(nullif(platform, ''), 'other'), username, password_secret
from public.account_emails
where platform is not null or username is not null or password_secret is not null
on conflict (email_id, platform) do nothing;

drop function if exists public.account_email_password(uuid);

alter table public.account_emails drop column if exists password_set;
alter table public.account_emails drop column if exists password_secret;
alter table public.account_emails drop column if exists username;
alter table public.account_emails drop column if exists platform;

-- -------------------------------------------- 3. the agency side of the ledgers
--
-- A coach running a roster gets the same usage numbers the admin section has,
-- scoped to their members by the same org mechanism every other *_org_read
-- uses. Reads only, and only when the request opted in with x-org-view.

drop policy if exists api_usage_events_org_read on public.api_usage_events;
create policy api_usage_events_org_read on public.api_usage_events
  for select to authenticated
  using (
    (select private.org_view())
    and user_id in (select private.org_member_ids())
  );
