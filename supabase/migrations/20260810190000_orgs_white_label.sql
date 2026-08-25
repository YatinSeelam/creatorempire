-- Orgs: the white-label tenant layer.
--
-- A brand or a mentorship runs a roster of creators and wants the tracker under
-- their own name. That is two separate things and this migration adds both:
--
--   1. an org, its members, and their roles  (who can see whose numbers)
--   2. the org's branding                    (what the app looks like to them)
--
-- The deliberate choice here is that NO existing table gets an `org_id`. Every
-- user table in this product is keyed on `user_id` and scoped by an `own_rows`
-- policy, and re-keying twenty of them on a tenant is both a migration that can
-- lose rows and a permanent second source of truth about who owns what. A
-- creator's rows stay theirs. An org gets a READ over its members' rows, added
-- as a second policy beside `own_rows`, which is exactly the shape the existing
-- `*_admin_read` policies already use.
--
-- The consequence is worth stating out loud: joining an org never moves data and
-- leaving one never takes any. Membership is a lens, not ownership.

-- ---------------------------------------------------------------- the tables

create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),

  -- the subdomain, and the url-safe name. Lowercased and constrained here rather
  -- than in app code because it ends up in DNS and in other people's bookmarks.
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (length(btrim(name)) > 0),

  -- branding. All optional: an org with none of it set renders in the product's
  -- own flame palette, which is a working white-label of zero effort rather than
  -- a broken screen.
  logo_url text,
  wordmark_url text,
  favicon_url text,
  -- one accent, and the dark step used for hovers and pressed states. Hex only,
  -- validated here, because these are interpolated into a style attribute and a
  -- loose string there is a css injection.
  accent_hex text check (accent_hex ~ '^#[0-9a-fA-F]{6}$'),
  accent_dark_hex text check (accent_dark_hex ~ '^#[0-9a-fA-F]{6}$'),
  -- the tint behind an accent on a card. Same validation, same reason.
  accent_soft_hex text check (accent_soft_hex ~ '^#[0-9a-fA-F]{6}$'),

  support_email text,
  -- set once DNS points at us. Null means the org lives at <slug>.ugcflows.com.
  custom_domain text unique,

  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orgs_owner_idx on public.orgs (owner_id);

-- Roles, and what each one buys:
--   owner   — everything a manager can do, plus branding, billing and deleting
--   manager — reads every member's deals, videos and money. Writes nothing of theirs
--   creator — a member. Reads only their own rows, exactly as before joining
--
-- A manager's read is deliberately read-only. An org editing a creator's deal
-- terms is a different product with a different consent story, and nothing in
-- the app should be able to do it by accident before that is designed.
create table if not exists public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'creator'
    check (role in ('owner', 'manager', 'creator')),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);

-- An invite is an email plus a token, and it is the only way into an org. There
-- is no "join by slug": a roster that anyone with the url can add themselves to
-- is a roster whose numbers cannot be trusted.
create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  email text not null,
  role text not null default 'creator'
    check (role in ('owner', 'manager', 'creator')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists org_invites_org_idx on public.org_invites (org_id);
create unique index if not exists org_invites_pending_idx
  on public.org_invites (org_id, lower(email))
  where accepted_at is null;

-- ------------------------------------------------------------- the helpers
--
-- All four are `security definer` and read `org_members`, which is itself an
-- rls'd table. That is the point: a policy ON org_members that queried
-- org_members would recurse and postgres would refuse it. A definer function
-- reads underneath rls once, and every policy calls the function instead.

create or replace function private.my_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

create or replace function private.managed_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and role in ('owner', 'manager')
$$;

-- Every user whose rows I am allowed to read through an org I manage. Excludes
-- me: my own rows already come through `own_rows`, and including myself here
-- would make the org policy look like it was doing work it is not.
create or replace function private.org_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct m.user_id
  from public.org_members m
  where m.org_id in (select private.managed_org_ids())
    and m.user_id <> auth.uid()
$$;

-- The opt in, mirroring `private.admin_view()` exactly.
--
-- Without it, a coach who also runs their own deals would open /deals and find
-- their roster's eleven brands mixed into their own four, because this product
-- never filters `user_id` in app code and trusts rls to have done it. The header
-- is not the permission — a non-member sending it still sees nothing — it is the
-- request saying which of the two views it is asking for.
create or replace function private.org_view()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    current_setting('request.headers', true)::json ->> 'x-org-view',
    ''
  ) = '1'
$$;

-- ----------------------------------------------------------- rls on the new

alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;

revoke all on public.orgs from anon, authenticated;
revoke all on public.org_members from anon, authenticated;
revoke all on public.org_invites from anon, authenticated;

grant select on public.orgs to authenticated;
grant insert, update on public.orgs to authenticated;

-- anon gets the branding columns and nothing else. The login page at
-- acme.ugcflows.com has to paint acme's logo before anyone has authenticated, so
-- the row must be reachable signed out — but `owner_id` and `support_email` are
-- not branding, and a column grant is what keeps "readable" from meaning "all of
-- it". The rls policy below still has to pass on top of this.
grant select (
  id, slug, name, logo_url, wordmark_url, favicon_url,
  accent_hex, accent_dark_hex, accent_soft_hex, custom_domain
) on public.orgs to anon;
grant select on public.org_members to authenticated;
grant select, insert, update, delete on public.org_invites to authenticated;
grant delete on public.org_members to authenticated;

-- An org is readable by its members, in full. anon reaches the same rows but
-- only the branding columns, per the grant above.
drop policy if exists orgs_read_member on public.orgs;
create policy orgs_read_member on public.orgs
  for select to authenticated
  using (id in (select private.my_org_ids()));

drop policy if exists orgs_read_branding on public.orgs;
create policy orgs_read_branding on public.orgs
  for select to anon
  using (true);

drop policy if exists orgs_insert_own on public.orgs;
create policy orgs_insert_own on public.orgs
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists orgs_update_owner on public.orgs;
create policy orgs_update_owner on public.orgs
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- I can see my own membership rows, and every row of an org I manage.
drop policy if exists org_members_read on public.org_members;
create policy org_members_read on public.org_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select private.managed_org_ids())
  );

-- Leaving is always allowed. Removing someone else needs the org.
drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select private.managed_org_ids())
  );

-- Invites are managed by the org and never listed to the invitee. Accepting one
-- goes through `public.accept_org_invite`, which takes the token.
drop policy if exists org_invites_manage on public.org_invites;
create policy org_invites_manage on public.org_invites
  for all to authenticated
  using (org_id in (select private.managed_org_ids()))
  with check (org_id in (select private.managed_org_ids()));

-- ------------------------------------------------------- the org's read over
--
-- One policy per table, all the same shape, all additive: `own_rows` is
-- untouched, so a creator who is in no org sees exactly what they saw before
-- this migration ran.
--
-- `video_stats` and the rule/earning tables are keyed off their parent rather
-- than carrying a user_id, so they are not listed: they inherit through the
-- existing joins once the parent is visible.
do $$
declare
  t text;
begin
  foreach t in array array[
    'brands', 'deals', 'deal_accounts', 'bonus_rules', 'videos', 'payouts',
    'social_posts', 'social_profiles', 'portfolios', 'edit_jobs', 'calendar_notes'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_org_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || '(select private.org_view()) and user_id in (select private.org_member_ids())'
      || ')',
      t || '_org_read', t
    );
  end loop;
end
$$;

-- profiles is keyed on `id`, not `user_id`, so it gets the same policy by hand.
-- A roster is a list of people and it needs their names.
drop policy if exists profiles_select_org on public.profiles;
create policy profiles_select_org on public.profiles
  for select to authenticated
  using (
    (select private.org_view())
    and id in (select private.org_member_ids())
  );

-- ------------------------------------------------------------ accepting one
--
-- `security definer` because the invitee cannot see the invite row (the manage
-- policy is scoped to the org) and cannot insert their own membership. The token
-- is the authorisation. The email check is what stops a forwarded link from
-- seating the wrong person.
create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.org_invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite is not valid';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite was sent to a different email';
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do nothing;

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end
$$;

revoke all on function public.accept_org_invite(text) from public, anon;
grant execute on function public.accept_org_invite(text) to authenticated;

-- The owner is a member from the moment the org exists, so a roster is never
-- empty and `managed_org_ids` never has a hole in it right after a create.
create or replace function private.seat_org_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (org_id, user_id) do update set role = 'owner';
  return new;
end
$$;

drop trigger if exists seat_org_owner on public.orgs;
create trigger seat_org_owner
  after insert on public.orgs
  for each row execute function private.seat_org_owner();
