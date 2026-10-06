-- creatorempire11@gmail.com runs the programme, so they hold the platform's
-- founder grant beside the admin seat they already had.
--
-- Two different facts, and this writes the one that was missing. The admin
-- seat on `org_members` (held since 2026-08-28, claimed off an invite) is what
-- runs THIS workspace: the roster, invites, modules. The founder grant on
-- `admin_emails` is what opens /founder: the people list, the access picker,
-- view-as, and every `*_admin_read` policy behind `x-admin-view`. "Manage the
-- students" is the second one, and until this row the only founder was the
-- platform's own account.
--
-- Applied live on 2026-10-06 01:55 UTC through the service client, before this
-- file was written; the file is the record. Idempotent: a row already carrying
-- `founder` is left alone, a `creator` grant would be raised to founder.
--
-- The seat is deliberately NOT written here. It exists, it is `admin`, and the
-- owner seat (`orgs.owner_id`, pinned by trigger) stays with the platform
-- account: branding, the flow key and deleting the workspace are the owner's,
-- and handing those over is a separate decision this does not make.

insert into public.admin_emails (email, role)
values ('creatorempire11@gmail.com', 'founder')
on conflict (email) do update set role = 'founder';
