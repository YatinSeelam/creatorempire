import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RequestPayoutButton } from "@/components/editors/payout-form";
import { PayoutHistory, type PayoutRow } from "@/components/editors/payout-history";
import { MoneyStat } from "@/components/editors/ui";
import { money } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Payouts · Creator Empire",
  // somebody's own ledger. nothing under here belongs in a search result.
  robots: { index: false, follow: false },
};

/**
 * The money page.
 *
 * Three numbers, the rail they travel down, then the ledger. That order is the
 * question an editor actually asks in the order they ask it: how much, how does
 * it reach me, and did the last one land.
 *
 * Nothing here is a form. Filling in a bank detail is a once-a-year job and it
 * lives in settings; this is the page somebody opens to watch money move, and
 * it should not greet them with an empty text box every time. What it does show
 * is the rail, read only, with a way over to settings to change it.
 *
 * The stripe state is still read here rather than cached, because it is the
 * same `payouts_enabled` that `claim_payout_batch` refuses on: a page that said
 * connected while the rpc said no would send an editor to press a button that
 * cannot work.
 */
export default async function EditorPayoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/editors/payouts");

  const [{ data: payoutRows }, { data: payoutDetails }, { data: stripeRow }] =
    await Promise.all([
      supabase
        .from("editor_payouts")
        .select(
          "id, amount_cents, status, memo, created_at, paid_at, paid_via, batch_id"
        )
        .eq("editor_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("editor_payout_details")
        .select("method, address")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("editor_stripe_accounts")
        .select("details_submitted, payouts_enabled, disabled_reason, requirements_due")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const payouts = (payoutRows ?? []) as PayoutRow[];
  const payoutMethod = String(payoutDetails?.method ?? "paypal");

  // `status` only ever holds 'due' or 'paid'. what separates owed from in
  // flight is the batch stamp: claim_payout_batch sets it, settle clears the
  // row to paid, and fail nulls it back into the owed pool. so due with a
  // batch is money a rail is carrying and due without one is money you can
  // take right now.
  const sum = (rows: PayoutRow[]) =>
    rows.reduce((n, p) => n + p.amount_cents, 0);
  const due = payouts.filter((p) => p.status === "due");
  const availableCents = sum(due.filter((p) => !p.batch_id));
  const pendingCents = sum(due.filter((p) => p.batch_id));
  const paidCents = sum(payouts.filter((p) => p.status === "paid"));

  // stripe is the one rail where having picked it is not the same as being
  // payable: the account has to clear stripe's checks first, and that is the
  // same flag claim_payout_batch refuses on.
  const needsStripe =
    payoutMethod === "stripe" && stripeRow?.payouts_enabled !== true;
  const ready = Boolean(payoutDetails) && !needsStripe;

  return (
    // page-fill: the shell becomes one viewport tall and the ledger takes what
    // is left, so the window never scrolls and the rows move under a header
    // that stays put. inert under lg, where this is one long column.
    // gap, not space-y. the ledger is a flex child that has to GROW into the
    // leftover height, and space-y hands every sibling a margin that the flex
    // algorithm then has to work around; a gap is the container's own spacing
    // and leaves the growth arithmetic alone. everything above the ledger is
    // shrink-0 for the same reason: there is exactly one thing on this page
    // that should change size with the window.
    <div className="page-fill flex flex-col gap-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[clamp(1.5rem,3.4vw,1.95rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
            payouts
          </h1>
          <p className="mt-2 text-[14.5px] text-ink-50">
            track your earnings, manage payout methods, and cash out.
          </p>
        </div>
        {/* the one button on the page, by the title because it is what
            somebody came here to press. */}
        <RequestPayoutButton dueCents={availableCents} />
      </div>

      <div className="grid shrink-0 gap-4 lg:grid-cols-3">
        <MoneyStat
          label="available to cash out"
          value={money(availableCents)}
          note="ready to withdraw"
        />
        <MoneyStat
          label="pending clearance"
          value={money(pendingCents)}
          note={pendingCents > 0 ? "on its way to you" : "nothing in flight"}
        />
        <MoneyStat
          label="paid out total"
          value={money(paidCents)}
          note="all time"
        />
      </div>

      {/* one row, not a panel. this card is a fact and a way to change it, and
          it was eating a third of the page in padding and an info strip that
          repeated what the tiles above it already say. the ledger is what the
          height is for. */}
      <section className="flex shrink-0 flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-paper px-5 py-4 shadow-card sm:px-6">
        <div className="min-w-0">
          <p className="text-[12.5px] text-ink-50">payout method</p>
          <p className="mt-0.5 truncate text-[15px] font-bold tracking-[-0.01em]">
            {ready ? (
              <>
                {RAIL[payoutMethod] ?? payoutMethod}
                {payoutMethod !== "stripe" && payoutDetails?.address && (
                  <span className="font-semibold text-ink-50">
                    {" · "}
                    {payoutDetails.address as string}
                  </span>
                )}
              </>
            ) : needsStripe ? (
              "stripe is still checking your details"
            ) : (
              "not set up yet"
            )}
          </p>
        </div>
        <Link
          href="/editors/settings?tab=payments"
          className="shrink-0 rounded-pill border border-line px-4 py-2 text-[13.5px] font-bold text-ink-70 transition-colors hover:border-flame hover:text-flame-dark"
        >
          {ready ? "change in settings" : "set up payouts"}
        </Link>
      </section>

      <PayoutHistory rows={payouts} />
    </div>
  );
}

/** What an editor calls the rail, not what the column stores. */
const RAIL: Record<string, string> = {
  stripe: "bank or card, via stripe",
  paypal: "paypal",
  venmo: "venmo",
};
