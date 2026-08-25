-- the sync cycle + credit rails + notification bookkeeping, one pass.
--
-- 1. deal_accounts.next_sync_at — each sync writes its own next due date, so
--    the cron stops thinking in one global interval. null means "due now"
--    (new accounts sort first, same as last_synced_at did).
-- 2. api_usage_events.source — 'sync' (cron), 'manual' (refresh button),
--    'tool' (profile scraper etc). the daily cap only counts what a person
--    clicked; the cron's spend is ours and is budgeted, not capped.
-- 3. social_posts.notified_at — a published/failed post emails once, ever.

alter table public.deal_accounts
  add column if not exists next_sync_at timestamptz;

-- the cron's whole query: active accounts ordered by due date.
create index if not exists deal_accounts_due_idx
  on public.deal_accounts (next_sync_at asc nulls first)
  where active;

alter table public.api_usage_events
  add column if not exists source text not null default 'tool'
  check (source in ('sync', 'manual', 'tool'));

-- the budget reads "this month's sync spend" per user; keep it a range scan.
create index if not exists api_usage_events_user_source_idx
  on public.api_usage_events (user_id, source, created_at desc);

alter table public.social_posts
  add column if not exists notified_at timestamptz;
