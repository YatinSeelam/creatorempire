import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, Submit } from "@/components/dash/form";
import { PersonAvatar, Thumb } from "@/components/dash/thumb";
import { Panel, Pill, Row } from "@/components/dash/ui";
import { ViewAsButton } from "@/components/dash/view-as";
import {
  loadPerson,
  personInitial,
  personName,
  type UgcItem,
  type UgcSource,
} from "@/lib/founder";
import {
  EDITING_ENABLED,
  JOB_STATUS_LABEL,
  type JobStatus,
} from "@/lib/editing";
import { ago, money, shortDate, views as compactViews } from "@/lib/money";
import { ROLE_LABEL, TENANT_ROOT, type OrgRole } from "@/lib/org";
import { portfolioUrl } from "@/lib/portfolio-schema";
import { requireFounderView } from "@/lib/supabase/founder";
import { microsToUsd } from "@/lib/usage-pricing";
import { createOrgFor } from "../../actions";

export const metadata: Metadata = {
  title: "Person · Creator Empire",
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmt = (n: number) => n.toLocaleString("en-US");

/** The three places a post can come from, said in words on the card. */
const SOURCE_LABEL: Record<UgcSource, string> = {
  tracked: "On a deal",
  pulled: "Scraped",
  posted: "Autoposted",
};

const FEE_KIND_LABEL: Record<string, string> = {
  one_time: "one off",
  per_video: "per video",
  per_month: "a month",
};

/** Platform strings come from three tables and are not a closed set here. */
function platformLabel(raw: string): string {
  if (!raw) return "unknown";
  return raw
    .split(",")
    .map((p) => {
      const k = p.trim().toLowerCase();
      if (k === "tiktok") return "TikTok";
      if (k === "instagram") return "Instagram";
      if (k === "youtube") return "YouTube";
      return k ? k[0].toUpperCase() + k.slice(1) : "";
    })
    .filter(Boolean)
    .join(", ");
}

/** "3 tiktok, 2 instagram" out of the per-platform counts. */
function platformCounts(byPlatform: [string, number][]): string {
  return byPlatform.map(([p, n]) => `${fmt(n)} ${p}`).join(", ");
}

export default async function AdminPersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ note?: string }>;
}) {
  const [{ id }, { note }] = await Promise.all([params, searchParams]);

  if (!UUID.test(id)) notFound();

  const detail = await loadPerson(id);

  if (!detail) notFound();

  const { person, ugc, ugcHidden, usage, deals, jobs } = detail;
  const name = personName(person);
  const dealAccountCount = deals.reduce((n, d) => n + d.accounts.length, 0);

  // the workspaces they own or sit on. read under the admin view, which the
  // `orgs_admin_read` / `org_members_admin_read` policies answer to; nothing
  // else in the app can see somebody else's seats.
  const { supabase } = await requireFounderView("/founder");
  const { data: seatRows } = await supabase
    .from("org_members")
    .select("role, org:orgs(id, name, slug, owner_id)")
    .eq("user_id", id)
    .order("joined_at", { ascending: true });
  const seats = (seatRows ?? [])
    .map((r) => {
      const row = r as unknown as {
        role: OrgRole;
        org: {
          id: string;
          name: string;
          slug: string;
          owner_id: string;
        } | null;
      };
      return row.org ? { role: row.role, ...row.org } : null;
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="space-y-6">
      <Link
        href="/founder"
        className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-ink-50 transition-colors hover:text-flame"
      >
        <span aria-hidden="true">←</span> Everyone
      </Link>

      {note && (
        <p className="rounded-card border border-line bg-ember px-5 py-3.5 text-[13.5px] text-flame-dark">
          {note}
        </p>
      )}

      {/* 1. who they are */}
      <Panel>
        <div className="flex flex-wrap items-start gap-5">
          <PersonAvatar
            src={person.avatar_url}
            initial={personInitial(person)}
            className="size-16 text-[20px]"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-[20px] font-extrabold tracking-[-0.025em]">
                {name}
              </h2>
              {person.is_admin && <Pill tone="flame">Founder</Pill>}
              {EDITING_ENABLED && detail.editorHandle && (
                <Pill tone="ink">Editor</Pill>
              )}
              {detail.subscription && (
                <Pill tone="line">{detail.subscription.status}</Pill>
              )}
            </div>

            <p className="mt-1.5 text-[14.5px] text-ink-70">
              {person.email ?? "no email on file"}
            </p>

            <p className="mt-1 text-[13.5px] text-ink-50">
              Joined {shortDate(person.created_at)}
              {person.handle ? ` · @${person.handle}` : ""}
              {person.niche ? ` · ${person.niche}` : ""}
              {person.last_call_at
                ? ` · last call ${ago(person.last_call_at)}`
                : ""}
            </p>

            <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] font-semibold">
              {person.portfolio_slug && (
                <a
                  href={`https://${portfolioUrl(person.portfolio_slug)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-flame transition-colors hover:text-flame-dark"
                >
                  {portfolioUrl(person.portfolio_slug)}
                  {person.portfolio_published ? "" : " (unpublished)"}
                </a>
              )}
              {/* the market is off, and /e/<handle> 404s with it */}
              {EDITING_ENABLED && detail.editorHandle && (
                <Link
                  href={`/e/${detail.editorHandle}`}
                  className="text-ink-70 transition-colors hover:text-flame"
                >
                  Editor page
                </Link>
              )}
            </div>
          </div>

          <div className="shrink-0">
            <ViewAsButton userId={person.user_id} name={name} />
          </div>
        </div>
      </Panel>

      {/* 1b. agency workspaces: what they run or sit on, and the one door an
          agency owner has into the product. an owner never pays a creator
          plan and cannot reach /new until they hold a seat, so a b2b customer
          who signed up was stuck on the pricing page until this existed. */}
      <Panel
        title="Workspaces"
        sub={
          seats.length === 0
            ? "not on any agency workspace"
            : `${seats.length} ${seats.length === 1 ? "workspace" : "workspaces"}`
        }
        padded={false}
      >
        {seats.map((s) => (
          <Row key={s.id}>
            <Link href={`/founder/agencies/${s.id}`} className="min-w-0 flex-1 transition-colors hover:text-flame">
              <p className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                {s.name}
              </p>
              <p className="mt-0.5 truncate text-[12.5px] text-ink-50">
                {s.slug}.{TENANT_ROOT}
              </p>
            </Link>
            <Pill tone={s.owner_id === person.user_id ? "flame" : "quiet"}>
              {ROLE_LABEL[s.role]}
            </Pill>
          </Row>
        ))}

        <div className="border-t border-line px-5 py-5 first:border-t-0 sm:px-6">
          <p className="text-[13.5px] font-semibold">
            Give {name} an agency workspace
          </p>
          <p className="mt-1 max-w-[64ch] text-[12.5px] leading-[1.55] text-ink-50">
            They own it outright: branding, invites, the roster, their own flow
            key. Nobody&apos;s deals move. They see it in their switcher on the
            next page load and can open /agency straight away, no plan needed.
          </p>
          <form
            action={createOrgFor}
            className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
          >
            <input type="hidden" name="user_id" value={person.user_id} />
            <Field
              label="Workspace name"
              name="name"
              placeholder="Acme Creators"
              required
            />
            <Field
              label="Web address"
              name="slug"
              placeholder="acme"
              suffix={`.${TENANT_ROOT}`}
              hint="Blank takes it from the name."
            />
            <div className="flex">
              <Submit>Create for them</Submit>
            </div>
          </form>
        </div>
      </Panel>

      {/* 2. usage, one panel, four groups */}
      <Panel
        title="Usage"
        sub={`${microsToUsd(person.spend_micros)} across the whole product, priced by the rates in code`}
        action={
          <Link
            href={`/founder/usage?user=${person.user_id}&range=all`}
            className="text-[13px] font-semibold text-ink-50 transition-colors hover:text-flame-dark"
          >
            Full ledger
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UsageGroup
            label="Scraper"
            value={microsToUsd(usage.scrape.micros)}
            lines={
              usage.scrape.calls === 0
                ? ["never run"]
                : [
                    `${fmt(usage.scrape.credits)} credits burned`,
                    `${fmt(usage.scrape.calls)} ${usage.scrape.calls === 1 ? "call" : "calls"}`,
                    `${fmt(usage.scrape.profiles)} saved ${usage.scrape.profiles === 1 ? "profile" : "profiles"}`,
                  ]
            }
          />
          <UsageGroup
            label="AI flow"
            value={microsToUsd(usage.flow.micros)}
            lines={
              usage.flow.turns === 0
                ? ["never used"]
                : [
                    `${fmt(usage.flow.turns)} ${usage.flow.turns === 1 ? "turn" : "turns"}`,
                    `${fmt(usage.flow.tokensIn)} tokens in`,
                    `${fmt(usage.flow.tokensOut)} tokens out`,
                  ]
            }
          />
          <UsageGroup
            label="Account emails"
            value={fmt(usage.emails.addresses)}
            lines={
              usage.emails.addresses === 0
                ? ["no addresses made"]
                : [
                    `${usage.emails.addresses === 1 ? "address" : "addresses"} made`,
                    usage.emails.accounts === 0
                      ? "no platform accounts yet"
                      : platformCounts(usage.emails.byPlatform),
                    `${fmt(usage.emails.codes)} ${usage.emails.codes === 1 ? "code" : "codes"} received`,
                  ]
            }
          />
          <UsageGroup
            label="Transcriber"
            value={fmt(usage.transcripts)}
            lines={
              usage.transcripts === 0
                ? ["never used"]
                : [
                    `${usage.transcripts === 1 ? "transcript" : "transcripts"} saved`,
                  ]
            }
          />
        </div>
      </Panel>

      {/* 3. deals, each with the accounts signed up for it */}
      <Panel
        title={`Deals (${deals.length})`}
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {fmt(dealAccountCount)}{" "}
            {dealAccountCount === 1 ? "account" : "accounts"} attached
          </span>
        }
      >
        {deals.length === 0 ? (
          <Empty
            head="No deals."
            body="A deal is one brand and one run of work. Without one there is nothing for a bonus rule to pay against."
          />
        ) : (
          deals.map((d) => (
            <Row key={d.id}>
              <div className="min-w-0 flex-1 py-0.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <p className="truncate text-[15px] font-bold tracking-[-0.015em]">
                    {d.brand ?? "No brand"}
                  </p>
                  <Pill tone={d.status === "active" ? "flame" : "quiet"}>
                    {d.status}
                  </Pill>
                </div>
                <p className="mt-0.5 truncate text-[13.5px] text-ink-50">
                  {d.name ?? "Untitled deal"}
                  {d.started_on ? ` · from ${shortDate(d.started_on)}` : ""}
                  {d.ends_on ? ` to ${shortDate(d.ends_on)}` : ""}
                </p>
                <p className="mt-1 truncate text-[13px] text-ink-50">
                  {d.accounts.length === 0
                    ? "no accounts attached"
                    : d.accounts
                        .map(
                          (a) =>
                            `${platformLabel(a.platform)} @${a.handle}${a.active ? "" : " (paused)"}`
                        )
                        .join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold tabular-nums">
                  {d.flat_fee_cents ? money(d.flat_fee_cents) : "no flat fee"}
                </p>
                <p className="text-[12.5px] text-ink-50">
                  {d.flat_fee_kind
                    ? (FEE_KIND_LABEL[d.flat_fee_kind] ?? d.flat_fee_kind)
                    : "bonus only"}
                </p>
              </div>
            </Row>
          ))
        )}
      </Panel>

      {/* edit jobs, only when the market is on and there are any */}
      {EDITING_ENABLED && jobs.length > 0 && (
        <Panel title={`Edit jobs (${jobs.length})`} padded={false}>
          {jobs.map((j) => (
            <Row key={j.id}>
              <div className="min-w-0 flex-1 py-0.5">
                <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
                  {j.title}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-50">
                  {JOB_STATUS_LABEL[j.status as JobStatus] ?? j.status} ·{" "}
                  {shortDate(j.created_at)}
                  {j.video_count ? ` · ${j.video_count} videos` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold tabular-nums">
                  {j.pay_cents ? money(j.pay_cents) : "unpaid"}
                </p>
                <p className="text-[12.5px] text-ink-50">
                  {j.pay_kind === "per_video" ? "per video" : "flat"}
                </p>
              </div>
            </Row>
          ))}
        </Panel>
      )}

      {/* 4. what they have made */}
      <Panel
        title="What they have made"
        padded={false}
        action={
          <span className="text-[13px] text-ink-50">
            {ugcHidden > 0
              ? `newest ${ugc.length}, ${fmt(ugcHidden)} older not shown`
              : `${ugc.length} ${ugc.length === 1 ? "post" : "posts"}`}
          </span>
        }
      >
        {ugc.length === 0 ? (
          <Empty
            head="Nothing here yet."
            body="This fills from three places: videos on a deal, posts pulled with the profile scraper, and anything sent out through the autoposter. Empty means none of the three has run for this account."
          />
        ) : (
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
            {ugc.map((item) => (
              <UgcCard key={item.key} item={item} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/**
 * One of the four usage groups: what the tool is called, what it cost or made,
 * and the two or three lines that say how.
 */
function UsageGroup({
  label,
  value,
  lines,
}: {
  label: string;
  value: string;
  lines: string[];
}) {
  return (
    <div className="rounded-[12px] border border-line bg-shell px-4 py-4">
      <p className="text-[12.5px] font-semibold text-ink-50">{label}</p>
      <p className="mt-1.5 text-[22px] font-extrabold leading-none tracking-[-0.02em] tabular-nums">
        {value}
      </p>
      <div className="mt-2 space-y-1">
        {lines.map((l) => (
          <p key={l} className="text-[12.5px] leading-[1.45] text-ink-50">
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * One post. The cover is the point, so it is the whole top of the card, and the
 * source chip sits on it because a scraped post and a deal video are otherwise
 * the same picture with the same number under it.
 */
function UgcCard({ item }: { item: UgcItem }) {
  const body = (
    <>
      <span className="relative block">
        <Thumb
          src={item.thumbnail}
          fallback={platformLabel(item.platform).slice(0, 2)}
          className="block h-[168px] w-full rounded-[10px]"
        />
        <span className="absolute left-2 top-2 inline-flex items-center rounded-pill bg-ink/85 px-2.5 py-1 text-[11.5px] font-semibold text-white">
          {SOURCE_LABEL[item.source]}
        </span>
      </span>

      <span className="mt-2.5 block truncate text-[14px] font-semibold tracking-[-0.01em]">
        {item.title}
      </span>

      <span className="mt-1 block truncate text-[12.5px] text-ink-50">
        {platformLabel(item.platform)}
        {item.views !== null ? ` · ${compactViews(item.views)} views` : ""}
        {item.likes ? ` · ${compactViews(item.likes)} likes` : ""}
        {item.postedAt ? ` · ${ago(item.postedAt)}` : ""}
        {item.note ? ` · ${item.note}` : ""}
      </span>
    </>
  );

  const shell =
    "block rounded-[12px] border border-line bg-shell p-2.5 transition-colors";

  return item.url ? (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className={`${shell} hover:border-flame/45`}
    >
      {body}
    </a>
  ) : (
    <div className={shell}>{body}</div>
  );
}

function Empty({ head, body }: { head: string; body: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-[15px] font-bold tracking-[-0.015em]">{head}</p>
      <p className="mx-auto mt-1 max-w-[52ch] text-[13.5px] leading-[1.6] text-ink-50">
        {body}
      </p>
    </div>
  );
}
