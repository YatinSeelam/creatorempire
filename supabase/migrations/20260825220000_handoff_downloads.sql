-- Downloads on a handoff link, without a service key.
--
-- The room was signing its files with `createServiceClient()`, the same trick
-- the client review room used for cuts. On a deploy with no `SUPABASE_SECRET_KEY`
-- that returns null, every file comes back unsigned and the editor sees
-- "unavailable" against a batch they were sent to download. Which is the whole
-- feature failing on a missing env var.
--
-- So the capability moves into the database, where it belongs. The token is
-- already the proof; this makes storage agree.
--
-- `handoff_object_readable(name)` answers one question: is this object part of
-- a batch that some live handoff link publishes? Security definer, because the
-- tables it reads are revoked from anon on purpose and a policy expression runs
-- with the caller's privileges.
--
-- What it will NEVER say yes to:
--   * a cut. `edit_job_files.kind` is checked, and 'cut' is not in the list, so
--     the work coming back is not readable off the link that sent the work out.
--   * anything on a revoked or expired link.
--   * anything on a job with no link at all.
--
-- Note it is not scoped to ONE token: any live link makes its own job's
-- material readable. That is the same grant the link already confers, and the
-- object path is a uuid inside a uuid, so this widens nothing a link holder
-- could not already fetch.

create or replace function public.handoff_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- the job's own uploads, wherever they were staged: `<job>/assets/<file>`
    -- from the job page, `user/<uid>/<file>` from the wizard before the job
    -- had an id. matched on the file row rather than on the prefix, which is
    -- what keeps a filed cut out: it lives in the same folder and is only
    -- separated from the footage by its `kind`.
    exists (
      select 1
        from public.edit_job_files f
        join public.edit_job_handoff_links l on l.job_id = f.job_id
       where f.path = p_name
         and f.kind in ('footage', 'asset', 'reference', 'doc')
         and l.revoked_at is null
         and (l.expires_at is null or l.expires_at > now())
    )
    -- the brand deal's shelf, which hangs off the deal and is read live by
    -- every batch for that brand.
    or exists (
      select 1
        from public.deal_assets a
        join public.edit_jobs j on j.deal_id = a.deal_id
        join public.edit_job_handoff_links l on l.job_id = j.id
       where a.path = p_name
         and l.revoked_at is null
         and (l.expires_at is null or l.expires_at > now())
    );
$$;

revoke all on function public.handoff_object_readable(text) from public;
grant execute on function public.handoff_object_readable(text) to anon, authenticated;

-- `to anon, authenticated` on purpose. Signing runs as whoever opened the page,
-- and half the people holding a handoff link are signed into something else
-- entirely; a policy for anon alone would work for a stranger and fail for a
-- creator checking their own link in the same browser.
drop policy if exists editing_assets_handoff_read on storage.objects;
create policy editing_assets_handoff_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'editing-assets'
    and public.handoff_object_readable(name)
  );
