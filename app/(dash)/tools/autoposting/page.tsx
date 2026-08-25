import { notFound } from "next/navigation";
import { AutopostingWorkspace } from "@/components/dash/autoposting-workspace";
import { loadAutopostWorkspace } from "@/lib/autopost/batch-server";
import { createClient } from "@/lib/supabase/server";
import { currentTz } from "@/lib/tz-server";
import { wallClock } from "@/lib/tz";

export const metadata = { title: "Autoposting · Creator Empire" };

// the wizard sends a batch upstream one post at a time, and nine of them on a
// cold function is longer than the platform default allows.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Autoposting: one brand, three screens, a batch built by hand.
 *
 * What this replaces is at the bottom of the file, commented out rather than
 * deleted. That page was the account roster: every connected login across every
 * brand, grouped by platform, with a reconnect button on each. It answered one
 * real question ("did my instagram drop anywhere") and scheduled nothing, and
 * it is kept because that question is still worth a screen and because the
 * roster is the only view that reads DOWN the platform instead of across the
 * brand. Connecting itself did not move: the same ConnectButton, with the same
 * origin, sits in the brand bar of the new workspace, so an expired login is
 * still fixed from here.
 *
 * `?deal=` is the whole navigation. Switching brands re-reads on the server
 * because the clips, the connections and the tag preset all belong to the deal,
 * and the connection refresh costs an upstream call that should happen once per
 * brand somebody actually opens, not once per brand they own.
 */
export default async function AutopostingPage({
  searchParams,
}: {
  searchParams: Promise<{ deal?: string; pick?: string }>;
}) {
  const { deal, pick } = await searchParams;
  const supabase = await createClient();

  /*
   * `?pick=variation:<id>` is Variations handing a finished render over.
   *
   * It carries the render, not a deal, because the tool it comes from does not
   * know about deals — a variation belongs to a BRAND. So the brand is looked
   * up here and turned into one of this creator's deals on it, which is the
   * question the workspace actually needs answered. An explicit `?deal=` still
   * wins: somebody who navigated to a brand and then followed a link should
   * stay where they were.
   *
   * rls does the scoping, so a render id belonging to somebody else resolves to
   * nothing and the page opens on the default deal rather than refusing.
   */
  const dealFromPick =
    !deal && pick?.startsWith("variation:")
      ? await dealForVariation(supabase, pick.slice("variation:".length))
      : null;

  const view = await loadAutopostWorkspace(deal ?? dealFromPick);
  if (!view) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  // no <Page> wrapper: the workspace draws its own DashBar, which has to reach
  // both edges, and Page is the centred column that would stop it.
  return (
    <AutopostingWorkspace
      view={view}
      userId={user.id}
      // computed here so nothing in the client tree has to call a clock while
      // rendering, which react's purity rule flags and which would also make
      // the first paint disagree with the server's.
      todayKey={wallClock(new Date(), await currentTz()).day}
      // only honoured when the clip is actually in the deal's library, which is
      // the flow's own check — a stale link cannot preselect a ghost.
      initialPicked={pick ? [pick] : []}
    />
  );
}

/* ---------------------------------------------------------------------------
 * THE ACCOUNT ROSTER, AS IT WAS. Kept whole, on purpose.
 *
 * Every account you post from, grouped by platform rather than by brand. It is
 * the only cut of this data that answers "did my instagram drop anywhere"
 * without opening four deals in turn. Nothing here scheduled anything, which is
 * why the batch wizard above took the route rather than sharing it.
 *
 * To bring it back: give it its own segment (`/tools/autoposting/accounts`),
 * uncomment, and re-add the imports it needs. Its one write, ConnectButton,
 * already lives in the new workspace's brand bar, so nothing about connecting
 * depends on this coming back.
 * ---------------------------------------------------------------------------

import Link from "next/link";
import { BrandMark } from "@/components/dash/brand-mark";
import { ConnectButton } from "@/components/dash/connect-button";
import { PlatformGlyph } from "@/components/dash/platform-glyph";
import { Crumbs, DashBar, Empty, Page, Panel, Pill, Row } from "@/components/dash/ui";
import { loadAutopostDeals, type AutopostDeal } from "@/lib/autopost/server";
import { brandLogo } from "@/lib/brand-catalog";
import { PLATFORMS, PLATFORM_LABEL, profileUrl, type Platform } from "@/lib/deals";
import { createClient } from "@/lib/supabase/server";
import { dealScope } from "@/lib/workspace";

export const metadata = { title: "Autoposting · Creator Empire" };

/**
 * Every account you post from, grouped by platform.
 *
 * This is deliberately NOT the old /social. That page listed brand deals, which
 * is what /deals lists, so the rail asked you to pick a brand twice and never
 * said which half of it was behind which word. Posting is a tab on the deal now
 * and this is the other cut of the same data: down the platform instead of
 * across the brand.
 *
 * That cut answers a question no deal page can. Upload-Post logins expire, and a
 * creator working four brands has up to twelve of them; "did my instagram drop
 * anywhere" is four deals opened in turn on the per-deal view and one screen
 * here. Nothing on this page schedules anything — the composer needs to know
 * which brand it is posting for, and this page deliberately does not.
 *
 * Reconnecting is the one write, and it is the same ConnectButton the deal's own
 * strip carries, with the same origin: log in on the platform's page, come back
 * to that deal's Posting tab where the handle now shows.
 *\/
export default async function AutopostingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const deals = user ? await loadAutopostDeals(supabase, user.id, await dealScope()) : [];

  // one entry per (platform, deal that has a handle on it). A deal with nothing
  // connected is not a row under any platform: it is counted once at the bottom
  // instead, because three empty slots per brand is the same page as before with
  // more grey in it.
  const byPlatform = new Map<Platform, { deal: AutopostDeal; handle: string }[]>(
    PLATFORMS.map((p) => [p, []])
  );
  for (const deal of deals) {
    for (const platform of PLATFORMS) {
      const handle = deal.connected[platform];
      if (handle) byPlatform.get(platform)!.push({ deal, handle });
    }
  }

  const total = [...byPlatform.values()].reduce((n, list) => n + list.length, 0);
  const unconnected = deals.filter((d) => Object.keys(d.connected).length === 0);

  return (
    <>
      <DashBar
        lead={<Crumbs size="lg" trail={[{ label: "Tools", href: "/tools" }, { label: "Autoposting" }]} />}
        right={
          deals.length > 0 ? (
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-[13px] font-semibold text-ink-50">
                {total} account{total === 1 ? "" : "s"} connected
              </span>
              {/* a plain anchor: the route answers with a file and client
                  navigation would swallow the download. *\/}
              <a
                href="/social/export"
                download
                className="flex h-9 items-center rounded-pill border border-line bg-paper px-4 text-[13.5px] font-semibold text-ink-70 transition-colors hover:text-ink"
              >
                Export csv
              </a>
            </div>
          ) : undefined
        }
      />

      <Page className="space-y-5">
        {deals.length === 0 ? (
          <Panel padded={false}>
            <Empty
              title="No brand deals yet."
              line="Posting accounts hang off a deal, not off you. Add the brand you are working with and its accounts show up here."
              action={
                <Link
                  href="/deals/new"
                  className="inline-flex h-10 items-center rounded-pill bg-flame px-5 text-[14px] font-semibold text-on-accent transition-colors hover:bg-flame-dark"
                >
                  Add a deal
                </Link>
              }
            />
          </Panel>
        ) : (
          <>
            <p className="text-[15px] leading-[1.6] text-ink-50">
              Every login you post from, down the platform instead of across the brand. Scheduling
              lives on each deal, under Posting.
            </p>

            {PLATFORMS.map((platform) => {
              const list = byPlatform.get(platform)!;
              return (
                <Panel
                  key={platform}
                  padded={false}
                  title={PLATFORM_LABEL[platform]}
                  action={
                    <span className="text-[13px] text-ink-50">
                      {list.length === 0
                        ? "nothing connected"
                        : `${list.length} account${list.length === 1 ? "" : "s"}`}
                    </span>
                  }
                >
                  {list.length === 0 ? (
                    <p className="px-5 py-4 text-[13.5px] text-ink-50 sm:px-6">
                      No {PLATFORM_LABEL[platform]} account on any deal. Open a deal&apos;s Posting
                      tab to connect one.
                    </p>
                  ) : (
                    list.map(({ deal, handle }) => (
                      <Row key={`${platform}-${deal.dealId}`}>
                        <div className="flex min-w-0 flex-1 items-center gap-3.5">
                          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-line bg-paper shadow-card">
                            <PlatformGlyph
                              platform={platform}
                              tone="brand"
                              className="size-[18px]"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                              <a
                                href={profileUrl(platform, handle, null)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[15.5px] font-bold tracking-[-0.015em] transition-colors hover:text-flame"
                              >
                                @{handle}
                              </a>
                              {deal.status !== "active" && (
                                <Pill tone="quiet">{deal.status}</Pill>
                              )}
                            </span>
                            {/* the brand is the second line, not the first: this
                                page is read down the handles. *\/}
                            <Link
                              href={`/tools/autoposting?deal=${deal.dealId}`}
                              className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-ink-50 transition-colors hover:text-flame"
                            >
                              <BrandMark
                                name={deal.brand.name}
                                logo={brandLogo(deal.brand)}
                                size="sm"
                              />
                              <span className="truncate">
                                {deal.brand.name} · {deal.posted} posted
                                {deal.queued > 0 ? ` · ${deal.queued} queued` : ""}
                              </span>
                            </Link>
                          </span>
                        </div>

                        <ConnectButton
                          dealId={deal.dealId}
                          manage
                          tone="line"
                          label="Reconnect"
                        />
                      </Row>
                    ))
                  )}
                </Panel>
              );
            })}

            {unconnected.length > 0 && (
              <Panel
                padded={false}
                title={`Nothing connected · ${unconnected.length}`}
                action={
                  <span className="text-[13px] text-ink-50">
                    tracking still counts views without these
                  </span>
                }
              >
                {unconnected.map((deal) => (
                  <Row key={deal.dealId}>
                    <Link
                      href={`/tools/autoposting?deal=${deal.dealId}`}
                      className="flex min-w-0 flex-1 items-center gap-3.5 py-0.5"
                    >
                      <BrandMark
                        name={deal.brand.name}
                        logo={brandLogo(deal.brand)}
                        size="md"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-bold tracking-[-0.015em]">
                          {deal.brand.name}
                        </span>
                        <span className="mt-0.5 block truncate text-[13.5px] text-ink-50">
                          no posting login on this deal
                        </span>
                      </span>
                    </Link>
                    <ConnectButton dealId={deal.dealId} manage={false} tone="line" />
                  </Row>
                ))}
              </Panel>
            )}
          </>
        )}
      </Page>
    </>
  );
}

 */


/**
 * The deal to open for a variation somebody asked to schedule.
 *
 * Two reads rather than a join: `variation_renders` has no path to `deals`, and
 * the thing they share is a brand. Newest deal on that brand wins, and an ended
 * one is skipped — scheduling posts against a finished campaign is never what
 * the link meant.
 */
async function dealForVariation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  renderId: string
): Promise<string | null> {
  const { data: render } = await supabase
    .from("variation_renders")
    .select("brand_id")
    .eq("id", renderId)
    .maybeSingle();

  const brandId = (render as { brand_id?: string } | null)?.brand_id;
  if (!brandId) return null;

  const { data: deal } = await supabase
    .from("deals")
    .select("id")
    .eq("brand_id", brandId)
    .neq("status", "ended")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (deal as { id?: string } | null)?.id ?? null;
}
