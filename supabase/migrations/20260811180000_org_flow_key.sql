-- An agency's own Flow key.
--
-- Flow costs money per turn, and it is the one feature in the product where the
-- bill scales with how much a tenant's roster uses it. So an agency that wants
-- it brings its own anthropic key and pays its own bill, rather than us metering
-- somebody else's conversations.
--
-- The column is WRITE ONLY, the same shape `account_emails.password_secret`
-- already uses and for the same reason: an api key that can be selected from a
-- session is an api key that leaves on the first xss or the first over-shared
-- postgrest query. `authenticated` is granted UPDATE on it and never SELECT, so
-- the owner can paste a new one and nobody, including them, can read one back.
--
-- `flow_key_set_at` is the readable half. It is what lets the branding page say
-- "a key is installed" without the key being on the wire, and it is set by a
-- trigger rather than by the app so it cannot drift from the column it describes.

alter table public.orgs
  add column if not exists flow_api_key   text,
  add column if not exists flow_key_set_at timestamptz;

comment on column public.orgs.flow_api_key is
  'write-only. granted UPDATE to authenticated, never SELECT. read it with the service client only.';

/**
 * Stamp (or clear) `flow_key_set_at` whenever the key itself moves.
 *
 * Emptying the field is how an agency removes their key, so "" is normalised to
 * null here rather than in the app: a stored empty string would read as "a key
 * is set" to anything checking the column for null.
 */
create or replace function public.touch_org_flow_key()
returns trigger
language plpgsql
as $$
begin
  if btrim(coalesce(new.flow_api_key, '')) = '' then
    new.flow_api_key := null;
  end if;

  if new.flow_api_key is distinct from old.flow_api_key then
    new.flow_key_set_at := case when new.flow_api_key is null then null else now() end;
  end if;

  return new;
end;
$$;

drop trigger if exists orgs_flow_key_touch on public.orgs;
create trigger orgs_flow_key_touch
  before update on public.orgs
  for each row execute function public.touch_org_flow_key();

-- the key joins the update grant; it is deliberately absent from every select
-- path, including the BRAND_COLS list the app reads.
grant update (flow_api_key) on public.orgs to authenticated;

-- and explicitly out of reach of a select, whatever a future grant does.
revoke select (flow_api_key) on public.orgs from anon, authenticated;
