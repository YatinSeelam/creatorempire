-- Autoposting moves from one profile per creator to one profile per deal.
--
-- The product's own model says why: a creator hired by four brands runs four
-- sets of accounts, usually a tiktok, an instagram and a youtube each. A single
-- managed profile per creator could only ever hold one login per platform, so
-- every brand's cut went out of the same three handles and the composer had no
-- way to say which brand it was posting for. The queue had the same problem in
-- reverse: one list, four brands, no way to tell whose schedule you were
-- looking at.
--
-- So the Upload-Post managed profile becomes per (creator, deal): its own
-- username, its own three OAuth connections, its own queue. Nothing about the
-- publish call changes, only which username it carries.

-- ------------------------------------------------------------ social_profiles

alter table public.social_profiles
  add column if not exists deal_id uuid references public.deals (id) on delete cascade;

-- user_id was the primary key back when a creator had exactly one profile.
-- A surrogate key takes over and (user_id, deal_id) carries the uniqueness.
alter table public.social_profiles
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.social_profiles drop constraint if exists social_profiles_pkey;
alter table public.social_profiles add primary key (id);

-- `nulls not distinct` is load bearing: rows written before this migration have
-- no deal, and without it postgres would happily let a creator collect several
-- of those. The dangling pre-deal row is left alone rather than guessed at — it
-- still holds a real Upload-Post profile with real connections behind it, and
-- picking a deal for it on the creator's behalf is not a call a migration gets
-- to make. The app ignores rows with a null deal_id.
create unique index if not exists social_profiles_user_deal_idx
  on public.social_profiles (user_id, deal_id) nulls not distinct;

-- --------------------------------------------------------------- social_posts

alter table public.social_posts
  add column if not exists deal_id uuid references public.deals (id) on delete cascade;

create index if not exists social_posts_deal_idx
  on public.social_posts (user_id, deal_id, created_at desc);
