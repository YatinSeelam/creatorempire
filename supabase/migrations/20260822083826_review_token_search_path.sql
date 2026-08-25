-- `new_review_token` shipped without a pinned search_path and the linter
-- called it. Pinned here rather than edited into the file above so the repo
-- matches the remote ledger, which already recorded both applies.
--
-- `extensions` has to be named: pgcrypto lives there on supabase, so a
-- search_path of just `public` makes gen_random_bytes stop resolving and the
-- function fails at call time rather than at create time.

create or replace function public.new_review_token()
returns text
language sql
volatile
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

revoke all on function public.new_review_token() from public, anon, authenticated;
grant execute on function public.new_review_token() to authenticated;
