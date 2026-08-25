-- run AFTER the schema bundle AND after the owner has signed in with google
-- once (the trigger on orgs seats owner_id, so auth.users needs the row).
-- replace the email with the owner's google email.

-- 1. founder of the platform: reaches /founder, gets in with no seat.
insert into public.admin_emails (email, role)
values (lower('yatinsaireddyseelam@gmail.com'), 'founder')
on conflict (email) do update set role = excluded.role;

-- 2. the one workspace. the insert trigger writes the owner seat into org_members.
insert into public.orgs (slug, name, owner_id)
select 'creator-empire', 'creator empire', u.id
from auth.users u
where lower(u.email) = lower('yatinsaireddyseelam@gmail.com')
on conflict (slug) do nothing;

-- 3. copy this id into NEXT_PUBLIC_CE_ORG_ID (.env.local + vercel), then restart.
select id as next_public_ce_org_id from public.orgs where slug = 'creator-empire';
