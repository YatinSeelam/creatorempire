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
