import Link from "next/link";
import { BrandMark } from "@/components/dash/brand-mark";
import { Face } from "@/components/dash/face";
import { Cols, Dot, Page, Panel, Stat, StatusChip } from "@/components/dash/ui";
import { money, shortDate, views as fmtViews } from "@/lib/money";
import { AGENCY_PEOPLE_HREF, ROLE_LABEL } from "@/lib/org";
import { loadOrgBooks, loadRosterUsage, type MemberUsage } from "@/lib/org-server";
import { microsToUsd } from "@/lib/usage-pricing";
import { requireAgency } from "@/lib/workspace";

export const metadata = { title: "Students · Creator Empire" };

/** " · 12 credits · 34 ai turns this month", or "" when there is nothing to say. */
function usageLine(u: MemberUsage | undefined): string {
  if (!u) return "";
  const bits: string[] = [];
  const credits = Math.round(u.scrapeCredits);
  if (credits > 0) bits.push(`${credits} credit${credits === 1 ? "" : "s"}`);
  if (u.flowTurns > 0)
    bits.push(`${u.flowTurns} ai turn${u.flowTurns === 1 ? "" : "s"}`);
  return bits.length > 0 ? ` · ${bits.join(" · ")} this month` : "";
}

/**
 * The numbers. Who is on the roster and what they are earning, and nothing else.
 *
 * An admin's view of a creator is READ ONLY, everywhere, and that is enforced
 * by rls rather than by this page choosing not to render a form. The org has a
 * `select` policy on its members' rows and nothing else, so there is no request
 * this page could make that would change somebody's deal.
 *
 * The other deliberate absence: there is no per-creator drill-down into their
 * deals. A roster line is a total, and a coach who needs the detail asks the
 * creator for it. Building the drill-down is a consent conversation, not a
 * route, and it is much easier to add one later than to take one away.
 *
 * Removing somebody is on /agency/people. Splitting the two is the point of the
 * section: this page answers "how is everyone doing", that one answers "who is
 * in here", and the version that stacked both plus a colour picker onto one
 * screen was something you scrolled past rather than used.
 */
export default async function AgencyPage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string }>;
}) {
  const [{ note }, agency] = await Promise.all([searchParams, requireAgency()]);
  const { roster: everyone, deals } = await loadOrgBooks(agency.id);
  const usage = await loadRosterUsage(everyone.map((r) => r.user_id));

  // the creators, ranked. staff (owner, admins) hold no deals on the org's
  // books and are listed on /agency/people where their seats are managed;
  // putting them here was a row of zeros above the people the page is about.
  // earned first, then views, then who joined first, so a fresh roster where
  // nobody has posted yet still has a stable order.
  const roster = everyone
    .filter((r) => r.role === "creator")
    .sort(
      (a, b) =>
        b.earnedCents - a.earnedCents ||
        b.views - a.views ||
        b.videos - a.videos ||
        a.joined_at.localeCompare(b.joined_at)
    );

  const owed = roster.reduce((n, r) => n + r.owedCents, 0);
  const earned = roster.reduce((n, r) => n + r.earnedCents, 0);
  const views = roster.reduce((n, r) => n + r.views, 0);
  const liveDeals = roster.reduce((n, r) => n + r.liveDeals, 0);
  const top = roster[0] && roster[0].earnedCents > 0 ? roster[0] : null;

  return (
    <Page className="space-y-5">
      {note && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          {note}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat
          label="Students"
          value={String(roster.length)}
          note={`${liveDeals} live deal${liveDeals === 1 ? "" : "s"} between them`}
        />
        <Stat label="Views tracked" value={fmtViews(views)} />
        <Stat
          label="Earned"
          value={money(earned)}
          note={top ? `${top.name} leads with ${money(top.earnedCents)}` : "on this workspace's books"}
        />
        <Stat
          label="Owed"
          value={money(owed)}
          note={owed > 0 ? "across the whole roster" : "everyone is settled"}
        />
        <Stat
          label="Usage this month"
          value={microsToUsd(usage.totalMicros)}
          note="scraping and ai, last 30 days"
        />
      </div>

      {roster.length === 0 ? (
        <Panel title="No students yet">
          <p className="max-w-[62ch] text-[13.5px] leading-[1.6] text-ink-50">
            Nobody has joined yet. A student keeps their own login and their
            own deals; only the deals they do inside the programme land on
            these books. An invite is the only way in.{" "}
            <Link href={AGENCY_PEOPLE_HREF} className="font-semibold text-flame">
              Invite your first student
            </Link>
            .
          </p>
        </Panel>
      ) : (
        <Panel
          title={`Students · ${roster.length}`}
          padded={false}
          action={
            <span className="text-[13px] text-ink-50">
              ranked by earned ·{" "}
              <Link href={AGENCY_PEOPLE_HREF} className="font-semibold text-flame">
                manage
              </Link>
            </span>
          }
        >
          <Cols>
            <span className="w-[28px] shrink-0 text-right">#</span>
            <span className="min-w-0 flex-1">Student</span>
            <span className="hidden w-[88px] shrink-0 md:block">Role</span>
            <span className="w-[64px] shrink-0 text-right">Deals</span>
            <span className="hidden w-[64px] shrink-0 text-right lg:block">Videos</span>
            <span className="w-[80px] shrink-0 text-right">Views</span>
            <span className="w-[92px] shrink-0 text-right">Earned</span>
            <span className="w-[92px] shrink-0 text-right">Owed</span>
            <span className="hidden w-[76px] shrink-0 text-right md:block">Cost</span>
          </Cols>

          {roster.map((r, i) => (
            <div
              key={r.user_id}
              className="flex items-center gap-4 border-t border-line px-5 py-3 first:border-t-0 sm:px-6"
            >
              <span
                className={`w-[28px] shrink-0 text-right text-[13.5px] tabular-nums ${
                  i === 0 && r.earnedCents > 0 ? "font-bold text-flame" : "text-ink-50"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Face name={r.name} src={r.avatar_url} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2.5">
                    <span className="truncate text-[15px] font-bold tracking-[-0.015em]">
                      {r.name}
                    </span>
                    {r.liveDeals > 0 && <Dot tone="live">live</Dot>}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-50">
                    {r.email ?? "no email on file"}
                    {r.lastPostedAt
                      ? ` · last posted ${shortDate(r.lastPostedAt)}`
                      : " · nothing posted yet"}
                    {usageLine(usage.byUser.get(r.user_id))}
                  </span>
                </span>
              </span>

              <span className="hidden w-[88px] shrink-0 text-[13px] text-ink-50 md:block">
                {ROLE_LABEL[r.role]}
              </span>
              <span className="w-[64px] shrink-0 text-right text-[13.5px] tabular-nums text-ink-70">
                {r.deals}
              </span>
              <span className="hidden w-[64px] shrink-0 text-right text-[13.5px] tabular-nums text-ink-70 lg:block">
                {r.videos}
              </span>
              <span className="w-[80px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
                {fmtViews(r.views)}
              </span>
              <span className="w-[92px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
                {money(r.earnedCents)}
              </span>
              <span
                className={`w-[92px] shrink-0 text-right text-[14px] tabular-nums ${
                  r.owedCents > 0 ? "font-bold text-flame" : "text-ink-50"
                }`}
              >
                {r.owedCents > 0 ? money(r.owedCents) : "settled"}
              </span>
              <span
                className="hidden w-[76px] shrink-0 text-right text-[13.5px] tabular-nums text-ink-70 md:block"
                title="scraping and ai this student used in the last 30 days"
              >
                {microsToUsd(usage.byUser.get(r.user_id)?.micros ?? 0)}
              </span>
            </div>
          ))}
        </Panel>
      )}

      {/* the deals those numbers come from. an agency owner asked "what is
          everyone working on" gets a list, not a per-creator drill-down: the
          roster line above is a total, this is the same money by deal, and
          neither opens a form. read only, by rls, everywhere. */}
      {deals.length > 0 && (
        <Panel
          title={`Deals on the books · ${deals.length}`}
          padded={false}
          action={<span className="text-[13px] text-ink-50">newest first · read only</span>}
        >
          <Cols>
            <span className="min-w-0 flex-1">Deal</span>
            <span className="hidden w-[140px] shrink-0 md:block">Creator</span>
            <span className="hidden w-[64px] shrink-0 text-right lg:block">Videos</span>
            <span className="w-[80px] shrink-0 text-right">Views</span>
            <span className="w-[92px] shrink-0 text-right">Earned</span>
            <span className="w-[92px] shrink-0 text-right">Owed</span>
          </Cols>

          {deals.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-4 border-t border-line px-5 py-3 first:border-t-0 sm:px-6"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <BrandMark name={d.brandName} logo={d.brandLogo} />
                <span className="min-w-0">
                  <span className="flex items-center gap-2.5">
                    <span className="truncate text-[15px] font-bold tracking-[-0.015em]">
                      {d.brandName}
                    </span>
                    <StatusChip tone={d.status === "active" ? "live" : "quiet"}>
                      {d.status}
                    </StatusChip>
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-ink-50">
                    {d.name}
                    <span className="md:hidden"> · {d.creatorName}</span>
                    {d.lastPostedAt
                      ? ` · last posted ${shortDate(d.lastPostedAt)}`
                      : " · nothing posted yet"}
                  </span>
                </span>
              </span>

              <span className="hidden w-[140px] shrink-0 truncate text-[13px] text-ink-70 md:block">
                {d.creatorName}
              </span>
              <span className="hidden w-[64px] shrink-0 text-right text-[13.5px] tabular-nums text-ink-70 lg:block">
                {d.videos}
              </span>
              <span className="w-[80px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
                {fmtViews(d.views)}
              </span>
              <span className="w-[92px] shrink-0 text-right text-[14px] font-semibold tabular-nums">
                {money(d.earnedCents)}
              </span>
              <span
                className={`w-[92px] shrink-0 text-right text-[14px] tabular-nums ${
                  d.owedCents > 0 ? "font-bold text-flame" : "text-ink-50"
                }`}
              >
                {d.owedCents > 0 ? money(d.owedCents) : "settled"}
              </span>
            </div>
          ))}
        </Panel>
      )}
    </Page>
  );
}
