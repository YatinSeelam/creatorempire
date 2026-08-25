-- Flow, the ai layer. Three tables and nothing else.
--
-- The architectural rule from docs/04-AI-LAYER.md is that flow proposes and a
-- human applies. These tables are the proposal side of that: they hold what the
-- model said and what it wants to write, and they are the ONLY tables the model
-- loop is allowed to touch. Applying a proposal runs the same server action a
-- form runs, against the same rls, as the same user, so an ai can never write a
-- shape the ui could not.
--
-- Nothing here references a deal or a brand by foreign key. A proposal is a
-- claim about the world, not a row in it, and it has to survive the thing it
-- points at being deleted so the thread still reads back.

create table if not exists public.ai_threads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text,
  -- where the composer was opened from, e.g. `/deals/<uuid>`. it is what makes
  -- "the bonus went up to $5 cpm" resolvable without naming the brand.
  page_ref        text,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists ai_threads_user_recent_idx
  on public.ai_threads (user_id, last_message_at desc);

create table if not exists public.ai_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.ai_threads (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  -- the anthropic content block array as sent and received, verbatim. text,
  -- images and tool calls all live in here rather than in columns, because the
  -- next model version adds block kinds and a column per kind does not scale.
  content    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_messages_thread_idx
  on public.ai_messages (thread_id, created_at);

create table if not exists public.ai_proposals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  thread_id     uuid not null references public.ai_threads (id) on delete cascade,
  message_id    uuid references public.ai_messages (id) on delete set null,

  target_entity text not null
    check (target_entity in ('deal', 'bonus_rule', 'deal_account', 'calendar_note')),
  -- null means create. an update carries the id of the row it edits, and that
  -- id is re-read through rls at apply time rather than trusted.
  target_id     uuid,
  op            text not null default 'create' check (op in ('create', 'update')),

  -- the payload, in the same loose shape the matching form posts. it is fed to
  -- the same normalise function, so a patch that would not pass the form does
  -- not pass here either.
  patch         jsonb not null,

  -- the literal span of the input this came from. it is what makes approving a
  -- two second read rather than an act of faith, so it goes on the card.
  evidence      text,
  confidence    numeric check (confidence >= 0 and confidence <= 1),

  -- read off `risk:` in lib/deal-schema.ts, highest field wins. `money` never
  -- auto applies, no matter how confident the model is.
  risk_tier     text not null default 'review'
    check (risk_tier in ('safe', 'review', 'money')),

  -- re-processing the same screenshot must not create a second gymshark deal.
  -- unique per user among live proposals; a rejected one frees the key so a
  -- corrected re-run can take it.
  dedupe_key    text,

  status        text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected', 'applied', 'failed')),
  error         text,

  created_at    timestamptz not null default now(),
  applied_at    timestamptz
);

create index if not exists ai_proposals_user_pending_idx
  on public.ai_proposals (user_id, created_at desc)
  where status = 'proposed';

create index if not exists ai_proposals_thread_idx
  on public.ai_proposals (thread_id, created_at);

-- partial: only live proposals collide. once one is rejected or applied the key
-- is free again, which is what lets a creator fix a bad read and re-send.
create unique index if not exists ai_proposals_dedupe_idx
  on public.ai_proposals (user_id, dedupe_key)
  where dedupe_key is not null and status in ('proposed', 'accepted');

alter table public.ai_threads   enable row level security;
alter table public.ai_messages  enable row level security;
alter table public.ai_proposals enable row level security;

drop policy if exists own_rows on public.ai_threads;
create policy own_rows on public.ai_threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.ai_messages;
create policy own_rows on public.ai_messages for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists own_rows on public.ai_proposals;
create policy own_rows on public.ai_proposals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- select only, same as every other admin_read half: staff can look at a thread
-- and still cannot accept a proposal on somebody's behalf.
create policy "ai_threads_admin_read" on public.ai_threads
  for select to authenticated using ((select private.is_admin()));

create policy "ai_messages_admin_read" on public.ai_messages
  for select to authenticated using ((select private.is_admin()));

create policy "ai_proposals_admin_read" on public.ai_proposals
  for select to authenticated using ((select private.is_admin()));
