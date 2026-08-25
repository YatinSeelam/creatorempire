import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationStatusForm } from "@/components/dash/application-status";
import { Empty, Panel, Pill, Stat } from "@/components/dash/ui";
import { markEditorPayoutPaid } from "./actions";
import {
  APPLICATION_LABEL,
  APPLICATION_STATUSES,
  asStringList,
  type ApplicationStatus,
  type EditorApplication,
} from "@/lib/editing";
import { ago, money } from "@/lib/money";
import { requireFounderView } from "@/lib/supabase/founder";

export const metadata: Metadata = {
  title: "Editors · Creator Empire",
  robots: { index: false },
};

/**
 * Everybody who applied off /editors, newest first.
 *
 * `requireFounderView` rather than `requireFounder`: `editor_applications` carries
 * the same admin-read policy as every other table here, so without the
 * `x-admin-view` client this page would show staff their own application and
 * nothing else.
 *
 * Contact details are the point of the page. They live on this table and never
 * on `editors`, which goes public the moment somebody publishes a portfolio.
 */
export default async function AdminEditorsPage() {
  const { supabase } = await requireFounderView("/founder/editors");

  const { data: rows } = await supabase
    .from("editor_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const applications = (rows ?? []).map((r) => ({
    ...(r as unknown as EditorApplication),
    software: asStringList((r as Record<string, unknown>).software),
  }));

  // the public page link, for anyone who built and published one here. RLS
  // only surfaces published rows, which is exactly the set worth linking.
  const { data: editorRows } = await supabase
    .from("editors")
    .select("user_id, handle, published, reel");
  const handles = new Map(
    (editorRows ?? [])
      .filter((e) => e.published && e.handle)
      .map((e) => [e.user_id as string, e.handle as string])
  );

  // the money the platform owes editors: approved jobs whose payout is still
  // `due`. the creator already paid in credits at post time, so paying these
  // is the founder's job, off the details each editor saved.
  const [{ data: payoutRows }, { data: detailRows }] = await Promise.all([
    supabase
      .from("editor_payouts")
      .select("id, editor_id, amount_cents, memo, status, created_at")
      .eq("status", "due")
      .order("created_at", { ascending: true }),
    supabase.from("editor_payout_details").select("user_id, method, address"),
  ]);

  const details = new Map(
    (detailRows ?? []).map((d) => [
      d.user_id as string,
      `${d.method}: ${d.address}`,
    ])
  );
  const names = new Map(applications.map((a) => [a.user_id, a.name]));
  const payouts = (payoutRows ?? []) as {
    id: string;
    editor_id: string;
    amount_cents: number;
    memo: string | null;
    created_at: string;
  }[];
  const dueCents = payouts.reduce((n, p) => n + p.amount_cents, 0);

  const count = (s: ApplicationStatus) =>
    applications.filter((a) => a.status === s).length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Applications" value={String(applications.length)} />
        <Stat label="New" value={String(count("new"))} note="not looked at yet" />
        <Stat label="Hired" value={String(count("hired"))} />
        <Stat
          label="Owed to editors"
          value={money(dueCents)}
          note={`${payouts.length} payout${payouts.length === 1 ? "" : "s"} due`}
        />
      </div>

      <Panel
        title="Payouts due"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            mark paid once the money has actually moved
          </span>
        }
      >
        {payouts.length === 0 ? (
          <p className="px-5 py-6 text-[13.5px] text-ink-50">
            nothing owed right now. approved jobs land here.
          </p>
        ) : (
          <ul>
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-4 border-b border-line px-5 py-4 last:border-b-0 sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-bold tabular-nums">
                      {money(p.amount_cents)}
                    </span>
                    <span className="text-[14px] font-semibold">
                      {names.get(p.editor_id) ?? "unknown editor"}
                    </span>
                    <Pill tone="quiet">{p.memo ?? "edit job"}</Pill>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink-50">
                    {details.get(p.editor_id) ?? "no payout details saved yet"} ·
                    approved {ago(p.created_at)}
                  </p>
                </div>
                <form action={markEditorPayoutPaid}>
                  <input type="hidden" name="payout_id" value={p.id} />
                  <button
                    type="submit"
                    className="rounded-pill border border-line px-4 py-2 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
                  >
                    Mark paid
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Editor applications" padded={false}>
        {applications.length === 0 ? (
          <Empty
            title="nobody has applied yet"
            line="the job post lives at /editors. that is the link to paste."
          />
        ) : (
          <ul>
            {applications.map((a) => {
              const handle = handles.get(a.user_id);
              return (
                <li
                  key={a.user_id}
                  className="border-b border-line px-5 py-5 last:border-b-0 sm:px-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-[15px] font-bold tracking-[-0.015em]">
                          {a.name}
                        </span>
                        <Pill>{APPLICATION_LABEL[a.status]}</Pill>
                        <span className="text-[12.5px] text-ink-50">
                          applied {ago(a.created_at)}
                        </span>
                      </div>

                      <p className="mt-1.5 text-[13px] text-ink-70">
                        {[a.phone, a.email, a.discord, a.location]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </p>

                      <p className="mt-1.5 text-[13px] text-ink-50">
                        {[
                          a.videos_per_day != null
                            ? `${a.videos_per_day} videos a day`
                            : null,
                          a.hours_per_week != null
                            ? `${a.hours_per_week} hrs a week`
                            : null,
                          a.weekends ? "weekends ok" : null,
                          a.software.length ? a.software.join(", ") : null,
                        ]
                          .filter(Boolean)
                          .join("  ·  ") || "no availability given"}
                      </p>

                      {a.experience && (
                        <p className="mt-2 max-w-[70ch] text-[13.5px] leading-[1.5] text-ink-70">
                          {a.experience}
                        </p>
                      )}
                      {a.note && (
                        <p className="mt-1.5 max-w-[70ch] text-[13px] leading-[1.5] text-ink-50">
                          {a.note}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-4">
                        {a.portfolio_url && (
                          <a
                            href={a.portfolio_url}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-[13px] font-semibold text-flame"
                          >
                            their portfolio
                          </a>
                        )}
                        {handle && (
                          <Link
                            href={`/e/${handle}`}
                            className="text-[13px] font-semibold text-flame"
                          >
                            /e/{handle}
                          </Link>
                        )}
                        <Link
                          href={`/founder/people/${a.user_id}`}
                          className="text-[13px] font-semibold text-ink-50 hover:text-ink"
                        >
                          account
                        </Link>
                      </div>
                    </div>

                    <ApplicationStatusForm userId={a.user_id} status={a.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-[13px] text-ink-50">
        statuses: {APPLICATION_STATUSES.map((s) => APPLICATION_LABEL[s]).join(", ")}.
        the applicant sees the wording for whichever one is set.
      </p>
    </div>
  );
}
