import Link from "next/link";
import { BrandMark } from "@/components/dash/brand-mark";
import { Glyph } from "@/components/dash/icons";
import { Cols, DashBar, Empty, Page, Panel, Pill, Row, Stat, barTitle } from "@/components/dash/ui";
import { brandLogo } from "@/lib/brand-catalog";
import { RangePicker } from "@/components/dash/range-picker";
import {
  loadDashboard,
  loadEarnings,
  loadOverview,
  type Attention,
  type TrendDay,
} from "@/lib/dash-server";
import { asDay, toRange } from "@/lib/earnings-range";
import { type DealStatus, type PayCycle } from "@/lib/deals";
import { money, shortDate, views as fmtViews } from "@/lib/money";

export const metadata = { title: "Dashboard · Creator Empire" };

const statusTone: Record<DealStatus, "flame" | "ink" | "quiet" | "line"> = {
  active: "flame",
  draft: "quiet",
  paused: "line",
  ended: "quiet",
};

const cycleWord: Record<PayCycle, string> = {
  monthly: "monthly",
  biweekly: "every 2 weeks",
  weekly: "weekly",
  one_time: "one time",
};

const rangeWord: Record<string, string> = {
  today: "today",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  month: "this month",
  last: "last month",
  "3m": "last 3 months",
  ytd: "this year",
  all: "all time",
  custom: "custom window",
};

const button =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-4 text-[13.5px] font-semibold transition-colors";
const primary = `${button} bg-flame text-on-accent hover:bg-flame-dark`;
const secondary = `${button} border border-line bg-paper text-ink hover:border-flame`;

/**
 * The creator's overview: the money, the views, what is connected, what is in
 * flight, a fortnight of activity, and the short list of things to do next.
 *
 * Every number is inside the picked window except the connected count and the
 * pipeline, which are "right now" by nature. The deal table at the foot is
 * the same window split per deal, so the total above it is the sum of the
 * column below it and the two cannot disagree.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const [{ range: rawRange, from, to }, data] = await Promise.all([
    searchParams,
    loadDashboard(),
  ]);
  const { deals } = data;

  const range = toRange(rawRange);
  const earnings = await loadEarnings(deals, range, {
    from: asDay(from),
    to: asDay(to),
  });
  const overview = await loadOverview(
    deals,
    { from: earnings.from, to: earnings.to },
    earnings.cycles
  );

  const paidCents = deals.reduce((n, r) => n + r.paidCents, 0);
  // what in the window is already on a payout row, versus still adding up.
  // paid never exceeds the period total: a payout logged for an older period
  // is not this window's money.
  const finalCents = Math.min(paidCents, earnings.totalCents);
  const accruingCents = earnings.totalCents - finalCents;

  const cycleByDeal = new Map(earnings.cycles.map((c) => [c.dealId, c]));
  const dealById = new Map(deals.map((r) => [r.deal.id, r]));
  const span = earnings.from
    ? `${shortDate(earnings.from)} to ${shortDate(earnings.to)}`
    : `everything to ${shortDate(earnings.to)}`;
  const hasTrend = overview.trend.some((d) => d.edits > 0 || d.posts > 0);

  return (
    <>
      <DashBar
        rule={false}
        lead={
          <h1 className={barTitle}>
            welcome back, <span className="text-flame">{data.firstName}</span>
          </h1>
        }
        right={
          <div className="flex items-center gap-2">
            <Link href="/editing/new" className={secondary}>
              <Glyph name="clock" className="size-4" />
              get an edit
            </Link>
            <Link href="/tools/autoposting" className={primary}>
              <span aria-hidden="true">+</span> new post
            </Link>
          </div>
        }
      />

      <Page className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-50">
              creator overview
            </p>
            <h2 className="mt-1 text-[26px] font-extrabold leading-none tracking-[-0.03em]">
              track performance.
            </h2>
            <p className="mt-2 text-[14px] text-ink-50">
              earnings, views, posts, and what needs attention.
            </p>
          </div>
          <Link href="/deals/new" className={primary}>
            <span aria-hidden="true">+</span> create deal
          </Link>
        </div>

        {data.accountsWithErrors > 0 && (
          <Link
            href="/deals"
            className="flex items-center justify-between gap-4 rounded-card border border-line bg-ember px-5 py-3 transition-colors hover:border-flame"
          >
            <p className="text-[13.5px] font-semibold text-flame-dark">
              {data.accountsWithErrors} account
              {data.accountsWithErrors === 1 ? "" : "s"} failed the last sync.
            </p>
            <span className="shrink-0 text-[13px] font-semibold text-flame-dark">fix →</span>
          </Link>
        )}

        {/* the window every number below is inside of */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-paper px-5 py-3 shadow-card">
          <p className="text-[14px] font-bold tracking-[-0.01em]">performance overview</p>
          <RangePicker active={range} from={earnings.from} to={earnings.to} />
          <p className="text-[12.5px] text-ink-50">
            {span} · {rangeWord[range] ?? range}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            icon={<Glyph name="money" />}
            label="earned in range"
            value={money(earnings.totalCents)}
            note={`${money(finalCents)} final · ${money(accruingCents)} still accruing`}
          />
          <Stat
            icon={<Glyph name="eye" />}
            label="views in range"
            value={fmtViews(overview.viewsInRange)}
            note={`${overview.postedInRange} attributed post${overview.postedInRange === 1 ? "" : "s"}`}
          />
          <Stat
            icon={<Glyph name="deal" />}
            label="connected accounts"
            value={String(overview.connectedAccounts)}
            note="across your deals"
          />
          <Stat
            icon={<Glyph name="clock" />}
            label="content pipeline"
            value={String(overview.jobsInFlight)}
            note={
              overview.jobsAwaitingReview > 0
                ? `${overview.jobsAwaitingReview} waiting on you`
                : "edit requests in flight"
            }
          />
          <Stat
            icon={<Glyph name="calendar" />}
            label="scheduled posts"
            value={String(overview.postsInRange)}
            note={`${overview.postsQueued} queued · ${overview.postsFailed} failed`}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Panel
            title="performance trend"
            sub="edit requests + scheduled posts · last 14 days"
            flush
            action={
              <div className="flex items-center gap-3 text-[12px] font-semibold text-ink-50">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-live" /> edit requests
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-flame" /> scheduled posts
                </span>
              </div>
            }
          >
            {hasTrend ? (
              <TrendChart days={overview.trend} />
            ) : (
              <p className="py-10 text-center text-[13.5px] leading-[1.5] text-ink-50">
                no activity in the last 14 days. schedule a post or send an edit request and
                it shows up here.
              </p>
            )}
          </Panel>

          <Panel title="needs attention" sub="your next actions" padded={false}>
            {overview.attention.length === 0 && (
              <p className="px-5 py-10 text-center text-[13.5px] leading-[1.5] text-ink-50">
                nothing needs attention yet. start with a deal.
              </p>
            )}
            {overview.attention.map((a, i) => (
              <AttentionRow key={`${a.kind}-${i}`} item={a} />
            ))}
          </Panel>
        </div>

        <Panel
          title="deal performance"
          sub={`earned and views in range · ${rangeWord[range] ?? range}`}
          padded={false}
          action={
            <Link
              href="/deals"
              className="shrink-0 text-[13px] font-semibold text-ink-50 hover:text-flame"
            >
              {deals.length === 0 ? "open" : `all ${deals.length} →`}
            </Link>
          }
          toolbar={
            <div className="flex items-baseline gap-2.5">
              <p className="text-[24px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
                {money(earnings.totalCents)}
              </p>
              <p className="text-[13px] text-ink-50">
                {money(earnings.flatCents)} flat · {money(earnings.bonusCents)} bonuses
              </p>
            </div>
          }
        >
          {deals.length === 0 ? (
            <Empty
              icon={<Glyph name="deal" />}
              title="no deals yet."
              line="add your first brand deal and the numbers on this page start counting themselves."
              action={
                <Link href="/deals/new" className={primary}>
                  add a deal
                </Link>
              }
            />
          ) : (
            <>
              <Cols>
                <span className="flex-1">brand</span>
                <span className="hidden w-24 text-right sm:block">views</span>
                <span className="hidden w-16 text-right sm:block">posts</span>
                <span className="w-28 text-right">earned</span>
              </Cols>
              {earnings.perDeal.map((r) => {
                const row = dealById.get(r.dealId);
                const cycle = cycleByDeal.get(r.dealId);
                const stat = overview.perDeal[r.dealId] ?? { views: 0, posts: 0 };
                return (
                  <Row key={r.dealId}>
                    <Link
                      href={`/deals/${r.dealId}`}
                      className="flex min-w-0 flex-1 items-center gap-3.5 py-0.5"
                    >
                      <BrandMark name={r.brand.name} logo={brandLogo(r.brand)} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-[14.5px] font-bold tracking-[-0.015em]">
                            {r.brand.name}
                          </span>
                          {row && <Pill tone={statusTone[row.deal.status]}>{row.deal.status}</Pill>}
                          {cycle && (
                            <Pill tone="quiet">{cycleWord[cycle.payCycle as PayCycle]}</Pill>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-ink-50">
                          {row ? `${row.videoCount} video${row.videoCount === 1 ? "" : "s"} tracked` : ""}
                          {cycle?.payBy ? ` · pays by ${shortDate(cycle.payBy)}` : ""}
                        </span>
                      </span>
                    </Link>
                    <span className="hidden w-24 text-right text-[14px] font-semibold tabular-nums sm:block">
                      {fmtViews(stat.views)}
                    </span>
                    <span className="hidden w-16 text-right text-[14px] font-semibold tabular-nums sm:block">
                      {stat.posts}
                    </span>
                    <div className="w-28 shrink-0 text-right">
                      <p className="text-[15px] font-bold tabular-nums">{money(r.totalCents)}</p>
                      <p className="text-[12px] text-ink-50 tabular-nums">
                        {money(r.bonusCents)} bonus
                      </p>
                    </div>
                  </Row>
                );
              })}
            </>
          )}
        </Panel>
      </Page>
    </>
  );
}

/** one thing to do, as a row. the whole row is the link. */
function AttentionRow({ item }: { item: Attention }) {
  const tone: Record<Attention["kind"], string> = {
    accounts: "bg-ember text-flame-dark",
    review: "bg-live-soft text-live",
    failed: "bg-ember text-flame-dark",
    payout: "bg-live-soft text-live",
    sync: "bg-ember text-flame-dark",
  };
  return (
    <Row>
      <Link href={item.href} className="flex min-w-0 flex-1 items-center gap-3 py-0.5">
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone[item.kind]}`}
        >
          <Glyph
            name={item.kind === "payout" ? "money" : item.kind === "review" ? "clock" : "deal"}
            className="size-4"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold tracking-[-0.01em]">
            {item.title}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink-50">{item.line}</span>
        </span>
        <span className="shrink-0 text-[14px] font-bold text-ink-50">→</span>
      </Link>
    </Row>
  );
}

/**
 * fourteen days, two bars a day. plain svg, no library: two series and a
 * baseline is not a charting problem.
 */
function TrendChart({ days }: { days: TrendDay[] }) {
  const W = 560;
  const H = 180;
  const padX = 8;
  const padTop = 12;
  const padBottom = 26;
  const max = Math.max(1, ...days.map((d) => Math.max(d.edits, d.posts)));
  const slot = (W - padX * 2) / days.length;
  const bar = Math.min(12, slot * 0.32);
  const gap = 3;
  const plotH = H - padTop - padBottom;
  const y = (n: number) => padTop + plotH - (n / max) * plotH;

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full min-w-[420px]"
        role="img"
        aria-label="edit requests and scheduled posts per day, last 14 days"
      >
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={padX}
            x2={W - padX}
            y1={padTop + plotH * (1 - t)}
            y2={padTop + plotH * (1 - t)}
            stroke="currentColor"
            className="text-line"
            strokeWidth="1"
          />
        ))}
        {days.map((d, i) => {
          const cx = padX + slot * i + slot / 2;
          const label = new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          return (
            <g key={d.day}>
              <rect
                x={cx - bar - gap / 2}
                y={y(d.edits)}
                width={bar}
                height={padTop + plotH - y(d.edits)}
                rx="2"
                className="fill-live"
              />
              <rect
                x={cx + gap / 2}
                y={y(d.posts)}
                width={bar}
                height={padTop + plotH - y(d.posts)}
                rx="2"
                className="fill-flame"
              />
              {(i % 2 === 1 || days.length <= 7) && (
                <text
                  x={cx}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="10"
                  className="fill-ink-50"
                >
                  {label.toLowerCase()}
                </text>
              )}
            </g>
          );
        })}
        <text x={padX} y={padTop - 2} fontSize="10" className="fill-ink-50">
          {max}
        </text>
      </svg>
    </div>
  );
}
