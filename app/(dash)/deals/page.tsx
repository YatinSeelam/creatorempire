import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/dash/brand-mark";
import { DealMenu } from "@/components/dash/deal-menu";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { RefreshAll } from "@/components/dash/refresh-all";
import { Stamp } from "@/components/dash/stamp";
import { loadAutopostDeals } from "@/lib/autopost/server";
import { dealScope, loadWorkspace } from "@/lib/workspace";
import { brandLogo } from "@/lib/brand-catalog";
import { PLATFORMS, PLATFORM_LABEL, type DealStatus, type Platform } from "@/lib/deals";
import { loadDeals, loadRefreshQuota, type DealListRow } from "@/lib/deals-server";
import { money, shortDate, since, views as fmtViews } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { BASE_PATH } from "@/lib/base-path";

export const metadata = { title: "Deals · Creator Empire" };

/**
 * The refresh button posts from here, and a server action inherits the segment's
 * budget. A roster of fifteen accounts is minutes of provider round trips, and
 * the default fifteen seconds would kill the sweep after the allowance had
 * already been spent on it.
 */
export const maxDuration = 300;

const statusDot: Record<DealStatus, string> = {
  active: "bg-live",
  paused: "bg-flame",
  draft: "bg-ink-50",
  ended: "bg-line",
};

const statusWord: Record<DealStatus, string> = {
  active: "active",
  paused: "paused",
  draft: "draft",
  ended: "not live",
};

const btn =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors";
const primary = `${btn} bg-flame text-on-accent hover:bg-flame-dark`;
const ghost = `${btn} border border-line bg-paper text-ink hover:bg-shell`;

/**
 * the management list: every deal as one row of a quiet table, with the four
 * totals worth chasing above it. live deals sort first, the status chip says
 * why. the brand name is the only link in the row, the menu at the end carries
 * the rest, and the platform cell opens the accounts section of the edit page.
 */
export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [rows, quota, posting, ws] = await Promise.all([
    loadDeals(),
    loadRefreshQuota(),
    user ? dealScope().then((scope) => loadAutopostDeals(supabase, user.id, scope)) : Promise.resolve([]),
    loadWorkspace(),
  ]);
  const seat = ws.seatBrand;
  const queueBy = new Map(posting.map((d) => [d.dealId, d] as const));

  const sorted = [
    ...rows.filter((r) => r.deal.status === "active"),
    ...rows.filter((r) => r.deal.status !== "active"),
  ];

  const live = rows.filter((r) => r.deal.status === "active").length;
  const totalViews = rows.reduce((n, r) => n + r.totalViews, 0);
  const totalVideos = rows.reduce((n, r) => n + r.videoCount, 0);
  const earned = rows.reduce((n, r) => n + r.earnedCents, 0);
  const paid = rows.reduce((n, r) => n + r.paidCents, 0);
  const owed = rows.reduce((n, r) => n + Math.max(0, r.earnedCents - r.paidCents), 0);
  const queued = posting.reduce((n, d) => n + d.queued, 0);
  const syncedAt = rows.reduce<string | null>(
    (newest, r) => (r.lastSyncedAt && (!newest || r.lastSyncedAt > newest) ? r.lastSyncedAt : newest),
    null
  );

  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-bold tracking-[-0.01em]">deals</h1>
          <span className="text-[12px] text-ink-50">
            {rows.length} total · {live} live{seat ? ` · for ${seat.name}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rows.length > 0 ? <RefreshAll quota={quota} /> : null}
          {rows.length > 0 ? (
            <a href={`${BASE_PATH}/deals/export`} download className={ghost}>
              export csv
            </a>
          ) : null}
          <Link href="/deals/new" className={primary}>
            <span aria-hidden="true">+</span> deal
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="live deals" value={String(live)} note={`${rows.length - live} not running`} />
        <Tile
          label="views"
          value={fmtViews(totalViews)}
          note={`${totalVideos} video${totalVideos === 1 ? "" : "s"} tracked`}
        />
        <Tile label="earned" value={money(earned)} note={`${money(paid)} paid out`} />
        <Tile
          label="owed"
          value={money(owed)}
          note={queued > 0 ? `${queued} post${queued === 1 ? "" : "s"} queued` : "nothing queued"}
          hot={owed > 0}
        />
      </div>

      <section className="rounded-xl border border-line bg-paper">
        <header className="flex items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-[13.5px] font-bold tracking-[-0.01em]">all deals</h2>
          <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-50">
            <ClockIcon />
            {syncedAt
              ? `updated ${since(syncedAt)} · every account pulls itself every 3 days`
              : "nothing synced yet · every account pulls itself every 3 days"}
          </span>
        </header>

        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-[13.5px] font-semibold">no deals yet</p>
            <p className="mx-auto mt-1 max-w-[46ch] text-[12.5px] leading-[1.55] text-ink-50">
              {seat
                ? `deals you do for ${seat.name} live here and count on their roster.`
                : "a deal is one brand and its pay. add the accounts you post to, then the bonus rules, and the views start counting themselves."}
            </p>
            <Link href="/deals/new" className={`${primary} mt-4`}>
              add your first deal
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto lg:overflow-visible">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-50">
                  <th className="px-4 py-2.5 font-semibold">brand</th>
                  <th className="px-3 py-2.5 font-semibold">status</th>
                  <th className="px-3 py-2.5 font-semibold">platforms</th>
                  <th className="px-3 py-2.5 text-right font-semibold">videos</th>
                  <th className="px-3 py-2.5 text-right font-semibold">views</th>
                  <th className="px-3 py-2.5 text-right font-semibold">earned</th>
                  <th className="px-3 py-2.5 text-right font-semibold">owed</th>
                  <th className="w-10 px-2 py-2.5" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => (
                  <DealRow
                    key={row.deal.id}
                    row={row}
                    queued={queueBy.get(row.deal.id)?.queued ?? 0}
                    nextAt={queueBy.get(row.deal.id)?.nextAt ?? null}
                    up={sorted.length > 3 && i >= sorted.length - 2}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  hot = false,
}: {
  label: string;
  value: string;
  note: ReactNode;
  hot?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
      <p className="text-[12px] font-semibold text-ink-50">{label}</p>
      <p
        className={`mt-2 text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums ${
          hot ? "text-flame" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-2 text-[11.5px] text-ink-50">{note}</p>
    </div>
  );
}

/** one deal, one row. the name is the link, the platform cell opens accounts, the menu carries the rest. */
function DealRow({
  row,
  queued,
  nextAt,
  up,
}: {
  row: DealListRow;
  queued: number;
  nextAt: string | null;
  up: boolean;
}) {
  const unpaid = row.earnedCents - row.paidCents;
  const on = new Set<Platform>(row.platforms);

  return (
    <tr className="border-t border-line hover:bg-shell/60">
      <td className="px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandMark name={row.brand.name} logo={brandLogo(row.brand)} size="sm" />
          <div className="min-w-0">
            <Link
              href={`/deals/${row.deal.id}`}
              draggable={false}
              className="block truncate font-semibold hover:text-flame"
            >
              {row.brand.name}
            </Link>
            <p className="truncate text-[11.5px] text-ink-50">
              {row.deal.name}
              {queued > 0 ? (
                <>
                  {" · "}
                  <Link
                    href={`/tools/autoposting?deal=${row.deal.id}`}
                    draggable={false}
                    className="font-semibold text-flame hover:text-flame-dark"
                  >
                    {queued} queued
                  </Link>
                  {nextAt ? (
                    <>
                      {", next "}
                      <Stamp iso={nextAt} until />
                    </>
                  ) : (
                    ", posting now"
                  )}
                </>
              ) : row.lastPostedAt ? (
                ` · last posted ${shortDate(row.lastPostedAt)}`
              ) : (
                " · nothing posted yet"
              )}
            </p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-shell px-2 py-0.5 text-[11.5px] font-semibold">
          <span className={`size-1.5 rounded-full ${statusDot[row.deal.status]}`} />
          {statusWord[row.deal.status]}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/deals/${row.deal.id}/edit#accounts`}
          draggable={false}
          title={
            row.platforms.length
              ? `posts on ${row.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}. add or change an account.`
              : "no accounts on this deal. connect one or type a handle in."
          }
          aria-label={
            row.platforms.length
              ? `accounts on this deal: ${row.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}`
              : "no accounts on this deal yet. add one."
          }
          className="inline-flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/45"
        >
          {PLATFORMS.map((p) => (
            <span
              key={p}
              aria-hidden="true"
              className={`flex size-6 items-center justify-center rounded-md ${
                on.has(p) ? "bg-shell" : "opacity-25"
              }`}
            >
              <PlatformGlyph platform={p} tone={on.has(p) ? "brand" : "current"} className="size-[14px]" />
            </span>
          ))}
        </Link>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-50">{row.videoCount}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{fmtViews(row.totalViews)}</td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(row.earnedCents)}</td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums ${
          unpaid > 0 ? "font-bold text-flame" : "text-ink-50"
        }`}
      >
        {money(Math.max(0, unpaid))}
      </td>
      <td className="px-2 py-2.5 text-right">
        <DealMenu dealId={row.deal.id} brand={row.brand.name} up={up} />
      </td>
    </tr>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[13px] shrink-0"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  );
}
