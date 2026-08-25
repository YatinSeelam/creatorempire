/**
 * The reads behind /flow and the rail badge. RLS does the scoping, same as
 * every other loader in the app — there is no user_id filter here to forget.
 */

import { loadAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadWorkspace } from "@/lib/workspace";
import type { ContentBlock, FlowMessage, Proposal, Thread, VisibleTurn } from "./types";

/**
 * No key, no feature. The composer does not render, the rail row does not
 * render, and the route answers 503. This is the same shape the scrapers
 * already use for a missing provider key: a deploy that was never given one
 * still runs, it just has one fewer thing on it.
 */
export function flowEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type FlowAccess = {
  allowed: boolean;
  /** The org whose installed key pays the turn, or null for the platform key. */
  orgId: string | null;
};

/**
 * Who gets flow, and whose key their turns run on. One answer for the rail
 * row, the corner panel, the /flow pages and the turn route, so the four can
 * never disagree — the old shape showed the row to anyone signed in and then
 * had the route answer 403, which read as flow being broken.
 *
 * Two ways in:
 * - the skin org installed its own key (`flow_key_set_at`): everyone under
 *   that org gets flow, billed to the agency's key. This is the whole point
 *   of the key box on /agency/branding.
 * - otherwise the platform's own env key pays, and that is staff only.
 */
export async function flowAccess(): Promise<FlowAccess> {
  const [access, ws] = await Promise.all([loadAccess(), loadWorkspace()]);
  if (!access) return { allowed: false, orgId: null };

  // `ws.brand` is an OrgBrand, the anon-readable theming subset, and the key
  // stamp is deliberately not in it. So the stamp is read here, as the user,
  // through rls: a stranger typing a tenant host is not a member and gets
  // nothing back, which is the same answer as "no key installed".
  const orgId = ws.brand?.id ?? null;
  if (orgId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("orgs")
      .select("flow_key_set_at")
      .eq("id", orgId)
      .maybeSingle();

    if (data?.flow_key_set_at) return { allowed: true, orgId };
  }

  return { allowed: flowEnabled() && access.isFounder, orgId: null };
}

/**
 * The key a turn actually runs on. `orgs.flow_api_key` is a write-only column
 * (UPDATE granted, SELECT revoked), so the only reader is the service client,
 * and the only caller is the turn route — never a component. An org whose key
 * cannot be read gets no silent fall-through to the platform key: that would
 * quietly move their bill onto the product's own account.
 */
export async function flowKeyFor(orgId: string | null): Promise<string | null> {
  if (!orgId) return process.env.ANTHROPIC_API_KEY ?? null;

  const service = createServiceClient();
  if (!service) return null;

  const { data } = await service
    .from("orgs")
    .select("flow_api_key")
    .eq("id", orgId)
    .maybeSingle();

  const key = typeof data?.flow_api_key === "string" ? data.flow_api_key.trim() : "";
  return key || null;
}

/**
 * The number on the rail. It is the whole reason anybody comes back to /flow.
 * Callers gate it on `flowAccess()` themselves; an env-key check here would
 * zero the badge for an org running flow on its own installed key.
 */
export async function pendingCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("ai_proposals")
    .select("id", { count: "exact", head: true })
    .eq("status", "proposed");

  return count ?? 0;
}

/**
 * The conversation list, newest first, each with how many of its cards are
 * still waiting. The count is what puts a dot next to a thread you walked away
 * from, which is the only reason a week-old conversation is worth finding.
 */
export async function loadThreads(limit = 40): Promise<(Thread & { pending: number })[]> {
  const supabase = await createClient();

  const [threads, pending] = await Promise.all([
    supabase
      .from("ai_threads")
      .select("id, title, page_ref, last_message_at, created_at")
      .order("last_message_at", { ascending: false })
      .limit(limit),
    // one read for every waiting card rather than one per thread. rls scopes
    // it, and a creator with hundreds of unanswered cards has a bigger problem
    // than this query.
    supabase.from("ai_proposals").select("thread_id").eq("status", "proposed"),
  ]);

  const counts = new Map<string, number>();
  for (const row of pending.data ?? []) {
    counts.set(row.thread_id, (counts.get(row.thread_id) ?? 0) + 1);
  }

  return ((threads.data ?? []) as Thread[]).map((t) => ({
    ...t,
    pending: counts.get(t.id) ?? 0,
  }));
}

/**
 * A stored message down to what the browser draws.
 *
 * Tool calls and tool results stay on the server. They are how flow works, not
 * what it said, and a transcript full of json is a worse read than the sentence
 * that came out of it.
 */
function toTurn(row: FlowMessage): VisibleTurn | null {
  const blocks: ContentBlock[] = Array.isArray(row.content) ? row.content : [];

  const text = blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  // the block index is part of the url, so the route can go straight to it
  // rather than re-deriving which image was the second one.
  const previews = blocks
    .map((b, i) => (b.type === "image" ? `/api/flow/image/${row.id}?i=${i}` : null))
    .filter((url): url is string => url !== null);

  if (!text && previews.length === 0) return null;

  return {
    id: row.id,
    role: row.role,
    text,
    images: previews.length,
    previews,
    created_at: row.created_at,
  };
}

export type ThreadView = {
  thread: Thread;
  turns: VisibleTurn[];
  proposals: Proposal[];
};

export async function loadThread(id: string): Promise<ThreadView | null> {
  const supabase = await createClient();

  const [thread, messages, proposals] = await Promise.all([
    supabase
      .from("ai_threads")
      .select("id, title, page_ref, last_message_at, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("ai_messages")
      .select("id, thread_id, role, content, created_at")
      .eq("thread_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("ai_proposals")
      .select("*")
      .eq("thread_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!thread.data) return null;

  return {
    thread: thread.data as Thread,
    turns: ((messages.data ?? []) as FlowMessage[]).map(toTurn).filter((t): t is VisibleTurn => t !== null),
    proposals: (proposals.data ?? []) as Proposal[],
  };
}

/** Every card still waiting, newest first. The inbox's default view. */
export async function loadPending(limit = 40): Promise<Proposal[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_proposals")
    .select("*")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []) as Proposal[];
}

/**
 * The blocks a conversation is allowed to be replayed from.
 *
 * Anything the model emitted to operate the app — tool_use, tool_result,
 * thinking — is working state, not conversation, and the api has strict rules
 * about it: a `tool_use` must be followed immediately by its `tool_result` or
 * the whole request is rejected. Rather than try to keep those pairs intact
 * across a database round trip, they are dropped. What is left is what was
 * actually said, which is the only part a later turn needs.
 */
const REPLAYABLE = new Set(["text", "image"]);

/**
 * The thread as the model should see it on the next turn.
 *
 * Two things are load bearing here beyond the read itself:
 *
 * 1. **It sanitises.** Threads written before the route stopped storing tool
 *    traffic contain an assistant `tool_use` with no `tool_result` after it,
 *    and replaying one is a 400 that kills the thread for good. Filtering to
 *    replayable blocks repairs those in place, with no migration and nothing
 *    deleted, and makes it structurally impossible to send a dangling tool
 *    call again whatever the route does.
 *
 * 2. **It keeps the newest messages, not the oldest.** Ordering ascending and
 *    taking the first N would freeze a long conversation on its opening and
 *    never send anything recent — the exact point at which a thread becomes
 *    worth having.
 */
export async function loadTranscript(id: string, window = 40): Promise<FlowMessage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_messages")
    .select("id, thread_id, role, content, created_at")
    .eq("thread_id", id)
    .order("created_at", { ascending: false })
    .limit(window);

  const recent = ((data ?? []) as FlowMessage[]).reverse();

  const clean = recent
    .map((row) => ({
      ...row,
      content: (Array.isArray(row.content) ? row.content : []).filter((b) =>
        REPLAYABLE.has(b.type)
      ),
    }))
    // a message that was nothing but tool traffic is now empty, and an empty
    // content array is itself a 400.
    .filter((row) => row.content.length > 0);

  // the api requires the first message to be a user turn, and windowing can
  // land mid-exchange.
  while (clean.length > 0 && clean[0].role !== "user") clean.shift();

  return clean;
}
