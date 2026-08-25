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
