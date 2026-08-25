-- who owns the $14.99 starter kit. one row per buyer, written only by the
-- stripe webhook's service key; the unique stripe_session_id makes an event
-- replay a no-op. main-product customers never need a row here:
-- lib/lowticket/access.ts lets founders, subscribers and org seats in
-- through loadAccess() instead.

create table public.kit_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text,
  stripe_session_id text unique,
  source text not null default 'stripe',
  created_at timestamptz not null default now()
);

alter table public.kit_entitlements enable row level security;

revoke all on public.kit_entitlements from anon, authenticated;
grant select on public.kit_entitlements to authenticated;

create policy kit_entitlements_own_rows on public.kit_entitlements
  for select to authenticated
  using (user_id = (select auth.uid()));

-- deliberately no insert/update/delete policies: the webhook's service key is
-- the only writer, so nobody can grant themselves the kit from a session.
