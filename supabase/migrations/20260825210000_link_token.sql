-- One token generator, named after what it makes.
--
-- `new_review_token()` was minted for the client review link, and the handoff
-- link borrowed it because how a capability is generated should not depend on
-- which feature asked. On creator empire the review link is gone and the only
-- caller left is the handoff link, so a function called "review" is now a lie
-- in every place it appears.
--
-- Same body, honest name. The old one is left in place rather than dropped:
-- `edit_job_review_links` and its two rpcs still exist in this database,
-- orphaned on purpose, and dropping a function nothing can call costs more
-- than leaving it.
create or replace function public.new_link_token()
returns text
language sql
volatile
-- pgcrypto lives in `extensions` on supabase, so the pinned search_path has to
-- name it or gen_random_bytes stops resolving.
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

revoke all on function public.new_link_token() from public, anon, authenticated;
grant execute on function public.new_link_token() to authenticated;
