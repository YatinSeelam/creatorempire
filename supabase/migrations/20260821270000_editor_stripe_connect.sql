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
