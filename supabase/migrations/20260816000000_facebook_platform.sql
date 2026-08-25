-- facebook joins tiktok, instagram and youtube as a tracked platform.
--
-- calendar_notes carries the same constraint and is NOT widened here. the
-- calendar was deleted on 2026-08-12 and the table is orphaned on purpose;
-- nothing reads it and nothing will write a facebook row to it.

alter table public.deal_accounts drop constraint deal_accounts_platform_check;
alter table public.deal_accounts add constraint deal_accounts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.videos drop constraint videos_platform_check;
alter table public.videos add constraint videos_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.scrape_targets drop constraint scrape_targets_platform_check;
alter table public.scrape_targets add constraint scrape_targets_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.scrape_posts drop constraint scrape_posts_platform_check;
alter table public.scrape_posts add constraint scrape_posts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.transcripts drop constraint transcripts_platform_check;
alter table public.transcripts add constraint transcripts_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

alter table public.api_usage_events drop constraint api_usage_events_platform_check;
alter table public.api_usage_events add constraint api_usage_events_platform_check
  check (platform = any (array['tiktok', 'instagram', 'youtube', 'facebook']));

-- a facebook post lands on a Page, not on a person. with several pages
-- connected upload-post refuses the post unless it is told which one, so the
-- choice is made once at connect time and kept here.
alter table public.social_profiles add column if not exists facebook_page_id text;
