-- The deal shelf, and uploads that happen before a job exists.
--
-- Two things a creator should never have to do twice. The first is upload the
-- same logo, the same three tracks and the same sfx pack for every batch they
-- send a brand. The second is retype the standing instructions that apply to
-- every video that brand ever gets. Both belong to the DEAL, not the job, and
-- both are the same shape: a file on a shelf that every job for that brand can
-- see. That shelf is `deal_assets`, and `kind` is the only thing separating a
-- track from an SOP.
--
-- The other half is the new job form. Uploading there means uploading before
-- the job it belongs to has an id, which the old path contract could not
-- express: `<job_id>/assets/<file>` needs the job. So there is a second prefix,
-- `user/<user_id>/<file>`, which belongs to the person rather than the job, and
-- the edit_job_files row is what later ties it to a job. Nothing is moved when
-- the job is posted: the row is the grant.
--
-- That inverts the access model for those objects, so it is worth being exact
-- about the hole it could open. If "a file row naming this path" were enough to
-- read an object, anyone could post a job, insert a row pointing at somebody
-- else's `user/` path, and read it. Two things close that: the select policy
-- also requires the object's own `owner_id` to match the row's uploader, and
-- the file insert policy requires the path to be under the job's folder or
-- under the uploader's own `user/` prefix.

-- --------------------------------------------------------------- deal_assets

create table if not exists public.deal_assets (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  deal_id uuid not null references public.deals (id) on delete cascade,

  -- `asset` is material that goes on top of a cut: logos, product shots,
  -- music, sfx. `doc` is words the editor reads before cutting: the SOP, the
  -- brand guidelines, the standing brief.
  kind text not null default 'asset' check (kind in ('asset', 'doc')),

  path       text not null unique,
  name       text not null,
  mime       text,
  size_bytes bigint,

  created_at timestamptz not null default now()
);

create index if not exists deal_assets_deal_idx
  on public.deal_assets (deal_id, kind, created_at desc);

alter table public.deal_assets enable row level security;

-- "a shelf I can see" is "a deal I can see". The subquery is itself subject to
-- the deals policies, so org scoping and the founder view come along for free
-- rather than being restated here and drifting.
drop policy if exists deal_assets_select on public.deal_assets;
create policy deal_assets_select on public.deal_assets
  for select to authenticated
  using (
    exists (select 1 from public.deals d where d.id = deal_id)
    -- the editor cannot see the deal, and must still be able to open the
    -- brand's SOP for a job they are actually working.
    or exists (
      select 1 from public.edit_jobs j
      where j.deal_id = deal_assets.deal_id
        and j.editor_id = (select auth.uid())
    )
  );

drop policy if exists deal_assets_insert on public.deal_assets;
create policy deal_assets_insert on public.deal_assets
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.deals d where d.id = deal_id)
  );

drop policy if exists deal_assets_delete on public.deal_assets;
create policy deal_assets_delete on public.deal_assets
  for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.deals d where d.id = deal_id)
  );

-- ------------------------------------------------------------ edit_job_files

-- `doc` joins the three that were there. A brief is often a google doc export
-- or a pdf rather than something anybody wants to retype into a textarea.
alter table public.edit_job_files drop constraint if exists edit_job_files_kind_check;
alter table public.edit_job_files add constraint edit_job_files_kind_check
  check (kind in ('footage', 'asset', 'reference', 'doc', 'cut'));

-- the path guard described at the top. a row may only point at this job's own
-- folder or at the uploader's own user prefix, whatever the client sent.
drop policy if exists job_files_insert on public.edit_job_files;
create policy job_files_insert on public.edit_job_files
  for insert to authenticated
  with check (
    (select auth.uid()) = uploader_id
    and (
      (
        kind in ('footage', 'asset', 'reference', 'doc')
        and (
          path like (job_id::text || '/assets/%')
          or path like ('user/' || (select auth.uid())::text || '/%')
        )
        and exists (
          select 1 from public.edit_jobs j
          where j.id = job_id and j.user_id = (select auth.uid())
        )
      )
      or (
        kind = 'cut'
        and (
          path like (job_id::text || '/cuts/%')
          or path like ('user/' || (select auth.uid())::text || '/%')
        )
        and exists (
          select 1 from public.edit_jobs j
          where j.id = job_id and j.editor_id = (select auth.uid())
        )
      )
    )
  );

-- --------------------------------------------------------------------- bucket

-- The type allowlist came off. It was video/* and image/*, which refuses
-- exactly the things this change is about: an sfx pack, a music bed, a pdf
-- brief, a zip of luts. The bucket is private and only a job's two people can
-- read it, so the 500mb per-file cap is the limit that matters.
update storage.buckets
   set allowed_mime_types = null
 where id = 'editing-assets';

-- ------------------------------------------------------------ storage policies

-- three prefixes now:
--   <job_id>/assets|cuts/<file>  the job's own, unchanged
--   user/<user_id>/<file>        uploaded before the job existed
--   bank/<deal_id>/<file>        the deal's shelf
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
      or (
        (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      or (
        (storage.foldername(name))[1] = 'bank'
        and exists (
          select 1 from public.deals d
          where d.id::text = (storage.foldername(name))[2]
        )
      )
    )
  );

drop policy if exists editing_assets_select on storage.objects;
create policy editing_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'editing-assets'
    and (
      exists (
        select 1 from public.edit_jobs j
        where j.id::text = (storage.foldername(name))[1]
          and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
      )
      -- my own uploads, whether or not they ever reached a job
      or (
        (storage.foldername(name))[1] = 'user'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
      -- somebody else's upload that is recorded on a job I am on. owner_id has
      -- to match the row's uploader or a forged row would be a read grant.
      or exists (
        select 1
        from public.edit_job_files f
        join public.edit_jobs j on j.id = f.job_id
        where f.path = storage.objects.name
          and f.uploader_id::text = storage.objects.owner_id
          and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
      )
      -- the deal's shelf: its owner, and the editor of any job on that deal
      or (
        (storage.foldername(name))[1] = 'bank'
        and (
          exists (
            select 1 from public.deals d
            where d.id::text = (storage.foldername(name))[2]
          )
          or exists (
            select 1 from public.edit_jobs j
            where j.deal_id::text = (storage.foldername(name))[2]
              and j.editor_id = (select auth.uid())
          )
        )
      )
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
      or (
        (storage.foldername(name))[1] = 'bank'
        and exists (
          select 1 from public.deals d
          where d.id::text = (storage.foldername(name))[2]
        )
      )
    )
  );
