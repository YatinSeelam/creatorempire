-- One address, as many accounts as the person actually made.
--
-- The unique (email_id, platform) was written on the belief that a signup form
-- refuses a second account on the same email, and that is not true on any of
-- the four platforms this tool exists for. What it actually did was cap an
-- address at one tiktok, so a creator running two handles for one brand had to
-- burn a second address to hold the second login.
--
-- The handle and the password already live per row, so nothing else has to
-- change: two rows on the same platform are two logins, which is what they are.
alter table public.account_email_accounts
  drop constraint if exists account_email_accounts_email_id_platform_key;

-- the unique index went with the constraint, and it was also the only index on
-- email_id. every read here is "the accounts on this address, oldest first".
create index if not exists account_email_accounts_email_idx
  on public.account_email_accounts (email_id, created_at);
