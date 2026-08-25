-- A hand-set payment for one cut, overriding what the deal's rules computed.
--
-- The rules answer "what did this earn" correctly for the deal as written, and
-- that is still the default on every row. This column is for the times the deal
-- as written is not what was agreed: a brand paid a flat $50 for one hero post,
-- a cut was reshot and only paid once, a rate was renegotiated mid-campaign.
-- Without it the only lever was `counts`, which is all or nothing.
--
-- null means "use the computed amount" and is the state of every existing row.
-- 0 is a real answer and is not the same as null: it means somebody looked at
-- this post and decided it pays nothing, which is different from a rule that
-- happens to compute zero today and may not tomorrow.
--
-- Stored per video, written to every video of a cut with the same value. The
-- posts table is one row per cut, so the amount somebody types is the amount for
-- that row; reading it off the cut's lead video is what makes the row's number
-- the number they typed rather than a share of it.
--
-- Nothing in the sync touches this. The video upsert builds its `on conflict`
-- update from the keys in its payload and this is not one of them, the same
-- reason a nightly run cannot un-tick `counts` or clear `content_group`.
alter table public.videos
  add column if not exists payment_override_cents integer;

alter table public.videos
  drop constraint if exists videos_payment_override_cents_nonneg;

alter table public.videos
  add constraint videos_payment_override_cents_nonneg
  check (payment_override_cents is null or payment_override_cents >= 0);

comment on column public.videos.payment_override_cents is
  'Hand-set payment for this cut in cents, overriding the computed base + bonus. null = use the computed amount. Written to every video of a cut, read off the lead.';

-- the deal page reads these one deal at a time and only needs the rows that have
-- one, which is a handful out of a creator''s whole history.
create index if not exists videos_payment_override_idx
  on public.videos (deal_id)
  where payment_override_cents is not null;
