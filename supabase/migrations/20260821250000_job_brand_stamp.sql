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
