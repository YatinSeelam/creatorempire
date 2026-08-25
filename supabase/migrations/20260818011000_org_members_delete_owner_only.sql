-- Removing somebody from the roster is the owner's call, not a manager's.
--
-- ROLE_NOTE, the docs page and the branding of the whole role model say a
-- manager "reads every creator's deals and money. changes none of them", and
-- that removing people is the one thing an owner has over a manager. The delete
-- policy said otherwise: it keyed on private.managed_org_ids(), which is owners
-- AND managers, so a manager could clear the roster from the creators page.
-- Now: your own seat (leaving), or a seat on a workspace you own.

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    or org_id in (select o.id from public.orgs o where o.owner_id = auth.uid())
  );
