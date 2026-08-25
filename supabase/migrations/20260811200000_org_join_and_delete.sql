-- Two org-layer gaps the invite work surfaced.
--
-- 1. Owners could not delete an agency at all: no delete grant, no policy.
-- 2. The join page could not say whose roster an invite is for, because the
--    invitee has no read on org_invites (the manage policy is the managers').

-- --------------------------------------------------------- 1. delete an agency
--
-- Owner only. The fks cascade seats and invites away with the row; members'
-- deals, videos and money were never the org's, so deleting the workspace
-- costs nobody their work.

grant delete on public.orgs to authenticated;

drop policy if exists orgs_delete_owner on public.orgs;
create policy orgs_delete_owner on public.orgs
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------- 2. peek an invite
--
-- The join page runs OUTSIDE the member gate (an invitee has no seat yet, that
-- is the point of the invite), so it needs one definer read to render "join
-- <org> as <role>" and to say up front when a link is dead or was sent to a
-- different email. Token in, one row out, email masked to a hint.

create or replace function public.peek_org_invite(p_token text)
returns table (org_name text, invite_role text, email_masked text, valid boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select
    o.name,
    i.role,
    left(i.email, 1) || '**' || substring(i.email from position('@' in i.email)),
    (i.accepted_at is null and i.expires_at > now())
  from public.org_invites i
  join public.orgs o on o.id = i.org_id
  where i.token = p_token;
$$;

comment on function public.peek_org_invite(text) is
  'What the join page shows before accepting: org name, role, a masked email hint, and whether the link is still good.';

revoke all on function public.peek_org_invite(text) from public, anon;
grant execute on function public.peek_org_invite(text) to authenticated;
