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
