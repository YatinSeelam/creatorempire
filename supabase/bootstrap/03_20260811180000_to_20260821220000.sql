-- ==== 20260811180000_org_flow_key.sql
-- An agency's own Flow key.
--
-- Flow costs money per turn, and it is the one feature in the product where the
-- bill scales with how much a tenant's roster uses it. So an agency that wants
-- it brings its own anthropic key and pays its own bill, rather than us metering
-- somebody else's conversations.
--
-- The column is WRITE ONLY, the same shape `account_emails.password_secret`
-- already uses and for the same reason: an api key that can be selected from a
-- session is an api key that leaves on the first xss or the first over-shared
-- postgrest query. `authenticated` is granted UPDATE on it and never SELECT, so
-- the owner can paste a new one and nobody, including them, can read one back.
--
-- `flow_key_set_at` is the readable half. It is what lets the branding page say
-- "a key is installed" without the key being on the wire, and it is set by a
-- trigger rather than by the app so it cannot drift from the column it describes.

alter table public.orgs
  add column if not exists flow_api_key   text,
  add column if not exists flow_key_set_at timestamptz;

comment on column public.orgs.flow_api_key is
  'write-only. granted UPDATE to authenticated, never SELECT. read it with the service client only.';

/**
 * Stamp (or clear) `flow_key_set_at` whenever the key itself moves.
 *
 * Emptying the field is how an agency removes their key, so "" is normalised to
 * null here rather than in the app: a stored empty string would read as "a key
 * is set" to anything checking the column for null.
 */
create or replace function public.touch_org_flow_key()
returns trigger
language plpgsql
as $$
begin
  if btrim(coalesce(new.flow_api_key, '')) = '' then
    new.flow_api_key := null;
  end if;

  if new.flow_api_key is distinct from old.flow_api_key then
    new.flow_key_set_at := case when new.flow_api_key is null then null else now() end;
  end if;

  return new;
end;
$$;

drop trigger if exists orgs_flow_key_touch on public.orgs;
create trigger orgs_flow_key_touch
  before update on public.orgs
  for each row execute function public.touch_org_flow_key();

-- the key joins the update grant; it is deliberately absent from every select
-- path, including the BRAND_COLS list the app reads.
grant update (flow_api_key) on public.orgs to authenticated;

-- and explicitly out of reach of a select, whatever a future grant does.
revoke select (flow_api_key) on public.orgs from anon, authenticated;

-- ==== 20260811190000_usage_tracking.sql
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

-- ==== 20260811200000_org_join_and_delete.sql
-- Two org-layer gaps the invite work surfaced.
--
-- 1. Owners could not delete an agency at all: no delete grant, no policy.
-- 2. The join page could not say whose roster an invite is for, because the
--    invitee has no read on org_invites (the manage policy is the managers').

-- --------------------------------------------------------- 1. delete an agency
--
-- Owner only. The fks cascade seats and invites away with the row; members'
-- deals, videos and money were never the org's, so deleting the workspace
-- costs nobody their work.

grant delete on public.orgs to authenticated;

drop policy if exists orgs_delete_owner on public.orgs;
create policy orgs_delete_owner on public.orgs
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------- 2. peek an invite
--
-- The join page runs OUTSIDE the member gate (an invitee has no seat yet, that
-- is the point of the invite), so it needs one definer read to render "join
-- <org> as <role>" and to say up front when a link is dead or was sent to a
-- different email. Token in, one row out, email masked to a hint.

create or replace function public.peek_org_invite(p_token text)
returns table (org_name text, invite_role text, email_masked text, valid boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select
    o.name,
    i.role,
    left(i.email, 1) || '**' || substring(i.email from position('@' in i.email)),
    (i.accepted_at is null and i.expires_at > now())
  from public.org_invites i
  join public.orgs o on o.id = i.org_id
  where i.token = p_token;
$$;

comment on function public.peek_org_invite(text) is
  'What the join page shows before accepting: org name, role, a masked email hint, and whether the link is still good.';

revoke all on function public.peek_org_invite(text) from public, anon;
grant execute on function public.peek_org_invite(text) to authenticated;

-- ==== 20260811210000_owner_seat_immutable.sql
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

-- ==== 20260812070000_flow_delete_op.sql
-- Flow gains a delete proposal. `propose_deal_delete` records op = 'delete',
-- which the original check constraint on ai_proposals refused. Same safety
-- model as every other write: the row is a card, a human accepts it, and the
-- accept runs the same server action the delete button on the deal's edit
-- page runs. Nothing auto-applies a delete; it is classified money tier.

alter table public.ai_proposals
  drop constraint if exists ai_proposals_op_check;

alter table public.ai_proposals
  add constraint ai_proposals_op_check check (op in ('create', 'update', 'delete'));

-- ==== 20260812120000_manual_refresh_quota.sql
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

-- ==== 20260812150000_flow_brand_entity.sql
-- Flow gains a brand proposal. `propose_brand_edit` records
-- target_entity = 'brand', which the original check constraint on ai_proposals
-- refused, so a rename card could not be written at all.
--
-- Renaming a brand renames it on every deal that points at it, which is what
-- somebody usually means by "that brand is spelled wrong". Same safety model as
-- every other write: the row is a card, a human accepts it, and the accept runs
-- `updateBrand` — the same server action the brand form on the deal's edit page
-- runs, under the same RLS.

alter table public.ai_proposals
  drop constraint if exists ai_proposals_target_entity_check;

alter table public.ai_proposals
  add constraint ai_proposals_target_entity_check
    check (target_entity in ('deal', 'brand', 'bonus_rule', 'deal_account', 'calendar_note'));

-- ==== 20260813183000_backfill_brand_logo_key.sql
-- Brands created before the variations tool matched the catalogue were saved
-- with no logo_key, so every surface drew their initial even though the mark
-- was sitting in public/brands the whole time.
--
-- Only rows carrying neither a key nor an uploaded url are touched: a creator
-- who uploaded their own mark keeps it, and a key already set is already right.
-- The slug rule is the one lib/brand-catalog.ts uses, punctuation and case
-- stripped, so "Wispr Flow" and "wisprflow" collapse to the same string.
-- "loveable" is the one deliberate alias, a misspelling common enough to type.

with catalog(key, slug) as (
  values
    ('anara', 'anara'),
    ('based', 'based'),
    ('biggerz', 'biggerz'),
    ('blustu', 'blustu'),
    ('breadwinners', 'breadwinners'),
    ('candle', 'candle'),
    ('codedex', 'codedex'),
    ('composio', 'composio'),
    ('folk', 'folk'),
    ('hyperknow', 'hyperknow'),
    ('launchpoint', 'launchpoint'),
    ('liftoff', 'liftoff'),
    ('lotus', 'lotus'),
    ('lovable', 'lovable'),
    ('lovable', 'loveable'),
    ('manus', 'manus'),
    ('mathgpt', 'mathgpt'),
    ('mosaic', 'mosaic'),
    ('new-wave', 'newwave'),
    ('phrasly', 'phrasly'),
    ('pine-ai', 'pineai'),
    ('plutus', 'plutus'),
    ('polymarket', 'polymarket'),
    ('tiny-nature', 'tinynature'),
    ('turbo-ai', 'turboai'),
    ('wellspoken', 'wellspoken'),
    ('wispr-flow', 'wisprflow')
)
update brands b
set logo_key = c.key
from catalog c
where b.logo_key is null
  and (b.logo_url is null or b.logo_url = '')
  and lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = c.slug;

-- ==== 20260814050000_sync_cycle_credit_rails.sql
-- the sync cycle + credit rails + notification bookkeeping, one pass.
--
-- 1. deal_accounts.next_sync_at — each sync writes its own next due date, so
--    the cron stops thinking in one global interval. null means "due now"
--    (new accounts sort first, same as last_synced_at did).
-- 2. api_usage_events.source — 'sync' (cron), 'manual' (refresh button),
--    'tool' (profile scraper etc). the daily cap only counts what a person
--    clicked; the cron's spend is ours and is budgeted, not capped.
-- 3. social_posts.notified_at — a published/failed post emails once, ever.

alter table public.deal_accounts
  add column if not exists next_sync_at timestamptz;

-- the cron's whole query: active accounts ordered by due date.
create index if not exists deal_accounts_due_idx
  on public.deal_accounts (next_sync_at asc nulls first)
  where active;

alter table public.api_usage_events
  add column if not exists source text not null default 'tool'
  check (source in ('sync', 'manual', 'tool'));

-- the budget reads "this month's sync spend" per user; keep it a range scan.
create index if not exists api_usage_events_user_source_idx
  on public.api_usage_events (user_id, source, created_at desc);

alter table public.social_posts
  add column if not exists notified_at timestamptz;

-- ==== 20260814170000_deal_posting_cadence.sql
-- How much work a deal actually asks for, so the app can say what a cadence is
-- worth before the videos exist.
--
-- Quantity plus period rather than one videos-per-day number: a rate sheet says
-- "4 a week", never "0.571 a day", and storing the creator's own unit is what
-- lets the form read the value back the way they typed it. The conversion to a
-- rate lives once, in `postingCadence()` in lib/deals.ts, and nothing in sql
-- needs it yet — a generated column here would be a second copy of the same
-- arithmetic waiting to disagree with the first.
--
-- 0 is "no agreed number", which is every deal that existed before this ran, so
-- the default is the old behaviour and nothing has to be backfilled.

alter table public.deals
  add column posting_quota integer not null default 0,
  add column posting_period text not null default 'day';

alter table public.deals
  add constraint deals_posting_quota_range
    check (posting_quota >= 0 and posting_quota <= 1000),
  add constraint deals_posting_period_kind
    check (posting_period in ('day', 'week', 'month'));

-- The grants on this table are column-scoped, not table-wide, so a new column
-- is invisible and unwritable until it is named here. The select grant is the
-- load-bearing one: `lib/deals-server.ts` reads `select("*")`, and postgres
-- fails the whole statement when one expanded column is ungranted, which would
-- take out the entire deals section rather than just hide a field.
--
-- Both roles, to match the grants already on every other column. rls is what
-- keeps anon out (`own_rows` is `user_id = auth.uid()`, and anon has none), and
-- a grant that disagrees with its neighbours is the kind of thing that reads as
-- deliberate later.
grant select (posting_quota, posting_period) on public.deals to authenticated, anon;
grant insert (posting_quota, posting_period) on public.deals to authenticated, anon;
grant update (posting_quota, posting_period) on public.deals to authenticated, anon;

-- ==== 20260814190000_variation_trim_and_source.sql
-- variations: trim points on a component, and where a sound came from.
--
-- trimming is stored, never baked. the uploaded file stays whole in the bucket
-- and the render worker seeks past what was cut: re-trimming is then a number
-- somebody can change back, rather than a second upload of a file we already
-- destroyed. `duration_seconds` therefore keeps meaning "how long the file is",
-- and how long the SELECTION is comes off these two.
--
-- both null = use the whole clip, which is what every row written before today
-- means and what an untouched upload keeps meaning.
--
-- `source_url` is provenance for a sound pulled off a tiktok / reel / short. it
-- is null for a file somebody uploaded by hand, which is how the card knows
-- whether to show the link chip.

alter table public.variation_components
  add column if not exists trim_start_seconds numeric,
  add column if not exists trim_end_seconds numeric,
  add column if not exists source_url text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'variation_components_trim_ck'
      and conrelid = 'public.variation_components'::regclass
  ) then
    alter table public.variation_components
      add constraint variation_components_trim_ck check (
        (trim_start_seconds is null or trim_start_seconds >= 0)
        and (
          trim_start_seconds is null
          or trim_end_seconds is null
          or trim_end_seconds > trim_start_seconds
        )
      );
  end if;
end $$;

-- grants on this table are table-level (not column-level), so the three new
-- columns are already readable and writable by `authenticated` and are scoped
-- by the existing `own_rows` policy. nothing to grant.

-- ==== 20260816000000_facebook_platform.sql
-- facebook joins tiktok, instagram and youtube as a tracked platform.
--
-- calendar_notes carries the same constraint and is NOT widened here. the
-- calendar was deleted on 2026-08-12 and the table is orphaned on purpose;
-- nothing reads it and nothing will write a facebook row to it.

alter table public.deal_accounts drop constraint deal_accounts_platform_check;
alter table public.deal_accounts add constraint deal_accounts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.videos drop constraint videos_platform_check;
alter table public.videos add constraint videos_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.scrape_targets drop constraint scrape_targets_platform_check;
alter table public.scrape_targets add constraint scrape_targets_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.scrape_posts drop constraint scrape_posts_platform_check;
alter table public.scrape_posts add constraint scrape_posts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.transcripts drop constraint transcripts_platform_check;
alter table public.transcripts add constraint transcripts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.api_usage_events drop constraint api_usage_events_platform_check;
alter table public.api_usage_events add constraint api_usage_events_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

-- a facebook post lands on a Page, not on a person. with several pages
-- connected upload-post refuses the post unless it is told which one, so the
-- choice is made once at connect time and kept here.
alter table public.social_profiles add column if not exists facebook_page_id text;

-- ==== 20260818010000_org_onboarding_fixes.sql
-- Org-layer holes an onboarding pass surfaced. The additive half; the grant
-- change (the flow key leak) is 20260818020000_org_flow_key_select.sql, kept
-- apart because it has to land AFTER the code that stops selecting `*`.
--
-- 2. video_stats had no `_org_read` policy, so `deal_earnings()` under the
--    roster's widened client saw no stats and the roster's bonus column was
--    zero for everyone. Same policy shape as the thirteen tables beside it.
-- 3. accept_org_invite did `on conflict do nothing`, so inviting somebody who
--    already held a creator seat as a manager quietly changed nothing. Now the
--    role follows the invite; the owner-seat trigger still pins the founder.
-- 4. the login / sign-up / join pages paint the tenant off `loadBrand()`, and
--    that read only had an anon policy: a signed-in invitee on the agency's own
--    address got the product's paint. One definer function returns exactly the
--    branding columns for a host, for anon and authenticated alike, so no
--    policy has to widen to make the door wear the right name.
--
-- Plus two admin_read policies so /admin can see who owns and sits on what.

-- ---------------------------------------------- 2. the roster's missing stats
drop policy if exists video_stats_org_read on public.video_stats;
create policy video_stats_org_read on public.video_stats
  for select to authenticated
  using (
    (select private.org_view())
    and user_id in (select private.org_member_ids())
  );

-- ------------------------------------------- 3. an invite can change a role
create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.org_invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite is not valid';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite was sent to a different email';
  end if;

  -- a seat that already exists takes the invite's role: that is how a creator
  -- gets promoted to manager without being removed first. the founder's seat
  -- is pinned to owner by protect_owner_seat_role whatever the invite said.
  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do update
    set role = excluded.role;

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end
$$;

-- --------------------------------------------- 4. the door wears the tenant
create or replace function public.org_brand_for_host(p_slug text, p_domain text)
returns table (
  id uuid,
  slug text,
  name text,
  logo_url text,
  wordmark_url text,
  favicon_url text,
  accent_hex text,
  accent_dark_hex text,
  accent_soft_hex text,
  rail_hex text,
  features jsonb,
  custom_domain text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    o.id, o.slug, o.name, o.logo_url, o.wordmark_url, o.favicon_url,
    o.accent_hex, o.accent_dark_hex, o.accent_soft_hex, o.rail_hex,
    o.features, o.custom_domain
  from public.orgs o
  where (p_slug is not null and o.slug = p_slug)
     or (p_domain is not null and o.custom_domain = p_domain)
  -- a slug match is the more specific claim when both are given
  order by (o.slug = p_slug) desc
  limit 1;
$$;

comment on function public.org_brand_for_host(text, text) is
  'The branding columns for a tenant host. What the login, sign-up and join pages paint from. Anon-safe: these are the columns anon could already select.';

revoke all on function public.org_brand_for_host(text, text) from public;
grant execute on function public.org_brand_for_host(text, text) to anon, authenticated;

-- ---------------------------------------------------- admin reads for /admin
drop policy if exists orgs_admin_read on public.orgs;
create policy orgs_admin_read on public.orgs
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists org_members_admin_read on public.org_members;
create policy org_members_admin_read on public.org_members
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- ==== 20260818011000_org_members_delete_owner_only.sql
-- Removing somebody from the roster is the owner's call, not a manager's.
--
-- ROLE_NOTE, the docs page and the branding of the whole role model say a
-- manager "reads every creator's deals and money. changes none of them", and
-- that removing people is the one thing an owner has over a manager. The delete
-- policy said otherwise: it keyed on private.managed_org_ids(), which is owners
-- AND managers, so a manager could clear the roster from the creators page.
-- Now: your own seat (leaving), or a seat on a workspace you own.

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select o.id from public.orgs o where o.owner_id = auth.uid())
  );

-- ==== 20260818020000_org_flow_key_select.sql
-- The flow key leak, applied SEPARATELY and AFTER the code that stops
-- selecting `*` from orgs is live (lib/workspace.ts, lib/org-server.ts read an
-- explicit column list as of the same change). Applying this before that
-- deploy makes every `select("*")` on orgs fail with "permission denied", which
-- is the whole agency layer going dark for the length of a build.
--
-- The hole: 20260811180000_org_flow_key.sql revoked select on the COLUMN, but
-- authenticated still held a table-level SELECT on orgs, and a column revoke
-- does not narrow a table grant. Any creator on any roster could
-- `select flow_api_key from orgs`, and the app's own `select("*")` pulled the
-- key into the branding page's client props. Table-level select goes; a
-- column list without the key comes back.

-- ------------------------------------------------------- 1. the flow key leak
revoke select on public.orgs from authenticated;
grant select (
  id, slug, name, logo_url, wordmark_url, favicon_url,
  accent_hex, accent_dark_hex, accent_soft_hex, rail_hex,
  features, support_email, custom_domain, owner_id,
  flow_key_set_at, created_at, updated_at
) on public.orgs to authenticated;

-- belt and braces: the column revoke from the flow-key migration, restated so
-- a future `grant select on orgs` re-run has to be deliberate about the key.
revoke select (flow_api_key) on public.orgs from anon, authenticated;

-- ==== 20260818120000_deals_belong_to_a_workspace.sql
-- deals belong to a workspace.
--
-- before this a deal was only ever "yours". the moment a creator joined an
-- agency every deal they had ever run showed up on that agency's roster, and
-- a brand new agency was born with numbers on it that had nothing to do with
-- it. an agency and a creator account are separate entities: the creator's
-- own deals stay on their own books, and a deal done for an agency sits on
-- the agency's.
--
-- `deals.org_id` is that split. null = the creator's personal account, an org
-- id = a deal done inside that workspace. every read in the app scopes on it
-- (lib/workspace.ts `dealScope`) and the org read policies below stop reading
-- "every deal of every member" and read "the deals on this org's books".

alter table public.deals
  add column if not exists org_id uuid references public.orgs(id) on delete set null;

create index if not exists deals_user_org_idx on public.deals (user_id, org_id);
create index if not exists deals_org_idx on public.deals (org_id) where org_id is not null;

-- a deal can only be filed under an org its owner actually sits on. a form
-- can post any uuid it likes; this is what stops it landing on a stranger's
-- roster. definer, so the check reads org_members past its own rls.
create or replace function private.is_org_member(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = p_user
  )
$$;

create or replace function private.deals_check_org()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.org_id is not null and not private.is_org_member(new.org_id, new.user_id) then
    raise exception 'that workspace is not one you belong to' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists deals_check_org on public.deals;
create trigger deals_check_org
  before insert or update of org_id, user_id on public.deals
  for each row execute function private.deals_check_org();

-- leaving an org hands the deals back. a seat that is gone cannot be switched
-- into, so a deal left filed under it would be invisible to the creator who
-- owns it and still visible to the agency that let them go. neither is right.
create or replace function private.org_members_release_deals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.deals
     set org_id = null
   where user_id = old.user_id
     and org_id = old.org_id;
  return old;
end;
$$;

drop trigger if exists org_members_release_deals on public.org_members;
create trigger org_members_release_deals
  after delete on public.org_members
  for each row execute function private.org_members_release_deals();

-- the deals on the books of an org i manage. what every org read below hangs
-- off, so "which rows may a manager see" is answered once.
create or replace function private.org_deal_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.deals
  where org_id in (select private.managed_org_ids())
$$;

create or replace function private.org_video_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id
  from public.videos
  where deal_id in (select private.org_deal_ids())
$$;

-- the org read policies. they used to say "any row belonging to a member of an
-- org i manage", which handed a manager the creator's whole personal history.
-- now: the deal is on my org's books, or it is not mine to read.
drop policy if exists deals_org_read on public.deals;
create policy deals_org_read on public.deals
  for select using (
    (select private.org_view())
    and org_id in (select private.managed_org_ids())
  );

drop policy if exists videos_org_read on public.videos;
create policy videos_org_read on public.videos
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists deal_accounts_org_read on public.deal_accounts;
create policy deal_accounts_org_read on public.deal_accounts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists payouts_org_read on public.payouts;
create policy payouts_org_read on public.payouts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists bonus_rules_org_read on public.bonus_rules;
create policy bonus_rules_org_read on public.bonus_rules
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists social_posts_org_read on public.social_posts;
create policy social_posts_org_read on public.social_posts
  for select using (
    (select private.org_view())
    and deal_id in (select private.org_deal_ids())
  );

drop policy if exists video_stats_org_read on public.video_stats;
create policy video_stats_org_read on public.video_stats
  for select using (
    (select private.org_view())
    and video_id in (select private.org_video_ids())
  );

-- brands stay readable per member: a brand is a name and a logo shared by
-- every deal with them, personal or not, and the roster never reads it.

-- ==== 20260818200000_founder_and_agency_admin.sql
-- founder + agency admin.
--
-- two role systems, and this migration names them the way the product does:
--
--   platform  founder   the people on admin_emails. they see every workspace,
--                       who owns it, who sits on it, and they are the only ones
--                       who can hand a workspace something the product does not
--                       give everybody (a custom tool, a portfolio tweak).
--   workspace owner     the agency's own founder. one per workspace, pinned by
--                       trigger. branding, the flow key, removals, delete.
--             admin     runs THAT workspace and nothing outside it: roster,
--                       invites, modules. this is what "manager" was.
--             creator   a seat. their own work under the agency's paint.
--
-- an agency admin is admin of exactly one workspace. a founder is above all of
-- them. nothing about `admin_emails`, `private.is_admin()` or `x-admin-view`
-- changes: those are the founder mechanism and the name in the schema stays,
-- because renaming a security-definer function and a header on a live product
-- buys nothing but risk. the app calls it founder everywhere a person reads it.

-- ------------------------------------------------------------- manager → admin

update public.org_members set role = 'admin' where role = 'manager';
update public.org_invites set role = 'admin' where role = 'manager';

alter table public.org_members drop constraint if exists org_members_role_check;
alter table public.org_members
  add constraint org_members_role_check
  check (role in ('owner', 'admin', 'creator'));

-- an invite can hand out admin or creator. never owner: `orgs.owner_id` is the
-- owner permission and an invite has never moved it, so an "owner" invite was
-- a manager wearing the wrong label. the app refused it already; now the table does.
alter table public.org_invites drop constraint if exists org_invites_role_check;
alter table public.org_invites
  add constraint org_invites_role_check
  check (role in ('admin', 'creator'));

create or replace function private.managed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and role in ('owner', 'admin')
$$;

comment on table public.admin_emails is
  'the platform founders. on this list = founder role: /founder, every workspace, custom tools. not an agency role.';

-- ------------------------------------------------------------- org_overrides
--
-- what a founder configured for one workspace that the product does not give
-- everybody. a key/value shelf on purpose: the first two keys are custom tool
-- grants (`tool.<slug>` = true) and portfolio setup (`portfolio.footer`,
-- `portfolio.badge`), and the next one an agency asks for is a row, not a
-- migration. members read their own workspace's rows (the tools shelf, the
-- portfolio); only a founder writes.

create table if not exists public.org_overrides (
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  value jsonb not null default 'true'::jsonb,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (org_id, key)
);

comment on table public.org_overrides is
  'per-workspace config a founder set: tool.<slug> grants, portfolio.* setup, anything custom. members read, founders write.';

alter table public.org_overrides enable row level security;

revoke all on public.org_overrides from anon, authenticated;
grant select, insert, update, delete on public.org_overrides to authenticated;

drop policy if exists org_overrides_member_read on public.org_overrides;
create policy org_overrides_member_read on public.org_overrides
  for select to authenticated
  using (org_id in (select private.my_org_ids()));

-- the founder half only fires behind x-admin-view, like every other *_admin_read:
-- a founder's own tools shelf shows their own workspaces' grants, not everyone's.
drop policy if exists org_overrides_admin_read on public.org_overrides;
create policy org_overrides_admin_read on public.org_overrides
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists org_overrides_admin_insert on public.org_overrides;
create policy org_overrides_admin_insert on public.org_overrides
  for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists org_overrides_admin_update on public.org_overrides;
create policy org_overrides_admin_update on public.org_overrides
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists org_overrides_admin_delete on public.org_overrides;
create policy org_overrides_admin_delete on public.org_overrides
  for delete to authenticated
  using ((select private.is_admin()));

-- who set it, when. stamped by the table rather than trusted from the form.
create or replace function private.stamp_org_override()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.set_by := auth.uid();
  new.set_at := now();
  return new;
end;
$$;

drop trigger if exists org_overrides_stamp on public.org_overrides;
create trigger org_overrides_stamp
  before insert or update on public.org_overrides
  for each row execute function private.stamp_org_override();

-- ------------------------------------------------- the public portfolio's agency
--
-- a creator's public page at /<slug> is read with no session at all, and the
-- one thing it wants to know about orgs is: is this creator on a workspace a
-- founder gave portfolio setup to, and what is that setup. one definer call,
-- returning the org's already-public branding columns plus its portfolio.*
-- overrides. an org with no portfolio.* rows is not returned, so a creator on
-- a plain agency gets exactly the page they had.

create or replace function public.portfolio_agency_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'custom_domain', o.custom_domain,
    'overrides', (
      select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb)
      from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  )
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = p_user
    and exists (
      select 1 from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  order by m.joined_at asc
  limit 1;
$$;

revoke all on function public.portfolio_agency_for(uuid) from public;
grant execute on function public.portfolio_agency_for(uuid) to anon, authenticated;

-- ==== 20260818203000_founder_reads_invites_portfolio_gate.sql
-- two follow-ups to 20260818200000, found in review.
--
-- 1. the founder page for a workspace lists its pending invites, read behind
--    the founder view. org_invites only had `org_invites_manage` (owner/admin
--    of that org), so the panel was always empty unless the founder happened
--    to manage the workspace. same shape as every other *_admin_read policy:
--    founder AND the x-admin-view opt-in.
drop policy if exists org_invites_admin_read on public.org_invites;
create policy org_invites_admin_read on public.org_invites
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- 2. portfolio_agency_for is granted to anon, and it took any user id. that
--    let anyone probe a uuid for "which workspace is this person on". it now
--    answers only for a user with a PUBLISHED portfolio, which is the one case
--    the answer is already on a public page, or for the caller's own row, so
--    the editor's preview shows the setup on a draft too.
create or replace function public.portfolio_agency_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'custom_domain', o.custom_domain,
    'overrides', (
      select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb)
      from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  )
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = p_user
    and exists (
      select 1 from public.portfolios p
      where p.user_id = p_user
        and (p.published or p.user_id = (select auth.uid()))
    )
    and exists (
      select 1 from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  order by m.joined_at asc
  limit 1;
$$;

-- ==== 20260819210000_brand_logos.sql
-- Custom brand logos, for the brands the catalogue has never heard of.
--
-- `brands.logo_url` has existed since 20260808230000_brand_identity.sql but
-- nothing on the site could fill it: the column was only reachable through the
-- portfolio import. The add is repeated idempotently so this file reads as the
-- whole feature on its own.

alter table public.brands
  add column if not exists logo_url text;

-- -------------------------------------------------------------------- storage

-- Same bargain the `portfolio` bucket makes: public, because the mark renders
-- in <img> tags all over the dashboard and a signed url that expires would
-- break every one of them. 1MB is plenty - raster logos are resized to a 400px
-- webp in the browser before they get here (lib/brand-logo-upload.ts) and svgs
-- are small by nature.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-logos',
  'brand-logos',
  true,
  1048576,
  array['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']
)
on conflict (id) do nothing;

-- Writes are scoped by the first path segment being the caller's uid, which is
-- why every upload path in lib/brand-logo-upload.ts starts with `${userId}/`.
-- Nothing enforces that on the client, so it is enforced here.
drop policy if exists brand_logo_objects_insert on storage.objects;
create policy brand_logo_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists brand_logo_objects_update on storage.objects;
create policy brand_logo_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists brand_logo_objects_delete on storage.objects;
create policy brand_logo_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'brand-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Reads are open to everyone, anon included. A logo is fetchable by anyone who
-- has the url, which is the same bargain every public bucket makes; nothing
-- secret is ever uploaded here.
drop policy if exists brand_logo_objects_read on storage.objects;
create policy brand_logo_objects_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'brand-logos');

-- ==== 20260819211000_campaign_requests.sql
-- Members browse the campaign board and ask to be placed on a campaign.
--
-- The board itself (campaign_deals) stays founder-only at the policy level.
-- What a member sees goes through `campaign_catalog()`, a security definer
-- function that hands back only the browsable columns: no notes, no
-- how_to_connect, no who_runs_it, no virality, and nothing about managers.
-- Those are staff working notes, not a menu.
--
-- `campaign_requests` is the ask. A member can hold one PENDING request per
-- campaign (partial unique index); a declined one can be asked again, which is
-- why the index is partial rather than plain. Status is founder-written only:
-- the insert grant is column-scoped so a tampered form cannot approve itself.

-- --------------------------------------------------------------- the catalog

create or replace function public.campaign_catalog()
returns table (
  id                uuid,
  name              text,
  status            text,
  base_pay          text,
  posting_freq      text,
  pay_model         text,
  pay_amount        numeric,
  posting_per_day   integer,
  posting_unlimited boolean,
  formats           text
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.name, d.status, d.base_pay, d.posting_freq, d.pay_model,
         d.pay_amount, d.posting_per_day, d.posting_unlimited, d.formats
    from public.campaign_deals d
   -- need_info has no terms to show and paused is not accepting anyone, so
   -- neither belongs on a menu a member can request from.
   where d.status not in ('need_info', 'paused')
   order by d.sort_order nulls first, d.created_at desc;
$$;

revoke all on function public.campaign_catalog() from public, anon;
grant execute on function public.campaign_catalog() to authenticated;

-- --------------------------------------------------------------- the requests

create table if not exists public.campaign_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  campaign_deal_id uuid not null references public.campaign_deals (id) on delete cascade,
  note             text not null default '',
  status           text not null default 'pending'
                     check (status in ('pending', 'approved', 'declined')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- one live ask per person per campaign. partial, so a declined request does
-- not block asking again later.
create unique index if not exists campaign_requests_one_pending
  on public.campaign_requests (user_id, campaign_deal_id)
  where status = 'pending';

-- the founder view reads them per campaign
create index if not exists campaign_requests_deal_idx
  on public.campaign_requests (campaign_deal_id);

drop trigger if exists campaign_requests_touch on public.campaign_requests;
create trigger campaign_requests_touch
  before update on public.campaign_requests
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------- rls

alter table public.campaign_requests enable row level security;

revoke all on public.campaign_requests from anon, authenticated;

-- the insert grant is column-scoped: a form can say who and what and why, and
-- nothing else. status/timestamps come from defaults, and only the founder
-- update below can move status.
grant select on public.campaign_requests to authenticated;
grant insert (user_id, campaign_deal_id, note) on public.campaign_requests to authenticated;
grant update (status) on public.campaign_requests to authenticated;

drop policy if exists campaign_requests_own_select on public.campaign_requests;
create policy campaign_requests_own_select on public.campaign_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists campaign_requests_own_insert on public.campaign_requests;
create policy campaign_requests_own_insert on public.campaign_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- same pattern as the campaigns migration: staff, or nobody. select so the
-- founder list shows every ask, update so approve/decline can move status.
drop policy if exists campaign_requests_admin_read on public.campaign_requests;
create policy campaign_requests_admin_read on public.campaign_requests
  for select to authenticated
  using ((select private.is_admin()));

drop policy if exists campaign_requests_admin_update on public.campaign_requests;
create policy campaign_requests_admin_update on public.campaign_requests
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- ==== 20260821130000_job_credits.sql
-- the credits wallet that pays for edit jobs. 1 credit = $1 of editor pay.
-- creators buy packs through stripe checkout (webhook is the only writer of
-- 'purchase' rows, via the service key), posting a job spends, cancelling an
-- unclaimed job refunds. balance is always sum(delta): there is no cached
-- number to drift.

create table public.job_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null check (delta <> 0),
  kind text not null check (kind in ('purchase', 'job_post', 'job_refund', 'adjust')),
  job_id uuid references public.edit_jobs(id) on delete set null,
  -- the whole idempotency story for purchases: stripe retries an event for
  -- three days, and this unique column is what makes the replay a no-op.
  stripe_session_id text unique,
  memo text,
  created_at timestamptz not null default now()
);

create index job_credit_ledger_user_idx
  on public.job_credit_ledger (user_id, created_at desc);
create index job_credit_ledger_job_idx
  on public.job_credit_ledger (job_id)
  where job_id is not null;

alter table public.job_credit_ledger enable row level security;

revoke all on public.job_credit_ledger from anon, authenticated;
grant select on public.job_credit_ledger to authenticated;

create policy job_credit_ledger_own_rows on public.job_credit_ledger
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy job_credit_ledger_admin_read on public.job_credit_ledger
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- deliberately no insert/update/delete policies: the definer functions below
-- and the stripe webhook's service key are the only writers, so nobody can
-- insert their way to a balance.

-- ------------------------------------------------------------------ balance

create or replace function public.job_credit_balance()
returns integer
language sql stable security definer
set search_path to ''
as $$
  select coalesce(sum(delta), 0)::integer
  from public.job_credit_ledger
  where user_id = (select auth.uid());
$$;

revoke all on function public.job_credit_balance() from public, anon;
grant execute on function public.job_credit_balance() to authenticated;

-- -------------------------------------------------------------------- spend

-- charges the job's own `credits` column, never an amount off the wire, so a
-- tampered call cannot pick its own price. the advisory lock is per user: two
-- tabs posting at once cannot both spend the last credit. idempotent per job.
create or replace function public.spend_job_credits(p_job uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job record;
  v_balance integer;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  perform pg_advisory_xact_lock(hashtext('job_credits'), hashtext(v_uid::text));

  select id, user_id, credits, status into v_job
  from public.edit_jobs where id = p_job;

  if v_job.id is null or v_job.user_id <> v_uid then
    raise exception 'not your job';
  end if;
  if v_job.status <> 'open' then
    raise exception 'only an open job can be paid for';
  end if;
  if coalesce(v_job.credits, 0) <= 0 then
    raise exception 'job has no credit price';
  end if;

  if exists (
    select 1 from public.job_credit_ledger
    where job_id = p_job and kind = 'job_post'
  ) then
    return; -- already paid for, a double submit is a no-op
  end if;

  select coalesce(sum(delta), 0) into v_balance
  from public.job_credit_ledger where user_id = v_uid;

  if v_balance < v_job.credits then
    raise exception 'not enough credits';
  end if;

  insert into public.job_credit_ledger (user_id, delta, kind, job_id)
  values (v_uid, -v_job.credits, 'job_post', p_job);
end;
$$;

revoke all on function public.spend_job_credits(uuid) from public, anon;
grant execute on function public.spend_job_credits(uuid) to authenticated;

-- ------------------------------------------------------------------- refund

-- hands back what a job spent, only for a cancelled job nobody ever claimed:
-- a claimed job carries an editor's work and any make-good on it is a manual
-- 'adjust' row, not a self-service refund. idempotent: the refund is the
-- negative of the job's ledger sum, so a second call finds zero owed.
create or replace function public.refund_job_credits(p_job uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job record;
  v_owed integer;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  perform pg_advisory_xact_lock(hashtext('job_credits'), hashtext(v_uid::text));

  select id, user_id, status, claimed_at into v_job
  from public.edit_jobs where id = p_job;

  if v_job.id is null or v_job.user_id <> v_uid then
    raise exception 'not your job';
  end if;
  if v_job.status <> 'cancelled' or v_job.claimed_at is not null then
    raise exception 'only a cancelled, never-claimed job refunds';
  end if;

  select -coalesce(sum(delta), 0) into v_owed
  from public.job_credit_ledger where job_id = p_job;

  if v_owed > 0 then
    insert into public.job_credit_ledger (user_id, delta, kind, job_id)
    values (v_uid, v_owed, 'job_refund', p_job);
  end if;
end;
$$;

revoke all on function public.refund_job_credits(uuid) from public, anon;
grant execute on function public.refund_job_credits(uuid) to authenticated;

-- ------------------------------------------------- the job's credit price

-- tier 1 = a talking head cut, 1 credit a video. tier 2 = everything else,
-- 2 credits a video. rush adds 1 a video. `credits` is the whole price the
-- job spent, frozen at post; `change_rounds` counts the one included
-- change-of-mind revision round (brief-conformance fixes are unlimited and
-- tracked nowhere, because unfinished work is not a revision).
alter table public.edit_jobs
  add column tier smallint not null default 1 check (tier in (1, 2)),
  add column credits integer not null default 0 check (credits >= 0),
  add column is_rush boolean not null default false,
  add column change_rounds integer not null default 0 check (change_rounds between 0 and 1);

-- the guard grows two jobs: the editor keeps their hands off the new money
-- columns, and the owner's own offer freezes once somebody claims it.
create or replace function public.guard_edit_job_update()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- the service key (cron auto-approve) is trusted
  end if;

  if (select auth.uid()) = old.user_id then
    -- the owner, but the offer is the offer once claimed: the credits were
    -- spent against it and the editor accepted it.
    if old.status <> 'open' and (
      new.pay_kind <> old.pay_kind
      or new.pay_cents <> old.pay_cents
      or new.video_count <> old.video_count
      or new.tier <> old.tier
      or new.credits <> old.credits
      or new.is_rush <> old.is_rush
    ) then
      raise exception 'the offer is locked once the job is claimed';
    end if;
    return new;
  end if;

  if new.user_id <> old.user_id
    or new.deal_id is distinct from old.deal_id
    or new.title <> old.title
    or new.brief is distinct from old.brief
    or new.pay_kind <> old.pay_kind
    or new.pay_cents <> old.pay_cents
    or new.video_count <> old.video_count
    or new.tier <> old.tier
    or new.credits <> old.credits
    or new.is_rush <> old.is_rush
    or new.change_rounds <> old.change_rounds then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------- editor payout side

-- where an editor's money goes. its own table rather than a column on
-- `editors`, because `editors` has a public read policy for the /e/<handle>
-- page and a paypal address must never ride along with it.
create table public.editor_payout_details (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null default 'paypal'
    check (method in ('paypal', 'venmo', 'cashapp', 'wise', 'other')),
  address text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.editor_payout_details enable row level security;

revoke all on public.editor_payout_details from anon, authenticated;
grant select, insert, update on public.editor_payout_details to authenticated;

create policy editor_payout_details_own_rows on public.editor_payout_details
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy editor_payout_details_insert_own on public.editor_payout_details
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy editor_payout_details_update_own on public.editor_payout_details
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy editor_payout_details_admin_read on public.editor_payout_details
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

create trigger editor_payout_details_touch
  before update on public.editor_payout_details
  for each row execute function public.touch_updated_at();

-- with credits, the platform pays editors, not the creator: the creator
-- already paid at post time. so marking a payout paid becomes a founder move,
-- through an rpc with the admin check inside (same shape as
-- set_editor_application_status).
create or replace function public.mark_editor_payout_paid(p_id uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  if not public.am_i_admin() then
    raise exception 'not allowed';
  end if;

  update public.editor_payouts
  set status = 'paid', paid_at = now()
  where id = p_id and status = 'due';
end;
$$;

revoke all on function public.mark_editor_payout_paid(uuid) from public, anon;
grant execute on function public.mark_editor_payout_paid(uuid) to authenticated;

-- ==== 20260821150000_kit_entitlements.sql
-- who owns the $14.99 starter kit. one row per buyer, written only by the
-- stripe webhook's service key; the unique stripe_session_id makes an event
-- replay a no-op. main-product customers never need a row here:
-- lib/lowticket/access.ts lets founders, subscribers and org seats in
-- through loadAccess() instead.

create table public.kit_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  stripe_session_id text unique,
  source text not null default 'stripe',
  created_at timestamptz not null default now()
);

alter table public.kit_entitlements enable row level security;

revoke all on public.kit_entitlements from anon, authenticated;
grant select on public.kit_entitlements to authenticated;

create policy kit_entitlements_own_rows on public.kit_entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));

-- deliberately no insert/update/delete policies: the webhook's service key is
-- the only writer, so nobody can grant themselves the kit from a session.

-- ==== 20260821170000_editor_reliability.sql
-- the reliability layer on the editing market: editor tiers, claim caps, a
-- real 24h sla on every claim, strikes for letting one expire, and the
-- creator's rating at approval. claims move into an rpc so the cap and the
-- tier gate cannot be raced or skipped from a hand-rolled update.

-- ------------------------------------------------------------- editor tiers

-- 1 = new ($1 jobs only, 2 claims at a time), 2 = proven ($2 unlocked, 5
-- claims), 3 = top (10 claims). recomputed by the cron from real numbers,
-- clamped for everyone else the same way `verified` is.
alter table public.editors
  add column tier smallint not null default 1 check (tier in (1, 2, 3));

create or replace function public.guard_editor_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- service role (the cron retier) and sql console pass through
  end if;
  if tg_op = 'INSERT' then
    if new.verified and not public.am_i_admin() then
      new.verified := false;
    end if;
    if new.tier <> 1 and not public.am_i_admin() then
      new.tier := 1;
    end if;
  else
    if new.verified is distinct from old.verified and not public.am_i_admin() then
      new.verified := old.verified;
    end if;
    if new.tier is distinct from old.tier and not public.am_i_admin() then
      new.tier := old.tier;
    end if;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------ the clock on a claim

-- `sla_at` is the editor's deadline, written by the claim rpc (24h, 6h rush)
-- and cleared when the claim is released or expires. it is a different thing
-- from `due_at`, which is the creator's asked-for date on the brief.
-- `first_delivered_at` is the number the stats run on: `delivered_at` is
-- rewritten on every re-delivery, so on-time has to be judged off the first.
alter table public.edit_jobs
  add column sla_at timestamptz,
  add column sla_warned_at timestamptz,
  add column first_delivered_at timestamptz,
  add column revision_requested_at timestamptz,
  add column revision_count integer not null default 0 check (revision_count >= 0),
  add column rating smallint check (rating between 1 and 5),
  add column rating_note text;

-- the expiry sweep's only lookup
create index edit_jobs_sla_idx on public.edit_jobs (sla_at)
  where status = 'claimed';

-- ----------------------------------------------------------------- strikes

-- one row per reliability hit. the sweep and the release rpc are the only
-- writers; the editor reads their own so the number on their desk is never a
-- surprise.
create table public.edit_job_strikes (
  id uuid primary key default gen_random_uuid(),
  editor_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.edit_jobs (id) on delete set null,
  kind text not null check (kind in ('claim_expired', 'late_release', 'revision_expired')),
  created_at timestamptz not null default now()
);

create index edit_job_strikes_editor_idx
  on public.edit_job_strikes (editor_id, created_at desc);

alter table public.edit_job_strikes enable row level security;

revoke all on public.edit_job_strikes from anon, authenticated;
grant select on public.edit_job_strikes to authenticated;

create policy edit_job_strikes_own_rows on public.edit_job_strikes
  for select to authenticated
  using (editor_id = (select auth.uid()));

create policy edit_job_strikes_admin_read on public.edit_job_strikes
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- no insert/update/delete policies on purpose: the definer rpc below and the
-- service-key sweep are the only writers.

-- ------------------------------------------------------------------ guard v3

-- the editor path now also keeps its hands off the reliability and review
-- columns, and off `editor_id` itself: a claim written by hand would skip the
-- cap and the tier gate, so claims only happen through the rpc, which sets
-- the `app.edit_job_rpc` flag to pass this guard.
create or replace function public.guard_edit_job_update()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- the service key (cron sweeps) is trusted
  end if;

  if current_setting('app.edit_job_rpc', true) = '1' then
    return new; -- claim_edit_job / release_edit_job, checked inside the rpc
  end if;

  if (select auth.uid()) = old.user_id then
    if old.status <> 'open' and (
      new.pay_kind <> old.pay_kind
      or new.pay_cents <> old.pay_cents
      or new.video_count <> old.video_count
      or new.tier <> old.tier
      or new.credits <> old.credits
      or new.is_rush <> old.is_rush
    ) then
      raise exception 'the offer is locked once the job is claimed';
    end if;
    return new;
  end if;

  if new.user_id <> old.user_id
    or new.deal_id is distinct from old.deal_id
    or new.title <> old.title
    or new.brief is distinct from old.brief
    or new.pay_kind <> old.pay_kind
    or new.pay_cents <> old.pay_cents
    or new.video_count <> old.video_count
    or new.tier <> old.tier
    or new.credits <> old.credits
    or new.is_rush <> old.is_rush
    or new.change_rounds <> old.change_rounds
    or new.editor_id is distinct from old.editor_id
    or new.sla_at is distinct from old.sla_at
    or new.sla_warned_at is distinct from old.sla_warned_at
    or new.first_delivered_at is distinct from old.first_delivered_at
    or new.revision_requested_at is distinct from old.revision_requested_at
    or new.revision_count <> old.revision_count
    or new.rating is distinct from old.rating
    or new.rating_note is distinct from old.rating_note then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

-- first delivery stamps itself. named zz_ so it runs AFTER the guard: the
-- guard must see the column as the client sent it (and refuse an editor
-- writing it by hand), then this fills it in legitimately.
create or replace function public.stamp_first_delivery()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status = 'delivered' and new.first_delivered_at is null then
    new.first_delivered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists zz_first_delivery on public.edit_jobs;
create trigger zz_first_delivery
  before update on public.edit_jobs
  for each row execute function public.stamp_first_delivery();

-- ------------------------------------------------------------- the claim rpc

-- one editor, exclusively, decided by a row lock rather than by whoever
-- rendered last. checks, in order: profile exists and is active, not your own
-- job, the tier gate (tier 2 jobs need a tier 2+ editor), the concurrent
-- claim cap, then the lock. the sla starts here: 24h, 6h on a rush.
create or replace function public.claim_edit_job(p_job uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_editor record;
  v_job record;
  v_cap integer;
  v_open_claims integer;
  v_hours integer;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select status, tier into v_editor
  from public.editors where user_id = v_uid;

  if v_editor is null then
    raise exception 'no editor profile';
  end if;
  if v_editor.status = 'paused' then
    raise exception 'profile paused';
  end if;

  select id, user_id, status, editor_id, tier, is_rush into v_job
  from public.edit_jobs where id = p_job
  for update;

  if v_job.id is null then
    raise exception 'no such job';
  end if;
  if v_job.user_id = v_uid then
    raise exception 'own job';
  end if;
  if v_job.status <> 'open' or v_job.editor_id is not null then
    raise exception 'already claimed';
  end if;

  if v_job.tier >= 2 and v_editor.tier < 2 then
    raise exception 'tier locked';
  end if;

  v_cap := case v_editor.tier when 1 then 2 when 2 then 5 else 10 end;

  select count(*) into v_open_claims
  from public.edit_jobs
  where editor_id = v_uid and status in ('claimed', 'revisions');

  if v_open_claims >= v_cap then
    raise exception 'claim cap';
  end if;

  v_hours := case when v_job.is_rush then 6 else 24 end;

  perform set_config('app.edit_job_rpc', '1', true);

  update public.edit_jobs
  set editor_id = v_uid,
      status = 'claimed',
      claimed_at = now(),
      sla_at = now() + make_interval(hours => v_hours),
      sla_warned_at = null
  where id = p_job;

  insert into public.edit_job_events (job_id, author_id, kind, body)
  values (p_job, v_uid, 'status', 'claimed the job, due in ' || v_hours || ' hours');
end;
$$;

revoke all on function public.claim_edit_job(uuid) from public, anon;
grant execute on function public.claim_edit_job(uuid) to authenticated;

-- ----------------------------------------------------------- the release rpc

-- letting a claim go on purpose beats letting it rot. free inside the first
-- two hours; after that it still works but records a late_release strike,
-- which is a softer hit than a full expiry.
create or replace function public.release_edit_job(p_job uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_job record;
  v_late boolean;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select id, status, editor_id, claimed_at into v_job
  from public.edit_jobs where id = p_job
  for update;

  if v_job.id is null or v_job.editor_id is distinct from v_uid then
    raise exception 'not your job';
  end if;
  if v_job.status <> 'claimed' then
    raise exception 'only a claimed job can be released';
  end if;

  v_late := v_job.claimed_at < now() - interval '2 hours';

  perform set_config('app.edit_job_rpc', '1', true);

  update public.edit_jobs
  set editor_id = null,
      status = 'open',
      claimed_at = null,
      sla_at = null,
      sla_warned_at = null
  where id = p_job;

  if v_late then
    insert into public.edit_job_strikes (editor_id, job_id, kind)
    values (v_uid, p_job, 'late_release');
  end if;

  insert into public.edit_job_events (job_id, author_id, kind, body)
  values (
    p_job, v_uid, 'status',
    case when v_late
      then 'released the claim after the free window, back on the board'
      else 'released the claim, back on the board'
    end
  );
end;
$$;

revoke all on function public.release_edit_job(uuid) from public, anon;
grant execute on function public.release_edit_job(uuid) to authenticated;

-- ==== 20260821180000_editor_application_locale.sql
-- the onboarding wizard asks where an editor is and what they speak, because
-- assignment and communication both care. free text on purpose: a country
-- picker that fights someone's answer is worse than their own words.
alter table public.editor_applications
  add column country text,
  add column timezone text,
  add column languages text;

-- the table is column-granted (status stays staff-only), so the new answers
-- need their own grants or the wizard's writes bounce.
grant insert (country, timezone, languages) on public.editor_applications to authenticated;
grant update (country, timezone, languages) on public.editor_applications to authenticated;

-- ==== 20260821200000_editors_admin_read.sql
-- the founder roster reads every editors row, published or not. the public
-- policy only shows published-or-own, so unpublished wizard signups were
-- invisible to the admin-view client. same shape as every other admin read:
-- founder on admin_emails AND the x-admin-view opt-in header.
create policy editors_admin_read on public.editors
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- ==== 20260821210000_payout_queue.sql
-- the payout queue: founder reads every due payout, and marking one paid can
-- now record how it was paid and the processor's reference (a paypal batch
-- id), so "did this actually go out" is a column, not a memory.

alter table public.editor_payouts
  add column paid_via text,
  add column external_ref text;

-- founder reads the whole queue behind the usual admin-view opt in. the
-- editor/payer select policy stays untouched.
create policy editor_payouts_admin_read on public.editor_payouts
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- same admin-gated rpc, two optional args on the end. dropped and recreated
-- rather than overloaded: two functions with the same name would make every
-- rpc call ambiguous.
drop function if exists public.mark_editor_payout_paid(uuid);

create or replace function public.mark_editor_payout_paid(
  p_id uuid,
  p_via text default null,
  p_ref text default null
)
returns void
language plpgsql security definer
set search_path to ''
as $$
begin
  if not public.am_i_admin() then
    raise exception 'not allowed';
  end if;

  update public.editor_payouts
  set status = 'paid',
      paid_at = now(),
      paid_via = coalesce(p_via, paid_via),
      external_ref = coalesce(p_ref, external_ref)
  where id = p_id and status = 'due';
end;
$$;

revoke all on function public.mark_editor_payout_paid(uuid, text, text) from public, anon;
grant execute on function public.mark_editor_payout_paid(uuid, text, text) to authenticated;

-- ==== 20260821220000_open_claims_payout_requests.sql
-- launch loosening + payout on request.
--
-- 1. the tier gate comes off the claim: with a brand-new editor pool there
--    are no $1 jobs to grind through, so "unlocks after 10 approved jobs"
--    just locks the whole board. caps and the sla stay; tiers keep being
--    computed and keep deciding caps, they just stop gating tier 2 jobs.
-- 2. editors can raise a hand for a payout any time: one timestamp on their
--    payout details, set by them, cleared by the founder queue when paid.

create or replace function public.claim_edit_job(p_job uuid)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_editor record;
  v_job record;
  v_cap integer;
  v_open_claims integer;
  v_hours integer;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select status, tier into v_editor
  from public.editors where user_id = v_uid;

  if v_editor is null then
    raise exception 'no editor profile';
  end if;
  if v_editor.status = 'paused' then
    raise exception 'profile paused';
  end if;

  select id, user_id, status, editor_id, tier, is_rush into v_job
  from public.edit_jobs where id = p_job
  for update;

  if v_job.id is null then
    raise exception 'no such job';
  end if;
  if v_job.user_id = v_uid then
    raise exception 'own job';
  end if;
  if v_job.status <> 'open' or v_job.editor_id is not null then
    raise exception 'already claimed';
  end if;

  -- tier gate removed 2026-08-21: any active editor claims any tier.

  v_cap := case v_editor.tier when 1 then 2 when 2 then 5 else 10 end;

  select count(*) into v_open_claims
  from public.edit_jobs
  where editor_id = v_uid and status in ('claimed', 'revisions');

  if v_open_claims >= v_cap then
    raise exception 'claim cap';
  end if;

  v_hours := case when v_job.is_rush then 6 else 24 end;

  perform set_config('app.edit_job_rpc', '1', true);

  update public.edit_jobs
  set editor_id = v_uid,
      status = 'claimed',
      claimed_at = now(),
      sla_at = now() + make_interval(hours => v_hours),
      sla_warned_at = null
  where id = p_job;

  insert into public.edit_job_events (job_id, author_id, kind, body)
  values (p_job, v_uid, 'status', 'claimed the job, due in ' || v_hours || ' hours');
end;
$$;

-- ------------------------------------------------------ payout on request

alter table public.editor_payout_details
  add column payout_requested_at timestamptz;

grant update (payout_requested_at) on public.editor_payout_details to authenticated;

-- the founder queue clears the flag when the money goes out. update needs its
-- own admin policy because the only existing one is own-rows.
create policy editor_payout_details_admin_update on public.editor_payout_details
  for update to authenticated
  using ((select private.is_admin()) and (select private.admin_view()))
  with check ((select private.is_admin()) and (select private.admin_view()));

