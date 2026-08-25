-- two follow-ups to 20260818200000, found in review.
--
-- 1. the founder page for a workspace lists its pending invites, read behind
--    the founder view. org_invites only had `org_invites_manage` (owner/admin
--    of that org), so the panel was always empty unless the founder happened
--    to manage the workspace. same shape as every other *_admin_read policy:
--    founder AND the x-admin-view opt-in.
drop policy if exists org_invites_admin_read on public.org_invites;
create policy org_invites_admin_read on public.org_invites
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

-- 2. portfolio_agency_for is granted to anon, and it took any user id. that
--    let anyone probe a uuid for "which workspace is this person on". it now
--    answers only for a user with a PUBLISHED portfolio, which is the one case
--    the answer is already on a public page, or for the caller's own row, so
--    the editor's preview shows the setup on a draft too.
create or replace function public.portfolio_agency_for(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'slug', o.slug,
    'logo_url', o.logo_url,
    'custom_domain', o.custom_domain,
    'overrides', (
      select coalesce(jsonb_object_agg(v.key, v.value), '{}'::jsonb)
      from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  )
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = p_user
    and exists (
      select 1 from public.portfolios p
      where p.user_id = p_user
        and (p.published or p.user_id = (select auth.uid()))
    )
    and exists (
      select 1 from public.org_overrides v
      where v.org_id = o.id and v.key like 'portfolio.%'
    )
  order by m.joined_at asc
  limit 1;
$$;
