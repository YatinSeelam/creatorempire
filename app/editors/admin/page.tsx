import { notFound } from "next/navigation";
import { markEditorPaid } from "@/app/editors/admin/actions";
import { toApplication } from "@/components/editors/coerce";
import { Panel } from "@/components/editors/ui";
import type { EditorApplication } from "@/lib/editing";
import { money, shortDate } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

/**
 * The editor roster, founder only: everyone who finished the onboarding
 * wizard, everything they answered, newest first.
 *
 * Deliberately self-contained on the gate: it asks `am_i_admin()` itself and
 * 404s for everyone else (an editor probing the url learns nothing exists),
 * then opens the admin-view client for the cross-user reads. It does not
 * import the founder helpers on purpose, so it builds the same on trees from
 * before and after the admin → founder rename.
 */
export const metadata = { title: "editor roster · creator empire" };

export default async function EditorRosterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: isFounder, error } = await supabase.rpc("am_i_admin");
  if (error || !isFounder) notFound();

  // the admin-view client is what satisfies the *_admin_read policies;
  // without the header rls scopes every read back to the founder's own rows.
  const db = await createClient({ adminView: true });

  const [
    { data: applicationRows },
    { data: editorRows },
    { data: payoutRows },
    { data: duePayoutRows },
  ] = await Promise.all([
    db
      .from("editor_applications")
      .select("*")
      .order("created_at", { ascending: false }),
    // name and avatar come off `editors`, not the application: that is where
    // they live, and it is the copy the editor keeps current.
    db.from("editors").select("user_id, tier, status, created_at, name, avatar_url"),
    db
      .from("editor_payout_details")
      .select("user_id, method, address, payout_requested_at"),
    db
      .from("editor_payouts")
      .select("id, editor_id, amount_cents, status, created_at")
      .eq("status", "due"),
  ]);

  const applications = (applicationRows ?? []).map((r) =>
    toApplication(r as Record<string, unknown>)
  );
  const editorBy = new Map(
    (
      (editorRows ?? []) as {
        user_id: string;
        tier: number;
        status: string;
        name: string | null;
        avatar_url: string | null;
      }[]
    ).map(
      (e) => [e.user_id, e]
    )
  );
  const payoutBy = new Map(
    (
      (payoutRows ?? []) as {
        user_id: string;
        method: string;
        address: string;
        payout_requested_at: string | null;
      }[]
    ).map((p) => [p.user_id, p])
  );

  const cell = "px-3 py-2.5 text-[13px] whitespace-nowrap";
  const head =
    "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-50 whitespace-nowrap";

  const row = (a: EditorApplication) => {
    const editor = editorBy.get(a.user_id);
    const payout = payoutBy.get(a.user_id);
    return (
      <tr key={a.user_id} className="border-t border-line align-top">
        <td className={`${cell} font-bold`}>
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-shell text-[12px] font-extrabold text-ink-50">
              {editor?.avatar_url ? (
                // storage and google both, so no domain worth whitelisting
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={editor.avatar_url}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                ((editor?.name || a.name || "?").charAt(0).toUpperCase())
              )}
            </span>
            <span>{editor?.name || a.name}</span>
          </div>
        </td>
        <td className={cell}>
          <div>{a.email ?? "·"}</div>
          <div className="text-ink-50">{a.phone ?? "·"}</div>
          <div className="text-ink-50">{a.discord ? `@${a.discord}` : "·"}</div>
        </td>
        <td className={cell}>
          <div>{a.country ?? a.location ?? "·"}</div>
          <div className="text-ink-50">{a.timezone ?? "·"}</div>
          <div className="text-ink-50">{a.languages ?? "·"}</div>
        </td>
        <td className={`${cell} tabular-nums`}>
          <div>{a.videos_per_day ?? "·"} / day</div>
          <div className="text-ink-50">{a.hours_per_week ?? "·"} h / wk</div>
          <div className="text-ink-50">{a.weekends ? "weekends yes" : "weekends no"}</div>
        </td>
        <td className={`${cell} max-w-[180px] truncate`}>
          {a.software.length ? a.software.join(", ") : "·"}
        </td>
        <td className={cell}>
          {editor ? (
            <>
              <div>tier {editor.tier}</div>
              <div className="text-ink-50">{editor.status}</div>
            </>
          ) : (
            <span className="text-ink-50">no account row</span>
          )}
        </td>
        <td className={cell}>
          {payout ? (
            <>
              <div>{payout.method}</div>
              <div className="max-w-[160px] truncate text-ink-50">{payout.address}</div>
            </>
          ) : (
            <span className="text-ink-50">·</span>
          )}
        </td>
        <td className={`${cell} text-ink-50`}>{shortDate(a.created_at)}</td>
      </tr>
    );
  };

  // the payout queue: everything still owed, grouped per editor, with the
  // address to send it to. sending is by hand on purpose (no processor api
  // moves money on its own); the button only records that it went out.
  const dueByEditor = new Map<string, { cents: number; jobs: number }>();
  for (const p of (duePayoutRows ?? []) as {
    editor_id: string;
    amount_cents: number;
  }[]) {
    const cur = dueByEditor.get(p.editor_id) ?? { cents: 0, jobs: 0 };
    cur.cents += Number(p.amount_cents);
    cur.jobs += 1;
    dueByEditor.set(p.editor_id, cur);
  }
  const nameBy = new Map(applications.map((a) => [a.user_id, a.name]));
  // whoever raised a hand sorts to the top, then by size. everything owed is
  // in the list either way, asked for or not.
  const queue = [...dueByEditor.entries()].sort((a, b) => {
    const asked = (id: string) => (payoutBy.get(id)?.payout_requested_at ? 1 : 0);
    return asked(b[0]) - asked(a[0]) || b[1].cents - a[1].cents;
  });
  const totalDue = queue.reduce((n, [, v]) => n + v.cents, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
          editor roster
        </h1>
        <p className="mt-2 text-[14.5px] text-ink-50">
          {applications.length} registered editor
          {applications.length === 1 ? "" : "s"}, newest first. founder eyes only.
        </p>
      </div>

      <Panel
        title="payouts owed"
        action={
          <span className="text-[13px] text-ink-50">
            {money(totalDue)} owed across {queue.length} editor
            {queue.length === 1 ? "" : "s"}
          </span>
        }
        padded={false}
      >
        {queue.length === 0 ? (
          <p className="px-5 py-6 text-center text-[14px] text-ink-50">
            nobody is owed anything right now. approved jobs land here as due.
          </p>
        ) : (
          <ul>
            {queue.map(([editorId, sums]) => {
              const payout = payoutBy.get(editorId);
              return (
                <li
                  key={editorId}
                  className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold">
                      {nameBy.get(editorId) ?? editorId.slice(0, 8)}
                      <span className="text-[13px] font-normal text-ink-50">
                        {sums.jobs} job{sums.jobs === 1 ? "" : "s"}
                      </span>
                    </p>
                    <p className="text-[13px] text-ink-50">
                      {payout
                        ? `${payout.method} · ${payout.address}`
                        : "no payout address saved yet, hold this one"}
                    </p>
                  </div>
                  <p className="text-[16px] font-extrabold tabular-nums">
                    {money(sums.cents)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-50">
          editors cash out themselves and paypal sends it. this is the balance
          they have not taken yet, nothing here needs doing.
        </p>
      </Panel>

      <Panel title="everyone" padded={false}>
        {applications.length === 0 ? (
          <p className="px-5 py-8 text-center text-[14px] text-ink-50">
            nobody yet. the wizard at /editors is the front door.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className={head}>name</th>
                  <th className={head}>contact</th>
                  <th className={head}>where</th>
                  <th className={head}>capacity</th>
                  <th className={head}>software</th>
                  <th className={head}>account</th>
                  <th className={head}>payout</th>
                  <th className={head}>signed up</th>
                </tr>
              </thead>
              <tbody>{applications.map(row)}</tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
