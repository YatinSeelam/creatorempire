import Link from "next/link";
import { Crumbs, DashBar, Page, Panel, Pill, Row, Stat } from "@/components/dash/ui";
import { CreditsShop } from "@/components/dash/credits-shop";
import { creditsLabel, LEDGER_LABEL } from "@/lib/credits";
import { loadCreditBalance, loadCreditLedger } from "@/lib/credits-server";
import { ago } from "@/lib/money";

// the wallet must never render from a cache: a stale balance oversells.
export const dynamic = "force-dynamic";

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ paid?: string }>;
}) {
  const [{ paid }, balance, ledger] = await Promise.all([
    searchParams,
    loadCreditBalance(),
    loadCreditLedger(),
  ]);

  const bought = ledger
    .filter((r) => r.kind === "purchase")
    .reduce((n, r) => n + r.delta, 0);
  const spent = ledger
    .filter((r) => r.delta < 0)
    .reduce((n, r) => n - r.delta, 0);

  return (
    <>
      <DashBar
        lead={
          <Crumbs
            size="lg"
            trail={[{ label: "Editing", href: "/editing" }, { label: "Credits" }]}
          />
        }
        right={
          <Link
            href="/editing/new"
            className="flex h-9 shrink-0 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
          >
            Post a job
          </Link>
        }
      />

      <Page className="space-y-6">
        {paid === "1" && (
          <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
            Payment received. The credits land within a few seconds; refresh if the
            balance has not moved yet.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Balance"
            value={creditsLabel(balance)}
            note="1 credit = $1 of editing"
          />
          <Stat label="Bought" value={creditsLabel(bought)} note="all time" />
          <Stat label="Spent on jobs" value={creditsLabel(spent)} note="all time" />
        </div>

        <Panel
          title="Buy credits"
          sub="A reaction video is 1 credit a video, everything else is 2, rush adds 1. The price appears on the job form before you post, and cancelling an unclaimed job refunds in full."
        >
          <CreditsShop />
        </Panel>

        <Panel
          title="History"
          padded={false}
          action={<span className="text-[13px] text-ink-50">Newest on top</span>}
        >
          {ledger.length === 0 && (
            <p className="px-5 py-8 text-center text-[13.5px] text-ink-50">
              Nothing yet. Buy a pack above and it shows up here.
            </p>
          )}
          {ledger.map((row) => (
            <Row key={row.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14.5px] font-semibold">
                    {LEDGER_LABEL[row.kind]}
                  </span>
                  {row.job_id && (
                    <Link
                      href={`/editing/${row.job_id}`}
                      className="text-[12.5px] font-semibold text-ink-50 hover:text-flame-dark"
                    >
                      view job
                    </Link>
                  )}
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-50">
                  {row.memo ? `${row.memo} · ` : ""}
                  {ago(row.created_at)}
                </p>
              </div>
              <Pill tone={row.delta > 0 ? "flame" : "quiet"}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </Pill>
            </Row>
          ))}
        </Panel>
      </Page>
    </>
  );
}
