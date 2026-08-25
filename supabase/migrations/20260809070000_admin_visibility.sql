-- Admin visibility.
--
-- Until now the only tables staff could read across accounts were the ones the
-- usage page needed: profiles, the api ledger, and the scraper's two. Everything
-- else carries a single `own_rows` policy of `user_id = auth.uid()`, so an admin
-- opening somebody's page got an empty screen rather than a permission error,
-- which is the worse of the two failures because it looks like no data.
--
-- Every policy below is SELECT only, on purpose. `own_rows` is FOR ALL and stays
-- the only way anything is written, so staff can look at a deal and still cannot
-- edit one. Permissive policies are OR'd, so each of these widens reads and
-- touches nothing else.
--
-- `private.is_admin()` is the same function the existing admin policies and
-- `am_i_admin()` call, wrapped in a scalar subquery so postgres runs it once per
-- statement instead of once per row.

create policy "brands_admin_read" on public.brands
  for select to authenticated using ((select private.is_admin()));

create policy "deals_admin_read" on public.deals
  for select to authenticated using ((select private.is_admin()));

create policy "bonus_rules_admin_read" on public.bonus_rules
  for select to authenticated using ((select private.is_admin()));

create policy "deal_accounts_admin_read" on public.deal_accounts
  for select to authenticated using ((select private.is_admin()));

create policy "videos_admin_read" on public.videos
  for select to authenticated using ((select private.is_admin()));

create policy "video_stats_admin_read" on public.video_stats
  for select to authenticated using ((select private.is_admin()));

create policy "payouts_admin_read" on public.payouts
  for select to authenticated using ((select private.is_admin()));

create policy "ingest_runs_admin_read" on public.ingest_runs
  for select to authenticated using ((select private.is_admin()));

create policy "calendar_notes_admin_read" on public.calendar_notes
  for select to authenticated using ((select private.is_admin()));

create policy "portfolios_admin_read" on public.portfolios
  for select to authenticated using ((select private.is_admin()));

create policy "transcripts_admin_read" on public.transcripts
  for select to authenticated using ((select private.is_admin()));

create policy "social_posts_admin_read" on public.social_posts
  for select to authenticated using ((select private.is_admin()));

create policy "social_profiles_admin_read" on public.social_profiles
  for select to authenticated using ((select private.is_admin()));

create policy "edit_jobs_admin_read" on public.edit_jobs
  for select to authenticated using ((select private.is_admin()));

create policy "editor_payouts_admin_read" on public.editor_payouts
  for select to authenticated using ((select private.is_admin()));

create policy "subscriptions_admin_read" on public.subscriptions
  for select to authenticated using ((select private.is_admin()));

create policy "affiliates_admin_read" on public.affiliates
  for select to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------- the roster

-- One row per person with every count the admin list prints, so the page is a
-- single query rather than a fan of them per profile.
--
-- `security_invoker` is what makes this safe to leave granted to authenticated:
-- each subquery is filtered by the caller's own policies, so a creator who
-- somehow reached it sees one row, their own, with their own numbers. It is the
-- admin policies above that turn the same view into the whole roster for staff.
--
-- The counts are correlated subqueries rather than a pile of left joins because
-- a join against `videos` and `scrape_posts` at once multiplies the rows and
-- every sum comes out wrong in a way that still looks plausible.
create or replace view public.admin_people
with (security_invoker = true) as
select
  p.id                                as user_id,
  p.email,
  p.full_name,
  p.avatar_url,
  p.handle,
  p.niche,
  p.created_at,
  exists (
    select 1 from public.admin_emails a where a.email = lower(p.email)
  )                                   as is_admin,
  po.slug                             as portfolio_slug,
  coalesce(po.published, false)       as portfolio_published,
  (select count(*) from public.deals d where d.user_id = p.id)          as deal_count,
  (select count(*) from public.videos v where v.user_id = p.id)         as video_count,
  (select coalesce(sum(v.views), 0) from public.videos v
     where v.user_id = p.id)                                            as tracked_views,
  (select max(v.posted_at) from public.videos v where v.user_id = p.id) as last_posted_at,
  (select count(*) from public.scrape_posts s where s.user_id = p.id)   as scraped_post_count,
  (select coalesce(sum(s.views), 0) from public.scrape_posts s
     where s.user_id = p.id)                                            as scraped_views,
  (select count(*) from public.social_posts sp where sp.user_id = p.id) as social_post_count,
  (select count(*) from public.transcripts t where t.user_id = p.id)    as transcript_count,
  (select count(*) from public.edit_jobs j where j.user_id = p.id)      as edit_job_count,
  (select coalesce(sum(e.credits_charged), 0) from public.api_usage_events e
     where e.user_id = p.id)                                            as credits_spent,
  (select max(e.created_at) from public.api_usage_events e
     where e.user_id = p.id)                                            as last_call_at
from public.profiles p
left join public.portfolios po on po.user_id = p.id;

revoke all on public.admin_people from anon;
grant select on public.admin_people to authenticated;
