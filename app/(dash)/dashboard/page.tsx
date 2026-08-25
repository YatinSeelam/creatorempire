import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { Glyph } from "@/components/dash/icons";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { RangePicker } from "@/components/dash/range-picker";
import { brandLogo } from "@/lib/brand-catalog";
import {
  loadDashboard,
  loadEarnings,
  loadOverview,
  type Attention,
  type FeedVideo,
  type TrendDay,
} from "@/lib/dash-server";
import { asDay, toRange } from "@/lib/earnings-range";
import { PLATFORMS, PLATFORM_LABEL, type DealStatus, type PayCycle, type Platform } from "@/lib/deals";
import { ago, money, shortDate, views as fmtViews } from "@/lib/money";

export const metadata = { title: "Dashboard · Creator Empire" };

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

const platformColor: Record<Platform, string> = {
  tiktok: "#101010",
  instagram: "#d6336c",
  youtube: "#e03131",
  facebook: "#1c64f2",
};

const btn =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors";
const primary = `${btn} bg-flame text-on-accent hover:bg-flame-dark`;
const ghost = `${btn} border border-line bg-paper text-ink hover:bg-shell`;

/**
 * the creator's overview, laid out as one quiet grid: a thin toolbar, four
 * numbers, a chart beside the platform split, two short lists, and a table.
 * every number is inside the picked window except the pipeline and the
 * connected count, which are "right now" by nature.
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
  const finalCents = Math.min(paidCents, earnings.totalCents);
  const accruingCents = earnings.totalCents - finalCents;

  const cycleByDeal = new Map(earnings.cycles.map((c) => [c.dealId, c]));
  const dealById = new Map(deals.map((r) => [r.deal.id, r]));
  const span = earnings.from
    ? `${shortDate(earnings.from)} to ${shortDate(earnings.to)}`
    : `everything to ${shortDate(earnings.to)}`;
  const hasTrend = overview.trend.some((d) => d.edits > 0 || d.posts > 0);
  const totalAccounts = PLATFORMS.reduce((n, p) => n + (data.accountsByPlatform[p] ?? 0), 0);
  const topVideos = [...data.recentVideos].sort((a, b) => b.views - a.views).slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4">
      {/* toolbar: who, the window, what to do */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-bold tracking-[-0.01em]">
            welcome back, {data.firstName}
          </h1>
          <span className="text-[12px] text-ink-50">
            {span} · {rangeWord[range] ?? range}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker active={range} from={earnings.from} to={earnings.to} />
          <Link href="/editing/new" className={ghost}>
            get an edit
          </Link>
          <Link href="/tools/autoposting" className={ghost}>
            new post
          </Link>
          <Link href="/deals/new" className={primary}>
            <span aria-hidden="true">+</span> deal
          </Link>
        </div>
      </div>

      {data.accountsWithErrors > 0 && (
        <Link
          href="/deals"
          className="flex items-center justify-between rounded-xl border border-line bg-paper px-4 py-2.5 text-[12.5px] font-semibold hover:bg-shell"
        >
          <span>
            {data.accountsWithErrors} account{data.accountsWithErrors === 1 ? "" : "s"} failed
            the last sync
          </span>
          <span className="text-ink-50">fix →</span>
        </Link>
      )}

      {/* the four numbers */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="earned"
          value={money(earnings.totalCents)}
          note={`${money(finalCents)} paid · ${money(accruingCents)} accruing`}
          icon="money"
          tone="bg-ember text-flame"
        />
        <Tile
          label="views"
          value={fmtViews(overview.viewsInRange)}
          note={`${overview.postedInRange} post${overview.postedInRange === 1 ? "" : "s"} in range`}
          icon="eye"
          tone="bg-live-soft text-live"
        />
        <Tile
          label="scheduled"
          value={String(overview.postsInRange)}
          note={`${overview.postsQueued} queued · ${overview.postsFailed} failed`}
          icon="calendar"
          tone="bg-ember text-flame"
        />
        <Tile
          label="in edit"
          value={String(overview.jobsInFlight)}
          note={
            overview.jobsAwaitingReview > 0
              ? `${overview.jobsAwaitingReview} waiting on you`
              : "edit requests in flight"
          }
          icon="clock"
          tone="bg-live-soft text-live"
        />
      </div>

      {/* activity beside the platform split */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card
          title="activity"
          right={
            <span className="flex items-center gap-3 text-[11.5px] font-medium text-ink-50">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-live" /> edits
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-flame" /> posts
              </span>
            </span>
          }
        >
          {hasTrend ? (
            <TrendChart days={overview.trend} />
          ) : (
            <Blank>no activity in the last 14 days. schedule a post or send an edit and it shows here.</Blank>
          )}
        </Card>

        <Card
          title="platforms"
          right={
            <span className="text-[11.5px] font-medium text-ink-50">
              {overview.connectedAccounts} of {totalAccounts} connected
            </span>
          }
        >
          {totalAccounts === 0 ? (
            <Blank>no accounts tracked yet. add one on a deal.</Blank>
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4">
              {PLATFORMS.map((p) => {
                const n = data.accountsByPlatform[p] ?? 0;
                const share = totalAccounts ? n / totalAccounts : 0;
                return (
                  <div key={p} className="border-l-2 pl-3" style={{ borderColor: platformColor[p] }}>
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                      <PlatformGlyph platform={p} className="size-[14px]" tone="brand" />
                      {PLATFORM_LABEL[p]}
                    </div>
                    <p className="mt-1.5 text-[22px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
                      {Math.round(share * 100)}%
                    </p>
                    <p className="mt-1.5 text-[11.5px] text-ink-50">
                      {n} account{n === 1 ? "" : "s"}
                    </p>
                    <Ticks share={share} color={platformColor[p]} />
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* two short lists */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="needs attention" flush>
          {overview.attention.length === 0 ? (
            <Blank>nothing needs attention. start with a deal.</Blank>
          ) : (
            overview.attention.map((a, i) => <AttentionRow key={`${a.kind}-${i}`} item={a} />)
          )}
        </Card>

        <Card
          title="top posts"
          flush
          right={
            <span className="text-[11.5px] font-medium text-ink-50">recent, by views</span>
          }
        >
          {topVideos.length === 0 ? (
            <Blank>no posts tracked yet.</Blank>
          ) : (
            topVideos.map((v, i) => <VideoRow key={v.id} rank={i + 1} video={v} />)
          )}
        </Card>
      </div>

      {/* the table */}
      <Card
        title="deals"
        flush
        right={
          <span className="flex items-center gap-3 text-[11.5px] font-medium text-ink-50">
            <span className="tabular-nums">
              {money(earnings.flatCents)} flat · {money(earnings.bonusCents)} bonus
            </span>
            <Link href="/deals" className="font-semibold text-ink hover:text-flame">
              all {deals.length} →
            </Link>
          </span>
        }
      >
        {deals.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-[13.5px] font-semibold">no deals yet</p>
            <p className="mt-1 text-[12.5px] text-ink-50">
              add your first brand deal and these numbers start counting themselves.
            </p>
            <Link href="/deals/new" className={`${primary} mt-4`}>
              add a deal
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-50">
                  <th className="px-4 py-2.5 font-semibold">brand</th>
                  <th className="px-3 py-2.5 font-semibold">status</th>
                  <th className="px-3 py-2.5 font-semibold">platforms</th>
                  <th className="px-3 py-2.5 text-right font-semibold">views</th>
                  <th className="px-3 py-2.5 text-right font-semibold">posts</th>
                  <th className="px-3 py-2.5 font-semibold">pays</th>
                  <th className="px-4 py-2.5 text-right font-semibold">earned</th>
                </tr>
              </thead>
              <tbody>
                {earnings.perDeal.map((r) => {
                  const row = dealById.get(r.dealId);
                  const cycle = cycleByDeal.get(r.dealId);
                  const stat = overview.perDeal[r.dealId] ?? { views: 0, posts: 0 };
                  return (
                    <tr key={r.dealId} className="border-t border-line hover:bg-shell/60">
                      <td className="px-4 py-2.5">
                        <Link href={`/deals/${r.dealId}`} className="flex items-center gap-2.5">
                          <BrandMark name={r.brand.name} logo={brandLogo(r.brand)} size="sm" />
                          <span className="font-semibold">{r.brand.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        {row && <StatusDot status={row.deal.status} />}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 text-ink-50">
                          {(row?.platforms ?? []).map((p) => (
                            <PlatformGlyph key={p} platform={p} className="size-[14px]" tone="brand" />
                          ))}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmtViews(stat.views)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{stat.posts}</td>
                      <td className="px-3 py-2.5 text-ink-50">
                        {cycle ? cycleWord[cycle.payCycle as PayCycle] : ""}
                        {cycle?.payBy ? ` · by ${shortDate(cycle.payBy)}` : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-bold tabular-nums">{money(r.totalCents)}</span>
                        <span className="ml-1.5 text-[11.5px] text-ink-50 tabular-nums">
                          {money(r.bonusCents)} bonus
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* primitives local to this page: thinner and quieter than the shared panel */

function Card({
  title,
  right,
  flush = false,
  children,
}: {
  title: string;
  right?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-[13.5px] font-bold tracking-[-0.01em]">{title}</h2>
        {right}
      </header>
      <div className={flush ? "" : "px-4 pb-4"}>{children}</div>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  icon: "money" | "eye" | "calendar" | "clock";
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
      <div className="flex items-start justify-between">
        <p className="text-[12px] font-semibold text-ink-50">{label}</p>
        <span className={`flex size-6 items-center justify-center rounded-md ${tone}`}>
          <Glyph name={icon} className="size-3.5" />
        </span>
      </div>
      <p className="mt-2 text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[11.5px] text-ink-50">{note}</p>
    </div>
  );
}

function Blank({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-[12.5px] leading-[1.5] text-ink-50">{children}</p>
  );
}

/** a strip of thin ticks, filled to the share. the dora bar, without the library. */
function Ticks({ share, color }: { share: number; color: string }) {
  const n = 24;
  const lit = Math.round(share * n);
  return (
    <div className="mt-3 flex h-6 items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="w-[2px] flex-1 rounded-sm"
          style={{
            height: i % 3 === 0 ? "100%" : "70%",
            backgroundColor: i < lit ? color : "var(--color-line)",
          }}
        />
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: DealStatus }) {
  const color: Record<DealStatus, string> = {
    active: "bg-live",
    draft: "bg-ink-50",
    paused: "bg-flame",
    ended: "bg-line",
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-shell px-2 py-0.5 text-[11.5px] font-semibold">
      <span className={`size-1.5 rounded-full ${color[status]}`} />
      {status}
    </span>
  );
}

function AttentionRow({ item }: { item: Attention }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 border-t border-line px-4 py-2.5 hover:bg-shell/60"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-shell text-ink-50">
        <Glyph
          name={item.kind === "payout" ? "money" : item.kind === "review" ? "clock" : "deal"}
          className="size-3.5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{item.title}</span>
        <span className="block truncate text-[11.5px] text-ink-50">{item.line}</span>
      </span>
      <span className="text-[12px] text-ink-50">→</span>
    </Link>
  );
}

function VideoRow({ rank, video }: { rank: number; video: FeedVideo }) {
  const inner = (
    <>
      <span className="w-5 shrink-0 text-[11px] font-semibold text-ink-50 tabular-nums">#{rank}</span>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-shell">
        <PlatformGlyph platform={video.platform} className="size-[14px]" tone="brand" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">
          {video.caption?.trim() || `@${video.handle}`}
        </span>
        <span className="block truncate text-[11.5px] text-ink-50">
          {video.brandName} · {ago(video.posted_at)}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-[13px] font-bold tabular-nums">{fmtViews(video.views)}</span>
        <span className="block text-[10.5px] text-ink-50">views</span>
      </span>
    </>
  );
  const cls = "flex items-center gap-3 border-t border-line px-4 py-2.5 hover:bg-shell/60";
  return video.url ? (
    <a href={video.url} target="_blank" rel="noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** fourteen days, two bars a day. plain svg: two series and a baseline is not a charting problem. */
function TrendChart({ days }: { days: TrendDay[] }) {
  const W = 560;
  const H = 170;
  const padX = 8;
  const padTop = 12;
  const padBottom = 24;
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
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="10" className="fill-ink-50">
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
