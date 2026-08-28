import type { Metadata } from "next";
import { PeopleBoard, type PersonRow } from "@/components/dash/people-board";
import {
  accessOf,
  loadGrants,
  loadPeople,
  personInitial,
  personName,
  totalPosts,
  totalViews,
  type Person,
} from "@/lib/founder";
import { loadCreditHealth } from "@/lib/founder-credits";
import { ago, views as compactViews } from "@/lib/money";
import { microsToUsd } from "@/lib/usage-pricing";

export const metadata: Metadata = {
  title: "People · Creator Empire",
  robots: { index: false },
};

const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The whole founder section, on one page.
 *
 * Everything here has been fighting for room it does not need. The totals were
 * four cards a hundred and fifty pixels tall to hold a single digit each; they
 * are one strip now, because five small numbers read as a sentence and do not
 * each need a box. The people were cards inside a panel, which is a border
 * inside a border, so the panel is a heading and the cards sit on the page.
 *
 * The top band was still mostly empty — five figures against seventeen hundred
 * pixels — and under it sat a heading reading "Everyone" over a count, which is
 * furniture: the grid beneath it is self evidently everyone. So the search took
 * the space the figures were not using, the chips took the heading's line, and
 * the count moved to the end of that row where it now says how much of the
 * roster is showing rather than how big it is.
 *
 * The rows are formatted here and handed over as strings, because the board is
 * a client component and this file's helpers reach for `next/headers`.
 */
export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ viewas_error?: string }>;
}) {
  const [{ viewas_error: viewasError }, people, grants, credits] =
    await Promise.all([searchParams, loadPeople(), loadGrants(), loadCreditHealth()]);

  const posts = people.reduce((n, p) => n + totalPosts(p), 0);
  const viewCount = people.reduce((n, p) => n + totalViews(p), 0);
  const spend = people.reduce((n, p) => n + p.spend_micros, 0);
  const deals = people.reduce((n, p) => n + p.deal_count, 0);
  const founders = people.filter((p) => accessOf(p) === "founder").length;

  // a grant written against an address nobody has signed up on yet. It is real
  // access the moment they do, so it is listed here rather than nowhere: an
  // invisible permission is worse than an odd looking card.
  const known = new Set(people.map((p) => (p.email ?? "").toLowerCase()));
  const waiting = grants.filter((g) => !known.has(g.email));

  const rows: PersonRow[] = [
    ...people.map(toRow),
    ...waiting.map(
      (g): PersonRow => ({
        userId: "",
        name: g.email,
        initial: g.email.charAt(0).toUpperCase() || "?",
        avatar: null,
        email: g.email,
        seen: "never signed in",
        posts: "0",
        views: "0",
        deals: "0",
        spend: microsToUsd(0),
        level: accessOf({ grant_role: g.role, seat_role: null }),
      })
    ),
  ];

  return (
    <div className="space-y-5">
      {viewasError && (
        <p className="rounded-card border border-line bg-ember px-5 py-3 text-[13.5px] text-flame-dark">
          view as did not start: {viewasError}
        </p>
      )}

      <PeopleBoard rows={rows}>
        {/* every total on the page, sharing one band with the search. */}
        <Figure
          value={fmt(people.length)}
          label={founders ? `people, ${fmt(founders)} founder` : "people"}
        />
        <Figure value={fmt(posts)} label="posts" />
        <Figure value={compactViews(viewCount)} label="views" />
        <Figure value={fmt(deals)} label={deals === 1 ? "deal" : "deals"} />
        <Figure
          value={microsToUsd(spend)}
          label="spent"
          title={
            credits.burned === 0
              ? "no credits burned in 30 days"
              : `${fmt(credits.burned)} credits in 30 days, ${credits.perDay.toFixed(1)} a day`
          }
        />
        {credits.balance !== null && (
          <Figure
            value={fmt(credits.balance)}
            label={
              credits.daysLeft === null
                ? "credits left"
                : `credits, ${fmt(credits.daysLeft)} days`
            }
          />
        )}
      </PeopleBoard>
    </div>
  );
}

/** A roster row, in the words the card prints. */
function toRow(p: Person): PersonRow {
  const seen = p.last_call_at ?? p.last_posted_at;
  return {
    userId: p.user_id,
    name: personName(p),
    initial: personInitial(p),
    avatar: p.avatar_url,
    email: p.email ?? "",
    seen: seen ? ago(seen) : "never used it",
    posts: fmt(totalPosts(p)),
    views: compactViews(totalViews(p)),
    deals: fmt(p.deal_count),
    spend: microsToUsd(p.spend_micros),
    level: accessOf(p),
  };
}

/** One number in the strip: the figure, and what it counts under it. */
function Figure({
  value,
  label,
  title,
}: {
  value: string;
  label: string;
  title?: string;
}) {
  return (
    <div title={title}>
      <p className="text-[20px] font-extrabold leading-none tracking-[-0.03em]">
        {value}
      </p>
      <p className="mt-1 text-[12px] text-ink-50">{label}</p>
    </div>
  );
}
