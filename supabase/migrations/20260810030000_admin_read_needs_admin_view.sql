-- Admin-wide reads must be asked for, not inherited.
--
-- 20260809070000 added an `*_admin_read` policy to every user-scoped table so
-- /admin could see other people's rows. But the whole product reads through the
-- same session client and never filters `user_id` itself ("rls does the
-- scoping"), so those policies also widened /deals, /dashboard, /calendar and
-- /social: any staff account saw every creator's deals mixed into its own list.
-- The whole (dash) group is currently admin-gated, so in practice that was
-- everybody.
--
-- The fix keeps one policy set and makes the admin half opt in per request.
-- PostgREST exposes the request headers as a GUC, so a client that deliberately
-- sends `x-admin-view: 1` gets the wide read and every other client does not.
-- The header is not the permission - `private.is_admin()` still is, and a
-- non-admin sending it gets exactly nothing. The header only narrows.

create or replace function private.admin_view()
returns boolean
language sql
stable
set search_path to ''
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'x-admin-view',
    ''
  ) = '1';
$$;

comment on function private.admin_view() is
  'True when the caller opted into admin-wide reads with the x-admin-view header. Pairs with private.is_admin(); never a grant on its own.';

-- Outside PostgREST (service key, sql editor, cron) the GUC is unset, so this
-- returns false. That is correct: the service key bypasses rls anyway.

do $$
declare
  p record;
begin
  for p in
    select * from (values
      ('affiliates',        'affiliates_admin_read'),
      ('api_usage_events',  'api_usage_events_admin_read'),
      ('bonus_rules',       'bonus_rules_admin_read'),
      ('brands',            'brands_admin_read'),
      ('calendar_notes',    'calendar_notes_admin_read'),
      ('deal_accounts',     'deal_accounts_admin_read'),
      ('deals',             'deals_admin_read'),
      ('edit_jobs',         'edit_jobs_admin_read'),
      ('editor_payouts',    'editor_payouts_admin_read'),
      ('ingest_runs',       'ingest_runs_admin_read'),
      ('payouts',           'payouts_admin_read'),
      ('portfolios',        'portfolios_admin_read'),
      ('profiles',          'profiles_select_admin'),
      ('scrape_posts',      'scrape_posts_admin_read'),
      ('scrape_targets',    'scrape_targets_admin_read'),
      ('social_posts',      'social_posts_admin_read'),
      ('social_profiles',   'social_profiles_admin_read'),
      ('subscriptions',     'subscriptions_admin_read'),
      ('transcripts',       'transcripts_admin_read'),
      ('video_stats',       'video_stats_admin_read'),
      ('videos',            'videos_admin_read')
    ) as t(tbl, pol)
  loop
    execute format(
      'alter policy %I on public.%I using ((select private.is_admin()) and (select private.admin_view()))',
      p.pol, p.tbl
    );
  end loop;
end $$;

-- api_user_limits folded its admin branch into the own-row policy instead of a
-- separate one, so it gets rewritten by hand.
alter policy api_user_limits_own_read on public.api_user_limits
  using (
    user_id = (select auth.uid())
    or ((select private.is_admin()) and (select private.admin_view()))
  );

-- ...and its write policy was `for all`, which means it granted select too.
-- Split it so reads go through the policy above and only the writes stay wide.
drop policy if exists api_user_limits_admin_write on public.api_user_limits;

create policy api_user_limits_admin_insert on public.api_user_limits
  for insert to authenticated
  with check ((select private.is_admin()));

create policy api_user_limits_admin_update on public.api_user_limits
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy api_user_limits_admin_delete on public.api_user_limits
  for delete to authenticated
  using ((select private.is_admin()));

-- admin_emails and api_pricing keep their plain is_admin() policies: neither
-- holds per-creator data, so widening them leaks nothing.
