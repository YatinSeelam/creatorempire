-- a fourth file kind: 'asset'.
--
-- "footage" was doing two jobs at once. The talking head an editor actually
-- cuts and the pile of b-roll, music and product stills they cut it WITH are
-- different things to a person opening the job, even though they are the same
-- thing to storage. One list of nineteen files with no separation is the
-- editor's problem, not the creator's, which is exactly why it kept happening.
--
--   footage   the videos to edit. the raw talking head
--   asset     the bits that go on top: clips, audio, images
--   reference links only now, so nothing is uploaded under this kind
--   cut       what the editor sends back
--
-- Storage is untouched. The object path stays <job>/assets/<file> for
-- everything the creator uploads, and the storage policies key on that first
-- segment rather than on this column, so nothing about who can read what
-- moves.

alter table public.edit_job_files
  drop constraint if exists edit_job_files_kind_check;

alter table public.edit_job_files
  add constraint edit_job_files_kind_check
  check (kind in ('footage', 'asset', 'reference', 'cut'));

-- the insert policy decides which side may write which kind, so the new kind
-- has to be named there too or the creator's upload is refused by rls.
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (kind in ('footage', 'asset', 'reference') and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.user_id = (select auth.uid())
      ))
      or
      (kind = 'cut' and exists (
        select 1 from public.edit_jobs j
        where j.id = job_id and j.editor_id = (select auth.uid())
      ))
    )
  );
