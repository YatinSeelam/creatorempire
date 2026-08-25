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
