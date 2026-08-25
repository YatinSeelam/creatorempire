-- ==== 20260821230000_creator_role.sql
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

-- ==== 20260821240000_auto_payouts.sql
-- automated payouts. the money leaves on the editor's button press instead of
-- waiting for somebody to open paypal, so the whole flow needs the shape any
-- real payment path needs: claim, send, settle, and a way back if the send
-- fails.
--
-- The rule that matters: a payout is CLAIMED in the database before a single
-- byte goes to paypal, and the claim is what makes a second attempt
-- impossible. Without that, a double click, a retry or a crash between "money
-- sent" and "rows marked paid" pays somebody twice, and there is no undo on a
-- payout.

create table public.editor_payout_batches (
  id uuid primary key default gen_random_uuid(),
  editor_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  method text not null,
  address text not null,
  -- sending: claimed, money may or may not have left. paid: provider accepted
  -- it. failed: provider refused, the rows went back to due and it can be
  -- tried again.
  status text not null default 'sending'
    check (status in ('sending', 'paid', 'failed')),
  provider text not null default 'paypal',
  /** paypal's payout_batch_id, the receipt to search their dashboard for. */
  provider_batch_id text,
  error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index editor_payout_batches_editor_idx
  on public.editor_payout_batches (editor_id, created_at desc);

-- one in flight per editor, full stop. this partial unique index is the
-- backstop under the advisory lock in claim_payout_batch: even if two requests
-- somehow got past the lock, the second insert would violate it.
create unique index editor_payout_batches_one_in_flight
  on public.editor_payout_batches (editor_id)
  where status = 'sending';

alter table public.editor_payout_batches enable row level security;

revoke all on public.editor_payout_batches from anon, authenticated;
grant select on public.editor_payout_batches to authenticated;

create policy editor_payout_batches_own_rows on public.editor_payout_batches
  for select to authenticated
  using (editor_id = (select auth.uid()));

create policy editor_payout_batches_admin_read on public.editor_payout_batches
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- no write policies: the three definer functions below are the only writers.

-- which batch each payout row was settled by, so a paid row can be traced
-- back to a paypal receipt.
alter table public.editor_payouts
  add column batch_id uuid references public.editor_payout_batches (id) on delete set null;

create index editor_payouts_batch_idx on public.editor_payouts (batch_id)
  where batch_id is not null;

-- ------------------------------------------------------------------- claim

-- Takes everything the caller is owed, stamps it with a new batch, and hands
-- back what to send and where. Raises rather than returning null on every
-- refusal, so a caller cannot mistake "nothing happened" for "sent".
--
-- The cap is deliberate and low. An automated payout path is the one place a
-- bug spends real money without anybody watching, so anything unusual stops
-- and waits for a human instead.
create or replace function public.claim_payout_batch(p_max_cents integer default 50000)
returns table (batch_id uuid, amount_cents integer, method text, address text)
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_details record;
  v_total integer;
  v_batch uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- per editor, so two tabs cannot both claim the same owed money.
  perform pg_advisory_xact_lock(hashtext('editor_payout'), hashtext(v_uid::text));

  if exists (
    select 1 from public.editor_payout_batches
    where editor_id = v_uid and status = 'sending'
  ) then
    raise exception 'payout already in flight';
  end if;

  select method, address into v_details
  from public.editor_payout_details where user_id = v_uid;

  if v_details is null or coalesce(v_details.address, '') = '' then
    raise exception 'no payout address';
  end if;

  select coalesce(sum(p.amount_cents), 0) into v_total
  from public.editor_payouts p
  where p.editor_id = v_uid and p.status = 'due';

  if v_total <= 0 then
    raise exception 'nothing owed';
  end if;
  if v_total > p_max_cents then
    raise exception 'over the automatic limit';
  end if;

  insert into public.editor_payout_batches (editor_id, amount_cents, method, address)
  values (v_uid, v_total, v_details.method, v_details.address)
  returning id into v_batch;

  -- stamping the rows is what takes them out of the "owed" pool. they stay
  -- status 'due' until the money actually lands, so a failed send can put
  -- them straight back by clearing the stamp.
  update public.editor_payouts
  set batch_id = v_batch
  where editor_id = v_uid and status = 'due' and batch_id is null;

  return query select v_batch, v_total, v_details.method, v_details.address;
end;
$$;

revoke all on function public.claim_payout_batch(integer) from public, anon;
grant execute on function public.claim_payout_batch(integer) to authenticated;

-- ------------------------------------------------------------------ settle

-- The provider took it. Marks the batch and every row it covers paid, and
-- puts the editor's raised hand down. Scoped to the caller's own batch so one
-- editor cannot settle another's.
create or replace function public.settle_payout_batch(p_batch uuid, p_ref text)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_batch record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select id, editor_id, method, status into v_batch
  from public.editor_payout_batches where id = p_batch for update;

  if v_batch.id is null or v_batch.editor_id <> v_uid then
    raise exception 'not your batch';
  end if;
  if v_batch.status <> 'sending' then
    return; -- already settled, a retry is a no-op
  end if;

  update public.editor_payout_batches
  set status = 'paid', paid_at = now(), provider_batch_id = p_ref
  where id = p_batch;

  update public.editor_payouts
  set status = 'paid', paid_at = now(), paid_via = v_batch.method, external_ref = p_ref
  where batch_id = p_batch and status = 'due';

  update public.editor_payout_details
  set payout_requested_at = null
  where user_id = v_uid;
end;
$$;

revoke all on function public.settle_payout_batch(uuid, text) from public, anon;
grant execute on function public.settle_payout_batch(uuid, text) to authenticated;

-- -------------------------------------------------------------------- fail

-- The provider refused, so the claim is released and the money goes back to
-- owed. The batch row survives as the record of the attempt, which is what
-- lets somebody work out later why a payout did not go.
create or replace function public.fail_payout_batch(p_batch uuid, p_error text)
returns void
language plpgsql security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_batch record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select id, editor_id, status into v_batch
  from public.editor_payout_batches where id = p_batch for update;

  if v_batch.id is null or v_batch.editor_id <> v_uid then
    raise exception 'not your batch';
  end if;
  if v_batch.status <> 'sending' then
    return;
  end if;

  update public.editor_payout_batches
  set status = 'failed', error = left(coalesce(p_error, 'unknown'), 500)
  where id = p_batch;

  -- back into the owed pool, ready to be claimed again.
  update public.editor_payouts
  set batch_id = null
  where batch_id = p_batch and status = 'due';
end;
$$;

revoke all on function public.fail_payout_batch(uuid, text) from public, anon;
grant execute on function public.fail_payout_batch(uuid, text) to authenticated;

-- ==== 20260821250000_job_brand_stamp.sql
-- the brand a job belongs to, stamped onto the job itself.
--
-- An editor can see open jobs, but `deals` and `brands` are scoped to the
-- creator who owns them, so an editor joining out to find the brand gets
-- nothing back. Denormalising is not a shortcut here, it is the only way the
-- board can say "this is for Candle" without handing every editor read access
-- to every creator's deal list.
--
-- Frozen at post on purpose, same reasoning as the payout amount: the job was
-- advertised as being for a brand, and renaming the deal later must not
-- rewrite what an editor agreed to pick up.

alter table public.edit_jobs
  add column brand_name text,
  add column brand_logo_key text,
  add column brand_logo_url text;

-- backfill from the deal each existing job is pinned to.
update public.edit_jobs j
set brand_name = b.name,
    brand_logo_key = b.logo_key,
    brand_logo_url = b.logo_url
from public.deals d
join public.brands b on b.id = d.brand_id
where j.deal_id = d.id;

-- the editor guard grows three more columns it may not touch. without this an
-- editor could relabel somebody else's job as any brand they liked.
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
    or new.rating_note is distinct from old.rating_note
    or new.brand_name is distinct from old.brand_name
    or new.brand_logo_key is distinct from old.brand_logo_key
    or new.brand_logo_url is distinct from old.brand_logo_url then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

-- ==== 20260821260000_editor_identity.sql
-- editor identity: a real name and a face, and the job carries both.
--
-- `editors` already had `name` and `avatar_url`. Nothing filled the avatar and
-- nothing showed either one to the person paying for the work, so a creator's
-- job said who the brand was and nothing at all about who was editing it.
--
-- The reason it could not just be read is `editors_public_read`:
--
--   published OR user_id = auth.uid()
--
-- and every editor is unpublished. So a creator cannot see the assigned
-- editor's row at all. Same shape as the problem the brand stamp solved from
-- the other side (editors cannot read deals or brands), and the same answer:
-- stamp the two display fields onto the job.
--
-- The stamp is a trigger rather than a line in `claimJob`, because editor_id is
-- set from three places already (claim_edit_job, release/expiry, and a future
-- founder assign) and a stamp that lives in one of them is a stamp that is
-- missing from the other two.

-- ------------------------------------------------------------------ columns

alter table public.edit_jobs
  add column if not exists editor_name text,
  add column if not exists editor_avatar_url text;

-- edit_jobs grants are column scoped, so a new column is invisible until it is
-- named here. Read only on purpose: the trigger below is the only writer.
grant select (editor_name, editor_avatar_url) on public.edit_jobs to authenticated;

-- ----------------------------------------------------------------- backfill

-- before the trigger exists, because the trigger recomputes these from source
-- on every write and would overwrite the backfill with the same answer anyway.

-- most editors signed in with google, which handed us a picture we never
-- copied anywhere the product reads.
update public.editors e
set avatar_url = p.avatar_url,
    updated_at = now()
from public.profiles p
where p.id = e.user_id
  and coalesce(btrim(e.avatar_url), '') = ''
  and coalesce(btrim(p.avatar_url), '') <> '';

-- and a few only ever typed their name on the application.
update public.editors e
set name = a.name,
    updated_at = now()
from public.editor_applications a
where a.user_id = e.user_id
  and coalesce(btrim(e.name), '') = ''
  and coalesce(btrim(a.name), '') <> '';

update public.edit_jobs j
set editor_name = coalesce(
      nullif(btrim(e.name), ''),
      nullif(btrim(a.name), ''),
      nullif(btrim(p.full_name), '')
    ),
    editor_avatar_url = coalesce(
      nullif(btrim(e.avatar_url), ''),
      nullif(btrim(p.avatar_url), '')
    )
from public.edit_jobs j2
left join public.editors e on e.user_id = j2.editor_id
left join public.editor_applications a on a.user_id = j2.editor_id
left join public.profiles p on p.id = j2.editor_id
where j2.id = j.id
  and j.editor_id is not null;

-- ------------------------------------------------------------------- stamp

/*
 * Recomputed from source on EVERY write, not frozen at claim time.
 *
 * A price is frozen because it is a promise. A face is not: an editor who
 * uploads a photo the day after claiming should appear on that job, and the
 * creator wants the current one either way.
 *
 * Recomputing unconditionally is also what makes the field untamperable. There
 * is no path where a value sent by a client survives, so the worst a hand
 * rolled patch can do is get overwritten. The guard below still raises on it,
 * because a silent overwrite and a refusal say different things to whoever is
 * reading the logs.
 *
 * Three sources in order: the portfolio row, the application, then the google
 * profile. `editors.name` is the one the editor chose to be known by, the
 * application name is what they typed for us, and full_name is whatever the
 * oauth provider handed over.
 */
create or replace function public.stamp_edit_job_editor()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.editor_id is null then
    new.editor_name := null;
    new.editor_avatar_url := null;
    return new;
  end if;

  select coalesce(
           nullif(btrim(e.name), ''),
           nullif(btrim(a.name), ''),
           nullif(btrim(p.full_name), '')
         ),
         coalesce(
           nullif(btrim(e.avatar_url), ''),
           nullif(btrim(p.avatar_url), '')
         )
    into new.editor_name, new.editor_avatar_url
  from (select 1) _
  left join public.editors e on e.user_id = new.editor_id
  left join public.editor_applications a on a.user_id = new.editor_id
  left join public.profiles p on p.id = new.editor_id;

  return new;
end;
$$;

-- the name is load bearing. same-timing triggers fire in alphabetical order,
-- and this one has to run AFTER `guard_edit_jobs` so the guard still sees the
-- columns exactly as the client sent them and can refuse a non-owner writing
-- them by hand. `zz_first_delivery` is named for the same reason.
drop trigger if exists zz_stamp_editor_identity on public.edit_jobs;
create trigger zz_stamp_editor_identity
before insert or update on public.edit_jobs
for each row execute function public.stamp_edit_job_editor();

-- ------------------------------------------------------------------- guard

-- unchanged except for the two new columns on the non-owner list. `is distinct
-- from` rather than `<>`, because both are nullable and `<>` against null is
-- null, which is not true, which is a check that never fires.
create or replace function public.guard_edit_job_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if current_setting('app.edit_job_rpc', true) = '1' then
    return new;
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
    or new.rating_note is distinct from old.rating_note
    or new.brand_name is distinct from old.brand_name
    or new.brand_logo_key is distinct from old.brand_logo_key
    or new.brand_logo_url is distinct from old.brand_logo_url
    or new.editor_name is distinct from old.editor_name
    or new.editor_avatar_url is distinct from old.editor_avatar_url then
    raise exception 'only the job owner can change the brief or the offer';
  end if;

  if new.status not in ('claimed', 'delivered') then
    raise exception 'editors can only move a job to claimed or delivered';
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------- refresh

/*
 * An editor changing their name or photo repaints the jobs they hold.
 *
 * Without this the stamp only moves when something else writes the job, so an
 * editor who uploads a photo mid-job stays a blank circle to the creator until
 * the next delivery. It touches the row and lets the stamp trigger above do the
 * actual work, so there is still exactly one place the value is computed.
 *
 * The `app.edit_job_rpc` flag is the sanctioned bypass the claim and release
 * rpcs already use: without it the guard sees an editor updating a job they do
 * not own and refuses on status alone. It is set transaction-local and put back
 * immediately, so it cannot leak onto a later statement and wave a real
 * tampering attempt through.
 *
 * Put back to what it WAS, not to '0'. Nothing today updates an `editors` row
 * inside a transaction that already holds the bypass, but the day something
 * does, resetting to '0' would close the bypass early and the next edit_jobs
 * write in that transaction would hit the guard as a stranger. That failure
 * would be miles from this function.
 *
 * The touch is `updated_at`, deliberately, not the two columns themselves. The
 * guard then sees them unchanged and passes on its own merits, so the bypass is
 * belt and braces rather than the only thing holding this up.
 */
create or replace function public.refresh_editor_stamp()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  prev text;
begin
  if new.name is not distinct from old.name
     and new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;

  prev := coalesce(current_setting('app.edit_job_rpc', true), '');
  perform set_config('app.edit_job_rpc', '1', true);
  update public.edit_jobs
     set updated_at = now()
   where editor_id = new.user_id;
  perform set_config('app.edit_job_rpc', prev, true);

  return new;
end;
$$;

drop trigger if exists refresh_editor_stamp on public.editors;
create trigger refresh_editor_stamp
after update on public.editors
for each row execute function public.refresh_editor_stamp();

-- ==== 20260821270000_editor_stripe_connect.sql
-- editors withdraw through stripe connect, as a second rail beside paypal.
--
-- The reason this is worth having, checked against the api rather than
-- remembered: the platform is a US stripe account with `transfers` active, and
-- GET /v1/country_specs/US lists 120 supported_transfer_countries. Against the
-- actual roster that is india, pakistan, indonesia, algeria, uae, spain, the
-- philippines, ireland and the us reachable, with brazil and nepal not. The
-- note in lib/payouts/paypal.ts said the opposite and was wrong.
--
-- It is a SECOND rail, not a replacement. Brazil and Nepal still need PayPal,
-- and stripe can only ever pay a bank account or a debit card, never a PayPal
-- or Cash App balance, so an editor without a local bank account stays on
-- PayPal too. The method on `editor_payout_details` is what chooses.
--
-- Nothing about the money-safety model moves. claim -> send -> settle is
-- provider agnostic already: `editor_payout_batches.provider` exists and
-- defaults to 'paypal', and `settle_payout_batch(p_batch, p_ref)` takes the
-- provider's reference as text, which a stripe `tr_...` fits unchanged.

-- ------------------------------------------------------------------ method

alter table public.editor_payout_details
  drop constraint if exists editor_payout_details_method_check;

alter table public.editor_payout_details
  add constraint editor_payout_details_method_check
  check (method in ('stripe', 'paypal', 'venmo', 'cashapp', 'wise', 'other'));

-- --------------------------------------------------------- connect accounts

/*
 * One Express account per editor.
 *
 * Deliberately NOT a column on `editor_payout_details`. `address` on that table
 * is a send-to address the founder reads and the editor types; an `acct_...` is
 * neither. Keeping them apart is also what stops a hand-rolled update from
 * pointing a payout at somebody else's connected account, because this table
 * grants no write to `authenticated` at all: the onboarding action and the
 * account.updated webhook write it with the service key, and the id they write
 * is one stripe just handed us rather than one that arrived on a form.
 */
create table if not exists public.editor_stripe_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id text not null unique,
  country text,
  -- straight off the stripe account object, refreshed by the webhook.
  details_submitted boolean not null default false,
  payouts_enabled boolean not null default false,
  transfers_active boolean not null default false,
  disabled_reason text,
  requirements_due jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.editor_stripe_accounts enable row level security;

revoke all on public.editor_stripe_accounts from anon, authenticated;
grant select on public.editor_stripe_accounts to authenticated;

drop policy if exists editor_stripe_accounts_own_read on public.editor_stripe_accounts;
create policy editor_stripe_accounts_own_read
  on public.editor_stripe_accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists editor_stripe_accounts_admin_read on public.editor_stripe_accounts;
create policy editor_stripe_accounts_admin_read
  on public.editor_stripe_accounts
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop trigger if exists touch_editor_stripe_accounts on public.editor_stripe_accounts;
create trigger touch_editor_stripe_accounts
before update on public.editor_stripe_accounts
for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------- claim

/*
 * Unchanged in shape and in every guarantee. The only new thing is WHERE the
 * destination comes from, and the provider it stamps on the batch.
 *
 * For stripe the destination is the connected account id, and it is only
 * handed out when stripe says `payouts_enabled`. Claiming against an account
 * that cannot be paid would take the money off the balance to send it into a
 * transfer stripe will refuse, which is a failed batch for no reason. Better to
 * refuse before the claim than to release it after.
 *
 * The advisory lock, the in-flight check, the cap and the stamping of
 * `editor_payouts.batch_id` are all exactly as they were. Do not reorder them:
 * the claim has to be committed before anything calls a payment api, because
 * the batch uuid is what makes that call idempotent.
 */
create or replace function public.claim_payout_batch(p_max_cents integer default 50000)
returns table(out_batch_id uuid, out_cents integer, out_method text, out_address text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_method text;
  v_address text;
  v_provider text;
  v_total integer;
  v_batch uuid;
  v_stripe record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  perform pg_advisory_xact_lock(hashtext('editor_payout'), hashtext(v_uid::text));

  if exists (
    select 1 from public.editor_payout_batches b
    where b.editor_id = v_uid and b.status = 'sending'
  ) then
    raise exception 'payout already in flight';
  end if;

  select d.method, d.address into v_method, v_address
  from public.editor_payout_details d
  where d.user_id = v_uid;

  if v_method = 'stripe' then
    v_provider := 'stripe';

    select a.account_id, a.payouts_enabled into v_stripe
    from public.editor_stripe_accounts a
    where a.user_id = v_uid;

    if v_stripe.account_id is null then
      raise exception 'stripe not connected';
    end if;
    if not v_stripe.payouts_enabled then
      raise exception 'stripe not ready';
    end if;

    v_address := v_stripe.account_id;
  else
    v_provider := 'paypal';
    if v_address is null or v_address = '' then
      raise exception 'no payout address';
    end if;
  end if;

  select coalesce(sum(p.amount_cents), 0) into v_total
  from public.editor_payouts p
  where p.editor_id = v_uid and p.status = 'due';

  if v_total <= 0 then
    raise exception 'nothing owed';
  end if;
  if v_total > p_max_cents then
    raise exception 'over the automatic limit';
  end if;

  insert into public.editor_payout_batches
    (editor_id, amount_cents, method, address, provider)
  values (v_uid, v_total, v_method, v_address, v_provider)
  returning id into v_batch;

  update public.editor_payouts p
  set batch_id = v_batch
  where p.editor_id = v_uid and p.status = 'due' and p.batch_id is null;

  return query select v_batch, v_total, v_method, v_address;
end;
$function$;

-- ==== 20260821270000_job_asset_kind.sql
-- a fourth file kind: 'asset'.
--
-- "footage" was doing two jobs at once. The talking head an editor actually
-- cuts and the pile of b-roll, music and product stills they cut it WITH are
-- different things to a person opening the job, even though they are the same
-- thing to storage. One list of nineteen files with no separation is the
-- editor's problem, not the creator's, which is exactly why it kept happening.
--
--   footage   the videos to edit. the raw talking head
--   asset     the bits that go on top: clips, audio, images
--   reference links only now, so nothing is uploaded under this kind
--   cut       what the editor sends back
--
-- Storage is untouched. The object path stays <job>/assets/<file> for
-- everything the creator uploads, and the storage policies key on that first
-- segment rather than on this column, so nothing about who can read what
-- moves.

alter table public.edit_job_files
  drop constraint if exists edit_job_files_kind_check;

alter table public.edit_job_files
  add constraint edit_job_files_kind_check
  check (kind in ('footage', 'asset', 'reference', 'cut'));

-- the insert policy decides which side may write which kind, so the new kind
-- has to be named there too or the creator's upload is refused by rls.
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (kind in ('footage', 'asset', 'reference') and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.user_id = (select auth.uid())
      ))
      or
      (kind = 'cut' and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.editor_id = (select auth.uid())
      ))
    )
  );

-- ==== 20260821280000_mark_paid_batch_guard.sql
-- the founder's "Mark paid" button and the automated rails can both settle the
-- same payout row, and until now nothing stopped them doing it at once.
--
-- The database inconsistency was never the danger: `settle_payout_batch` only
-- touches rows still 'due', so a hand-marked row is simply skipped. The danger
-- is two PEOPLE paying. An editor cashes out, stripe or paypal has the money
-- in flight, and the founder opens /founder/editors, sees a row that still
-- reads as owed, and sends it by hand as well. Nothing in either path could
-- see the other, so the editor gets paid twice and neither side is wrong.
--
-- The guard goes in the rpc rather than in the page because the rpc is the one
-- place both paths meet. A ui check would be advisory and would drift the
-- first time somebody adds a second button.

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

  -- an automated payout is already moving this money. refuse rather than
  -- race it: a batch resolves itself either way, to paid on settle or back
  -- to due on a definite refusal, and THEN this button is correct again.
  if exists (
    select 1
    from public.editor_payouts p
    join public.editor_payout_batches b on b.id = p.batch_id
    where p.id = p_id and b.status = 'sending'
  ) then
    raise exception 'a payout is already in flight for this row';
  end if;

  update public.editor_payouts
  set status = 'paid',
      paid_at = now(),
      -- 'manual' rather than null when the caller says nothing, so a row
      -- settled by hand is distinguishable from one a rail settled.
      paid_via = coalesce(p_via, paid_via, 'manual'),
      external_ref = coalesce(p_ref, external_ref)
  where id = p_id and status = 'due';
end;
$$;

revoke all on function public.mark_editor_payout_paid(uuid, text, text) from public, anon;
grant execute on function public.mark_editor_payout_paid(uuid, text, text) to authenticated;

-- ==== 20260822082832_client_review_links.sql
-- Client review links.
--
-- The gap this closes: a creator does not get to sign off on a cut. Their
-- campaign manager does. Until now the only approve button lived behind a
-- login the brand contact will never have, so the sign-off happened in a dm
-- and the job sat "delivered" until somebody remembered it.
--
-- So: one opaque link per job, `ugcflows.com/review/<token>`. Whoever holds it
-- watches the cuts, leaves feedback, and says approve or changes. That verdict
-- is a SIGNAL, never an action: the creator still taps approve in the
-- dashboard, because approving moves money and a stranger with a url must not
-- be able to spend it. Same for a change request, which the creator forwards,
-- because the included direction round is finite and costs them.
--
--   edit_job_review_links  one row per job, the token, revoke + rotate
--   edit_job_review_notes  every verdict and comment left on that link
--
-- Two security-definer rpcs are the whole public surface. Nothing on the
-- anonymous side gets a table policy, so the only rows a link holder can ever
-- reach are the ones the rpc hands back — no pay, no credits, no editor, no
-- brief. What the creator paid is the creator's business.

-- ---------------------------------------------------------------- the links

create table if not exists public.edit_job_review_links (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null unique references public.edit_jobs (id) on delete cascade,
  -- the job's owner, denormalised so every policy here is one hop, not two
  user_id uuid not null references auth.users (id) on delete cascade,

  -- the capability. stored plain, like a referral code: the creator has to be
  -- able to copy it again tomorrow, and rotating is what kills an old one.
  token text not null unique,

  -- the creator's own note on who is holding it: "acme campaign manager"
  label text,

  revoked_at timestamptz,
  expires_at timestamptz,

  views          integer not null default 0,
  last_viewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_job_review_links_user_idx
  on public.edit_job_review_links (user_id);

-- ---------------------------------------------------------------- the notes

create table if not exists public.edit_job_review_notes (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null references public.edit_jobs (id) on delete cascade,
  link_id uuid not null references public.edit_job_review_links (id) on delete cascade,

  -- which cut they were looking at, when they pointed at one. job-level
  -- feedback leaves it null. set null rather than cascade: the words survive
  -- the editor deleting a cut.
  deliverable_id uuid references public.edit_job_deliverables (id) on delete set null,
  -- the cut number frozen at the time, so the note still reads after that
  version integer not null default 0,

  verdict       text not null check (verdict in ('approved', 'changes', 'comment')),
  reviewer_name text,
  body          text,

  -- what the creator did with it: forwarded, approved past it, or dismissed.
  -- null is the inbox.
  handled_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_review_notes_job_idx
  on public.edit_job_review_notes (job_id, created_at desc);
create index if not exists edit_job_review_notes_link_idx
  on public.edit_job_review_notes (link_id, created_at desc);

-- ------------------------------------------------------------------- policies

alter table public.edit_job_review_links enable row level security;
alter table public.edit_job_review_notes enable row level security;

revoke all on public.edit_job_review_links from anon, authenticated;
revoke all on public.edit_job_review_notes from anon, authenticated;

grant select, insert, update, delete on public.edit_job_review_links to authenticated;
grant select, update, delete on public.edit_job_review_notes to authenticated;

-- the link is the creator's alone. the editor never needs the token: they read
-- the feedback through the notes below.
drop policy if exists review_links_own on public.edit_job_review_links;
create policy review_links_own on public.edit_job_review_links
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- the feedback reaches both sides of the job, because "the client wants the
-- hook shorter" is the editor's instruction and retyping it loses it.
drop policy if exists review_notes_select on public.edit_job_review_notes;
create policy review_notes_select on public.edit_job_review_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- only the creator files a note away, and only the creator can delete one.
drop policy if exists review_notes_handle on public.edit_job_review_notes;
create policy review_notes_handle on public.edit_job_review_notes
  for update to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  )
  with check (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  );

drop policy if exists review_notes_delete on public.edit_job_review_notes;
create policy review_notes_delete on public.edit_job_review_notes
  for delete to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  );

-- deliberately no insert policy. the rpc below is the only writer, the same
-- shape as account_email_messages: anything that could insert from a session
-- could forge its own client sign-off.

-- ------------------------------------------------------------------ the token

-- pgcrypto lives in `extensions` on supabase, so the pinned search_path has to
-- name it or gen_random_bytes stops resolving.
create or replace function public.new_review_token()
returns text
language sql
volatile
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

-- --------------------------------------------------------------- open a link

/**
 * Everything the review page renders, for a token, or a refusal.
 *
 * Security definer because the holder has no session and no policy could see
 * a token anyway. The projection IS the access control: the money columns, the
 * brief and the editor never appear in it. Bumps the view counter on the way
 * through, which is the creator's only signal that the link actually landed.
 */
create or replace function public.review_link_room(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.edit_job_review_links;
  v_job   public.edit_jobs;
  v_cuts  jsonb;
  v_notes jsonb;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into v_link from public.edit_job_review_links where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_job from public.edit_jobs where id = v_link.job_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  update public.edit_job_review_links
     set views = views + 1, last_viewed_at = now()
   where id = v_link.id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', d.id,
               'url', d.url,
               'note', d.note,
               'version', d.version,
               'created_at', d.created_at
             )
             order by d.version desc, d.created_at desc
           ),
           '[]'::jsonb
         )
    into v_cuts
    from public.edit_job_deliverables d
   where d.job_id = v_job.id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', n.id,
               'verdict', n.verdict,
               'reviewer_name', n.reviewer_name,
               'body', n.body,
               'version', n.version,
               'deliverable_id', n.deliverable_id,
               'created_at', n.created_at
             )
             order by n.created_at desc
           ),
           '[]'::jsonb
         )
    into v_notes
    from public.edit_job_review_notes n
   where n.link_id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'label', v_link.label,
    -- a job that is approved or cancelled is history: the page still shows the
    -- cuts, the buttons are gone.
    'closed', v_job.status in ('approved', 'cancelled'),
    'awaiting_cut', v_job.status in ('open', 'claimed'),
    'job', jsonb_build_object(
      'title', v_job.title,
      'brand_name', v_job.brand_name,
      'brand_logo_key', v_job.brand_logo_key,
      'brand_logo_url', v_job.brand_logo_url,
      'video_count', v_job.video_count,
      'status', v_job.status,
      'delivered_at', v_job.delivered_at,
      'approved_at', v_job.approved_at
    ),
    'cuts', v_cuts,
    'notes', v_notes
  );
end;
$$;

-- ------------------------------------------------------------- leave a verdict

/**
 * The one write an anonymous holder gets. Refuses on a dead link, a finished
 * job, an empty body where one is needed, and more than 20 notes an hour on
 * the same link, which is the whole rate limit and is plenty for one meeting.
 *
 * Returns the job id so the caller can notify. Deliberately does NOT return
 * the owner's user id or email: whoever holds this url is not entitled to know
 * who is on the other end of it beyond the brand already on the page.
 */
create or replace function public.review_link_say(
  p_token       text,
  p_verdict     text,
  p_name        text default null,
  p_body        text default null,
  p_deliverable uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link    public.edit_job_review_links;
  v_status  text;
  v_version integer := 0;
  v_recent  integer;
  v_id      uuid;
  v_name    text;
  v_body    text;
begin
  if p_verdict not in ('approved', 'changes', 'comment') then
    return jsonb_build_object('ok', false, 'reason', 'bad_verdict');
  end if;

  select * into v_link from public.edit_job_review_links where token = p_token;
  if not found or v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  select status into v_status from public.edit_jobs where id = v_link.job_id;
  if v_status is null or v_status in ('approved', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null and p_verdict <> 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'body_required');
  end if;
  v_name := left(v_name, 80);
  v_body := left(v_body, 2000);

  select count(*) into v_recent
    from public.edit_job_review_notes
   where link_id = v_link.id and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  -- a cut id from the form is only honoured if it is actually this job's
  if p_deliverable is not null then
    select version into v_version
      from public.edit_job_deliverables
     where id = p_deliverable and job_id = v_link.job_id;
    if v_version is null then
      p_deliverable := null;
      v_version := 0;
    end if;
  end if;

  if p_deliverable is null then
    select coalesce(max(version), 0) into v_version
      from public.edit_job_deliverables where job_id = v_link.job_id;
  end if;

  insert into public.edit_job_review_notes
    (job_id, link_id, deliverable_id, version, verdict, reviewer_name, body)
  values
    (v_link.job_id, v_link.id, p_deliverable, coalesce(v_version, 0),
     p_verdict, v_name, v_body)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'job_id', v_link.job_id);
end;
$$;

revoke all on function public.new_review_token() from public, anon, authenticated;
revoke all on function public.review_link_room(text) from public;
revoke all on function public.review_link_say(text, text, text, text, uuid) from public;

grant execute on function public.new_review_token() to authenticated;
grant execute on function public.review_link_room(text) to anon, authenticated;
grant execute on function public.review_link_say(text, text, text, text, uuid) to anon, authenticated;

-- ==== 20260822083826_review_token_search_path.sql
-- `new_review_token` shipped without a pinned search_path and the linter
-- called it. Pinned here rather than edited into the file above so the repo
-- matches the remote ledger, which already recorded both applies.
--
-- `extensions` has to be named: pgcrypto lives there on supabase, so a
-- search_path of just `public` makes gen_random_bytes stop resolving and the
-- function fails at call time rather than at create time.

create or replace function public.new_review_token()
returns text
language sql
volatile
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

revoke all on function public.new_review_token() from public, anon, authenticated;
grant execute on function public.new_review_token() to authenticated;

-- ==== 20260822085239_notifications.sql
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

-- ==== 20260823090000_workflow.sql
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

-- ==== 20260823210000_transcript_notes.sql
-- Notes on a saved transcript.
--
-- The script pane holds somebody else's words and Reset has to be able to put
-- the provider's original back, so a creator's own thinking cannot live in it:
-- "hook is too long, shoot this one outside" would be wiped by the button that
-- exists to undo a bad edit. A separate column is the whole fix.
--
-- Free text, never parsed, never shown to anyone else. Same rls as the row it
-- sits on, so nothing else here changes.

alter table public.transcripts
  add column if not exists notes text not null default '';

-- ==== 20260823230000_account_email_accounts_multi.sql
-- One address, as many accounts as the person actually made.
--
-- The unique (email_id, platform) was written on the belief that a signup form
-- refuses a second account on the same email, and that is not true on any of
-- the four platforms this tool exists for. What it actually did was cap an
-- address at one tiktok, so a creator running two handles for one brand had to
-- burn a second address to hold the second login.
--
-- The handle and the password already live per row, so nothing else has to
-- change: two rows on the same platform are two logins, which is what they are.
alter table public.account_email_accounts
  drop constraint if exists account_email_accounts_email_id_platform_key;

-- the unique index went with the constraint, and it was also the only index on
-- email_id. every read here is "the accounts on this address, oldest first".
create index if not exists account_email_accounts_email_idx
  on public.account_email_accounts (email_id, created_at);

-- ==== 20260823230000_deal_shelf.sql
-- The deal shelf, and uploads that happen before a job exists.
--
-- Two things a creator should never have to do twice. The first is upload the
-- same logo, the same three tracks and the same sfx pack for every batch they
-- send a brand. The second is retype the standing instructions that apply to
-- every video that brand ever gets. Both belong to the DEAL, not the job, and
-- both are the same shape: a file on a shelf that every job for that brand can
-- see. That shelf is `deal_assets`, and `kind` is the only thing separating a
-- track from an SOP.
--
-- The other half is the new job form. Uploading there means uploading before
-- the job it belongs to has an id, which the old path contract could not
-- express: `<job_id>/assets/<file>` needs the job. So there is a second prefix,
-- `user/<user_id>/<file>`, which belongs to the person rather than the job, and
-- the edit_job_files row is what later ties it to a job. Nothing is moved when
-- the job is posted: the row is the grant.
--
-- That inverts the access model for those objects, so it is worth being exact
-- about the hole it could open. If "a file row naming this path" were enough to
-- read an object, anyone could post a job, insert a row pointing at somebody
-- else's `user/` path, and read it. Two things close that: the select policy
-- also requires the object's own `owner_id` to match the row's uploader, and
-- the file insert policy requires the path to be under the job's folder or
-- under the uploader's own `user/` prefix.

-- --------------------------------------------------------------- deal_assets

create table if not exists public.deal_assets (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,

  -- `asset` is material that goes on top of a cut: logos, product shots,
  -- music, sfx. `doc` is words the editor reads before cutting: the SOP, the
  -- brand guidelines, the standing brief.
  kind text not null default 'asset' check (kind in ('asset', 'doc')),

  path       text not null unique,
  name       text not null,
  mime       text,
  size_bytes bigint,

  created_at timestamptz not null default now()
);

create index if not exists deal_assets_deal_idx
  on public.deal_assets (deal_id, kind, created_at desc);

alter table public.deal_assets enable row level security;

-- "a shelf I can see" is "a deal I can see". The subquery is itself subject to
-- the deals policies, so org scoping and the founder view come along for free
-- rather than being restated here and drifting.
drop policy if exists deal_assets_select on public.deal_assets;
create policy deal_assets_select on public.deal_assets
  for select to authenticated
  using (
    exists (select 1 from public.deals d where d.id = deal_id)
    -- the editor cannot see the deal, and must still be able to open the
    -- brand's SOP for a job they are actually working.
    or exists (
      select 1 from public.edit_jobs j
      where j.deal_id = deal_assets.deal_id
        and j.editor_id = (select auth.uid())
    )
  );

drop policy if exists deal_assets_insert on public.deal_assets;
create policy deal_assets_insert on public.deal_assets
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_assets_delete on public.deal_assets;
create policy deal_assets_delete on public.deal_assets
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.deals d where d.id = deal_id)
  );

-- ------------------------------------------------------------ edit_job_files

-- `doc` joins the three that were there. A brief is often a google doc export
-- or a pdf rather than something anybody wants to retype into a textarea.
alter table public.edit_job_files drop constraint if exists edit_job_files_kind_check;
alter table public.edit_job_files add constraint edit_job_files_kind_check
  check (kind in ('footage', 'asset', 'reference', 'doc', 'cut'));

-- the path guard described at the top. a row may only point at this job's own
-- folder or at the uploader's own user prefix, whatever the client sent.
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (
        kind in ('footage', 'asset', 'reference', 'doc')
        and (
          path like (job_id::text || '/assets/%')
          or path like ('user/' || (select auth.uid())::text || '/%')
        )
        and exists (
          select 1 from public.edit_jobs j
          where j.id = job_id and j.user_id = (select auth.uid())
        )
      )
      or (
        kind = 'cut'
        and (
          path like (job_id::text || '/cuts/%')
          or path like ('user/' || (select auth.uid())::text || '/%')
        )
        and exists (
          select 1 from public.edit_jobs j
          where j.id = job_id and j.editor_id = (select auth.uid())
        )
      )
    )
  );

-- --------------------------------------------------------------------- bucket

-- The type allowlist came off. It was video/* and image/*, which refuses
-- exactly the things this change is about: an sfx pack, a music bed, a pdf
-- brief, a zip of luts. The bucket is private and only a job's two people can
-- read it, so the 500mb per-file cap is the limit that matters.
update storage.buckets
   set allowed_mime_types = null
 where id = 'editing-assets';

-- ------------------------------------------------------------ storage policies

-- three prefixes now:
--   <job_id>/assets|cuts/<file>  the job's own, unchanged
--   user/<user_id>/<file>        uploaded before the job existed
--   bank/<deal_id>/<file>        the deal's shelf
drop policy if exists editing_assets_insert on storage.objects;
create policy editing_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'editing-assets'
    and (
      (
        (storage.foldername(name))[2] = 'assets'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.user_id = (select auth.uid())
        )
      )
      or (
        (storage.foldername(name))[2] = 'cuts'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.editor_id = (select auth.uid())
        )
      )
      or (
        (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      or (
        (storage.foldername(name))[1] = 'bank'
        and exists (
          select 1 from public.deals d
          where d.id::text = (storage.foldername(name))[2]
        )
      )
    )
  );

drop policy if exists editing_assets_select on storage.objects;
create policy editing_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'editing-assets'
    and (
      exists (
        select 1 from public.edit_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
      )
      -- my own uploads, whether or not they ever reached a job
      or (
        (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      -- somebody else's upload that is recorded on a job I am on. owner_id has
      -- to match the row's uploader or a forged row would be a read grant.
      or exists (
        select 1
        from public.edit_job_files f
        join public.edit_jobs j on j.id = f.job_id
        where f.path = storage.objects.name
          and f.uploader_id::text = storage.objects.owner_id
          and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
      )
      -- the deal's shelf: its owner, and the editor of any job on that deal
      or (
        (storage.foldername(name))[1] = 'bank'
        and (
          exists (
            select 1 from public.deals d
            where d.id::text = (storage.foldername(name))[2]
          )
          or exists (
            select 1 from public.edit_jobs j
            where j.deal_id::text = (storage.foldername(name))[2]
              and j.editor_id = (select auth.uid())
          )
        )
      )
    )
  );

drop policy if exists editing_assets_delete on storage.objects;
create policy editing_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'editing-assets'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.edit_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and j.user_id = (select auth.uid())
      )
      or (
        (storage.foldername(name))[1] = 'bank'
        and exists (
          select 1 from public.deals d
          where d.id::text = (storage.foldername(name))[2]
        )
      )
    )
  );

-- ==== 20260824000000_autopost_batches.sql
-- Autoposting becomes a batch a creator builds by hand.
--
-- What it replaces: a cadence on the deal (`posting_quota` / `posting_period`)
-- that worked out the times itself. That is the wrong shape for this job. A
-- creator with nine delivered cuts does not want "three a day starting
-- tomorrow" computed for them and then fought with; they want to see the nine,
-- pick the order, write the captions, choose the accounts, and then be handed a
-- schedule they can drag. The cadence columns are left on `deals` and the code
-- that read them is commented rather than deleted, because the numbers are
-- still what a brand contract says and the auto path may come back as a "fill
-- these times for me" button on top of this.
--
-- Six columns, and each one is something the wizard collects that the table had
-- nowhere to put:
--
--   batch_id     one run of the wizard. the planner groups by it, and cancelling
--                "that batch I just scheduled" is one delete rather than nine.
--   video_name   what to call the clip on screen. video_url is a signed storage
--                url or an editor's link, and neither is a name a person reads.
--   hashtags     kept apart from `caption` on purpose. the caption is per clip
--                and the tags are per batch, so appending them at post time is
--                what lets the tag list be edited once and re-rendered on every
--                row without touching nine captions.
--   options      per platform posting settings (tiktok privacy and duet/stitch,
--                instagram share-to-feed and collaborator, youtube visibility
--                and category). shaped `{ tiktok: {...}, instagram: {...} }`,
--                and jsonb rather than columns because every platform's list
--                changes on its own schedule and none of it is ever filtered on.
--   source_kind  'editor' (a delivered cut) or 'upload' (a file the creator
--   source_ref   picked). the ref is the deliverable id or the storage path, so
--                a posted clip can be traced back to the job that made it.
--
-- `deal_post_presets` is the other half: the tag list and the platform settings
-- a brand always uses, saved once. Read on every new batch for that deal.

alter table public.social_posts
  add column if not exists batch_id    uuid,
  add column if not exists video_name  text,
  add column if not exists hashtags    text[] not null default '{}',
  add column if not exists options     jsonb  not null default '{}'::jsonb,
  add column if not exists source_kind text,
  add column if not exists source_ref  text;

alter table public.social_posts drop constraint if exists social_posts_source_kind_check;
alter table public.social_posts add constraint social_posts_source_kind_check
  check (source_kind is null or source_kind in ('editor', 'upload'));

-- the planner reads one batch at a time; the calendar reads a date window.
create index if not exists social_posts_batch_idx
  on public.social_posts (user_id, batch_id);
create index if not exists social_posts_schedule_idx
  on public.social_posts (user_id, scheduled_for)
  where scheduled_for is not null;

-- ------------------------------------------------------------------ presets

create table if not exists public.deal_post_presets (
  deal_id    uuid primary key references public.deals (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  hashtags   text[] not null default '{}',
  options    jsonb  not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.deal_post_presets enable row level security;

-- "a preset I can see" is "a deal I can see". the subquery is itself subject to
-- the deals policies, so org scoping comes along rather than being restated.
drop policy if exists deal_post_presets_select on public.deal_post_presets;
create policy deal_post_presets_select on public.deal_post_presets
  for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

drop policy if exists deal_post_presets_write on public.deal_post_presets;
create policy deal_post_presets_write on public.deal_post_presets
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_post_presets_update on public.deal_post_presets;
create policy deal_post_presets_update on public.deal_post_presets
  for update to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id))
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_post_presets_delete on public.deal_post_presets;
create policy deal_post_presets_delete on public.deal_post_presets
  for delete to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

drop trigger if exists touch_deal_post_presets on public.deal_post_presets;
create trigger touch_deal_post_presets
  before update on public.deal_post_presets
  for each row execute function public.touch_updated_at();

-- ==== 20260824010000_audio_library.sql
-- The shared audio library: one bank of background music and sfx that the
-- whole product reads and nobody but staff writes.
--
-- Every other bucket in this product belongs to somebody. `variations` is
-- scoped to the uploader's uid, `editing-assets` to a job's two people,
-- `deal_assets` to a deal. This one is the opposite shape on purpose: it is the
-- house's own material, uploaded once from `scripts/audio-library.mjs`, and
-- every signed-in person gets exactly the same read of it. So there is no
-- user_id column and no insert or update policy at all. Writes happen with the
-- service key or they do not happen, which is a stronger guarantee than a
-- policy naming an admin table, and it means a compromised session cannot
-- quietly swap a track ninety creators are dragging into videos.
--
-- Two surfaces read it. The variations tool copies a picked track into the
-- caller's own `variations` folder (see addFromAudioLibrary) rather than
-- pointing a render at this bucket, which keeps the renderer's single-bucket
-- assumption intact and means deleting a library track never breaks a batch
-- somebody already built. The editors page hands out the same files as zips.
--
-- `peaks` is the waveform, pre-computed at ingest as 64 rms buckets scaled
-- 0..100. A browser CAN draw this itself, but only by decoding the mp3, and a
-- grid of 140 rows decoding 400mb to draw 140 little bar charts is not a page.

-- --------------------------------------------------------------- audio_assets

create table if not exists public.audio_assets (
  id   uuid primary key default gen_random_uuid(),

  -- `music` is a bed that runs under a whole cut. `sfx` is a one-shot that
  -- lands on a beat. They are browsed separately because they are picked at
  -- different moments, so the split is a column and not a tag.
  kind text not null check (kind in ('music', 'sfx')),

  -- the mood folder for music ('upbeat', 'cinematic', …), the use for sfx
  -- ('transition', 'impact', 'meme', 'ui', 'riser'). Free text on purpose:
  -- adding a mood is a new folder on the founder's disk, not a migration.
  category text not null,

  title text not null,
  slug  text not null,

  -- path inside the public `audio-library` bucket, always a 192k mp3.
  storage_path text not null,

  duration_ms int    not null default 0,
  bytes       bigint not null default 0,

  tags  text[] not null default '{}',

  -- 64 rms buckets, 0..100. see the header.
  peaks smallint[] not null default '{}',

  -- the order the ingest saw them in, so the grid is stable between runs
  -- rather than reshuffling every time a row is touched.
  sort_order int not null default 0,

  -- pulling a track is a flag, never a delete: a creator may already have a
  -- copy of it in a bank, and a row that vanishes makes that copy unexplainable.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  unique (kind, slug)
);

create index if not exists audio_assets_browse_idx
  on public.audio_assets (kind, category, sort_order)
  where active;

alter table public.audio_assets enable row level security;

-- Everybody signed in sees the whole bank. There is nothing per-person in it,
-- and gating it on a subscription would mean the variations tool's sound picker
-- being empty for the exact people the tool is sold to.
drop policy if exists audio_assets_select on public.audio_assets;
create policy audio_assets_select on public.audio_assets
  for select to authenticated
  using (active);

-- No insert, update or delete policy. With rls on, that is a refusal for every
-- role except the service key, which is what the ingest script uses.

-- --------------------------------------------------------------------- bucket

-- Public read, like `variations` and for the same reason: these are files an
-- audio element seeks around in and a browser caches. Signed urls would mean
-- re-minting 140 of them on every render of the library page, and re-minting
-- one mid-scrub when the hour ran out.
--
-- 500mb matches the `variations` cap. The per-mood zip packs are the only
-- objects here that get near it; the mp3s are single digit megabytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio-library',
  'audio-library',
  true,
  524288000,
  array['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'application/zip']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A public bucket serves an object by url with no policy, but LISTING one still
-- needs select. The editors page lists `kits/` to show which packs exist and how
-- big they are, so grant the read that the urls already imply.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'audio_library_read'
  ) then
    create policy audio_library_read on storage.objects
      for select to public
      using (bucket_id = 'audio-library');
  end if;
end $$;

-- ==== 20260824020000_audio_kits.sql
-- The download packs that go with the shared audio library.
--
-- A catalogue row rather than a convention over object names, for one reason
-- the storage limit forced: this project refuses an upload over 50mb, and the
-- cinematic mood is 133mb of mp3, so a mood is not one zip. It is however many
-- standalone zips fit under the cap, and how many that is depends on what is in
-- the folder that week. Parsing `music-cinematic-2.zip` back into "cinematic,
-- part 2 of 3" is guesswork the ingest already knows the answer to, so it
-- writes the answer down.
--
-- Same write model as `audio_assets`: select to anyone signed in, no insert or
-- update policy at all, so the service key in scripts/audio-library.mjs is the
-- only thing that can change what the packs are.

create table if not exists public.audio_kits (
  -- the object name under `kits/` in the audio-library bucket. it is the
  -- identity: two rows naming the same file is not a thing that can be true.
  file text primary key,

  kind text not null check (kind in ('music', 'sfx')),

  -- the mood this pack holds, or null for the sfx pack which holds all of them.
  category text,

  -- what the button says, including "3 of 4" when the mood needed splitting.
  label text not null,

  tracks int    not null default 0,
  bytes  bigint not null default 0,

  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists audio_kits_order_idx on public.audio_kits (sort_order);

alter table public.audio_kits enable row level security;

drop policy if exists audio_kits_select on public.audio_kits;
create policy audio_kits_select on public.audio_kits
  for select to authenticated
  using (true);

-- ==== 20260824030000_variation_audio_roles.sql
-- What a sound DOES to a video, which until now had exactly one answer.
--
-- `replaceAudio` maps the picked track over the clip's own audio and loops it
-- forever. That is right for one case and one case only: a trending sound
-- pulled off a tiktok, where the sound IS the video. It is wrong for both
-- halves of the house bank that just landed.
--
--   a music bed under a voiceover  -> replace deletes the voiceover
--   a whoosh on the hook/demo cut  -> replace loops the whoosh for 20 seconds
--
-- So a sound now carries a role.
--
--   replace  the sound is the audio. today's behaviour, and the default, so
--            every component that already exists keeps doing what it did.
--   bed      mixed UNDER the clip's own audio at `audio_gain`. the voiceover
--            survives and the music sits behind it.
--   sting    played once, landing on the hook/demo seam. not looped.
--
-- `audio_gain` is only really a question for a bed: "the music is too loud over
-- my voice" is the complaint that has no other fix, and the right level depends
-- on how loud the person filmed themselves. 0.18 is roughly -15dB, which is
-- where a bed sits under speech.
--
-- ---------------------------------------------------------------- the sting
--
-- A sting is deliberately NOT a fifth axis on the batch. Nobody a/b tests two
-- whooshes; they pick one and it goes on all forty renders. An axis would
-- multiply the batch by the number of sfx picked, which is the opposite of what
-- anybody meant. So it is one nullable id on the batch, stamped onto every
-- render it produced, exactly like the text snapshot next to it.
--
-- This is also why `audio_id` and `sfx_id` are two columns rather than one
-- repeated: a render wants a bed AND a whoosh at the same time, and "music plus
-- a transition" is the single most ordinary thing an editor does.

-- ------------------------------------------------------- variation_components

alter table public.variation_components
  add column if not exists audio_role text not null default 'replace';

alter table public.variation_components
  drop constraint if exists variation_components_audio_role_check;
alter table public.variation_components
  add constraint variation_components_audio_role_check
  check (audio_role in ('replace', 'bed', 'sting'));

alter table public.variation_components
  add column if not exists audio_gain numeric not null default 1;

alter table public.variation_components
  drop constraint if exists variation_components_audio_gain_check;
alter table public.variation_components
  add constraint variation_components_audio_gain_check
  check (audio_gain > 0 and audio_gain <= 2);

-- the sting picker reads this, and on a bank with forty sounds in it the
-- partial index is the difference between a scan and a lookup.
create index if not exists variation_components_sting_idx
  on public.variation_components (brand_id, created_at desc)
  where kind = 'audio' and audio_role = 'sting';

-- --------------------------------------------------------- batches + renders

-- on delete set null, like the four ids already there: pulling a sound out of
-- the bank must not delete the record of the videos it was used on.
alter table public.variation_batches
  add column if not exists sfx_id uuid
  references public.variation_components (id) on delete set null;

alter table public.variation_batches
  add column if not exists sfx_title text;

alter table public.variation_renders
  add column if not exists sfx_id uuid
  references public.variation_components (id) on delete set null;

-- ==== 20260824040000_brand_catalog_websites.sql
-- Websites and logos for the brands already on file.
--
-- The catalogue in lib/brand-catalog.ts grew from 27 entries to 49 and every
-- entry now carries the brand's own domain and site. New brands pick both up
-- when they are written (resolveBrand in lib/deal-intake.ts). Brands saved
-- before that are sitting there with a letter for a logo and a blank url, and
-- this is the one pass that fixes them.
--
-- Fills blanks only. A brand carrying an uploaded logo_url keeps it and is not
-- given a key; a brand with a website typed in keeps that url. Matching is the
-- same slug rule brandSlug() uses in the app: lowercased, punctuation and
-- spaces removed, so "Wispr Flow", "wisprflow" and "wispr-flow" are one brand.

with catalog(slug, logo_key, website) as (
  values
    ('anara', 'anara', 'https://anara.com'),
    ('asmi', 'asmi', 'https://www.asmiai.com'),
    ('atom', 'atom', 'https://atom.new'),
    ('based', 'based', null),
    ('biggerz', 'biggerz', 'https://biggerz.com'),
    ('blueprint', 'blueprint', 'https://blueprint.io'),
    ('blustu', 'blustu', 'https://blustu.agency'),
    ('breadwinners', 'breadwinners', 'https://www.breadwinnersclub.com'),
    ('calai', 'cal-ai', 'https://www.calai.app'),
    ('candle', 'candle', 'https://www.trycandle.app'),
    ('cantina', 'cantina', 'https://cantina.com'),
    ('codedex', 'codedex', 'https://www.codedex.io'),
    ('coderabbit', 'coderabbit', 'https://www.coderabbit.ai'),
    ('composio', 'composio', 'https://composio.dev'),
    ('folk', 'folk', 'https://www.folk.app'),
    ('gizmo', 'gizmo', 'https://gizmo.ai'),
    ('higgsfield', 'higgsfield', 'https://higgsfield.ai'),
    ('hyperknow', 'hyperknow', 'https://hyperknow.com'),
    ('invo', 'invo', 'https://invoapp.com'),
    ('involio', 'invo', 'https://invoapp.com'),
    ('jobright', 'jobright', 'https://jobright.ai'),
    ('klypr', 'klypr', 'https://klypr.app'),
    ('tryklypr', 'klypr', 'https://klypr.app'),
    ('kreaai', 'krea-ai', 'https://krea.ai'),
    ('launchpoint', 'launchpoint', 'https://www.launchpointhq.com'),
    ('liftoff', 'liftoff', 'https://liftoff.ai'),
    ('lotus', 'lotus', 'https://lotus.app'),
    ('lovable', 'lovable', 'https://lovable.dev'),
    ('loveable', 'lovable', 'https://lovable.dev'),
    ('manus', 'manus', 'https://manus.im'),
    ('mathgpt', 'mathgpt', 'https://math-gpt.org'),
    ('medeo', 'medeo', 'https://www.medeo.app'),
    ('meshyai', 'meshy-ai', 'https://meshy.ai'),
    ('modo', 'modo', 'https://modo.us'),
    ('mosaic', 'mosaic', 'https://motion.so'),
    ('motion', 'mosaic', 'https://motion.so'),
    ('newwave', 'new-wave', 'https://new-wave.ai'),
    ('nook', 'nook', 'https://nookapp.xyz'),
    ('openart', 'open-art', 'https://openart.ai'),
    ('phrasly', 'phrasly', 'https://phrasly.ai'),
    ('pineai', 'pine-ai', 'https://pine.ai'),
    ('plutus', 'plutus', 'https://growwithplutus.com'),
    ('polsia', 'polsia', 'https://polsia.com'),
    ('polymarket', 'polymarket', 'https://polymarket.com'),
    ('pumpfun', 'pumpfun', 'https://pump.fun'),
    ('qotify', 'qotify', 'https://www.qotify.io'),
    ('replit', 'replit', 'https://replit.com'),
    ('spyglass', 'spyglass', 'https://spyglass.so'),
    ('tinynature', 'tiny-nature', 'https://tinynature.com'),
    ('turboai', 'turbo-ai', 'https://turbo.ai'),
    ('wellspoken', 'wellspoken', 'https://www.wellspoken.me'),
    ('wisprflow', 'wispr-flow', 'https://wisprflow.ai'),
    ('zo', 'zo', 'https://www.zo.computer')
)
update public.brands b
set
  -- an uploaded mark is the creator saying "this one", so it is never given a
  -- catalogue key on top of it.
  logo_key = case
    when b.logo_key is null and b.logo_url is null then c.logo_key
    else b.logo_key
  end,
  website = coalesce(nullif(btrim(b.website), ''), c.website),
  updated_at = now()
from catalog c
where lower(regexp_replace(b.name, '[^a-zA-Z0-9]', '', 'g')) = c.slug
  and (
    (b.logo_key is null and b.logo_url is null and c.logo_key is not null)
    or (nullif(btrim(b.website), '') is null and c.website is not null)
  );

-- ==== 20260824100000_turnaround_36_18.sql
-- turnaround goes 24h -> 36h, and the rush goes 6h -> 18h.
--
-- the old pair was a promise the editor pool cannot keep on a job posted at
-- 11pm: 6 hours means somebody is cutting through the night, and a missed sla
-- releases the claim, which costs the creator a day rather than saving one.
-- 36/18 is the same shape (rush is half the standard clock) at hours a person
-- can actually work.
--
-- only `claim_edit_job` writes `sla_at`, so this function is the whole change
-- on the database side. jobs already claimed keep the deadline they were given:
-- an editor who agreed to a 24 hour clock must not have it moved under them,
-- in either direction.

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

  v_cap := case v_editor.tier when 1 then 2 when 2 then 5 else 10 end;

  select count(*) into v_open_claims
  from public.edit_jobs
  where editor_id = v_uid and status in ('claimed', 'revisions');

  if v_open_claims >= v_cap then
    raise exception 'claim cap';
  end if;

  v_hours := case when v_job.is_rush then 18 else 36 end;

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

