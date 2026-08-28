-- The programme's own api keys, so a deploy is not a set of env vars.
--
-- Three decisions, and they are the whole design.
--
-- ONE: the key belongs to the WORKSPACE, not to a person. The programme pays
-- for scraping and posting; a student pastes nothing and inherits it. Billing
-- stays per person — `api_usage_events` and the daily cap are untouched — but
-- the credential every one of those calls travels on is the org's.
--
-- TWO: the secret is never in this table. `supabase_vault` holds it encrypted
-- and this row keeps only the id and a four character hint, so a copy of this
-- table is worth nothing on its own.
--
-- THREE: a session can WRITE a key and can never read one back. Setting is a
-- `security definer` rpc scoped to owners and admins; reading is a separate
-- function granted to `service_role` alone, so a stolen access token can
-- overwrite a key but cannot exfiltrate one. That is the same shape as
-- `account_emails.password_secret` and `edit_job_review_notes`: the write is
-- narrow and the read is somewhere a browser cannot reach.
create table if not exists public.org_api_credentials (
  org_id uuid not null references public.orgs(id) on delete cascade,
  provider text not null check (
    provider in ('scrapecreators', 'upload_post', 'apify', 'rapidapi', 'youtube')
  ),
  -- the row in vault.secrets. useless without vault access, which no session has.
  secret_id uuid not null,
  -- the last four, so the settings page can say WHICH key is saved without
  -- ever being handed one.
  hint text,
  set_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);

alter table public.org_api_credentials enable row level security;

revoke all on public.org_api_credentials from public, anon, authenticated;

-- owners and admins may see THAT a key is set and its hint. never `secret_id`:
-- there is nothing a session could do with it today, and a column that is never
-- granted cannot be the thing that changes that.
grant select (org_id, provider, hint, set_by, created_at, updated_at)
  on public.org_api_credentials to authenticated;

drop policy if exists org_api_credentials_read on public.org_api_credentials;
create policy org_api_credentials_read on public.org_api_credentials
  for select to authenticated
  using (org_id in (select private.managed_org_ids()));

-- no insert, update or delete policy and no grant for them. the two functions
-- below are the only writers.

/**
 * Save or replace one key.
 *
 * Takes the org from the caller's own seat rather than as an argument, so
 * there is nothing to lie about: an admin of one workspace cannot write a key
 * onto another. An empty secret is a mistake, not an instruction to clear —
 * clearing has its own function, because "save" silently deleting a working
 * key on a slipped keystroke is the wrong way to lose a scraper.
 */
create or replace function public.set_api_credential(p_provider text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_secret text := btrim(coalesce(p_secret, ''));
  v_id uuid;
  v_name text;
begin
  if v_secret = '' then
    raise exception 'a key cannot be empty';
  end if;

  -- the workspace this person actually runs. `managed_org_ids` is owner and
  -- admin only, so a student calling this gets no row and the raise below.
  select org_id into v_org
    from public.org_members
   where user_id = auth.uid()
     and role in ('owner', 'admin')
   limit 1;

  if v_org is null then
    raise exception 'only an owner or an admin sets the programme keys';
  end if;

  if p_provider not in ('scrapecreators', 'upload_post', 'apify', 'rapidapi', 'youtube') then
    raise exception 'unknown provider %', p_provider;
  end if;

  select secret_id into v_id
    from public.org_api_credentials
   where org_id = v_org and provider = p_provider;

  v_name := 'api:' || v_org::text || ':' || p_provider;

  if v_id is null then
    v_id := vault.create_secret(v_secret, v_name, 'workspace api key');
  else
    -- replaces the ciphertext in place, so the id on the row stays good and
    -- nothing has to be re-pointed.
    perform vault.update_secret(v_id, v_secret, v_name, 'workspace api key');
  end if;

  insert into public.org_api_credentials (org_id, provider, secret_id, hint, set_by, updated_at)
  values (v_org, p_provider, v_id, right(v_secret, 4), auth.uid(), now())
  on conflict (org_id, provider) do update
     set secret_id = excluded.secret_id,
         hint = excluded.hint,
         set_by = excluded.set_by,
         updated_at = now();
end;
$$;

/** Drop a key entirely, ciphertext and all, and fall back to the deploy's env. */
create or replace function public.clear_api_credential(p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select org_id into v_org
    from public.org_members
   where user_id = auth.uid()
     and role in ('owner', 'admin')
   limit 1;

  if v_org is null then
    raise exception 'only an owner or an admin sets the programme keys';
  end if;

  delete from public.org_api_credentials
   where org_id = v_org and provider = p_provider
   returning secret_id into v_id;

  if v_id is not null then
    delete from vault.secrets where id = v_id;
  end if;
end;
$$;

/**
 * The read, and the only one.
 *
 * Keyed on a USER because that is what every caller already has in scope: the
 * sync knows whose account it is pulling, the poster knows whose post it is.
 * It resolves their seat itself, so nothing in the app has to know which
 * workspace a key belongs to.
 *
 * Granted to `service_role` and nothing else. `authenticated` cannot call it,
 * which is the point: a session may replace a key and may never read one.
 */
create or replace function public.read_api_credential(p_user uuid, p_provider text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select s.decrypted_secret
    from public.org_members m
    join public.org_api_credentials c
      on c.org_id = m.org_id
     and c.provider = p_provider
    join vault.decrypted_secrets s
      on s.id = c.secret_id
   where m.user_id = p_user
   limit 1;
$$;

revoke all on function public.set_api_credential(text, text) from public, anon;
revoke all on function public.clear_api_credential(text) from public, anon;
revoke all on function public.read_api_credential(uuid, text) from public, anon, authenticated;

grant execute on function public.set_api_credential(text, text) to authenticated;
grant execute on function public.clear_api_credential(text) to authenticated;
grant execute on function public.read_api_credential(uuid, text) to service_role;

comment on table public.org_api_credentials is
  'One api key per workspace per provider. The secret lives in vault; this row holds its id and a four character hint.';
