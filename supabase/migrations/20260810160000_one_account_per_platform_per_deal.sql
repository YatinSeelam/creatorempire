-- one account per platform per deal.
--
-- a deal is one brand and one run of work, and the accounts it posts from are
-- one tiktok, one instagram, one youtube, made for that brand. the old key was
-- (deal_id, platform, lower(handle)), which only stopped the SAME handle being
-- added twice and happily let a deal carry three tiktoks. that made every
-- per-platform read on a deal a list rather than a value, which is why the deal
-- page needed a table with a select-all checkbox to say something a coloured
-- mark now says on its own.
--
-- lower(handle) is dropped from the key on purpose: uniqueness is per platform
-- now, so a duplicate handle cannot get in anyway.

drop index if exists public.deal_accounts_handle_key;

create unique index if not exists deal_accounts_platform_key
  on public.deal_accounts (deal_id, platform);
