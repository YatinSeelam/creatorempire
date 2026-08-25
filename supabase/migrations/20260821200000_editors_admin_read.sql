-- the founder roster reads every editors row, published or not. the public
-- policy only shows published-or-own, so unpublished wizard signups were
-- invisible to the admin-view client. same shape as every other admin read:
-- founder on admin_emails AND the x-admin-view opt-in header.
create policy editors_admin_read on public.editors
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));
