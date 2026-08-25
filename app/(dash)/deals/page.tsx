import Link from "next/link";
import { BrandMark } from "@/components/dash/brand-mark";
import { DealMenu } from "@/components/dash/deal-menu";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { RefreshAll } from "@/components/dash/refresh-all";
import { Stamp } from "@/components/dash/stamp";
import { Cols, DashBar, Page, Panel, Pill, StatusChip, barTitle } from "@/components/dash/ui";
import { loadAutopostDeals } from "@/lib/autopost/server";
import { dealScope, loadWorkspace } from "@/lib/workspace";
import { brandLogo } from "@/lib/brand-catalog";
import { PLATFORMS, PLATFORM_LABEL, type DealStatus, type Platform } from "@/lib/deals";
import { loadDeals, loadRefreshQuota, type DealListRow } from "@/lib/deals-server";
import { money, shortDate, since, views as fmtViews } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Deals · Creator Empire" };

/**
 * The refresh button posts from here, and a server action inherits the segment's
 * budget. A roster of fifteen accounts is minutes of provider round trips, and
 * the default fifteen seconds would kill the sweep after the allowance had
 * already been spent on it.
 */
export const maxDuration = 300;

const statusTone: Record<DealStatus, "live" | "warm" | "quiet"> = {
  active: "live",
  paused: "warm",
  draft: "quiet",
  ended: "quiet",
};

/** The chip is a label in a column, so it takes a capital the way the column
 *  heads above it do. "ended" also stops being a tense nobody says out loud. */
const statusWord: Record<DealStatus, string> = {
  active: "Active",
  paused: "Paused",
  draft: "Draft",
  ended: "Not live",
};

/**
 * The management list, not the overview. The dashboard already owns the stat
 * row, so repeating it here made the two pages read as the same screen. This
 * page's job is different: every deal, with the one number worth chasing pulled
 * into the header.
 *
 * It is one table with named columns, and every row carries the same seven
 * facts. Two things about the shape are worth keeping:
 *
 * **Status is a column now, not a seam.** The list used to run the live deals,
 * print a "Not running · 2" strip, then run the rest. That strip was doing the
 * work a column does, but worse: it only told you a row was *not* active, never
 * which of draft, paused or ended it was, and it broke the table in half so no
 * number could be compared past it. Live deals still sort first, because that is
 * the order you want to read them in, but the chip is what says so.
 *
 * **The rows are separated by a band of the page's own ground rather than a
 * hairline.** Seven columns of numbers on hairline-divided rows reads as a
 * spreadsheet; a slab per deal reads as a list of things you own. It also gives
 * the running deal somewhere to be tinted, which is the whole reason the eye
 * lands in the right place before reading a word.
 */
export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The queue half of every row, which used to be a second list under a second
  // rail row. Three small selects, run alongside the money, and merged into the
  // one line each row already had for "last posted": the fact a creator opened
  // /social for was almost always "is anything due to go out", and that is one
  // sentence, not a page.
  const [rows, quota, posting, ws] = await Promise.all([
    loadDeals(),
    loadRefreshQuota(),
    user ? dealScope().then((scope) => loadAutopostDeals(supabase, user.id, scope)) : Promise.resolve([]),
    loadWorkspace(),
  ]);
  // the agency seat these deals are for, if any. said on the bar rather than
  // left to the rail's head alone: the list is the creator's own list on their
  // own account and a different list on each seat, and a page that looked
  // identical in both was how a deal got filed on the wrong books.
  const seat = ws.seatBrand;

  const queueBy = new Map(posting.map((d) => [d.dealId, d] as const));

  // live first, then everything else, each half still newest first. The status
  // chip carries what the old group heading used to say.
  const sorted = [
    ...rows.filter((r) => r.deal.status === "active"),
    ...rows.filter((r) => r.deal.status !== "active"),
  ];

  const owed = rows.reduce((n, r) => n + Math.max(0, r.earnedCents - r.paidCents), 0);
  const syncedAt = rows.reduce<string | null>(
    (newest, r) => (r.lastSyncedAt && (!newest || r.lastSyncedAt > newest) ? r.lastSyncedAt : newest),
    null
  );

  return (
    <>
      <DashBar
        lead={
          <div className="flex min-w-0 items-center gap-3">
            <h1 className={barTitle}>Deals</h1>
            {seat && <Pill tone="quiet">for {seat.name}</Pill>}
          </div>
        }
        right={
          <div className="flex shrink-0 items-center gap-2">
            {rows.length > 0 ? <RefreshAll quota={quota} /> : null}
            {rows.length > 0 ? (
              // a plain anchor, not a Link: the route answers with a file and
              // client navigation would swallow the download.
              <a
                href="/deals/export"
                download
                className="flex h-9 items-center rounded-pill border border-line bg-paper px-4 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
              >
                Export csv
              </a>
            ) : null}
            <Link
              href="/deals/new"
              className="flex h-9 shrink-0 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
            >
              New deal
            </Link>
          </div>
        }
      />

      <Page className="space-y-5">
        {rows.length === 0 ? (
          <Panel padded={false}>
            <div className="px-5 py-12 text-center">
              <p className="text-[16px] font-bold tracking-[-0.02em]">No deals yet.</p>
              <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] leading-[1.55] text-ink-50">
                {seat
                  ? `Deals you do for ${seat.name} live here and count on their roster. Your own deals stay on your own account, one switch away.`
                  : "A deal is one brand and its pay. Add the accounts you post to, then the bonus rules, and the views start counting themselves."}
              </p>
              <Link
                href="/deals/new"
                className="mt-6 inline-flex h-10 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
              >
                Add your first deal
              </Link>
            </div>
          </Panel>
        ) : (
          <Panel
            title={`${rows.length} deal${rows.length === 1 ? "" : "s"}`}
            padded={false}
            // the row menus are absolutely positioned popovers, and a card that
            // clips its corners clips those too however high their z-index goes.
            // Safe here because nothing in the card paints into a corner: the
            // header takes the top edge and the footer takes the bottom, so the
            // rows only ever meet a straight side.
            clip={false}
            action={
              <span className="text-[13px] font-semibold tabular-nums">
                <span className="text-ink-50">Outstanding </span>
                <span className={owed > 0 ? "text-flame" : "text-ink-50"}>{money(owed)}</span>
              </span>
            }
            footer={
              <p className="flex items-center gap-2 px-5 py-3 text-[12.5px] text-ink-50 sm:px-6">
                <ClockIcon />
                {syncedAt
                  ? `Updated ${since(syncedAt)}. Every account pulls itself every 3 days.`
                  : "Nothing has been synced yet. Every account pulls itself every 3 days."}
              </p>
            }
          >
            <Cols>
              <span className="w-14 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">Brand &amp; campaign</span>
              <span className="hidden w-[92px] shrink-0 sm:block">Status</span>
              <span className="hidden w-[162px] shrink-0 lg:block">Platforms</span>
              <span className="hidden w-[64px] shrink-0 text-right md:block">Videos</span>
              <span className="w-[80px] shrink-0 text-right">Views</span>
              <span className="w-[92px] shrink-0 text-right">Earned</span>
              <span className="w-[92px] shrink-0 text-right">Owed</span>
              <span className="w-8 shrink-0" aria-hidden="true" />
            </Cols>

            {sorted.map((row, i) => (
              <DealRow
                key={row.deal.id}
                row={row}
                queued={queueBy.get(row.deal.id)?.queued ?? 0}
                nextAt={queueBy.get(row.deal.id)?.nextAt ?? null}
                // the last couple of menus open upward so they land inside the
                // card rather than off the bottom of it. Only worth doing once
                // the list is long enough for "the last row" to mean anything.
                up={sorted.length > 3 && i >= sorted.length - 2}
              />
            ))}
          </Panel>
        )}
      </Page>
    </>
  );
}

/**
 * One deal, one slab, sitting on the columns named above it.
 *
 * The brand name is the link, plus the Open deal chip beside it that says so.
 * Nothing else in the row is.
 *
 * This used to be an absolutely positioned overlay covering the whole slab, so
 * a click anywhere opened the deal. That also meant the row could not be READ:
 * every drag across a handle, a view count or a date landed on the overlay and
 * navigated instead of selecting, and there is no way to copy a number off a
 * table you cannot put a cursor in. A table is text first. `draggable={false}`
 * on the anchor is the other half of it — without it, dragging across the one
 * remaining link starts a link drag rather than a selection. The menu at the end
 * of the row carries Open deal for anyone who wants the old big target.
 *
 * Platforms are marks in tiles, not text pills. Three capsules reading "TikTok"
 * "Instagram" "YouTube" next to a status capsule was four filled shapes on one
 * line all shouting at the same volume, and it cost the brand name the width it
 * needed. All three slots always render, so the column can be scanned straight
 * down the page instead of reflowing per row; colour is the state, and a
 * platform the deal does not post to goes grey rather than disappearing.
 */
function DealRow({
  row,
  queued,
  nextAt,
  up,
}: {
  row: DealListRow;
  /** scheduled or mid-flight on this deal right now. */
  queued: number;
  /** the soonest thing still due to fire. */
  nextAt: string | null;
  up: boolean;
}) {
  const unpaid = row.earnedCents - row.paidCents;
  const on = new Set<Platform>(row.platforms);
  const live = row.deal.status === "active";

  return (
    <div
      className={`group relative flex items-center gap-4 border-t border-line px-5 py-4 first:border-t-0 sm:px-6 ${
        live ? "bg-ember/50" : ""
      }`}
    >
      <BrandMark name={row.brand.name} logo={brandLogo(row.brand)} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/deals/${row.deal.id}`}
            draggable={false}
            className="min-w-0 truncate text-[16.5px] font-bold tracking-[-0.02em] transition-colors hover:text-flame"
          >
            {row.brand.name}
          </Link>
          <OpenDealChip dealId={row.deal.id} brand={row.brand.name} />
        </div>
        {/* the campaign, then whichever of "what is coming" and "what already
            went" is the live fact. A queue beats a last-posted date: one is
            something about to happen that somebody may want to stop, the other
            is history. This line is the whole of what /social's list said. */}
        <p className="mt-0.5 truncate text-[12.5px] text-ink-50">
          {row.deal.name}
          {queued > 0 ? (
            <>
              {" · "}
              <Link
                href={`/tools/autoposting?deal=${row.deal.id}`}
                draggable={false}
                className="font-semibold text-flame transition-colors hover:text-flame-dark"
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

      <div className="hidden w-[92px] shrink-0 sm:block">
        <StatusChip tone={statusTone[row.deal.status]}>{statusWord[row.deal.status]}</StatusChip>
      </div>

      {/* the tiles are the way in to connecting, not decoration. They were dead
          marks: three greys on a deal with no accounts, and the only route to
          fixing that was the three-dots menu, then Edit deal, then scroll to
          Accounts. Now the cell is the link, and it lands on the section that
          can both connect an account and take a hand-typed handle — a deal that
          tracks without posting is a first-class deal and must not be sent to a
          composer to fix itself. */}
      <Link
        href={`/deals/${row.deal.id}/edit#accounts`}
        draggable={false}
        title={
          row.platforms.length
            ? `Posts on ${row.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}. Add or change an account.`
            : "No accounts on this deal. Connect one or type a handle in."
        }
        aria-label={
          row.platforms.length
            ? `Accounts on this deal: ${row.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")}`
            : "No accounts on this deal yet. Add one."
        }
        className="group/acct hidden w-[162px] shrink-0 items-center gap-1.5 rounded-[10px] lg:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/45"
      >
        {PLATFORMS.map((platform) => (
          <PlatformTile key={platform} platform={platform} on={on.has(platform)} />
        ))}
      </Link>

      <p className="hidden w-[64px] shrink-0 text-right text-[13.5px] tabular-nums text-ink-70 md:block">
        {row.videoCount}
      </p>

      <p className="w-[80px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
        {fmtViews(row.totalViews)}
      </p>

      <p className="w-[92px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
        {money(row.earnedCents)}
      </p>

      {/* the only flame in the table, so the column you are actually chasing is
          the one thing coloured on the page. A settled deal goes quiet rather
          than drawing a grey $0 at the same weight as a real debt. */}
      <p
        className={`w-[92px] shrink-0 text-right text-[14px] tabular-nums ${
          unpaid > 0 ? "font-bold text-flame" : "text-ink-50"
        }`}
      >
        {money(Math.max(0, unpaid))}
      </p>

      <DealMenu dealId={row.deal.id} brand={row.brand.name} up={up} />
    </div>
  );
}

/**
 * The visible half of "this row opens".
 *
 * The brand name is a link, but a bold word on a table row does not read as one
 * — nothing here is underlined and the whole slab is bold text, so the only way
 * anybody found the deal page was the three-dots menu at the far end. This is
 * the same destination, said out loud, sitting where the eye already is.
 *
 * It stays quiet until the row is hovered rather than hiding until then: a
 * control that appears on hover does not exist on a touch screen, and one that
 * shouts on every row turns the name column into a wall of buttons. Grey outline
 * always, flame on row hover.
 */
function OpenDealChip({ dealId, brand }: { dealId: string; brand: string }) {
  return (
    <Link
      href={`/deals/${dealId}`}
      draggable={false}
      aria-label={`Open ${brand}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-[3px] text-[11px] font-bold tracking-[-0.01em] text-ink-50 transition-colors hover:border-flame hover:bg-ember hover:text-flame group-hover:text-ink-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flame/45"
    >
      Open deal
      <svg
        viewBox="0 0 24 24"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
      </svg>
    </Link>
  );
}

/**
 * One platform slot. Full brand colour when the deal posts there, a grey mark on
 * a sunken tile when it does not.
 *
 * The tile is what makes the off state readable. A greyed glyph floating on the
 * row read as a rendering fault rather than an empty slot, and colour alone is
 * not a signal everybody receives.
 *
 * The empty tile warms on hover of the cell around it, which is the only thing
 * on the row that says the greys are a button. `group/acct` rather than the
 * row's own `group`: hovering anywhere on a deal should not make three empty
 * slots light up as though they were about to do something.
 */
function PlatformTile({ platform, on }: { platform: Platform; on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-9 items-center justify-center rounded-[10px] border transition-colors ${
        on
          ? "border-line bg-paper shadow-card"
          : "border-line/60 bg-shell group-hover/acct:border-flame/30 group-hover/acct:bg-ember"
      }`}
    >
      <PlatformGlyph
        platform={platform}
        tone={on ? "brand" : "current"}
        className={`size-[18px] ${on ? "" : "text-ink-50/40"}`}
      />
    </span>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[15px] shrink-0"
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
