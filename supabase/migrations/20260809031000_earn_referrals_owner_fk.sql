-- The ledger hangs off `affiliates`, not off `auth.users`.
--
-- As first written, deleting an affiliate row left its clicks, referrals,
-- commissions and payouts standing with nothing pointing at them. The stats
-- view starts from `affiliates`, so those rows became invisible while still
-- being money somebody was owed. Pointing the owner column at the affiliate
-- itself means there is no orphan state to reason about: either the programme
-- membership exists and its ledger with it, or neither does.
--
-- Account deletion still cascades the whole way down, because `affiliates`
-- itself is `references auth.users (id) on delete cascade`.
--
-- A member who breaks the rules is set to status 'blocked'. Nothing in the app
-- deletes an affiliate, and `authenticated` has no delete grant on the table.

alter table public.referral_clicks
  drop constraint if exists referral_clicks_affiliate_user_id_fkey,
  add constraint referral_clicks_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.referrals
  drop constraint if exists referrals_affiliate_user_id_fkey,
  add constraint referrals_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.referral_commissions
  drop constraint if exists referral_commissions_affiliate_user_id_fkey,
  add constraint referral_commissions_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;

alter table public.affiliate_payouts
  drop constraint if exists affiliate_payouts_affiliate_user_id_fkey,
  add constraint affiliate_payouts_affiliate_user_id_fkey
    foreign key (affiliate_user_id) references public.affiliates (user_id) on delete cascade;
