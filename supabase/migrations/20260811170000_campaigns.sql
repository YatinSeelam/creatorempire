-- The campaign board: who runs which brand campaign, and how to reach them.
--
-- This is staff reference data, not a creator's own rows, and that is the one
-- thing worth stating up front because every other table in this product is the
-- opposite. There is no `user_id` here and there is deliberately no `own_rows`
-- policy: a campaign manager belongs to the business, not to whoever typed them
-- in, and two coaches looking at the board have to be looking at the same board.
-- So the whole feature is admin-only at the policy level, both halves.
--
-- That also means these reads do NOT need the `x-admin-view` opt in. That header
-- exists to widen a table that is normally scoped to `auth.uid()`, and there is
-- nothing here to widen. `requireAdmin()` is the gate; `requireAdminView()`
-- would work too and buys nothing.
--
-- `campaign_deals` is a separate table from `deals` on purpose. `deals` is one
-- creator's contract with one brand and carries their money. This is the
-- pipeline board: the campaigns that exist, what they pay, and how hard they are
-- to get into. A creator eventually signing one is a `deals` row that this table
-- knows nothing about.

-- ---------------------------------------------------------------- managers

create table if not exists public.campaign_managers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) > 0),

  -- [{platform, value}]. jsonb rather than a contacts table because nothing ever
  -- queries across them: they are read as a whole row and rendered as chips, and
  -- a second table would buy a join for that.
  contacts       jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(contacts) = 'array'),

  -- referrals we have actually closed with them, bumped one at a time from the
  -- row. an integer with a floor rather than a ledger: nobody has ever wanted to
  -- know when the fourth one happened.
  referrals      integer not null default 0 check (referrals >= 0),
  last_contacted date,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- the name is the identity. both the seed and every future import match on it,
-- and case is not a difference anybody means: "Kai" and "kai" are one person.
create unique index if not exists campaign_managers_name_key
  on public.campaign_managers (lower(name));

-- ------------------------------------------------------------------- deals

create table if not exists public.campaign_deals (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) > 0),

  -- how hard it is to get placed, which is the only ordering the board has ever
  -- been sorted by. `need_info` is the honest default for a campaign somebody
  -- has named but nobody has priced yet.
  status            text not null default 'need_info'
                      check (status in ('instant', 'comp', 'v_comp', 'need_info', 'paused')),

  -- pay and posting are stored twice, and that is not an accident. the free text
  -- is what the board actually says ("$20-$60 PV", "$3-$5 cpm only") and is what
  -- renders; the structured pair is what sorts. a range, a qualifier or a
  -- footnote survives in the text and is simply unsortable, which beats losing it.
  base_pay          text not null default '',
  posting_freq      text not null default '',
  pay_model         text not null default 'per_video'
                      check (pay_model in ('per_video', 'retainer', 'cpm')),
  pay_amount        numeric(10, 2) check (pay_amount is null or pay_amount >= 0),
  posting_per_day   integer check (posting_per_day is null or posting_per_day between 1 and 100),
  posting_unlimited boolean not null default false,

  -- how the campaign's videos tend to do. null is "not rated yet", which is a
  -- different thing from `bad` and has to stay tellable apart from it.
  virality          text check (virality is null or virality in ('great', 'okay', 'bad')),

  formats           text not null default '',
  notes             text not null default '',
  how_to_connect    text not null default '',

  -- the pre-link free text ("Talha (CC)", "add runner"). the join table below is
  -- the real answer; this stays as the fallback for a row nobody has linked yet,
  -- and as the record of what the board said before it was linked.
  who_runs_it       text not null default '',

  -- hand rank inside a status section. null = never ranked, and those sort to
  -- the top newest-first, which is the order the board had before ranking existed.
  sort_order        integer,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists campaign_deals_name_key
  on public.campaign_deals (lower(name));

create index if not exists campaign_deals_board_idx
  on public.campaign_deals (status, sort_order nulls first, created_at desc);

-- --------------------------------------------------------------- who runs it

-- many-to-many both ways: Cantina (agency) is run by two people, and Kai 2 (CC)
-- runs three campaigns. a `manager_id` column on the deal could hold neither.
create table if not exists public.campaign_deal_managers (
  deal_id    uuid not null references public.campaign_deals(id) on delete cascade,
  manager_id uuid not null references public.campaign_managers(id) on delete cascade,
  primary key (deal_id, manager_id)
);

-- the pk covers deal → managers; this covers manager → deals, which is the whole
-- campaigns column on the managers view.
create index if not exists campaign_deal_managers_manager_idx
  on public.campaign_deal_managers (manager_id);

-- ------------------------------------------------------------------ touching

drop trigger if exists campaign_managers_touch on public.campaign_managers;
create trigger campaign_managers_touch
  before update on public.campaign_managers
  for each row execute function public.touch_updated_at();

drop trigger if exists campaign_deals_touch on public.campaign_deals;
create trigger campaign_deals_touch
  before update on public.campaign_deals
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------- rls

alter table public.campaign_managers      enable row level security;
alter table public.campaign_deals         enable row level security;
alter table public.campaign_deal_managers enable row level security;

revoke all on public.campaign_managers      from anon, authenticated;
revoke all on public.campaign_deals         from anon, authenticated;
revoke all on public.campaign_deal_managers from anon, authenticated;

grant select, insert, update, delete on public.campaign_managers      to authenticated;
grant select, insert, update, delete on public.campaign_deals         to authenticated;
grant select, insert, update, delete on public.campaign_deal_managers to authenticated;

-- one policy per table rather than four, because the answer is the same for
-- every command: staff, or nobody. `for all` covers select/insert/update/delete
-- and both halves of the check.
create policy campaign_managers_admin on public.campaign_managers
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy campaign_deals_admin on public.campaign_deals
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy campaign_deal_managers_admin on public.campaign_deal_managers
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
