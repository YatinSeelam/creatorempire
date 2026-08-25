-- Real files on edit jobs, not just links. A creator uploads raw footage and
-- reference images/videos straight to storage from the browser; an editor
-- uploads finished cuts the same way. The bucket is private end to end and
-- every read goes through a signed url minted for a job participant, so a
-- leaked path is not a leaked video.
--
-- Object paths carry the access model: <job_id>/assets/<file> is the
-- creator's footage and references, <job_id>/cuts/<file> is the editor's
-- deliveries. The storage policies join edit_jobs on that first segment, so
-- who can touch what is the same question RLS already answers for the job.

-- ------------------------------------------------------------- edit_job_files

create table if not exists public.edit_job_files (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.edit_jobs (id) on delete cascade,
  uploader_id uuid not null references auth.users (id) on delete cascade,

  kind text not null default 'footage' check (kind in ('footage', 'reference', 'cut')),

  -- the storage object path inside the editing-assets bucket
  path       text not null unique,
  name       text not null,
  mime       text,
  size_bytes bigint,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_files_job_idx
  on public.edit_job_files (job_id, created_at desc);
create index if not exists edit_job_files_uploader_idx
  on public.edit_job_files (uploader_id);

alter table public.edit_job_files enable row level security;

drop policy if exists job_files_select on public.edit_job_files;
create policy job_files_select on public.edit_job_files
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- footage and references come from the job's owner, cuts from its editor
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (kind in ('footage', 'reference') and exists (
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

-- the uploader tidies their own mistakes, the job owner tidies the job
drop policy if exists job_files_delete on public.edit_job_files;
create policy job_files_delete on public.edit_job_files
  for delete to authenticated
  using (
    (select auth.uid()) = uploader_id
    or exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and j.user_id = (select auth.uid())
    )
  );

-- --------------------------------------------------------------------- bucket

-- 500mb per file, video and image only. the project-level upload cap still
-- applies on top of this; raise it in the dashboard if uploads 413.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'editing-assets',
  'editing-assets',
  false,
  524288000,
  array['video/*', 'image/*']
)
on conflict (id) do nothing;

-- ------------------------------------------------------------ storage policies

drop policy if exists editing_assets_insert on storage.objects;
create policy editing_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'editing-assets'
    and (
      (
        (storage.foldername(name))[2] = 'assets'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.user_id = (select auth.uid())
        )
      )
      or (
        (storage.foldername(name))[2] = 'cuts'
        and exists (
          select 1 from public.edit_jobs j
          where j.id::text = (storage.foldername(name))[1]
            and j.editor_id = (select auth.uid())
        )
      )
    )
  );

-- reads mint signed urls server side, but the minting itself runs as the
-- user, so select has to admit both people on the job and nobody else.
drop policy if exists editing_assets_select on storage.objects;
create policy editing_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'editing-assets'
    and exists (
      select 1 from public.edit_jobs j
      where j.id::text = (storage.foldername(name))[1]
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

drop policy if exists editing_assets_delete on storage.objects;
create policy editing_assets_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'editing-assets'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.edit_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and j.user_id = (select auth.uid())
      )
    )
  );
