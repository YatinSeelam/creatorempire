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
