-- The referral programme. A member turns their link on, posts it, and gets a
-- share of every payment the people who signed up on it make.
--
-- Five tables, in the order one referral moves through them:
--
--   affiliates            one row per member who has turned their link on
--   referral_clicks       somebody opened /r/<code>. a counter, not a person
--   referrals             one row per ACCOUNT that signed up on a link
--   referral_commissions  one row per PAYMENT, so a recurring share is a row a month
--   affiliate_payouts     what we actually sent them, and when
--
-- Money is an integer of cents end to end, the same as the deal tracker. The
-- rate is stored in basis points ON the commission row rather than read from
-- config when a payout is cut: the programme's terms will change, and a share
-- already earned must not silently re-price itself six months later.
--
-- Nothing in here needs a cron. "pending" versus "ready to pay" is a date
-- comparison in the view, not a status somebody has to remember to flip.

-- ---------------------------------------------------------------- affiliates

create table if not exists public.affiliates (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- the code in the link. lowercase, url safe, and never rewritten once
  -- claimed: it is sitting in a tiktok bio and a pinned comment, so changing
  -- it would break links other people already posted.
  code text not null unique
    check (code ~ '^[a-z0-9][a-z0-9-]{2,31}$'),

  status text not null default 'active'
    check (status in ('active', 'paused', 'blocked')),

  -- where the money goes. four strings rather than a lookup table, because a
  -- lookup table for four strings is a join nobody wanted.
  payout_method text check (payout_method in ('paypal', 'wise', 'bank', 'other')),
  payout_email text,
  payout_note text,

  -- who this member is inside whatever affiliate platform gets wired up later
  -- (rewardful, tolt, partnerstack). null for as long as we are the platform,
  -- and the one column an external tool needs to key against.
  external_id text,

  terms_agreed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- clicks

create table if not exists public.referral_clicks (
  id bigint generated always as identity primary key,
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,

  -- where the link pointed, and which site it came off. both exist to answer
  -- the member's own "which post is actually working" question. no ip, no user
  -- agent and no cookie id is stored here, deliberately: this table is a
  -- counter and it should never become a log of people.
  landing_path text,
  referrer_host text,

  created_at timestamptz not null default now()
);

create index if not exists referral_clicks_owner_idx
  on public.referral_clicks (affiliate_user_id, created_at desc);

-- ---------------------------------------------------------------- referrals

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  code text not null,

  -- one attribution per account, and the FIRST link wins. the unique
  -- constraint is the whole rule: a second visit on somebody else's link
  -- cannot move a signup onto a different member's ledger later.
  referred_user_id uuid not null unique references auth.users (id) on delete cascade,
  referred_email text,

  status text not null default 'signed_up'
    check (status in ('signed_up', 'active', 'canceled', 'void')),

  first_paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- nobody earns a commission on their own signup
  constraint referrals_not_self check (referred_user_id <> affiliate_user_id)
);

create index if not exists referrals_owner_idx
  on public.referrals (affiliate_user_id, created_at desc);

-- ------------------------------------------------------------------ payouts

-- declared before commissions because a commission points at the payout that
-- settled it.
create table if not exists public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents bigint not null default 0,
  method text,
  reference text,
  status text not null default 'due'
    check (status in ('due', 'sent', 'paid', 'failed')),
  sent_on date,
  paid_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists affiliate_payouts_owner_idx
  on public.affiliate_payouts (affiliate_user_id, created_at desc);

-- -------------------------------------------------------------- commissions

create table if not exists public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null references auth.users (id) on delete cascade,
  referral_id uuid not null references public.referrals (id) on delete cascade,

  -- the invoice this share came off, and the entire idempotency story. stripe
  -- retries an event for three days, and a webhook that paid a commission
  -- twice is real money out the door.
  stripe_invoice_id text unique,

  gross_cents bigint not null default 0,
  -- basis points. 5000 is 50%. frozen at the moment it was earned.
  rate_bps integer not null,
  amount_cents bigint not null default 0,
  currency text not null default 'usd',

  -- the day it stops being clawback-able. a refund inside that window voids
  -- the row rather than subtracting from a later one.
  mature_on date not null,

  status text not null default 'pending'
    check (status in ('pending', 'paid', 'void')),

  payout_id uuid references public.affiliate_payouts (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists referral_commissions_owner_idx
  on public.referral_commissions (affiliate_user_id, created_at desc);

create index if not exists referral_commissions_referral_idx
  on public.referral_commissions (referral_id, created_at desc);

-- ------------------------------------------------------------- updated_at

drop trigger if exists touch_affiliates on public.affiliates;
create trigger touch_affiliates before update on public.affiliates
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_referrals on public.referrals;
create trigger touch_referrals before update on public.referrals
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_affiliate_payouts on public.affiliate_payouts;
create trigger touch_affiliate_payouts before update on public.affiliate_payouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- the numbers

-- Every figure the Earn page prints, as one row. `security_invoker` means rls
-- on the base tables is what scopes it, so this view needs no user argument
-- and cannot leak another member's ledger.
--
-- "pending" versus "ready" is `mature_on` against today rather than a stored
-- status, which is what keeps the whole feature cron-free.
create or replace view public.affiliate_stats
with (security_invoker = true) as
select
  a.user_id,
  a.code,

  (select count(*) from public.referral_clicks c
    where c.affiliate_user_id = a.user_id) as clicks,

  (select count(*) from public.referrals r
    where r.affiliate_user_id = a.user_id and r.status <> 'void') as signups,

  (select count(*) from public.referrals r
    where r.affiliate_user_id = a.user_id and r.status = 'active') as active_referrals,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id
      and m.status = 'pending' and m.mature_on > current_date) as pending_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id
      and m.status = 'pending' and m.mature_on <= current_date) as ready_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id and m.status = 'paid') as paid_cents,

  (select coalesce(sum(m.amount_cents), 0) from public.referral_commissions m
    where m.affiliate_user_id = a.user_id and m.status <> 'void') as lifetime_cents,

  -- what next month looks like if nobody cancels: the newest commission on
  -- every referral that is still paying. an active referral that has not been
  -- billed yet contributes nothing rather than an invented number.
  (select coalesce(sum(latest.amount_cents), 0)
     from public.referrals r
     cross join lateral (
       select m.amount_cents
         from public.referral_commissions m
        where m.referral_id = r.id and m.status <> 'void'
        order by m.created_at desc
        limit 1
     ) latest
    where r.affiliate_user_id = a.user_id and r.status = 'active') as run_rate_cents

from public.affiliates a;

-- -------------------------------------------------------------------- grants

-- Default privileges in supabase hand `all` on a new public table to anon and
-- authenticated, which would let a member set their own status or write their
-- own commission rows. Everything is revoked and handed back one column at a
-- time instead.

revoke all on public.affiliates from anon, authenticated;
grant select on public.affiliates to authenticated;
-- claiming a link is the only insert, and it may only carry these two columns.
-- status, external_id and the payout fields are not on it.
grant insert (user_id, code, terms_agreed_at) on public.affiliates to authenticated;
-- the code is absent here on purpose: it is immutable once claimed.
grant update (payout_method, payout_email, payout_note) on public.affiliates to authenticated;

revoke all on public.referral_clicks from anon, authenticated;
grant select on public.referral_clicks to authenticated;

revoke all on public.referrals from anon, authenticated;
grant select on public.referrals to authenticated;

revoke all on public.referral_commissions from anon, authenticated;
grant select on public.referral_commissions to authenticated;

revoke all on public.affiliate_payouts from anon, authenticated;
grant select on public.affiliate_payouts to authenticated;

grant select on public.affiliate_stats to authenticated;

-- ----------------------------------------------------------------------- rls

alter table public.affiliates enable row level security;
drop policy if exists own_row on public.affiliates;
create policy own_row on public.affiliates for select to authenticated
  using (user_id = auth.uid());
drop policy if exists claim_own on public.affiliates;
create policy claim_own on public.affiliates for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists update_own on public.affiliates;
create policy update_own on public.affiliates for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.referral_clicks enable row level security;
drop policy if exists own_rows on public.referral_clicks;
create policy own_rows on public.referral_clicks for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.referrals enable row level security;
-- the affiliate sees the row. the person referred deliberately does not: it is
-- somebody else's ledger, and it carries their commission terms.
drop policy if exists own_rows on public.referrals;
create policy own_rows on public.referrals for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.referral_commissions enable row level security;
drop policy if exists own_rows on public.referral_commissions;
create policy own_rows on public.referral_commissions for select to authenticated
  using (affiliate_user_id = auth.uid());

alter table public.affiliate_payouts enable row level security;
drop policy if exists own_rows on public.affiliate_payouts;
create policy own_rows on public.affiliate_payouts for select to authenticated
  using (affiliate_user_id = auth.uid());

-- ------------------------------------------------------------------ the rpcs

-- Two writes happen from outside the owner's own session, so both are
-- `security definer` with a pinned search_path rather than a service key. That
-- keeps the whole feature working on a deploy that has never been given
-- SUPABASE_SECRET_KEY, and it keeps the rls-bypassing surface down to these
-- two functions instead of a client that can touch every table.

-- Somebody opened /r/<code>. Callable by anon, because most clicks are.
--
-- No dedupe: without storing something that identifies the visitor there is
-- nothing to dedupe against, and storing that is worse than a soft number.
-- Treat clicks as a trend, never as a count to pay against.
create or replace function public.record_referral_click(
  p_code text,
  p_path text default null,
  p_referrer text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select user_id into v_owner
    from public.affiliates
   where code = lower(p_code) and status = 'active';

  if v_owner is null then
    return;
  end if;

  insert into public.referral_clicks (affiliate_user_id, code, landing_path, referrer_host)
  values (v_owner, lower(p_code), left(p_path, 200), left(p_referrer, 120));
end;
$$;

revoke all on function public.record_referral_click(text, text, text) from public;
grant execute on function public.record_referral_click(text, text, text) to anon, authenticated;

-- Attach the caller's brand new account to the link they arrived on.
--
-- Called once, from the auth callback, with the code off the referral cookie.
-- Returns whether an attribution was actually made, so the caller can clear
-- the cookie either way and never try twice.
create or replace function public.attach_referral(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then
    return false;
  end if;

  select user_id into v_owner
    from public.affiliates
   where code = lower(p_code) and status = 'active';

  -- unknown code, a paused programme, or somebody clicking their own link
  if v_owner is null or v_owner = v_uid then
    return false;
  end if;

  insert into public.referrals (affiliate_user_id, code, referred_user_id, referred_email)
  select v_owner, lower(p_code), v_uid, u.email
    from auth.users u
   where u.id = v_uid
  on conflict (referred_user_id) do nothing;

  -- false when the account was already attributed. first link wins.
  return found;
end;
$$;

revoke all on function public.attach_referral(text) from public;
grant execute on function public.attach_referral(text) to authenticated;
