-- three things the agency section was missing: a second colour, a way to turn
-- sections off, and somewhere to put their own training.

-- ---------------------------------------------------------------- the paint
-- the rail was always derived from the accent (lighten 0.78), which is right
-- until an agency picks black and gets a grey slab down the left of the app.
-- null keeps the derivation, so nothing changes for anyone who never sets it.
alter table public.orgs
  add column if not exists rail_hex text;

-- ------------------------------------------------------------- the switches
-- one jsonb of `{ "<feature key>": false }`. absent means on, so a new feature
-- ships enabled and an org that never opened the branding page is unaffected.
-- keys live in ORG_FEATURES in lib/org.ts; deliberately not a check constraint,
-- because adding a feature would then be a migration rather than a const.
alter table public.orgs
  add column if not exists features jsonb not null default '{}'::jsonb;

-- column privileges on orgs are explicit (anon reads 10 of 14), so new columns
-- have to be named or the branding read comes back short on a tenant host.
grant select (rail_hex, features) on public.orgs to anon;
grant select (rail_hex, features) on public.orgs to authenticated;
grant insert (rail_hex, features) on public.orgs to authenticated;
grant update (rail_hex, features) on public.orgs to authenticated;
grant select (rail_hex, features) on public.orgs to service_role;
grant insert (rail_hex, features) on public.orgs to service_role;
grant update (rail_hex, features) on public.orgs to service_role;

-- ------------------------------------------------------------- the modules
-- an agency's own training, shown to their roster at /modules. Deliberately not
-- tied to a deal or a creator: it is one shelf per org and everybody on the
-- roster sees the same shelf, which is what makes it cheap enough to keep up.
create table if not exists public.org_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  blurb text,
  -- a link to the video wherever it already lives (loom, youtube, drive). we
  -- are not hosting an agency's video library, and every one of them already
  -- has one.
  video_url text,
  -- a doc, a template, a form. the second thing a module is ever made of.
  link_url text,
  body text,
  position integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists org_modules_org_position_idx
  on public.org_modules (org_id, position, created_at);

alter table public.org_modules enable row level security;

revoke all on public.org_modules from anon;
grant select, insert, update, delete on public.org_modules to authenticated;

-- the roster reads published ones; owners and managers read their drafts too.
drop policy if exists org_modules_read on public.org_modules;
create policy org_modules_read on public.org_modules
  for select to authenticated
  using (
    org_id in (select private.my_org_ids())
    and (published or org_id in (select private.managed_org_ids()))
  );

-- writing is owner/manager, same bar as the roster itself. app code checks
-- nothing: this is the check, so a forged post gets the same answer.
drop policy if exists org_modules_write on public.org_modules;
create policy org_modules_write on public.org_modules
  for all to authenticated
  using (org_id in (select private.managed_org_ids()))
  with check (org_id in (select private.managed_org_ids()));
