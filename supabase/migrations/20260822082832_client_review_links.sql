-- Client review links.
--
-- The gap this closes: a creator does not get to sign off on a cut. Their
-- campaign manager does. Until now the only approve button lived behind a
-- login the brand contact will never have, so the sign-off happened in a dm
-- and the job sat "delivered" until somebody remembered it.
--
-- So: one opaque link per job, `ugcflows.com/review/<token>`. Whoever holds it
-- watches the cuts, leaves feedback, and says approve or changes. That verdict
-- is a SIGNAL, never an action: the creator still taps approve in the
-- dashboard, because approving moves money and a stranger with a url must not
-- be able to spend it. Same for a change request, which the creator forwards,
-- because the included direction round is finite and costs them.
--
--   edit_job_review_links  one row per job, the token, revoke + rotate
--   edit_job_review_notes  every verdict and comment left on that link
--
-- Two security-definer rpcs are the whole public surface. Nothing on the
-- anonymous side gets a table policy, so the only rows a link holder can ever
-- reach are the ones the rpc hands back — no pay, no credits, no editor, no
-- brief. What the creator paid is the creator's business.

-- ---------------------------------------------------------------- the links

create table if not exists public.edit_job_review_links (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null unique references public.edit_jobs (id) on delete cascade,
  -- the job's owner, denormalised so every policy here is one hop, not two
  user_id uuid not null references auth.users (id) on delete cascade,

  -- the capability. stored plain, like a referral code: the creator has to be
  -- able to copy it again tomorrow, and rotating is what kills an old one.
  token text not null unique,

  -- the creator's own note on who is holding it: "acme campaign manager"
  label text,

  revoked_at timestamptz,
  expires_at timestamptz,

  views          integer not null default 0,
  last_viewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists edit_job_review_links_user_idx
  on public.edit_job_review_links (user_id);

-- ---------------------------------------------------------------- the notes

create table if not exists public.edit_job_review_notes (
  id      uuid primary key default gen_random_uuid(),
  job_id  uuid not null references public.edit_jobs (id) on delete cascade,
  link_id uuid not null references public.edit_job_review_links (id) on delete cascade,

  -- which cut they were looking at, when they pointed at one. job-level
  -- feedback leaves it null. set null rather than cascade: the words survive
  -- the editor deleting a cut.
  deliverable_id uuid references public.edit_job_deliverables (id) on delete set null,
  -- the cut number frozen at the time, so the note still reads after that
  version integer not null default 0,

  verdict       text not null check (verdict in ('approved', 'changes', 'comment')),
  reviewer_name text,
  body          text,

  -- what the creator did with it: forwarded, approved past it, or dismissed.
  -- null is the inbox.
  handled_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists edit_job_review_notes_job_idx
  on public.edit_job_review_notes (job_id, created_at desc);
create index if not exists edit_job_review_notes_link_idx
  on public.edit_job_review_notes (link_id, created_at desc);

-- ------------------------------------------------------------------- policies

alter table public.edit_job_review_links enable row level security;
alter table public.edit_job_review_notes enable row level security;

revoke all on public.edit_job_review_links from anon, authenticated;
revoke all on public.edit_job_review_notes from anon, authenticated;

grant select, insert, update, delete on public.edit_job_review_links to authenticated;
grant select, update, delete on public.edit_job_review_notes to authenticated;

-- the link is the creator's alone. the editor never needs the token: they read
-- the feedback through the notes below.
drop policy if exists review_links_own on public.edit_job_review_links;
create policy review_links_own on public.edit_job_review_links
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- the feedback reaches both sides of the job, because "the client wants the
-- hook shorter" is the editor's instruction and retyping it loses it.
drop policy if exists review_notes_select on public.edit_job_review_notes;
create policy review_notes_select on public.edit_job_review_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id
        and ((select auth.uid()) = j.user_id or (select auth.uid()) = j.editor_id)
    )
  );

-- only the creator files a note away, and only the creator can delete one.
drop policy if exists review_notes_handle on public.edit_job_review_notes;
create policy review_notes_handle on public.edit_job_review_notes
  for update to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  )
  with check (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  );

drop policy if exists review_notes_delete on public.edit_job_review_notes;
create policy review_notes_delete on public.edit_job_review_notes
  for delete to authenticated
  using (
    exists (
      select 1 from public.edit_jobs j
      where j.id = job_id and (select auth.uid()) = j.user_id
    )
  );

-- deliberately no insert policy. the rpc below is the only writer, the same
-- shape as account_email_messages: anything that could insert from a session
-- could forge its own client sign-off.

-- ------------------------------------------------------------------ the token

-- pgcrypto lives in `extensions` on supabase, so the pinned search_path has to
-- name it or gen_random_bytes stops resolving.
create or replace function public.new_review_token()
returns text
language sql
volatile
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select translate(encode(gen_random_bytes(16), 'base64'), '+/=', '-_');
$$;

-- --------------------------------------------------------------- open a link

/**
 * Everything the review page renders, for a token, or a refusal.
 *
 * Security definer because the holder has no session and no policy could see
 * a token anyway. The projection IS the access control: the money columns, the
 * brief and the editor never appear in it. Bumps the view counter on the way
 * through, which is the creator's only signal that the link actually landed.
 */
create or replace function public.review_link_room(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link  public.edit_job_review_links;
  v_job   public.edit_jobs;
  v_cuts  jsonb;
  v_notes jsonb;
begin
  if p_token is null or length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;

  select * into v_link from public.edit_job_review_links where token = p_token;
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

  update public.edit_job_review_links
     set views = views + 1, last_viewed_at = now()
   where id = v_link.id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', d.id,
               'url', d.url,
               'note', d.note,
               'version', d.version,
               'created_at', d.created_at
             )
             order by d.version desc, d.created_at desc
           ),
           '[]'::jsonb
         )
    into v_cuts
    from public.edit_job_deliverables d
   where d.job_id = v_job.id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', n.id,
               'verdict', n.verdict,
               'reviewer_name', n.reviewer_name,
               'body', n.body,
               'version', n.version,
               'deliverable_id', n.deliverable_id,
               'created_at', n.created_at
             )
             order by n.created_at desc
           ),
           '[]'::jsonb
         )
    into v_notes
    from public.edit_job_review_notes n
   where n.link_id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'label', v_link.label,
    -- a job that is approved or cancelled is history: the page still shows the
    -- cuts, the buttons are gone.
    'closed', v_job.status in ('approved', 'cancelled'),
    'awaiting_cut', v_job.status in ('open', 'claimed'),
    'job', jsonb_build_object(
      'title', v_job.title,
      'brand_name', v_job.brand_name,
      'brand_logo_key', v_job.brand_logo_key,
      'brand_logo_url', v_job.brand_logo_url,
      'video_count', v_job.video_count,
      'status', v_job.status,
      'delivered_at', v_job.delivered_at,
      'approved_at', v_job.approved_at
    ),
    'cuts', v_cuts,
    'notes', v_notes
  );
end;
$$;

-- ------------------------------------------------------------- leave a verdict

/**
 * The one write an anonymous holder gets. Refuses on a dead link, a finished
 * job, an empty body where one is needed, and more than 20 notes an hour on
 * the same link, which is the whole rate limit and is plenty for one meeting.
 *
 * Returns the job id so the caller can notify. Deliberately does NOT return
 * the owner's user id or email: whoever holds this url is not entitled to know
 * who is on the other end of it beyond the brand already on the page.
 */
create or replace function public.review_link_say(
  p_token       text,
  p_verdict     text,
  p_name        text default null,
  p_body        text default null,
  p_deliverable uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link    public.edit_job_review_links;
  v_status  text;
  v_version integer := 0;
  v_recent  integer;
  v_id      uuid;
  v_name    text;
  v_body    text;
begin
  if p_verdict not in ('approved', 'changes', 'comment') then
    return jsonb_build_object('ok', false, 'reason', 'bad_verdict');
  end if;

  select * into v_link from public.edit_job_review_links where token = p_token;
  if not found or v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now()) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  select status into v_status from public.edit_jobs where id = v_link.job_id;
  if v_status is null or v_status in ('approved', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  v_body := nullif(btrim(coalesce(p_body, '')), '');
  if v_body is null and p_verdict <> 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'body_required');
  end if;
  v_name := left(v_name, 80);
  v_body := left(v_body, 2000);

  select count(*) into v_recent
    from public.edit_job_review_notes
   where link_id = v_link.id and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  -- a cut id from the form is only honoured if it is actually this job's
  if p_deliverable is not null then
    select version into v_version
      from public.edit_job_deliverables
     where id = p_deliverable and job_id = v_link.job_id;
    if v_version is null then
      p_deliverable := null;
      v_version := 0;
    end if;
  end if;

  if p_deliverable is null then
    select coalesce(max(version), 0) into v_version
      from public.edit_job_deliverables where job_id = v_link.job_id;
  end if;

  insert into public.edit_job_review_notes
    (job_id, link_id, deliverable_id, version, verdict, reviewer_name, body)
  values
    (v_link.job_id, v_link.id, p_deliverable, coalesce(v_version, 0),
     p_verdict, v_name, v_body)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'job_id', v_link.job_id);
end;
$$;

revoke all on function public.new_review_token() from public, anon, authenticated;
revoke all on function public.review_link_room(text) from public;
revoke all on function public.review_link_say(text, text, text, text, uuid) from public;

grant execute on function public.new_review_token() to authenticated;
grant execute on function public.review_link_room(text) to anon, authenticated;
grant execute on function public.review_link_say(text, text, text, text, uuid) to anon, authenticated;
