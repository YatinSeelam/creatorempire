import Link from "next/link";

export type DealTab = "numbers" | "posting" | "settings";

/**
 * The three halves of a deal, as one control.
 *
 * A deal used to be spread over two rail rows and a button. /deals listed every
 * brand with its money, /social listed the same brands with their queue, and the
 * forms were behind an Edit on one of them. Every task started with a guess
 * about which of the two lists held the half you wanted, and a lot of them ended
 * in a round trip: open the deal, realise the schedule is on the other page, go
 * back out to the rail.
 *
 * There is one list now and one page per deal, and this is what moves between
 * its halves. Numbers is what the deal earned, Posting is what goes out of it,
 * Settings is every form. Same brand, same url stem, no navigation back up to a
 * list in between.
 *
 * A plain group of links rather than a client tab widget: each half is a real
 * route with its own data, so the active one is a fact the server already knows
 * and passes in. Nothing here needs javascript.
 *
 * `posting` is the `nav.social` org switch. It hides the tab the way every other
 * feature switch hides a rail row and, like those, it does not gate the route:
 * somebody who bookmarked the composer still reaches it.
 */
export function DealTabs({ dealId, active }: { dealId: string; active: DealTab }) {
  // no Posting tab: scheduling lives in /tools/autoposting, and a deal is
  // reached from there by its picker. two composers was one too many.
  const tabs: { id: DealTab; label: string; href: string }[] = [
    { id: "numbers", label: "Numbers", href: `/deals/${dealId}` },
    { id: "settings", label: "Settings", href: `/deals/${dealId}/edit` },
  ];

  return (
    <nav
      aria-label="Deal sections"
      className="flex shrink-0 items-center gap-0.5 rounded-pill border border-line bg-shell p-0.5"
    >
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={`flex h-8 items-center rounded-pill px-3.5 text-[13.5px] font-semibold transition-colors sm:px-4 ${
              on
                ? "bg-paper text-ink shadow-card"
                : "text-ink-50 hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
