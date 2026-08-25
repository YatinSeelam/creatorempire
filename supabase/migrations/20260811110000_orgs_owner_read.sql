-- An owner can read their own org without going through org_members.
--
-- `createOrg` does `insert(...).select("id").single()`, which postgres runs as
-- `insert ... returning id`, and a RETURNING row is checked against the table's
-- SELECT policies. `orgs_read_member` routes that check through
-- `private.my_org_ids()`, which reads `org_members` — and the membership row is
-- written by the `seat_org_owner` AFTER INSERT trigger, which does not fire until
-- the end of the statement, after RETURNING has already been projected.
--
-- So the owner could not see the org they had just created, for the one instant
-- it was handed back to them, and every "Create agency" failed with:
--
--   new row violates row-level security policy for table "orgs"
--
-- which is the same wording postgres uses for a WITH CHECK failure. The insert
-- itself was always allowed; only the read back was not.
--
-- The fix is a second, cheaper arm on the read: your own org is yours whether or
-- not the seat exists yet. That is also the correct rule on its own terms — an
-- owner whose member row was deleted would otherwise lose all read on an org
-- they still own, with no way back in.
--
-- Deliberately not solved by making the trigger BEFORE INSERT: `org_members`
-- has a foreign key onto `orgs (id)`, so the parent row has to be committed to
-- the statement before the seat can reference it.

drop policy if exists orgs_read_member on public.orgs;
create policy orgs_read_member on public.orgs
  for select to authenticated
  using (
    owner_id = auth.uid()
    or id in (select private.my_org_ids())
  );
