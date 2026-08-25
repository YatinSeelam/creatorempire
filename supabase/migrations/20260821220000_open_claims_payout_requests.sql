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
