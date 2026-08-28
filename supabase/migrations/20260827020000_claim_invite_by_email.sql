-- An invite should be a convenience, not the only key to the door.
--
-- Until now `accept_org_invite(p_token)` was the only path that could seat a
-- person from a session: `authenticated` holds no insert grant on org_members,
-- and the select policy on org_invites needs an owner or admin seat, so an
-- invited person could not even read the row that names them. Every one of
-- those choices is right. What was missing is that the token was load bearing.
-- Somebody added to the programme, who then signed in with the same google
-- account the invite was written to, was told they were not on the roster.
--
-- This is the same accept, keyed on the identity the provider already verified
-- instead of on a secret in a url. It stays `security definer` for exactly the
-- reason the token version does — the insert is not grantable to a session —
-- and it takes no arguments at all, so there is nothing for a caller to lie
-- about: the email comes from auth.users, matched to `auth.uid()`.
create or replace function public.claim_org_invite()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite public.org_invites%rowtype;
begin
  if v_uid is null then
    return null;
  end if;

  -- confirmed only. an unverified address is a claim about an identity, and a
  -- claim must not be able to walk into a programme somebody else was invited
  -- to. google always confirms, so this costs the real path nothing.
  select lower(email)
    into v_email
    from auth.users
   where id = v_uid
     and email_confirmed_at is not null;

  if v_email is null then
    return null;
  end if;

  select *
    into v_invite
    from public.org_invites
   where lower(email) = v_email
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  if not found then
    return null;
  end if;

  insert into public.org_members (org_id, user_id, role, invited_by)
  values (v_invite.org_id, v_uid, v_invite.role, v_invite.invited_by)
  on conflict (org_id, user_id) do update set role = excluded.role;

  update public.org_invites
     set accepted_at = now()
   where id = v_invite.id;

  return v_invite.org_id;
end;
$$;

revoke all on function public.claim_org_invite() from public;
grant execute on function public.claim_org_invite() to authenticated;

comment on function public.claim_org_invite() is
  'Seats the signed-in user from a pending invite matching their confirmed email. Returns the org id, or null when there is nothing to claim.';

-- supabase's default privileges hand `anon` execute on new functions in public,
-- and that is a direct grant, so the `revoke ... from public` above did not
-- touch it. it returns null for a signed-out caller either way, but a seating
-- function an anonymous request may call is not a thing to leave lying around.
revoke execute on function public.claim_org_invite() from anon;
