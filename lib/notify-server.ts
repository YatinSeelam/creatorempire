/**
 * The bell: writes and reads. Server only.
 *
 * `push()` is the single writer and it holds the service key, because almost
 * every notification is written by the OTHER party's session — the editor
 * claims a job and the CREATOR is told. There is no insert policy on the table
 * for exactly that reason: a session-scoped one would have to say "anybody may
 * write to anybody's bell", which is a spam endpoint.
 *
 * Every push is best effort and swallows its own errors. The thing being
 * announced has already happened and has already been committed by the caller;
 * a bell row that failed to write must never turn a successful claim into an
 * error on somebody's screen. Same contract as lib/email/send.ts.
 *
 * With no `SUPABASE_SECRET_KEY` the bell simply never fills, which is the
 * degraded state the email path already has.
 */

import type { Notification, NotifKind } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type PushInput = {
  /** who it happened TO. never the person who caused it. */
  userId: string;
  kind: NotifKind;
  title: string;
  body?: string | null;
  /** an in-app path, `/editing/<id>`. never an absolute url. */
  href?: string | null;
  /** what it is about, normally the job id. */
  subject?: string | null;
};

/** How many rows the bell holds before older ones stop being kept. */
const KEEP = 60;

export async function push(input: PushInput): Promise<void> {
  await pushMany([input]);
}

/**
 * One insert for a batch. Used where a single event has two audiences — a
 * client approving tells the creator, approving tells the editor — so the two
 * rows are one round trip rather than two.
 */
export async function pushMany(rows: PushInput[]): Promise<void> {
  const wanted = rows.filter((r) => r.userId && r.title);
  if (wanted.length === 0) return;

  const service = createServiceClient();
  if (!service) return;

  try {
    const { error } = await service.from("notifications").insert(
      wanted.map((r) => ({
        user_id: r.userId,
        kind: r.kind,
        title: r.title.slice(0, 160),
        body: r.body ? r.body.slice(0, 400) : null,
        // a stored href is rendered into a <Link>, so it has to be a path.
        // anything that could be read as an origin is dropped rather than
        // cleaned: there is no legitimate caller passing one.
        href: r.href && /^\/[^/]/.test(r.href) ? r.href.slice(0, 300) : null,
        subject: r.subject ?? null,
      }))
    );
    if (error) throw new Error(error.message);

    // trim per person, not globally: one busy creator must not push a quiet
    // one's history out. cheap because it only ever runs for the people who
    // just received something.
    await Promise.all([...new Set(wanted.map((r) => r.userId))].map((id) => trim(service, id)));
  } catch (err) {
    console.error("[notify] push failed", err instanceof Error ? err.message : err);
  }
}

/** Keep the newest KEEP rows for this person and drop the rest. */
async function trim(
  service: NonNullable<ReturnType<typeof createServiceClient>>,
  userId: string
): Promise<void> {
  const { data } = await service
    .from("notifications")
    .select("created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(KEEP, KEEP);

  const edge = (data ?? [])[0]?.created_at as string | undefined;
  if (!edge) return;

  await service
    .from("notifications")
    .delete()
    .eq("user_id", userId)
    .lte("created_at", edge);
}

// ------------------------------------------------------------------- reading

export type NotifFeed = { rows: Notification[]; unread: number };

/** How many the panel shows. Older than this is history nobody scrolls to. */
const PAGE = 20;

/**
 * The rail's read: the newest page and the unread count, in one round trip
 * each. Runs on the caller's own client and RLS scopes it, so this needs no
 * user argument and cannot be pointed at somebody else.
 *
 * Returns an empty feed rather than throwing. It is rendered inside a layout,
 * so a failure here would take down every page of the app to report that a
 * bell is empty.
 */
export async function loadNotifications(): Promise<NotifFeed> {
  try {
    const supabase = await createClient();
    const [list, count] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(PAGE),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null),
    ]);

    return {
      rows: (list.data ?? []) as Notification[],
      unread: count.count ?? 0,
    };
  } catch (err) {
    console.error("[notify] read failed", err instanceof Error ? err.message : err);
    return { rows: [], unread: 0 };
  }
}
