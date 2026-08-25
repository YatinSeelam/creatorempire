import Link from "next/link";
import { Crumbs, DashBar, Page } from "@/components/dash/ui";
import { NewJobWizard } from "@/components/dash/new-job-wizard";
import { creditsLabel } from "@/lib/credits";
import { loadCreditBalance } from "@/lib/credits-server";
import { EDITOR_MARKET_ENABLED } from "@/lib/editing";
import { loadDealOptions } from "@/lib/editing-server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewEditJobPage() {
  const [deals, balance, supabase] = await Promise.all([
    loadDealOptions(),
    // nothing to spend with the market off, so nothing to read.
    EDITOR_MARKET_ENABLED ? loadCreditBalance() : Promise.resolve(0),
    createClient(),
  ]);

  // the uploader needs a folder before the job has an id, and `user/<id>/` is
  // the one the storage policies let this person write to on their own.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      <DashBar
        lead={
          <Crumbs
            size="lg"
            trail={[{ label: "Editing", href: "/editing" }, { label: "New job" }]}
          />
        }
        right={
          EDITOR_MARKET_ENABLED ? (
            <Link
              href="/editing/credits"
              className="flex h-9 shrink-0 items-center rounded-pill border border-line px-5 text-[14px] font-semibold text-ink-70 transition-colors hover:text-ink"
            >
              {creditsLabel(balance)}
            </Link>
          ) : null
        }
      />

      {/* scrolls normally. the price and the button that leaves the step live
          in a rail that sticks, so the thing `fill` was protecting is protected
          without trapping every card inside its own scroller. */}
      <Page>
        <NewJobWizard deals={deals} balance={balance} userId={user?.id ?? ""} />
      </Page>
    </>
  );
}
