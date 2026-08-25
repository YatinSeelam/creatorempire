-- Org-layer holes an onboarding pass surfaced. The additive half; the grant
-- change (the flow key leak) is 20260818020000_org_flow_key_select.sql, kept
-- apart because it has to land AFTER the code that stops selecting `*`.
--
-- 2. video_stats had no `_org_read` policy, so `deal_earnings()` under the
--    roster's widened client saw no stats and the roster's bonus column was
--    zero for everyone. Same policy shape as the thirteen tables beside it.
-- 3. accept_org_invite did `on conflict do nothing`, so inviting somebody who
--    already held a creator seat as a manager quietly changed nothing. Now the
--    role follows the invite; the owner-seat trigger still pins the founder.
-- 4. the login / sign-up / join pages paint the tenant off `loadBrand()`, and
--    that read only had an anon policy: a signed-in invitee on the agency's own
--    address got the product's paint. One definer function returns exactly the
--    branding columns for a host, for anon and authenticated alike, so no
--    policy has to widen to make the door wear the right name.
--
-- Plus two admin_read policies so /admin can see who owns and sits on what.

-- ---------------------------------------------- 2. the roster's missing stats
drop policy if exists video_stats_org_read on public.video_stats;
create policy video_stats_org_read on public.video_stats
  for select to authenticated
  using (
    (select private.org_view())
    and user_id in (select private.org_member_ids())
  );

-- ------------------------------------------- 3. an invite can change a role
create or replace function public.accept_org_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.org_invites%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite
  from public.org_invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite is not valid';
  end if;

  if lower(v_invite.email) <> lower(coalesce(v_email, '')) then
    raise exception 'invite was sent to a different email';
  end if;

  -- a seat that already exists takes the invite's role: that is how a creator
  -- gets promoted to manager without being removed first. the founder's seat
  -- is pinned to owner by protect_owner_seat_role whatever the invite said.
  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, auth.uid(), v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do update
    set role = excluded.role;

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return v_invite.org_id;
end
$$;

-- --------------------------------------------- 4. the door wears the tenant
create or replace function public.org_brand_for_host(p_slug text, p_domain text)
returns table (
  id uuid,
  slug text,
  name text,
  logo_url text,
  wordmark_url text,
  favicon_url text,
  accent_hex text,
  accent_dark_hex text,
  accent_soft_hex text,
  rail_hex text,
  features jsonb,
  custom_domain text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    o.id, o.slug, o.name, o.logo_url, o.wordmark_url, o.favicon_url,
    o.accent_hex, o.accent_dark_hex, o.accent_soft_hex, o.rail_hex,
    o.features, o.custom_domain
  from public.orgs o
  where (p_slug is not null and o.slug = p_slug)
     or (p_domain is not null and o.custom_domain = p_domain)
  -- a slug match is the more specific claim when both are given
  order by (o.slug = p_slug) desc
  limit 1;
$$;

comment on function public.org_brand_for_host(text, text) is
  'The branding columns for a tenant host. What the login, sign-up and join pages paint from. Anon-safe: these are the columns anon could already select.';

revoke all on function public.org_brand_for_host(text, text) from public;
grant execute on function public.org_brand_for_host(text, text) to anon, authenticated;

-- ---------------------------------------------------- admin reads for /admin
drop policy if exists orgs_admin_read on public.orgs;
create policy orgs_admin_read on public.orgs
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists org_members_admin_read on public.org_members;
create policy org_members_admin_read on public.org_members
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));
