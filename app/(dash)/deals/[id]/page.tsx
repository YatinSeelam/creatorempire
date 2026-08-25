import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { DealPlatformStrip, type PlatformSlot } from "@/components/dash/deal-platform-strip";
import { DealTabs } from "@/components/dash/deal-tabs";
import { Thumb } from "@/components/dash/thumb";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { PostFilters } from "@/components/dash/post-filters";
import { PostSelection, RowCheck, SelectAllCheck } from "@/components/dash/post-select";
import { PostPayment } from "@/components/dash/post-payment";
import { RefreshAll } from "@/components/dash/refresh-all";
import { Cols, Crumbs, DashBar, Page, Panel, Pill, Stat } from "@/components/dash/ui";
import { brandLogo } from "@/lib/brand-catalog";
import {
  cutPay,
  engagement,
  expectedVideos,
  groupVideos,
  PLATFORMS,
  PLATFORM_LABEL,
  postingCadence,
  ruleIsClosed,
  type BonusRule,
  type Cut,
  type Platform,
} from "@/lib/deals";
import { quoteRule, ruleChips, ruleHeadline } from "@/lib/bonus";
import { loadConnectedForDeal, loadDeal, loadRefreshQuota } from "@/lib/deals-server";
import { closesAt } from "@/lib/ingest/sync";
import { money, shortDate, views as fmtViews } from "@/lib/money";
import { featureOn } from "@/lib/org";
import { loadWorkspace } from "@/lib/workspace";

/**
 * A deal, as the numbers coming off it.
 *
 * This page used to be seven folds of forms, so opening a deal showed a stack of
 * headers and nothing about how the work was doing. The tracking table is the
 * page now: thumbnails, views, likes and what each cut earned, straight away and
 * with nothing to expand first.
 *
 * It is the first of three tabs, and they are the deal's three jobs. Numbers is
 * this page. Posting is the composer and the queue, which used to be a separate
 * rail row over a separate list of the same brands. Settings is every form —
 * bonus rules, accounts, the fee, the brand, deleting it. Reading is the default
 * and writing is a place you go, rather than both living in the same pile of
 * accordions, but going there no longer means leaving the deal.
 *
 * The three platform marks in the bar are the whole of what used to be a
 * "Tracked accounts" panel. A deal holds at most one account per platform, so a
 * table with a select-all checkbox and a brand column was three columns of
 * restating the page title. Colour says which are live, and a grey one is the
 * way in to connecting it.
 */
/**
 * Rows per page. Bigger than it looks on a tall screen, because the panel
 * scrolls inside itself: this is the point at which rendering more stops being
 * worth the html, not the point at which the list stops fitting.
 */
const CUTS_PER_PAGE = 25;

/**
 * The refresh button posts from here, and a server action inherits the
 * segment's budget. A sweep across a whole roster is minutes of provider round
 * trips, and the default would kill it after the allowance had been spent.
 */
export const maxDuration = 300;

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string; p?: string; q?: string; pf?: string }>;
}) {
  const { id } = await params;
  // the create action redirects here, and anything it could not finish rides
  // along in the url rather than dying with the form that submitted it.
  const { note, p, q, pf } = await searchParams;
  // loadWorkspace is cache()d per request, so this costs nothing the layout has
  // not already paid: it is the same read the rail does to decide its own rows.
  const [detail, quota, ws] = await Promise.all([
    loadDeal(id),
    loadRefreshQuota(),
    loadWorkspace(),
  ]);
  if (!detail) notFound();

  // `nav.social` used to hide a rail row. Posting is a tab now, so it hides the
  // tab. Same switch, same meaning, and like every other feature switch it does
  // not gate the route behind it.
  const showPosting = featureOn(ws.brand?.features, "nav.social");

  const { deal, brand, accounts, rules, videos, payouts, baseMonth } = detail;
  // the hand-set payments are in here too. `overrideDelta` is what they add to or
  // take off what the rules computed, so the four stats and the Payment column
  // under them are the same money however many rows have been edited by hand.
  const earnedCents = detail.flatCents + detail.bonusCents + detail.overrideDelta;
  const paidCents = payouts
    .filter((p) => p.status === "paid")
    .reduce((n, p) => n + p.flat_cents + p.bonus_cents + p.adjust_cents, 0);
  const owedCents = earnedCents - paidCents;

  const now = new Date();
  const openRules = rules.filter((r) => !ruleIsClosed(r, now));
  const editHref = `/deals/${deal.id}/edit`;

  // the best any single post has done under each rule's own window, which is
  // what a milestone ladder is measured against. `countableViews` is
  // video → rule → views, so this is the max down the second axis.
  const bestViewsByRule = new Map<string, number>();
  for (const byRule of detail.countableViews.values()) {
    for (const [ruleId, seen] of byRule) {
      bestViewsByRule.set(ruleId, Math.max(bestViewsByRule.get(ruleId) ?? 0, seen));
    }
  }

  // the nearest unreached milestone across every open rule. This is the one fact
  // that makes a bonus section worth looking at before it has ever paid: how far
  // off the first payment is.
  const nextStep = openRules
    .filter((rule) => rule.kind === "milestone")
    .map((rule) => quoteRule(rule, bestViewsByRule.get(rule.id) ?? 0).next)
    .filter((step): step is NonNullable<typeof step> => step !== null)
    .sort((a, b) => a.viewsAway - b.viewsAway)[0];

  // no rules means no bonus is reachable on any cut, so the posts table drops
  // its bonus column and its window line rather than drawing a column of $0 and
  // repeating "window closed" on every row of a deal that never had a window.
  const paysBonus = rules.length > 0;
  // and only a per-video fee has a per-post base to show. On a one-off or a
  // retainer the fee is owed for the deal or the month, and splitting it across
  // posts would be a number nobody agreed to.
  const paysBase = deal.flat_fee_kind === "per_video";

  const handleById = new Map(accounts.map((a) => [a.id, a.handle] as const));

  // the platforms this deal actually runs on, in the fixed PLATFORMS order so
  // the columns never reorder between two deals. A platform with neither an
  // account nor a post is a column of "·" on every row, which is the deal's own
  // platform strip restated forty times.
  const viewCols = PLATFORMS.filter(
    (platform) =>
      accounts.some((a) => a.platform === platform) ||
      videos.some((v) => v.platform === platform)
  );

  // the split behind the one Views number, for the fold under it. Read off the
  // videos rather than the accounts, because a post can outlive the account row
  // it came in on and its views still counted.
  const viewsByPlatform = new Map<Platform, number>();
  for (const video of videos) {
    viewsByPlatform.set(video.platform, (viewsByPlatform.get(video.platform) ?? 0) + video.views);
  }
  const countedVideos = videos.filter((v) => v.counts).length;


  // the posts table is one row per edit, not one per post: the same cut goes out
  // on all three platforms and three rows of it is three copies of one job.
  const cuts = groupVideos(videos);

  // what the deal asked for, against what actually went out.
  //
  // counted in cuts, not posts. the cadence a brand agrees is "two videos a
  // day", and the same edit landing on tiktok, instagram and youtube is one
  // video by that reckoning. counting posts would show every deal on three
  // platforms running at 300% of quota, which is the wrong answer confidently.
  //
  // the month is the calendar one and the target is prorated to the days
  // elapsed, so on the 3rd it asks for three days of work rather than showing
  // a whole month's shortfall nobody is behind on yet.
  const cadence = postingCadence(deal);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const cutPostedAt = (cut: Cut) =>
    cut.videos.reduce<number | null>((earliest, video) => {
      if (!video.posted_at) return earliest;
      const at = new Date(video.posted_at).getTime();
      return earliest === null || at < earliest ? at : earliest;
    }, null);
  const postedThisMonth = cuts.filter((cut) => {
    const at = cutPostedAt(cut);
    return at !== null && at >= monthStart;
  }).length;
  const expectedThisMonth = cadence ? expectedVideos(cadence, now.getUTCDate()) : 0;

  // search first, filter second, count in between: the number on each mark is
  // how many of the SEARCHED cuts it would show, so turning a mark on can never
  // land on an empty table.
  const needle = (q ?? "").trim().toLowerCase();
  const searched = needle
    ? cuts.filter((cut) =>
        cut.videos.some((video) =>
          [
            video.caption,
            video.content_group,
            PLATFORM_LABEL[video.platform],
            handleById.get(video.deal_account_id),
          ].some((field) => field?.toLowerCase().includes(needle))
        )
      )
    : cuts;

  const counts = Object.fromEntries(PLATFORMS.map((p) => [p, 0])) as Record<Platform, number>;
  for (const cut of searched) {
    for (const platform of new Set(cut.videos.map((v) => v.platform))) counts[platform] += 1;
  }

  const picked = (pf ?? "")
    .split(",")
    .filter((value): value is Platform => (PLATFORMS as readonly string[]).includes(value));
  const filtered =
    picked.length > 0
      ? searched.filter((cut) => cut.videos.some((v) => picked.includes(v.platform)))
      : searched;

  // the panel scrolls inside its own frame, and it pages on top of that. The
  // scroll is what keeps the rest of the deal on screen; the page size is what
  // stops a creator two years in rendering nine hundred rows to look at eight.
  const pages = Math.max(1, Math.ceil(filtered.length / CUTS_PER_PAGE));
  const page = Math.min(Math.max(1, Number(p) || 1), pages);
  const shown = filtered.slice((page - 1) * CUTS_PER_PAGE, page * CUTS_PER_PAGE);
  const narrowed = needle.length > 0 || picked.length > 0;

  // A mark is coloured when there is something real behind it. The account row
  // on the deal wins, because that is the one the sync reads and the one whose
  // stable platform id we have; a handle that is only connected for posting is
  // shown too, so a creator who connected on the Posting tab and never attached
  // it here is not told they have nothing.
  const connected = await loadConnectedForDeal(deal.id);
  const slots: PlatformSlot[] = PLATFORMS.map((platform) => {
    const tracked = accounts.find((a) => a.platform === platform);
    const posting = connected.find((c) => c.platform === platform);
    return {
      platform,
      handle: tracked?.handle ?? posting?.handle ?? null,
      channelId:
        tracked?.platform_account_id?.startsWith("UC") === true
          ? tracked.platform_account_id
          : null,
    };
  });

  // The one thing to do next on this deal, or nothing when it is already
  // running. An empty deal used to open as four panels of $0 and a table saying
  // "nothing tracked yet", which is a description rather than an instruction:
  // everything on screen was a consequence of the same missing step and none of
  // it said which. The order is the order the deal actually has to be built in,
  // so only the first unmet one is ever shown.
  const hasAccount = accounts.length > 0 || connected.length > 0;
  const nextAction = !hasAccount
    ? {
        line: "No account on this deal yet, so no views can be counted and nothing can be posted.",
        cta: "Connect one or type a handle in",
        href: `${editHref}#accounts`,
      }
    : rules.length === 0
      ? {
          line: "Base fee only. Most deals pay a CPM or a milestone on top of it.",
          cta: "Add a bonus rule",
          href: `${editHref}#bonus`,
        }
      : videos.length === 0
        ? showPosting
          ? {
              line: "Accounts are on and the rules are set. Nothing has gone out yet.",
              cta: "Schedule the first cut",
              href: `/tools/autoposting?deal=${deal.id}`,
            }
          : {
              // tracking without posting is first class, so a deal that does not
              // autopost is not told to go and schedule something.
              line: "Accounts are on and the rules are set. Nothing is tracked yet.",
              cta: "Paste a post in",
              href: editHref,
            }
        : null;

  return (
    <>
      <DashBar
        // basis-0 flex-1 on BOTH sides is what holds the tabs still. The bar is
        // one justify-between row, so without it the tabs sit wherever the two
        // ends leave room — and the Posting tab has nothing on its right, which
        // slid the whole control across the screen every time you pressed it. A
        // tab strip that moves when you use it is the one thing a tab strip
        // cannot do. Equal tracks either side, centre stays centre.
        lead={
          <div className="flex min-w-0 flex-1 basis-0 items-center gap-3">
            <Crumbs
              size="lg"
              trail={[{ label: "Deals", href: "/deals" }, { label: brand.name }]}
            />
            <BrandMark name={brand.name} logo={brandLogo(brand)} size="sm" />
            {/* whose books. a deal opened from a link while you are on the other
                workspace still renders (it is yours), so the bar says which
                ledger it counts on rather than letting the rail's head imply
                the wrong one. */}
            {deal.org_id && (
              <Pill tone="quiet">
                for {ws.seats.find((x) => x.id === deal.org_id)?.name ?? "an agency"}
              </Pill>
            )}
          </div>
        }
        right={
          <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-3">
            <DealPlatformStrip slots={slots} editHref={`${editHref}#accounts`} />
            {/* the sweep is every account, not this deal's three. it is
                rationed monthly, and a button that spent one refresh per deal
                page would empty the month on a roster of six brands. */}
            <RefreshAll quota={quota} />
          </div>
        }
      >
        {/* "Edit deal" used to be a button here. It is the Settings tab now:
            the same destination, sitting next to the other two halves of the
            deal instead of being the only one of the three with a name. */}
        <DealTabs dealId={deal.id} active="numbers" />
      </DashBar>

      <Page fill className="space-y-5">
        {note && (
          <p className="shrink-0 rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
            {note}
          </p>
        )}

        {nextAction && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-line bg-ember px-5 py-3.5">
            <p className="text-[13.5px] text-flame-dark">{nextAction.line}</p>
            <Link
              href={nextAction.href}
              className="flex h-8 shrink-0 items-center rounded-pill bg-flame px-4 text-[13px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
            >
              {nextAction.cta}
            </Link>
          </div>
        )}

        {/* The four numbers, and the working behind each one folded under it.
            What the deal pays used to be a panel of its own between these stats
            and the posts table, which put the rate sheet a card away from the
            figures it explains and on screen whether or not anybody had asked.
            Every fact it carried is still here — the fee and its kind, the view
            floor, each rule's rate, its window, what it has earned — sitting on
            the stat it is the explanation for, shut until somebody wants it.

            `items-start` so opening one card grows that card rather than
            stretching the three beside it to match. */}
        <div className="grid shrink-0 items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Views counted"
            value={fmtViews(detail.totalViews)}
            note={`${countedVideos} of ${videos.length} videos count`}
            detail={
              <>
                {viewCols.map((platform) => (
                  <Line
                    key={platform}
                    label={PLATFORM_LABEL[platform]}
                    value={fmtViews(viewsByPlatform.get(platform) ?? 0)}
                  />
                ))}
                {videos.length > countedVideos && (
                  <Line
                    label="Not counting"
                    value={`${videos.length - countedVideos} post${
                      videos.length - countedVideos === 1 ? "" : "s"
                    }`}
                  />
                )}
                <p className="mt-2.5 text-[12px] leading-[1.5] text-ink-50">
                  Every account pulls itself every 3 days. What a rule pays on is
                  narrower than this: a window only counts the views that landed
                  inside it.
                </p>
              </>
            }
          />
          <Stat
            label="Flat fee"
            value={money(detail.flatCents)}
            note={
              // per video is the only kind where the count is a fact worth
              // showing: it is what says a view floor or a replacing tier took
              // videos out of the base fee.
              deal.flat_fee_kind === "per_video"
                ? `per video · paid on ${detail.baseVideos} of ${countedVideos}`
                : deal.flat_fee_kind.replace(/_/g, " ")
            }
            detail={
              <>
                <Line
                  label="Base pay"
                  value={`${money(deal.flat_fee_cents)} ${deal.flat_fee_kind.replace(/_/g, " ")}`}
                />
                {paysBase && (
                  <>
                    <Line label="Paid on" value={`${detail.baseVideos} of ${countedVideos} posts`} />
                    {/* the floor only bites on a per video fee: a one-off or a
                        retainer is owed for the deal, not for a post. */}
                    <Line
                      label="View floor"
                      value={
                        deal.min_views_for_base > 0
                          ? `${fmtViews(deal.min_views_for_base)} a post`
                          : "none"
                      }
                    />
                  </>
                )}
                {/* the deliverable, beside the fee it earns. a cadence with no
                    fee attached is a note; a fee with no cadence is half a
                    deal. a quota nobody set says nothing rather than "0 a day". */}
                {cadence && (
                  <>
                    <Line
                      label="Posting"
                      value={`${cadence.label} · ${Math.round(cadence.perMonth)} a month`}
                    />
                    <Line
                      label="This month"
                      value={`${postedThisMonth} of ${expectedThisMonth} expected`}
                    />
                  </>
                )}
                {/* the same figure, out of the same function, as the deal's row
                    on the dashboard's "Base pay this month" panel. it used to be
                    a second calculation off the rate sheet alone, which read
                    differently on a deal ahead of quota, on a paused deal, in a
                    month that is not 30.44 days long, and not at all on a
                    retainer. two numbers a click apart under one label.

                    the bonus is left out on purpose: it turns on views nobody
                    has yet, and guessing them would put the one unread number on
                    a page of read ones. */}
                {deal.status !== "draft" && (
                  <Line
                    label="Base this month"
                    value={
                      baseMonth.forecast
                        ? `${money(baseMonth.projectedCents)} on track · ${money(baseMonth.bookedCents)} so far`
                        : `${money(baseMonth.projectedCents)}, already owed`
                    }
                  />
                )}
                <Line
                  label="Invoices"
                  value={`${deal.pay_cycle.replace(/_/g, " ")} · net ${deal.net_days}`}
                />
                {(deal.started_on || deal.ends_on) && (
                  <Line
                    label="Runs"
                    value={`${deal.started_on ? shortDate(deal.started_on) : "open"} to ${
                      deal.ends_on ? shortDate(deal.ends_on) : "open"
                    }`}
                  />
                )}
                <Line label="Earned" value={money(detail.flatCents)} strong />
              </>
            }
          />
          <Stat
            label="Bonus earned"
            value={money(detail.bonusCents)}
            // "0 of 0 rules still open" was true and useless. What somebody wants
            // off a $0 here is why it is $0, and there are four different whys:
            // no rule, no post, no post that got there yet, and every window shut.
            note={
              rules.length === 0
                ? "no bonus rules on this deal"
                : videos.length === 0
                  ? "nothing tracked yet, so nothing has earned"
                  : detail.bonusCents === 0 && nextStep
                    ? `${fmtViews(nextStep.viewsAway)} more views reaches ${money(
                        nextStep.tier.amount_cents
                      )}`
                    : openRules.length === 0
                      ? `every window closed · ${rules.length} rule${rules.length === 1 ? "" : "s"}`
                      : `${openRules.length} of ${rules.length} rule${
                          rules.length === 1 ? "" : "s"
                        } still open`
            }
            detail={
              // the rate sheet: every rule as the phrase it pays by, the
              // conditions on it, and what it has actually earned. Read only, on
              // purpose. The forms are one Edit away and reading is what this
              // page is for.
              rules.length === 0 ? (
                <p className="text-[12.5px] leading-[1.5] text-ink-50">
                  No bonus rules, so only the flat fee counts. Most deals have at least a CPM.{" "}
                  <Link
                    href={`${editHref}#bonus`}
                    className="font-semibold text-flame hover:text-flame-dark"
                  >
                    Add one
                  </Link>
                  .
                </p>
              ) : (
                <>
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="border-b border-line py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 text-[12.5px] font-bold tracking-[-0.01em]">
                          {ruleHeadline(rule)}
                        </p>
                        <p
                          className={`shrink-0 text-[12.5px] font-bold tabular-nums ${
                            (detail.bonusByRule.get(rule.id) ?? 0) > 0 ? "" : "text-ink-50"
                          }`}
                        >
                          {money(detail.bonusByRule.get(rule.id) ?? 0)}
                        </p>
                      </div>
                      {/* the window, the platforms, the floor, the cap, and the
                          label if it has one, all as one quiet line: in a card
                          this wide a row of pills would be a row per pill. */}
                      <p className="mt-1 text-[12px] leading-[1.5] text-ink-50">
                        {[
                          rule.label,
                          ...ruleChips(rule),
                          ruleIsClosed(rule, now) ? "closed" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  ))}
                  <Link
                    href={`${editHref}#bonus`}
                    className="mt-3 inline-block text-[12.5px] font-semibold text-ink-50 transition-colors hover:text-flame"
                  >
                    Edit the rules
                  </Link>
                </>
              )
            }
          />
          <Stat
            label="Owed"
            value={money(owedCents)}
            note={
              // a hand-set payment is the one reason this number is not just flat
              // plus bonus minus paid, so it says so rather than looking wrong.
              detail.overriddenCuts > 0
                ? `${detail.overriddenCuts} post${
                    detail.overriddenCuts === 1 ? "" : "s"
                  } set by hand · ${money(detail.overrideDelta)}`
                : `net ${deal.net_days} · ${deal.pay_cycle.replace(/_/g, " ")}`
            }
            detail={
              // the arithmetic, written out. Owed is four numbers deep and a
              // creator chasing an invoice is the person most likely to want all
              // four rather than the answer.
              <>
                <Line label="Flat fee" value={money(detail.flatCents)} />
                <Line label="Bonus" value={money(detail.bonusCents)} />
                {detail.overrideDelta !== 0 && (
                  <Line
                    label={`Set by hand (${detail.overriddenCuts})`}
                    value={money(detail.overrideDelta)}
                  />
                )}
                <Line label="Earned" value={money(earnedCents)} strong />
                <Line label="Paid out" value={`- ${money(paidCents)}`} />
                <Line label="Owed" value={money(owedCents)} strong />
                <p className="mt-2.5 text-[12px] leading-[1.5] text-ink-50">
                  {payouts.length === 0
                    ? "Nothing logged as paid yet."
                    : `${payouts.length} payout${payouts.length === 1 ? "" : "s"} logged.`}{" "}
                  Invoices {deal.pay_cycle.replace(/_/g, " ")}, net {deal.net_days} days.
                </p>
              </>
            }
          />
        </div>

        {/* "bonus rules and no account to read views from" used to be its own
            ember paragraph here. It is the first branch of nextAction above,
            which says the same thing for a deal with no rules either — a deal
            with no account cannot count a view whatever else is set on it. */}

        {/* ----------------------------------------------------------- posts */}
        <Panel
          title="Tracked posts"
          sub="every cut on this deal and what it earned"
          padded={false}
          scroll
          className="lg:min-h-0 lg:flex-1"
          action={
            // the pager lives up here rather than under the list: the body is
            // what scrolls, so a pager below it is a control you can only reach
            // by scrolling past everything it exists to skip.
            <span className="flex items-center gap-3">
              <span className="text-[13px] text-ink-50">
                {narrowed
                  ? `${filtered.length} of ${cuts.length} cuts`
                  : `${cuts.length} cut${cuts.length === 1 ? "" : "s"} · ${videos.length} post${
                      videos.length === 1 ? "" : "s"
                    }`}
              </span>
              {pages > 1 && (
                <span className="flex items-center gap-1.5">
                  <Step
                    href={pageHref(q, pf, page - 1)}
                    disabled={page === 1}
                    label="Previous page"
                  >
                    ‹
                  </Step>
                  <span className="text-[12.5px] tabular-nums text-ink-50">
                    {page} / {pages}
                  </span>
                  <Step
                    href={pageHref(q, pf, page + 1)}
                    disabled={page === pages}
                    label="Next page"
                  >
                    ›
                  </Step>
                </span>
              )}
            </span>
          }
          toolbar={
            videos.length > 0 ? (
              <PostFilters query={q ?? ""} platforms={picked} counts={counts} />
            ) : undefined
          }
        >
          {/* the provider draws no dom of its own: the rows depend on
              `first:border-t-0` against their siblings and on a sticky header
              inside Panel's scroller, and a wrapper would cost both. */}
          <PostSelection
            dealId={deal.id}
            cuts={shown.map((cut) => ({
              key: cut.key,
              videoIds: cut.videos.map((v) => v.id),
            }))}
          >
          {videos.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-ink-50 sm:px-6">
              Nothing tracked yet. Sync pulls them in on its own, or paste one in from{" "}
              <Link href={editHref} className="font-semibold text-flame hover:text-flame-dark">
                the deal&apos;s settings
              </Link>
              .
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-ink-50 sm:px-6">
              Nothing matches that.
            </p>
          ) : (
            // `Cols` is shared with the deals list, so the two pages cannot
            // drift into two different column-header treatments. It is sticky
            // because Panel's body is the thing that scrolls here and the labels
            // have to survive it.
            <Cols>
              <SelectAllCheck />
              {/* the date column is a stacked month over day, which names itself
                  the way a calendar chip does. A "Date" label over it is a word
                  spent on the one column nobody has to be told what it is. */}
              <span className="w-[52px]" />
              <span className="flex-1">Content</span>
              {/* the per-platform split, one column per platform the deal runs
                  on. These are the same numbers the old Links column carried as
                  a huddle of marks at the far right, but as columns they can be
                  read down instead of only across, which is how you notice that
                  every tiktok of a deal is flat. Each one is still the link to
                  its post. */}
              {viewCols.map((platform) => (
                <span
                  key={platform}
                  title={`${PLATFORM_LABEL[platform]} views`}
                  className="hidden w-[60px] shrink-0 justify-end xl:flex"
                >
                  <PlatformGlyph platform={platform} tone="brand" className="size-4" />
                </span>
              ))}
              <span className="w-[72px] text-right">Views</span>
              <span className="hidden w-[68px] text-right lg:block">Likes</span>
              <span className="hidden w-[68px] text-right xl:block">Comments</span>
              {paysBase && <span className="w-[80px] text-right">Base</span>}
              {paysBonus && <span className="w-[96px] text-right">Tier / bonus</span>}
              <span className="w-[104px] text-right">Payment</span>
            </Cols>
          )}

          {shown.map((cut, row) => {
            const closes = closesAt(rules, cut.lead.platform, cut.lead.posted_at);
            const handle = handleById.get(cut.lead.deal_account_id);
            const posted = stackedDate(cut.lead.posted_at, now);
            // every number in the row's money columns, from the one helper the
            // deal's own total is also summed from.
            const pay = cutPay(deal, cut, detail.bonusByVideo, detail.replacedVideos);
            // the base fee is not owed on this cut: a bonus set to replace base
            // pay already covered it.
            const replaced = cut.videos.some((v) => detail.replacedVideos.has(v.id));
            // what the bonus cell says under its amount. The milestone this cut
            // reached when it has earned, and how far off the next one is when it
            // has not: a column of "-" said "nothing" where the honest answer was
            // "not yet, and here is by how much".
            const step = cutStep(cut, openRules, detail.countableViews);

            // a window is a thing a rule opens, so with no rules on the deal
            // there isn't one. Saying "window closed" under forty rows of a deal
            // that has never had a rule is forty lines of untrue noise.
            const windowNote = !paysBonus
              ? null
              : closes === null
                ? "earns while the deal runs"
                : closes.getTime() > now.getTime()
                  ? `window closes ${shortDate(closes.toISOString())}`
                  : "window closed";

            return (
              <div
                key={cut.key}
                className={`group flex items-center gap-4 border-t border-line px-5 py-3.5 transition-colors first:border-t-0 hover:bg-shell sm:px-6 ${
                  pay.ignored ? "opacity-55" : ""
                }`}
              >
                {/* hidden below sm for the same reason the header row is: the
                    narrow layout is a stack of cards, not a table, and there is
                    nothing there for a bulk bar to act on. */}
                <span className="hidden sm:flex">
                  <RowCheck cutKey={cut.key} index={row} />
                </span>

                {/* the date is its own column rather than a fragment of the meta
                    line under the title: a posts table is read down the dates as
                    often as across one row, and a date buried in a sentence
                    cannot be scanned that way. */}
                <div
                  className="hidden w-[52px] shrink-0 text-center leading-none sm:block"
                  title={shortDate(cut.lead.posted_at)}
                >
                  <p className="text-[12px] font-medium text-ink-50">{posted.top}</p>
                  <p className="mt-1 text-[15px] font-bold tabular-nums">{posted.day}</p>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <Thumb
                    src={cut.lead.thumbnail_url}
                    fallback={PLATFORM_LABEL[cut.lead.platform].slice(0, 1)}
                    className="size-11 shrink-0 rounded-[10px]"
                  />
                  <div className="min-w-0">
                    <a
                      href={cut.lead.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[14px] font-semibold tracking-[-0.01em] transition-colors hover:text-flame-dark"
                    >
                      {cut.title}
                    </a>
                    <p className="mt-0.5 truncate text-[12px] text-ink-50">
                      {handle ? `@${handle}` : "no account"}
                      {/* the date moved to its own column, so what is left here
                          is only what changes the money. */}
                      {windowNote && ` · ${windowNote}`}
                      {replaced && " · bonus instead of base"}
                      {pay.overrideCents !== null && " · payment set by hand"}
                      {pay.ignored && " · ignored"}
                    </p>
                    {/* the way to each post once the per-platform columns are
                        too wide to draw. The title link only ever goes to the
                        lead post, so without this a narrow window has no route
                        to the other two. */}
                    {cut.videos.length > 1 && (
                      <div className="mt-1 flex items-center gap-2.5 xl:hidden">
                        {cut.videos.map((video) => (
                          <a
                            key={video.id}
                            href={video.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            title={`${fmtViews(video.views)} views on ${PLATFORM_LABEL[video.platform]}`}
                            className="flex items-center gap-1 text-[11.5px] font-medium tabular-nums text-ink-50 transition-colors hover:text-ink"
                          >
                            <PlatformGlyph
                              platform={video.platform}
                              tone="brand"
                              className="size-3.5"
                            />
                            {fmtViews(video.views)}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {viewCols.map((platform) => {
                  const post = cut.videos.find((v) => v.platform === platform);
                  return (
                    <p
                      key={platform}
                      className="hidden w-[60px] shrink-0 text-right text-[13px] tabular-nums xl:block"
                    >
                      {post ? (
                        <a
                          href={post.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          title={`${fmtViews(post.views)} views on ${PLATFORM_LABEL[platform]}`}
                          className="text-ink-70 transition-colors hover:text-flame"
                        >
                          {fmtViews(post.views)}
                        </a>
                      ) : (
                        // not posted there, which is not the same as zero views
                        // and must not read as one.
                        <span className="text-line">·</span>
                      )}
                    </p>
                  );
                })}

                <p className="w-[72px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
                  {fmtViews(cut.views)}
                </p>

                {/* Engagement. On a deal with no bonus rules these are the only
                    numbers in the row that are not the flat fee restated, which
                    is most of why such a deal's table read as empty.

                    Two columns now rather than one with the rest in a tooltip:
                    likes and comments are the pair a creator quotes, and a
                    number that only exists on hover cannot be compared down a
                    column. Shares stay in the tooltip. Each column comes in at
                    the width that has room for it, so a narrow window sheds
                    comments before likes rather than squeezing the title.

                    The rate is engagement over views, the way a creator quotes
                    it to a brand, and it is absent rather than 0% on a post with
                    no views yet: a rate off a zero denominator is not a number. */}
                <div
                  className="hidden w-[68px] shrink-0 text-right lg:block"
                  title={`${cut.likes.toLocaleString()} likes · ${cut.comments.toLocaleString()} comments · ${cut.shares.toLocaleString()} shares`}
                >
                  <p
                    className={`text-[13px] tabular-nums ${cut.likes ? "font-semibold" : "text-ink-50"}`}
                  >
                    {cut.likes ? fmtViews(cut.likes) : "-"}
                  </p>
                  {cut.views > 0 && cut.likes + cut.comments + cut.shares > 0 && (
                    <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-50">
                      {engagement(cut)}
                    </p>
                  )}
                </div>
                <p
                  className={`hidden w-[68px] shrink-0 text-right text-[13px] tabular-nums xl:block ${
                    cut.comments ? "" : "text-ink-50"
                  }`}
                >
                  {cut.comments ? fmtViews(cut.comments) : "-"}
                </p>

                {/* Base and bonus are what the deal is paying, split the way the
                    rate sheet is written, so a row explains its own Payment
                    instead of asking someone to trust it. */}
                {paysBase && (
                  <p
                    className={`w-[80px] shrink-0 text-right text-[13px] tabular-nums ${
                      pay.baseCents ? "" : "text-ink-50"
                    }`}
                  >
                    {pay.baseCents === null ? "-" : money(pay.baseCents)}
                  </p>
                )}
                {paysBonus && (
                  // a zero stays grey: a column of bold $0 down a deal whose
                  // rules have not paid yet reads as the number that matters.
                  <div className="w-[96px] shrink-0 text-right">
                    <p
                      className={`text-[13px] tabular-nums ${
                        pay.bonusCents > 0 ? "" : "text-ink-50"
                      }`}
                    >
                      {pay.bonusCents > 0 ? money(pay.bonusCents) : "-"}
                    </p>
                    {step && (
                      <p className="mt-0.5 text-[11.5px] tabular-nums text-ink-50">{step}</p>
                    )}
                  </div>
                )}

                {/* the total for the row, and the row's one write. The amount is
                    the button: see components/dash/post-payment.tsx. */}
                <div className="w-[104px] shrink-0">
                  <PostPayment
                    dealId={deal.id}
                    videoIds={cut.videos.map((v) => v.id)}
                    title={cut.title}
                    pay={pay}
                    perPost={paysBase || paysBonus}
                  />
                </div>

              </div>
            );
          })}
          </PostSelection>
        </Panel>
      </Page>
    </>
  );
}

/**
 * One fact inside a stat's fold: what it is on the left, the number on the
 * right, on the same tabular rail every other number on the page sits on.
 *
 * `strong` is for the line the ones above it add up to, which is the only thing
 * that makes a column of six numbers readable as a sum rather than a list.
 */
function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <p className="min-w-0 text-[12.5px] text-ink-50">{label}</p>
      <p
        className={`shrink-0 tabular-nums ${
          strong ? "text-[13px] font-bold" : "text-[12.5px] font-semibold text-ink-70"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The one line under a cut's bonus amount: which milestone it reached, or how
 * far the nearest one still is.
 *
 * Measured on `countable_views` out of the earnings function rather than on the
 * cut's raw view total, because those are the views the rule is actually allowed
 * to pay on: a 14 day window on a two month old post counts almost none of them,
 * and a progress line off the raw number would promise a payment that is never
 * coming. A rule that produced no row for any post of the cut does not apply to
 * it (wrong platform), so it is skipped rather than counted as zero.
 *
 * Only milestone rules say anything. A CPM has no step to be short of, and "you
 * are $0.30 off the next cent" is not a sentence.
 */
function cutStep(
  cut: Cut,
  rules: BonusRule[],
  countableViews: Map<string, Map<string, number>>
): string | null {
  let reached: { views: number; amount_cents: number } | null = null;
  let nearest: { tier: { views: number; amount_cents: number }; viewsAway: number } | null = null;

  for (const rule of rules) {
    if (rule.kind !== "milestone") continue;

    let best = -1;
    for (const video of cut.videos) {
      const seen = countableViews.get(video.id)?.get(rule.id);
      if (seen !== undefined) best = Math.max(best, seen);
    }
    if (best < 0) continue;

    const quote = quoteRule(rule, best);
    if (quote.tier && (!reached || quote.tier.amount_cents > reached.amount_cents)) {
      reached = quote.tier;
    }
    if (quote.next && (!nearest || quote.next.viewsAway < nearest.viewsAway)) {
      nearest = quote.next;
    }
  }

  if (reached) return `${fmtViews(reached.views)} tier`;
  if (nearest) return `${fmtViews(nearest.viewsAway)} to go`;
  return null;
}

/**
 * A post's date as a calendar chip: the month over the day.
 *
 * Two lines rather than "Aug 10" on one, because the column is read down and a
 * stack puts every day number in the same place on every row. An older year
 * rides on the month line, where it costs no extra row height.
 */
function stackedDate(value: string | null | undefined, now = new Date()): { top: string; day: string } {
  if (!value) return { top: "no", day: "date" };
  const d = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return { top: "no", day: "date" };
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const year = d.getUTCFullYear();
  return {
    top: year === now.getUTCFullYear() ? month : `${month} ${String(year).slice(2)}`,
    day: String(d.getUTCDate()),
  };
}

/** The pager keeps whatever is being searched or filtered, and only moves `p`. */
function pageHref(query: string | undefined, platforms: string | undefined, page: number): string {
  const params = new URLSearchParams();
  if (query?.trim()) params.set("q", query.trim());
  if (platforms) params.set("pf", platforms);
  params.set("p", String(page));
  return `?${params.toString()}`;
}

/** One arrow of the pager. A link when it goes somewhere, dead text when not. */
function Step({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  const box =
    "grid size-7 place-items-center rounded-full border border-line text-[14px] leading-none";

  if (disabled) return <span className={`${box} text-line`}>{children}</span>;

  return (
    <Link
      href={href}
      aria-label={label}
      scroll={false}
      className={`${box} text-ink-70 transition-colors hover:border-flame/45 hover:text-flame`}
    >
      {children}
    </Link>
  );
}
