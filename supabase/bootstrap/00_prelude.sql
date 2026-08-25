-- ==== 00_prelude.sql (hand written, 2026-08-25)
--
-- the four things every migration in this bundle assumes and none of them
-- creates: they were made by hand in the ugc flows dashboard before the first
-- migration file existed (docs/02-DATA-MODEL.md, "exist ONLY in the live db").
-- a fresh project needs them first or 01_*.sql fails on its first policy.
--
--   * schema `private` (every rls helper lives there)
--   * `admin_emails` + `private.is_admin()` + `public.am_i_admin()`
--   * `profiles` + the auth signup trigger that fills it
--   * `subscriptions` (stripe webhook writes it, lib/billing.ts reads it)
--
-- shapes are reconstructed from what the app selects/updates and what the
-- later migrations `alter`. columns added by later files (admin_emails.role,
-- profiles.phone/notify_sms/phone_verified_at) are deliberately NOT here.

create extension if not exists pgcrypto;

-- --------------------------------------------------------------- private

create schema if not exists private;
revoke all on schema private from public;
-- policies run as the invoking role, so the roles that hit rls need to be
-- able to resolve and execute the helpers. the schema is not exposed to
-- postgrest, so nothing here is callable over http.
grant usage on schema private to anon, authenticated, service_role;
alter default privileges in schema private
  grant execute on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------- admin_emails

create table if not exists public.admin_emails (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_emails enable row level security;

-- v1: on the list = staff. 04_*.sql (20260821230000_creator_role) replaces
-- this with the role-aware version and adds the `role` column.
create or replace function private.is_admin()
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from auth.users u
    join public.admin_emails a on a.email = lower(u.email)
    where u.id = (select auth.uid())
  );
$$;

create or replace function public.am_i_admin()
returns boolean
language sql stable
set search_path to ''
as $$
  select private.is_admin();
$$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

drop policy if exists admin_emails_select on public.admin_emails;
create policy admin_emails_select on public.admin_emails
  for select to authenticated
  using ((select private.is_admin()));

grant select on public.admin_emails to authenticated;

-- -------------------------------------------------------------- profiles

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  full_name    text,
  avatar_url   text,
  handle       text,
  niche        text,
  tz           text not null default 'America/New_York',
  notify_deals boolean not null default true,
  notify_edits boolean not null default true,
  notify_posts boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists profiles_handle_key
  on public.profiles (lower(handle)) where handle is not null;
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, update on public.profiles to authenticated;

-- one profile row per auth user, written by the signup trigger, never from a
-- session (there is no insert policy on purpose).
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    coalesce(
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'picture'
    )
  )
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- keep profiles.email in step when someone changes their login email.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql security definer
set search_path to ''
as $$
begin
  update public.profiles set email = new.email, updated_at = now()
  where id = new.id and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- --------------------------------------------------------- subscriptions

create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  status                 text not null default 'inactive'
    check (status in ('inactive', 'active', 'past_due', 'canceled')),
  paid_at                timestamptz,
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  last_event_id          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id);
alter table public.subscriptions enable row level security;

-- read your own; only the stripe webhook (service role) writes.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.subscriptions to authenticated;
