-- How much work a deal actually asks for, so the app can say what a cadence is
-- worth before the videos exist.
--
-- Quantity plus period rather than one videos-per-day number: a rate sheet says
-- "4 a week", never "0.571 a day", and storing the creator's own unit is what
-- lets the form read the value back the way they typed it. The conversion to a
-- rate lives once, in `postingCadence()` in lib/deals.ts, and nothing in sql
-- needs it yet — a generated column here would be a second copy of the same
-- arithmetic waiting to disagree with the first.
--
-- 0 is "no agreed number", which is every deal that existed before this ran, so
-- the default is the old behaviour and nothing has to be backfilled.

alter table public.deals
  add column posting_quota integer not null default 0,
  add column posting_period text not null default 'day';

alter table public.deals
  add constraint deals_posting_quota_range
    check (posting_quota >= 0 and posting_quota <= 1000),
  add constraint deals_posting_period_kind
    check (posting_period in ('day', 'week', 'month'));

-- The grants on this table are column-scoped, not table-wide, so a new column
-- is invisible and unwritable until it is named here. The select grant is the
-- load-bearing one: `lib/deals-server.ts` reads `select("*")`, and postgres
-- fails the whole statement when one expanded column is ungranted, which would
-- take out the entire deals section rather than just hide a field.
--
-- Both roles, to match the grants already on every other column. rls is what
-- keeps anon out (`own_rows` is `user_id = auth.uid()`, and anon has none), and
-- a grant that disagrees with its neighbours is the kind of thing that reads as
-- deliberate later.
grant select (posting_quota, posting_period) on public.deals to authenticated, anon;
grant insert (posting_quota, posting_period) on public.deals to authenticated, anon;
grant update (posting_quota, posting_period) on public.deals to authenticated, anon;
