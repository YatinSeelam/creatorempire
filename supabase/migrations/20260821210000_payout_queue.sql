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
