import { notFound } from "next/navigation";
import { Crumbs, DashBar, FoldPanel, Page, Pill, Reveal, Row } from "@/components/dash/ui";
import { ConfirmSubmit, Select, Submit } from "@/components/dash/form";
import {
  AccountHandleForm,
  BrandForm,
  EditDealForm,
  RuleForm,
} from "@/components/dash/deal-forms";
import { deleteDeal, moveDeal, removeAccount, removeRule } from "../../actions";
import { ConnectButton } from "@/components/dash/connect-button";
import { DealShelf } from "@/components/dash/deal-shelf";
import { DealTabs } from "@/components/dash/deal-tabs";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { loadConnections } from "@/lib/autopost/server";
import { loadWorkspace } from "@/lib/workspace";
import { PLATFORMS, PLATFORM_LABEL, profileUrl, ruleIsClosed } from "@/lib/deals";
import { quoteRule, ruleChips, ruleHeadline, ruleLadder } from "@/lib/bonus";
import { loadDeal } from "@/lib/deals-server";
import { loadDealAssets } from "@/lib/editing-files";
import { createClient } from "@/lib/supabase/server";
import { ago, money, views as fmtViews } from "@/lib/money";

/**
 * Everything that changes a deal, in one place a button away from it.
 *
 * These folds used to sit under the deal's numbers, which meant opening a deal
 * showed six closed headers and no numbers at all. Splitting them out is the
 * whole point: /deals/[id] reads and this writes, so neither has to make room
 * for the other.
 *
 * Every form here posts to the same actions it always did. Nothing about the
 * writes changed with the move.
 */
export default async function DealEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [
    detail,
    {
      data: { user },
    },
    ws,
  ] = await Promise.all([loadDeal(id), supabase.auth.getUser(), loadWorkspace()]);
  if (!detail || !user) notFound();

  const { deal, brand, rules, videos } = detail;
  // the same switch that used to hide the Social rail row. cache()d per request,
  // so the rail has already paid for this read.

  // Connecting for posting IS adding the account, so this runs before the
  // accounts are read: it refreshes what Upload-Post says is connected and
  // writes the tracking rows those connections imply. Coming back from the
  // connect page therefore lands on a section that already shows the handle,
  // rather than one that still says nothing is here.
  const connections = await loadConnections(supabase, user.id, deal.id);
  // only the accounts can have changed, so this re-reads one table rather than
  // the whole deal again (which is six queries and two rpcs).
  const { data: reread } = await supabase
    .from("deal_accounts")
    .select("*")
    .eq("deal_id", deal.id)
    .order("platform");
  const accounts = (reread as typeof detail.accounts | null) ?? detail.accounts;

  // the brand's shelf. read here rather than inside loadDeal because it is
  // editing's table, not the tracker's, and only this page and the job pages
  // ever want it.
  const shelf = await loadDealAssets(supabase, deal.id);

  // one account per platform per deal. the handle box now lives on the row for
  // the platform it fills, so "which platforms are free" is the row itself and
  // no longer needs computing: a taken row shows the handle instead of a box.

  // handles connected for posting that are somehow not the deal's account for
  // that platform. after the reconcile above this is only ever a platform whose
  // row was typed in by hand with a different handle, which is a disagreement
  // worth showing rather than resolving behind their back.
  const mismatched = PLATFORMS.flatMap((platform) => {
    const live = connections.connected[platform];
    const row = accounts.find((a) => a.platform === platform);
    return live && row && row.handle.toLowerCase() !== live.toLowerCase()
      ? [{ platform, posting: live, tracking: row.handle }]
      : [];
  });

  const now = new Date();
  const openRules = rules.filter((r) => !ruleIsClosed(r, now));

  // the best a single post has done under each rule's own window, which is what
  // the ladder is drawn against. `countableViews` is video → rule → views, so
  // this is the max down the second axis.
  const bestViewsByRule = new Map<string, number>();
  for (const byRule of detail.countableViews.values()) {
    for (const [ruleId, seen] of byRule) {
      bestViewsByRule.set(ruleId, Math.max(bestViewsByRule.get(ruleId) ?? 0, seen));
    }
  }

  return (
    <>
      <DashBar
        // "Done" is gone with the third crumb. Both said the same thing the
        // Numbers tab says, and a page whose only way out is a button labelled
        // Done reads as a modal you are trapped in rather than one of three
        // views of the same deal. The empty right track is the counterweight
        // that keeps the tabs centred here as well, so they do not jump when
        // you move between the three.
        lead={
          <div className="flex min-w-0 flex-1 basis-0 items-center">
            <Crumbs
              size="lg"
              trail={[
                { label: "Deals", href: "/deals" },
                { label: brand.name, href: `/deals/${deal.id}` },
              ]}
            />
          </div>
        }
        right={<span className="min-w-0 flex-1 basis-0" aria-hidden="true" />}
      >
        <DealTabs dealId={deal.id} active="settings" />
      </DashBar>

      <Page className="space-y-6">
        {/* ------------------------------------------------------------ brand */}
        {/* The brand is first now. It was the second to last fold on the page,
            under Payouts, which put "the name of the company you are working
            with" below three panels of history — and a typo in it is the single
            most common thing somebody opens this page to fix.

            It stays its own panel rather than merging into Pay and terms,
            because the two write different tables and a brand edit lands on
            every deal with that brand. That is worth a header saying so. */}
        <FoldPanel
          title="Brand"
          open
          action={<span className="text-[13px] text-ink-50">Shared by every deal with them</span>}
        >
          <BrandForm brand={brand} dealId={deal.id} />
        </FoldPanel>

        {/* ------------------------------------------------------------ shelf */}
        {/* Everything an editor needs on every batch for this brand, uploaded
            once. It hangs off the deal rather than the job on purpose: the logo
            and the SOP do not change per batch, and re-uploading them for each
            one is the friction this removes. */}
        <FoldPanel
          title="Editor shelf"
          action={
            <span className="text-[13px] text-ink-50">
              {shelf.length === 0
                ? "Nothing on it yet"
                : `${shelf.length} file${shelf.length === 1 ? "" : "s"} on every batch`}
            </span>
          }
        >
          <DealShelf dealId={deal.id} assets={shelf} />
        </FoldPanel>

        {/* ------------------------------------------------------------- deal */}
        {/* This is the base pay, the view floor under it and the fee kind — the
            three numbers somebody opens the edit page to change — and they used
            to be the sixth closed header down the page, behind a label ("The
            deal") that named the row rather than what was in it. */}
        <FoldPanel
          title="Pay and terms"
          open
          action={
            <span className="text-[13px] text-ink-50">
              {money(deal.flat_fee_cents)} {deal.flat_fee_kind.replace(/_/g, " ")}
              {deal.min_views_for_base > 0
                ? ` · base needs ${deal.min_views_for_base.toLocaleString()} views`
                : ""}
            </span>
          }
        >
          <EditDealForm deal={deal} />
        </FoldPanel>

        {/* -------------------------------------------------------- workspace */}
        {/* whose books the deal is on. only drawn when there is a choice: a
            creator with no agency seat has one set of books and a fold that
            says so is a fold that exists to disappoint. an orphaned org id
            (a seat since given up) still shows, so it can be pulled back. */}
        {(ws.seats.length > 0 || deal.org_id) && (
          <FoldPanel
            title="Workspace"
            action={
              <span className="text-[13px] text-ink-50">
                {ws.seats.find((s) => s.id === deal.org_id)?.name ??
                  (deal.org_id ? "an agency you left" : "your own account")}
              </span>
            }
          >
            <form action={moveDeal} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="deal_id" value={deal.id} />
              <Select
                label="On the books of"
                name="org_id"
                className="min-w-[240px]"
                defaultValue={deal.org_id ?? ""}
                options={[
                  { value: "", label: "Your own account" },
                  ...ws.seats.map((s) => ({ value: s.id, label: s.name })),
                ]}
                hint="a deal on an agency's books counts on that agency's roster and nowhere else"
              />
              <Submit size="sm" tone="line" pendingLabel="Moving">
                Move
              </Submit>
            </form>
          </FoldPanel>
        )}

        {/* ------------------------------------------------------------ bonus */}
        {/* the anchor the deal page's rate sheet points at, so "Edit" next to a
            CPM lands on the CPM rather than at the top of the page. */}
        <div id="bonus" className="scroll-mt-6">
        <FoldPanel
          title="Bonus rules"
          padded={false}
          open
          action={
            <span className="text-[13px] text-ink-50">
              {rules.length === 0 ? "none yet" : `${openRules.length} open of ${rules.length}`}
            </span>
          }
        >
          {rules.length === 0 && (
            <p className="px-5 pt-6 text-[13.5px] text-ink-50 sm:px-6">
              No bonus yet, so only the flat fee counts. Most deals have at least a CPM.
            </p>
          )}

          {rules.map((rule) => {
            const closed = ruleIsClosed(rule, now);
            const earned = detail.bonusByRule.get(rule.id) ?? 0;
            // the best any one post has done under this rule's own window. It is
            // what turns a ladder from a list of numbers into progress, and it is
            // the rule's countable views rather than the post's raw views because
            // those are the ones the rule is allowed to pay on.
            const best = bestViewsByRule.get(rule.id) ?? 0;
            const ladder = rule.kind === "milestone" ? ruleLadder(rule, best) : [];
            const next = quoteRule(rule, best).next;

            return (
              <div key={rule.id} className="border-b border-line last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    {/* the money shape first and on its own line. It used to be
                        the fourth clause of a nine-part sentence, which is why a
                        seven tier sheet read as "7 tiers" and nothing else. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-bold tracking-[-0.015em]">
                        {ruleHeadline(rule)}
                      </p>
                      {closed && <Pill tone="quiet">closed</Pill>}
                      {rule.label && <Pill tone="line">{rule.label}</Pill>}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-50">
                      {ruleChips(rule).map((chip, i) => (
                        <span key={chip} className="flex items-center gap-2">
                          {i > 0 && <span aria-hidden className="text-line">·</span>}
                          {chip}
                        </span>
                      ))}
                    </div>

                    {/* the ladder, drawn. A step already reached is filled, so
                        "where is this deal up to" is a glance and not a
                        subtraction done in somebody's head. */}
                    {ladder.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {ladder.map((step) => (
                          <span
                            key={step.views}
                            title={`${step.views.toLocaleString()} views pays ${money(step.amount_cents)}`}
                            className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-semibold tabular-nums ${
                              step.top
                                ? "bg-flame text-on-accent"
                                : step.hit
                                  ? "bg-ember text-flame-dark"
                                  : "border border-line text-ink-50"
                            }`}
                          >
                            {fmtViews(step.views)}
                            <span aria-hidden className="opacity-60">
                              →
                            </span>
                            {money(step.amount_cents)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-5">
                    <div className="text-right">
                      <p className="text-[15px] font-bold tabular-nums">{money(earned)}</p>
                      <p className="text-[12.5px] text-ink-50">
                        {/* why it is zero, said out loud. "$0 earned" on a deal
                            with no posts on it and "$0 earned" on a deal whose
                            posts all missed the first tier are different facts,
                            and both used to read as the same one. */}
                        {earned > 0
                          ? "earned"
                          : videos.length === 0
                            ? "no posts yet"
                            : next
                              ? `${fmtViews(next.viewsAway)} views off`
                              : "earned"}
                      </p>
                    </div>
                    <form action={removeRule}>
                      <input type="hidden" name="rule_id" value={rule.id} />
                      <input type="hidden" name="deal_id" value={deal.id} />
                      <Submit tone="line" size="sm" pendingLabel="Removing">
                        Remove
                      </Submit>
                    </form>
                  </div>
                </div>

                {/* Correcting a rule used to mean deleting it and typing the
                    whole rate sheet again, which nobody does for one wrong
                    milestone, so wrong rules stayed wrong. */}
                <details className="group px-5 pb-4 sm:px-6">
                  <summary className="cursor-pointer list-none text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Edit this bonus</span>
                    <span className="hidden group-open:inline">Close</span>
                  </summary>
                  <div className="mt-4">
                    <RuleForm
                      dealId={deal.id}
                      rule={rule}
                      baseCents={deal.flat_fee_cents}
                      baseKind={deal.flat_fee_kind}
                    />
                  </div>
                </details>
              </div>
            );
          })}

          {/* open on a deal with no rules: a "+ Add a bonus" line under an empty
              panel is a dead end until somebody guesses to click it, and the
              bonus is the thing most deals are opened here to set. */}
          <Reveal label="Add a bonus" open={rules.length === 0}>
            <RuleForm
              dealId={deal.id}
              baseCents={deal.flat_fee_cents}
              baseKind={deal.flat_fee_kind}
            />
          </Reveal>
        </FoldPanel>
        </div>

        {/* --------------------------------------------------------- accounts */}
        {/* the anchor the deal bar's greyed-out platform marks point at: a mark
            with nothing behind it lands here, on the section that connects it. */}
        <div id="accounts" className="scroll-mt-6">
          <FoldPanel
            title="Accounts"
            padded={false}
            open
            action={
              <span className="text-[13px] text-ink-50">
                one per platform · {accounts.length} of {PLATFORMS.length} on this deal
              </span>
            }
          >
            {/* one row per platform, always all three, whether or not anything is
                behind it. the list used to be "the rows that exist", so a deal
                with one instagram gave no hint that two more slots were even a
                thing, and connecting lived on a different page entirely. */}
            {/* the two ways in, said once at the top instead of as a paragraph
                under the rows. connecting lives here as well as in Social
                because this is where somebody sets a brand deal up, and it
                stays optional on purpose: tracking a typed-in handle needs no
                login, and plenty of creators want the numbers without the
                autoposting. */}
            <p className="border-b border-line px-5 py-3 text-[12.5px] leading-[1.6] text-ink-50 sm:px-6">
              <span className="font-semibold text-ink-70">Connect</span> to post: one login on the
              platform&apos;s own page, and the handle fills itself in here.{" "}
              <span className="font-semibold text-ink-70">Track</span> a handle instead to read the
              views only, no login, nothing gets posted.
              {!connections.configured &&
                " Connecting is off on this deploy until UPLOAD_POST_API_KEY is set."}
            </p>

            {PLATFORMS.map((platform) => {
              const account = accounts.find((a) => a.platform === platform);
              const posting = connections.connected[platform] ?? null;
              const handle = account?.handle ?? posting;

              return (
                <Row key={platform}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {posting ? (
                      <PlatformGlyph platform={platform} tone="brand" className="size-[19px]" />
                    ) : (
                      <span className={handle ? "text-ink-70" : "text-line"}>
                        <PlatformGlyph platform={platform} className="size-[19px]" />
                      </span>
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {handle ? (
                          <a
                            href={profileUrl(platform, handle)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[15px] font-bold tracking-[-0.015em] hover:text-flame-dark"
                          >
                            @{handle}
                          </a>
                        ) : (
                          <p className="text-[15px] font-bold tracking-[-0.015em] text-ink-50">
                            {PLATFORM_LABEL[platform]}
                          </p>
                        )}
                        {posting && <Pill tone="flame">posting</Pill>}
                        {account && !posting && <Pill tone="quiet">tracking only</Pill>}
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-50">
                        {!account
                          ? posting
                            ? "connected for posting, attaching it to the deal on the next load"
                            : "nothing here yet"
                          : account.last_sync_error
                            ? account.last_sync_error
                            : account.last_synced_at
                              ? `views read ${ago(account.last_synced_at)}`
                              : "never read"}
                      </p>
                    </div>
                  </div>

                  {/* both ways in, on the row they belong to. an empty row used
                      to end in nothing at all and the way to fill it was a fold
                      at the bottom of the panel with its own platform picker,
                      which is one more decision than the row it belonged to
                      needed. */}
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {/* `!posting` as well as `!account`: a platform connected a
                        moment ago has no deal_accounts row until the reconcile
                        on the next load, and asking for a handle next to a line
                        that says the handle is already on its way is a box that
                        can only be filled in wrong. */}
                    {!account && !posting && (
                      <AccountHandleForm dealId={deal.id} platform={platform} />
                    )}

                    {connections.configured && !posting && (
                      <ConnectButton
                        dealId={deal.id}
                        origin="deal"
                        manage={false}
                        tone={account ? "line" : "flame"}
                        label={account ? "Connect to post" : "Connect"}
                      />
                    )}

                    {account && (
                      <form action={removeAccount}>
                        <input type="hidden" name="account_id" value={account.id} />
                        <input type="hidden" name="deal_id" value={deal.id} />
                        <Submit tone="ghost" size="sm" pendingLabel="Removing">
                          Remove
                        </Submit>
                      </form>
                    )}
                  </div>
                </Row>
              );
            })}

            {mismatched.map((m) => (
              <p
                key={m.platform}
                className="border-b border-line bg-ember px-5 py-3 text-[13px] text-flame-dark sm:px-6"
              >
                {PLATFORM_LABEL[m.platform]} posts as @{m.posting} but the views are read from
                @{m.tracking}. Remove the row above and connect it again to line them up.
              </p>
            ))}

            {/* one line out, once anything is connected: the per-row buttons
                only ever start a connection, and this is the way back to the
                page that ends one. */}
            {connections.configured && Object.keys(connections.connected).length > 0 && (
              <div className="flex justify-end px-5 py-3 sm:px-6">
                <ConnectButton dealId={deal.id} origin="deal" manage tone="line" />
              </div>
            )}
          </FoldPanel>
        </div>

        {/* The Videos panel used to sit here: paste a link for a post the
            scraper cannot see, and type the numbers in by hand. Both were asked
            for by name and both were removed from this page on 2026-08-12, so
            the edit page is the deal's terms rather than its contents.

            `AddVideoForm` and `ManualStatsForm` are untouched and so are the
            actions behind them (`addVideo`, `setVideoStats`). The manual path is
            still first class in the product — nothing here may require an api
            key to count a view — it simply has no surface on this page right
            now. Put it back next to the posts table on /deals/[id] rather than
            re-growing a fold nobody opened. */}

        {/* The Payouts panel used to sit here: the log, the three status buttons
            and the "log a payout" form. Removed 2026-08-12 with the Videos one,
            for the same reason — this page is the deal's terms, and a payout is
            a thing that happened rather than a term.

            `PayoutForm` and the `createPayout` / `setPayoutStatus` /
            `deletePayout` actions are untouched. Money still freezes into a
            payout row exactly as it did; there is just no surface for it on this
            page right now, so put one on /deals/[id] next to the numbers it
            freezes rather than back behind a fold here. */}

        {/* Delete is last and stays last. Everything above it is a change you can
            undo by typing the old value back; this is the one that is not.

            It is not a panel any more. A fifth card the same size as Brand and
            Accounts said Delete was a section of this page on the level of the
            deal's pay, and a header you have to open to read a warning is a
            click spent on nothing. As a plain footer line it is out of the way
            without being hidden, and the sentence that says what goes is
            visible before the button rather than behind it. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 pt-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-[1.6] text-ink-50">
            Deleting takes the deal with its accounts, bonus rules, {videos.length} videos and
            every snapshot behind them. Payout history goes too. There is no undo.
          </p>
          <form action={deleteDeal}>
            <input type="hidden" name="deal_id" value={deal.id} />
            {/* out of a fold means one click reaches it, so the second click is
                the gate the fold used to be by accident. the armed button names
                the brand: "delete this deal" is a sentence you can press
                without reading, and this one is not. */}
            <ConfirmSubmit tone="ghost" pendingLabel="Deleting" confirmLabel={`Delete ${brand.name} for good`}>
              Delete this deal
            </ConfirmSubmit>
          </form>
        </div>
      </Page>
    </>
  );
}
