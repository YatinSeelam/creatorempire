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
