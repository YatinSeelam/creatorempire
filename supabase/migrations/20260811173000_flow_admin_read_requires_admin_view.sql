-- Flow's three tables were leaking every admin's chat to every other admin.
--
-- The schema's rule is that a staff-wide read only fires when the request opts
-- in with `x-admin-view: 1`, which `private.admin_view()` checks alongside
-- `private.is_admin()`. Twenty-four tables carry that pair. These three carried
-- only the `is_admin()` half, so an admin's OWN /flow — a plain `createClient()`
-- with no header on it — matched the admin policy as well as `own_rows` and
-- listed the threads, messages and proposals of every other admin account.
--
-- Nothing under /admin reads these tables, so nothing depended on the wide
-- read. This also closes the resume path in app/api/flow/turn/route.ts, which
-- looks a thread up by id with no user filter because it trusts rls to scope it.

drop policy if exists ai_threads_admin_read on public.ai_threads;
create policy ai_threads_admin_read on public.ai_threads
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists ai_messages_admin_read on public.ai_messages;
create policy ai_messages_admin_read on public.ai_messages
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));

drop policy if exists ai_proposals_admin_read on public.ai_proposals;
create policy ai_proposals_admin_read on public.ai_proposals
  for select to authenticated
  using ((select private.is_admin()) and (select private.admin_view()));
