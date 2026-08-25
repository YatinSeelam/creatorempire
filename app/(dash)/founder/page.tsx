import type { Metadata } from "next";
import Link from "next/link";
import { PersonAvatar } from "@/components/dash/thumb";
import { Panel, Pill, Row, Stat } from "@/components/dash/ui";
import {
  loadPeople,
  personInitial,
  personName,
  totalPosts,
  totalViews,
} from "@/lib/founder";
import { ago, views as compactViews } from "@/lib/money";
import { microsToUsd } from "@/lib/usage-pricing";

export const metadata: Metadata = {
  title: "People · Creator Empire",
  robots: { index: false },
};

const fmt = (n: number) => n.toLocaleString("en-US");

export default async function AdminPeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ viewas_error?: string }>;
}) {
  const [{ viewas_error: viewasError }, people] = await Promise.all([
    searchParams,
    loadPeople(),
  ]);

  const posts = people.reduce((n, p) => n + totalPosts(p), 0);
  const viewCount = people.reduce((n, p) => n + totalViews(p), 0);
  const spend = people.reduce((n, p) => n + p.spend_micros, 0);
  const scrapeSpend = people.reduce((n, p) => n + p.scrape_micros, 0);
  const flowSpend = people.reduce((n, p) => n + p.flow_micros, 0);
  const deals = people.reduce((n, p) => n + p.deal_count, 0);

  return (
    <div className="space-y-6">
      {viewasError && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          view as did not start: {viewasError}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="People"
          value={fmt(people.length)}
          note={
            people.length === 0
              ? "nobody has signed up yet"
              : `${fmt(people.filter((p) => p.is_admin).length)} of them are founders`
          }
        />
        <Stat
          label="Posts"
          value={fmt(posts)}
          note="tracked, pulled and posted, all together"
        />
        <Stat label="Views" value={compactViews(viewCount)} note="across everything above" />
        <Stat
          label="Spend"
          value={microsToUsd(spend)}
          note={`${microsToUsd(scrapeSpend)} scraping, ${microsToUsd(flowSpend)} ai flow`}
        />
      </div>

      <Panel
        title="Everyone"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {fmt(deals)} {deals === 1 ? "deal" : "deals"} between them
          </span>
        }
      >
        {people.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[15px] font-bold tracking-[-0.015em]">
              Nobody has signed up yet.
            </p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[13.5px] leading-[1.6] text-ink-50">
              A profile row is written the first time somebody signs in, so this
              list is every account that has ever reached the app.
            </p>
          </div>
        ) : (
          people.map((p) => {
            const name = personName(p);
            const made = totalPosts(p);
            const seen = p.last_call_at ?? p.last_posted_at;

            return (
              <Row key={p.user_id}>
                <Link
                  href={`/founder/people/${p.user_id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 py-0.5"
                >
                  <PersonAvatar
                    src={p.avatar_url}
                    initial={personInitial(p)}
                    className="size-10"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="truncate text-[15px] font-bold tracking-[-0.015em]">
                        {name}
                      </span>
                      {p.is_admin && <Pill tone="flame">Founder</Pill>}
                    </span>
                    <span className="mt-0.5 block truncate text-[13.5px] text-ink-50">
                      {p.email ?? "no email"}
                      {seen ? ` · last seen ${ago(seen)}` : " · never used it"}
                    </span>
                  </span>
                </Link>

                <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
                  <Cell value={fmt(made)} label="posts" />
                  <Cell value={compactViews(totalViews(p))} label="views" />
                  <Cell value={fmt(p.deal_count)} label="deals" />
                  <Cell value={microsToUsd(p.spend_micros)} label="spend" />
                </div>
              </Row>
            );
          })
        )}
      </Panel>

      <p className="text-[13.5px] leading-[1.6] text-ink-50">
        Spend is everything a person has cost across the product: scrape credits
        plus ai flow tokens, priced by the rates in code. Open somebody to see
        the breakdown.
      </p>
    </div>
  );
}

/** Same right-aligned number with its name under it that Usage uses. */
function Cell({ value, label }: { value: string; label: string }) {
  return (
    <div className="w-[64px] shrink-0 text-right sm:w-[76px]">
      <p className="truncate text-[15px] font-bold tabular-nums">{value}</p>
      <p className="text-[12.5px] text-ink-50">{label}</p>
    </div>
  );
}
