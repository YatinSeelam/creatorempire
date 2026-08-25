-- Editor handoff links, and manual delivery.
--
-- Creator empire has no editor marketplace. Nobody claims a job off a board
-- here: a student already has an editor, usually on discord or telegram, and
-- that person will never hold a login on this deploy. What they were doing
-- instead was zipping the footage into a drive folder and retyping the brief
-- into a dm, which is exactly the pile the job row already is.
--
-- So a job mints one opaque url, `creatorempire.app/handoff/<token>`, and
-- whoever holds it sees the whole batch on one page: the brief, the style, the
-- references, every uploaded video, the brand's shelf, all of it downloadable.
-- That page is READ ONLY on purpose. Delivery is manual — the editor sends the
-- finished cut back the way they always did, and the creator uploads it here.
--
--   edit_job_handoff_links   one row per job, the token, revoke + rotate
--
-- The same shape as edit_job_review_links, and for the same reason: the review
-- link points at the person who signs a cut off, this one points at the person
-- who makes it. One security-definer rpc is the whole public surface, and its
-- projection IS the access control — no pay, no credits, no owner, no cuts.
--
-- The second half of the file is the manual delivery: the job's OWNER may now
-- write a cut, which until today only a claimed editor could do.

-- ---------------------------------------------------------------- the links

create table if not exists public.edit_job_handoff_links (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null unique references public.edit_jobs (id) on delete cascade,
  -- the job's owner, denormalised so every policy here is one hop, not two
  user_id uuid not null references auth.users (id) on delete cascade,

  -- the capability. stored plain: the creator has to be able to copy it again
  -- tomorrow, and rotating is what kills an old one.
  token text not null unique,

  -- the creator's own note on who is holding it: "raj, my editor"
  label text,

  revoked_at timestamptz,
  expires_at timestamptz,

  views          integer not null default 0,
  last_viewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_job_handoff_links_user_idx
  on public.edit_job_handoff_links (user_id);

alter table public.edit_job_handoff_links enable row level security;

revoke all on public.edit_job_handoff_links from anon, authenticated;
grant select, insert, update, delete on public.edit_job_handoff_links to authenticated;

-- the link is the creator's alone. nothing on the anonymous side gets a table
-- policy at all: the rpc below is the only way a token turns into rows.
drop policy if exists handoff_links_own on public.edit_job_handoff_links;
create policy handoff_links_own on public.edit_job_handoff_links
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- --------------------------------------------------------------- open a link

/**
 * Everything the handoff page renders, for a token, or a refusal.
 *
 * Security definer because the holder has no session and no policy could see a
 * token anyway. The projection is the access control: pay_cents, pay_kind,
 * credits, user_id, editor_id and every deliverable are absent from it, so this
 * page could not leak what the batch cost or what came back if it tried.
 *
 * Files come back as bucket PATHS, not urls. The bucket is private, so a path
 * is worth nothing on its own; the app signs them with the service key on the
 * way out, the same trick `signCuts` uses for the review room.
 *
 * Bumps the view counter on the way through, which is the creator's only
 * signal that the link actually landed.
 */
create or replace function public.handoff_link_room(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link   public.edit_job_handoff_links;
  v_job    public.edit_jobs;
  v_files  jsonb;
  v_shelf  jsonb;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into v_link from public.edit_job_handoff_links where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  if v_link.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked');
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_job from public.edit_jobs where id = v_link.job_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  update public.edit_job_handoff_links
     set views = views + 1, last_viewed_at = now()
   where id = v_link.id;

  -- everything the creator put on the job. cuts are deliberately excluded: this
  -- is the material going out, not the work coming back.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', f.id,
               'kind', f.kind,
               'path', f.path,
               'name', f.name,
               'mime', f.mime,
               'size_bytes', f.size_bytes
             )
             order by f.kind, f.created_at
           ),
           '[]'::jsonb
         )
    into v_files
    from public.edit_job_files f
   where f.job_id = v_job.id
     and f.kind in ('footage', 'asset', 'reference', 'doc');

  -- the brand deal's shelf, read live off the deal rather than copied onto the
  -- job, which is the same thing the dashboard does with it.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', a.id,
               'kind', a.kind,
               'path', a.path,
               'name', a.name,
               'mime', a.mime,
               'size_bytes', a.size_bytes
             )
             order by a.kind, a.created_at
           ),
           '[]'::jsonb
         )
    into v_shelf
    from public.deal_assets a
   where v_job.deal_id is not null and a.deal_id = v_job.deal_id;

  return jsonb_build_object(
    'ok', true,
    'label', v_link.label,
    -- a job that is approved or cancelled is history. the page still opens, it
    -- just says so at the top instead of reading like live work.
    'closed', v_job.status in ('approved', 'cancelled'),
    'delivered', v_job.status in ('delivered', 'approved'),
    'job', jsonb_build_object(
      'title', v_job.title,
      'brand_name', v_job.brand_name,
      'brand_logo_key', v_job.brand_logo_key,
      'brand_logo_url', v_job.brand_logo_url,
      'video_count', v_job.video_count,
      'tier', v_job.tier,
      'is_rush', v_job.is_rush,
      'brief', v_job.brief,
      'style', v_job.style,
      'format', v_job.format,
      'footage_links', coalesce(v_job.footage_links, '[]'::jsonb),
      'reference_links', coalesce(v_job.reference_links, '[]'::jsonb),
      'status', v_job.status,
      'due_at', v_job.due_at,
      'created_at', v_job.created_at
    ),
    'files', v_files,
    'shelf', v_shelf
  );
end;
$$;

revoke all on function public.handoff_link_room(text) from public;
grant execute on function public.handoff_link_room(text) to anon, authenticated;

-- ---------------------------------------------------- manual delivery

-- The editor on the other end of a handoff link has no account, so nothing
-- they do can write a row here. The cut comes back over whatever channel they
-- already use and the CREATOR uploads it, which is the one thing the old
-- policies refused: a cut could only be written by a claimed editor, and a job
-- handed off through a link never has one.
--
-- Both policies below are the previous version plus one branch. The editor
-- branch is untouched, because the marketplace code still runs on ugc flows.

-- a cut written by the job's owner lands in the job's own `assets/` folder,
-- which is the only prefix the storage policy already lets them write to. no
-- storage policy changes here on purpose: one less thing to get wrong.
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
      or (
        -- the manual delivery: the owner filing the cut their editor sent back
        kind = 'cut'
        and (
          path like (job_id::text || '/assets/%')
          or path like ('user/' || (select auth.uid())::text || '/%')
        )
        and exists (
          select 1 from public.edit_jobs j
          where j.id = job_id and j.user_id = (select auth.uid())
        )
      )
    )
  );

-- `editor_id` on a deliverable means "who filed this", and on a manual
-- delivery that is the creator. It is never read as an entitlement: the payout
-- is keyed off `edit_jobs.editor_id`, which stays null on a handoff job, so
-- approving one pays nobody rather than paying the creator themselves.
drop policy if exists deliverables_insert on public.edit_job_deliverables;
create policy deliverables_insert on public.edit_job_deliverables
  for insert to authenticated
  with check (
    (select auth.uid()) = editor_id
    and exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and (j.editor_id = (select auth.uid()) or j.user_id = (select auth.uid()))
    )
  );

-- the owner can also clear a cut they filed by mistake. the editor keeps their
-- own delete, which is what the old policy said and all it said.
drop policy if exists deliverables_delete_own on public.edit_job_deliverables;
create policy deliverables_delete_own on public.edit_job_deliverables
  for delete to authenticated
  using (
    (select auth.uid()) = editor_id
    or exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and j.user_id = (select auth.uid())
    )
  );
